import { Buffer } from 'node:buffer'
import { createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
    REGISTERED_CLAIMS, algFamily, decodeToken, describeType, describeValidity, evaluateTimes, importVerificationKeys, normalizeToken, readNumericDate, verifyToken,
} from './jwt'

// The jwt.io example token (secret "your-256-bit-secret")
const SAMPLE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
const b64u = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
const unsigned = (header, payload) => `${b64u(header)}.${b64u(payload)}`

function makeToken(header, payload, signer) {
    const input = unsigned(header, payload)
    return `${input}.${signer(Buffer.from(input)).toString('base64url')}`
}

const verify = (token, extra = {}) => verifyToken({ token, decoded: decodeToken(token), ...extra })

describe('normalizeToken', () => {
    it('strips header names, Bearer, quotes and whitespace, and says what it did', () => {
        expect(normalizeToken(`  Authorization: Bearer ${SAMPLE_JWT}  `)).toEqual({
            value: SAMPLE_JWT, notes: ['Removed the “Authorization:” header name', 'Removed the “Bearer” prefix'],
        })
        expect(normalizeToken(`"${SAMPLE_JWT}"`)).toEqual({ value: SAMPLE_JWT, notes: ['Removed the surrounding quotes'] })
        const wrapped = SAMPLE_JWT.replace(/(.{20})/g, '$1\n')
        expect(normalizeToken(wrapped)).toEqual({ value: SAMPLE_JWT, notes: ['Removed whitespace and line breaks inside the token'] })
        expect(normalizeToken('bearer abc').value).toBe('abc')
    })
    it('leaves clean tokens alone and tolerates empty input', () => {
        expect(normalizeToken(SAMPLE_JWT)).toEqual({ value: SAMPLE_JWT, notes: [] })
        expect(normalizeToken(undefined)).toEqual({ value: '', notes: [] })
        expect(normalizeToken('"')).toEqual({ value: '"', notes: [] })
    })
})

describe('describeType', () => {
    it('describes values for error messages', () => {
        expect(describeType(null)).toBe('null')
        expect(describeType([])).toBe('an array')
        expect(describeType({})).toBe('an object')
        expect(describeType('x')).toBe('the string "x"')
        expect(describeType('a'.repeat(30))).toBe(`the string "${'a'.repeat(24)}…"`)
        expect(describeType(5)).toBe('number 5')
        expect(describeType(true)).toBe('boolean true')
    })
})

describe('decodeToken', () => {
    it('decodes the jwt.io token', () => {
        const d = decodeToken(SAMPLE_JWT)
        expect(d.kind).toBe('jws')
        expect(d.header.value).toEqual({ alg: 'HS256', typ: 'JWT' })
        expect(d.payload).toMatchObject({ type: 'claims', value: { sub: '1234567890', name: 'John Doe', iat: 1516239022 } })
        expect(d.alg).toBe('HS256')
        expect(d.algError).toBeNull()
        expect(d.signature.bytes).toHaveLength(32)
        expect(Buffer.from(d.signature.bytes).toString('base64url')).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
    })

    it('returns null for empty input and errors for the wrong number of parts', () => {
        expect(decodeToken('')).toBeNull()
        expect(decodeToken('a.b').error).toBe('Invalid JWT format: a JWT has 3 parts separated by dots, this has 2.')
        expect(decodeToken('a.b.c.d').error).toMatch(/this has 4/)
        expect(decodeToken('a.b.c.d.e').error).toMatch(/isn’t an encrypted JWE/)
    })

    it('recognises a JWE by its "enc" header', () => {
        const jwe = `${b64u({ alg: 'dir', enc: 'A128GCM' })}.a.b.c.d`
        expect(decodeToken(jwe)).toMatchObject({ kind: 'jwe', header: { value: { enc: 'A128GCM' } } })
    })

    it('decodes each part independently', () => {
        const broken = decodeToken(`!!!.${b64u({ a: 1 })}.sig`)
        expect(broken.header.error).toMatch(/header isn't valid Base64url/)
        expect(broken.payload.type).toBe('claims')
        expect(decodeToken(`${b64u('not json')}.${b64u({ a: 1 })}.sig`).header.error).toBe('The header isn’t valid JSON')
        expect(decodeToken(`${b64u('[1]')}.${b64u({ a: 1 })}.sig`).header.error).toBe('The header must be a JSON object, not an array')
        expect(decodeToken(`${b64u({ alg: 'HS256' })}.${b64u({ a: 1 })}.s=g`).signature.error).toMatch(/signature isn't valid Base64url/)
    })

    it('classifies payloads: claims, plain JSON, text, nested JWT and binary', () => {
        const head = { alg: 'none' }
        expect(decodeToken(`${unsigned(head, [1, 2])}.`).payload).toMatchObject({ type: 'json', value: [1, 2] })
        expect(decodeToken(`${unsigned(head, 'just text')}.`).payload).toMatchObject({ type: 'text', text: 'just text' })
        expect(decodeToken(`${unsigned(head, SAMPLE_JWT)}.`).payload.type).toBe('nested')
        expect(decodeToken(`${unsigned({ alg: 'none', cty: 'JWT' }, 'whatever')}.`).payload.type).toBe('nested')
        const binary = `${b64u(head)}.${Buffer.from([0xff, 0xfe, 0x00]).toString('base64url')}.`
        expect(decodeToken(binary).payload.type).toBe('binary')
        expect(decodeToken(`${b64u(head)}.@@.`).payload).toMatchObject({ type: 'error' })
    })

    it('reports a missing or non-string alg', () => {
        expect(decodeToken(`${unsigned({ typ: 'JWT' }, {})}.x`).algError).toMatch(/no “alg”/)
        const d = decodeToken(`${unsigned({ alg: 5 }, {})}.x`)
        expect(d.algError).toBe('“alg” must be a string, but it is number 5.')
        expect(d.alg).toBeUndefined()
    })
})

describe('algFamily', () => {
    it.each([
        ['HS256', 'hmac'], ['HS512', 'hmac'], ['RS384', 'rsa'], ['PS256', 'rsa'], ['ES256', 'ec'], ['ES512', 'ec'], ['EdDSA', 'okp'], ['Ed25519', 'okp'],
        ['none', 'none'], ['ES256K', 'unsupported'], ['HS128', 'unsupported'], ['hs256', 'unsupported'], ['RSA-OAEP', 'unsupported'], ['', null], [undefined, null],
    ])('%s -> %s', (alg, family) => expect(algFamily(alg)).toBe(family))
})

describe('time claims', () => {
    const NOW = 1_700_000_000_000 // ms

    it('readNumericDate', () => {
        expect(readNumericDate(undefined)).toBeNull()
        expect(readNumericDate(1516239022)).toEqual({ seconds: 1516239022, date: new Date('2018-01-18T01:30:22.000Z') })
        expect(readNumericDate('x').error).toMatch(/must be a number of seconds .* the string "x"/)
        expect(readNumericDate(NaN).error).toBeDefined()
        expect(readNumericDate(1e20)).toMatchObject({ error: 'is outside the range of valid dates' })
    })

    it('evaluateTimes decides expired, not-yet-valid, valid, no-exp, invalid', () => {
        const s = NOW / 1000
        expect(evaluateTimes({ exp: s - 10 }, NOW).status).toBe('expired')
        expect(evaluateTimes({ exp: s }, NOW).status).toBe('expired') // exp is exclusive: exp <= now
        expect(evaluateTimes({ exp: s + 10 }, NOW).status).toBe('valid')
        expect(evaluateTimes({ nbf: s + 10, exp: s + 100 }, NOW).status).toBe('not-yet-valid')
        expect(evaluateTimes({ nbf: s - 10 }, NOW).status).toBe('no-exp')
        expect(evaluateTimes({}, NOW).status).toBe('no-exp')
        expect(evaluateTimes({ exp: 'soon' }, NOW).status).toBe('invalid')
        expect(evaluateTimes(null, NOW).status).toBe('n/a')
        expect(evaluateTimes([1], NOW).status).toBe('n/a')
    })

    it('flags an iat more than 60 seconds in the future', () => {
        const s = NOW / 1000
        expect(evaluateTimes({ iat: s + 61 }, NOW).issuedInFuture).toBe(true)
        expect(evaluateTimes({ iat: s + 60 }, NOW).issuedInFuture).toBe(false)
        expect(evaluateTimes({ iat: s - 5 }, NOW).issuedInFuture).toBe(false)
    })

    it('describeValidity words each status with a tone', () => {
        const s = NOW / 1000
        expect(describeValidity(evaluateTimes({ exp: s - 7200 }, NOW))).toEqual({ tone: 'danger', text: 'Expired 2 h ago' })
        expect(describeValidity(evaluateTimes({ exp: s + 300 }, NOW))).toEqual({ tone: 'success', text: 'Not expired: expires in 5 min' })
        expect(describeValidity(evaluateTimes({ nbf: s + 86400 * 3 }, NOW))).toEqual({ tone: 'warning', text: 'Not valid yet: starts in 3 days' })
        expect(describeValidity(evaluateTimes({}, NOW))).toEqual({ tone: 'neutral', text: 'No expiry (no “exp” claim)' })
        expect(describeValidity(evaluateTimes({ nbf: 'x' }, NOW)).text).toMatch(/^Invalid “nbf”: must be a number/)
        expect(describeValidity(evaluateTimes(null, NOW))).toBeNull()
    })

    it('lists the registered claims', () => {
        expect(Object.keys(REGISTERED_CLAIMS)).toEqual(['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'])
    })
})

describe('verifyToken: HMAC', () => {
    it('verifies the jwt.io token with its secret', async () => {
        expect(await verify(SAMPLE_JWT, { secret: 'your-256-bit-secret' })).toMatchObject({ status: 'valid', keyLabel: 'Secret', notes: ['This secret has 152 bits; HS256 keys should have at least 256 (RFC 7518 §3.2).'] })
    })

    it('rejects a wrong secret and a tampered payload', async () => {
        const wrong = await verify(SAMPLE_JWT, { secret: 'your-256-bit-secreT' })
        expect(wrong).toMatchObject({ status: 'invalid', message: 'The signature doesn’t match this secret.' })
        const [h, , s] = SAMPLE_JWT.split('.')
        const tampered = `${h}.${b64u({ sub: '1234567890', name: 'Jane Doe', iat: 1516239022 })}.${s}`
        expect((await verify(tampered, { secret: 'your-256-bit-secret' })).status).toBe('invalid')
    })

    it('verifies HS384 and HS512 tokens built with node:crypto, and warns about short secrets', async () => {
        for (const [alg, hash, bits] of [['HS384', 'sha384', 384], ['HS512', 'sha512', 512]]) {
            const secret = 'short-secret'
            const token = makeToken({ alg, typ: 'JWT' }, { a: 1 }, (input) => createHmac(hash, secret).update(input).digest())
            const result = await verify(token, { secret })
            expect(result.status, alg).toBe('valid')
            expect(result.notes[0]).toMatch(new RegExp(`${secret.length * 8} bits; ${alg} keys should have at least ${bits}`))
        }
    })

    it('reads the secret as hex or Base64 when asked', async () => {
        const key = Buffer.from('0123456789abcdef0123456789abcdef')
        const token = makeToken({ alg: 'HS256' }, { a: 1 }, (input) => createHmac('sha256', key).update(input).digest())
        expect((await verify(token, { secret: key.toString('hex'), secretEncoding: 'hex' })).status).toBe('valid')
        expect((await verify(token, { secret: key.toString('base64'), secretEncoding: 'base64' })).status).toBe('valid')
        expect(await verify(token, { secret: 'zz', secretEncoding: 'hex' })).toMatchObject({ status: 'error', step: 'secret' })
    })

    it('stays idle with no secret and errors on an empty decoded secret', async () => {
        expect(await verify(SAMPLE_JWT, { secret: '' })).toEqual({ status: 'idle' })
        expect(await verify(SAMPLE_JWT, { secret: '', secretEncoding: 'hex' })).toEqual({ status: 'idle' })
        expect(await verify(SAMPLE_JWT, { secret: '  ', secretEncoding: 'hex' })).toMatchObject({ status: 'error', step: 'secret' })
    })

    it('handles tokens that cannot be verified', async () => {
        expect(await verifyToken({ token: '', decoded: null })).toEqual({ status: 'idle' })
        expect(await verify(`${unsigned({ alg: 'none' }, {})}.`)).toEqual({ status: 'unsecured' })
        expect(await verify(`${unsigned({ alg: 'ES256K' }, {})}.x`, { secret: 's' })).toMatchObject({ status: 'error', step: 'header', message: expect.stringMatching(/secp256k1/) })
        expect(await verify(`${unsigned({ alg: 'XYZ' }, {})}.x`)).toMatchObject({ status: 'error', message: 'Unsupported algorithm “XYZ”.' })
        expect(await verify(`${unsigned({ typ: 'JWT' }, {})}.x`)).toMatchObject({ status: 'error', step: 'header' })
        expect(await verify(`${b64u('nope')}.${b64u({})}.x`)).toMatchObject({ status: 'error', step: 'header' })
    })

    it('refuses to verify an HS256 token as a different algorithm (algorithm pinned to the header)', async () => {
        // an "alg: none" style downgrade is reported as unsecured, never as valid
        const none = `${unsigned({ alg: 'none' }, { sub: 'x' })}.`
        expect((await verify(none, { secret: 'your-256-bit-secret' })).status).toBe('unsecured')
    })
})

describe('verifyToken: asymmetric keys', () => {
    let rsa
    let ec
    let ed
    beforeAll(() => {
        rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
        ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
        ed = generateKeyPairSync('ed25519')
    })
    const pub = (key, type = 'spki') => key.export({ type, format: 'pem' })

    const rs256 = () => makeToken({ alg: 'RS256', typ: 'JWT', kid: 'k1' }, { a: 1 }, (input) => sign('sha256', input, rsa.privateKey))
    const es256 = () => makeToken({ alg: 'ES256' }, { a: 1 }, (input) => sign('sha256', input, { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }))
    const eddsa = () => makeToken({ alg: 'EdDSA' }, { a: 1 }, (input) => sign(null, input, ed.privateKey))

    it('verifies RS256 with an SPKI PEM, a PKCS#1 PEM, a private key and a JWK', async () => {
        const token = rs256()
        expect(await verify(token, { keyText: pub(rsa.publicKey) })).toMatchObject({ status: 'valid', keyLabel: 'Public key' })
        expect(await verify(token, { keyText: pub(rsa.publicKey, 'pkcs1') })).toMatchObject({ status: 'valid', keyLabel: 'RSA public key (PKCS#1)' })
        const fromPrivate = await verify(token, { keyText: pub(rsa.privateKey, 'pkcs8') })
        expect(fromPrivate).toMatchObject({ status: 'valid', keyLabel: 'Public half of the private key' })
        expect(fromPrivate.notes[0]).toMatch(/pasted a private key/)
        expect(await verify(token, { keyText: pub(rsa.privateKey, 'pkcs1') })).toMatchObject({ status: 'valid' })
        const jwk = JSON.stringify(rsa.publicKey.export({ format: 'jwk' }))
        expect(await verify(token, { keyText: jwk })).toMatchObject({ status: 'valid', keyLabel: 'JWK' })
    })

    it('verifies with a bare Base64 SPKI body', async () => {
        const body = pub(rsa.publicKey).replace(/-----[A-Z ]+-----|\s/g, '')
        const result = await verify(rs256(), { keyText: body })
        expect(result).toMatchObject({ status: 'valid' })
        expect(result.notes[0]).toMatch(/without its BEGIN\/END lines/)
    })

    it('verifies ES256 and EdDSA tokens', async () => {
        expect((await verify(es256(), { keyText: pub(ec.publicKey) })).status).toBe('valid')
        expect((await verify(eddsa(), { keyText: pub(ed.publicKey) })).status).toBe('valid')
        expect((await verify(eddsa(), { keyText: JSON.stringify(ed.publicKey.export({ format: 'jwk' })) })).status).toBe('valid')
    })

    it('reports a signature mismatch with another key of the right type', async () => {
        const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
        expect(await verify(rs256(), { keyText: pub(other.publicKey) })).toMatchObject({ status: 'invalid', message: 'The signature doesn’t match this key.' })
    })

    it('explains key / algorithm mismatches', async () => {
        expect(await verify(rs256(), { keyText: pub(ec.publicKey) })).toMatchObject({ status: 'error', step: 'key', message: 'This is an EC P-256 key, but RS256 needs an RSA key.' })
        expect(await verify(es256(), { keyText: pub(rsa.publicKey) })).toMatchObject({ status: 'error', step: 'key', message: 'This is an RSA key, but ES256 needs an EC P-256 key.' })
        expect((await verify(rs256(), { keyText: JSON.stringify({ ...rsa.publicKey.export({ format: 'jwk' }), alg: 'RS512' }) })).message).toBe('This JWK is for RS512, but the token is signed with RS256.')
        expect((await verify(es256(), { keyText: JSON.stringify(rsa.publicKey.export({ format: 'jwk' })) })).message).toMatch(/ES256 needs an EC P-256 key, but this JWK has "kty": "RSA"/)
    })

    it('selects a JWKS key by kid, tries all fitting keys without one, and explains misses', async () => {
        const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
        const jwks = JSON.stringify({ keys: [{ ...other.publicKey.export({ format: 'jwk' }), kid: 'k0' }, { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'k1' }, ec.publicKey.export({ format: 'jwk' })] })
        const result = await verify(rs256(), { keyText: jwks })
        expect(result).toMatchObject({ status: 'valid', keyLabel: 'JWKS key "k1"' })

        const noKid = makeToken({ alg: 'RS256' }, { a: 1 }, (input) => sign('sha256', input, rsa.privateKey))
        const tried = await verify(noKid, { keyText: jwks })
        expect(tried.status).toBe('valid')
        expect(tried.notes[0]).toMatch(/no “kid”, so each of the 2 matching keys was tried/)

        const missing = makeToken({ alg: 'RS256', kid: 'nope' }, {}, (input) => sign('sha256', input, rsa.privateKey))
        expect((await verify(missing, { keyText: jwks })).message).toBe('The JWKS has no key with kid "nope" (it has "k0", "k1").')
        expect((await verify(es256(), { keyText: JSON.stringify({ keys: [rsa.publicKey.export({ format: 'jwk' })] }) })).message).toBe('None of the 1 keys in this JWKS can verify ES256.')
    })

    it('errors for unusable key text', async () => {
        expect((await verify(rs256(), { keyText: 'hello' })).message).toMatch(/Paste a PEM public key/)
        expect((await verify(rs256(), { keyText: '{"a":' })).message).toMatch(/looks like JSON but doesn’t parse/)
        expect((await verify(rs256(), { keyText: '{"a":1}' })).message).toBe('JSON keys must be a JWK (with "kty") or a JWKS (with "keys").')
        expect((await verify(rs256(), { keyText: '-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----' })).message).toMatch(/SEC1/)
        expect((await verify(rs256(), { keyText: '-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----' })).message).toMatch(/Encrypted private keys/)
        expect((await verify(rs256(), { keyText: '-----BEGIN DH PARAMETERS-----\nAAAA\n-----END DH PARAMETERS-----' })).message).toBe('Unsupported PEM type “DH PARAMETERS”. Paste a public key, certificate, JWK or JWKS.')
        expect(await verify(rs256(), { keyText: '  ' })).toEqual({ status: 'idle' })
    })

    it('notes extra PEM blocks and private JWKs', async () => {
        const two = `${pub(rsa.publicKey)}\n${pub(ec.publicKey)}`
        expect((await verify(rs256(), { keyText: two })).notes[0]).toMatch(/Only the first PEM block \(PUBLIC KEY\) was used/)
        const privateJwk = JSON.stringify(rsa.privateKey.export({ format: 'jwk' }))
        const r = await verify(rs256(), { keyText: privateJwk })
        expect(r.status).toBe('valid')
        expect(r.notes[0]).toMatch(/private key; only its public part was used/)
    })

    it('rejects RSA keys under 2048 bits with an explanation', async () => {
        const small = generateKeyPairSync('rsa', { modulusLength: 1024 })
        const token = makeToken({ alg: 'RS256' }, {}, (input) => sign('sha256', input, small.privateKey))
        const r = await verify(token, { keyText: pub(small.publicKey) })
        expect(r.status).toBe('error')
        expect(r.message).toMatch(/2048/)
    })

    it('importVerificationKeys returns labelled candidates', async () => {
        const { candidates, notes } = await importVerificationKeys(pub(rsa.publicKey), 'RS256')
        expect(candidates).toHaveLength(1)
        expect(candidates[0].label).toBe('Public key')
        expect(notes).toEqual([])
    })
})
