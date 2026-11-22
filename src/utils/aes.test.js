import { describe, expect, it } from 'vitest'
import { AesError, GCM_ITERATIONS, decryptGcm, decryptLegacy, detectFormat, encryptGcm, encryptLegacy } from './aes'
import { base64ToBytes, bytesToBase64 } from './encoding'

const FAST = { iterations: 1000 }

// Generated with OpenSSL 3.2.1: printf 'hello wörld' | openssl enc -aes-256-cbc <kdf> -a -A -pass pass:secret
const OPENSSL = {
    md5: 'U2FsdGVkX1/UiQeBmpFWDfjAgoXq4H5Mz5TZlN+V6Hs=', // -md md5
    sha256: 'U2FsdGVkX18T/eRv/oeAjBYLPr2JkIu6lkCtDBVvEPE=', // default digest, OpenSSL >= 1.1.0
    pbkdf2: 'U2FsdGVkX18YD1RQSVKFQnQlTeA5FH5OoT23FwbqM6E=', // -pbkdf2 (10,000 iterations)
}

describe('AES-256-GCM (VT v1)', () => {
    it('round-trips Unicode text and uses the documented layout', async () => {
        const text = 'Grüße 😀 – 日本語'
        const out = await encryptGcm(text, 'pässword', FAST)
        const bytes = base64ToBytes(out)
        expect([...bytes.subarray(0, 4)]).toEqual([0x56, 0x54, 1, 1])
        expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4)).toBe(1000)
        expect(bytes.length).toBe(36 + new TextEncoder().encode(text).length + 16)
        expect(out.startsWith('VlQB')).toBe(true)
        const detected = detectFormat(out)
        expect(detected).toMatchObject({ format: 'gcm', iterations: 1000 })
        expect((await decryptGcm(detected.bytes, 'pässword', detected.iterations)).text).toBe(text)
    })

    it('uses a fresh salt and IV each time', async () => {
        expect(await encryptGcm('same', 'pw', FAST)).not.toBe(await encryptGcm('same', 'pw', FAST))
    })

    it('treats NFC and NFD passphrases as the same', async () => {
        const out = await encryptGcm('x', 'café', FAST)
        const { bytes, iterations } = detectFormat(out)
        expect((await decryptGcm(bytes, 'café', iterations)).text).toBe('x')
    })

    it('round-trips an empty message', async () => {
        const { bytes, iterations } = detectFormat(await encryptGcm('', 'pw', FAST))
        expect((await decryptGcm(bytes, 'pw', iterations)).text).toBe('')
    })

    it('rejects a wrong passphrase and any tampering, including the authenticated header', async () => {
        const { bytes, iterations } = detectFormat(await encryptGcm('secret', 'right', FAST))
        await expect(decryptGcm(bytes, 'wrong', iterations)).rejects.toThrow(AesError)
        const flipped = bytes.slice()
        flipped[flipped.length - 1] ^= 1
        await expect(decryptGcm(flipped, 'right', iterations)).rejects.toThrow(/Wrong passphrase, or the ciphertext was changed/)
        const header = bytes.slice()
        header[30] ^= 0xff // IV bytes are part of the header and the nonce
        await expect(decryptGcm(header, 'right', iterations)).rejects.toThrow(AesError)
    })

    it('defaults to 600,000 iterations', () => {
        expect(GCM_ITERATIONS).toBe(600_000)
    })
})

describe('legacy OpenSSL / CryptoJS', () => {
    it.each(Object.entries(OPENSSL))('decrypts real OpenSSL output (%s)', async (kdf, text) => {
        const detected = detectFormat(text)
        expect(detected.format).toBe('openssl')
        expect(detected.error).toBeUndefined()
        const result = await decryptLegacy(detected.bytes, 'secret')
        expect(result.text).toBe('hello wörld')
        expect(result.kdfId).toBe(kdf)
    })

    it('encrypts to the "Salted__" layout that OpenSSL can read back', async () => {
        const out = await encryptLegacy('round trip ✓', 'pw')
        expect(out.startsWith('U2FsdGVkX1')).toBe(true)
        const bytes = base64ToBytes(out)
        expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe('Salted__')
        expect((bytes.length - 16) % 16).toBe(0)
        expect((await decryptLegacy(bytes, 'pw')).text).toBe('round trip ✓')
    })

    it('rejects wrong passphrases with an AesError (padding check)', async () => {
        const { bytes } = detectFormat(OPENSSL.md5)
        let rejected = 0
        for (const pw of ['nope', 'Secret', 'secret ', 'x']) {
            try {
                await decryptLegacy(bytes, pw)
            } catch (error) {
                expect(error).toBeInstanceOf(AesError)
                rejected++
            }
        }
        // without a MAC a wrong key can rarely pass all three checks; most must fail
        expect(rejected).toBeGreaterThanOrEqual(3)
    })
})

describe('detectFormat', () => {
    it('asks for input when empty', () => {
        expect(detectFormat('  \n').error).toMatch(/Paste the ciphertext/)
        expect(detectFormat(null).format).toBe('unknown')
    })

    it('ignores whitespace and line wrapping', () => {
        const wrapped = OPENSSL.md5.replace(/(.{10})/g, '$1\n  ')
        expect(detectFormat(wrapped).format).toBe('openssl')
    })

    it('reports non-Base64 input', () => {
        const r = detectFormat('hello world!')
        expect(r.format).toBe('unknown')
        expect(r.error).toMatch(/isn’t Base64 ciphertext/)
    })

    it('reports unrecognised Base64', () => {
        expect(detectFormat('aGVsbG8gd29ybGQ=').error).toMatch(/Not recognised/)
    })

    it('flags truncated OpenSSL data', () => {
        const head = [...'Salted__'].map(c => c.charCodeAt(0))
        expect(detectFormat(bytesToBase64(new Uint8Array([...head, ...new Array(10).fill(1)]))).error).toMatch(/truncated/)
    })

    it('validates the VT header', () => {
        const make = (mutate) => {
            const b = new Uint8Array(60)
            b.set([0x56, 0x54, 1, 1])
            new DataView(b.buffer).setUint32(4, 600000)
            mutate(b)
            return bytesToBase64(b)
        }
        expect(detectFormat(make(() => {})).iterations).toBe(600000)
        expect(detectFormat(make(b => { b[2] = 2 })).error).toMatch(/Format version 2/)
        expect(detectFormat(make(b => { b[3] = 9 })).error).toMatch(/Unknown key-derivation id 9/)
        expect(detectFormat(make(b => new DataView(b.buffer).setUint32(4, 5))).error).toMatch(/outside the accepted/)
        expect(detectFormat(make(b => new DataView(b.buffer).setUint32(4, 50_000_000))).error).toMatch(/outside the accepted/)
        expect(detectFormat(bytesToBase64(new Uint8Array([0x56, 0x54, 1, 1, 0, 0]))).error).toMatch(/truncated/)
    })
})
