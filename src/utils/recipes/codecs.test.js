import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
    RecipeError, base32Decode, base32Encode, binaryDecode, binaryEncode, fromCharCodes, hexDecode, hexEncode,
    htmlDecode, htmlEncode, rotate, toCharCodes, urlDecode, urlEncode,
} from './codecs.js'
import * as entityTables from './htmlEntities.js'

const bytes = (text) => new TextEncoder().encode(text)
const text = (b) => new TextDecoder().decode(b)
const hex = (b) => Buffer.from(b).toString('hex')

// RFC 4648 §10 test vectors
const RFC_INPUTS = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']
const RFC_BASE32 = ['', 'MY======', 'MZXQ====', 'MZXW6===', 'MZXW6YQ=', 'MZXW6YTB', 'MZXW6YTBOI======']
const RFC_BASE32HEX = ['', 'CO======', 'CPNG====', 'CPNMU===', 'CPNMUOG=', 'CPNMUOJ1', 'CPNMUOJ1E8======']
const RFC_BASE16 = ['', '66', '666F', '666F6F', '666F6F62', '666F6F6261', '666F6F626172']

describe('Base32 (RFC 4648)', () => {
    it('encodes the RFC 4648 test vectors, both alphabets', () => {
        RFC_INPUTS.forEach((input, i) => {
            expect(base32Encode(bytes(input))).toBe(RFC_BASE32[i])
            expect(base32Encode(bytes(input), { alphabet: 'hex' })).toBe(RFC_BASE32HEX[i])
        })
    })

    it('decodes the RFC 4648 test vectors, with and without padding, in any case', () => {
        RFC_INPUTS.forEach((input, i) => {
            expect(text(base32Decode(RFC_BASE32[i]))).toBe(input)
            expect(text(base32Decode(RFC_BASE32[i].replace(/=+$/, '').toLowerCase()))).toBe(input)
            expect(text(base32Decode(RFC_BASE32HEX[i], { alphabet: 'hex' }))).toBe(input)
        })
    })

    it('leaves out padding on request and round-trips binary data', () => {
        expect(base32Encode(bytes('foobar'), { padding: false })).toBe('MZXW6YTBOI')
        const data = Uint8Array.from({ length: 257 }, (_, i) => (i * 37) & 0xff)
        expect(Array.from(base32Decode(base32Encode(data)))).toEqual(Array.from(data))
    })

    it('ignores whitespace (grouped TOTP secrets)', () => {
        expect(text(base32Decode('MZXW 6YTB\nOI'))).toBe('foobar')
    })

    it('explains invalid input', () => {
        expect(() => base32Decode('MZXW1')).toThrow(/“1” at position 5 isn’t a Base32 character/)
        expect(() => base32Decode('MZ=XW')).toThrow(/padding \(=\) can only appear at the end/)
        expect(() => base32Decode('MZXWAB1')).toThrow(RecipeError)
        expect(() => base32Decode('MZXWABC')).not.toThrow()
        expect(() => base32Decode('MZX')).toThrow(/the length is wrong/)
        expect(() => base32Decode('W', { alphabet: 'hex' })).toThrow(/isn’t a Base32hex character \(Base32hex uses 0–9 and A–V/)
    })
})

describe('Hex', () => {
    it('encodes the RFC 4648 base16 vectors', () => {
        RFC_INPUTS.forEach((input, i) => {
            expect(hexEncode(bytes(input), { upper: true })).toBe(RFC_BASE16[i])
            expect(hexEncode(bytes(input))).toBe(RFC_BASE16[i].toLowerCase())
        })
    })

    it('writes every separator style', () => {
        const data = Uint8Array.from([0x48, 0x65, 0x0a, 0xff])
        expect(hexEncode(data, { format: 'space' })).toBe('48 65 0a ff')
        expect(hexEncode(data, { format: 'colon', upper: true })).toBe('48:65:0A:FF')
        expect(hexEncode(data, { format: 'escaped' })).toBe('\\x48\\x65\\x0a\\xff')
        expect(hexEncode(data, { format: 'c' })).toBe('0x48, 0x65, 0x0a, 0xff')
        expect(hexEncode(new Uint8Array(0), { format: 'c' })).toBe('')
    })

    it('reads every style back, including UUIDs and a single 0x prefix', () => {
        const expected = '48650aff'
        for (const input of ['48650aff', '48 65 0a ff', '48:65:0A:FF', '\\x48\\x65\\x0a\\xff', '0x48, 0x65, 0x0a, 0xff', '0x48650AFF', '48-65-0a-ff', ' 4865\n0aff ']) {
            expect(hex(hexDecode(input)), input).toBe(expected)
        }
        expect(hex(hexDecode('550e8400-e29b-41d4-a716-446655440000'))).toBe('550e8400e29b41d4a716446655440000')
        expect(hex(hexDecode('0x5, 0xA'))).toBe('050a')
        expect(hexDecode('').length).toBe(0)
    })

    it('points at the problem', () => {
        expect(() => hexDecode('48 6g')).toThrow('“g” at position 5 isn’t a hex digit (0–9, a–f)')
        expect(() => hexDecode('486')).toThrow('“486” at position 1 has an odd number of hex digits (3); each byte needs two')
        expect(() => hexDecode('0x')).toThrow(/isn’t followed by hex digits/)
        expect(() => hexDecode('a')).toThrow(/odd number of hex digits/)
    })
})

describe('Binary', () => {
    it('writes 8 bits per byte', () => {
        expect(binaryEncode(bytes('Hi'))).toBe('01001000 01101001')
        expect(binaryEncode(bytes('Hi'), { separator: 'none' })).toBe('0100100001101001')
        expect(binaryEncode(bytes('Hi'), { separator: 'newline' })).toBe('01001000\n01101001')
    })

    it('reads grouped and ungrouped bits, and 7-bit groups', () => {
        expect(text(binaryDecode('01001000 01101001'))).toBe('Hi')
        expect(text(binaryDecode('0100100001101001'))).toBe('Hi')
        expect(text(binaryDecode('1001000 1101001'))).toBe('Hi')
        expect(binaryDecode('  ').length).toBe(0)
    })

    it('explains invalid bits', () => {
        expect(() => binaryDecode('0102')).toThrow('“2” at position 4 isn’t a binary digit (0 or 1)')
        expect(() => binaryDecode('010010001')).toThrow(/9 bits isn’t a whole number of bytes/)
        expect(() => binaryDecode('101010101 1')).toThrow(/has 9 bits; a byte has at most 8/)
    })
})

describe('Character codes', () => {
    it('writes code points, not UTF-16 units', () => {
        expect(toCharCodes('Hé😀')).toBe('72 233 128512')
        expect(toCharCodes('Hé😀', { base: 'hex' })).toBe('48 e9 1f600')
        expect(toCharCodes('Hé😀', { base: 'unicode', separator: 'comma' })).toBe('U+0048, U+00E9, U+1F600')
        expect(toCharCodes('ab', { separator: 'newline' })).toBe('97\n98')
    })

    it('reads them back, with any prefix', () => {
        expect(fromCharCodes('72 233 128512')).toBe('Hé😀')
        expect(fromCharCodes('48,e9;1f600', { base: 'hex' })).toBe('Hé😀')
        expect(fromCharCodes('U+0048 0x65 \\u006C')).toBe('Hel')
    })

    it('rejects values that aren’t characters', () => {
        expect(() => fromCharCodes('72 55296')).toThrow(/is a surrogate/)
        expect(() => fromCharCodes('1114112')).toThrow(/beyond the last Unicode code point/)
        expect(() => fromCharCodes('72 x9')).toThrow('“x9” at position 4 isn’t a decimal character code')
    })
})

describe('URL encoding', () => {
    const sample = 'a b&c/d?e=é~(x)'

    it('matches the browser functions and URLSearchParams', () => {
        expect(urlEncode(sample)).toBe(encodeURIComponent(sample))
        expect(urlEncode(sample, { mode: 'full' })).toBe(encodeURI(sample))
        expect(urlEncode(sample, { mode: 'form' })).toBe(new URLSearchParams({ x: sample }).toString().slice(2))
    })

    it('decodes each mode', () => {
        expect(urlDecode('a%20b%2Fc%3F')).toBe('a b/c?')
        expect(urlDecode('a%20b%2Fc%3F', { mode: 'full' })).toBe('a b%2Fc%3F')
        expect(urlDecode('a+b%2Bc', { mode: 'form' })).toBe('a b+c')
        expect(urlDecode('a+b')).toBe('a+b')
    })

    it('explains broken escapes', () => {
        expect(() => urlDecode('100%')).toThrow('“%” at position 4 isn’t a valid escape: % must be followed by two hex digits (a literal % is written %25)')
        expect(() => urlDecode('x %G1')).toThrow(/“%G1” at position 3/)
        expect(() => urlDecode('caf%C3')).toThrow(/the escapes “%C3” at position 4 aren’t valid UTF-8/)
        expect(() => urlEncode('\uD800')).toThrow(/broken character/)
    })
})

describe('HTML entities', () => {
    it('escapes the HTML characters only by default', () => {
        expect(htmlEncode('<a href="x">Tom & \'Jerry\'</a> é')).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt; é')
    })

    it('also encodes non-ASCII on request, by code point', () => {
        expect(htmlEncode('café © 😀', { scope: 'all' })).toBe('caf&eacute; &copy; &#128512;')
        expect(htmlEncode('café © 😀', { scope: 'all', format: 'decimal' })).toBe('caf&#233; &#169; &#128512;')
        expect(htmlEncode('café © 😀', { scope: 'all', format: 'hex' })).toBe('caf&#xE9; &#xA9; &#x1F600;')
        expect(htmlEncode('a\u0001b', { scope: 'all' })).toBe('a&#1;b')
    })

    const decode = (s) => htmlDecode(s, entityTables)

    it('decodes named, decimal and hex references', () => {
        expect(decode('&lt;p&gt; &amp;amp; &copy; &hellip; &#169; &#xA9; &#X1F600;').text).toBe('<p> &amp; © … © © 😀')
    })

    it('knows every HTML5 name, including two-character ones', () => {
        expect(entityTables.NAMED_REFERENCES.size).toBe(2125)
        expect(decode('&NotEqualTilde; &bigstar; &NewLine;&Afr; &fjlig;').text).toBe('≂̸ ★ \n\u{1D504} fj')
    })

    it('decodes legacy names without a semicolon, as browsers do', () => {
        expect(decode('&copy2024 &amp &lt;b&gt &notit; &ampx;').text).toBe('©2024 & <b> ¬it; &x;')
        expect(decode('AT&T R&D &x').text).toBe('AT&T R&D &x')
    })

    it('follows the HTML rules for odd numeric references', () => {
        expect(decode('&#128;&#150;&#x9F;').text).toBe('€–Ÿ')
        expect(decode('&#0;&#xD800;&#x110000;&#99999999999;').text).toBe('�'.repeat(4))
        expect(decode('&#129;').text).toBe('\u0081')
        expect(decode('&#65&#x42').text).toBe('AB')
    })

    it('leaves unknown references as they are and reports them', () => {
        const { text: out, unknown } = decode('a &bogus; b &nope; &bogus;')
        expect(out).toBe('a &bogus; b &nope; &bogus;')
        expect(unknown).toEqual(['&bogus;', '&nope;'])
    })
})

describe('ROT13', () => {
    it('rotates letters only, and undoes itself', () => {
        expect(rotate('Hello, World! 123')).toBe('Uryyb, Jbeyq! 123')
        expect(rotate(rotate('Hello, World!'))).toBe('Hello, World!')
        expect(rotate('Hello, World!', 3)).toBe('Khoor, Zruog!')
        expect(rotate('xyz', 3)).toBe('abc')
    })
})
