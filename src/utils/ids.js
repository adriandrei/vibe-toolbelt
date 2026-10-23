// Random identifiers: Nano ID (unbiased, any alphabet), ULID (monotonic) and
// unbiased random integers. All randomness comes from crypto.getRandomValues.

export const NANOID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'

export const ALPHABET_PRESETS = [
    { id: 'url', label: 'URL-safe (default)', value: NANOID_ALPHABET },
    { id: 'alnum', label: 'Alphanumeric', value: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
    { id: 'lower', label: 'Lowercase', value: 'abcdefghijklmnopqrstuvwxyz' },
    { id: 'lowernum', label: 'Lowercase + digits', value: '0123456789abcdefghijklmnopqrstuvwxyz' },
    { id: 'digits', label: 'Digits', value: '0123456789' },
    { id: 'hex', label: 'Hex', value: '0123456789abcdef' },
    { id: 'nolookalikes', label: 'No look-alikes', value: '346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz' },
]

const MAX_UINT32 = 0x100000000

// Uniform integer in [0, max) (max ≤ 2^32), without modulo bias.
export function randomInt(max) {
    if (!Number.isInteger(max) || max <= 0 || max > MAX_UINT32) throw new RangeError('max must be an integer in 1..2^32')
    const limit = MAX_UINT32 - (MAX_UINT32 % max)
    const buf = new Uint32Array(1)
    for (;;) {
        crypto.getRandomValues(buf)
        if (buf[0] < limit) return buf[0] % max
    }
}

/**
 * Checks a custom Nano ID alphabet. Works on code points, so emoji and other
 * astral characters count as one symbol.
 * @returns {{ symbols: string[], error?: string, warning?: string }}
 */
export function validateAlphabet(text) {
    const symbols = Array.from(String(text ?? ''))
    if (symbols.length < 2) return { symbols, error: 'Use at least 2 different characters.' }
    const seen = new Set()
    const duplicates = new Set()
    for (const s of symbols) {
        if (seen.has(s)) duplicates.add(s)
        seen.add(s)
    }
    if (duplicates.size) {
        const list = [...duplicates].slice(0, 8).map(s => `“${s}”`).join(', ')
        return { symbols, error: `Each character may appear only once (repeated: ${list}${duplicates.size > 8 ? '…' : ''}). Repeats would make some characters more likely than others.` }
    }
    if (symbols.length > 256) return { symbols, error: `At most 256 characters (this one has ${symbols.length}).` }
    const warning = symbols.some(s => /\s/.test(s))
        ? 'The alphabet contains whitespace, so IDs may contain spaces.'
        : symbols.some(s => s.codePointAt(0) > 0x7e)
            ? 'Non-ASCII characters take several bytes in UTF-8 and may not be URL-safe.'
            : undefined
    return { symbols, warning }
}

/**
 * Nano ID with rejection sampling (same approach as nanoid's customAlphabet):
 * random bytes are masked to the next power of two and values that fall
 * outside the alphabet are discarded, so every symbol is equally likely.
 * @param {number} size
 * @param {string[]} symbols  alphabet as an array of code points (2..256)
 */
export function nanoid(size = 21, symbols = Array.from(NANOID_ALPHABET)) {
    const length = symbols.length
    if (length < 2 || length > 256) throw new RangeError('Alphabet must have 2–256 symbols')
    const mask = (2 << (31 - Math.clz32((length - 1) | 1))) - 1
    const step = Math.ceil((1.6 * mask * size) / length)
    let id = ''
    let count = 0
    for (;;) {
        const bytes = crypto.getRandomValues(new Uint8Array(step))
        for (let i = 0; i < step; i++) {
            const index = bytes[i] & mask
            if (index < length) {
                id += symbols[index]
                if (++count === size) return id
            }
        }
    }
}

// ---- ULID (https://github.com/ulid/spec) ----
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TIME_MAX = 2 ** 48 - 1
let lastTime = -1
let lastRandom = null // 16 base-32 digits

function encodeTime(ms) {
    let out = ''
    let t = ms
    for (let i = 0; i < 10; i++) {
        out = CROCKFORD[t % 32] + out
        t = Math.floor(t / 32)
    }
    return out
}

function incrementRandom(digits) {
    const next = digits.slice()
    for (let i = next.length - 1; i >= 0; i--) {
        if (next[i] < 31) {
            next[i] += 1
            return next
        }
        next[i] = 0
    }
    throw new Error('ULID random part overflowed within one millisecond')
}

/**
 * Monotonic ULID: 10 characters of millisecond timestamp + 16 characters
 * (80 bits) of randomness. IDs made in the same millisecond (or while the
 * clock goes backwards) reuse the last timestamp and increment the random
 * part, so they still sort in creation order.
 */
export function ulid(now = Date.now()) {
    if (!Number.isFinite(now) || now < 0 || now > TIME_MAX) throw new RangeError('Timestamp out of range for a ULID')
    let time = Math.floor(now)
    if (time <= lastTime && lastRandom) {
        time = lastTime
        lastRandom = incrementRandom(lastRandom)
    } else {
        // 256 is a multiple of 32, so `& 31` keeps each digit uniform
        lastRandom = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b & 31)
        lastTime = time
    }
    return encodeTime(time) + lastRandom.map(d => CROCKFORD[d]).join('')
}

/**
 * Reads the timestamp of a ULID. Accepts lowercase and Crockford's
 * look-alikes (I/L → 1, O → 0). Returns { ms } or { error }.
 */
export function decodeUlid(text) {
    const value = String(text ?? '').trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0')
    if (!value) return { error: 'Empty' }
    if (value.length !== 26) return { error: `A ULID has 26 characters (this has ${value.length}).` }
    const bad = value.match(/[^0-9A-HJKMNP-TV-Z]/)
    if (bad) return { error: `“${bad[0]}” isn't a Crockford Base32 character.` }
    if (value[0] > '7') return { error: 'The timestamp part is too large: a ULID starts with 0–7.' }
    let ms = 0
    for (const ch of value.slice(0, 10)) ms = ms * 32 + CROCKFORD.indexOf(ch)
    return { ms, normalized: value }
}

/**
 * Number of IDs after which a collision becomes `p` likely (birthday bound),
 * for IDs with `bits` bits of entropy.
 */
export function idsForCollisionProbability(bits, p = 0.01) {
    // n ≈ sqrt(2 · N · ln(1 / (1 − p))), N = 2^bits
    return Math.sqrt(2 * Math.log(1 / (1 - p))) * 2 ** (bits / 2)
}

// ---- UUID inspection (RFC 9562) ----
const UUID_VERSIONS = {
    1: 'time-based (Gregorian timestamp + node)',
    2: 'DCE security',
    3: 'name-based (MD5)',
    4: 'random',
    5: 'name-based (SHA-1)',
    6: 'time-based, reordered (sortable v1)',
    7: 'time-ordered (Unix milliseconds + random)',
    8: 'custom / vendor-specific',
}
const GREGORIAN_OFFSET = 0x01b21dd213814000n // 100-ns intervals from 1582-10-15 to 1970-01-01

/**
 * Parses a UUID in any common spelling (hyphens or not, braces, urn:uuid:,
 * any case). Returns { error } or details: canonical, version, variant,
 * timestamp (ms, for v1/v6/v7), clockSeq and node (v1/v6).
 */
export function parseUuid(text) {
    let value = String(text ?? '').trim().replace(/^urn:uuid:/i, '')
    if (/^\{.*\}$/.test(value)) value = value.slice(1, -1)
    const hex = value.replace(/-/g, '')
    const bad = hex.match(/[^0-9a-fA-F]/)
    if (bad) return { error: `“${bad[0]}” isn’t a hex digit.` }
    if (hex.length !== 32) return { error: `A UUID has 32 hex digits; this has ${hex.length}.` }
    if (value.includes('-') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return { error: 'The hyphens are in the wrong places: groups are 8-4-4-4-12 digits.' }
    }
    const lower = hex.toLowerCase()
    const canonical = `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`
    if (/^0{32}$/.test(lower)) return { canonical, special: 'Nil UUID (all zeros)' }
    if (/^f{32}$/.test(lower)) return { canonical, special: 'Max UUID (all ones)' }

    const bytes = Uint8Array.from({ length: 16 }, (_, i) => parseInt(lower.substr(i * 2, 2), 16))
    const v = bytes[8]
    const variant = (v & 0x80) === 0 ? 'NCS (reserved, pre-RFC)' : (v & 0xc0) === 0x80 ? 'RFC 9562 (standard)' : (v & 0xe0) === 0xc0 ? 'Microsoft (reserved, old GUID)' : 'Reserved for future use'
    const standard = (v & 0xc0) === 0x80
    const version = bytes[6] >> 4
    const out = { canonical, bytes, version, versionName: standard ? UUID_VERSIONS[version] || 'unknown version' : null, variant, standard }

    if (!standard) return out
    const big = (from, to) => BigInt(`0x${lower.slice(from * 2, to * 2)}`)
    if (version === 1 || version === 6) {
        const ticks = version === 1
            ? ((big(6, 8) & 0x0fffn) << 48n) | (big(4, 6) << 32n) | big(0, 4)
            : (big(0, 4) << 28n) | (big(4, 6) << 12n) | (big(6, 8) & 0x0fffn)
        out.timestamp = Number((ticks - GREGORIAN_OFFSET) / 10000n)
        out.clockSeq = ((bytes[8] & 0x3f) << 8) | bytes[9]
        out.node = Array.from(bytes.subarray(10), b => b.toString(16).padStart(2, '0')).join(':')
        out.randomNode = (bytes[10] & 1) === 1
    } else if (version === 7) {
        out.timestamp = Number(big(0, 6))
    }
    return out
}
