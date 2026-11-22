// HAR (HTTP Archive 1.2) helpers for the HAR Viewer & Sanitizer page and its
// worker: parsing and validation, one row per request, a summary, a report of
// the secrets in the file, a sanitizer and cURL export.
//
//   const { har, format } = parseHar(text)         // throws HarError
//   const rows = buildRows(har)
//   const summary = summarizeHar(har, rows)
//   const { counts, names } = scanHar(har)          // what's sensitive in it
//   const { har: clean } = sanitizeHar(har, options)
//   const text = serializeHar(clean, format)        // laid out like the input
//
// The sanitizer only replaces sensitive values (with "[REDACTED]") and drops
// bodies when asked to; every other value, and the order of keys, stays as it
// was, so DevTools can import the result. The secrets report and the
// sanitizer share one walk over the file, so they always agree on what's
// sensitive. Values that are only a {{variable}} reference are left alone, as
// in redact.js: they don't hold the secret.

import { SENSITIVE_NAME } from './redact.js'
import { base64ToBytes, bytesToBase64, decodeUtf8, looksBinaryText, normalizeBase64 } from './base64.js'
import { generateCode } from './codeGenerator.js'

export const REDACTED = '[REDACTED]'

// Bigger files can't be held as one string by browsers (about 512 M characters).
export const MAX_FILE_BYTES = 500 * 1024 * 1024

export class HarError extends Error {
    constructor(message) {
        super(message)
        this.name = 'HarError'
    }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// ------------------------------------------------------------- parsing ---

/**
 * Formatting of JSON text, so that it can be written back the same way:
 * { bom, leading, trailing, newline, indent }. `indent` is '' for minified JSON.
 */
export function detectJsonFormat(text) {
    const bom = text.charCodeAt(0) === 0xfeff
    let start = bom ? 1 : 0
    while (start < text.length && /\s/.test(text[start])) start++
    let end = text.length
    while (end > start && /\s/.test(text[end - 1])) end--
    const layout = /^[{[](\r?\n)([ \t]*)/.exec(text.slice(start, start + 256))
    return {
        bom,
        leading: text.slice(bom ? 1 : 0, start),
        trailing: text.slice(end),
        newline: layout ? layout[1] : '\n',
        indent: layout ? layout[2] : '',
    }
}

function jsonErrorMessage(text, error) {
    const head = text.trimStart()
    if (head.startsWith('<')) return 'This isn’t JSON: it looks like HTML or XML. Export the HAR again from the browser’s Network panel (“Save all as HAR”).'
    const message = String(error?.message || 'invalid JSON')
    if (/unexpected end|unterminated/i.test(message)) {
        return 'This isn’t complete JSON: the text ends too early. The file may be cut off (an export or a download that didn’t finish).'
    }
    return `This isn’t valid JSON: ${message}`
}

/**
 * Checks the structure of parsed JSON. Throws a HarError that says what's
 * wrong; returns { malformed } (entries without a request URL) otherwise.
 */
export function validateHar(value) {
    const notHar = (why) => new HarError(`This is JSON but not a HAR file: ${why}`)
    if (Array.isArray(value)) throw notHar('it’s a list, and a HAR file is an object with log.entries.')
    if (!isObject(value)) throw notHar(`it’s a single ${value === null ? 'null' : typeof value} value, and a HAR file is an object with log.entries.`)
    if (value.log === undefined) throw notHar('it has no log.entries.')
    if (!isObject(value.log)) throw notHar('its “log” isn’t an object.')
    if (value.log.entries === undefined) throw notHar('it has no log.entries.')
    if (!Array.isArray(value.log.entries)) throw notHar('log.entries isn’t a list.')
    const entries = value.log.entries
    let malformed = 0
    for (const entry of entries) {
        if (!isObject(entry) || !isObject(entry.request) || typeof entry.request.url !== 'string') malformed++
    }
    if (entries.length > 0 && malformed === entries.length) {
        throw notHar(`none of its ${entries.length.toLocaleString('en-US')} entries has a request URL.`)
    }
    return { malformed }
}

/** Parses and validates HAR text. Returns { har, format, malformed }. */
export function parseHar(input) {
    if (typeof input !== 'string') throw new HarError('There’s nothing to open.')
    const format = detectJsonFormat(input)
    const text = format.bom ? input.slice(1) : input
    if (!text.trim()) throw new HarError('The file is empty.')
    let value
    try {
        value = JSON.parse(text)
    } catch (error) {
        throw new HarError(jsonErrorMessage(text, error))
    }
    const { malformed } = validateHar(value)
    return { har: value, format, malformed }
}

// --------------------------------------------------------- request rows ---

export const RESOURCE_TYPES = [
    { id: 'document', label: 'Document' },
    { id: 'xhr', label: 'XHR/Fetch' },
    { id: 'script', label: 'JS' },
    { id: 'stylesheet', label: 'CSS' },
    { id: 'image', label: 'Image' },
    { id: 'font', label: 'Font' },
    { id: 'media', label: 'Media' },
    { id: 'websocket', label: 'WebSocket' },
    { id: 'other', label: 'Other' },
]

export const STATUS_CLASSES = [
    { id: '1xx', label: '1xx' },
    { id: '2xx', label: '2xx' },
    { id: '3xx', label: '3xx' },
    { id: '4xx', label: '4xx' },
    { id: '5xx', label: '5xx' },
    { id: 'failed', label: 'Failed' },
    { id: 'other', label: 'Other' },
]

// Chrome's _resourceType values, grouped like the DevTools Network filters
const RESOURCE_TYPE_GROUPS = {
    document: 'document', prefetch: 'document',
    xhr: 'xhr', fetch: 'xhr', eventsource: 'xhr',
    script: 'script', 'sm-script': 'script',
    stylesheet: 'stylesheet', 'sm-stylesheet': 'stylesheet',
    image: 'image',
    font: 'font',
    media: 'media',
    websocket: 'websocket', webtransport: 'websocket',
}

// Sec-Fetch-Dest values, for entries without a resource type or MIME type
const FETCH_DEST_GROUPS = {
    document: 'document', iframe: 'document', frame: 'document', embed: 'document', object: 'document',
    empty: 'xhr',
    script: 'script', worker: 'script', sharedworker: 'script', serviceworker: 'script', audioworklet: 'script', paintworklet: 'script',
    style: 'stylesheet',
    image: 'image',
    font: 'font',
    audio: 'media', video: 'media', track: 'media',
    websocket: 'websocket',
}

const EXTENSION_GROUPS = {
    html: 'document', htm: 'document',
    js: 'script', mjs: 'script', cjs: 'script',
    css: 'stylesheet',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', svg: 'image', ico: 'image', bmp: 'image',
    woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', eot: 'font',
    mp4: 'media', webm: 'media', mp3: 'media', m4a: 'media', ogg: 'media', wav: 'media', m3u8: 'media', mpd: 'media', m4s: 'media', ts: 'media',
    json: 'xhr',
}

/** First value of a header in a HAR headers list (case-insensitive name). */
export function headerValue(headers, name) {
    if (!Array.isArray(headers)) return ''
    const lower = name.toLowerCase()
    const found = headers.find(h => isObject(h) && String(h.name ?? '').toLowerCase() === lower)
    return found && typeof found.value === 'string' ? found.value : ''
}

/** The response MIME type without parameters, lower case ('' when unknown). */
export function mimeOf(response) {
    const res = isObject(response) ? response : {}
    const declared = isObject(res.content) && typeof res.content.mimeType === 'string' ? res.content.mimeType : ''
    const raw = declared && declared !== 'x-unknown' ? declared : headerValue(res.headers, 'content-type')
    return raw.split(';')[0].trim().toLowerCase()
}

function typeFromMime(mime) {
    if (!mime) return null
    if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'document'
    if (mime === 'text/css') return 'stylesheet'
    if (/(?:java|ecma)script|^text\/jscript$/.test(mime)) return 'script'
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('font/') || /^application\/(?:x-)?font-|^application\/vnd\.ms-fontobject$/.test(mime)) return 'font'
    if (mime.startsWith('audio/') || mime.startsWith('video/') || /^application\/(?:ogg|vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)$/.test(mime)) return 'media'
    if (/json|xml|^text\/event-stream$|^application\/x-www-form-urlencoded$|grpc|protobuf/.test(mime)) return 'xhr'
    return null
}

/**
 * The type group of an entry (an id from RESOURCE_TYPES): Chrome's
 * _resourceType when present, otherwise the response MIME type, then the
 * request's Sec-Fetch-Dest header and the URL's file extension.
 */
export function resourceTypeOf(entry) {
    const e = isObject(entry) ? entry : {}
    if (typeof e._resourceType === 'string' && e._resourceType) {
        return RESOURCE_TYPE_GROUPS[e._resourceType.toLowerCase()] ?? 'other'
    }
    const req = isObject(e.request) ? e.request : {}
    const res = isObject(e.response) ? e.response : {}
    const url = typeof req.url === 'string' ? req.url : ''
    if (/^wss?:/i.test(url) || Array.isArray(e._webSocketMessages) || (res.status === 101 && /websocket/i.test(headerValue(req.headers, 'upgrade')))) {
        return 'websocket'
    }
    const byMime = typeFromMime(mimeOf(res))
    if (byMime) return byMime
    const dest = headerValue(req.headers, 'sec-fetch-dest').toLowerCase()
    if (FETCH_DEST_GROUPS[dest]) return FETCH_DEST_GROUPS[dest]
    if (/^xmlhttprequest$/i.test(headerValue(req.headers, 'x-requested-with'))) return 'xhr'
    const ext = /\.([a-z0-9]{1,5})$/i.exec(splitUrl(url).path.replace(/[?#].*$/, ''))
    return (ext && EXTENSION_GROUPS[ext[1].toLowerCase()]) || 'other'
}

export function statusClassOf(status) {
    if (typeof status !== 'number' || !Number.isFinite(status) || status <= 0) return 'failed'
    if (status >= 100 && status < 600) return `${Math.floor(status / 100)}xx`
    return 'other'
}

const nonNegative = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

/** Bytes on the wire: Chrome's _transferSize, else headersSize + bodySize; -1 when unknown. */
export function transferSizeOf(response) {
    const res = isObject(response) ? response : {}
    const transfer = nonNegative(res._transferSize)
    if (transfer !== null) return transfer
    const headers = nonNegative(res.headersSize)
    const body = nonNegative(res.bodySize)
    if (headers === null && body === null) return -1
    return (headers ?? 0) + (body ?? 0)
}

/** Uncompressed body size (content.size); -1 when unknown. */
export function contentSizeOf(response) {
    const content = isObject(response) && isObject(response.content) ? response.content : {}
    return nonNegative(content.size) ?? -1
}

/** Total time of an entry in ms: `time`, else the sum of its timings; null when unknown. */
export function entryTime(entry) {
    const e = isObject(entry) ? entry : {}
    const time = nonNegative(e.time)
    if (time !== null) return time
    const { segments } = timingBreakdown(e.timings)
    return segments.length ? segments.reduce((sum, s) => sum + s.ms, 0) : null
}

/** { host, path } of a URL, kept as written ("host" includes a port; path includes the query). */
export function splitUrl(url) {
    const text = String(url ?? '')
    const match = /^([a-z][\w+.-]*:)?\/\/([^/?#]*)([^#]*)/i.exec(text)
    if (!match) return { host: '', path: text }
    return { host: match[2].replace(/^[^@]*@/, ''), path: match[3] || '/' }
}

const hostname = (host) => host.replace(/:\d+$/, '').toLowerCase()

function rowOf(entry, i, start, first) {
    const e = isObject(entry) ? entry : {}
    const req = isObject(e.request) ? e.request : {}
    const res = isObject(e.response) ? e.response : {}
    const url = typeof req.url === 'string' ? req.url : ''
    const { host, path } = splitUrl(url)
    const status = typeof res.status === 'number' && Number.isFinite(res.status) ? res.status : 0
    return {
        i,
        method: typeof req.method === 'string' && req.method ? req.method : '',
        url,
        host,
        path,
        status,
        statusText: typeof res.statusText === 'string' ? res.statusText : '',
        statusClass: statusClassOf(status),
        error: typeof res._error === 'string' ? res._error : '',
        type: resourceTypeOf(e),
        mime: mimeOf(res),
        transferred: transferSizeOf(res),
        size: contentSizeOf(res),
        time: entryTime(e),
        offset: Number.isFinite(start) && Number.isFinite(first) ? start - first : null,
        fromCache: typeof e._fromCache === 'string' ? e._fromCache : '',
    }
}

/** One compact row per entry (the table's data), in file order. */
export function buildRows(har) {
    const entries = har.log.entries
    const starts = entries.map(e => (isObject(e) ? Date.parse(e.startedDateTime) : NaN))
    let first = Infinity
    for (const s of starts) if (Number.isFinite(s) && s < first) first = s
    return entries.map((entry, i) => rowOf(entry, i, starts[i], first))
}

/**
 * Totals for the summary: requests, failures and errors, bytes, total time,
 * domains and a breakdown by type.
 */
export function summarizeHar(har, rows = buildRows(har)) {
    const log = har.log
    const byType = Object.fromEntries(RESOURCE_TYPES.map(t => [t.id, { count: 0, transferred: 0, size: 0 }]))
    const statusClasses = Object.fromEntries(STATUS_CLASSES.map(c => [c.id, 0]))
    const hosts = new Map()
    let transferred = 0
    let size = 0
    let spanEnd = null
    for (const row of rows) {
        statusClasses[row.statusClass]++
        const group = byType[row.type]
        group.count++
        if (row.transferred > 0) {
            transferred += row.transferred
            group.transferred += row.transferred
        }
        if (row.size > 0) {
            size += row.size
            group.size += row.size
        }
        if (row.host) {
            const name = hostname(row.host)
            hosts.set(name, (hosts.get(name) ?? 0) + 1)
        }
        if (row.offset !== null) {
            const end = row.offset + (row.time ?? 0)
            if (spanEnd === null || end > spanEnd) spanEnd = end
        }
    }

    // Page load: from the first page's start to the last page's onLoad
    const pages = Array.isArray(log.pages) ? log.pages.filter(isObject) : []
    let loadStart = Infinity
    let loadEnd = -Infinity
    for (const page of pages) {
        const start = Date.parse(page.startedDateTime)
        const onLoad = nonNegative(isObject(page.pageTimings) ? page.pageTimings.onLoad : null)
        if (!Number.isFinite(start) || onLoad === null) continue
        loadStart = Math.min(loadStart, start)
        loadEnd = Math.max(loadEnd, start + onLoad)
    }
    const firstTimings = isObject(pages[0]?.pageTimings) ? pages[0].pageTimings : {}
    const totalTime = Number.isFinite(loadEnd)
        ? { ms: loadEnd - loadStart, source: 'onLoad' }
        : spanEnd !== null ? { ms: spanEnd, source: 'span' } : { ms: null, source: null }

    const creator = isObject(log.creator) ? [log.creator.name, log.creator.version].filter(v => typeof v === 'string' && v).join(' ') : ''
    const browser = isObject(log.browser) ? [log.browser.name, log.browser.version].filter(v => typeof v === 'string' && v).join(' ') : ''

    return {
        requests: rows.length,
        failed: statusClasses.failed,
        clientErrors: statusClasses['4xx'],
        serverErrors: statusClasses['5xx'],
        statusClasses,
        transferred,
        size,
        totalTime,
        span: spanEnd,
        onContentLoad: nonNegative(firstTimings.onContentLoad),
        onLoad: nonNegative(firstTimings.onLoad),
        pages: pages.length,
        domains: [...hosts].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host)),
        byType,
        version: typeof log.version === 'string' ? log.version : '',
        creator,
        browser,
    }
}

// ---------------------------------------------------- sensitive values ---

// Names redact.js doesn't cover that HTTP traffic often uses for secrets
const EXTRA_SENSITIVE_NAME = /^(?:sid|phpsessid|connect\.sid|csrf|_csrf|xsrf|_xsrf|otp|totp|ssn)$|subscription[-_]?key|functions[-_]?key/i
// Names that match SENSITIVE_NAME but never hold a secret
const NOT_SECRET_NAMES = new Set(['access-control-allow-credentials'])

// The same few names come up thousands of times in a big file
const nameCache = new Map()

/** True for header, parameter, cookie and field names that usually carry secrets. */
export function isSensitiveName(name) {
    const key = String(name ?? '')
    let sensitive = nameCache.get(key)
    if (sensitive === undefined) {
        const text = key.trim()
        sensitive = text !== '' && !NOT_SECRET_NAMES.has(text.toLowerCase()) && (SENSITIVE_NAME.test(text) || EXTRA_SENSITIVE_NAME.test(text))
        if (nameCache.size > 20_000) nameCache.clear()
        nameCache.set(key, sensitive)
    }
    return sensitive
}

const VARIABLE_ONLY = /^\s*\{\{\s*[\w.-]+\s*\}\}\s*$/ // as in redact.js

/** A value worth hiding: not empty, not already redacted, not only a {{variable}}. */
export function isSecretValue(value) {
    if (typeof value !== 'string') return false
    const text = value.trim()
    return text !== '' && text !== REDACTED && !VARIABLE_ONLY.test(text)
}

const JWT = /eyJ[\w-]{4,}\.eyJ[\w-]{4,}\.[\w-]*/
const JWT_ALL = new RegExp(JWT.source, 'g')
const AUTH_SCHEME = /^\s*([A-Za-z][\w!#$%&'*+.^`|~-]*)\s+(\S[\s\S]*)$/
const BEARER_OR_BASIC = /^\s*(bearer|basic)\s+\S/i
const URL_IN_TEXT = /\b(?:https?|wss?|ftp):\/\/[^\s"'<>\\^`{|}]+/gi
const FORM_LIKE = /^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/
// Cheap test before parsing a body for sensitive JSON or form fields
const SENSITIVE_HINT = /pass|pwd|secret|token|key|session|cookie|credential|signature|auth|sig|code|jwt|sid|csrf|xsrf|otp|ssn|eyJ/i

// URL decoding with + as a space; text without % or + is returned as it is
function safeDecode(text) {
    if (!text.includes('%') && !text.includes('+')) return text
    try {
        return decodeURIComponent(text.replace(/\+/g, ' '))
    } catch {
        return text
    }
}

function splitAuth(value) {
    const match = AUTH_SCHEME.exec(value)
    return match ? { scheme: match[1], credentials: match[2] } : { scheme: '', credentials: value }
}

/**
 * Secret categories, in report order. `subset` ones overlap others (a Bearer
 * token is also an Authorization header) and don't add to the total.
 * `option` is the sanitize option that removes them.
 */
export const SECRET_CATEGORIES = [
    { id: 'authHeaders', label: 'Authorization headers', option: 'headers' },
    { id: 'bearer', label: 'Bearer tokens', option: 'headers', subset: true },
    { id: 'basic', label: 'Basic credentials', option: 'headers', subset: true },
    { id: 'apiHeaders', label: 'API key, token and session headers', option: 'headers' },
    { id: 'cookieHeaders', label: 'Cookie headers', option: 'cookies' },
    { id: 'setCookieHeaders', label: 'Set-Cookie headers', option: 'cookies' },
    { id: 'cookies', label: 'Cookies in cookie lists', option: 'cookies' },
    { id: 'queryParams', label: 'Sensitive query parameters', option: 'query' },
    { id: 'urlPasswords', label: 'Passwords in URLs', option: 'query' },
    { id: 'requestFields', label: 'Sensitive request body fields', option: 'bodyFields' },
    { id: 'responseFields', label: 'Sensitive response body fields', option: 'bodyFields' },
]

/** Bodies aren't secrets, but they can hold personal data. */
export const BODY_CATEGORIES = [
    { id: 'requestBodies', label: 'Request bodies', option: 'dropRequestBodies' },
    { id: 'responseBodies', label: 'Response bodies', option: 'dropResponseBodies' },
]

const CATEGORY_IDS = [...SECRET_CATEGORIES, ...BODY_CATEGORIES].map(c => c.id)

/** Sum of the secret counts, without the overlapping categories. */
export function secretTotal(counts) {
    return SECRET_CATEGORIES.reduce((sum, c) => sum + (c.subset ? 0 : counts?.[c.id] ?? 0), 0)
}

export const DEFAULT_SANITIZE_OPTIONS = Object.freeze({
    headers: true, // Authorization, Proxy-Authorization and secret-looking header values
    cookies: true, // Cookie and Set-Cookie headers and the cookie lists
    query: true, // sensitive query parameters (and passwords) in URLs
    bodyFields: true, // sensitive form and JSON fields in bodies
    dropRequestBodies: false,
    dropResponseBodies: true,
})

const NO_REDACTION = Object.freeze(Object.fromEntries(Object.keys(DEFAULT_SANITIZE_OPTIONS).map(k => [k, false])))

const DROP = Symbol('drop')

function setOwn(target, key, value) {
    if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
    else target[key] = value
}

// A copy of `obj` with some values replaced (DROP removes the key), keeping
// the key order. Returns `obj` itself when nothing changes.
function patch(obj, changes) {
    const keys = Object.keys(changes)
    if (!keys.length) return obj
    const out = {}
    for (const key of Object.keys(obj)) {
        if (Object.hasOwn(changes, key)) {
            if (changes[key] !== DROP) setOwn(out, key, changes[key])
        } else {
            setOwn(out, key, obj[key])
        }
    }
    return out
}

// Maps a list, returning the original list (and copying nothing) when no item changes
function mapList(list, fn) {
    let out = null
    for (let k = 0; k < list.length; k++) {
        const item = list[k]
        const next = fn(item, k)
        if (out === null && next !== item) out = list.slice(0, k)
        if (out !== null) out.push(next)
    }
    return out ?? list
}

// Records a finding. `value` (when given) counts the same name and value once
// per entry, so a parameter that's in the URL and in queryString is one finding.
function found(ctx, category, name, value) {
    if (value !== undefined) {
        const key = `${category}\u0000${name}\u0000${value}`
        if (!ctx.seen) ctx.seen = new Set()
        else if (ctx.seen.has(key)) return
        ctx.seen.add(key)
    }
    ctx.counts[category]++
    if (name) {
        const names = ctx.names[category] || (ctx.names[category] = new Map())
        names.set(name, (names.get(name) ?? 0) + 1)
    }
}

// name=value&name=value (URL query, fragment or x-www-form-urlencoded body)
function processPairs(text, ctx, category, enabled) {
    if (!text.includes('=')) return text
    const parts = text.split('&')
    let changed = false
    for (let k = 0; k < parts.length; k++) {
        const part = parts[k]
        const eq = part.indexOf('=')
        if (eq <= 0) continue
        const name = safeDecode(part.slice(0, eq))
        const value = safeDecode(part.slice(eq + 1))
        if (!isSecretValue(value) || !(isSensitiveName(name) || JWT.test(value))) continue
        found(ctx, category, name, value)
        if (!enabled) continue
        parts[k] = `${part.slice(0, eq)}=${REDACTED}`
        changed = true
    }
    return changed ? parts.join('&') : text
}

/** Redacts the password in user:password@host and sensitive query and fragment parameters. */
function processUrl(url, ctx) {
    if (typeof url !== 'string' || url === '') return url
    const enabled = ctx.options.query
    const withoutPassword = url.replace(/^([a-z][\w+.-]*:\/\/)([^/?#@]*)@/i, (match, scheme, userinfo) => {
        const colon = userinfo.indexOf(':')
        if (colon === -1) return match
        const user = userinfo.slice(0, colon)
        const password = userinfo.slice(colon + 1)
        if (!isSecretValue(safeDecode(password))) return match
        found(ctx, 'urlPasswords', safeDecode(user) || '(no user name)', safeDecode(password))
        return enabled ? `${scheme}${user}:${REDACTED}@` : match
    })
    const hashAt = withoutPassword.indexOf('#')
    let base = hashAt === -1 ? withoutPassword : withoutPassword.slice(0, hashAt)
    let hash = hashAt === -1 ? '' : withoutPassword.slice(hashAt)
    const q = base.indexOf('?')
    if (q !== -1) base = base.slice(0, q + 1) + processPairs(base.slice(q + 1), ctx, 'queryParams', enabled)
    if (hash) {
        // "#access_token=…&token_type=bearer" (OAuth) or "#/route?token=…" (single-page apps)
        const fq = hash.indexOf('?')
        if (fq !== -1) hash = hash.slice(0, fq + 1) + processPairs(hash.slice(fq + 1), ctx, 'queryParams', enabled)
        else if (hash.includes('=')) hash = '#' + processPairs(hash.slice(1), ctx, 'queryParams', enabled)
    }
    const out = base + hash
    return out === url ? url : out
}

function processUrlsInText(text, ctx) {
    if (typeof text !== 'string' || !text.includes('://')) return text
    const out = text.replace(URL_IN_TEXT, (match) => processUrl(match, ctx))
    return out === text ? text : out
}

// URLs anywhere inside a value (initiator stacks, comments, custom fields)
function processUrlsDeep(value, ctx) {
    if (typeof value === 'string') return processUrlsInText(value, ctx)
    if (Array.isArray(value)) return mapList(value, item => processUrlsDeep(item, ctx))
    if (isObject(value)) {
        const changes = {}
        for (const key of Object.keys(value)) {
            const next = processUrlsDeep(value[key], ctx)
            if (next !== value[key]) changes[key] = next
        }
        return patch(value, changes)
    }
    return value
}

function processJwtsInText(text, ctx, category, enabled) {
    if (!text.includes('eyJ')) return text
    let changed = false
    const out = text.replace(JWT_ALL, (match) => {
        found(ctx, category, '(JWT)', match)
        if (!enabled) return match
        changed = true
        return REDACTED
    })
    return changed ? out : text
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
// eslint-disable-next-line no-control-regex
const STRING_STOP = /["\\\u0000-\u001f]/g

/**
 * Finds the values of sensitive keys in JSON text (at any depth; everything
 * under a sensitive key counts) and JWT-looking strings, and replaces them
 * with "[REDACTED]", keeping the rest of the text exactly as written.
 * Returns null when the text isn't valid JSON.
 */
function processJsonText(text, ctx, category, enabled) {
    const n = text.length
    const spans = []
    let i = 0
    // Next "eyJ" (start of a JWT) at or after the current string; strings are read in order
    let nextJwt = text.indexOf('eyJ')
    const fail = () => {
        throw new SyntaxError('Invalid JSON')
    }
    const skipSpace = () => {
        while (i < n) {
            const c = text.charCodeAt(i)
            if (c === 32 || c === 9 || c === 10 || c === 13) i++
            else break
        }
    }
    const readString = () => {
        const start = i
        let escaped = false
        i++
        while (i < n) {
            // Jump to the next quote, backslash or control character
            STRING_STOP.lastIndex = i
            if (!STRING_STOP.test(text)) fail()
            i = STRING_STOP.lastIndex - 1
            const c = text.charCodeAt(i)
            if (c === 92) {
                escaped = true
                i += 2
            } else if (c === 34) {
                i++
                return { start, end: i, escaped }
            } else {
                fail()
            }
        }
        return fail()
    }
    const decode = (token) => (token.escaped ? JSON.parse(text.slice(token.start, token.end)) : text.slice(token.start + 1, token.end - 1))
    const leaf = (name, value, start, end) => {
        found(ctx, category, name, value)
        if (enabled) spans.push(start, end)
    }
    // `sensitive` is the nearest sensitive key above this value (or null), `key` its own key
    const readValue = (sensitive, key, depth) => {
        if (depth > 500) fail()
        skipSpace()
        const c = text[i]
        if (c === '{') {
            i++
            skipSpace()
            if (text[i] === '}') {
                i++
                return
            }
            for (;;) {
                skipSpace()
                if (text[i] !== '"') fail()
                const name = decode(readString())
                skipSpace()
                if (text[i] !== ':') fail()
                i++
                readValue(isSensitiveName(name) ? name : sensitive, name, depth + 1)
                skipSpace()
                if (text[i] === ',') {
                    i++
                } else if (text[i] === '}') {
                    i++
                    return
                } else {
                    fail()
                }
            }
        }
        if (c === '[') {
            i++
            skipSpace()
            if (text[i] === ']') {
                i++
                return
            }
            for (;;) {
                readValue(sensitive, key, depth + 1)
                skipSpace()
                if (text[i] === ',') {
                    i++
                } else if (text[i] === ']') {
                    i++
                    return
                } else {
                    fail()
                }
            }
        }
        if (c === '"') {
            const token = readString()
            if (sensitive !== null) {
                const value = decode(token)
                if (isSecretValue(value)) leaf(sensitive, value, token.start, token.end)
                return
            }
            if (nextJwt !== -1 && nextJwt < token.start) nextJwt = text.indexOf('eyJ', token.start)
            if (nextJwt !== -1 && nextJwt < token.end) {
                const value = decode(token)
                if (isSecretValue(value) && JWT.test(value)) leaf(key ?? '(JWT)', value, token.start, token.end)
            }
            return
        }
        if (c === '-' || (c >= '0' && c <= '9')) {
            NUMBER.lastIndex = i
            const match = NUMBER.exec(text)
            if (!match) fail()
            const start = i
            i += match[0].length
            if (sensitive !== null) leaf(sensitive, match[0], start, i)
            return
        }
        if (text.startsWith('true', i)) i += 4
        else if (text.startsWith('false', i)) i += 5
        else if (text.startsWith('null', i)) i += 4
        else fail()
    }
    try {
        readValue(null, null, 0)
        skipSpace()
        if (i !== n) fail()
    } catch {
        return null
    }
    if (!spans.length) return text
    let out = ''
    let last = 0
    for (let k = 0; k < spans.length; k += 2) {
        out += text.slice(last, spans[k]) + JSON.stringify(REDACTED)
        last = spans[k + 1]
    }
    return out + text.slice(last)
}

function boundaryOf(mime) {
    const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(mime)
    return match ? match[1] ?? match[2] : null
}

// multipart/form-data: the values of sensitive, non-file fields
function processMultipart(text, mime, ctx, category, enabled) {
    const boundary = boundaryOf(mime) ?? /^--([^\r\n]+)\r?\n/.exec(text)?.[1]
    if (!boundary) return processJwtsInText(text, ctx, category, enabled)
    const delimiter = `--${boundary}`
    const parts = text.split(delimiter)
    let changed = false
    for (let p = 1; p < parts.length; p++) {
        const part = parts[p]
        if (part.startsWith('--')) break // the closing delimiter
        const headerEnd = /\r?\n\r?\n/.exec(part)
        if (!headerEnd) continue
        const disposition = /content-disposition:[^\r\n]*/i.exec(part.slice(0, headerEnd.index))?.[0] ?? ''
        const nameMatch = /;\s*name="([^"]*)"|;\s*name=([^;\s]+)/i.exec(disposition)
        if (!nameMatch || /;\s*filename\*?=/i.test(disposition)) continue
        const name = nameMatch[1] ?? nameMatch[2]
        const bodyStart = headerEnd.index + headerEnd[0].length
        const lineBreak = /\r?\n$/.exec(part)?.[0] ?? ''
        const value = part.slice(bodyStart, part.length - lineBreak.length)
        if (!isSecretValue(value) || !(isSensitiveName(name) || JWT.test(value))) continue
        found(ctx, category, name, value)
        if (!enabled) continue
        parts[p] = part.slice(0, bodyStart) + REDACTED + lineBreak
        changed = true
    }
    return changed ? parts.join(delimiter) : text
}

/** Sensitive fields in a body: JSON, form (urlencoded or multipart), or JWTs in any other text. */
function processBodyText(text, mime, ctx, category, enabled) {
    if (typeof text !== 'string' || text === '') return text
    const type = String(mime ?? '').toLowerCase()
    // (the boundary is case-sensitive: pass the MIME type as written)
    if (type.includes('multipart/')) return processMultipart(text, String(mime), ctx, category, enabled)
    const specific = /html|xml|javascript|ecmascript|css|image\/|font\/|audio\/|video\//.test(type)
    const first = /\S/.exec(text.length > 4096 ? text.slice(0, 4096) : text)?.[0]
    const json = type.includes('json') || (!specific && (first === '{' || first === '['))
    const form = !json && (type.includes('x-www-form-urlencoded') || (!specific && text.length < 1_000_000 && FORM_LIKE.test(text)))
    if (json || form) {
        if (!SENSITIVE_HINT.test(text)) return text
        if (form) return processPairs(text, ctx, category, enabled)
        const result = processJsonText(text, ctx, category, enabled)
        if (result !== null) return result
    }
    return processJwtsInText(text, ctx, category, enabled)
}

function processAuthorization(h, ctx, lower) {
    const { scheme, credentials } = splitAuth(h.value)
    if (!isSecretValue(credentials)) return h
    found(ctx, 'authHeaders', lower)
    if (/^bearer$/i.test(scheme)) found(ctx, 'bearer', lower)
    else if (/^basic$/i.test(scheme)) found(ctx, 'basic', lower)
    if (!ctx.options.headers) return h
    return { ...h, value: scheme ? `${scheme} ${REDACTED}` : REDACTED }
}

// A secret-looking header: keeps a Bearer/Basic scheme word, hides the rest
function processSecretHeader(h, ctx, lower) {
    const { scheme, credentials } = splitAuth(h.value)
    const keepScheme = /^(?:bearer|basic)$/i.test(scheme)
    if (!isSecretValue(keepScheme ? credentials : h.value)) return h
    found(ctx, 'apiHeaders', lower)
    if (/^bearer$/i.test(scheme)) found(ctx, 'bearer', lower)
    else if (/^basic$/i.test(scheme)) found(ctx, 'basic', lower)
    if (!ctx.options.headers) return h
    return { ...h, value: keepScheme ? `${scheme} ${REDACTED}` : REDACTED }
}

// Replaces a value, keeping the spaces around it ("a= x ;" → "a= [REDACTED] ;")
function replaceTrimmed(value) {
    const start = value.length - value.trimStart().length
    const end = value.trimEnd().length
    return value.slice(0, start) + REDACTED + value.slice(end)
}

function processCookieHeader(h, ctx) {
    const enabled = ctx.options.cookies
    const names = []
    let changed = false
    const parts = h.value.split(';').map(part => {
        const eq = part.indexOf('=')
        const name = eq === -1 ? '' : part.slice(0, eq).trim()
        const value = eq === -1 ? part : part.slice(eq + 1)
        if (!isSecretValue(value)) return part
        names.push(name || '(unnamed)')
        if (!enabled) return part
        changed = true
        return eq === -1 ? replaceTrimmed(part) : part.slice(0, eq + 1) + replaceTrimmed(value)
    })
    if (!names.length) return h
    found(ctx, 'cookieHeaders', null)
    const list = ctx.names.cookieHeaders || (ctx.names.cookieHeaders = new Map())
    for (const name of names) list.set(name, (list.get(name) ?? 0) + 1)
    return changed ? { ...h, value: parts.join(';') } : h
}

// Set-Cookie: name=value; attributes (Chrome joins several with line breaks)
function processSetCookieHeader(h, ctx) {
    const enabled = ctx.options.cookies
    let changed = false
    const lines = h.value.split('\n').map(line => {
        const semi = line.indexOf(';')
        const pair = semi === -1 ? line : line.slice(0, semi)
        const eq = pair.indexOf('=')
        const name = eq === -1 ? '(unnamed)' : pair.slice(0, eq).trim() || '(unnamed)'
        const value = eq === -1 ? pair : pair.slice(eq + 1)
        if (!isSecretValue(value)) return line
        found(ctx, 'setCookieHeaders', name)
        if (!enabled) return line
        changed = true
        const rest = semi === -1 ? '' : line.slice(semi)
        return (eq === -1 ? replaceTrimmed(pair) : pair.slice(0, eq + 1) + replaceTrimmed(value)) + rest
    })
    return changed ? { ...h, value: lines.join('\n') } : h
}

const URL_HEADERS = new Set([':path', 'referer', 'location', 'content-location'])

function processHeader(h, ctx, side) {
    if (!isObject(h) || typeof h.value !== 'string' || h.value === '') return h
    const lower = String(h.name ?? '').trim().toLowerCase()
    if (lower === 'authorization' || lower === 'proxy-authorization') return processAuthorization(h, ctx, lower)
    if (lower === 'cookie') return processCookieHeader(h, ctx)
    if (lower === 'set-cookie') return processSetCookieHeader(h, ctx)
    if (isSensitiveName(lower)) return processSecretHeader(h, ctx, lower)
    // Credentials under a harmless name
    if (side === 'request' && BEARER_OR_BASIC.test(h.value)) return processSecretHeader(h, ctx, lower)
    let value = h.value
    if (URL_HEADERS.has(lower)) {
        value = processUrl(value, ctx)
    } else if (value.includes('://')) {
        value = processUrlsInText(value, ctx)
    } else if (value.includes('eyJ') && JWT.test(value)) {
        found(ctx, 'apiHeaders', lower)
        if (ctx.options.headers) value = value.replace(JWT_ALL, REDACTED)
    }
    return value === h.value ? h : { ...h, value }
}

function processHeaders(headers, ctx, side) {
    return Array.isArray(headers) ? mapList(headers, h => processHeader(h, ctx, side)) : headers
}

function processCookieList(cookies, ctx) {
    if (!Array.isArray(cookies)) return cookies
    return mapList(cookies, cookie => {
        if (!isObject(cookie) || !isSecretValue(cookie.value)) return cookie
        found(ctx, 'cookies', String(cookie.name ?? '') || '(unnamed)')
        return ctx.options.cookies ? { ...cookie, value: REDACTED } : cookie
    })
}

function processQueryList(list, ctx) {
    if (!Array.isArray(list)) return list
    return mapList(list, item => {
        if (!isObject(item) || typeof item.value !== 'string') return item
        const name = safeDecode(String(item.name ?? ''))
        const value = safeDecode(item.value)
        if (!isSecretValue(value) || !(isSensitiveName(name) || JWT.test(value))) return item
        found(ctx, 'queryParams', name, value)
        return ctx.options.query ? { ...item, value: REDACTED } : item
    })
}

// postData.params: URL-encoded for form bodies (decoded to compare), raw for multipart
function processParams(params, ctx, category, enabled, encoded) {
    if (!Array.isArray(params)) return params
    const read = encoded ? safeDecode : (s) => s
    return mapList(params, param => {
        if (!isObject(param) || typeof param.value !== 'string' || param.fileName !== undefined) return param
        const name = read(String(param.name ?? ''))
        const value = read(param.value)
        if (!isSecretValue(value) || !(isSensitiveName(name) || JWT.test(value))) return param
        found(ctx, category, name, value)
        return enabled ? { ...param, value: REDACTED } : param
    })
}

const hasParams = (params) => Array.isArray(params) && params.some(p => isObject(p) && ((typeof p.value === 'string' && p.value !== '') || p.fileName))

function processPostData(post, ctx) {
    if (!isObject(post)) return post
    const enabled = ctx.options.bodyFields
    const hasText = typeof post.text === 'string' && post.text !== ''
    if (hasText || hasParams(post.params)) found(ctx, 'requestBodies', null, 'body')
    const changes = {}
    if (hasText) {
        const text = processBodyText(post.text, post.mimeType, ctx, 'requestFields', enabled)
        if (text !== post.text) changes.text = text
    }
    const encoded = !/multipart\//i.test(String(post.mimeType ?? ''))
    const params = processParams(post.params, ctx, 'requestFields', enabled, encoded)
    if (params !== post.params) changes.params = params
    if (ctx.options.dropRequestBodies) {
        if (hasText) changes.text = ''
        if (Array.isArray(post.params) && post.params.length) changes.params = []
    }
    return patch(post, changes)
}

const TEXTUAL_MIME = /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|csv|yaml|toml/

/** True for MIME types whose bodies are text. */
export function isTextualMime(mime) {
    return TEXTUAL_MIME.test(String(mime ?? '').toLowerCase())
}

function processContent(content, ctx) {
    if (!isObject(content) || typeof content.text !== 'string' || content.text === '') return content
    found(ctx, 'responseBodies', null, 'body')
    const enabled = ctx.options.bodyFields
    const mime = String(content.mimeType ?? '').toLowerCase()
    let text = content.text
    if (content.encoding === 'base64') {
        // Text bodies some tools store as base64 (Chrome does for binary ones)
        if (isTextualMime(mime)) {
            try {
                const decoded = decodeUtf8(base64ToBytes(normalizeBase64(content.text).base64))
                if (decoded !== null) {
                    const next = processBodyText(decoded, mime, ctx, 'responseFields', enabled)
                    if (next !== decoded) text = bytesToBase64(new TextEncoder().encode(next))
                }
            } catch {
                // not valid base64: leave it
            }
        }
    } else if (!/^(?:image|font|audio|video)\//.test(mime)) {
        text = processBodyText(content.text, mime, ctx, 'responseFields', enabled)
    }
    if (ctx.options.dropResponseBodies) return patch(content, { text: DROP, encoding: DROP })
    return text === content.text ? content : patch(content, { text })
}

// Chrome's _webSocketMessages: sent frames are like request bodies, received ones like responses
function processWebSocketMessages(messages, ctx) {
    if (!Array.isArray(messages)) return messages
    return mapList(messages, message => {
        if (!isObject(message) || typeof message.data !== 'string' || message.data === '') return message
        const sent = message.type === 'send'
        found(ctx, sent ? 'requestBodies' : 'responseBodies', null, 'body')
        let data = message.data
        if (message.opcode !== 2) data = processBodyText(data, '', ctx, sent ? 'requestFields' : 'responseFields', ctx.options.bodyFields)
        if (sent ? ctx.options.dropRequestBodies : ctx.options.dropResponseBodies) data = ''
        return data === message.data ? message : { ...message, data }
    })
}

const REQUEST_PLAIN = new Set(['method', 'httpVersion', 'headersSize', 'bodySize'])
const RESPONSE_PLAIN = new Set(['status', 'statusText', 'httpVersion', 'headersSize', 'bodySize', '_transferSize', '_error'])
const ENTRY_PLAIN = new Set(['pageref', 'startedDateTime', 'time', 'timings', 'serverIPAddress', 'connection', '_resourceType', '_priority', '_fromCache', '_connectionId'])

function processRequest(req, ctx) {
    if (!isObject(req)) return req
    const changes = {}
    for (const key of Object.keys(req)) {
        const value = req[key]
        let next = value
        if (key === 'url') next = processUrl(value, ctx)
        else if (key === 'headers') next = processHeaders(value, ctx, 'request')
        else if (key === 'cookies') next = processCookieList(value, ctx)
        else if (key === 'queryString') next = processQueryList(value, ctx)
        else if (key === 'postData') next = processPostData(value, ctx)
        else if (!REQUEST_PLAIN.has(key)) next = processUrlsDeep(value, ctx)
        if (next !== value) changes[key] = next
    }
    return patch(req, changes)
}

function processResponse(res, ctx) {
    if (!isObject(res)) return res
    const changes = {}
    for (const key of Object.keys(res)) {
        const value = res[key]
        let next = value
        if (key === 'headers') next = processHeaders(value, ctx, 'response')
        else if (key === 'cookies') next = processCookieList(value, ctx)
        else if (key === 'content') next = processContent(value, ctx)
        else if (key === 'redirectURL') next = processUrl(value, ctx)
        else if (!RESPONSE_PLAIN.has(key)) next = processUrlsDeep(value, ctx)
        if (next !== value) changes[key] = next
    }
    return patch(res, changes)
}

function processEntry(entry, ctx) {
    if (!isObject(entry)) return entry
    ctx.seen = null
    const changes = {}
    for (const key of Object.keys(entry)) {
        const value = entry[key]
        let next = value
        if (key === 'request') next = processRequest(value, ctx)
        else if (key === 'response') next = processResponse(value, ctx)
        else if (key === '_webSocketMessages') next = processWebSocketMessages(value, ctx)
        else if (!ENTRY_PLAIN.has(key)) next = processUrlsDeep(value, ctx) // _initiator, comment…
        if (next !== value) changes[key] = next
    }
    return patch(entry, changes)
}

// Chrome uses the page URL as the page title
function processPage(page, ctx) {
    if (!isObject(page)) return page
    ctx.seen = null
    const changes = {}
    for (const key of Object.keys(page)) {
        if (key === 'id' || key === 'startedDateTime' || key === 'pageTimings') continue
        const next = processUrlsDeep(page[key], ctx)
        if (next !== page[key]) changes[key] = next
    }
    return patch(page, changes)
}

function processHar(har, options) {
    const ctx = {
        options,
        counts: Object.fromEntries(CATEGORY_IDS.map(id => [id, 0])),
        names: {},
        seen: null, // per entry, created when needed
    }
    const log = har.log
    const changes = {}
    const entries = mapList(log.entries, entry => processEntry(entry, ctx))
    if (entries !== log.entries) changes.entries = entries
    if (Array.isArray(log.pages)) {
        const pages = mapList(log.pages, page => processPage(page, ctx))
        if (pages !== log.pages) changes.pages = pages
    }
    if (log.comment !== undefined) {
        ctx.seen = null
        const comment = processUrlsDeep(log.comment, ctx)
        if (comment !== log.comment) changes.comment = comment
    }
    const nextLog = patch(log, changes)
    return { har: nextLog === log ? har : patch(har, { log: nextLog }), counts: ctx.counts, names: ctx.names }
}

/**
 * What's sensitive in a HAR: { counts: { [category]: n }, names: { [category]: Map(name → n) } }.
 * Categories are SECRET_CATEGORIES and BODY_CATEGORIES. Values are never reported.
 */
export function scanHar(har) {
    const { counts, names } = processHar(har, NO_REDACTION)
    return { counts, names }
}

/**
 * A sanitized copy of a HAR (the input isn't changed; unchanged parts are
 * shared). Options default to DEFAULT_SANITIZE_OPTIONS. Returns
 * { har, before }, `before` being the scan of the input.
 */
export function sanitizeHar(har, options = DEFAULT_SANITIZE_OPTIONS) {
    const settings = { ...DEFAULT_SANITIZE_OPTIONS, ...options }
    const { har: clean, counts, names } = processHar(har, settings)
    return { har: clean, before: { counts, names } }
}

/** Names found per category as sorted lists: { [category]: [{ name, count }] }. */
export function namesByCategory(names, limit = 12) {
    const out = {}
    for (const [category, map] of Object.entries(names ?? {})) {
        out[category] = [...map].map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, limit)
    }
    return out
}

// -------------------------------------------------------- serialization ---

const ENTRIES_MARK = '\u0000har-entries\u0000'
const ENTRIES_PER_CHUNK = 500

/**
 * The JSON text of a HAR in pieces (up to 500 entries each), laid out like
 * JSON.stringify(har, null, indent) with the input's line breaks, byte order
 * mark and surrounding whitespace (`format` from detectJsonFormat). Writing
 * pieces keeps memory low for big files.
 */
export function* harChunks(har, format = {}) {
    const gap = typeof format.indent === 'number' ? ' '.repeat(format.indent) : format.indent ?? '  '
    const newline = format.newline === '\r\n' ? '\r\n' : '\n'
    const fix = newline === '\n' ? (s) => s : (s) => s.replace(/\n/g, '\r\n')
    const lead = (format.bom ? '﻿' : '') + (format.leading ?? '')
    const trail = format.trailing ?? ''
    const entries = har?.log?.entries
    if (!isObject(har) || !isObject(har.log) || !Array.isArray(entries)) {
        yield lead + fix(JSON.stringify(har, null, gap)) + trail
        return
    }
    const shell = JSON.stringify(patch(har, { log: patch(har.log, { entries: ENTRIES_MARK }) }), null, gap)
    const marker = JSON.stringify(ENTRIES_MARK)
    const at = shell.indexOf(marker)
    yield lead + fix(shell.slice(0, at))
    if (!entries.length) {
        yield '[]'
    } else {
        // Each batch is written inside { log: { entries } }, so JSON.stringify
        // indents the entries at their real depth; the array's inside is kept.
        const close = gap ? `\n${gap.repeat(2)}` : ''
        for (let k = 0; k < entries.length; k += ENTRIES_PER_CHUNK) {
            const json = JSON.stringify({ log: { entries: entries.slice(k, k + ENTRIES_PER_CHUNK) } }, null, gap)
            const inside = json.slice(json.indexOf('[') + 1, json.lastIndexOf(']') - close.length)
            yield (k === 0 ? '[' : ',') + fix(inside)
        }
        yield fix(close) + ']'
    }
    yield fix(shell.slice(at + marker.length)) + trail
}

/** The whole JSON text of a HAR (see harChunks). */
export function serializeHar(har, format) {
    return Array.from(harChunks(har, format)).join('')
}

/** "capture.har" → "capture.sanitized.har" (also for .json and already sanitized names) */
export function sanitizedFileName(name) {
    const base = String(name ?? '').trim().replace(/(?:\.sanitized)?\.(?:har|json)$/i, '').trim() || 'network-log'
    return `${base}.sanitized.har`
}

// ------------------------------------------------------------ detail view ---

/** Pretty-prints JSON text without re-parsing values (big numbers and escapes stay as written). Null if invalid. */
export function prettyJson(text, indent = '  ') {
    try {
        JSON.parse(text)
    } catch {
        return null
    }
    const out = []
    let depth = 0
    const n = text.length
    for (let i = 0; i < n; i++) {
        const c = text[i]
        if (c === '"') {
            let j = i + 1
            while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
            out.push(text.slice(i, j + 1))
            i = j
        } else if (c === '{' || c === '[') {
            let j = i + 1
            while (j < n && /\s/.test(text[j])) j++
            if (text[j] === (c === '{' ? '}' : ']')) {
                out.push(c + text[j])
                i = j
            } else {
                depth++
                out.push(c, '\n', indent.repeat(depth))
            }
        } else if (c === '}' || c === ']') {
            depth--
            out.push('\n', indent.repeat(depth), c)
        } else if (c === ',') {
            out.push(',\n', indent.repeat(depth))
        } else if (c === ':') {
            out.push(': ')
        } else if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
            let j = i + 1
            while (j < n && !/[\s,:{}[\]"]/.test(text[j])) j++
            out.push(text.slice(i, j))
            i = j - 1
        }
    }
    return out.join('')
}

/** Prism language for a MIME type (see src/components/ui/prism.js). */
export function bodyLanguage(mime) {
    const type = String(mime ?? '').toLowerCase()
    if (type.includes('json')) return 'json'
    if (/html|xml|svg/.test(type)) return 'markup'
    if (/javascript|ecmascript/.test(type)) return 'javascript'
    if (type === 'text/css') return 'css'
    if (type.includes('graphql')) return 'graphql'
    if (type.includes('yaml')) return 'yaml'
    return 'text'
}

function base64ByteLength(text) {
    const clean = text.replace(/\s+/g, '')
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
    return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}

/**
 * How to show a response body: { kind: 'none' | 'text' | 'image' | 'binary', mime, size, … }.
 * Images get a data: URL; base64 text is decoded; other binary data only gets its size.
 */
export function responseBodyView(content) {
    const c = isObject(content) ? content : {}
    const mime = String(c.mimeType ?? '').split(';')[0].trim().toLowerCase()
    const size = nonNegative(c.size)
    const text = typeof c.text === 'string' ? c.text : ''
    if (!text) return { kind: 'none', mime, size }
    const base64 = c.encoding === 'base64'
    if (base64 && mime.startsWith('image/')) {
        return { kind: 'image', mime, size, bytes: base64ByteLength(text), dataUrl: `data:${mime};base64,${text.replace(/\s+/g, '')}` }
    }
    if (!base64 && mime === 'image/svg+xml') {
        return { kind: 'image', mime, size, bytes: new TextEncoder().encode(text).length, dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, text }
    }
    if (base64) {
        if (mime && !isTextualMime(mime)) return { kind: 'binary', mime, size, bytes: base64ByteLength(text) }
        let bytes
        try {
            bytes = base64ToBytes(normalizeBase64(text).base64)
        } catch {
            return { kind: 'binary', mime, size, bytes: base64ByteLength(text), invalid: true }
        }
        const decoded = decodeUtf8(bytes)
        if (decoded !== null && !looksBinaryText(decoded)) return { kind: 'text', mime, size, text: decoded, decoded: true }
        return { kind: 'binary', mime, size, bytes: bytes.length }
    }
    return { kind: 'text', mime, size, text }
}

/** name=value pairs of a query string or form body, decoded where possible. */
export function parsePairs(text) {
    if (typeof text !== 'string' || text === '') return []
    return text.split('&').filter(Boolean).map(part => {
        const eq = part.indexOf('=')
        return eq === -1 ? { name: safeDecode(part), value: '' } : { name: safeDecode(part.slice(0, eq)), value: safeDecode(part.slice(eq + 1)) }
    })
}

/** Query parameters of a request: its queryString list, or parsed from the URL. */
export function queryParamsOf(request) {
    const req = isObject(request) ? request : {}
    if (Array.isArray(req.queryString) && req.queryString.length) {
        return req.queryString.filter(isObject).map(q => ({ name: safeDecode(String(q.name ?? '')), value: safeDecode(String(q.value ?? '')) }))
    }
    const url = typeof req.url === 'string' ? req.url.replace(/#.*$/, '') : ''
    const q = url.indexOf('?')
    return q === -1 ? [] : parsePairs(url.slice(q + 1))
}

/** Cookies of a request or response: its cookies list, or parsed from Cookie / Set-Cookie headers. */
export function cookiesOf(message, side) {
    const m = isObject(message) ? message : {}
    if (Array.isArray(m.cookies) && m.cookies.length) return m.cookies.filter(isObject)
    const headers = Array.isArray(m.headers) ? m.headers.filter(h => isObject(h) && typeof h.value === 'string') : []
    if (side === 'request') {
        return headers.filter(h => String(h.name).toLowerCase() === 'cookie')
            .flatMap(h => h.value.split(';'))
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
                const eq = part.indexOf('=')
                return eq === -1 ? { name: '', value: part } : { name: part.slice(0, eq), value: part.slice(eq + 1) }
            })
    }
    return headers.filter(h => String(h.name).toLowerCase() === 'set-cookie')
        .flatMap(h => h.value.split('\n'))
        .filter(line => line.trim())
        .map(line => {
            const [pair, ...attributes] = line.split(';')
            const eq = pair.indexOf('=')
            const cookie = eq === -1 ? { name: '', value: pair.trim() } : { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() }
            for (const attribute of attributes) {
                const [key, ...rest] = attribute.split('=')
                const k = key.trim().toLowerCase()
                const v = rest.join('=').trim()
                if (k === 'path') cookie.path = v
                else if (k === 'domain') cookie.domain = v
                else if (k === 'expires') cookie.expires = v
                else if (k === 'max-age') cookie.maxAge = v
                else if (k === 'httponly') cookie.httpOnly = true
                else if (k === 'secure') cookie.secure = true
                else if (k === 'samesite') cookie.sameSite = v
            }
            return cookie
        })
}

// ------------------------------------------------------------------ cURL ---

// Headers curl sets itself, and HTTP/2 pseudo-headers (:method, :path…)
const CURL_SKIPPED_HEADERS = new Set(['host', 'content-length'])

/**
 * A cURL command for the entry's request (bash/zsh quoting, via
 * codeGenerator). Accept-Encoding becomes --compressed, as in DevTools.
 */
export function harToCurl(entry) {
    const req = isObject(entry) && isObject(entry.request) ? entry.request : {}
    const post = isObject(req.postData) ? req.postData : null
    const mime = String(post?.mimeType ?? '')
    let compressed = false
    let headers = (Array.isArray(req.headers) ? req.headers : [])
        .filter(h => isObject(h) && String(h.name ?? '').trim() !== '')
        .filter(h => {
            const lower = String(h.name).trim().toLowerCase()
            if (lower === 'accept-encoding') {
                compressed = true
                return false
            }
            return !lower.startsWith(':') && !CURL_SKIPPED_HEADERS.has(lower)
        })
        .map(h => ({ key: String(h.name).trim(), value: String(h.value ?? '') }))

    let body = ''
    let form = []
    if (post && typeof post.text === 'string' && post.text !== '') {
        body = post.text
    } else if (post && Array.isArray(post.params) && post.params.length) {
        const params = post.params.filter(isObject)
        if (/multipart\/form-data/i.test(mime)) {
            form = params.map(p => (p.fileName !== undefined
                ? { key: String(p.name ?? ''), file: String(p.fileName), ...(p.contentType ? { contentType: String(p.contentType) } : {}) }
                : { key: String(p.name ?? ''), value: String(p.value ?? '') }))
            // curl writes its own multipart Content-Type with a new boundary
            headers = headers.filter(h => h.key.toLowerCase() !== 'content-type')
        } else {
            const encode = (s) => (/^[\w.~%+-]*$/.test(s) ? s : encodeURIComponent(s))
            body = params.map(p => `${encode(String(p.name ?? ''))}=${encode(String(p.value ?? ''))}`).join('&')
        }
    }
    return generateCode({
        method: typeof req.method === 'string' && req.method ? req.method : 'GET',
        url: typeof req.url === 'string' ? req.url : '',
        headers,
        body,
        form,
        options: { compressed },
    }, 'curl')
}

// --------------------------------------------------------------- timings ---

export const TIMING_PHASES = [
    { id: 'blocked', label: 'Blocked (queueing)' },
    { id: 'dns', label: 'DNS lookup' },
    { id: 'connect', label: 'Initial connection' },
    { id: 'ssl', label: 'SSL/TLS' },
    { id: 'send', label: 'Request sent' },
    { id: 'wait', label: 'Waiting for server' },
    { id: 'receive', label: 'Content download' },
]

/**
 * Timing phases ({ id, label, ms | null }; -1 means "not applicable") and
 * bar segments laid end to end. In HAR 1.2 the SSL time is part of connect,
 * so the connect segment leaves it out.
 */
export function timingBreakdown(timings) {
    const t = isObject(timings) ? timings : {}
    const phases = TIMING_PHASES.map(p => ({ ...p, ms: nonNegative(t[p.id]) }))
    const ssl = nonNegative(t.ssl)
    const segments = []
    let at = 0
    for (const phase of phases) {
        let ms = phase.ms
        if (phase.id === 'connect' && ms !== null && ssl !== null) ms = Math.max(0, ms - ssl)
        if (ms === null || ms <= 0) continue
        segments.push({ id: phase.id, label: phase.label, start: at, ms })
        at += ms
    }
    return { phases, segments, total: at }
}

/** "0.4 ms", "152 ms", "1.25 s", "2.5 min"; "—" when unknown. */
export function formatMs(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
    if (ms < 10) return `${ms.toFixed(1)} ms`
    if (ms < 999.5) return `${Math.round(ms)} ms`
    if (ms < 59_995) return `${(ms / 1000).toFixed(2)} s`
    return `${(ms / 60_000).toFixed(1)} min`
}
