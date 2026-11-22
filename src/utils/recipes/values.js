// Values flowing through a recipe: text (a string) or bytes (a Uint8Array).
// Text becomes bytes as UTF-8; bytes become text only when they are valid
// UTF-8, so binary data is never shown or processed as mojibake.
import { looksBinaryText, sniffFileType } from '../base64.js'
import { countCodePoints, utf8ByteLength } from '../textMetrics.js'
import { RecipeError } from './codecs.js'

export const TEXT = 'text'
export const BYTES = 'bytes'

const encoder = new TextEncoder()

export const kindOf = (value) => (typeof value === 'string' ? TEXT : BYTES)

export function toBytes(value) {
    return typeof value === 'string' ? encoder.encode(value) : value
}

/** Strict UTF-8 decoding (a leading byte order mark is dropped); null when the bytes aren't UTF-8. */
export function decodeUtf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return null
    }
}

export function toText(value) {
    if (typeof value === 'string') return value
    const text = decodeUtf8(value)
    if (text === null) {
        throw new RecipeError('this step works on text, but its input is binary data that isn’t valid UTF-8. Add Hex encode or Base64 encode before it to turn the bytes into text')
    }
    return text
}

/** Converts `value` to what an operation takes: 'text', 'bytes' or 'any'. */
export function coerce(value, kind) {
    if (kind === TEXT) return toText(value)
    if (kind === BYTES) return toBytes(value)
    return value
}

const PREVIEW_CHARS = 120
const PREVIEW_BYTES = 32

function previewText(text) {
    const head = text.length > PREVIEW_CHARS * 2 ? text.slice(0, PREVIEW_CHARS * 2) : text
    const flat = head.replace(/\r\n|\r|\n/g, ' ↵ ').replace(/\t/g, ' ⇥ ')
    const chars = Array.from(flat)
    return chars.length > PREVIEW_CHARS || text.length > head.length ? `${chars.slice(0, PREVIEW_CHARS).join('')}…` : flat
}

function previewHex(bytes) {
    const head = bytes.subarray(0, PREVIEW_BYTES)
    const hex = Array.from(head, (b) => b.toString(16).padStart(2, '0')).join(' ')
    return bytes.length > PREVIEW_BYTES ? `${hex} …` : hex
}

/**
 * Size and a short preview of a value, for the trail shown after each step:
 *   { kind: 'text', chars, bytes, preview }
 *   { kind: 'bytes', bytes, utf8: true | false | null, preview }
 * utf8 is null when the data is too large to check cheaply.
 */
export function describeValue(value) {
    if (typeof value === 'string') {
        return { kind: TEXT, chars: countCodePoints(value), bytes: utf8ByteLength(value), preview: previewText(value) }
    }
    let utf8 = null
    let preview = null
    if (value.length <= 4 * 1024 * 1024) {
        const text = decodeUtf8(value)
        utf8 = text !== null
        if (utf8 && !looksBinaryText(text)) preview = previewText(text)
    }
    return { kind: BYTES, bytes: value.length, utf8, preview: preview ?? previewHex(value) }
}

/**
 * Everything the output panel needs, computed where the recipe ran (the
 * worker), so the page never decodes megabytes on the main thread:
 *   text:  { kind: 'text', text, chars, bytes }
 *   bytes: { kind: 'bytes', bytes, size, text (UTF-8 text or null), sniff }
 */
export function describeOutput(value) {
    if (typeof value === 'string') {
        return { kind: TEXT, text: value, chars: countCodePoints(value), bytes: utf8ByteLength(value) }
    }
    const text = decodeUtf8(value)
    const readable = text !== null && !looksBinaryText(text)
    return {
        kind: BYTES,
        bytes: value,
        size: value.length,
        text: readable ? text : null,
        chars: readable ? countCodePoints(text) : 0,
        sniff: sniffFileType(value),
    }
}
