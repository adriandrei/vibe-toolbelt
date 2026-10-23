// Byte and text encoding helpers for the security tools (hex, Base64,
// Base64url, UTF-8). Decoders validate their input and throw an Error whose
// message can be shown to the user as-is.

const utf8Encoder = new TextEncoder()

// UTF-8 bytes of a string. Never throws: unpaired surrogates (e.g. text cut
// in the middle of an emoji) become U+FFFD, as in every browser API.
export function utf8Encode(text) {
    return utf8Encoder.encode(String(text ?? ''))
}

// Decodes UTF-8. With `fatal`, invalid sequences throw instead of becoming U+FFFD.
export function utf8Decode(bytes, { fatal = false } = {}) {
    return new TextDecoder('utf-8', { fatal }).decode(bytes)
}

export function hasLoneSurrogates(text) {
    if (typeof text !== 'string') return false
    if (typeof text.isWellFormed === 'function') return !text.isWellFormed()
    return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function bytesToHex(bytes, upper = false) {
    let out = ''
    for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]]
    return upper ? out.toUpperCase() : out
}

// Accepts "0a1b…", "0A 1B …", "0a:1b:…" and an optional 0x prefix.
export function hexToBytes(text) {
    let clean = String(text ?? '').replace(/[\s:]/g, '')
    if (/^0x/i.test(clean)) clean = clean.slice(2)
    const bad = clean.match(/[^0-9a-fA-F]/)
    if (bad) throw new Error(`“${bad[0]}” isn't a hex digit (0–9, a–f)`)
    if (clean.length % 2) throw new Error(`Hex needs an even number of digits (got ${clean.length})`)
    const out = new Uint8Array(clean.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
    return out
}

export function bytesToBase64(bytes) {
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}

export function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Decodes standard or URL-safe Base64, with or without padding. Whitespace
// (line wrapping) is ignored.
export function base64ToBytes(text) {
    const clean = String(text ?? '').replace(/\s+/g, '')
    const bad = clean.match(/[^A-Za-z0-9+/\-_=]/)
    if (bad) throw new Error(`“${bad[0]}” isn't a Base64 character`)
    const body = clean.replace(/=+$/, '')
    if (body.includes('=')) throw new Error('Base64 padding (=) can only appear at the end')
    if (clean.length - body.length > 2) throw new Error('Too much Base64 padding (=)')
    if (body.length % 4 === 1) throw new Error('Base64 length is invalid (one character too many or too few)')
    const std = body.replace(/-/g, '+').replace(/_/g, '/')
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4)
    let binary
    try {
        binary = atob(padded)
    } catch {
        throw new Error('Invalid Base64')
    }
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
}

// Strict Base64url (RFC 4648 §5) as used by JWS/JWT: no padding, no + or /.
export function base64UrlToBytes(text) {
    const value = String(text ?? '')
    const bad = value.match(/[^A-Za-z0-9\-_]/)
    if (bad) throw new Error(bad[0] === '=' ? 'Base64url in JWTs has no “=” padding' : `“${bad[0]}” isn't a Base64url character`)
    return base64ToBytes(value)
}

export function concatBytes(...parts) {
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const p of parts) {
        out.set(p, offset)
        offset += p.length
    }
    return out
}

// Compares two byte arrays without an early exit on the first difference.
export function timingSafeEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    return diff === 0
}

// Formats a digest/MAC for display.
export function encodeBytes(bytes, format = 'hex') {
    if (!bytes) return ''
    if (format === 'HEX') return bytesToHex(bytes, true)
    if (format === 'base64') return bytesToBase64(bytes)
    if (format === 'base64url') return bytesToBase64Url(bytes)
    return bytesToHex(bytes)
}

// Parses a digest the user pasted (hex or Base64, optional "sha256=" style
// prefix as in webhook headers). Returns { bytes, encoding } or throws.
export function parseDigest(text) {
    let value = String(text ?? '').trim()
    value = value.replace(/^(sha\d*|sha3-\d+|md5|v\d+)=/i, '')
    const compact = value.replace(/\s+/g, '')
    if (!compact) throw new Error('Empty')
    if (/^(0x)?[0-9a-fA-F]+$/.test(compact) && compact.replace(/^0x/i, '').length % 2 === 0) {
        return { bytes: hexToBytes(compact), encoding: 'hex' }
    }
    return { bytes: base64ToBytes(compact), encoding: 'Base64' }
}

// Encodes a secret typed by the user: 'text' (UTF-8), 'hex' or 'base64'.
export function decodeSecret(value, encoding) {
    if (encoding === 'hex') return hexToBytes(value)
    if (encoding === 'base64') return base64ToBytes(value)
    return utf8Encode(value)
}

// Byte length of a string in UTF-8 without allocating (lone surrogates count
// as U+FFFD, 3 bytes, matching utf8Encode).
export function utf8Length(text) {
    let bytes = 0
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (c < 0x80) bytes += 1
        else if (c < 0x800) bytes += 2
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
            bytes += 4
            i++
        } else bytes += 3
    }
    return bytes
}
