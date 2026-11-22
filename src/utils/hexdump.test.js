import { describe, expect, it } from 'vitest'
import { parseHexText } from './hexdump'

const HELLO = Array.from(new TextEncoder().encode('Hello, hex world!\n'))

describe('parseHexText', () => {
    it('reads `xxd` output', () => {
        const dump = [
            '00000000: 4865 6c6c 6f2c 2068 6578 2077 6f72 6c64  Hello, hex world',
            '00000010: 210a                                     !.',
        ].join('\n')
        expect(parseHexText(dump)).toEqual({ bytes: new Uint8Array(HELLO), format: 'xxd' })
    })

    it('reads `hexdump -C` output, including the closing length line', () => {
        const dump = [
            '00000000  48 65 6c 6c 6f 2c 20 68  65 78 20 77 6f 72 6c 64  |Hello, hex world|',
            '00000010  21 0a                                             |!.|',
            '00000012',
        ].join('\n')
        expect(parseHexText(dump)).toEqual({ bytes: new Uint8Array(HELLO), format: 'hexdump' })
    })

    it('reads plain hex bytes with any common separator', () => {
        const expected = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
        expect(parseHexText('de ad be ef').bytes).toEqual(expected)
        expect(parseHexText('DE:AD:BE:EF').bytes).toEqual(expected)
        expect(parseHexText('0xde, 0xad, 0xbe, 0xef').bytes).toEqual(expected)
        expect(parseHexText('de-ad-be-ef\n').bytes).toEqual(expected)
        expect(parseHexText('deadbeef')).toEqual({ bytes: expected, format: 'run' })
        expect(parseHexText('0xdeadbeef').bytes).toEqual(expected)
    })

    it('rejects text that is not hex, odd lengths and broken dumps', () => {
        expect(parseHexText('hello world')).toBeNull()
        expect(parseHexText('abc')).toBeNull()
        expect(parseHexText('de ad b')).toBeNull()
        expect(parseHexText('')).toBeNull()
        expect(parseHexText(42)).toBeNull()
        // Offsets out of order / not matching the byte count
        expect(parseHexText('00000010: 4865\n00000000: 6c6c')).toBeNull()
        expect(parseHexText('00000000: 4865\n00000004: 6c6c')).toBeNull()
        // A dump line followed by prose
        expect(parseHexText('00000000: 4865 6c6c  Hell\nsome notes')).toBeNull()
    })
})
