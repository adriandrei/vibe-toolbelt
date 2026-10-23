// JWT decoding and verification for the JWT page.
//
// Verification checks the signature on its own (jose.compactVerify); the
// time claims are evaluated separately, so an expired but correctly signed
// token reads "Signature valid · expired 2 h ago", not "Invalid signature".
import * as jose from 'jose'
import { base64ToBytes, base64UrlToBytes, decodeSecret, utf8Decode } from './encoding.js'
import { findPemBlocks, keyAlgorithm, pemEncode, pkcs1ToPkcs8, pkcs1ToSpki } from './pem.js'
import { formatRelative } from './clock.js'

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/

export function describeType(value) {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'an array'
    if (typeof value === 'object') return 'an object'
    if (typeof value === 'string') return `the string ${JSON.stringify(value.length > 24 ? `${value.slice(0, 24)}…` : value)}`
    return `${typeof value} ${String(value)}`
}

/**
 * Cleans up a pasted token: "Bearer " / "Authorization:" prefixes, quotes and
 * any whitespace or line breaks (which would otherwise break the signature
 * check, because the signed input must match byte for byte).
 */
export function normalizeToken(raw) {
    const notes = []
    let value = String(raw ?? '').trim()
    if (/^authorization:\s*/i.test(value)) {
        value = value.replace(/^authorization:\s*/i, '')
        notes.push('Removed the “Authorization:” header name')
    }
    if (/^bearer\s+/i.test(value)) {
        value = value.replace(/^bearer\s+/i, '')
        notes.push('Removed the “Bearer” prefix')
    }
    if (value.length > 1 && /^(["'`]).*\1$/s.test(value)) {
        value = value.slice(1, -1)
        notes.push('Removed the surrounding quotes')
    }
    const compact = value.replace(/\s+/g, '')
    if (compact !== value) notes.push('Removed whitespace and line breaks inside the token')
    return { value: compact, notes }
}

function decodeJsonPart(part, name) {
    let bytes
    try {
        bytes = base64UrlToBytes(part)
    } catch (error) {
        return { error: `The ${name} isn't valid Base64url: ${error.message}` }
    }
    let text
    try {
        text = utf8Decode(bytes, { fatal: true })
    } catch {
        return { error: `The ${name} isn't UTF-8 text`, bytes }
    }
    try {
        return { json: JSON.parse(text), text, bytes }
    } catch {
        return { text, bytes, notJson: true }
    }
}

function decodeHeader(part) {
    const out = decodeJsonPart(part, 'header')
    if (out.error) return { error: out.error }
    if (out.notJson) return { error: 'The header isn’t valid JSON', text: out.text }
    const value = out.json
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { error: `The header must be a JSON object, not ${describeType(value)}`, text: out.text }
    }
    return { value, text: out.text }
}

function decodePayload(part, header) {
    const out = decodeJsonPart(part, 'payload')
    if (out.error && !out.bytes) return { type: 'error', error: out.error }
    if (out.error) return { type: 'binary', bytes: out.bytes }
    if (out.notJson) {
        const nested = header?.cty?.toString().toUpperCase() === 'JWT' || JWT_SHAPE.test(out.text)
        return { type: nested ? 'nested' : 'text', text: out.text }
    }
    const value = out.json
    if (value && typeof value === 'object' && !Array.isArray(value)) return { type: 'claims', value, text: out.text }
    return { type: 'json', value, text: out.text }
}

/**
 * Decodes a compact JWS (3 parts) or describes a JWE (5 parts).
 * Header, payload and signature are decoded independently, so one broken
 * part doesn't hide the others.
 */
export function decodeToken(token) {
    if (!token) return null
    const parts = token.split('.')
    if (parts.length === 5) {
        const header = decodeHeader(parts[0])
        if (typeof header.value?.enc === 'string') return { kind: 'jwe', parts, header }
        return { error: 'Invalid JWT format: a JWT has 3 parts separated by dots, this has 5 (and it isn’t an encrypted JWE either: there’s no “enc” in its header).' }
    }
    if (parts.length !== 3) {
        return { error: `Invalid JWT format: a JWT has 3 parts separated by dots, this has ${parts.length}.` }
    }
    const header = decodeHeader(parts[0])
    const payload = decodePayload(parts[1], header.value)
    let signature
    try {
        signature = { bytes: base64UrlToBytes(parts[2]) }
    } catch (error) {
        signature = { error: `The signature isn't valid Base64url: ${error.message}` }
    }
    const rawAlg = header.value?.alg
    const alg = typeof rawAlg === 'string' ? rawAlg : undefined
    let algError = null
    if (header.value && rawAlg === undefined) algError = 'The header has no “alg” (algorithm), so the signature can’t be checked.'
    else if (rawAlg !== undefined && typeof rawAlg !== 'string') algError = `“alg” must be a string, but it is ${describeType(rawAlg)}.`
    return { kind: 'jws', parts, header, payload, signature, alg, algError }
}

export function algFamily(alg) {
    if (!alg) return null
    if (alg === 'none') return 'none'
    if (/^HS(256|384|512)$/.test(alg)) return 'hmac'
    if (/^(RS|PS)(256|384|512)$/.test(alg)) return 'rsa'
    if (/^ES(256|384|512)$/.test(alg)) return 'ec'
    if (alg === 'EdDSA' || alg === 'Ed25519') return 'okp'
    return 'unsupported'
}

// ---- time claims ----
export function readNumericDate(value) {
    if (value === undefined) return null
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { error: `must be a number of seconds (NumericDate), but it is ${describeType(value)}` }
    }
    if (Math.abs(value * 1000) > 8.64e15) return { seconds: value, error: 'is outside the range of valid dates' }
    return { seconds: value, date: new Date(value * 1000) }
}

/**
 * Evaluates exp / nbf / iat against `nowMs` (no clock-skew tolerance).
 * status: 'expired' | 'not-yet-valid' | 'valid' | 'no-exp' | 'invalid' | 'n/a'
 */
export function evaluateTimes(claims, nowMs) {
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return { status: 'n/a' }
    const nowSec = nowMs / 1000
    const exp = readNumericDate(claims.exp)
    const nbf = readNumericDate(claims.nbf)
    const iat = readNumericDate(claims.iat)
    let status
    if (exp?.error || nbf?.error || iat?.error) status = 'invalid'
    else if (nbf && nbf.seconds > nowSec) status = 'not-yet-valid'
    else if (exp && exp.seconds <= nowSec) status = 'expired'
    else if (exp) status = 'valid'
    else status = 'no-exp'
    const issuedInFuture = !!(iat && !iat.error && iat.seconds > nowSec + 60)
    return { status, exp, nbf, iat, nowSec, issuedInFuture }
}

export function describeValidity(times) {
    const { status, exp, nbf, nowSec } = times
    switch (status) {
        case 'expired':
            return { tone: 'danger', text: `Expired ${formatRelative(exp.seconds - nowSec)}` }
        case 'not-yet-valid':
            return { tone: 'warning', text: `Not valid yet: starts ${formatRelative(nbf.seconds - nowSec)}` }
        case 'valid':
            return { tone: 'success', text: `Not expired: expires ${formatRelative(exp.seconds - nowSec)}` }
        case 'no-exp':
            return { tone: 'neutral', text: 'No expiry (no “exp” claim)' }
        case 'invalid': {
            const bad = ['exp', 'nbf', 'iat'].find(k => times[k]?.error)
            return { tone: 'danger', text: `Invalid “${bad}”: ${times[bad].error}` }
        }
        default:
            return null
    }
}

// ---- keys ----
class KeyError extends Error {}

const CURVES = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' }

function expectedKeyType(alg) {
    const family = algFamily(alg)
    if (family === 'rsa') return { kty: 'RSA', label: 'an RSA key' }
    if (family === 'ec') return { kty: 'EC', crv: CURVES[alg], label: `an EC ${CURVES[alg]} key` }
    if (family === 'okp') return { kty: 'OKP', crv: 'Ed25519', label: 'an Ed25519 key' }
    return null
}

function publicJwk(jwk, alg) {
    switch (jwk.kty) {
        case 'RSA':
            return { kty: 'RSA', n: jwk.n, e: jwk.e }
        case 'EC':
            return { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }
        case 'OKP':
            return { kty: 'OKP', crv: jwk.crv, x: jwk.x }
        default:
            throw new KeyError(`A JWK with "kty": ${JSON.stringify(jwk.kty)} can’t verify ${alg}.`)
    }
}

function checkJwkFits(jwk, alg) {
    const expected = expectedKeyType(alg)
    if (jwk.alg && jwk.alg !== alg) throw new KeyError(`This JWK is for ${jwk.alg}, but the token is signed with ${alg}.`)
    if (expected && jwk.kty !== expected.kty) throw new KeyError(`${alg} needs ${expected.label}, but this JWK has "kty": ${JSON.stringify(jwk.kty)}.`)
    if (expected?.crv && jwk.crv !== expected.crv) throw new KeyError(`${alg} needs ${expected.label}, but this JWK is on curve ${JSON.stringify(jwk.crv)}.`)
}

async function importJwk(jwk, alg) {
    checkJwkFits(jwk, alg)
    try {
        return await jose.importJWK(publicJwk(jwk, alg), alg)
    } catch (error) {
        if (error instanceof KeyError) throw error
        throw new KeyError(`The JWK couldn’t be imported: ${error.message}`)
    }
}

function jwkFits(jwk, alg) {
    try {
        checkJwkFits(jwk, alg)
        return true
    } catch {
        return false
    }
}

function describeKeyType({ type, curve }) {
    if (type === 'EC') return `an EC ${curve} key`
    if (type === 'RSA' || type === 'RSA-PSS') return 'an RSA key'
    if (type === 'unknown') return 'a key of an unknown type'
    return `an ${type} key`
}

function checkDerFits(info, alg) {
    const expected = expectedKeyType(alg)
    if (!expected || info.type === 'unknown') return
    const fits = expected.kty === 'RSA'
        ? info.type === 'RSA'
        : expected.kty === 'EC'
            ? info.type === 'EC' && info.curve === expected.crv
            : info.type === 'Ed25519'
    if (!fits) throw new KeyError(`This is ${describeKeyType(info)}, but ${alg} needs ${expected.label}.`)
}

async function publicFromPrivate(pkcs8Der, alg) {
    checkDerFits(keyAlgorithm(pkcs8Der, { pkcs8: true }), alg)
    let jwk
    try {
        const privateKey = await jose.importPKCS8(pemEncode('PRIVATE KEY', pkcs8Der), alg, { extractable: true })
        jwk = await jose.exportJWK(privateKey)
    } catch (error) {
        throw new KeyError(`The private key couldn’t be read: ${error.message}`)
    }
    return importJwk(jwk, alg)
}

async function importSpkiDer(der, alg) {
    checkDerFits(keyAlgorithm(der), alg)
    try {
        return await jose.importSPKI(pemEncode('PUBLIC KEY', der), alg)
    } catch (error) {
        throw new KeyError(`The public key couldn’t be imported: ${error.message}`)
    }
}

/**
 * Turns whatever the user pasted into candidate verification keys, choosing
 * the importer by content: PEM public key (SPKI or PKCS#1), X.509
 * certificate, private key (its public half is used), JWK, or JWKS (by kid).
 * Throws KeyError with a readable message.
 * @returns {Promise<{ candidates: { key: CryptoKey, label: string }[], notes: string[] }>}
 */
export async function importVerificationKeys(keyText, alg, kid) {
    const text = String(keyText ?? '').trim()
    const notes = []

    if (text.startsWith('{') || text.startsWith('[')) {
        let json
        try {
            json = JSON.parse(text)
        } catch (error) {
            throw new KeyError(`The key looks like JSON but doesn’t parse: ${error.message}`)
        }
        if (json && Array.isArray(json.keys)) {
            const all = json.keys.filter(k => k && typeof k === 'object')
            let keys
            if (kid !== undefined) {
                keys = all.filter(k => k.kid === kid)
                if (!keys.length) {
                    const kids = all.map(k => k.kid).filter(k => k !== undefined)
                    throw new KeyError(`The JWKS has no key with kid ${JSON.stringify(kid)}${kids.length ? ` (it has ${kids.map(k => JSON.stringify(k)).join(', ')})` : ''}.`)
                }
            } else {
                keys = all.filter(k => jwkFits(k, alg))
                if (!keys.length) throw new KeyError(`None of the ${all.length} keys in this JWKS can verify ${alg}.`)
                if (keys.length > 1) notes.push(`The token has no “kid”, so each of the ${keys.length} matching keys was tried.`)
            }
            const candidates = []
            const errors = []
            for (const jwk of keys) {
                try {
                    candidates.push({ key: await importJwk(jwk, alg), label: jwk.kid !== undefined ? `JWKS key ${JSON.stringify(jwk.kid)}` : 'JWKS key' })
                } catch (error) {
                    errors.push(error.message)
                }
            }
            if (!candidates.length) throw new KeyError(errors[0] || 'No usable key in the JWKS.')
            return { candidates, notes }
        }
        if (json && typeof json === 'object' && !Array.isArray(json) && json.kty) {
            if (json.d) notes.push('This JWK contains a private key; only its public part was used.')
            return { candidates: [{ key: await importJwk(json, alg), label: 'JWK' }], notes }
        }
        throw new KeyError('JSON keys must be a JWK (with "kty") or a JWKS (with "keys").')
    }

    let blocks
    try {
        blocks = findPemBlocks(text)
    } catch (error) {
        throw new KeyError(`The PEM block isn’t valid Base64: ${error.message}`)
    }
    if (!blocks.length) {
        // A bare Base64 SPKI body without the BEGIN/END lines
        if (/^[A-Za-z0-9+/=\s]{40,}$/.test(text)) {
            try {
                const der = base64ToBytes(text)
                if (keyAlgorithm(der).type !== 'unknown') {
                    notes.push('Read as a Base64 public key without its BEGIN/END lines.')
                    return { candidates: [{ key: await importSpkiDer(der, alg), label: 'Public key' }], notes }
                }
            } catch (error) {
                if (error instanceof KeyError) throw error
            }
        }
        throw new KeyError('Paste a PEM public key (-----BEGIN PUBLIC KEY-----), an X.509 certificate, a JWK or a JWKS.')
    }

    const block = blocks[0]
    if (blocks.length > 1) notes.push(`Only the first PEM block (${block.label}) was used.`)
    switch (block.label) {
        case 'PUBLIC KEY':
            return { candidates: [{ key: await importSpkiDer(block.der, alg), label: 'Public key' }], notes }
        case 'RSA PUBLIC KEY':
            if (algFamily(alg) !== 'rsa') throw new KeyError(`This is an RSA key, but ${alg} needs ${expectedKeyType(alg)?.label || 'another key type'}.`)
            return { candidates: [{ key: await importSpkiDer(pkcs1ToSpki(block.der), alg), label: 'RSA public key (PKCS#1)' }], notes }
        case 'CERTIFICATE':
            try {
                return { candidates: [{ key: await jose.importX509(block.pem.trim(), alg), label: 'Certificate' }], notes }
            } catch (error) {
                throw new KeyError(`The certificate’s key couldn’t be used for ${alg}: ${error.message}`)
            }
        case 'PRIVATE KEY':
            notes.push('You pasted a private key; its public half was used. Verifying only ever needs the public key.')
            return { candidates: [{ key: await publicFromPrivate(block.der, alg), label: 'Public half of the private key' }], notes }
        case 'RSA PRIVATE KEY':
            if (algFamily(alg) !== 'rsa') throw new KeyError(`This is an RSA key, but ${alg} needs ${expectedKeyType(alg)?.label || 'another key type'}.`)
            notes.push('You pasted a private key; its public half was used. Verifying only ever needs the public key.')
            return { candidates: [{ key: await publicFromPrivate(pkcs1ToPkcs8(block.der), alg), label: 'Public half of the private key' }], notes }
        case 'EC PRIVATE KEY':
            throw new KeyError('SEC1 “EC PRIVATE KEY” files aren’t supported. Paste the public key instead (openssl ec -in key.pem -pubout).')
        case 'ENCRYPTED PRIVATE KEY':
            throw new KeyError('Encrypted private keys aren’t supported. Paste the public key instead.')
        default:
            throw new KeyError(`Unsupported PEM type “${block.label}”. Paste a public key, certificate, JWK or JWKS.`)
    }
}

const HASH_BITS = { HS256: 256, HS384: 384, HS512: 512 }

function explainJoseError(error, alg) {
    const message = error?.message || String(error)
    if (/modulusLength to be 2048/.test(message)) {
        return `${alg} needs an RSA key of at least 2048 bits (jose enforces RFC 7518’s minimum), and this key is smaller.`
    }
    if (error?.code === 'ERR_JOSE_NOT_SUPPORTED') return `${alg} isn’t supported by this browser: ${message}`
    if (error?.code === 'ERR_JWS_INVALID') return `The token is malformed: ${message}`
    return message
}

/**
 * Checks the signature only. Result:
 *   { status: 'idle' }                       nothing to verify with yet
 *   { status: 'unsecured' }                  alg "none"
 *   { status: 'valid', keyLabel, notes }
 *   { status: 'invalid', message, notes }    the signature doesn't match
 *   { status: 'error', step, message }       step: header | secret | key | verify
 */
export async function verifyToken({ token, decoded, secret = '', secretEncoding = 'text', keyText = '' }) {
    if (!decoded || decoded.kind !== 'jws') return { status: 'idle' }
    if (decoded.header.error) return { status: 'error', step: 'header', message: decoded.header.error }
    if (decoded.algError) return { status: 'error', step: 'header', message: decoded.algError }
    const { alg } = decoded
    const family = algFamily(alg)
    if (family === 'none') return { status: 'unsecured' }
    if (family === 'unsupported') {
        return { status: 'error', step: 'header', message: alg === 'ES256K' ? 'ES256K (secp256k1) isn’t available in browsers’ WebCrypto, so it can’t be verified here.' : `Unsupported algorithm “${alg}”.` }
    }
    if (!globalThis.crypto?.subtle) {
        return { status: 'error', step: 'verify', message: 'WebCrypto isn’t available on this page (it needs HTTPS or localhost), so signatures can’t be checked.' }
    }

    const notes = []
    let candidates
    if (family === 'hmac') {
        if (!secret) return { status: 'idle' }
        let bytes
        try {
            bytes = decodeSecret(secret, secretEncoding)
        } catch (error) {
            return { status: 'error', step: 'secret', message: `The secret isn’t valid ${secretEncoding === 'hex' ? 'hex' : 'Base64'}: ${error.message}` }
        }
        if (!bytes.length) return { status: 'error', step: 'secret', message: 'The secret is empty.' }
        if (bytes.length * 8 < HASH_BITS[alg]) notes.push(`This secret has ${bytes.length * 8} bits; ${alg} keys should have at least ${HASH_BITS[alg]} (RFC 7518 §3.2).`)
        candidates = [{ key: bytes, label: 'Secret' }]
    } else {
        if (!keyText.trim()) return { status: 'idle' }
        try {
            const imported = await importVerificationKeys(keyText, alg, decoded.header.value.kid)
            candidates = imported.candidates
            notes.push(...imported.notes)
        } catch (error) {
            return { status: 'error', step: 'key', message: error instanceof KeyError ? error.message : `The key couldn’t be read: ${error.message}` }
        }
    }

    for (const candidate of candidates) {
        try {
            await jose.compactVerify(token, candidate.key, { algorithms: [alg] })
            return { status: 'valid', keyLabel: candidate.label, notes }
        } catch (error) {
            if (error?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') continue
            return { status: 'error', step: 'verify', message: explainJoseError(error, alg), notes }
        }
    }
    return {
        status: 'invalid',
        message: candidates.length > 1 ? `The signature doesn’t match any of the ${candidates.length} keys.` : family === 'hmac' ? 'The signature doesn’t match this secret.' : 'The signature doesn’t match this key.',
        notes,
    }
}

export const REGISTERED_CLAIMS = {
    iss: 'Issuer',
    sub: 'Subject',
    aud: 'Audience',
    exp: 'Expires',
    nbf: 'Not before',
    iat: 'Issued at',
    jti: 'JWT ID',
}
