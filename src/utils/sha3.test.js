import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bytesToHex } from './encoding'
import { createKeccak, keccak, sha3 } from './sha3'

const enc = (s) => new TextEncoder().encode(s)
const hex = (b) => bytesToHex(b)
const pattern = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff)

describe('SHA-3 (FIPS 202) vectors', () => {
    it('matches the NIST empty-message and "abc" vectors', () => {
        expect(hex(sha3(enc(''), 224))).toBe('6b4e03423667dbb73b6e15454f0eb1abd4597f9a1b078e3f5b5a6bc7')
        expect(hex(sha3(enc(''), 256))).toBe('a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a')
        expect(hex(sha3(enc(''), 384))).toBe('0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004')
        expect(hex(sha3(enc(''), 512))).toBe('a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26')
        expect(hex(sha3(enc('abc'), 256))).toBe('3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532')
        expect(hex(sha3(enc('abc'), 512))).toBe('b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0')
    })

    it('defaults to 256 bits', () => {
        expect(hex(sha3(enc('abc')))).toBe(hex(sha3(enc('abc'), 256)))
    })

    it('agrees with node:crypto for all sizes across rate boundaries', () => {
        for (const bits of [224, 256, 384, 512]) {
            const rate = 200 - bits / 4
            for (const len of [0, 1, rate - 1, rate, rate + 1, 2 * rate, 2 * rate + 5, 1000]) {
                expect(hex(sha3(pattern(len), bits)), `${bits}/${len}`).toBe(createHash(`sha3-${bits}`).update(pattern(len)).digest('hex'))
            }
        }
    })
})

describe('Keccak (original padding)', () => {
    it('matches the widely used Keccak-256 vectors (Ethereum hashing)', () => {
        expect(hex(keccak(enc(''), 256))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
        expect(hex(keccak(enc('abc'), 256))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45')
        expect(hex(keccak(enc('The quick brown fox jumps over the lazy dog'), 256))).toBe('4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15')
    })

    it('differs from SHA-3 only by the padding byte', () => {
        expect(hex(keccak(enc('abc')))).not.toBe(hex(sha3(enc('abc'))))
    })

    it('Keccak-512 of the empty string', () => {
        expect(hex(keccak(enc(''), 512))).toBe('0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e')
    })
})

describe('incremental hashing', () => {
    it('gives the same result however the input is split, including unaligned views', () => {
        const data = pattern(1000)
        const expected = createHash('sha3-256').update(data).digest('hex')
        for (const chunk of [1, 3, 7, 135, 136, 137, 500]) {
            const h = createKeccak({ bits: 256 })
            for (let i = 0; i < data.length; i += chunk) h.update(data.subarray(i, i + chunk))
            expect(hex(h.digest()), `chunk ${chunk}`).toBe(expected)
        }
        // a misaligned byteOffset forces the byte-wise path
        const padded = new Uint8Array(1003)
        padded.set(data, 3)
        expect(hex(sha3(padded.subarray(3, 1003)))).toBe(expected)
    })

    it('exposes block size and output length', () => {
        expect(createKeccak({ bits: 256 })).toMatchObject({ blockSize: 136, outputLength: 32 })
        expect(createKeccak({ bits: 224 })).toMatchObject({ blockSize: 144, outputLength: 28 })
        expect(createKeccak({ bits: 384 })).toMatchObject({ blockSize: 104, outputLength: 48 })
        expect(createKeccak({ bits: 512 })).toMatchObject({ blockSize: 72, outputLength: 64 })
    })

    it('refuses further use after digest()', () => {
        const h = createKeccak()
        h.update(enc('a'))
        h.digest()
        expect(() => h.update(enc('b'))).toThrow('Digest already finalised')
        expect(() => h.digest()).toThrow('Digest already finalised')
    })
})
