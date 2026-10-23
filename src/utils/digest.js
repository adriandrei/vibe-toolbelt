// Message digests and HMAC over bytes, used by src/workers/crypto.worker.js.
//
// SHA-1/SHA-2 use WebCrypto when it's available (it isn't on plain-http
// origins, where crypto-js takes over). MD5 uses crypto-js; SHA-3 and Keccak
// use ./sha3.js (crypto-js's "SHA3" is pre-standard Keccak). HMAC is the
// generic RFC 2104 construction, so it works for every algorithm here and
// with an empty key.
import CryptoJS from 'crypto-js'
import { createKeccak } from './sha3.js'
import { concatBytes } from './encoding.js'

export const BLOCK_SIZES = {
    MD5: 64,
    'SHA-1': 64,
    'SHA-256': 64,
    'SHA-384': 128,
    'SHA-512': 128,
    'SHA3-256': 136,
    'SHA3-384': 104,
    'SHA3-512': 72,
    'Keccak-256': 136,
}

export const ALGORITHMS = Object.keys(BLOCK_SIZES)

const WEBCRYPTO = new Set(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'])
const CRYPTOJS_ALGO = { MD5: 'MD5', 'SHA-1': 'SHA1', 'SHA-256': 'SHA256', 'SHA-384': 'SHA384', 'SHA-512': 'SHA512' }
const CHUNK = 1 << 20

function wordArrayToBytes({ words, sigBytes }) {
    const out = new Uint8Array(sigBytes)
    for (let i = 0; i < sigBytes; i++) out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
    return out
}

// Incremental hasher with update(bytes) / digest() for the JS implementations.
function createJsHasher(algorithm) {
    if (algorithm.startsWith('SHA3-')) return createKeccak({ bits: Number(algorithm.slice(5)) })
    if (algorithm === 'Keccak-256') return createKeccak({ bits: 256, padding: 'keccak' })
    const name = CRYPTOJS_ALGO[algorithm]
    if (!name) throw new Error(`Unsupported algorithm: ${algorithm}`)
    const hasher = CryptoJS.algo[name].create()
    return {
        update(bytes) {
            hasher.update(CryptoJS.lib.WordArray.create(bytes))
            return this
        },
        digest() {
            return wordArrayToBytes(hasher.finalize())
        },
    }
}

function usesWebCrypto(algorithm, { forceJs = false } = {}) {
    return !forceJs && WEBCRYPTO.has(algorithm) && !!globalThis.crypto?.subtle
}

/**
 * Digests of `bytes` for several algorithms.
 * @param {Uint8Array} bytes
 * @param {string[]} algorithms
 * @param {{ onProgress?: (fraction: number) => void, forceJs?: boolean }} [options]
 * @returns {Promise<Record<string, Uint8Array>>}
 */
export async function digestAll(bytes, algorithms, { onProgress, forceJs = false } = {}) {
    const result = {}
    const native = algorithms.filter(a => usesWebCrypto(a, { forceJs }))
    const js = algorithms.filter(a => !usesWebCrypto(a, { forceJs }))

    const nativeJobs = native.map(async (a) => {
        result[a] = new Uint8Array(await globalThis.crypto.subtle.digest(a, bytes))
    })

    if (js.length) {
        const hashers = js.map(createJsHasher)
        let lastReport = 0
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
            const slice = bytes.subarray(offset, offset + CHUNK)
            for (const h of hashers) h.update(slice)
            const now = Date.now()
            if (onProgress && now - lastReport > 100) {
                lastReport = now
                onProgress(Math.min(1, (offset + slice.length) / bytes.length))
            }
        }
        js.forEach((a, i) => {
            result[a] = hashers[i].digest()
        })
    }

    await Promise.all(nativeJobs)
    return result
}

export async function digest(algorithm, bytes, options) {
    const out = await digestAll(bytes, [algorithm], options)
    return out[algorithm]
}

/**
 * HMAC (RFC 2104) of `message` with `key`, both Uint8Array.
 */
export async function hmac(algorithm, key, message, options) {
    const blockSize = BLOCK_SIZES[algorithm]
    if (!blockSize) throw new Error(`Unsupported algorithm: ${algorithm}`)
    const k = key.length > blockSize ? await digest(algorithm, key, options) : key
    const block = new Uint8Array(blockSize)
    block.set(k)
    const ipad = block.map(b => b ^ 0x36)
    const opad = block.map(b => b ^ 0x5c)
    const inner = await digest(algorithm, concatBytes(ipad, message), options)
    return digest(algorithm, concatBytes(opad, inner), options)
}
