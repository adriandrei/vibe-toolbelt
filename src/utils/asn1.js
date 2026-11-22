// DER (and a little BER) decoding for certificates, keys and PKCS#7 bundles.
//
// parseDer(bytes) decodes one element into a tree of Asn1Node. Every length
// is checked against the bytes that are really there, nesting depth and the
// number of elements are capped, and truncated, overrunning or trailing data
// is rejected with an Asn1Error that says what is wrong and where. Encodings
// that break strict DER but are still unambiguous (a length written with more
// bytes than needed, say) are collected in `root.warnings` instead.
//
// The read* helpers decode the content of primitive elements (OID, INTEGER,
// BIT STRING, times, strings…). describeNode() and decodeEncapsulated() feed
// the raw tree view.
import { bytesToHex } from './encoding.js'

export class Asn1Error extends Error {
    constructor(message, offset) {
        super(offset === undefined ? message : `${message} (at byte ${offset})`)
        this.name = 'Asn1Error'
        this.offset = offset
    }
}

export const CLASS_UNIVERSAL = 0
export const CLASS_APPLICATION = 1
export const CLASS_CONTEXT = 2
export const CLASS_PRIVATE = 3

export const TAG = {
    EOC: 0,
    BOOLEAN: 1,
    INTEGER: 2,
    BIT_STRING: 3,
    OCTET_STRING: 4,
    NULL: 5,
    OID: 6,
    OBJECT_DESCRIPTOR: 7,
    REAL: 9,
    ENUMERATED: 10,
    UTF8_STRING: 12,
    RELATIVE_OID: 13,
    SEQUENCE: 16,
    SET: 17,
    NUMERIC_STRING: 18,
    PRINTABLE_STRING: 19,
    T61_STRING: 20,
    VIDEOTEX_STRING: 21,
    IA5_STRING: 22,
    UTC_TIME: 23,
    GENERALIZED_TIME: 24,
    GRAPHIC_STRING: 25,
    VISIBLE_STRING: 26,
    GENERAL_STRING: 27,
    UNIVERSAL_STRING: 28,
    BMP_STRING: 30,
}

const UNIVERSAL_NAMES = {
    0: 'END OF CONTENTS',
    1: 'BOOLEAN',
    2: 'INTEGER',
    3: 'BIT STRING',
    4: 'OCTET STRING',
    5: 'NULL',
    6: 'OBJECT IDENTIFIER',
    7: 'ObjectDescriptor',
    8: 'EXTERNAL',
    9: 'REAL',
    10: 'ENUMERATED',
    11: 'EMBEDDED PDV',
    12: 'UTF8String',
    13: 'RELATIVE-OID',
    14: 'TIME',
    16: 'SEQUENCE',
    17: 'SET',
    18: 'NumericString',
    19: 'PrintableString',
    20: 'TeletexString',
    21: 'VideotexString',
    22: 'IA5String',
    23: 'UTCTime',
    24: 'GeneralizedTime',
    25: 'GraphicString',
    26: 'VisibleString',
    27: 'GeneralString',
    28: 'UniversalString',
    29: 'CHARACTER STRING',
    30: 'BMPString',
    31: 'DATE',
    32: 'TIME-OF-DAY',
    33: 'DATE-TIME',
    34: 'DURATION',
}

const STRING_TAGS = new Set([
    TAG.OBJECT_DESCRIPTOR, TAG.UTF8_STRING, TAG.NUMERIC_STRING, TAG.PRINTABLE_STRING, TAG.T61_STRING,
    TAG.VIDEOTEX_STRING, TAG.IA5_STRING, TAG.GRAPHIC_STRING, TAG.VISIBLE_STRING, TAG.GENERAL_STRING,
    TAG.UNIVERSAL_STRING, TAG.BMP_STRING,
])

export const DEFAULT_MAX_DEPTH = 64
export const DEFAULT_MAX_NODES = 200_000

export class Asn1Node {
    constructor(bytes, offset, tagClass, constructed, tagNumber, headerLength, length) {
        this.bytes = bytes // the buffer this node was decoded from (shared by the whole tree)
        this.offset = offset // first byte of the tag
        this.tagClass = tagClass
        this.constructed = constructed
        this.tagNumber = tagNumber
        this.headerLength = headerLength // tag + length bytes
        this.length = length // content length (without the end-of-contents marker of BER indefinite lengths)
        this.indefinite = false
        this.end = offset + headerLength + length // first byte after the element
        this.children = null
    }

    get contentStart() {
        return this.offset + this.headerLength
    }

    /** The content bytes (a view, not a copy). */
    get content() {
        return this.bytes.subarray(this.contentStart, this.contentStart + this.length)
    }

    /** The whole element: tag, length and content (a view, not a copy). */
    get der() {
        return this.bytes.subarray(this.offset, this.end)
    }

    /** True for a universal (or the given class) element with this tag number. */
    is(tagNumber, tagClass = CLASS_UNIVERSAL) {
        return this.tagNumber === tagNumber && this.tagClass === tagClass
    }

    get typeName() {
        return tagName(this.tagClass, this.tagNumber)
    }
}

export function tagName(tagClass, tagNumber) {
    if (tagClass === CLASS_UNIVERSAL) return UNIVERSAL_NAMES[tagNumber] ?? `[UNIVERSAL ${tagNumber}]`
    if (tagClass === CLASS_CONTEXT) return `[${tagNumber}]`
    if (tagClass === CLASS_APPLICATION) return `[APPLICATION ${tagNumber}]`
    return `[PRIVATE ${tagNumber}]`
}

function toUint8Array(input) {
    if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    if (input instanceof ArrayBuffer) return new Uint8Array(input)
    throw new TypeError('Expected bytes (Uint8Array or ArrayBuffer)')
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Decodes one ASN.1 element (and everything inside it).
 * @param {Uint8Array|ArrayBuffer} input
 * @param {{ maxDepth?: number, maxNodes?: number, allowTrailing?: boolean, ber?: boolean }} [options]
 *   allowTrailing: don't reject bytes after the element (read `root.end`).
 *   ber: accept BER indefinite lengths on constructed elements (some PKCS#7 tools write them).
 * @returns {Asn1Node} the root, with `warnings` ({ message, offset }[]) for non-DER encodings
 */
export function parseDer(input, { maxDepth = DEFAULT_MAX_DEPTH, maxNodes = DEFAULT_MAX_NODES, allowTrailing = false, ber = false } = {}) {
    const bytes = toUint8Array(input)
    if (!bytes.length) throw new Asn1Error('There’s no data to decode')
    const ctx = { bytes, maxDepth, maxNodes, nodes: 0, ber, warnings: [] }
    const root = readElement(ctx, 0, bytes.length, 0)
    if (!allowTrailing && root.end < bytes.length) {
        throw new Asn1Error(`${plural(bytes.length - root.end, 'unexpected byte')} after the end of the data`, root.end)
    }
    root.warnings = ctx.warnings
    return root
}

/** Decodes consecutive top-level elements (e.g. DER certificates written one after another). */
export function parseDerAll(input, options = {}) {
    const bytes = toUint8Array(input)
    const out = []
    let pos = 0
    while (pos < bytes.length) {
        let node
        try {
            node = parseDer(bytes.subarray(pos), { ...options, allowTrailing: true })
        } catch (error) {
            if (error instanceof Asn1Error && error.offset !== undefined) throw new Asn1Error(error.message.replace(/ \(at byte \d+\)$/, ''), error.offset + pos)
            throw error
        }
        out.push(node)
        pos += node.end
    }
    if (!out.length) throw new Asn1Error('There’s no data to decode')
    return out
}

function warn(ctx, message, offset) {
    if (ctx.warnings.length < 50) ctx.warnings.push({ message, offset })
}

function readElement(ctx, start, limit, depth) {
    const { bytes } = ctx
    if (depth > ctx.maxDepth) throw new Asn1Error(`The data is nested more than ${ctx.maxDepth} levels deep`, start)
    if (++ctx.nodes > ctx.maxNodes) throw new Asn1Error(`The data has more than ${ctx.maxNodes.toLocaleString('en-US')} elements`, start)
    const inParent = limit < bytes.length
    let pos = start
    const first = bytes[pos++]
    const tagClass = first >> 6
    const constructed = (first & 0x20) !== 0
    let tagNumber = first & 0x1f
    if (tagNumber === 0x1f) {
        // High tag number form: base-128 digits, the last one without the top bit
        tagNumber = 0
        for (let count = 0; ; count++) {
            if (pos >= limit) throw new Asn1Error('Truncated data: the tag is cut off', start)
            const b = bytes[pos++]
            if (count === 0 && b === 0x80) throw new Asn1Error('Invalid tag: its number starts with a padding byte (0x80)', start)
            if (count === 4) throw new Asn1Error('Tag number is too large', start)
            tagNumber = tagNumber * 128 + (b & 0x7f)
            if (!(b & 0x80)) break
        }
        if (tagNumber < 31) warn(ctx, `Tag ${tagNumber} uses the multi-byte form, which DER reserves for tags of 31 and up`, start)
    }
    if (tagClass === CLASS_UNIVERSAL && tagNumber === TAG.EOC) {
        throw new Asn1Error('Unexpected end-of-contents marker (a 0x00 tag)', start)
    }

    if (pos >= limit) throw new Asn1Error('Truncated data: the length is missing', start)
    const lengthByte = bytes[pos++]
    let length = 0
    let indefinite = false
    if (lengthByte < 0x80) {
        length = lengthByte
    } else if (lengthByte === 0x80) {
        if (!constructed) throw new Asn1Error('Invalid length: a primitive element can’t have an indefinite length', start)
        if (!ctx.ber) throw new Asn1Error('Indefinite length (BER) isn’t allowed in DER', start)
        indefinite = true
    } else if (lengthByte === 0xff) {
        throw new Asn1Error('Invalid length byte 0xFF', start)
    } else {
        const count = lengthByte & 0x7f
        if (count > 4) throw new Asn1Error(`The length field is ${count} bytes long, which is too large`, start)
        if (pos + count > limit) throw new Asn1Error('Truncated data: the length is cut off', start)
        if (bytes[pos] === 0) warn(ctx, 'Length has a leading zero byte (not DER)', start)
        for (let i = 0; i < count; i++) length = length * 256 + bytes[pos++]
        if (length < 0x80) warn(ctx, `Length ${length} is written in the long form (not DER)`, start)
    }

    const headerLength = pos - start
    if (!indefinite && length > limit - pos) {
        const where = inParent ? 'its parent element has' : 'the data has'
        throw new Asn1Error(`Truncated data: an element needs ${plural(length, 'byte')} but ${where} only ${limit - pos} left`, start)
    }

    const node = new Asn1Node(bytes, start, tagClass, constructed, tagNumber, headerLength, indefinite ? 0 : length)
    if (!constructed) return node

    node.children = []
    if (indefinite) {
        node.indefinite = true
        let p = pos
        for (;;) {
            if (p + 1 >= limit) throw new Asn1Error('Truncated data: the end-of-contents marker is missing', start)
            if (bytes[p] === 0 && bytes[p + 1] === 0) {
                node.length = p - pos
                node.end = p + 2
                break
            }
            const child = readElement(ctx, p, limit, depth + 1)
            node.children.push(child)
            p = child.end
        }
    } else {
        const end = pos + length
        let p = pos
        while (p < end) {
            const child = readElement(ctx, p, end, depth + 1)
            node.children.push(child)
            p = child.end
        }
    }
    return node
}

// ---------------------------------------------------------------------------
// Value readers. They decode the content and don't insist on the universal
// tag, so they also work for IMPLICIT context-specific tags ([2] INTEGER…).
// ---------------------------------------------------------------------------

function primitiveContent(node, what) {
    if (node.constructed) throw new Asn1Error(`Expected a primitive ${what}, found a constructed ${node.typeName}`, node.offset)
    return node.content
}

export function readBoolean(node) {
    const c = primitiveContent(node, 'BOOLEAN')
    if (c.length !== 1) throw new Asn1Error(`A BOOLEAN must be 1 byte long, not ${c.length}`, node.offset)
    return c[0] !== 0
}

export function readNull(node) {
    const c = primitiveContent(node, 'NULL')
    if (c.length !== 0) throw new Asn1Error('A NULL must be empty', node.offset)
    return null
}

/** INTEGER (or ENUMERATED) as a BigInt (two’s complement). */
export function readInteger(node) {
    const c = primitiveContent(node, 'INTEGER')
    if (!c.length) throw new Asn1Error('Empty INTEGER', node.offset)
    let value = BigInt(`0x${bytesToHex(c)}`)
    if (c[0] & 0x80) value -= 1n << BigInt(c.length * 8)
    return value
}

/** A small non-negative INTEGER as a Number, checked against `max`. */
export function readSmallInteger(node, max = Number.MAX_SAFE_INTEGER) {
    const value = readInteger(node)
    if (value < 0n || value > BigInt(max)) throw new Asn1Error(`INTEGER ${value} is out of range (0–${max})`, node.offset)
    return Number(value)
}

/** True when an INTEGER uses more bytes than it needs (DER forbids it). */
export function isNonMinimalInteger(node) {
    const c = node.content
    return c.length > 1 && ((c[0] === 0x00 && !(c[1] & 0x80)) || (c[0] === 0xff && (c[1] & 0x80) !== 0))
}

/** The magnitude of a non-negative INTEGER as bytes, without the sign padding. */
export function integerBytes(node) {
    const c = primitiveContent(node, 'INTEGER')
    if (!c.length) throw new Asn1Error('Empty INTEGER', node.offset)
    let i = 0
    while (i < c.length - 1 && c[i] === 0) i++
    return c.subarray(i)
}

/** Number of significant bits of an unsigned big-endian byte string. */
export function bitLength(bytes) {
    let i = 0
    while (i < bytes.length && bytes[i] === 0) i++
    if (i === bytes.length) return 0
    return (bytes.length - i - 1) * 8 + (32 - Math.clz32(bytes[i]))
}

/** BIT STRING: { unusedBits, bytes, bitLength }. */
export function readBitString(node) {
    const c = primitiveContent(node, 'BIT STRING')
    if (!c.length) throw new Asn1Error('Invalid BIT STRING: the unused-bits byte is missing', node.offset)
    const unusedBits = c[0]
    if (unusedBits > 7) throw new Asn1Error(`Invalid BIT STRING: ${unusedBits} unused bits (the maximum is 7)`, node.offset)
    if (c.length === 1 && unusedBits !== 0) throw new Asn1Error('Invalid BIT STRING: unused bits in an empty string', node.offset)
    return { unusedBits, bytes: c.subarray(1), bitLength: (c.length - 1) * 8 - unusedBits }
}

/** Indices of the bits set in a BIT STRING (bit 0 is the most significant bit of the first byte). */
export function bitStringFlags(bitString) {
    const set = []
    for (let i = 0; i < bitString.bitLength; i++) {
        if (bitString.bytes[i >> 3] & (0x80 >> (i & 7))) set.push(i)
    }
    return set
}

function readSubidentifiers(node, what) {
    const c = primitiveContent(node, what)
    if (!c.length) throw new Asn1Error(`Empty ${what}`, node.offset)
    const out = []
    let value = 0n
    let started = false
    for (let i = 0; i < c.length; i++) {
        const b = c[i]
        if (!started && b === 0x80) throw new Asn1Error(`Invalid ${what}: a component starts with a padding byte (0x80)`, node.offset)
        started = true
        value = (value << 7n) | BigInt(b & 0x7f)
        if (!(b & 0x80)) {
            out.push(value)
            value = 0n
            started = false
        }
    }
    if (started) throw new Asn1Error(`Truncated ${what}: the last component is cut off`, node.offset)
    return out
}

/** OBJECT IDENTIFIER in dotted form ("1.2.840.113549.1.1.11"). */
export function readOid(node) {
    const [first, ...rest] = readSubidentifiers(node, 'OBJECT IDENTIFIER')
    const head = first < 40n ? [0n, first] : first < 80n ? [1n, first - 40n] : [2n, first - 80n]
    return [...head, ...rest].join('.')
}

export function readRelativeOid(node) {
    return readSubidentifiers(node, 'RELATIVE-OID').join('.')
}

// ---- Times ----

const UTC_TIME_RE = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})$/
const GENERALIZED_TIME_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(?:(\d{2})(\d{2})?)?(?:[.,](\d+))?(Z|[+-]\d{4})?$/

const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
const daysInMonth = (year, month) => [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]

function zoneOffsetMinutes(zone, text, type) {
    if (!zone || zone === 'Z') return 0
    const hours = Number(zone.slice(1, 3))
    const minutes = Number(zone.slice(3, 5))
    if (hours > 23 || minutes > 59) throw new Asn1Error(`Invalid ${type} “${text}”: bad time zone offset`)
    return (zone[0] === '-' ? -1 : 1) * (hours * 60 + minutes)
}

function timeToMs(type, text, year, month, day, hour, minute, second, millis, offsetMinutes) {
    if (month < 1 || month > 12) throw new Asn1Error(`Invalid ${type} “${text}”: month ${month}`)
    if (day < 1 || day > daysInMonth(year, month)) throw new Asn1Error(`Invalid ${type} “${text}”: day ${day} of month ${month}`)
    if (hour > 23 || minute > 59 || second > 59) throw new Asn1Error(`Invalid ${type} “${text}”: time of day out of range`)
    // setUTCFullYear, because Date.UTC maps years 0–99 to 1900–1999
    const date = new Date(0)
    date.setUTCFullYear(year, month - 1, day)
    date.setUTCHours(hour, minute, second, millis)
    return date.getTime() - offsetMinutes * 60_000
}

/**
 * UTCTime text → { type, text, ms, rfc5280 }. Two-digit years follow RFC 5280:
 * 50–99 are 1950–1999 and 00–49 are 2000–2049. `rfc5280` is false for the
 * forms RFC 5280 doesn't allow (no seconds, or a zone other than Z).
 */
export function parseUtcTime(text) {
    const m = UTC_TIME_RE.exec(text)
    if (!m) throw new Asn1Error(`Invalid UTCTime “${text}”`)
    const yy = Number(m[1])
    const year = yy >= 50 ? 1900 + yy : 2000 + yy
    const ms = timeToMs('UTCTime', text, year, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), 0, zoneOffsetMinutes(m[7], text, 'UTCTime'))
    return { type: 'UTCTime', text, ms, rfc5280: m[6] !== undefined && m[7] === 'Z' }
}

/**
 * GeneralizedTime text → { type, text, ms, rfc5280, localTime }. Accepts
 * fractional seconds and offsets; without a zone the time is local to an
 * unknown place, so it is read as UTC and `localTime` is set.
 */
export function parseGeneralizedTime(text) {
    const m = GENERALIZED_TIME_RE.exec(text)
    if (!m) throw new Asn1Error(`Invalid GeneralizedTime “${text}”`)
    const [, y, mo, d, h, mi, s, fraction, zone] = m
    if (fraction !== undefined && s === undefined) throw new Asn1Error(`Invalid GeneralizedTime “${text}”: a fraction needs seconds`)
    const millis = fraction ? Math.min(999, Math.round(Number(`0.${fraction}`) * 1000)) : 0
    const ms = timeToMs('GeneralizedTime', text, Number(y), Number(mo), Number(d), Number(h), Number(mi ?? 0), Number(s ?? 0), millis, zoneOffsetMinutes(zone, text, 'GeneralizedTime'))
    return {
        type: 'GeneralizedTime',
        text,
        ms,
        rfc5280: mi !== undefined && s !== undefined && fraction === undefined && zone === 'Z',
        localTime: zone === undefined,
    }
}

/** UTCTime or GeneralizedTime element → { type, text, ms, rfc5280 }. */
export function readTime(node) {
    const c = primitiveContent(node, 'time')
    const text = latin1(c)
    if (node.is(TAG.UTC_TIME)) return parseUtcTime(text)
    if (node.is(TAG.GENERALIZED_TIME)) return parseGeneralizedTime(text)
    throw new Asn1Error(`Expected a UTCTime or GeneralizedTime, found ${node.typeName}`, node.offset)
}

// ---- Strings ----

function latin1(bytes) {
    let out = ''
    for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
    return out
}

const utf8Decoder = new TextDecoder('utf-8')

export const isStringTag = (tagNumber) => STRING_TAGS.has(tagNumber)

/** True for universal string types (UTF8String, PrintableString, BMPString…). */
export const isStringNode = (node) => node.tagClass === CLASS_UNIVERSAL && STRING_TAGS.has(node.tagNumber)

/**
 * Decodes a string element. `as` overrides the type (for IMPLICIT tags, e.g.
 * readString(node, TAG.IA5_STRING) for a [2] dNSName). UTF8String uses
 * UTF-8 (invalid bytes become U+FFFD), BMPString UTF-16BE, UniversalString
 * UTF-32BE; the 8-bit types (Printable, IA5, Teletex…) are read as Latin-1,
 * which is the best guess for TeletexString in real certificates.
 */
export function readString(node, as = node.tagNumber) {
    const c = primitiveContent(node, 'string')
    if (as === TAG.UTF8_STRING) return utf8Decoder.decode(c)
    if (as === TAG.BMP_STRING) {
        if (c.length % 2) throw new Asn1Error('Invalid BMPString: odd number of bytes', node.offset)
        let out = ''
        for (let i = 0; i < c.length; i += 2) out += String.fromCharCode((c[i] << 8) | c[i + 1])
        return out
    }
    if (as === TAG.UNIVERSAL_STRING) {
        if (c.length % 4) throw new Asn1Error('Invalid UniversalString: length isn’t a multiple of 4', node.offset)
        let out = ''
        for (let i = 0; i < c.length; i += 4) {
            const cp = c[i] * 0x1000000 + (c[i + 1] << 16) + (c[i + 2] << 8) + c[i + 3]
            out += cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : '�'
        }
        return out
    }
    return latin1(c)
}

// ---------------------------------------------------------------------------
// Display helpers for the raw tree.
// ---------------------------------------------------------------------------

const HEX_PREVIEW_BYTES = 48
const TEXT_PREVIEW_CHARS = 300

export function hexPreview(bytes, max = HEX_PREVIEW_BYTES) {
    const shown = bytesToHex(bytes.subarray(0, max), true)
    return bytes.length > max ? `${shown}…` : shown
}

const truncateText = (text) => (text.length > TEXT_PREVIEW_CHARS ? `${text.slice(0, TEXT_PREVIEW_CHARS)}…` : text)
const isPrintableAscii = (bytes) => bytes.length > 0 && bytes.every(b => b >= 0x20 && b < 0x7f)

function formatTime(ms) {
    const iso = new Date(ms).toISOString()
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`
}

/**
 * A one-line summary of a node for the tree view: { name, value, size }.
 * `oidName(oid)` may return a friendly name for OIDs. Never throws: values
 * that can't be decoded are reported in `value` and `error` is set.
 */
export function describeNode(node, { oidName } = {}) {
    const name = node.typeName
    const size = node.constructed ? plural(node.children.length, 'element') : plural(node.length, 'byte')
    if (node.constructed) return { name, value: '', size }
    try {
        if (node.tagClass !== CLASS_UNIVERSAL) {
            const c = node.content
            return { name, value: isPrintableAscii(c) ? `“${truncateText(latin1(c))}”` : hexPreview(c), size }
        }
        switch (node.tagNumber) {
            case TAG.BOOLEAN:
                return { name, value: readBoolean(node) ? 'TRUE' : 'FALSE', size }
            case TAG.INTEGER:
            case TAG.ENUMERATED: {
                const c = node.content
                if (c.length <= 8) {
                    const v = readInteger(node)
                    return { name, value: v > 9n ? `${v} (0x${v.toString(16).toUpperCase()})` : String(v), size }
                }
                return { name, value: `${bitLength(integerBytes(node))}-bit · ${hexPreview(c)}`, size }
            }
            case TAG.BIT_STRING: {
                const bits = readBitString(node)
                return { name, value: `${plural(bits.bitLength, 'bit')}${bits.bytes.length ? ` · ${hexPreview(bits.bytes)}` : ''}`, size }
            }
            case TAG.OCTET_STRING:
                return { name, value: node.length ? hexPreview(node.content) : '(empty)', size }
            case TAG.NULL:
                readNull(node)
                return { name, value: '', size }
            case TAG.OID: {
                const oid = readOid(node)
                const friendly = oidName?.(oid)
                return { name, value: friendly ? `${oid} (${friendly})` : oid, size }
            }
            case TAG.RELATIVE_OID:
                return { name, value: readRelativeOid(node), size }
            case TAG.UTC_TIME:
            case TAG.GENERALIZED_TIME: {
                const t = readTime(node)
                return { name, value: `${t.text} · ${formatTime(t.ms)}`, size }
            }
            default:
                if (STRING_TAGS.has(node.tagNumber)) return { name, value: `“${truncateText(readString(node))}”`, size }
                return { name, value: node.length ? hexPreview(node.content) : '', size }
        }
    } catch (error) {
        return { name, value: `can’t decode: ${error.message}`, size, error: true }
    }
}

const ENCAPSULATED_PRIMITIVES = new Set([
    TAG.BOOLEAN, TAG.INTEGER, TAG.BIT_STRING, TAG.OCTET_STRING, TAG.OID,
    TAG.UTF8_STRING, TAG.PRINTABLE_STRING, TAG.IA5_STRING, TAG.BMP_STRING,
])

/**
 * DER nested inside an OCTET STRING or BIT STRING (extension values, public
 * keys, ECDSA signatures), decoded for the tree view. Returns
 * { root, base } where `base` is the offset of the inner data in the outer
 * buffer, or null when the content isn't exactly one well-formed element.
 */
export function decodeEncapsulated(node) {
    if (node.tagClass !== CLASS_UNIVERSAL || node.constructed) return null
    let data
    let base = node.contentStart
    if (node.tagNumber === TAG.OCTET_STRING) {
        data = node.content
    } else if (node.tagNumber === TAG.BIT_STRING) {
        const c = node.content
        // Only whole bytes holding a SEQUENCE (RSA keys, ECDSA signatures): raw
        // EC points start with 0x04 and would look like an OCTET STRING.
        if (c.length < 3 || c[0] !== 0 || c[1] !== 0x30) return null
        data = c.subarray(1)
        base += 1
    } else {
        return null
    }
    if (data.length < 2) return null
    try {
        const root = parseDer(data, { maxDepth: 32, maxNodes: 20_000 })
        if (!root.constructed && !(root.tagClass === CLASS_UNIVERSAL && ENCAPSULATED_PRIMITIVES.has(root.tagNumber))) return null
        return { root, base }
    } catch {
        return null
    }
}
