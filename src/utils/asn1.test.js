import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import {
    Asn1Error,
    CLASS_APPLICATION,
    CLASS_CONTEXT,
    TAG,
    bitLength,
    bitStringFlags,
    decodeEncapsulated,
    describeNode,
    integerBytes,
    isNonMinimalInteger,
    parseDer,
    parseDerAll,
    parseGeneralizedTime,
    parseUtcTime,
    readBitString,
    readBoolean,
    readInteger,
    readNull,
    readOid,
    readSmallInteger,
    readString,
    readTime,
} from './asn1.js'

const fixture = (name) => readFileSync(new URL(`../../tests/fixtures/certs/${name}`, import.meta.url))
const hex = (text) => Uint8Array.from(text.replace(/\s+/g, '').match(/../g) ?? [], (h) => parseInt(h, 16))
const parse = (text, options) => parseDer(hex(text), options)
const ascii = (text) => [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')

function lengthBytes(n) {
    if (n < 0x80) return [n]
    const out = []
    for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff)
    return [0x80 | out.length, ...out]
}

// SEQUENCEs nested `depth` times around a NULL, built without O(n²) copying.
function nested(depth) {
    const lengths = [2] // element length at each level, innermost first
    for (let i = 0; i < depth; i++) lengths.push(lengths[i] + 1 + lengthBytes(lengths[i]).length)
    const out = new Uint8Array(lengths[depth])
    let pos = 0
    for (let level = depth; level > 0; level--) {
        const header = [0x30, ...lengthBytes(lengths[level - 1])]
        out.set(header, pos)
        pos += header.length
    }
    out.set([0x05, 0x00], pos)
    return out
}

// Elements as listed by `openssl asn1parse` (offset, depth, header length, length, constructed)
function opensslElements(text) {
    return text.split(/\r?\n/).filter(Boolean).map((line) => {
        const m = /^\s*(\d+):d=(\d+)\s+hl=(\d+)\s+l=\s*(\d+)\s+(cons|prim):/.exec(line)
        if (!m) throw new Error(`Unexpected asn1parse line: ${line}`)
        return { offset: +m[1], depth: +m[2], headerLength: +m[3], length: +m[4], constructed: m[5] === 'cons' }
    })
}

function walk(node, depth = 0, out = []) {
    out.push({ offset: node.offset, depth, headerLength: node.headerLength, length: node.length, constructed: node.constructed })
    for (const child of node.children ?? []) walk(child, depth + 1, out)
    return out
}

function pemToDer(pem) {
    const body = pem.toString().split('-----BEGIN CERTIFICATE-----')[1].split('-----END CERTIFICATE-----')[0]
    return new Uint8Array(Buffer.from(body.replace(/\s+/g, ''), 'base64'))
}

// Small deterministic PRNG for the fuzz tests
function mulberry32(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function expectParsesOrAsn1Error(bytes, options) {
    try {
        parseDer(bytes, options)
    } catch (error) {
        if (!(error instanceof Asn1Error)) throw error
    }
}

describe('parseDer: structure', () => {
    it('decodes short-form TLVs and nested children', () => {
        const root = parse('30 06 02 01 05 01 01 ff')
        expect(root.is(TAG.SEQUENCE)).toBe(true)
        expect(root.constructed).toBe(true)
        expect(root.headerLength).toBe(2)
        expect(root.length).toBe(6)
        expect(root.end).toBe(8)
        expect(root.children).toHaveLength(2)
        expect(readInteger(root.children[0])).toBe(5n)
        expect(readBoolean(root.children[1])).toBe(true)
        expect(root.children[1].offset).toBe(5)
        expect([...root.children[1].der]).toEqual([0x01, 0x01, 0xff])
        expect(root.warnings).toEqual([])
    })

    it('decodes long-form lengths', () => {
        const short = parseDer(Uint8Array.of(0x04, 0x81, 0xc8, ...new Uint8Array(200)))
        expect(short.headerLength).toBe(3)
        expect(short.length).toBe(200)
        const long = parseDer(Uint8Array.of(0x04, 0x82, 0x01, 0x2c, ...new Uint8Array(300)))
        expect(long.headerLength).toBe(4)
        expect(long.length).toBe(300)
        expect(long.warnings).toEqual([])
    })

    it('decodes multi-byte tag numbers and every tag class', () => {
        const app = parse('5f 81 00 01 ff') // [APPLICATION 128], primitive
        expect(app.tagClass).toBe(CLASS_APPLICATION)
        expect(app.tagNumber).toBe(128)
        expect(app.headerLength).toBe(4)
        expect(app.typeName).toBe('[APPLICATION 128]')
        const ctx = parse('bf 1f 03 02 01 07') // [31], constructed
        expect(ctx.tagClass).toBe(CLASS_CONTEXT)
        expect(ctx.tagNumber).toBe(31)
        expect(ctx.typeName).toBe('[31]')
        expect(readInteger(ctx.children[0])).toBe(7n)
        expect(parse('c5 00').typeName).toBe('[PRIVATE 5]')
    })

    it('matches openssl asn1parse element by element on real files', () => {
        for (const [file, der] of [
            ['rsa-san.asn1parse.txt', new Uint8Array(fixture('rsa-san.der'))],
            ['chain-leaf.asn1parse.txt', pemToDer(fixture('chain-leaf.pem'))],
            ['chain.p7b.asn1parse.txt', new Uint8Array(fixture('chain.p7b'))],
        ]) {
            const expected = opensslElements(fixture(file).toString())
            const actual = walk(parseDer(der))
            expect(actual, file).toEqual(expected)
        }
    })

    it('reads consecutive elements with parseDerAll', () => {
        const nodes = parseDerAll(hex('05 00 02 01 2a'))
        expect(nodes).toHaveLength(2)
        expect(readInteger(nodes[1])).toBe(42n)
        expect(() => parseDerAll(hex('05 00 02 05 01'))).toThrow(/needs 5 bytes.*\(at byte 2\)/)
    })

    it('accepts BER indefinite lengths only when asked', () => {
        expect(() => parse('30 80 05 00 00 00')).toThrow(/Indefinite length \(BER\) isn’t allowed in DER \(at byte 0\)/)
        const root = parse('30 80 05 00 00 00', { ber: true })
        expect(root.indefinite).toBe(true)
        expect(root.children).toHaveLength(1)
        expect(root.length).toBe(2)
        expect(root.end).toBe(6)
        expect(() => parse('30 80 05 00', { ber: true })).toThrow(/end-of-contents marker is missing/)
        expect(() => parse('04 80 00 00', { ber: true })).toThrow(/primitive element can’t have an indefinite length/)
    })

    it('collects non-DER length encodings as warnings', () => {
        const longForm = parse('04 81 02 aa bb')
        expect(longForm.length).toBe(2)
        expect(longForm.warnings.map((w) => w.message)).toEqual(['Length 2 is written in the long form (not DER)'])
        const padded = parseDer(Uint8Array.of(0x04, 0x82, 0x00, 0x81, ...new Uint8Array(0x81)))
        expect(padded.warnings[0].message).toMatch(/leading zero byte/)
        expect(parse('1f 05 00').warnings[0].message).toMatch(/multi-byte form/)
    })
})

describe('parseDer: malformed input', () => {
    const cases = [
        ['empty input', '', /no data to decode/],
        ['a lone tag', '30', /the length is missing \(at byte 0\)/],
        ['a cut-off multi-byte tag', '1f 81', /the tag is cut off/],
        ['a padded multi-byte tag', '1f 80 01 00', /padding byte/],
        ['a huge tag number', '1f ff ff ff ff 7f 00', /Tag number is too large/],
        ['a cut-off long length', '04 82 01', /the length is cut off/],
        ['a 5-byte length field', '04 85 00 00 00 00 01 00', /length field is 5 bytes long/],
        ['length byte 0xFF', '04 ff', /Invalid length byte 0xFF/],
        ['truncated content', '30 05 02 01', /needs 5 bytes but the data has only 2 left \(at byte 0\)/],
        ['a child overrunning its parent', '30 03 02 05 01 02 03', /needs 5 bytes but its parent element has only 1 left \(at byte 2\)/],
        ['trailing bytes', '05 00 00', /1 unexpected byte after the end of the data \(at byte 2\)/],
        ['many trailing bytes', '05 00 01 02 03', /3 unexpected bytes after the end/],
        ['a stray end-of-contents marker', '30 02 00 00', /Unexpected end-of-contents marker \(a 0x00 tag\) \(at byte 2\)/],
        ['a length claiming 4 GB', '04 84 ff ff ff ff 00', /needs 4294967295 bytes/],
    ]
    for (const [name, input, message] of cases) {
        it(`rejects ${name}`, () => {
            expect(() => parse(input)).toThrow(Asn1Error)
            expect(() => parse(input)).toThrow(message)
        })
    }

    it('allows trailing bytes when asked, and reports where the element ends', () => {
        const root = parse('05 00 ff ff', { allowTrailing: true })
        expect(root.end).toBe(2)
    })

    it('limits the nesting depth without overflowing the stack', () => {
        expect(() => parseDer(nested(64))).not.toThrow() // NULL at depth 64
        expect(() => parseDer(nested(65))).toThrow(/nested more than 64 levels deep/)
        const started = Date.now()
        expect(() => parseDer(nested(100_000))).toThrow(/nested more than 64 levels deep/)
        expect(() => parseDer(nested(20), { maxDepth: 10 })).toThrow(/more than 10 levels/)
        expect(Date.now() - started).toBeLessThan(2000)
    })

    it('limits the number of elements', () => {
        const count = 200_001
        const content = new Uint8Array(count * 2)
        for (let i = 0; i < content.length; i += 2) content[i] = 0x05
        const header = Uint8Array.of(0x30, ...lengthBytes(content.length))
        const all = new Uint8Array(header.length + content.length)
        all.set(header)
        all.set(content, header.length)
        expect(() => parseDer(all)).toThrow(/more than 200,000 elements/)
        expect(() => parse('30 06 05 00 05 00 05 00', { maxNodes: 3 })).toThrow(/more than 3 elements/)
    })

    it('rejects every truncation of a real certificate', () => {
        const der = new Uint8Array(fixture('rsa-san.der'))
        for (let i = 1; i < der.length; i++) {
            let error
            try {
                parseDer(der.subarray(0, i))
            } catch (e) {
                error = e
            }
            expect(error, `prefix of ${i} bytes`).toBeInstanceOf(Asn1Error)
            expect(error.message).toMatch(/^Truncated data/)
        }
    })

    it('never crashes or hangs on corrupted certificates', () => {
        const der = pemToDer(fixture('chain-leaf.pem'))
        const started = Date.now()
        for (let i = 0; i < der.length; i++) {
            for (const value of [0x00, 0x80, 0x84, 0xff, der[i] ^ 0x20]) {
                const copy = der.slice()
                copy[i] = value
                expectParsesOrAsn1Error(copy)
                expectParsesOrAsn1Error(copy, { ber: true })
            }
        }
        expect(Date.now() - started).toBeLessThan(10_000)
    })

    it('never crashes or hangs on random garbage', () => {
        const random = mulberry32(1234)
        const started = Date.now()
        for (let n = 0; n < 20_000; n++) {
            const bytes = new Uint8Array(1 + Math.floor(random() * 64))
            for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256)
            if (n % 2) bytes[0] = 0x30 // mostly well-formed headers reach deeper code
            expectParsesOrAsn1Error(bytes)
            expectParsesOrAsn1Error(bytes, { ber: true })
        }
        expect(Date.now() - started).toBeLessThan(10_000)
    })
})

describe('OBJECT IDENTIFIER', () => {
    // Encodings produced by `openssl asn1parse -genstr OID:…`
    it.each([
        ['06092a864886f70d01010b', '1.2.840.113549.1.1.11'],
        ['06028837', '2.999'],
        ['06146983f09da7ebcfdee0c7a1a7b2c0948cc8f9d776', '2.25.329800735698586629295641978511506172918'],
        ['060a0992268993f22c640119', '0.9.2342.19200300.100.1.25'],
        ['0603551d11', '2.5.29.17'],
    ])('%s is %s', (encoded, oid) => {
        expect(readOid(parse(encoded))).toBe(oid)
    })

    it('rejects malformed OIDs', () => {
        expect(() => readOid(parse('06 00'))).toThrow(/Empty OBJECT IDENTIFIER/)
        expect(() => readOid(parse('06 02 80 01'))).toThrow(/padding byte/)
        expect(() => readOid(parse('06 02 2a 86'))).toThrow(/last component is cut off/)
        expect(() => readOid(parse('26 03 06 01 2a'))).toThrow(/Expected a primitive OBJECT IDENTIFIER/)
    })
})

describe('INTEGER, BOOLEAN, NULL, BIT STRING', () => {
    it('decodes two’s complement integers (encodings from openssl)', () => {
        expect(readInteger(parse('02 01 00'))).toBe(0n)
        expect(readInteger(parse('02 01 7f'))).toBe(127n)
        expect(readInteger(parse('02 02 00 80'))).toBe(128n)
        expect(readInteger(parse('02 01 80'))).toBe(-128n)
        expect(readInteger(parse('02 02 ff 7f'))).toBe(-129n)
        // 19 bytes with the top bit set: the value minus 2^152
        expect(readInteger(parse('02 13 f1 e2 d3 c4 b5 a6 97 88 79 6a 5b 4c 3d 2e 1f 00 11 22 33'))).toBe(0xf1e2d3c4b5a69788796a5b4c3d2e1f00112233n - (1n << 152n))
        expect(readInteger(parse('02 14 00 f1 e2 d3 c4 b5 a6 97 88 79 6a 5b 4c 3d 2e 1f 00 11 22 33'))).toBe(0xf1e2d3c4b5a69788796a5b4c3d2e1f00112233n)
        expect(() => readInteger(parse('02 00'))).toThrow(/Empty INTEGER/)
    })

    it('reads small integers with range checks', () => {
        expect(readSmallInteger(parse('02 01 02'))).toBe(2)
        expect(() => readSmallInteger(parse('02 01 ff'))).toThrow(/out of range/)
        expect(() => readSmallInteger(parse('02 01 09'), 8)).toThrow(/out of range \(0–8\)/)
    })

    it('finds non-minimal integers and strips sign padding', () => {
        expect(isNonMinimalInteger(parse('02 02 00 7f'))).toBe(true)
        expect(isNonMinimalInteger(parse('02 02 ff 80'))).toBe(true)
        expect(isNonMinimalInteger(parse('02 02 00 80'))).toBe(false)
        expect([...integerBytes(parse('02 03 00 ff 01'))]).toEqual([0xff, 0x01])
        expect([...integerBytes(parse('02 01 00'))]).toEqual([0])
        expect(bitLength(Uint8Array.of(0x00, 0x01, 0x00))).toBe(9)
        expect(bitLength(Uint8Array.of(0x80, 0, 0))).toBe(24)
        expect(bitLength(Uint8Array.of(0, 0))).toBe(0)
    })

    it('decodes BOOLEAN and NULL strictly', () => {
        expect(readBoolean(parse('01 01 00'))).toBe(false)
        expect(readBoolean(parse('01 01 ff'))).toBe(true)
        expect(() => readBoolean(parse('01 02 00 00'))).toThrow(/must be 1 byte long, not 2/)
        expect(readNull(parse('05 00'))).toBe(null)
        expect(() => readNull(parse('05 01 00'))).toThrow(/must be empty/)
    })

    it('decodes BIT STRINGs and their named bits', () => {
        // keyUsage digitalSignature + keyEncipherment, as `-genstr FORMAT:BITLIST,BITSTRING:0,2` encodes it
        const usage = readBitString(parse('03 02 05 a0'))
        expect(usage.unusedBits).toBe(5)
        expect(usage.bitLength).toBe(3)
        expect(bitStringFlags(usage)).toEqual([0, 2])
        expect(bitStringFlags(readBitString(parse('03 03 07 86 80')))).toEqual([0, 5, 6, 8])
        expect(readBitString(parse('03 01 00')).bitLength).toBe(0)
        expect(() => readBitString(parse('03 00'))).toThrow(/unused-bits byte is missing/)
        expect(() => readBitString(parse('03 02 08 00'))).toThrow(/8 unused bits/)
        expect(() => readBitString(parse('03 01 03'))).toThrow(/unused bits in an empty string/)
    })
})

describe('times', () => {
    const iso = (t) => new Date(t.ms).toISOString()

    it('maps two-digit UTCTime years as RFC 5280 says (50–99 → 19xx)', () => {
        expect(iso(parseUtcTime('990101000000Z'))).toBe('1999-01-01T00:00:00.000Z')
        expect(iso(parseUtcTime('500101000000Z'))).toBe('1950-01-01T00:00:00.000Z')
        expect(iso(parseUtcTime('491231235959Z'))).toBe('2049-12-31T23:59:59.000Z')
        expect(iso(parseUtcTime('000229120000Z'))).toBe('2000-02-29T12:00:00.000Z')
        expect(parseUtcTime('990101000000Z').rfc5280).toBe(true)
    })

    it('accepts the other UTCTime forms but flags them', () => {
        const noSeconds = parseUtcTime('2611211830Z')
        expect(iso(noSeconds)).toBe('2026-11-21T18:30:00.000Z')
        expect(noSeconds.rfc5280).toBe(false)
        const offset = parseUtcTime('990101000000+0130')
        expect(iso(offset)).toBe('1998-12-31T22:30:00.000Z')
        expect(offset.rfc5280).toBe(false)
        expect(iso(parseUtcTime('990101000000-0500'))).toBe('1999-01-01T05:00:00.000Z')
    })

    it('rejects impossible UTCTimes', () => {
        for (const bad of ['990230000000Z', '991301000000Z', '990101240000Z', '990101006000Z', '010229000000Z', '9901010000', '990101000000+2400', 'abcdefghijklZ']) {
            expect(() => parseUtcTime(bad), bad).toThrow(Asn1Error)
        }
    })

    it('decodes GeneralizedTime, including far-future and early years', () => {
        const far = parseGeneralizedTime('20510101000000Z')
        expect(iso(far)).toBe('2051-01-01T00:00:00.000Z')
        expect(far.rfc5280).toBe(true)
        expect(iso(parseGeneralizedTime('99991231235959Z'))).toBe('9999-12-31T23:59:59.000Z')
        expect(new Date(parseGeneralizedTime('00500101000000Z').ms).getUTCFullYear()).toBe(50) // not 1950
        expect(iso(parseGeneralizedTime('20000229000000Z'))).toBe('2000-02-29T00:00:00.000Z')
    })

    it('handles GeneralizedTime fractions, offsets and missing zones', () => {
        const fraction = parseGeneralizedTime('20260101120000.5Z')
        expect(iso(fraction)).toBe('2026-01-01T12:00:00.500Z')
        expect(fraction.rfc5280).toBe(false)
        expect(iso(parseGeneralizedTime('20260101120000,123456Z'))).toBe('2026-01-01T12:00:00.123Z')
        expect(iso(parseGeneralizedTime('20260101120000-0500'))).toBe('2026-01-01T17:00:00.000Z')
        expect(iso(parseGeneralizedTime('2026010112Z'))).toBe('2026-01-01T12:00:00.000Z')
        const local = parseGeneralizedTime('20260101120000')
        expect(local.localTime).toBe(true)
        expect(local.rfc5280).toBe(false)
        for (const bad of ['202601011200.5Z', '21000229000000Z', '20261131000000Z', '2026', '20260101120000Q']) {
            expect(() => parseGeneralizedTime(bad), bad).toThrow(Asn1Error)
        }
    })

    it('reads time elements (encodings from openssl)', () => {
        expect(iso(readTime(parse('170d3939303130313030303030305a')))).toBe('1999-01-01T00:00:00.000Z')
        const gen = readTime(parse('180f32303531303130313030303030305a'))
        expect(gen.type).toBe('GeneralizedTime')
        expect(iso(gen)).toBe('2051-01-01T00:00:00.000Z')
        expect(() => readTime(parse(`04 0d ${ascii('990101000000Z')}`))).toThrow(/Expected a UTCTime or GeneralizedTime/)
    })
})

describe('strings', () => {
    it('decodes each string type', () => {
        expect(readString(parse('0c 03 e2 82 ac'))).toBe('€') // UTF8String
        expect(readString(parse('0c 01 ff'))).toBe('�') // invalid UTF-8 is replaced, not thrown
        expect(readString(parse('1e0400490061'))).toBe('Ia') // BMPString (openssl -genstr)
        expect(readString(parse('1e 04 00 49 02 19'))).toBe('Iș')
        expect(readString(parse('1c0400000041'))).toBe('A') // UniversalString (openssl -genstr)
        expect(readString(parse('1c 04 00 01 f6 00'))).toBe('😀')
        expect(readString(parse('1c 04 00 11 00 00'))).toBe('�')
        expect(readString(parse('14 03 dc 6e ef'))).toBe('Ünï') // TeletexString read as Latin-1
        expect(readString(parse(`16 05 ${ascii('hello')}`))).toBe('hello')
        expect(readString(parse(`13 02 ${ascii('RO')}`))).toBe('RO')
    })

    it('rejects malformed wide strings', () => {
        expect(() => readString(parse('1e 03 00 49 00'))).toThrow(/odd number of bytes/)
        expect(() => readString(parse('1c 03 00 00 41'))).toThrow(/multiple of 4/)
    })

    it('reads IMPLICIT context-tagged strings with an explicit type', () => {
        expect(readString(parse(`82 03 ${ascii('abc')}`), TAG.IA5_STRING)).toBe('abc')
    })
})

describe('tree helpers', () => {
    it('summarises nodes for display', () => {
        expect(describeNode(parse('02 03 01 00 01'))).toEqual({ name: 'INTEGER', value: '65537 (0x10001)', size: '3 bytes' })
        expect(describeNode(parse('02 01 05')).value).toBe('5')
        expect(describeNode(parse('06 03 55 1d 11'), { oidName: (oid) => (oid === '2.5.29.17' ? 'subjectAltName' : undefined) }).value).toBe('2.5.29.17 (subjectAltName)')
        expect(describeNode(parse('30 03 01 01 ff'))).toEqual({ name: 'SEQUENCE', value: '', size: '1 element' })
        expect(describeNode(parse('01 01 ff')).value).toBe('TRUE')
        expect(describeNode(parse(`82 03 ${ascii('abc')}`)).value).toBe('“abc”')
        expect(describeNode(parse('87 04 c0 00 02 0a')).value).toBe('C000020A')
        expect(describeNode(parse('170d3939303130313030303030305a')).value).toBe('990101000000Z · 1999-01-01 00:00:00 UTC')
        expect(describeNode(parse('03 02 05 a0')).value).toBe('3 bits · A0')
        const big = describeNode(parseDer(Uint8Array.of(0x02, 0x09, 0x00, 0xff, 1, 2, 3, 4, 5, 6, 7)))
        expect(big.value).toBe('64-bit · 00FF01020304050607')
    })

    it('reports values it can’t decode instead of throwing', () => {
        const bad = describeNode(parse(`17 0d ${ascii('991399000000Z')}`))
        expect(bad.error).toBe(true)
        expect(bad.value).toMatch(/^can’t decode: Invalid UTCTime/)
    })

    it('finds DER nested in OCTET STRINGs and BIT STRINGs', () => {
        const octets = parse('04 05 30 03 02 01 05')
        const inner = decodeEncapsulated(octets)
        expect(inner.base).toBe(2)
        expect(inner.root.is(TAG.SEQUENCE)).toBe(true)
        expect(readInteger(inner.root.children[0])).toBe(5n)
        const bits = decodeEncapsulated(parse('03 06 00 30 03 02 01 05'))
        expect(bits.base).toBe(3)
        expect(bits.root.children).toHaveLength(1)
        const ski = decodeEncapsulated(parseDer(Uint8Array.of(0x04, 0x16, 0x04, 0x14, ...new Uint8Array(20).fill(7))))
        expect(ski.root.is(TAG.OCTET_STRING)).toBe(true)
    })

    it('leaves raw data alone', () => {
        expect(decodeEncapsulated(parse('03 05 00 04 01 02 03'))).toBe(null) // EC point, not an OCTET STRING
        expect(decodeEncapsulated(parse('04 02 05 00'))).toBe(null) // a bare NULL is too likely to be chance
        expect(decodeEncapsulated(parse('04 03 30 05 01'))).toBe(null) // truncated
        expect(decodeEncapsulated(parse('04 04 02 01 05 00'))).toBe(null) // trailing byte
        expect(decodeEncapsulated(parse('02 01 05'))).toBe(null)
    })
})
