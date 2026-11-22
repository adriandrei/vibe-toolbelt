import { Buffer } from 'node:buffer'
import { generateKeyPairSync } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { findPemBlocks, keyAlgorithm, pemEncode, pkcs1ToPkcs8, pkcs1ToSpki, pkcs8ToPkcs1, rsaModulusBits, spkiToPkcs1 } from './pem'

const der = (key, type) => new Uint8Array(key.export({ type, format: 'der' }))
const same = (a, b) => expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)

let rsa
let ec
let ed
let rsa1024
beforeAll(() => {
    const make = (type, options) => generateKeyPairSync(type, options)
    rsa = make('rsa', { modulusLength: 2048 })
    rsa1024 = make('rsa', { modulusLength: 1024 })
    ec = make('ec', { namedCurve: 'P-256' })
    ed = make('ed25519')
})

describe('pemEncode / findPemBlocks', () => {
    it('wraps at 64 columns and matches node:crypto output', () => {
        const spki = der(rsa.publicKey, 'spki')
        const pem = pemEncode('PUBLIC KEY', spki)
        expect(pem).toBe(rsa.publicKey.export({ type: 'spki', format: 'pem' }))
        expect(pem.split('\n').slice(1, -3).every(l => l.length === 64)).toBe(true)
        expect(pem.endsWith('-----END PUBLIC KEY-----\n')).toBe(true)
    })

    it('handles empty content', () => {
        expect(pemEncode('X', new Uint8Array(0))).toBe('-----BEGIN X-----\n\n-----END X-----\n')
    })

    it('extracts several blocks from surrounding text', () => {
        const a = rsa.publicKey.export({ type: 'spki', format: 'pem' })
        const b = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' })
        const blocks = findPemBlocks(`Subject: x\r\nnoise\n${a}\n  junk  \n${b.replace(/\n/g, '\r\n')}trailing`)
        expect(blocks.map(x => x.label)).toEqual(['PUBLIC KEY', 'PRIVATE KEY'])
        same(blocks[0].der, der(rsa.publicKey, 'spki'))
        same(blocks[1].der, der(rsa.privateKey, 'pkcs8'))
        expect(blocks[0].pem).toBe(a)
    })

    it('drops RFC 1421 headers inside a block', () => {
        const body = Buffer.from('hello world').toString('base64')
        const [block] = findPemBlocks(`-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,ABCD\n\n${body}\n-----END RSA PRIVATE KEY-----`)
        expect(Buffer.from(block.der).toString()).toBe('hello world')
    })

    it('ignores mismatched BEGIN/END labels and empty input', () => {
        expect(findPemBlocks('-----BEGIN A-----\nAAAA\n-----END B-----')).toEqual([])
        expect(findPemBlocks('')).toEqual([])
        expect(findPemBlocks(null)).toEqual([])
    })

    it('reports invalid Base64 inside a block', () => {
        expect(() => findPemBlocks('-----BEGIN A-----\n@@@@\n-----END A-----')).toThrow(/Base64/)
    })
})

describe('RSA conversions match node:crypto', () => {
    it('PKCS#8 <-> PKCS#1 private key', () => {
        const p8 = der(rsa.privateKey, 'pkcs8')
        const p1 = der(rsa.privateKey, 'pkcs1')
        same(pkcs8ToPkcs1(p8), p1)
        same(pkcs1ToPkcs8(p1), p8)
    })
    it('SPKI <-> PKCS#1 public key', () => {
        const spki = der(rsa.publicKey, 'spki')
        const p1 = der(rsa.publicKey, 'pkcs1')
        same(spkiToPkcs1(spki), p1)
        same(pkcs1ToSpki(p1), spki)
    })
    it('handles long DER lengths for 1024-bit keys too', () => {
        same(pkcs1ToSpki(der(rsa1024.publicKey, 'pkcs1')), der(rsa1024.publicKey, 'spki'))
        same(pkcs1ToPkcs8(der(rsa1024.privateKey, 'pkcs1')), der(rsa1024.privateKey, 'pkcs8'))
    })
    it('rejects non-RSA and malformed input', () => {
        expect(() => pkcs8ToPkcs1(der(ec.privateKey, 'pkcs8'))).toThrow('Not an RSA key')
        expect(() => spkiToPkcs1(der(ed.publicKey, 'spki'))).toThrow('Not an RSA key')
        expect(() => pkcs8ToPkcs1(Uint8Array.of(0x04, 0x00))).toThrow('Not a PKCS#8 key')
        expect(() => spkiToPkcs1(Uint8Array.of(0x04, 0x00))).toThrow('Not an SPKI key')
        expect(() => spkiToPkcs1(der(rsa.publicKey, 'spki').slice(0, 40))).toThrow('Truncated DER data')
        expect(() => pkcs8ToPkcs1(new Uint8Array(0))).toThrow('Truncated DER data')
    })
})

describe('rsaModulusBits', () => {
    it('reports 1024 and 2048', () => {
        expect(rsaModulusBits(der(rsa.publicKey, 'pkcs1'))).toBe(2048)
        expect(rsaModulusBits(der(rsa1024.publicKey, 'pkcs1'))).toBe(1024)
    })
    it('ignores the leading zero byte DER adds to the modulus', () => {
        // SEQUENCE { INTEGER 0x00FF, INTEGER 3 } -> 8-bit modulus
        expect(rsaModulusBits(Uint8Array.of(0x30, 0x07, 0x02, 0x02, 0x00, 0xff, 0x02, 0x01, 0x03))).toBe(8)
        // modulus 0x0100 -> 9 bits
        expect(rsaModulusBits(Uint8Array.of(0x30, 0x07, 0x02, 0x02, 0x01, 0x00, 0x02, 0x01, 0x03))).toBe(9)
        expect(rsaModulusBits(Uint8Array.of(0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x03))).toBe(0)
    })
})

describe('keyAlgorithm', () => {
    it('identifies key types from SPKI and PKCS#8', () => {
        expect(keyAlgorithm(der(rsa.publicKey, 'spki'))).toEqual({ type: 'RSA' })
        expect(keyAlgorithm(der(ec.publicKey, 'spki'))).toEqual({ type: 'EC', curve: 'P-256' })
        expect(keyAlgorithm(der(ed.publicKey, 'spki'))).toEqual({ type: 'Ed25519' })
        expect(keyAlgorithm(der(rsa.privateKey, 'pkcs8'), { pkcs8: true })).toEqual({ type: 'RSA' })
        expect(keyAlgorithm(der(ec.privateKey, 'pkcs8'), { pkcs8: true })).toEqual({ type: 'EC', curve: 'P-256' })
        expect(keyAlgorithm(der(ed.privateKey, 'pkcs8'), { pkcs8: true })).toEqual({ type: 'Ed25519' })
    })
    it('identifies other EC curves', () => {
        for (const [namedCurve, name] of [['P-384', 'P-384'], ['P-521', 'P-521'], ['secp256k1', 'secp256k1']]) {
            const key = generateKeyPairSync('ec', { namedCurve })
            expect(keyAlgorithm(der(key.publicKey, 'spki'))).toEqual({ type: 'EC', curve: name })
        }
    })
    it('identifies X25519', () => {
        const x = generateKeyPairSync('x25519')
        expect(keyAlgorithm(der(x.publicKey, 'spki'))).toEqual({ type: 'X25519' })
    })
    it('returns unknown for garbage and unrecognised algorithms', () => {
        expect(keyAlgorithm(Uint8Array.of(1, 2, 3))).toEqual({ type: 'unknown' })
        expect(keyAlgorithm(new Uint8Array(0))).toEqual({ type: 'unknown' })
        // a PKCS#1 public key starts with an INTEGER, not an AlgorithmIdentifier
        expect(keyAlgorithm(der(rsa.publicKey, 'pkcs1'))).toEqual({ type: 'unknown' })
    })
})
