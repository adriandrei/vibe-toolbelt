import { describe, expect, it } from 'vitest'
import {
    base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, bytesToHex, concatBytes, decodeSecret, encodeBytes,
    hasLoneSurrogates, hexToBytes, parseDigest, timingSafeEqual, utf8Decode, utf8Encode, utf8Length,
} from './encoding'

const b = (...n) => Uint8Array.from(n)

describe('utf8', () => {
    it('encodes and decodes', () => {
        expect([...utf8Encode('€')]).toEqual([0xe2, 0x82, 0xac])
        expect(utf8Decode(b(0xf0, 0x9f, 0x98, 0x80))).toBe('😀')
        expect(utf8Encode(null)).toHaveLength(0)
        expect(utf8Encode(42)).toEqual(b(0x34, 0x32))
    })
    it('replaces lone surrogates with U+FFFD when encoding', () => {
        expect([...utf8Encode('\ud800')]).toEqual([0xef, 0xbf, 0xbd])
    })
    it('fatal decoding throws on invalid bytes, lenient decoding substitutes', () => {
        expect(() => utf8Decode(b(0xff), { fatal: true })).toThrow()
        expect(utf8Decode(b(0xff))).toBe('�')
    })
    it('detects lone surrogates', () => {
        expect(hasLoneSurrogates('a\ud800b')).toBe(true)
        expect(hasLoneSurrogates('\udc00')).toBe(true)
        expect(hasLoneSurrogates('😀')).toBe(false)
        expect(hasLoneSurrogates(5)).toBe(false)
    })
    it('utf8Length matches the encoder for all character classes', () => {
        for (const s of ['', 'abc', 'é', '€', '😀', 'a\ud800', '\udc00x', '😀😀', '日本語 ok']) {
            expect(utf8Length(s)).toBe(utf8Encode(s).length)
        }
    })
})

describe('hex', () => {
    it('encodes lower and upper case', () => {
        expect(bytesToHex(b(0, 15, 16, 255))).toBe('000f10ff')
        expect(bytesToHex(b(0xab, 0xcd), true)).toBe('ABCD')
    })
    it('decodes separators, spaces, colons and 0x prefix', () => {
        expect([...hexToBytes('0A 1b:FF')]).toEqual([10, 27, 255])
        expect([...hexToBytes('0xdeadBEEF')]).toEqual([0xde, 0xad, 0xbe, 0xef])
        expect(hexToBytes('')).toHaveLength(0)
    })
    it('explains errors', () => {
        expect(() => hexToBytes('abc')).toThrow('Hex needs an even number of digits (got 3)')
        expect(() => hexToBytes('zz')).toThrow(/“z” isn't a hex digit/)
    })
})

describe('base64', () => {
    it('encodes with the standard and URL-safe alphabets', () => {
        expect(bytesToBase64(b(0xfb, 0xff))).toBe('+/8=')
        expect(bytesToBase64Url(b(0xfb, 0xff))).toBe('-_8')
        expect(bytesToBase64(utf8Encode('foobar'))).toBe('Zm9vYmFy')
    })
    it('decodes both alphabets with or without padding and ignores whitespace', () => {
        expect([...base64ToBytes('+/8=')]).toEqual([0xfb, 0xff])
        expect([...base64ToBytes('-_8')]).toEqual([0xfb, 0xff])
        expect([...base64ToBytes('Zm9v\n YmFy')]).toEqual([...utf8Encode('foobar')])
        expect(base64ToBytes('')).toHaveLength(0)
    })
    it('validates', () => {
        expect(() => base64ToBytes('a$b=')).toThrow('“$” isn\'t a Base64 character')
        expect(() => base64ToBytes('ab=c')).toThrow(/padding \(=\) can only appear at the end/)
        expect(() => base64ToBytes('a===')).toThrow(/Too much Base64 padding/)
        expect(() => base64ToBytes('abcde')).toThrow(/length is invalid/)
    })
    it('base64UrlToBytes is strict (JWT style)', () => {
        expect([...base64UrlToBytes('-_8')]).toEqual([0xfb, 0xff])
        expect(() => base64UrlToBytes('-_8=')).toThrow(/no “=” padding/)
        expect(() => base64UrlToBytes('+/8')).toThrow(/“\+” isn't a Base64url character/)
    })
    it('round-trips arbitrary bytes', () => {
        const all = Uint8Array.from({ length: 256 }, (_, i) => i)
        expect([...base64ToBytes(bytesToBase64(all))]).toEqual([...all])
        expect([...base64UrlToBytes(bytesToBase64Url(all))]).toEqual([...all])
    })
})

describe('concatBytes / timingSafeEqual', () => {
    it('concatenates', () => {
        expect([...concatBytes(b(1), b(), b(2, 3))]).toEqual([1, 2, 3])
        expect(concatBytes()).toHaveLength(0)
    })
    it('compares', () => {
        expect(timingSafeEqual(b(1, 2), b(1, 2))).toBe(true)
        expect(timingSafeEqual(b(1, 2), b(1, 3))).toBe(false)
        expect(timingSafeEqual(b(1, 2), b(1))).toBe(false)
        expect(timingSafeEqual(null, b(1))).toBe(false)
        expect(timingSafeEqual(b(), b())).toBe(true)
    })
})

describe('encodeBytes / parseDigest / decodeSecret', () => {
    const d = b(0xfb, 0xff, 0x01)
    it('formats a digest', () => {
        expect(encodeBytes(d)).toBe('fbff01')
        expect(encodeBytes(d, 'HEX')).toBe('FBFF01')
        expect(encodeBytes(d, 'base64')).toBe('+/8B')
        expect(encodeBytes(d, 'base64url')).toBe('-_8B')
        expect(encodeBytes(null)).toBe('')
    })
    it('parses hex and Base64 digests, with webhook-style prefixes', () => {
        expect(parseDigest('sha256=ABCD')).toEqual({ bytes: b(0xab, 0xcd), encoding: 'hex' })
        expect(parseDigest('0xabcd')).toMatchObject({ encoding: 'hex' })
        expect(parseDigest('v1=+/8B')).toEqual({ bytes: d, encoding: 'Base64' })
        expect(parseDigest('  ab cd  ').bytes).toEqual(b(0xab, 0xcd))
    })
    it('treats odd-length hex-looking text as Base64 and rejects empty input', () => {
        expect(parseDigest('abc').encoding).toBe('Base64') // "abc" is also valid unpadded Base64
        expect(() => parseDigest('')).toThrow('Empty')
        expect(() => parseDigest('sha256=')).toThrow('Empty')
    })
    it('decodes secrets by declared encoding', () => {
        expect([...decodeSecret('é', 'text')]).toEqual([0xc3, 0xa9])
        expect([...decodeSecret('0aff', 'hex')]).toEqual([10, 255])
        expect([...decodeSecret('Zm9v', 'base64')]).toEqual([0x66, 0x6f, 0x6f])
        expect(() => decodeSecret('xyz', 'hex')).toThrow()
    })
})
