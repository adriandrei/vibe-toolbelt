// Text and byte codecs for the Recipes tool: Base32, hex, binary, character
// codes, URL and HTML entity encoding, ROT13. Decoders validate their input and
// throw a RecipeError whose message can be shown to the user as-is (after
// "Step 3 · Hex decode: ").

export class RecipeError extends Error {
    constructor(message) {
        super(message)
        this.name = 'RecipeError'
    }
}

// Writes ASCII bytes into a string quickly, even for tens of megabytes
const asciiDecoder = new TextDecoder()
const fromAscii = (buffer) => asciiDecoder.decode(buffer)

const quote = (text) => `“${text.length > 24 ? `${text.slice(0, 23)}…` : text}”`

// ---------------------------------------------------------------- Base32 (RFC 4648 §6 and §7)

export const BASE32_ALPHABETS = {
    standard: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    hex: '0123456789ABCDEFGHIJKLMNOPQRSTUV',
}

export function base32Encode(bytes, { alphabet = 'standard', padding = true } = {}) {
    const chars = BASE32_ALPHABETS[alphabet] ?? BASE32_ALPHABETS.standard
    const codes = Array.from(chars, (c) => c.charCodeAt(0))
    // 5 bytes → 8 characters; a final partial group of 1–4 bytes → 2, 4, 5 or 7
    const rest = bytes.length % 5
    const used = Math.floor(bytes.length / 5) * 8 + [0, 2, 4, 5, 7][rest]
    const out = new Uint8Array(padding ? Math.ceil(bytes.length / 5) * 8 : used)
    let buffer = 0
    let bits = 0
    let o = 0
    for (let i = 0; i < bytes.length; i++) {
        buffer = ((buffer << 8) | bytes[i]) & 0xffff
        bits += 8
        while (bits >= 5) {
            bits -= 5
            out[o++] = codes[(buffer >> bits) & 31]
        }
    }
    if (bits > 0) out[o++] = codes[(buffer << (5 - bits)) & 31]
    out.fill(61, o) // "=" padding
    return fromAscii(out)
}

export function base32Decode(text, { alphabet = 'standard' } = {}) {
    const chars = BASE32_ALPHABETS[alphabet] ?? BASE32_ALPHABETS.standard
    const values = new Int8Array(128).fill(-1)
    for (let i = 0; i < 32; i++) {
        values[chars.charCodeAt(i)] = i
        values[chars[i].toLowerCase().charCodeAt(0)] = i
    }
    const name = alphabet === 'hex' ? 'Base32hex' : 'Base32'
    const allowed = alphabet === 'hex' ? '0–9 and A–V' : 'A–Z and 2–7'
    const source = String(text)
    const digits = new Uint8Array(source.length)
    let count = 0
    let padAt = -1
    for (let i = 0; i < source.length; i++) {
        const c = source.charCodeAt(i)
        if (c === 32 || c === 10 || c === 13 || c === 9) continue
        if (c === 61) {
            if (padAt < 0) padAt = i
            continue
        }
        const ch = String.fromCodePoint(source.codePointAt(i))
        if (padAt >= 0) throw new RecipeError(`padding (=) can only appear at the end, but ${quote(ch)} follows it at position ${i + 1}`)
        const value = c < 128 ? values[c] : -1
        if (value < 0) throw new RecipeError(`${quote(ch)} at position ${i + 1} isn’t a ${name} character (${name} uses ${allowed}, with = padding)`)
        digits[count++] = value
    }
    const rest = count % 8
    if (rest === 1 || rest === 3 || rest === 6) {
        throw new RecipeError(`the length is wrong: the last group has ${rest} character${rest === 1 ? '' : 's'}, which can’t encode whole bytes, so a character is missing or extra`)
    }
    const out = new Uint8Array(Math.floor((count * 5) / 8))
    let buffer = 0
    let bits = 0
    let o = 0
    for (let i = 0; i < count; i++) {
        buffer = ((buffer << 5) | digits[i]) & 0xfff
        bits += 5
        if (bits >= 8) {
            bits -= 8
            out[o++] = (buffer >> bits) & 0xff
        }
    }
    return out
}

// ---------------------------------------------------------------- Hex

const HEX_LOWER = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export const HEX_FORMATS = {
    plain: { prefix: '', separator: '' },
    space: { prefix: '', separator: ' ' },
    colon: { prefix: '', separator: ':' },
    escaped: { prefix: '\\x', separator: '' },
    c: { prefix: '0x', separator: ', ' },
}

export function hexEncode(bytes, { format = 'plain', upper = false } = {}) {
    const { prefix, separator } = HEX_FORMATS[format] ?? HEX_FORMATS.plain
    if (!bytes.length) return ''
    const digits = HEX_LOWER.map((h) => (upper ? h.toUpperCase() : h))
    const prefixCodes = Array.from(prefix, (c) => c.charCodeAt(0))
    const sepCodes = Array.from(separator, (c) => c.charCodeAt(0))
    const per = prefixCodes.length + 2
    const out = new Uint8Array(bytes.length * per + (bytes.length - 1) * sepCodes.length)
    let o = 0
    for (let i = 0; i < bytes.length; i++) {
        if (i) for (const c of sepCodes) out[o++] = c
        for (const c of prefixCodes) out[o++] = c
        const d = digits[bytes[i]]
        out[o++] = d.charCodeAt(0)
        out[o++] = d.charCodeAt(1)
    }
    return fromAscii(out)
}

// Value of each ASCII hex digit, -1 for anything else
const HEX_VALUES = new Int8Array(128).fill(-1)
for (let i = 0; i < 16; i++) {
    HEX_VALUES[i.toString(16).charCodeAt(0)] = i
    HEX_VALUES[i.toString(16).toUpperCase().charCodeAt(0)] = i
}

/**
 * Reads hex written as "48656c6c6f", "48 65 6c", "48:65:6c", "\x48\x65",
 * "0x48, 0x65" or a UUID. When the digits are split into several groups, a
 * group with a single digit ("0x5") is one byte; otherwise every byte needs
 * two digits.
 */
export function hexDecode(text) {
    // "\x" becomes two spaces, so positions in messages match the input
    const source = String(text).replace(/\\[xX]/g, '  ')
    const tokens = [...source.matchAll(/[^\s,;:-]+/g)]
    const parts = []
    let total = 0
    for (const m of tokens) {
        let token = m[0]
        let at = m.index
        if (token.length > 1 && token[0] === '0' && (token[1] === 'x' || token[1] === 'X')) {
            token = token.slice(2)
            at += 2
            if (!token) throw new RecipeError(`“0x” at position ${m.index + 1} isn’t followed by hex digits`)
        }
        for (let k = 0; k < token.length; k++) {
            const c = token.charCodeAt(k)
            if (c > 127 || HEX_VALUES[c] < 0) {
                const ch = String.fromCodePoint(token.codePointAt(k))
                throw new RecipeError(`${quote(ch)} at position ${at + k + 1} isn’t a hex digit (0–9, a–f)`)
            }
        }
        if (token.length % 2 && !(token.length === 1 && tokens.length > 1)) {
            throw new RecipeError(`${quote(token)} at position ${at + 1} has an odd number of hex digits (${token.length.toLocaleString('en-US')}); each byte needs two`)
        }
        parts.push(token)
        total += Math.ceil(token.length / 2)
    }
    const out = new Uint8Array(total)
    let o = 0
    for (const token of parts) {
        if (token.length === 1) {
            out[o++] = HEX_VALUES[token.charCodeAt(0)]
            continue
        }
        for (let k = 0; k < token.length; k += 2) {
            out[o++] = (HEX_VALUES[token.charCodeAt(k)] << 4) | HEX_VALUES[token.charCodeAt(k + 1)]
        }
    }
    return out
}

// ---------------------------------------------------------------- Binary

export function binaryEncode(bytes, { separator = 'space' } = {}) {
    if (!bytes.length) return ''
    const sep = separator === 'none' ? [] : separator === 'newline' ? [10] : [32]
    const out = new Uint8Array(bytes.length * 8 + (bytes.length - 1) * sep.length)
    let o = 0
    for (let i = 0; i < bytes.length; i++) {
        if (i) for (const c of sep) out[o++] = c
        const b = bytes[i]
        for (let bit = 7; bit >= 0; bit--) out[o++] = (b >> bit) & 1 ? 49 : 48
    }
    return fromAscii(out)
}

/**
 * "01001000 01101001", or one long run of bits. Separated groups of up to 8
 * bits are one byte each (so 7-bit ASCII groups work); a single run must be
 * a whole number of bytes.
 */
export function binaryDecode(text) {
    const source = String(text)
    const bad = source.search(/[^01\s,;:]/)
    if (bad >= 0) {
        const ch = String.fromCodePoint(source.codePointAt(bad))
        throw new RecipeError(`${quote(ch)} at position ${bad + 1} isn’t a binary digit (0 or 1)`)
    }
    const tokens = [...source.matchAll(/[01]+/g)]
    if (!tokens.length) return new Uint8Array(0)
    if (tokens.length === 1) {
        const bits = tokens[0][0]
        if (bits.length % 8) throw new RecipeError(`${bits.length} bits isn’t a whole number of bytes: without separators, binary needs 8 bits per byte`)
        const out = new Uint8Array(bits.length / 8)
        for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.substr(i * 8, 8), 2)
        return out
    }
    return Uint8Array.from(tokens, (m) => {
        if (m[0].length > 8) throw new RecipeError(`${quote(m[0])} at position ${m.index + 1} has ${m[0].length} bits; a byte has at most 8`)
        return parseInt(m[0], 2)
    })
}

// ---------------------------------------------------------------- Character codes

const SEPARATORS = { space: ' ', comma: ', ', newline: '\n' }

export function toCharCodes(text, { base = 'dec', separator = 'space' } = {}) {
    const codes = []
    for (const ch of text) {
        const cp = ch.codePointAt(0)
        if (base === 'hex') codes.push(cp.toString(16))
        else if (base === 'unicode') codes.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`)
        else codes.push(String(cp))
    }
    return codes.join(SEPARATORS[separator] ?? ' ')
}

/** "72 101 108", "48 65 6c", "0x48, 0x65" or "U+0048 U+0065". */
export function fromCharCodes(text, { base = 'dec' } = {}) {
    const source = String(text)
    let out = ''
    for (const m of source.matchAll(/[^\s,;]+/g)) {
        const token = m[0]
        let digits = token
        let radix = base === 'hex' ? 16 : 10
        if (/^(?:U\+|0x|\\u|\\x)/i.test(token)) {
            digits = token.replace(/^(?:U\+|0x|\\u|\\x)/i, '')
            radix = 16
        }
        const valid = radix === 16 ? /^[0-9a-fA-F]{1,8}$/ : /^\d{1,9}$/
        if (!valid.test(digits)) {
            throw new RecipeError(`${quote(token)} at position ${m.index + 1} isn’t a ${radix === 16 ? 'hex' : 'decimal'} character code`)
        }
        const cp = parseInt(digits, radix)
        if (cp > 0x10ffff) throw new RecipeError(`${quote(token)} at position ${m.index + 1} is beyond the last Unicode code point (10FFFF in hex, 1114111)`)
        if (cp >= 0xd800 && cp <= 0xdfff) throw new RecipeError(`${quote(token)} at position ${m.index + 1} is a surrogate (D800–DFFF), which isn’t a character on its own`)
        out += String.fromCodePoint(cp)
    }
    return out
}

// ---------------------------------------------------------------- URL encoding

// application/x-www-form-urlencoded as URLSearchParams writes it
const formEncode = (text) =>
    encodeURIComponent(text)
        .replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(/%20/g, '+')

export function urlEncode(text, { mode = 'component' } = {}) {
    try {
        if (mode === 'full') return encodeURI(text)
        if (mode === 'form') return formEncode(text)
        return encodeURIComponent(text)
    } catch {
        throw new RecipeError('the text contains a broken character (half of an emoji or another character outside the Basic Multilingual Plane), which can’t be URL-encoded')
    }
}

// Points at the first escape that can't be decoded
function urlDecodeProblem(text) {
    const lone = /%(?![0-9a-fA-F]{2})/.exec(text)
    if (lone) {
        return `${quote(text.slice(lone.index, lone.index + 3))} at position ${lone.index + 1} isn’t a valid escape: % must be followed by two hex digits (a literal % is written %25)`
    }
    const runs = /(?:%[0-9a-fA-F]{2})+/g
    let m
    while ((m = runs.exec(text)) !== null) {
        try {
            decodeURIComponent(m[0])
        } catch {
            return `the escapes ${quote(m[0])} at position ${m.index + 1} aren’t valid UTF-8 (a multi-byte character is cut off or malformed)`
        }
    }
    return 'the text contains a malformed escape sequence'
}

export function urlDecode(text, { mode = 'component' } = {}) {
    const source = mode === 'form' ? text.replace(/\+/g, ' ') : text
    try {
        return mode === 'full' ? decodeURI(source) : decodeURIComponent(source)
    } catch {
        throw new RecipeError(urlDecodeProblem(source))
    }
}

// ---------------------------------------------------------------- HTML entities

// HTML 4 names (all valid in HTML5) used when encoding with named entities,
// the same set as the HTML Entity tool.
const LATIN1 = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
const GREEK_UPPER = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega'
const GREEK_LOWER = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega'
const OTHERS = 'OElig:338 oelig:339 Scaron:352 scaron:353 Yuml:376 fnof:402 circ:710 tilde:732 thetasym:977 upsih:978 piv:982 ensp:8194 emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 lrm:8206 rlm:8207 ndash:8211 mdash:8212 lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 dagger:8224 Dagger:8225 bull:8226 hellip:8230 permil:8240 prime:8242 Prime:8243 lsaquo:8249 rsaquo:8250 oline:8254 frasl:8260 euro:8364 image:8465 weierp:8472 real:8476 trade:8482 alefsym:8501 larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659 hArr:8660 forall:8704 part:8706 exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722 lowast:8727 radic:8730 prop:8733 infin:8734 ang:8736 and:8743 or:8744 cap:8745 cup:8746 int:8747 there4:8756 sim:8764 cong:8773 asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 sub:8834 sup:8835 nsub:8836 sube:8838 supe:8839 oplus:8853 otimes:8855 perp:8869 sdot:8901 lceil:8968 rceil:8969 lfloor:8970 rfloor:8971 loz:9674 spades:9824 clubs:9827 hearts:9829 diams:9830 starf:9733 star:9734 check:10003 cross:10007'

let encodeNames = null
function namedEntityFor(cp) {
    if (!encodeNames) {
        encodeNames = new Map()
        LATIN1.split(' ').forEach((name, i) => encodeNames.set(160 + i, name))
        GREEK_UPPER.split(' ').forEach((name, i) => name !== '-' && encodeNames.set(913 + i, name))
        GREEK_LOWER.split(' ').forEach((name, i) => encodeNames.set(945 + i, name))
        OTHERS.split(' ').forEach((pair) => {
            const [name, code] = pair.split(':')
            encodeNames.set(Number(code), name)
        })
    }
    return encodeNames.get(cp)
}

const SPECIALS = { 38: '&amp;', 60: '&lt;', 62: '&gt;', 34: '&quot;', 39: '&#39;' }

/**
 * scope: 'special' escapes & < > " ' only; 'all' also every non-ASCII and
 * control character (by code point, so an emoji becomes one entity).
 * format: 'named' (falls back to decimal), 'decimal' or 'hex'.
 */
export function htmlEncode(text, { scope = 'special', format = 'named' } = {}) {
    let out = ''
    for (const ch of text) {
        const cp = ch.codePointAt(0)
        const special = SPECIALS[cp]
        if (special) {
            out += special
            continue
        }
        const control = cp < 32 && cp !== 9 && cp !== 10 && cp !== 13
        if (scope === 'all' && (cp > 126 || control)) {
            const name = format === 'named' ? namedEntityFor(cp) : null
            out += name ? `&${name};` : format === 'hex' ? `&#x${cp.toString(16).toUpperCase()};` : `&#${cp};`
        } else {
            out += ch
        }
    }
    return out
}

// Numeric references to C1 controls mean Windows-1252 characters (HTML
// Standard, "numeric character reference end state")
const C1_REPLACEMENTS = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
    0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
    0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
    0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
}

function numericReference(cp) {
    if (!Number.isFinite(cp) || cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�'
    return String.fromCodePoint(C1_REPLACEMENTS[cp] ?? cp)
}

const REFERENCE = /&(?:#([xX])([0-9a-fA-F]+);?|#(\d+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g

/**
 * Decodes character references the way browsers do in text: every named
 * reference of the HTML Standard (`tables` from ./htmlEntities.js), legacy
 * names without the semicolon (&copy2024 → ©2024), and decimal and hex
 * references. Unknown "&name;" references are left as they are and listed
 * in `unknown`.
 */
export function htmlDecode(text, tables) {
    const { NAMED_REFERENCES, LEGACY_REFERENCES, LEGACY_MAX_LENGTH } = tables
    const unknown = []
    const out = text.replace(REFERENCE, (match, x, hex, dec, name, semicolon) => {
        if (hex !== undefined) return numericReference(hex.length > 8 ? Infinity : parseInt(hex, 16))
        if (dec !== undefined) return numericReference(dec.length > 9 ? Infinity : Number(dec))
        if (semicolon && NAMED_REFERENCES.has(name)) return NAMED_REFERENCES.get(name)
        for (let len = Math.min(name.length, LEGACY_MAX_LENGTH); len >= 2; len--) {
            const candidate = name.slice(0, len)
            if (LEGACY_REFERENCES.has(candidate)) return NAMED_REFERENCES.get(candidate) + name.slice(len) + semicolon
        }
        if (semicolon && unknown.length < 5 && !unknown.includes(match)) unknown.push(match)
        return match
    })
    return { text: out, unknown }
}

// ---------------------------------------------------------------- ROT13 / Caesar

export function rotate(text, amount = 13) {
    const shift = ((Math.trunc(amount) % 26) + 26) % 26
    if (!shift) return text
    return text.replace(/[A-Za-z]/g, (ch) => {
        const base = ch <= 'Z' ? 65 : 97
        return String.fromCharCode(((ch.charCodeAt(0) - base + shift) % 26) + base)
    })
}
