import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import * as jose from 'jose'
import { SAMPLE_JWT } from '../../tests/helpers.js'
import { base64ToBytes, bytesToBase64Url, utf8Encode } from './encoding.js'
import { findPemBlocks, keyAlgorithm } from './pem.js'
import {
    ALGORITHMS,
    SigningKeyError,
    checkHeader,
    claimWarnings,
    defaultHeaderText,
    encodeSegment,
    expectedKey,
    generateKeyPairPem,
    headerAlgOf,
    importSigningKey,
    parseJsonObject,
    prepareToken,
    randomSecret,
    randomUuid,
    readSecret,
    sec1ToPkcs8,
    secretWarning,
    setClaims,
    signToken,
    syncHeaderAlg,
} from './jwtBuild.js'

const JWT_IO_HEADER = { alg: 'HS256', typ: 'JWT' }
const JWT_IO_PAYLOAD = { sub: '1234567890', name: 'John Doe', iat: 1516239022 }

async function verifyWithPem(token, publicPem, alg) {
    const { payload, protectedHeader } = await jose.compactVerify(token, await jose.importSPKI(publicPem, alg), { algorithms: [alg] })
    return { header: protectedHeader, payload: JSON.parse(new TextDecoder().decode(payload)) }
}

async function expectKeyError(promise, pattern) {
    const error = await promise.then(() => null, (e) => e)
    expect(error, 'expected the key to be rejected').toBeInstanceOf(SigningKeyError)
    expect(error.message).toMatch(pattern)
}

const nodeKey = (type, options, encoding) => generateKeyPairSync(type, {
    ...options,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { format: 'pem', ...encoding },
})

describe('HS256 test vector (jwt.io)', () => {
    it('reproduces the jwt.io token exactly', async () => {
        const token = await signToken({ header: JWT_IO_HEADER, payload: JWT_IO_PAYLOAD, key: readSecret('your-256-bit-secret', false).bytes })
        expect(token).toBe(SAMPLE_JWT)
    })

    it('signs the compact JSON of pretty-printed editor text, keeping key order', async () => {
        const prepared = prepareToken({ alg: 'HS256', headerText: defaultHeaderText('HS256'), payloadText: JSON.stringify(JWT_IO_PAYLOAD, null, 4) })
        expect(prepared.headerError).toBeUndefined()
        expect(prepared.payloadError).toBeUndefined()
        const token = await signToken({ header: prepared.header, payload: prepared.payload, key: readSecret('your-256-bit-secret', false).bytes })
        expect(token).toBe(SAMPLE_JWT)
        expect(token.split('.')[0]).toBe(encodeSegment(JWT_IO_HEADER))
        expect(token.split('.')[1]).toBe(encodeSegment(JWT_IO_PAYLOAD))
    })

    it('accepts the same secret Base64- or Base64url-encoded', async () => {
        const raw = utf8Encode('your-256-bit-secret')
        for (const encoded of [btoa('your-256-bit-secret'), bytesToBase64Url(raw)]) {
            const { bytes } = readSecret(encoded, true)
            expect(await signToken({ header: JWT_IO_HEADER, payload: JWT_IO_PAYLOAD, key: bytes })).toBe(SAMPLE_JWT)
        }
    })

    it('warns that the 19-byte jwt.io secret is shorter than RFC 7518 requires', () => {
        const { bytes } = readSecret('your-256-bit-secret', false)
        expect(bytes).toHaveLength(19)
        expect(secretWarning(bytes, 'HS256')).toMatch(/152 bits; HS256 needs at least 256 bits \(32 bytes\)/)
    })
})

describe('HMAC secrets', () => {
    it('reads text as UTF-8 and checks the length against the hash size', () => {
        expect(readSecret('héllo', false).bytes).toEqual(utf8Encode('héllo'))
        expect(secretWarning(new Uint8Array(32), 'HS256')).toBeNull()
        expect(secretWarning(new Uint8Array(31), 'HS256')).toMatch(/248 bits/)
        expect(secretWarning(new Uint8Array(32), 'HS384')).toMatch(/HS384 needs at least 384 bits \(48 bytes\)/)
        expect(secretWarning(new Uint8Array(64), 'HS512')).toBeNull()
    })

    it('explains bad Base64 and empty secrets', () => {
        expect(readSecret('not base64!', true).error).toMatch(/isn’t valid Base64 or Base64url/)
        expect(readSecret('', false).error).toMatch(/empty/)
        expect(readSecret('====', true).error).toBeTruthy()
    })

    it('generates random secrets of the hash size', () => {
        expect(base64ToBytes(randomSecret('HS256'))).toHaveLength(32)
        expect(base64ToBytes(randomSecret('HS384'))).toHaveLength(48)
        expect(base64ToBytes(randomSecret('HS512'))).toHaveLength(64)
        expect(randomSecret('HS256')).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(randomSecret('HS256')).not.toBe(randomSecret('HS256'))
    })

    it('HS384 and HS512 tokens verify with the same secret', async () => {
        const key = readSecret(randomSecret('HS512'), true).bytes
        for (const alg of ['HS384', 'HS512']) {
            const token = await signToken({ header: { alg }, payload: { sub: 'x' }, key })
            const { protectedHeader } = await jose.compactVerify(token, key)
            expect(protectedHeader.alg).toBe(alg)
        }
    })
})

describe('sign and verify round trips with generated keys', () => {
    for (const alg of ['RS256', 'PS256', 'ES256', 'EdDSA', 'RS384', 'RS512', 'PS384', 'PS512', 'ES384', 'ES512']) {
        it(`${alg}: generated PKCS#8 key signs, the derived public key verifies`, async () => {
            const privatePem = await generateKeyPairPem(alg)
            expect(privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/)
            const imported = await importSigningKey(privatePem, alg)
            expect(imported.publicPem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/)
            expect(imported.publicJwk).toMatchObject({ kty: expectedKey(alg).kty, use: 'sig', alg, kid: imported.kid })
            expect(imported.publicJwk).not.toHaveProperty('d')

            const payload = { sub: 'round-trip', iat: 1700000000 }
            const token = await signToken({ header: { alg, typ: 'JWT' }, payload, key: imported.key })
            const verified = await verifyWithPem(token, imported.publicPem, alg)
            expect(verified.header).toEqual({ alg, typ: 'JWT' })
            expect(verified.payload).toEqual(payload)

            // The JWK and its thumbprint describe the same key
            const fromJwk = await jose.compactVerify(token, await jose.importJWK(imported.publicJwk, alg))
            expect(fromJwk.protectedHeader.alg).toBe(alg)
            const { kid, use, alg: _alg, ...material } = imported.publicJwk
            expect(await jose.calculateJwkThumbprint(material)).toBe(kid)
            expect(use).toBe('sig')
        }, 20000)
    }

    it('describes the generated keys', async () => {
        expect((await importSigningKey(await generateKeyPairPem('RS256'), 'RS256')).description).toBe('RSA 2048-bit')
        expect((await importSigningKey(await generateKeyPairPem('ES384'), 'ES384')).description).toBe('EC P-384')
        expect((await importSigningKey(await generateKeyPairPem('EdDSA'), 'EdDSA')).description).toBe('Ed25519')
        await expect(generateKeyPairPem('HS256')).rejects.toThrow(/shared secret/)
    }, 20000)

    it('tokens from another key fail verification', async () => {
        const a = await importSigningKey(await generateKeyPairPem('ES256'), 'ES256')
        const b = await importSigningKey(await generateKeyPairPem('ES256'), 'ES256')
        const token = await signToken({ header: { alg: 'ES256' }, payload: { n: 1 }, key: a.key })
        await expect(verifyWithPem(token, b.publicPem, 'ES256')).rejects.toThrow(/signature verification failed/)
    })
})

describe('private key formats', () => {
    it('converts PKCS#1 “RSA PRIVATE KEY” for RS256 and PS256', async () => {
        const { privateKey, publicKey } = nodeKey('rsa', { modulusLength: 2048 }, { type: 'pkcs1' })
        expect(privateKey).toMatch(/BEGIN RSA PRIVATE KEY/)
        for (const alg of ['RS256', 'PS256']) {
            const imported = await importSigningKey(privateKey, alg)
            expect(imported.notes.join(' ')).toMatch(/Converted from PKCS#1/)
            const token = await signToken({ header: { alg }, payload: { k: 'pkcs1' }, key: imported.key })
            expect((await verifyWithPem(token, publicKey, alg)).payload).toEqual({ k: 'pkcs1' })
            expect(imported.publicPem.replace(/\s+/g, '')).toBe(publicKey.replace(/\s+/g, ''))
        }
    }, 20000)

    it('converts SEC1 “EC PRIVATE KEY” on every curve', async () => {
        for (const [alg, namedCurve] of [['ES256', 'P-256'], ['ES384', 'P-384'], ['ES512', 'P-521']]) {
            const { privateKey, publicKey } = nodeKey('ec', { namedCurve }, { type: 'sec1' })
            expect(privateKey).toMatch(/BEGIN EC PRIVATE KEY/)
            const imported = await importSigningKey(privateKey, alg)
            expect(imported.notes.join(' ')).toMatch(/Converted from SEC1/)
            const token = await signToken({ header: { alg }, payload: { curve: namedCurve }, key: imported.key })
            expect((await verifyWithPem(token, publicKey, alg)).payload).toEqual({ curve: namedCurve })
            expect(imported.publicPem.replace(/\s+/g, '')).toBe(publicKey.replace(/\s+/g, ''))
        }
    })

    it('builds a valid PKCS#8 structure from SEC1, with or without curve parameters', async () => {
        const { privateKey, publicKey } = nodeKey('ec', { namedCurve: 'P-256' }, { type: 'sec1' })
        const sec1 = findPemBlocks(privateKey)[0].der
        expect(keyAlgorithm(sec1ToPkcs8(sec1, 'P-384'), { pkcs8: true })).toEqual({ type: 'EC', curve: 'P-256' }) // the key's own curve wins

        // Same key without the optional [0] parameters: the selected curve is used
        const seqLen = sec1[1] & 0x80 ? 2 + (sec1[1] & 0x7f) : 2
        const version = sec1.slice(seqLen, seqLen + 3)
        const priv = sec1.slice(seqLen + 3, seqLen + 3 + 2 + sec1[seqLen + 4])
        const bare = Uint8Array.of(0x30, version.length + priv.length, ...version, ...priv)
        const der = sec1ToPkcs8(bare, 'P-256')
        expect(keyAlgorithm(der, { pkcs8: true })).toEqual({ type: 'EC', curve: 'P-256' })
        const pem = `-----BEGIN EC PRIVATE KEY-----\n${btoa(String.fromCharCode(...bare))}\n-----END EC PRIVATE KEY-----`
        const imported = await importSigningKey(pem, 'ES256')
        expect(imported.publicPem.replace(/\s+/g, '')).toBe(publicKey.replace(/\s+/g, ''))

        expect(() => sec1ToPkcs8(Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x00), 'P-256')).toThrow(/SEC1/)
        expect(() => sec1ToPkcs8(bare, undefined)).toThrow(/curve/)
    })

    it('skips the “EC PARAMETERS” block that openssl ecparam -genkey writes first', async () => {
        const { privateKey } = nodeKey('ec', { namedCurve: 'P-256' }, { type: 'sec1' })
        const params = '-----BEGIN EC PARAMETERS-----\nBggqhkjOPQMBBw==\n-----END EC PARAMETERS-----\n'
        const imported = await importSigningKey(params + privateKey, 'ES256')
        expect(imported.notes.join(' ')).toMatch(/Used the “EC PRIVATE KEY” block/)
    })

    it('signs with private JWKs and ignores "key_ops"/"use" restrictions with a note', async () => {
        const pair = await jose.generateKeyPair('ES256', { extractable: true })
        const jwk = await jose.exportJWK(pair.privateKey)
        const imported = await importSigningKey(JSON.stringify({ ...jwk, key_ops: ['verify'], use: 'enc' }), 'ES256')
        expect(imported.notes.join(' ')).toMatch(/"use": "enc"/)
        expect(imported.notes.join(' ')).toMatch(/key_ops/)
        const token = await signToken({ header: { alg: 'ES256' }, payload: {}, key: imported.key })
        await expect(jose.compactVerify(token, pair.publicKey)).resolves.toBeTruthy()

        const okp = await jose.exportJWK((await jose.generateKeyPair('EdDSA', { extractable: true })).privateKey)
        expect((await importSigningKey(JSON.stringify(okp), 'EdDSA')).description).toBe('Ed25519')
    })
})

describe('keys that can’t sign', () => {
    it('explains an empty or unreadable key', async () => {
        await expectKeyError(importSigningKey('', 'RS256'), /Paste a private key, or generate a key pair/)
        await expectKeyError(importSigningKey('hello there', 'RS256'), /Paste a PEM private key/)
        await expectKeyError(importSigningKey('-----BEGIN PRIVATE KEY-----\n@@@\n-----END PRIVATE KEY-----', 'ES256'), /isn’t valid Base64/)
        await expectKeyError(importSigningKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', 'ES256'), /doesn’t look like a PKCS#8 private key/)
        await expectKeyError(importSigningKey('{"kty": "EC", ', 'ES256'), /looks like JSON but doesn’t parse/)
        await expectKeyError(importSigningKey('secret', 'HS256'), /signs with a secret/)
    })

    it('rejects the wrong key type for the algorithm', async () => {
        const ec256 = await generateKeyPairPem('ES256')
        await expectKeyError(importSigningKey(ec256, 'RS256'), /This is an EC P-256 key, but RS256 needs an RSA key/)
        await expectKeyError(importSigningKey(ec256, 'ES384'), /This is an EC P-256 key, but ES384 needs an EC P-384 key/)
        await expectKeyError(importSigningKey(ec256, 'EdDSA'), /needs an Ed25519 key/)
        await expectKeyError(importSigningKey(await generateKeyPairPem('EdDSA'), 'ES256'), /This is an Ed25519 key, but ES256 needs an EC P-256 key/)
        await expectKeyError(importSigningKey(await generateKeyPairPem('RS256'), 'ES512'), /This is an RSA key, but ES512 needs an EC P-521 key/)
        const sec1 = nodeKey('ec', { namedCurve: 'P-384' }, { type: 'sec1' }).privateKey
        await expectKeyError(importSigningKey(sec1, 'ES256'), /EC P-384 key, but ES256 needs an EC P-256 key/)
        await expectKeyError(importSigningKey(sec1, 'RS256'), /This is an EC key, but RS256 needs an RSA key/)
        const pkcs1 = nodeKey('rsa', { modulusLength: 2048 }, { type: 'pkcs1' }).privateKey
        await expectKeyError(importSigningKey(pkcs1, 'ES256'), /This is an RSA key, but ES256 needs an EC P-256 key/)
    }, 20000)

    it('rejects RSA keys under 2048 bits', async () => {
        const small = nodeKey('rsa', { modulusLength: 1024 }, { type: 'pkcs8' }).privateKey
        await expectKeyError(importSigningKey(small, 'RS256'), /RS256 needs an RSA key of at least 2048 bits .* this one has 1024/)
        await expectKeyError(importSigningKey(small, 'PS512'), /at least 2048 bits/)
    })

    it('explains public keys, encrypted keys and OpenSSH keys', async () => {
        const { publicKey } = nodeKey('ec', { namedCurve: 'P-256' }, { type: 'pkcs8' })
        await expectKeyError(importSigningKey(publicKey, 'ES256'), /This is a public key/)
        const encrypted = nodeKey('ec', { namedCurve: 'P-256' }, { type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: 'pw' }).privateKey
        expect(encrypted).toMatch(/BEGIN ENCRYPTED PRIVATE KEY/)
        await expectKeyError(importSigningKey(encrypted, 'ES256'), /Encrypted private keys aren’t supported\. Decrypt it first: openssl pkey/)
        const legacy = nodeKey('rsa', { modulusLength: 2048 }, { type: 'pkcs1', cipher: 'aes-256-cbc', passphrase: 'pw' }).privateKey
        expect(legacy).toMatch(/Proc-Type: 4,ENCRYPTED/)
        await expectKeyError(importSigningKey(legacy, 'RS256'), /protected by a passphrase/)
        await expectKeyError(importSigningKey('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----', 'EdDSA'), /OpenSSH private keys aren’t supported/)
        await expectKeyError(importSigningKey('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----', 'RS256'), /certificate/)
    }, 20000)

    it('explains unusable JWKs', async () => {
        const ec = await jose.exportJWK((await jose.generateKeyPair('ES256', { extractable: true })).privateKey)
        const { d: _d, ...ecPublic } = ec
        await expectKeyError(importSigningKey(JSON.stringify(ecPublic), 'ES256'), /public key \(it has no "d"\)/)
        await expectKeyError(importSigningKey(JSON.stringify(ec), 'ES384'), /on curve "P-256", but ES384 needs P-384/)
        await expectKeyError(importSigningKey(JSON.stringify(ec), 'RS256'), /"kty": "EC", but RS256 needs an RSA key/)
        await expectKeyError(importSigningKey(JSON.stringify({ ...ec, alg: 'ES512' }), 'ES256'), /for "ES512" \(its "alg"\)/)
        await expectKeyError(importSigningKey(JSON.stringify({ keys: [ec] }), 'ES256'), /JWK Set/)
        await expectKeyError(importSigningKey(JSON.stringify({ kty: 'oct', k: 'c2VjcmV0' }), 'ES256'), /symmetric/)
        await expectKeyError(importSigningKey('[1, 2]', 'ES256'), /must be a JWK/)
        const rsa = await jose.exportJWK((await jose.generateKeyPair('RS256', { extractable: true })).privateKey)
        await expectKeyError(importSigningKey(JSON.stringify({ kty: 'RSA', n: rsa.n, e: rsa.e, d: rsa.d }), 'RS256'), /has "d" but not "p", "q", "dp", "dq", "qi"/)
    }, 20000)
})

describe('header', () => {
    it('keeps "alg" in sync with the selected algorithm', () => {
        expect(JSON.parse(defaultHeaderText('ES256'))).toEqual({ alg: 'ES256', typ: 'JWT' })
        expect(syncHeaderAlg('{"alg":"HS256","typ":"JWT"}', 'RS256')).toBe('{\n  "alg": "RS256",\n  "typ": "JWT"\n}')
        // keeps the position of "alg" and an existing "typ"
        expect(syncHeaderAlg('{"kid":"k1","alg":"HS256","typ":"at+jwt"}', 'ES256')).toBe('{\n  "kid": "k1",\n  "alg": "ES256",\n  "typ": "at+jwt"\n}')
        // adds a missing alg first and a missing typ
        expect(JSON.parse(syncHeaderAlg('{"kid":"k1"}', 'EdDSA'))).toEqual({ alg: 'EdDSA', kid: 'k1', typ: 'JWT' })
        expect(Object.keys(JSON.parse(syncHeaderAlg('{"kid":"k1"}', 'EdDSA')))).toEqual(['alg', 'kid', 'typ'])
        expect(syncHeaderAlg('{"alg": ', 'HS256')).toBeNull()
        expect(syncHeaderAlg('[]', 'HS256')).toBeNull()
    })

    it('reads a supported alg from the header text', () => {
        expect(headerAlgOf('{"alg":"PS384"}')).toBe('PS384')
        expect(headerAlgOf('{"alg":"none"}')).toBeNull()
        expect(headerAlgOf('{"alg":"HS999"}')).toBeNull()
        expect(headerAlgOf('{"alg":')).toBeNull()
    })

    it('checks the header against the selected algorithm', () => {
        expect(checkHeader({ alg: 'HS256', typ: 'JWT' }, 'HS256')).toEqual({})
        expect(checkHeader({ typ: 'JWT' }, 'HS256')).toEqual({ error: 'The header needs an "alg": "HS256".', fixable: true })
        expect(checkHeader({ alg: 'none' }, 'HS256').error).toMatch(/Unsigned tokens/)
        expect(checkHeader({ alg: 'NONE' }, 'HS256').error).toMatch(/Unsigned tokens/)
        expect(checkHeader({ alg: 'HS1' }, 'HS256').error).toMatch(/“HS1” isn’t supported/)
        expect(checkHeader({ alg: 256 }, 'HS256')).toMatchObject({ error: expect.stringMatching(/must be a string/), fixable: true })
        expect(checkHeader({ alg: 'RS256' }, 'HS256').error).toMatch(/says "RS256", but HS256 is selected/)
        expect(checkHeader({ alg: 'HS256', b64: false }, 'HS256')).toEqual({ error: expect.stringMatching(/b64/) })
    })

    it('surfaces jose’s refusal of unknown critical parameters', async () => {
        await expect(signToken({ header: { alg: 'HS256', crit: ['exp'], exp: 1 }, payload: {}, key: new Uint8Array(32) })).rejects.toThrow(/"crit"/)
    })

    it('lists all 13 algorithms', () => {
        expect(ALGORITHMS).toEqual(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'])
    })
})

describe('payload', () => {
    it('parses only JSON objects, with readable errors', () => {
        expect(parseJsonObject('{"a":1}', 'payload')).toEqual({ value: { a: 1 } })
        expect(parseJsonObject('{"a":1,}', 'payload').error).toMatch(/^The payload isn’t valid JSON: /)
        expect(parseJsonObject('[1]', 'payload').error).toBe('The payload must be a JSON object, not an array.')
        expect(parseJsonObject('"x"', 'header').error).toMatch(/must be a JSON object, not the string "x"/)
        expect(parseJsonObject('null', 'payload').error).toMatch(/not null/)
        expect(parseJsonObject('  ', 'payload').error).toMatch(/is empty/)
    })

    it('sets and removes claims, keeping the order of existing ones', () => {
        const text = '{"sub":"a","iat":1}'
        expect(setClaims(text, { exp: 5 })).toBe('{\n  "sub": "a",\n  "iat": 1,\n  "exp": 5\n}')
        expect(JSON.parse(setClaims(text, { sub: 'b', iat: undefined }))).toEqual({ sub: 'b' })
        expect(() => setClaims('{', { exp: 1 })).toThrow(/isn’t valid JSON/)
    })

    it('warns about claims that verifiers would reject', () => {
        expect(claimWarnings({ sub: 'x', iat: 1700000000, exp: 1700003600 })).toEqual([])
        expect(claimWarnings({ exp: '1700000000' })[0]).toMatch(/"exp" should be a NumericDate/)
        expect(claimWarnings({ iat: 1700000000000 })[0]).toMatch(/"iat" looks like milliseconds/)
        expect(claimWarnings({ iat: 100, exp: 100 })).toContain('"exp" is not after "iat", so the token is expired as soon as it’s issued.')
        expect(claimWarnings({ nbf: 200, exp: 100 })).toContain('"exp" is not after "nbf", so the token is never valid.')
        expect(claimWarnings({ aud: ['a', 1] })[0]).toMatch(/"aud" should be a string or an array of strings/)
        expect(claimWarnings({ aud: ['a', 'b'], iss: 'i', jti: 'j' })).toEqual([])
        expect(claimWarnings({ sub: 42, jti: 7 })).toHaveLength(2)
    })

    it('prepares both parts and reports each problem separately', () => {
        const bad = prepareToken({ alg: 'HS256', headerText: '{"typ":"JWT"}', payloadText: '{"exp": }' })
        expect(bad.headerError).toMatch(/needs an "alg"/)
        expect(bad.headerFixable).toBe(true)
        expect(bad.payloadError).toMatch(/isn’t valid JSON/)
        expect(bad.header).toBeUndefined()
        expect(bad.payload).toBeUndefined()
        const good = prepareToken({ alg: 'ES256', headerText: '{"alg":"ES256"}', payloadText: '{"exp":"soon"}' })
        expect(good.header).toEqual({ alg: 'ES256' })
        expect(good.payload).toEqual({ exp: 'soon' })
        expect(good.warnings).toHaveLength(1)
    })
})

describe('helpers', () => {
    it('makes version 4 UUIDs', () => {
        const uuids = new Set(Array.from({ length: 50 }, randomUuid))
        expect(uuids.size).toBe(50)
        for (const id of uuids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })
})
