// Building and signing JWTs for the JWT Builder: header and payload checks,
// signing keys (HMAC secrets, PEM or JWK private keys), key-pair generation
// and the public key that verifies the result. Signing uses jose.
//
// Nothing here stores keys, secrets or tokens.
import * as jose from 'jose'
import { bytesToBase64Url, bytesToHex, concatBytes, decodeSecret, utf8Encode } from './encoding.js'
import { findPemBlocks, keyAlgorithm, pemEncode, pkcs1ToPkcs8 } from './pem.js'
import { algFamily, describeType, readNumericDate } from './jwt.js'

export const ALGORITHM_GROUPS = [
    { label: 'HMAC with a shared secret', algs: ['HS256', 'HS384', 'HS512'] },
    { label: 'RSA, PKCS#1 v1.5 padding', algs: ['RS256', 'RS384', 'RS512'] },
    { label: 'RSA-PSS', algs: ['PS256', 'PS384', 'PS512'] },
    { label: 'ECDSA', algs: ['ES256', 'ES384', 'ES512'] },
    { label: 'EdDSA', algs: ['EdDSA'] },
]

export const ALGORITHMS = ALGORITHM_GROUPS.flatMap(group => group.algs)
export const DEFAULT_ALG = 'HS256'

export const ALG_DESCRIPTIONS = {
    HS256: 'HMAC with SHA-256',
    HS384: 'HMAC with SHA-384',
    HS512: 'HMAC with SHA-512',
    RS256: 'RSA PKCS#1 v1.5 with SHA-256',
    RS384: 'RSA PKCS#1 v1.5 with SHA-384',
    RS512: 'RSA PKCS#1 v1.5 with SHA-512',
    PS256: 'RSA-PSS with SHA-256',
    PS384: 'RSA-PSS with SHA-384',
    PS512: 'RSA-PSS with SHA-512',
    ES256: 'ECDSA on P-256 with SHA-256',
    ES384: 'ECDSA on P-384 with SHA-384',
    ES512: 'ECDSA on P-521 with SHA-512',
    EdDSA: 'Ed25519 signatures',
}

export const isSupportedAlg = (alg) => typeof alg === 'string' && ALGORITHMS.includes(alg)

// RFC 7518 §3.2: an HMAC key must be at least as long as the hash output.
export const HMAC_MIN_BITS = { HS256: 256, HS384: 384, HS512: 512 }
// RFC 7518 §3.3 / §3.5: RSA keys of 2048 bits or more.
export const MIN_RSA_BITS = 2048

const CURVES = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' }

/** The key an algorithm needs: { kty, crv?, label } (null for HMAC). */
export function expectedKey(alg) {
    switch (algFamily(alg)) {
        case 'rsa':
            return { kty: 'RSA', label: 'an RSA key' }
        case 'ec':
            return { kty: 'EC', crv: CURVES[alg], label: `an EC ${CURVES[alg]} key` }
        case 'okp':
            return { kty: 'OKP', crv: 'Ed25519', label: 'an Ed25519 key' }
        default:
            return null
    }
}

// ---- header and payload ----
export const stringifyJson = (value) => JSON.stringify(value, null, 2)

/** Parses text that must hold a JSON object: { value } or { error }. */
export function parseJsonObject(text, name) {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return { error: `The ${name} is empty: enter a JSON object such as {}.` }
    let value
    try {
        value = JSON.parse(trimmed)
    } catch (error) {
        return { error: `The ${name} isn’t valid JSON: ${error.message}` }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { error: `The ${name} must be a JSON object, not ${describeType(value)}.` }
    }
    return { value }
}

/** The default header for an algorithm, as editor text. */
export const defaultHeaderText = (alg) => stringifyJson({ alg, typ: 'JWT' })

/**
 * Sets "alg" in the header text (keeping its position) and adds "typ": "JWT"
 * when there's no "typ". Returns null when the text isn't a JSON object.
 */
export function syncHeaderAlg(headerText, alg) {
    const parsed = parseJsonObject(headerText, 'header')
    if (parsed.error) return null
    const header = Object.hasOwn(parsed.value, 'alg') ? { ...parsed.value, alg } : { alg, ...parsed.value }
    if (!Object.hasOwn(header, 'typ')) header.typ = 'JWT'
    return stringifyJson(header)
}

/** A supported "alg" written in the header text, or null. */
export function headerAlgOf(headerText) {
    const parsed = parseJsonObject(headerText, 'header')
    return parsed.value && isSupportedAlg(parsed.value.alg) ? parsed.value.alg : null
}

/**
 * Checks a parsed header against the selected algorithm. `fixable` means
 * setting "alg" to the selected algorithm resolves it.
 * @returns {{ error?: string, fixable?: boolean }}
 */
export function checkHeader(header, alg) {
    if (!Object.hasOwn(header, 'alg')) return { error: `The header needs an "alg": "${alg}".`, fixable: true }
    if (header.alg !== alg) {
        if (typeof header.alg !== 'string') return { error: `"alg" must be a string, such as "${alg}".`, fixable: true }
        if (header.alg.toLowerCase() === 'none') return { error: 'Unsigned tokens ("alg": "none") aren’t made here: anyone could forge them. Choose a signing algorithm.', fixable: true }
        if (!isSupportedAlg(header.alg)) return { error: `“${header.alg}” isn’t supported. Use one of ${ALGORITHMS.join(', ')}.`, fixable: true }
        return { error: `The header says "${header.alg}", but ${alg} is selected.`, fixable: true }
    }
    if (header.b64 === false) return { error: 'Unencoded payloads ("b64": false) aren’t allowed in JWTs (RFC 7797 §7). Remove "b64".' }
    return {}
}

/** Sets claims in the payload text; `undefined` removes a claim. Throws when the payload isn't a JSON object. */
export function setClaims(payloadText, patch) {
    const parsed = parseJsonObject(payloadText, 'payload')
    if (parsed.error) throw new Error(parsed.error)
    const next = { ...parsed.value }
    for (const [name, value] of Object.entries(patch)) {
        if (value === undefined) delete next[name]
        else next[name] = value
    }
    return stringifyJson(next)
}

export const DATE_CLAIMS = ['iat', 'nbf', 'exp']

/** Non-blocking problems with registered claims, as readable sentences. */
export function claimWarnings(payload) {
    const warnings = []
    for (const name of DATE_CLAIMS) {
        if (payload[name] === undefined) continue
        const parsed = readNumericDate(payload[name])
        if (typeof payload[name] !== 'number') warnings.push(`"${name}" should be a NumericDate: a number of seconds since 1970, such as ${Math.floor(Date.UTC(2030, 0, 1) / 1000)}.`)
        else if (parsed.error) warnings.push(`"${name}" ${parsed.error}.`)
        else if (payload[name] > 1e11) warnings.push(`"${name}" looks like milliseconds; JWT dates are in seconds (divide by 1000).`)
    }
    if (typeof payload.exp === 'number' && typeof payload.nbf === 'number' && payload.exp <= payload.nbf) warnings.push('"exp" is not after "nbf", so the token is never valid.')
    if (typeof payload.exp === 'number' && typeof payload.iat === 'number' && payload.exp <= payload.iat) warnings.push('"exp" is not after "iat", so the token is expired as soon as it’s issued.')
    for (const name of ['iss', 'sub']) {
        if (payload[name] !== undefined && typeof payload[name] !== 'string') warnings.push(`"${name}" should be a string (RFC 7519 §4.1).`)
    }
    if (payload.aud !== undefined && typeof payload.aud !== 'string' && !(Array.isArray(payload.aud) && payload.aud.every(a => typeof a === 'string'))) {
        warnings.push('"aud" should be a string or an array of strings (RFC 7519 §4.1.3).')
    }
    if (payload.jti !== undefined && typeof payload.jti !== 'string') warnings.push('"jti" should be a string (RFC 7519 §4.1.7).')
    return warnings
}

/**
 * Parses and checks both editors.
 * @returns {{ header?: object, payload?: object, headerError?: string, headerFixable?: boolean, payloadError?: string, warnings: string[] }}
 */
export function prepareToken({ alg, headerText, payloadText }) {
    const header = parseJsonObject(headerText, 'header')
    const payload = parseJsonObject(payloadText, 'payload')
    const out = { warnings: [] }
    if (header.error) out.headerError = header.error
    else {
        const check = checkHeader(header.value, alg)
        if (check.error) {
            out.headerError = check.error
            out.headerFixable = !!check.fixable
        } else out.header = header.value
    }
    if (payload.error) out.payloadError = payload.error
    else {
        out.payload = payload.value
        out.warnings = claimWarnings(payload.value)
    }
    return out
}

/** The Base64url segment of a JSON value, exactly as it's signed. */
export const encodeSegment = (value) => bytesToBase64Url(utf8Encode(JSON.stringify(value)))

// ---- HMAC secrets ----
/** Bytes of a secret typed as text (UTF-8) or Base64/Base64url: { bytes } or { error }. */
export function readSecret(secret, base64) {
    let bytes
    try {
        bytes = decodeSecret(String(secret ?? ''), base64 ? 'base64' : 'text')
    } catch (error) {
        return { error: `The secret isn’t valid Base64 or Base64url: ${error.message}. To use it as plain text, untick the Base64 option.` }
    }
    if (!bytes.length) return { error: 'The secret is empty.' }
    return { bytes }
}

/** RFC 7518 §3.2 length warning, or null when the secret is long enough. */
export function secretWarning(bytes, alg) {
    const need = HMAC_MIN_BITS[alg]
    const have = bytes.length * 8
    if (!need || have >= need) return null
    return `This secret is ${have} bits; ${alg} needs at least ${need} bits (${need / 8} bytes) under RFC 7518 §3.2, and many libraries reject shorter secrets.`
}

/** A random secret of the algorithm's hash size, as Base64url. */
export function randomSecret(alg) {
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array((HMAC_MIN_BITS[alg] || 256) / 8)))
}

// ---- private keys ----
/** A key that can't be used, with a message for the user. */
export class SigningKeyError extends Error {
    constructor(message, options) {
        super(message, options)
        this.name = 'SigningKeyError'
    }
}

// Minimal DER for the SEC1 → PKCS#8 conversion
function readTlv(bytes, pos) {
    const tag = bytes[pos]
    let len = bytes[pos + 1]
    let start = pos + 2
    if (tag === undefined || len === undefined) throw new Error('truncated DER')
    if (len & 0x80) {
        const n = len & 0x7f
        if (n === 0 || n > 3) throw new Error('unsupported DER length')
        len = 0
        for (let i = 0; i < n; i++) len = len * 256 + bytes[start + i]
        start += n
    }
    const end = start + len
    if (end > bytes.length) throw new Error('truncated DER')
    return { tag, start, end }
}

function encodeLength(len) {
    if (len < 0x80) return Uint8Array.of(len)
    const out = []
    for (let n = len; n > 0; n = Math.floor(n / 256)) out.unshift(n & 0xff)
    return Uint8Array.of(0x80 | out.length, ...out)
}

const tlv = (tag, content) => concatBytes(Uint8Array.of(tag), encodeLength(content.length), content)

const EC_PUBLIC_KEY_OID = Uint8Array.of(0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01) // 1.2.840.10045.2.1
const CURVE_OIDS = {
    'P-256': Uint8Array.of(0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07),
    'P-384': Uint8Array.of(0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22),
    'P-521': Uint8Array.of(0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x23),
}

/**
 * Wraps a SEC1 ECPrivateKey (RFC 5915, "BEGIN EC PRIVATE KEY") in a PKCS#8
 * PrivateKeyInfo (RFC 5208), taking the curve from the key's parameters, or
 * `fallbackCurve` when it has none. Throws an Error when the DER isn't SEC1.
 */
export function sec1ToPkcs8(der, fallbackCurve) {
    const seq = readTlv(der, 0)
    if (seq.tag !== 0x30) throw new Error('not a SEC1 EC key')
    const version = readTlv(der, seq.start)
    if (version.tag !== 0x02 || version.end - version.start !== 1 || der[version.start] !== 1) throw new Error('not a SEC1 version 1 EC key')
    const privateKey = readTlv(der, version.end)
    if (privateKey.tag !== 0x04) throw new Error('not a SEC1 EC key')
    let curveOid = null
    for (let pos = privateKey.end; pos < seq.end;) {
        const field = readTlv(der, pos)
        if (field.tag === 0xa0) {
            const inner = readTlv(der, field.start)
            if (inner.tag !== 0x06) throw new Error('the key uses explicit curve parameters instead of a named curve')
            curveOid = der.slice(field.start, inner.end)
        }
        pos = field.end
    }
    if (!curveOid) {
        curveOid = CURVE_OIDS[fallbackCurve]
        if (!curveOid) throw new Error('the key doesn’t name its curve')
    }
    const algorithm = tlv(0x30, concatBytes(EC_PUBLIC_KEY_OID, curveOid))
    return tlv(0x30, concatBytes(Uint8Array.of(0x02, 0x01, 0x00), algorithm, tlv(0x04, der.slice(0, seq.end))))
}

function describeDerKey(info) {
    if (info.type === 'EC') return `an EC ${info.curve} key`
    if (info.type === 'RSA') return 'an RSA key'
    if (info.type === 'RSA-PSS') return 'an RSA-PSS key'
    if (info.type === 'unknown') return 'a key of an unknown type'
    return `an ${info.type} key`
}

function checkDerFits(info, alg) {
    const want = expectedKey(alg)
    if (info.type === 'unknown') throw new SigningKeyError('This doesn’t look like a PKCS#8 private key, or its key type isn’t supported.')
    const fits = want.kty === 'RSA'
        ? info.type === 'RSA'
        : want.kty === 'EC'
            ? info.type === 'EC' && info.curve === want.crv
            : info.type === 'Ed25519'
    if (fits) return
    if (info.type === 'RSA-PSS' && want.kty === 'RSA') {
        throw new SigningKeyError('This key is restricted to RSA-PSS (OID id-RSASSA-PSS), which browsers can’t import. Use a standard RSA key: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out key.pem')
    }
    throw new SigningKeyError(`This is ${describeDerKey(info)}, but ${alg} needs ${want.label}.`)
}

async function importPkcs8Der(der, alg) {
    checkDerFits(keyAlgorithm(der, { pkcs8: true }), alg)
    try {
        return await jose.importPKCS8(pemEncode('PRIVATE KEY', der), alg, { extractable: true })
    } catch (error) {
        throw new SigningKeyError(`The private key couldn’t be imported: ${error.message}`, { cause: error })
    }
}

const JWK_PRIVATE_MEMBERS = {
    RSA: ['kty', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'],
    EC: ['kty', 'crv', 'x', 'y', 'd'],
    OKP: ['kty', 'crv', 'x', 'd'],
}

async function importPrivateJwk(jwk, alg, notes) {
    const want = expectedKey(alg)
    if (jwk.kty === 'oct') {
        throw new SigningKeyError(`This is a symmetric (“oct”) key. ${alg} needs ${want.label}; to sign with this key, choose HS256, HS384 or HS512 and use its "k" value as a Base64url secret.`)
    }
    if (jwk.kty !== want.kty) throw new SigningKeyError(`This JWK has "kty": ${JSON.stringify(jwk.kty)}, but ${alg} needs ${want.label}.`)
    if (want.crv && jwk.crv !== want.crv) throw new SigningKeyError(`This JWK is on curve ${JSON.stringify(jwk.crv)}, but ${alg} needs ${want.crv}.`)
    if (jwk.alg !== undefined && jwk.alg !== alg) throw new SigningKeyError(`This JWK is for ${JSON.stringify(jwk.alg)} (its "alg"), but ${alg} is selected.`)
    if (typeof jwk.d !== 'string') throw new SigningKeyError('This JWK is a public key (it has no "d"). Signing needs the private key.')
    const members = JWK_PRIVATE_MEMBERS[jwk.kty]
    const missing = members.filter(name => typeof jwk[name] !== 'string')
    if (missing.length) {
        throw new SigningKeyError(jwk.kty === 'RSA' && missing.every(m => ['p', 'q', 'dp', 'dq', 'qi'].includes(m))
            ? `This RSA JWK has "d" but not ${missing.map(m => `"${m}"`).join(', ')}; browsers need all of the private key members.`
            : `This JWK is missing ${missing.map(m => `"${m}"`).join(', ')}.`)
    }
    if (jwk.use !== undefined && jwk.use !== 'sig') notes.push(`This JWK is marked "use": ${JSON.stringify(jwk.use)}, not "sig"; it was used for signing anyway.`)
    if (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('sign')) notes.push(`This JWK’s "key_ops" don’t include "sign"; it was used for signing anyway.`)
    // Only the key material: "use", "key_ops" and "ext" can make WebCrypto refuse to sign
    const material = Object.fromEntries(members.map(name => [name, jwk[name]]))
    try {
        return await jose.importJWK(material, alg, { extractable: true })
    } catch (error) {
        throw new SigningKeyError(`The JWK couldn’t be imported: ${error.message}`, { cause: error })
    }
}

const PRIVATE_LABELS = ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'OPENSSH PRIVATE KEY']
const DECRYPT_HINT = 'Decrypt it first: openssl pkey -in encrypted.pem -out key.pem'

/** "RSA 2048-bit", "EC P-256" or "Ed25519" for an imported key. */
export function describeCryptoKey(key) {
    const algorithm = key?.algorithm || {}
    if (algorithm.modulusLength) return `RSA ${algorithm.modulusLength}-bit`
    if (algorithm.namedCurve) return `EC ${algorithm.namedCurve}`
    return algorithm.name || 'Key'
}

/**
 * The public half of a private CryptoKey: SPKI PEM and a JWK with "use",
 * "alg" and an RFC 7638 thumbprint as "kid".
 */
export async function publicKeyOf(privateKey, alg) {
    const jwk = await jose.exportJWK(privateKey)
    const material = jwk.kty === 'RSA'
        ? { kty: 'RSA', n: jwk.n, e: jwk.e }
        : jwk.kty === 'EC'
            ? { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }
            : { kty: 'OKP', crv: jwk.crv, x: jwk.x }
    const kid = await jose.calculateJwkThumbprint(material, 'sha256')
    const publicKey = await jose.importJWK(material, alg, { extractable: true })
    const pem = await jose.exportSPKI(publicKey)
    return { pem, jwk: { ...material, use: 'sig', alg, kid }, kid }
}

/**
 * Reads the private key the user pasted for an asymmetric algorithm: PKCS#8
 * PEM, PKCS#1 ("RSA PRIVATE KEY") or SEC1 ("EC PRIVATE KEY") PEM, which are
 * converted to PKCS#8, or a private JWK. Checks it fits the algorithm.
 * @returns {Promise<{ key: CryptoKey, description: string, notes: string[], publicPem: string, publicJwk: object, kid: string }>}
 * @throws {SigningKeyError}
 */
export async function importSigningKey(keyText, alg) {
    const want = expectedKey(alg)
    if (!want) throw new SigningKeyError(`${alg} signs with a secret, not a private key.`)
    const text = String(keyText ?? '').trim()
    if (!text) throw new SigningKeyError('Paste a private key, or generate a key pair.')
    const notes = []
    let key

    if (text.startsWith('{') || text.startsWith('[')) {
        let json
        try {
            json = JSON.parse(text)
        } catch (error) {
            throw new SigningKeyError(`The key looks like JSON but doesn’t parse: ${error.message}`, { cause: error })
        }
        if (json && Array.isArray(json.keys)) throw new SigningKeyError('This is a JWK Set. Paste only the private key to sign with: a single {"kty": …} object.')
        if (!json || typeof json !== 'object' || Array.isArray(json) || json.kty === undefined) throw new SigningKeyError('A JSON key must be a JWK: an object with "kty".')
        key = await importPrivateJwk(json, alg, notes)
    } else {
        if (/Proc-Type:\s*4\s*,\s*ENCRYPTED/i.test(text)) throw new SigningKeyError(`This key is protected by a passphrase. ${DECRYPT_HINT}`)
        let blocks
        try {
            blocks = findPemBlocks(text)
        } catch (error) {
            throw new SigningKeyError(`The PEM block isn’t valid Base64: ${error.message}`, { cause: error })
        }
        if (!blocks.length) throw new SigningKeyError('Paste a PEM private key (-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----) or a private JWK.')
        const block = blocks.find(b => PRIVATE_LABELS.includes(b.label)) || blocks[0]
        switch (block.label) {
            case 'PRIVATE KEY':
                key = await importPkcs8Der(block.der, alg)
                break
            case 'RSA PRIVATE KEY':
                if (want.kty !== 'RSA') throw new SigningKeyError(`This is an RSA key, but ${alg} needs ${want.label}.`)
                key = await importPkcs8Der(pkcs1ToPkcs8(block.der), alg)
                notes.push('Converted from PKCS#1 (“BEGIN RSA PRIVATE KEY”) to PKCS#8.')
                break
            case 'EC PRIVATE KEY': {
                if (want.kty !== 'EC') throw new SigningKeyError(`This is an EC key, but ${alg} needs ${want.label}.`)
                let der
                try {
                    der = sec1ToPkcs8(block.der, want.crv)
                } catch (error) {
                    throw new SigningKeyError(`This SEC1 key couldn’t be converted (${error.message}). Convert it to PKCS#8 with: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem`, { cause: error })
                }
                key = await importPkcs8Der(der, alg)
                notes.push('Converted from SEC1 (“BEGIN EC PRIVATE KEY”) to PKCS#8.')
                break
            }
            case 'ENCRYPTED PRIVATE KEY':
                throw new SigningKeyError(`Encrypted private keys aren’t supported. ${DECRYPT_HINT}`)
            case 'OPENSSH PRIVATE KEY':
                throw new SigningKeyError('OpenSSH private keys aren’t supported. Paste a PKCS#8 PEM (-----BEGIN PRIVATE KEY-----) or a private JWK.')
            case 'PUBLIC KEY':
            case 'RSA PUBLIC KEY':
                throw new SigningKeyError('This is a public key. Signing needs the private key; the public key is what verifiers use.')
            case 'CERTIFICATE':
                throw new SigningKeyError('This is a certificate, which only holds a public key. Signing needs the private key.')
            default:
                throw new SigningKeyError(`Unsupported PEM type “${block.label}”. Paste a private key (-----BEGIN PRIVATE KEY-----) or a private JWK.`)
        }
        if (blocks.length > 1) notes.push(`Used the “${block.label}” block and ignored the other ${blocks.length - 1}.`)
    }

    const bits = key.algorithm?.modulusLength
    if (bits && bits < MIN_RSA_BITS) {
        throw new SigningKeyError(`${alg} needs an RSA key of at least ${MIN_RSA_BITS} bits (RFC 7518 §3.3), and this one has ${bits}. Generate a new key pair.`)
    }
    const pub = await publicKeyOf(key, alg)
    return { key, description: describeCryptoKey(key), notes, publicPem: pub.pem, publicJwk: pub.jwk, kid: pub.kid }
}

/** A fresh key pair for an asymmetric algorithm; returns the private key as PKCS#8 PEM. */
export async function generateKeyPairPem(alg) {
    if (!expectedKey(alg)) throw new Error(`${alg} uses a shared secret, not a key pair.`)
    const options = { extractable: true }
    if (algFamily(alg) === 'rsa') options.modulusLength = MIN_RSA_BITS
    let pair
    try {
        pair = await jose.generateKeyPair(alg, options)
    } catch (error) {
        throw new Error(error?.code === 'ERR_JOSE_NOT_SUPPORTED' ? `${alg} keys can’t be generated in this browser: ${error.message}` : error?.message || String(error), { cause: error })
    }
    return jose.exportPKCS8(pair.privateKey)
}

// ---- signing ----
function explainSignError(error, alg) {
    const message = error?.message || String(error)
    if (/modulusLength to be 2048/.test(message)) return `${alg} needs an RSA key of at least 2048 bits.`
    if (/Extension Header Parameter/.test(message)) return `${message}. "crit" may only list extensions the signer understands; remove "crit" or the unknown names.`
    if (error?.code === 'ERR_JOSE_NOT_SUPPORTED') return `${alg} isn’t supported here: ${message}`
    return message
}

/**
 * Signs header + payload (compact JWS). The segments are the compact JSON of
 * the parsed objects, in their original key order.
 * @param {{ header: object, payload: object, key: CryptoKey | Uint8Array }} input
 */
export async function signToken({ header, payload, key }) {
    try {
        return await new jose.CompactSign(utf8Encode(JSON.stringify(payload))).setProtectedHeader(header).sign(key)
    } catch (error) {
        throw new Error(explainSignError(error, header?.alg), { cause: error })
    }
}

// ---- helpers for the editors ----
/** RFC 4122 version 4 UUID (for "jti"). */
export function randomUuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const hex = bytesToHex(b)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
