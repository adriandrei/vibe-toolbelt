import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
    Base64Error, base64ToBytes, bytesToBase64, decodeUtf8, extensionForMime, hexDump, looksBinaryText, looksLikeBase64,
    normalizeBase64, sniffFileType, textToBase64,
} from './base64'

const bytes = (...n) => Uint8Array.from(n)
const ascii = (s) => Uint8Array.from([...s].map(c => c.charCodeAt(0)))

describe('RFC 4648 section 10 vectors', () => {
    const vectors = [['', ''], ['f', 'Zg=='], ['fo', 'Zm8='], ['foo', 'Zm9v'], ['foob', 'Zm9vYg=='], ['fooba', 'Zm9vYmE='], ['foobar', 'Zm9vYmFy']]
    it.each(vectors)('encodes %j', (plain, expected) => {
        expect(textToBase64(plain)).toBe(expected)
    })
    it.each(vectors.filter(([p]) => p))('decodes %j', (plain, encoded) => {
        const { base64 } = normalizeBase64(encoded)
        expect(new TextDecoder().decode(base64ToBytes(base64))).toBe(plain)
    })
})

describe('bytesToBase64', () => {
    it('uses the standard alphabet with padding by default', () => {
        expect(bytesToBase64(bytes(0xfb, 0xff, 0xfe))).toBe('+//+')
        expect(bytesToBase64(bytes(0xfb, 0xff))).toBe('+/8=')
    })
    it('URL-safe output swaps the alphabet and drops padding by default', () => {
        expect(bytesToBase64(bytes(0xfb, 0xff, 0xfe), { urlSafe: true })).toBe('-__-')
        expect(bytesToBase64(bytes(0xfb, 0xff), { urlSafe: true })).toBe('-_8')
        expect(bytesToBase64(bytes(0xfb, 0xff), { urlSafe: true, pad: true })).toBe('-_8=')
        expect(bytesToBase64(bytes(0xfb, 0xff), { pad: false })).toBe('+/8')
    })
    it('handles inputs larger than the chunk size', () => {
        const big = Uint8Array.from({ length: 100_003 }, (_, i) => i & 0xff)
        expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'))
    })
    it('encodes UTF-8 text', () => {
        expect(textToBase64('héllo ✓')).toBe(Buffer.from('héllo ✓').toString('base64'))
    })
})

describe('normalizeBase64', () => {
    it('accepts whitespace, line breaks and missing padding', () => {
        expect(normalizeBase64('  Zm9v\r\nYmE  ')).toEqual({ base64: 'Zm9vYmE=', urlSafe: false, mime: null })
        expect(normalizeBase64('Zg')).toMatchObject({ base64: 'Zg==' })
    })
    it('detects and converts the URL-safe alphabet', () => {
        expect(normalizeBase64('-__-')).toEqual({ base64: '+//+', urlSafe: true, mime: null })
    })
    it('parses data: URIs and reports the MIME type', () => {
        expect(normalizeBase64('data:text/plain;charset=utf-8;base64,aGk=')).toEqual({ base64: 'aGk=', urlSafe: false, mime: 'text/plain' })
        expect(normalizeBase64('DATA:image/png;BASE64,AAAA').mime).toBe('image/png')
        expect(normalizeBase64('data:;base64,AAAA').mime).toBeNull()
    })
    it('rejects data: URIs that are not Base64', () => {
        expect(() => normalizeBase64('data:text/plain,hello')).toThrow(/isn’t Base64-encoded/)
    })
    it('names the first invalid character and its position', () => {
        expect(() => normalizeBase64('ab$d')).toThrow('“$” at position 3 isn’t a Base64 character')
        expect(() => normalizeBase64('abéd')).toThrow(/at position 3/)
    })
    it('rejects empty input', () => {
        expect(() => normalizeBase64('   ')).toThrow('There’s nothing to decode.')
        expect(() => normalizeBase64('data:text/plain;base64,')).toThrow(/nothing to decode/)
    })
    it('rejects mixed alphabets, misplaced padding and impossible lengths', () => {
        expect(() => normalizeBase64('ab+_')).toThrow(/mixes the standard/)
        expect(() => normalizeBase64('ab=c')).toThrow(/Padding \(=\) can only appear at the end/)
        expect(() => normalizeBase64('abcde')).toThrow(/last group has a single character/)
        expect(() => normalizeBase64('a')).toThrow(Base64Error)
    })
    it('throws Base64Error instances', () => {
        expect(() => normalizeBase64('!')).toThrow(Base64Error)
    })
})

describe('base64ToBytes / decodeUtf8', () => {
    it('round-trips every byte value', () => {
        const all = Uint8Array.from({ length: 256 }, (_, i) => i)
        expect([...base64ToBytes(bytesToBase64(all))]).toEqual([...all])
    })
    it('decodeUtf8 is strict', () => {
        expect(decodeUtf8(new TextEncoder().encode('日本'))).toBe('日本')
        expect(decodeUtf8(bytes(0xff, 0xfe))).toBeNull()
        expect(decodeUtf8(bytes(0xc3))).toBeNull()
    })
})

describe('looksBinaryText', () => {
    it('flags NUL and control-heavy text, not normal whitespace', () => {
        expect(looksBinaryText('abc\u0000def')).toBe(true)
        expect(looksBinaryText('\u0001\u0002\u0003\u0004\u0005\u0006 text')).toBe(true)
        expect(looksBinaryText('line1\r\n\tline2\n')).toBe(false)
        expect(looksBinaryText('')).toBe(false)
        expect(looksBinaryText('a\u007fb\u0001')).toBe(false) // only 2 control chars: below the minimum of 3
    })
})

describe('sniffFileType', () => {
    it('identifies common signatures', () => {
        expect(sniffFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toMatchObject({ mime: 'image/png', ext: 'png' })
        expect(sniffFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toMatchObject({ ext: 'jpg' })
        expect(sniffFileType(ascii('GIF89a'))).toMatchObject({ ext: 'gif' })
        expect(sniffFileType(ascii('%PDF-1.7'))).toMatchObject({ mime: 'application/pdf' })
        expect(sniffFileType(bytes(0x50, 0x4b, 0x03, 0x04, 0))).toMatchObject({ ext: 'zip' })
        expect(sniffFileType(bytes(0x1f, 0x8b, 8))).toMatchObject({ ext: 'gz' })
        expect(sniffFileType(bytes(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0))).toMatchObject({ ext: 'wasm' })
        expect(sniffFileType(ascii('SQLite format 3\0'))).toMatchObject({ ext: 'sqlite' })
    })
    it('requires both RIFF and WEBP for WebP', () => {
        expect(sniffFileType(ascii('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toMatchObject({ ext: 'webp' })
        expect(sniffFileType(ascii('RIFF\u0000\u0000\u0000\u0000WAVEfmt '))).toBeNull()
    })
    it('distinguishes AVIF from generic MP4 by the brand at offset 4', () => {
        expect(sniffFileType(ascii('\u0000\u0000\u0000\u0018ftypavif'))).toMatchObject({ ext: 'avif' })
        expect(sniffFileType(ascii('\u0000\u0000\u0000\u0018ftypisom'))).toMatchObject({ ext: 'mp4' })
    })
    it('returns null for unknown or too-short data', () => {
        expect(sniffFileType(ascii('hello'))).toBeNull()
        expect(sniffFileType(bytes())).toBeNull()
        expect(sniffFileType(bytes(0x89, 0x50))).toBeNull()
    })
})

describe('extensionForMime', () => {
    it('maps known types and falls back to bin', () => {
        expect(extensionForMime('image/svg+xml')).toBe('svg')
        expect(extensionForMime('application/x-unknown')).toBe('bin')
    })
})

describe('hexDump', () => {
    it('formats offset, hex and ASCII columns', () => {
        const dump = hexDump(ascii('Hello, World!\n\u0000ÿX'))
        expect(dump).toBe(`00000000  ${'48 65 6c 6c 6f 2c 20 57 6f 72 6c 64 21 0a 00 ff'}  Hello, World!...\n00000010  ${'58'.padEnd(47)}  X`)
    })
    it('respects the limit', () => {
        expect(hexDump(new Uint8Array(100), 32).split('\n')).toHaveLength(2)
        expect(hexDump(new Uint8Array(0))).toBe('')
    })
})

describe('looksLikeBase64', () => {
    it('accepts Base64 of readable text and of known file types', () => {
        expect(looksLikeBase64('SGVsbG8sIFdvcmxkIQ==')).toBe(true)
        expect(looksLikeBase64(bytesToBase64(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2)))).toBe(true)
    })
    it('accepts any data: URI with a valid payload', () => {
        expect(looksLikeBase64('data:application/octet-stream;base64,AAECAw==')).toBe(true)
    })
    it('rejects look-alikes: short strings, plain words, binary payloads, bad characters', () => {
        expect(looksLikeBase64('')).toBe(false)
        expect(looksLikeBase64('abc')).toBe(false)
        expect(looksLikeBase64('hello world, this is plain text!')).toBe(false)
        expect(looksLikeBase64('/////w==')).toBe(false) // decodes to invalid UTF-8
        expect(looksLikeBase64('AAAAAAAAAAAA')).toBe(false) // NULs: binary
        expect(looksLikeBase64('SGVsbG8=$')).toBe(false)
    })
})
