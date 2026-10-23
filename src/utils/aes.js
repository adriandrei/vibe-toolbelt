// Passphrase-based AES for the AES page, on WebCrypto.
//
// Default format, "VT v1" (AES-256-GCM, PBKDF2-HMAC-SHA256):
//   base64( "VT" | 0x01 version | 0x01 KDF | uint32 BE iterations |
//           16-byte salt | 12-byte IV | ciphertext + 16-byte GCM tag )
//   The 36-byte header is authenticated as additional data. The passphrase
//   is NFC-normalised and UTF-8 encoded.
//
// Legacy format: OpenSSL "Salted__" (as produced by CryptoJS.AES.encrypt and
// `openssl enc -aes-256-cbc -md md5 -a`): AES-256-CBC + PKCS#7, key and IV
// from EVP_BytesToKey with one MD5 pass. It has no integrity check.
import CryptoJS from 'crypto-js'
import { base64ToBytes, bytesToBase64, concatBytes, utf8Decode, utf8Encode } from './encoding.js'

export const GCM_ITERATIONS = 600_000
const MAGIC = [0x56, 0x54] // "VT"
const VERSION = 1
const KDF_PBKDF2_SHA256 = 1
const HEADER_LENGTH = 36
const TAG_LENGTH = 16
const MIN_ITERATIONS = 1_000
const MAX_ITERATIONS = 10_000_000
const SALTED = [0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f] // "Salted__"

export class AesError extends Error {}

function subtle() {
    const s = globalThis.crypto?.subtle
    if (!s) throw new AesError('WebCrypto isn’t available on this page (it needs HTTPS or localhost).')
    return s
}

const startsWith = (bytes, prefix) => prefix.every((b, i) => bytes[i] === b)

/**
 * Recognises pasted ciphertext. Whitespace and line wrapping are ignored.
 * @returns {{ format: 'gcm' | 'openssl' | 'unknown', bytes?: Uint8Array, error?: string, iterations?: number }}
 */
export function detectFormat(text) {
    const compact = String(text ?? '').replace(/\s+/g, '')
    if (!compact) return { format: 'unknown', error: 'Paste the ciphertext to decrypt.' }
    let bytes
    try {
        bytes = base64ToBytes(compact)
    } catch (error) {
        return { format: 'unknown', error: `This isn’t Base64 ciphertext (${error.message}).` }
    }
    if (startsWith(bytes, SALTED)) {
        if (bytes.length < 32 || (bytes.length - 16) % 16 !== 0) return { format: 'openssl', bytes, error: 'The OpenSSL ciphertext is truncated (its length isn’t a whole number of AES blocks).' }
        return { format: 'openssl', bytes }
    }
    if (startsWith(bytes, MAGIC) && bytes.length >= 3) {
        if (bytes[2] !== VERSION) return { format: 'gcm', bytes, error: `Format version ${bytes[2]} isn’t supported by this version of the tool.` }
        if (bytes.length < HEADER_LENGTH + TAG_LENGTH) return { format: 'gcm', bytes, error: 'The ciphertext is truncated.' }
        if (bytes[3] !== KDF_PBKDF2_SHA256) return { format: 'gcm', bytes, error: `Unknown key-derivation id ${bytes[3]}.` }
        const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4)
        if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
            return { format: 'gcm', bytes, error: `The header asks for ${iterations.toLocaleString()} PBKDF2 iterations, outside the accepted ${MIN_ITERATIONS.toLocaleString()}–${MAX_ITERATIONS.toLocaleString()}.` }
        }
        return { format: 'gcm', bytes, iterations }
    }
    return { format: 'unknown', bytes, error: 'Not recognised. Expected ciphertext from this tool (starts with “VlQB”) or OpenSSL/CryptoJS output (starts with “U2FsdGVkX1”).' }
}

async function pbkdf2Bits(passwordBytes, salt, iterations, bits, hash = 'SHA-256') {
    const s = subtle()
    const base = await s.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits'])
    return new Uint8Array(await s.deriveBits({ name: 'PBKDF2', salt, iterations, hash }, base, bits))
}

export async function encryptGcm(plaintext, passphrase, { iterations = GCM_ITERATIONS } = {}) {
    const s = subtle()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const header = new Uint8Array(HEADER_LENGTH)
    header.set(MAGIC, 0)
    header[2] = VERSION
    header[3] = KDF_PBKDF2_SHA256
    new DataView(header.buffer).setUint32(4, iterations)
    header.set(salt, 8)
    header.set(iv, 24)
    const keyBytes = await pbkdf2Bits(utf8Encode(passphrase.normalize('NFC')), salt, iterations, 256)
    const key = await s.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
    const sealed = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv, additionalData: header, tagLength: 128 }, key, utf8Encode(plaintext)))
    return bytesToBase64(concatBytes(header, sealed))
}

/**
 * @returns {Promise<{ text?: string, bytes: Uint8Array }>} text is set when the plaintext is UTF-8
 */
export async function decryptGcm(bytes, passphrase, iterations) {
    const s = subtle()
    const header = bytes.subarray(0, HEADER_LENGTH)
    const salt = bytes.subarray(8, 24)
    const iv = bytes.subarray(24, 36)
    const keyBytes = await pbkdf2Bits(utf8Encode(passphrase.normalize('NFC')), salt, iterations, 256)
    const key = await s.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
    let plain
    try {
        plain = new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv, additionalData: header, tagLength: 128 }, key, bytes.subarray(HEADER_LENGTH)))
    } catch {
        throw new AesError('Wrong passphrase, or the ciphertext was changed or truncated. (AES-GCM checks both, so this is certain.)')
    }
    try {
        return { text: utf8Decode(plain, { fatal: true }), bytes: plain }
    } catch {
        return { bytes: plain }
    }
}

// ---- legacy OpenSSL / CryptoJS ----
function md5(bytes) {
    const { words, sigBytes } = CryptoJS.MD5(CryptoJS.lib.WordArray.create(bytes))
    const out = new Uint8Array(sigBytes)
    for (let i = 0; i < sigBytes; i++) out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
    return out
}

// EVP_BytesToKey with one iteration: 32-byte key + 16-byte IV
async function evpBytesToKey(password, salt, digest) {
    const out = []
    let total = 0
    let prev = new Uint8Array(0)
    while (total < 48) {
        const input = concatBytes(prev, password, salt)
        prev = digest === 'md5' ? md5(input) : new Uint8Array(await subtle().digest('SHA-256', input))
        out.push(prev)
        total += prev.length
    }
    const all = concatBytes(...out)
    return { key: all.subarray(0, 32), iv: all.subarray(32, 48) }
}

async function cbc(direction, keyBytes, iv, data) {
    const s = subtle()
    const key = await s.importKey('raw', keyBytes, 'AES-CBC', false, [direction])
    return new Uint8Array(await s[direction]({ name: 'AES-CBC', iv }, key, data))
}

export async function encryptLegacy(plaintext, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(8))
    const { key, iv } = await evpBytesToKey(utf8Encode(passphrase), salt, 'md5')
    const body = await cbc('encrypt', key, iv, utf8Encode(plaintext))
    return bytesToBase64(concatBytes(Uint8Array.from(SALTED), salt, body))
}

const LEGACY_KDFS = [
    { id: 'md5', label: 'MD5 key derivation (CryptoJS, openssl -md md5)' },
    { id: 'sha256', label: 'SHA-256 key derivation (openssl enc default since OpenSSL 1.1.0)' },
    { id: 'pbkdf2', label: 'PBKDF2-SHA256 with 10,000 iterations (openssl enc -pbkdf2)' },
]

/**
 * Tries CryptoJS's MD5 derivation first, then OpenSSL's newer defaults. A
 * result only counts when the PKCS#7 padding is valid and the text is UTF-8;
 * without a MAC a wrong passphrase can still very occasionally pass both.
 * @returns {Promise<{ text: string, kdf: string }>}
 */
export async function decryptLegacy(bytes, passphrase) {
    const password = utf8Encode(passphrase)
    const salt = bytes.subarray(8, 16)
    const body = bytes.subarray(16)
    for (const kdf of LEGACY_KDFS) {
        let key
        let iv
        if (kdf.id === 'pbkdf2') {
            const derived = await pbkdf2Bits(password, salt, 10_000, 384)
            key = derived.subarray(0, 32)
            iv = derived.subarray(32, 48)
        } else {
            ({ key, iv } = await evpBytesToKey(password, salt, kdf.id))
        }
        try {
            const plain = await cbc('decrypt', key, iv, body)
            return { text: utf8Decode(plain, { fatal: true }), kdf: kdf.label, kdfId: kdf.id }
        } catch {
            // bad padding or not UTF-8: try the next derivation
        }
    }
    throw new AesError('Wrong passphrase or corrupted data: the padding check failed. (Legacy ciphertext has no integrity check, so the exact cause can’t be told.)')
}
