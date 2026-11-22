import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ALGORITHMS, BLOCK_SIZES, digest, digestAll, hmac } from './digest'
import { bytesToHex, hexToBytes } from './encoding'

const enc = (s) => new TextEncoder().encode(s)
const hex = (b) => bytesToHex(b)
const NODE_NAMES = { MD5: 'md5', 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512', 'SHA3-256': 'sha3-256', 'SHA3-384': 'sha3-384', 'SHA3-512': 'sha3-512' }

describe('digest known vectors', () => {
    it('matches the standard "abc" and empty-string vectors', async () => {
        expect(hex(await digest('MD5', enc('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72')
        expect(hex(await digest('SHA-1', enc('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
        expect(hex(await digest('SHA-256', enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
        expect(hex(await digest('SHA-256', enc('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        expect(hex(await digest('SHA3-256', enc('abc')))).toBe('3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532')
        expect(hex(await digest('Keccak-256', enc('')))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
        expect(hex(await digest('Keccak-256', enc('abc')))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45')
    })

    it('agrees with node:crypto for every algorithm, WebCrypto and pure-JS paths, across block boundaries', async () => {
        for (const size of [0, 1, 55, 56, 63, 64, 65, 111, 112, 127, 128, 135, 136, 137, 1000]) {
            const data = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) & 0xff)
            for (const [name, nodeName] of Object.entries(NODE_NAMES)) {
                const expected = createHash(nodeName).update(data).digest('hex')
                expect(hex(await digest(name, data))).toBe(expected)
                expect(hex(await digest(name, data, { forceJs: true }))).toBe(expected)
            }
        }
    })

    it('hashes input larger than the internal 1 MiB chunk', async () => {
        const data = new Uint8Array(2 * 1024 * 1024 + 5).fill(0x61)
        const out = await digestAll(data, ['MD5', 'SHA3-256', 'SHA-256'], { forceJs: true })
        expect(hex(out.MD5)).toBe(createHash('md5').update(data).digest('hex'))
        expect(hex(out['SHA3-256'])).toBe(createHash('sha3-256').update(data).digest('hex'))
        expect(hex(out['SHA-256'])).toBe(createHash('sha256').update(data).digest('hex'))
    })

    it('digestAll returns one result per requested algorithm', async () => {
        const out = await digestAll(enc('x'), ['MD5', 'SHA-1'])
        expect(Object.keys(out).sort()).toEqual(['MD5', 'SHA-1'])
        expect(await digestAll(enc('x'), [])).toEqual({})
    })

    it('rejects unknown algorithms', async () => {
        await expect(digest('SHA-999', enc('x'))).rejects.toThrow(/Unsupported algorithm/)
    })

    it('lists every algorithm with a block size', () => {
        expect(ALGORITHMS).toEqual(Object.keys(BLOCK_SIZES))
        expect(BLOCK_SIZES['SHA3-256']).toBe(136) // 200 - 2*32
        expect(BLOCK_SIZES['SHA3-512']).toBe(72)
    })
})

describe('hmac', () => {
    it('matches RFC 4231 test case 2 ("Jefe")', async () => {
        const out = await hmac('SHA-256', enc('Jefe'), enc('what do ya want for nothing?'))
        expect(hex(out)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
        const out512 = await hmac('SHA-512', enc('Jefe'), enc('what do ya want for nothing?'))
        expect(hex(out512)).toBe('164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737')
    })

    it('matches RFC 2202 MD5 test case 1', async () => {
        expect(hex(await hmac('MD5', new Uint8Array(16).fill(0x0b), enc('Hi There')))).toBe('9294727a3638bb1c13f48ef8158bfc9d')
    })

    it('matches node:crypto with long keys (hashed first), short keys and an empty key', async () => {
        for (const [name, nodeName] of Object.entries(NODE_NAMES)) {
            for (const keyLen of [0, 5, BLOCK_SIZES[name], BLOCK_SIZES[name] + 1, 300]) {
                const key = Uint8Array.from({ length: keyLen }, (_, i) => (i * 13 + 1) & 0xff)
                const msg = enc('The quick brown fox')
                expect(hex(await hmac(name, key, msg))).toBe(createHmac(nodeName, key).update(msg).digest('hex'))
            }
        }
    })

    it('computes the jwt.io HS256 signature', async () => {
        const out = await hmac('SHA-256', enc('your-256-bit-secret'), enc('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ'))
        expect(Buffer.from(out).toString('base64url')).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
    })

    it('computes Keccak-256 HMAC with the generic construction and 136-byte blocks', async () => {
        const key = hexToBytes('0b0b0b0b')
        const msg = enc('abc')
        const block = new Uint8Array(136)
        block.set(key)
        const inner = await digest('Keccak-256', Uint8Array.from([...block.map(b => b ^ 0x36), ...msg]))
        const expected = await digest('Keccak-256', Uint8Array.from([...block.map(b => b ^ 0x5c), ...inner]))
        expect(hex(await hmac('Keccak-256', key, msg))).toBe(hex(expected))
    })

    it('rejects unknown algorithms', async () => {
        await expect(hmac('nope', enc('k'), enc('m'))).rejects.toThrow(/Unsupported algorithm/)
    })
})
