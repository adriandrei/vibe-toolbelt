// Shareable links: a tool's state travels in the URL fragment (#s=…).
//
// Browsers never send the fragment to a server, so the shared input doesn't
// reach the hosting logs, and the link works on any host. Anyone who has the
// link can read what's in it, which the Share button says when it copies one.
//
// Format: JSON { v, t, d } (version, tool path, the tool's own state),
// deflate-compressed (CompressionStream) and Base64url-encoded.
import { base64ToBytes, bytesToBase64, normalizeBase64 } from './base64'

const VERSION = 1
const FRAGMENT = /^#s=([A-Za-z0-9_-]+)$/

// Chat apps, mail clients and some browsers cut off or refuse longer links.
export const MAX_SHARE_LENGTH = 32_000
// A hand-made link could decompress to gigabytes (a "deflate bomb") and freeze
// the tab, so decoding stops here. Real links decompress to far less.
const MAX_DECODED_BYTES = 20 * 1024 * 1024

export class ShareError extends Error {}

async function transform(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream)
    return new Uint8Array(await new Response(out).arrayBuffer())
}

async function inflate(bytes) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
    const chunks = []
    let total = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > MAX_DECODED_BYTES) {
            await reader.cancel().catch(() => {})
            throw new ShareError('This link holds more data than a shared link can.')
        }
        chunks.push(value)
    }
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
    }
    return out
}

/** Encodes `data` for the tool at `tool` (its route, e.g. "/regex"). */
export async function encodeShareState(tool, data) {
    const json = JSON.stringify({ v: VERSION, t: tool, d: data })
    const packed = await transform(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
    return bytesToBase64(packed, { urlSafe: true })
}

/**
 * Decodes a value made by encodeShareState. Throws a ShareError when it is
 * damaged, from a newer version, or made for a different tool.
 */
export async function decodeShareState(encoded, tool) {
    if (typeof encoded !== 'string' || encoded.length > MAX_SHARE_LENGTH * 2) throw new ShareError('This link is too long to be a shared link.')
    let parsed
    try {
        const bytes = base64ToBytes(normalizeBase64(encoded).base64)
        const json = new TextDecoder().decode(await inflate(bytes))
        parsed = JSON.parse(json)
    } catch (error) {
        if (error instanceof ShareError) throw error
        throw new ShareError('This link is damaged or incomplete.')
    }
    if (!parsed || typeof parsed !== 'object' || parsed.v !== VERSION || !('d' in parsed)) {
        throw new ShareError('This link was made by a different version of the app.')
    }
    if (tool && parsed.t !== tool) throw new ShareError('This link was made for a different tool.')
    return parsed.d
}

/** The encoded state in a location hash ("#s=…"), or null. */
export function readShareFragment(hash) {
    const match = typeof hash === 'string' ? hash.match(FRAGMENT) : null
    return match ? match[1] : null
}

/** A full link that opens `tool` with `data`. */
export async function buildShareUrl(tool, data, origin = window.location.origin) {
    return `${origin}${tool}#s=${await encodeShareState(tool, data)}`
}
