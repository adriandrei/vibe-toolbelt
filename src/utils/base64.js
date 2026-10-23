// Base64 helpers: any size, both alphabets (standard and URL-safe), data: URIs,
// and binary detection for decoded data.

const CHUNK = 0x8000

export class Base64Error extends Error {}

/** Encodes bytes. URL-safe output uses "-" and "_" and, by default, no padding. */
export function bytesToBase64(bytes, { urlSafe = false, pad = !urlSafe } = {}) {
    if (typeof bytes.toBase64 === 'function') {
        return bytes.toBase64({ alphabet: urlSafe ? 'base64url' : 'base64', omitPadding: !pad })
    }
    // String.fromCharCode(...bytes) overflows the call stack on large inputs, so go in chunks
    let binary = ''
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    let out = btoa(binary)
    if (urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_')
    if (!pad) out = out.replace(/=+$/, '')
    return out
}

export function textToBase64(text, options) {
    return bytesToBase64(new TextEncoder().encode(text), options)
}

/**
 * Validates and normalises Base64 input. Accepts a data: URI prefix, line
 * breaks and spaces, missing padding and the URL-safe alphabet.
 * Returns { base64 (standard alphabet, padded), urlSafe, mime } or throws a
 * Base64Error that says what is wrong.
 */
export function normalizeBase64(input) {
    let s = String(input).trim()
    let mime = null
    const dataUri = s.match(/^data:([^,]*),/i)
    if (dataUri) {
        const meta = dataUri[1]
        if (!/;base64$/i.test(meta)) throw new Base64Error('This data: URI isn’t Base64-encoded (it has no “;base64” marker).')
        mime = meta.replace(/;base64$/i, '').split(';')[0].trim() || null
        s = s.slice(dataUri[0].length)
    }
    const badIndex = s.search(/[^A-Za-z0-9+/\-_=\s]/)
    if (badIndex !== -1) {
        const ch = s[badIndex]
        throw new Base64Error(`“${ch === ' ' ? 'space' : ch}” at position ${badIndex + 1} isn’t a Base64 character. Base64 uses only A–Z, a–z, 0–9, + and / (or - and _), with = padding at the end.`)
    }
    s = s.replace(/\s+/g, '')
    if (!s) throw new Base64Error('There’s nothing to decode.')
    const urlSafe = /[-_]/.test(s)
    if (urlSafe && /[+/]/.test(s)) throw new Base64Error('This mixes the standard (+ /) and URL-safe (- _) alphabets.')
    const firstPad = s.indexOf('=')
    if (firstPad !== -1 && !/^=+$/.test(s.slice(firstPad))) throw new Base64Error('Padding (=) can only appear at the end.')
    const core = s.replace(/=+$/, '')
    if (core.length % 4 === 1) throw new Base64Error('The length is wrong: the last group has a single character, so some data is missing or there’s an extra character.')
    const padded = (urlSafe ? core.replace(/-/g, '+').replace(/_/g, '/') : core) + '='.repeat((4 - (core.length % 4)) % 4)
    return { base64: padded, urlSafe, mime }
}

/** Decodes standard, padded Base64 (see normalizeBase64). */
export function base64ToBytes(base64) {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(base64)
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

/** Strict UTF-8 decoding: returns null when the bytes aren't valid UTF-8. */
export function decodeUtf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return null
    }
}

// Valid UTF-8 can still be binary (NUL bytes, lots of control characters)
export function looksBinaryText(text) {
    const sample = text.length > 65536 ? text.slice(0, 65536) : text
    if (sample.includes('\u0000')) return true
    let control = 0
    for (let i = 0; i < sample.length; i++) {
        const c = sample.charCodeAt(i)
        if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) control++
    }
    return control > Math.max(2, sample.length * 0.05)
}

const ascii = (s) => [...s].map(c => c.charCodeAt(0))

const SIGNATURES = [
    { label: 'PNG image', mime: 'image/png', ext: 'png', at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { label: 'JPEG image', mime: 'image/jpeg', ext: 'jpg', at: 0, bytes: [0xff, 0xd8, 0xff] },
    { label: 'GIF image', mime: 'image/gif', ext: 'gif', at: 0, bytes: ascii('GIF8') },
    { label: 'WebP image', mime: 'image/webp', ext: 'webp', at: 8, bytes: ascii('WEBP'), also: { at: 0, bytes: ascii('RIFF') } },
    { label: 'AVIF image', mime: 'image/avif', ext: 'avif', at: 4, bytes: ascii('ftypavif') },
    { label: 'ICO icon', mime: 'image/x-icon', ext: 'ico', at: 0, bytes: [0x00, 0x00, 0x01, 0x00] },
    { label: 'PDF document', mime: 'application/pdf', ext: 'pdf', at: 0, bytes: ascii('%PDF') },
    { label: 'ZIP archive (or .docx, .xlsx, .jar)', mime: 'application/zip', ext: 'zip', at: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
    { label: 'gzip data', mime: 'application/gzip', ext: 'gz', at: 0, bytes: [0x1f, 0x8b] },
    { label: '7-Zip archive', mime: 'application/x-7z-compressed', ext: '7z', at: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
    { label: 'WOFF2 font', mime: 'font/woff2', ext: 'woff2', at: 0, bytes: ascii('wOF2') },
    { label: 'WOFF font', mime: 'font/woff', ext: 'woff', at: 0, bytes: ascii('wOFF') },
    { label: 'MP3 audio', mime: 'audio/mpeg', ext: 'mp3', at: 0, bytes: ascii('ID3') },
    { label: 'Ogg media', mime: 'audio/ogg', ext: 'ogg', at: 0, bytes: ascii('OggS') },
    { label: 'MP4 video', mime: 'video/mp4', ext: 'mp4', at: 4, bytes: ascii('ftyp') },
    { label: 'WebAssembly module', mime: 'application/wasm', ext: 'wasm', at: 0, bytes: [0x00, 0x61, 0x73, 0x6d] },
    { label: 'SQLite database', mime: 'application/vnd.sqlite3', ext: 'sqlite', at: 0, bytes: ascii('SQLite format 3') },
]

const EXT_BY_MIME = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
    'image/avif': 'avif', 'image/x-icon': 'ico', 'application/pdf': 'pdf', 'application/zip': 'zip',
    'application/json': 'json', 'text/plain': 'txt', 'text/html': 'html', 'text/css': 'css', 'text/csv': 'csv',
    'audio/mpeg': 'mp3', 'video/mp4': 'mp4', 'font/woff2': 'woff2', 'application/gzip': 'gz',
}

const matchAt = (bytes, at, sig) => sig.every((b, i) => bytes[at + i] === b)

/** Guesses a file type from its first bytes. */
export function sniffFileType(bytes) {
    for (const s of SIGNATURES) {
        if (bytes.length >= s.at + s.bytes.length && matchAt(bytes, s.at, s.bytes) && (!s.also || matchAt(bytes, s.also.at, s.also.bytes))) {
            return { label: s.label, mime: s.mime, ext: s.ext }
        }
    }
    return null
}

export const extensionForMime = (mime) => EXT_BY_MIME[mime] ?? 'bin'

/** Classic hex dump (offset, 16 hex bytes, ASCII) of the first `limit` bytes. */
export function hexDump(bytes, limit = 256) {
    const lines = []
    const end = Math.min(bytes.length, limit)
    for (let off = 0; off < end; off += 16) {
        const row = bytes.subarray(off, Math.min(off + 16, end))
        const hex = [...row].map(b => b.toString(16).padStart(2, '0')).join(' ')
        const text = [...row].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
        lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${text}`)
    }
    return lines.join('\n')
}

/**
 * True when `text` is very likely Base64 (used to pick decode mode for
 * injected text): it must be valid, reasonably long, and decode to readable
 * text or a recognisable file.
 */
export function looksLikeBase64(text) {
    const t = String(text).trim()
    if (!t || t.length > 50_000_000) return false
    const isDataUri = /^data:[^,]*;base64,/i.test(t)
    if (!isDataUri && t.replace(/\s+/g, '').length < 8) return false
    try {
        const { base64 } = normalizeBase64(t)
        const bytes = base64ToBytes(base64)
        if (isDataUri || sniffFileType(bytes)) return true
        const decoded = decodeUtf8(bytes)
        return decoded !== null && !looksBinaryText(decoded)
    } catch {
        return false
    }
}
