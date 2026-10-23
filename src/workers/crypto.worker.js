// Hashing and HMAC off the main thread (Hash and HMAC pages).
import { serveWorker } from './serve.js'
import { digestAll, hmac } from '../utils/digest.js'
import { utf8Encode } from '../utils/encoding.js'

async function toBytes(source) {
    if (source.kind === 'text') return utf8Encode(source.text)
    if (source.kind === 'file') return new Uint8Array(await source.file.arrayBuffer())
    if (source.kind === 'bytes') return source.bytes
    throw new Error('Unknown input')
}

serveWorker({
    async digest({ source, algorithms }, { progress }) {
        const bytes = await toBytes(source)
        const digests = await digestAll(bytes, algorithms, { onProgress: progress })
        return { digests, size: bytes.length }
    },
    async hmac({ algorithm, key, message }) {
        const bytes = typeof message === 'string' ? utf8Encode(message) : message
        return hmac(algorithm, key, bytes)
    },
})
