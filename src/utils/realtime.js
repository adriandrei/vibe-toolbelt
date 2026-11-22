// Helpers for the API Tester's WebSocket and server-sent events clients:
// checking URLs and subprotocols, naming close codes, and formatting messages
// (sizes, previews, hex, Base64, JSON) for the message log.

import { isForbiddenHeader } from './codeGenerator'
import { redactUrl } from './redact'

// ---------------------------------------------------------------- URLs ---

const looksLikeHost = (text) => /^(localhost|\[[0-9a-f:.]+\]|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]|$)/i.test(text)

/** Loopback hosts, which browsers treat as secure (no mixed-content blocking). */
export function isLocalHost(hostname) {
    const host = String(hostname ?? '').toLowerCase()
    return host === 'localhost' || host.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(host) || host === '[::1]'
}

/**
 * Whether a page served over `pageProtocol` is blocked from connecting to
 * `url`: https:// pages can't open ws:// or http:// connections (mixed
 * content), except to this machine.
 */
export function isMixedContent(pageProtocol, url) {
    if (pageProtocol !== 'https:') return false
    let target
    try {
        target = new URL(url)
    } catch {
        return false
    }
    return (target.protocol === 'ws:' || target.protocol === 'http:') && !isLocalHost(target.hostname)
}

// "example.com/x" → "wss://example.com/x", but "localhost:8080" → "ws://localhost:8080"
function withScheme(input, secure, plain) {
    const host = /^(\[[^\]]*\]|[^/?#:]*)/.exec(input)[1]
    return `${isLocalHost(host) ? plain : secure}://${input}`
}

/**
 * Checks a WebSocket URL the way the WebSocket constructor does: http:// and
 * https:// become ws:// and wss://, other schemes and #fragments are refused.
 * Returns { url, converted } or { error, suggestion? }.
 */
export function toWebSocketUrl(text) {
    const input = String(text ?? '').trim()
    if (!input) return { error: 'Enter the URL of the WebSocket server, like wss://example.com/socket.' }
    const suggestion = looksLikeHost(input) ? withScheme(input, 'wss', 'ws') : undefined
    let url
    try {
        url = new URL(input)
    } catch {
        return suggestion
            ? { error: 'The URL has no scheme. WebSocket URLs start with wss:// (or ws:// without encryption).', suggestion }
            : { error: 'This isn’t a valid absolute URL. It should look like wss://example.com/socket.' }
    }
    let converted = false
    if (url.protocol === 'http:' || url.protocol === 'https:') {
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        converted = true
    }
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        return suggestion
            ? { error: `“${url.protocol}” was read as the scheme. WebSocket URLs start with wss:// or ws://.`, suggestion }
            : { error: `WebSocket URLs start with wss:// or ws:// (https:// and http:// are converted), not ${url.protocol}//.` }
    }
    if (input.includes('#')) return { error: 'WebSocket URLs can’t have a #fragment. Remove the # and everything after it.' }
    return { url: url.href, converted }
}

/** Checks the URL of an event stream, which is fetched over http(s). Returns { url } or { error, suggestion? }. */
export function toHttpUrl(text) {
    const input = String(text ?? '').trim()
    if (!input) return { error: 'Enter the URL of the event stream, like https://example.com/events.' }
    const suggestion = looksLikeHost(input) ? withScheme(input, 'https', 'http') : undefined
    let url
    try {
        url = new URL(input)
    } catch {
        return suggestion
            ? { error: 'The URL has no scheme. Event streams are fetched over https:// (or http://).', suggestion }
            : { error: 'This isn’t a valid absolute URL. It should look like https://example.com/events.' }
    }
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
        return {
            error: 'Server-sent events come over HTTP, so the URL must start with https:// or http://, not a WebSocket scheme.',
            suggestion: `${url.protocol === 'wss:' ? 'https' : 'http'}:${input.slice(url.protocol.length)}`,
        }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return suggestion
            ? { error: `“${url.protocol}” was read as the scheme. Event streams are fetched over https:// or http://.`, suggestion }
            : { error: `Event streams are fetched over https:// or http://, not ${url.protocol}//.` }
    }
    return { url: url.href }
}

const VARIABLE_ONLY = /^\s*\{\{\s*[\w.-]+\s*\}\}\s*$/

/**
 * The URL as it may be kept in localStorage: without a password, and without
 * the values of query parameters whose names look secret (token, key, auth…).
 * Values that are only a {{variable}} reference are kept.
 */
export function urlForStorage(url) {
    return redactUrl(String(url ?? '').trim(), (value) => (VARIABLE_ONLY.test(value) ? value : ''))
}

/** Scheme, host and path, for log lines: no credentials, and the query shown as "?…". */
export function displayUrl(url) {
    try {
        const u = new URL(url)
        return `${u.protocol}//${u.host}${u.pathname}${u.search ? '?…' : ''}`
    } catch {
        return String(url ?? '')
    }
}

// ------------------------------------------------------------ WebSocket ---

// RFC 9110 token characters, which Sec-WebSocket-Protocol values must use
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** "chat.v2, json" → { list: ['chat.v2', 'json'] }, or { list: [], error } */
export function parseSubprotocols(text) {
    const list = String(text ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const invalid = list.find(p => !TOKEN.test(p))
    if (invalid !== undefined) {
        return { list: [], error: `“${invalid}” can’t be a subprotocol. Use only letters, digits and !#$%&'*+-.^_\`|~ (no spaces, slashes or =), and separate subprotocols with commas.` }
    }
    const repeated = list.find((p, i) => list.indexOf(p) !== i)
    if (repeated !== undefined) return { list: [], error: `“${repeated}” is listed twice. Each subprotocol can only be requested once.` }
    return { list }
}

const CLOSE_CODES = {
    1000: ['Normal closure', 'The connection was closed on purpose.'],
    1001: ['Going away', 'The server is shutting down or the page was left.'],
    1002: ['Protocol error', 'An endpoint received data that breaks the WebSocket protocol.'],
    1003: ['Unsupported data', 'An endpoint received a kind of message it can’t accept, such as binary on a text-only server.'],
    1005: ['No status', 'The close frame had no status code.'],
    1006: ['Abnormal closure', 'The connection ended without a close frame: it failed, dropped or was refused.'],
    1007: ['Invalid payload', 'A message wasn’t valid for its type, such as text that isn’t UTF-8.'],
    1008: ['Policy violation', 'A message or request broke the server’s rules (often authentication or origin checks).'],
    1009: ['Message too big', 'A message was larger than the other end accepts.'],
    1010: ['Missing extension', 'The server didn’t agree to an extension the client requires.'],
    1011: ['Internal error', 'The server hit an unexpected problem.'],
    1012: ['Service restart', 'The server is restarting. Reconnect in a moment.'],
    1013: ['Try again later', 'The server is overloaded or temporarily refusing connections.'],
    1014: ['Bad gateway', 'A gateway or proxy got an invalid response from the server behind it.'],
    1015: ['TLS handshake failed', 'The secure connection couldn’t be set up, for example because of an invalid certificate.'],
    3000: ['Unauthorized', 'Registered code: the request needs authentication.'],
    3003: ['Forbidden', 'Registered code: the request isn’t allowed.'],
    3008: ['Timeout', 'Registered code: the connection timed out.'],
}

/** A close code's name and meaning. */
export function describeCloseCode(code) {
    const known = CLOSE_CODES[code]
    if (known) return { name: known[0], description: known[1] }
    if (code >= 3000 && code <= 3999) return { name: 'Registered code', description: 'A code registered for libraries and frameworks (3000–3999).' }
    if (code >= 4000 && code <= 4999) return { name: 'Application code', description: 'A code defined by the application (4000–4999). The server’s documentation says what it means.' }
    return { name: 'Unknown code', description: '' }
}

// ----------------------------------------------------------- formatting ---

const pad = (n, width = 2) => String(n).padStart(width, '0')

/** Local time with milliseconds: "09:05:07.042" */
export function formatClock(ms) {
    const d = new Date(ms)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** "250 ms", "3 s", "1.5 s", "2 min 5 s" */
export function formatDelay(ms) {
    if (ms < 1000) return `${Math.round(ms)} ms`
    if (ms < 60_000) return `${Number((ms / 1000).toFixed(1))} s`
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms % 60_000) / 1000)
    return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`
}

/** Bytes that `text` takes as UTF-8 (lone surrogates count as U+FFFD, as when sent). */
export function utf8Length(text) {
    const s = String(text ?? '')
    let bytes = 0
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        if (c < 0x80) bytes += 1
        else if (c < 0x800) bytes += 2
        else if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
            bytes += 4
            i++
        } else bytes += 3
    }
    return bytes
}

/** One line of at most `max` characters, whitespace collapsed. */
export function previewText(text, max = 160) {
    const s = String(text ?? '')
    const single = (s.length > max * 4 ? s.slice(0, max * 4) : s).replace(/\s+/g, ' ').trim()
    return single.length > max ? `${single.slice(0, max - 1)}…` : single
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** "de ad be ef" for the first `max` bytes, with "…" when there are more. */
export function toHex(bytes, max = Infinity) {
    const shown = Array.from(bytes.subarray(0, Math.min(bytes.length, max)), b => HEX[b]).join(' ')
    return bytes.length > max ? `${shown} …` : shown
}

/** A `hexdump -C` style dump of the first `maxBytes` bytes: offset, 16 bytes in hex, then |ASCII|. */
export function hexDump(bytes, maxBytes = Infinity) {
    const end = Math.min(bytes.length, maxBytes)
    const lines = []
    for (let offset = 0; offset < end; offset += 16) {
        const row = bytes.subarray(offset, Math.min(offset + 16, end))
        let hex = ''
        let ascii = ''
        for (let i = 0; i < 16; i++) {
            if (i === 8) hex += ' '
            hex += i < row.length ? `${HEX[row[i]]} ` : '   '
            if (i < row.length) ascii += row[i] >= 0x20 && row[i] < 0x7f ? String.fromCharCode(row[i]) : '.'
        }
        lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`)
    }
    return lines.join('\n')
}

export function toBase64(bytes) {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

/** The text, if the bytes are valid UTF-8; otherwise null. */
export function decodeUtf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch {
        return null
    }
}

const JSON_LIMIT = 2_000_000

/** Whether the text is a JSON object or array (a bare value gains nothing from a pretty view). */
export function isJsonContainer(text) {
    if (typeof text !== 'string' || text.length > JSON_LIMIT || !/^\s*[[{]/.test(text)) return false
    try {
        JSON.parse(text)
        return true
    } catch {
        return false
    }
}

/**
 * Re-indents valid JSON by changing whitespace only, so that big numbers and
 * escapes stay exactly as they were sent (JSON.parse + stringify would round
 * 12345678901234567890 and rewrite "é"). The same as the HTTP side's.
 */
export function prettyJson(text) {
    const out = []
    let indent = 0
    let inString = false
    const newline = () => '\n' + '  '.repeat(indent)
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (inString) {
            out.push(c)
            if (c === '\\') out.push(text[++i] ?? '')
            else if (c === '"') inString = false
            continue
        }
        if (c === '"') {
            inString = true
            out.push(c)
        } else if (c === '{' || c === '[') {
            let j = i + 1
            while (j < text.length && /\s/.test(text[j])) j++
            if (text[j] === (c === '{' ? '}' : ']')) {
                out.push(c, text[j])
                i = j
            } else {
                indent++
                out.push(c, newline())
            }
        } else if (c === '}' || c === ']') {
            indent--
            out.push(newline(), c)
        } else if (c === ',') {
            out.push(',', newline())
        } else if (c === ':') {
            out.push(': ')
        } else if (!/\s/.test(c)) {
            out.push(c)
        }
    }
    return out.join('')
}

// ---------------------------------------------------------------- CORS ---

const SAFELISTED_HEADERS = new Set(['accept', 'accept-language', 'content-language'])
const SAFELISTED_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']

/**
 * Names of the headers that make a cross-origin GET need a CORS preflight
 * (OPTIONS) first. Forbidden headers are left out: browsers don't send them.
 */
export function preflightHeaders(headers) {
    const names = []
    for (const { key, value } of headers) {
        const name = String(key ?? '').trim()
        const lower = name.toLowerCase()
        if (!name || isForbiddenHeader(lower) || SAFELISTED_HEADERS.has(lower)) continue
        if (lower === 'content-type' && SAFELISTED_TYPES.includes(String(value ?? '').split(';')[0].trim().toLowerCase())) continue
        if (!names.some(n => n.toLowerCase() === lower)) names.push(name)
    }
    return names
}
