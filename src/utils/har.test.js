import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import {
    BODY_CATEGORIES, DEFAULT_SANITIZE_OPTIONS, HarError, REDACTED, RESOURCE_TYPES, SECRET_CATEGORIES,
    bodyLanguage, buildRows, contentSizeOf, cookiesOf, detectJsonFormat, entryTime, formatMs, harChunks, harToCurl,
    isSecretValue, isSensitiveName, namesByCategory, parseHar, parsePairs, prettyJson, queryParamsOf,
    resourceTypeOf, responseBodyView, sanitizeHar, sanitizedFileName, scanHar, secretTotal, serializeHar,
    splitUrl, statusClassOf, summarizeHar, timingBreakdown, transferSizeOf, validateHar,
} from './har.js'
import { SENSITIVE_NAME, redactUrl } from './redact.js'
import { splitShellWords } from './shell.js'

const FIXTURE_TEXT = fs.readFileSync(new URL('../../tests/fixtures/har/sample.har', import.meta.url), 'utf8')
const fixture = () => JSON.parse(FIXTURE_TEXT)

// Every secret planted in the fixture (see tests/fixtures/har/sample.har)
const PLANTED = [
    'SECRET-COOKIE-SID-41d2', 'SECRET-REDIRECT-TOKEN-5d1f', 'SECRET-FRAGMENT-TOKEN-9a9a', 'SECRET-SETCOOKIE-CSRF-88aa',
    'SECRET-APIKEY-QUERY-55b1', 'SECRET-BEARER-7f3a9c', 'SECRET-XAPIKEY-HEADER-0f0f', 'SECRET-JSON-CARDTOKEN-c3d4',
    'SECRET-NESTED-PW-1a2b', 'SECRET-RESPONSE-TOKEN-77ef', 'SECRET-PASSWORD-FORM-9e0c', 'SECRET-CSRF-HEADER-3c3c',
    'SECRET-JWT-SIG-0a0a', 'SECRET-MULTIPART-TOKEN-6e6e', 'SECRET-URL-PW-8c8c', 'SECRET-BEACON-SESSION-1d1d',
    'SECRET-WS-TOKEN-2e2e', 'SECRET-WS-SEND-TOKEN-4f4f',
    // Basic credentials for jane:SECRET-BASIC-PW-6b6b
    'amFuZTpTRUNSRVQtQkFTSUMtUFctNmI2Yg==',
]

const ALL_OFF = { headers: false, cookies: false, query: false, bodyFields: false, dropRequestBodies: false, dropResponseBodies: false }
const only = (key) => ({ ...ALL_OFF, [key]: true })

// A minimal HAR around the given entries
function makeHar(entries, log = {}) {
    return { log: { version: '1.2', creator: { name: 'test', version: '1' }, ...log, entries } }
}

// A minimal entry; request/response fields override the defaults
function makeEntry({ request = {}, response = {}, ...rest } = {}) {
    return {
        startedDateTime: '2026-01-01T00:00:00.000Z',
        time: 10,
        request: { method: 'GET', url: 'https://example.test/', httpVersion: 'HTTP/1.1', headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: 0, ...request },
        response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [], cookies: [], content: { size: 0, mimeType: 'text/plain' }, redirectURL: '', headersSize: -1, bodySize: 0, ...response },
        cache: {},
        timings: { send: 1, wait: 8, receive: 1 },
        ...rest,
    }
}

const one = (entry) => makeHar([makeEntry(entry)])
const clean = (har, options = DEFAULT_SANITIZE_OPTIONS) => sanitizeHar(har, options).har
const firstEntry = (har) => har.log.entries[0]

// Paths where two JSON values differ: { path, before, after } (after is undefined when the key was removed)
function diff(a, b, path = '') {
    if (Object.is(a, b)) return []
    const bothObjects = a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)
    if (!bothObjects) return [{ path, before: a, after: b }]
    const out = []
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const sub = path ? `${path}.${key}` : key
        if (!(key in b)) out.push({ path: sub, before: a[key], after: undefined })
        else if (!(key in a)) out.push({ path: sub, before: undefined, after: b[key] })
        else out.push(...diff(a[key], b[key], sub))
    }
    return out
}

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value)
        for (const key of Object.keys(value)) deepFreeze(value[key])
    }
    return value
}

// ---------------------------------------------------------------------------

describe('parseHar and validateHar', () => {
    it('parses the fixture and reads its layout', () => {
        const { har, format, malformed } = parseHar(FIXTURE_TEXT)
        expect(har.log.entries).toHaveLength(15)
        expect(malformed).toBe(0)
        expect(format).toEqual({ bom: false, leading: '', trailing: '', newline: '\n', indent: '  ' })
    })

    it('accepts a byte order mark and surrounding whitespace', () => {
        const { har, format } = parseHar(`\ufeff\n  ${JSON.stringify(makeHar([]))}  \r\n`)
        expect(har.log.entries).toEqual([])
        expect(format).toMatchObject({ bom: true, leading: '\n  ', trailing: '  \r\n', indent: '' })
    })

    it('detects tabs, CRLF line breaks and minified JSON', () => {
        expect(detectJsonFormat('{\r\n\t"log": {}\r\n}')).toMatchObject({ newline: '\r\n', indent: '\t' })
        expect(detectJsonFormat('{\n    "log": {}\n}')).toMatchObject({ newline: '\n', indent: '    ' })
        expect(detectJsonFormat('{"log":{}}')).toMatchObject({ indent: '' })
    })

    it.each([
        ['', 'The file is empty.'],
        ['   \n ', 'The file is empty.'],
        ['<!doctype html><html></html>', /looks like HTML or XML/],
        ['{"log": {"entries": [', /ends too early.*cut off/],
        ['{"log": nope}', /^This isn’t valid JSON: /],
        ['[{"request": {}}]', 'This is JSON but not a HAR file: it’s a list, and a HAR file is an object with log.entries.'],
        ['"hello"', 'This is JSON but not a HAR file: it’s a single string value, and a HAR file is an object with log.entries.'],
        ['null', /single null value/],
        ['42', /single number value/],
        ['{"version": "1.2"}', 'This is JSON but not a HAR file: it has no log.entries.'],
        ['{"log": "x"}', 'This is JSON but not a HAR file: its “log” isn’t an object.'],
        ['{"log": {"version": "1.2", "pages": []}}', 'This is JSON but not a HAR file: it has no log.entries.'],
        ['{"log": {"entries": {}}}', 'This is JSON but not a HAR file: log.entries isn’t a list.'],
        ['{"log": {"entries": [1, {"request": {}}]}}', 'This is JSON but not a HAR file: none of its 2 entries has a request URL.'],
    ])('rejects %j with a helpful message', (text, message) => {
        let error
        try {
            parseHar(text)
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(HarError)
        if (message instanceof RegExp) expect(error.message).toMatch(message)
        else expect(error.message).toBe(message)
    })

    it('rejects non-string input', () => {
        expect(() => parseHar(undefined)).toThrow(HarError)
    })

    it('counts malformed entries but accepts the file when some are usable', () => {
        expect(validateHar(makeHar([makeEntry(), null, { request: {} }]))).toEqual({ malformed: 2 })
        expect(validateHar(makeHar([]))).toEqual({ malformed: 0 })
    })
})

describe('serializeHar', () => {
    it('writes the fixture back byte for byte', () => {
        const { har, format } = parseHar(FIXTURE_TEXT)
        expect(serializeHar(har, format)).toBe(FIXTURE_TEXT)
    })

    it('matches JSON.stringify for any indentation', () => {
        const samples = [
            makeHar([]),
            makeHar([makeEntry(), makeEntry({ comment: 'é ✓ \u2028 "quoted" \\ \u0001' })], { pages: [{ id: 'p', title: 't', pageTimings: {} }], comment: 'x' }),
            { first: [1, [2, []], {}], log: { entries: [[], {}, null, 'text', 3.25, -0, 1e21] }, after: { deep: { deeper: [true, false] } } },
            { log: { entries: [{ lone: '\ud800', pair: '😀' }] } },
        ]
        for (const sample of samples) {
            for (const indent of [2, 4, '\t', '', '  ']) {
                expect(serializeHar(sample, { indent })).toBe(JSON.stringify(sample, null, indent))
            }
        }
    })

    it('keeps the input’s line breaks, byte order mark and surrounding whitespace', () => {
        const text = `\ufeff ${JSON.stringify(makeHar([makeEntry()]), null, '\t').replace(/\n/g, '\r\n')}\r\n`
        const { har, format } = parseHar(text)
        expect(serializeHar(har, format)).toBe(text)
        const minified = JSON.stringify(makeHar([makeEntry(), makeEntry()]))
        const parsed = parseHar(minified)
        expect(serializeHar(parsed.har, parsed.format)).toBe(minified)
    })

    it('writes big files in pieces of up to 500 entries, identical to JSON.stringify', () => {
        const entries = Array.from({ length: 1201 }, (_, k) => makeEntry({ request: { url: `https://a.test/${k}` }, comment: k % 2 ? 'x' : undefined }))
        const har = makeHar(entries, { pages: [] })
        // head, three batches, the closing bracket, tail
        for (const indent of ['  ', '\t', '']) {
            const pieces = Array.from(harChunks(har, { indent }))
            expect(pieces).toHaveLength(6)
            expect(pieces.join('')).toBe(JSON.stringify(har, null, indent))
        }
        const crlf = Array.from(harChunks(har, { indent: '  ', newline: '\r\n' })).join('')
        expect(crlf).toBe(JSON.stringify(har, null, 2).replace(/\n/g, '\r\n'))
        expect(Array.from(harChunks(makeHar([]), { indent: 2 }))).toHaveLength(3)
    })

    it('falls back to plain JSON for objects without log.entries', () => {
        expect(serializeHar({ a: 1 }, { indent: 2 })).toBe(JSON.stringify({ a: 1 }, null, 2))
    })
})

describe('rows and summary', () => {
    const har = fixture()
    const rows = buildRows(har)

    it('builds one row per entry with types, status classes and sizes', () => {
        expect(rows.map(r => r.type)).toEqual([
            'document', 'document', 'script', 'stylesheet', 'image', 'xhr', 'xhr', 'xhr', 'xhr', 'image', 'font', 'xhr', 'other', 'websocket', 'media',
        ])
        expect(rows.map(r => r.status)).toEqual([302, 200, 200, 200, 200, 201, 200, 404, 500, 0, 200, 200, 204, 101, 206])
        expect(rows.map(r => r.statusClass)).toEqual(['3xx', '2xx', '2xx', '2xx', '2xx', '2xx', '2xx', '4xx', '5xx', 'failed', '2xx', '2xx', '2xx', '1xx', '2xx'])
        expect(rows.map(r => r.i)).toEqual([...Array(15).keys()])
        expect(rows[9]).toMatchObject({ error: 'net::ERR_BLOCKED_BY_CLIENT', host: 'tracker.example.test', path: '/pixel.gif?uid=12345', transferred: 0 })
        expect(rows[3]).toMatchObject({ fromCache: 'disk', transferred: 0, mime: 'text/css' })
        expect(rows[5]).toMatchObject({ method: 'POST', host: 'api.example.test', path: '/v1/orders?api_key=SECRET-APIKEY-QUERY-55b1&page=1', mime: 'application/json' })
        // userinfo isn't part of the host
        expect(rows[12].host).toBe('telemetry.example.test')
        // offsets are relative to the first request
        expect(rows.map(r => r.offset)).toEqual(har.log.entries.map(e => Date.parse(e.startedDateTime) - Date.parse(har.log.entries[0].startedDateTime)))
        for (const [k, row] of rows.entries()) {
            expect(row.transferred).toBe(har.log.entries[k].response._transferSize)
            expect(row.size).toBe(har.log.entries[k].response.content.size)
            expect(row.time).toBe(har.log.entries[k].time)
        }
    })

    it('summarizes requests, failures, bytes, time, domains and types', () => {
        const summary = summarizeHar(har, rows)
        const entries = har.log.entries
        expect(summary).toMatchObject({
            requests: 15,
            failed: 1,
            clientErrors: 1,
            serverErrors: 1,
            transferred: entries.reduce((sum, e) => sum + e.response._transferSize, 0),
            size: entries.reduce((sum, e) => sum + e.response.content.size, 0),
            totalTime: { ms: 812.25, source: 'onLoad' },
            onContentLoad: 420.5,
            onLoad: 812.25,
            pages: 1,
            version: '1.2',
            creator: 'WebInspector 537.36',
        })
        expect(summary.statusClasses).toEqual({ '1xx': 1, '2xx': 10, '3xx': 1, '4xx': 1, '5xx': 1, failed: 1, other: 0 })
        expect(summary.domains).toEqual([
            { host: 'api.example.test', count: 5 },
            { host: 'cdn.example.test', count: 5 },
            { host: 'shop.example.test', count: 3 },
            { host: 'telemetry.example.test', count: 1 },
            { host: 'tracker.example.test', count: 1 },
        ])
        expect(Object.fromEntries(Object.entries(summary.byType).map(([k, v]) => [k, v.count]))).toEqual({
            document: 2, xhr: 5, script: 1, stylesheet: 1, image: 2, font: 1, media: 1, websocket: 1, other: 1,
        })
        expect(summary.byType.media.transferred).toBe(1048790)
        const t0 = Date.parse(entries[0].startedDateTime)
        const lastEnd = Math.max(...entries.map(e => (Date.parse(e.startedDateTime) - t0) + e.time))
        expect(summary.span).toBeCloseTo(lastEnd, 6)
        expect(summary.span).toBeCloseTo(880 + 359.8, 6)
    })

    it('uses first start to last end when no page has an onLoad time', () => {
        const har2 = makeHar([
            makeEntry({ startedDateTime: '2026-01-01T00:00:01.000Z', time: 50 }),
            makeEntry({ startedDateTime: '2026-01-01T00:00:00.000Z', time: 20 }),
            makeEntry({ startedDateTime: '2026-01-01T00:00:00.500Z', time: 100 }),
        ], { pages: [{ id: 'p', startedDateTime: '2026-01-01T00:00:00.000Z', title: 'x', pageTimings: { onLoad: -1 } }] })
        expect(summarizeHar(har2).totalTime).toEqual({ ms: 1050, source: 'span' })
    })

    it('spans several pages from the first start to the last onLoad', () => {
        const har2 = makeHar([makeEntry()], {
            pages: [
                { id: 'a', startedDateTime: '2026-01-01T00:00:00.000Z', title: 'a', pageTimings: { onLoad: 300 } },
                { id: 'b', startedDateTime: '2026-01-01T00:00:02.000Z', title: 'b', pageTimings: { onLoad: 250 } },
            ],
        })
        expect(summarizeHar(har2).totalTime).toEqual({ ms: 2250, source: 'onLoad' })
    })

    it('copes with entries that have no response or odd values', () => {
        const har2 = makeHar([{ request: { url: 'https://a.test/x' } }, makeEntry({ response: { status: '200' } })])
        const r = buildRows(har2)
        expect(r[0]).toMatchObject({ status: 0, statusClass: 'failed', method: '', transferred: -1, size: -1, time: null, offset: null })
        expect(r[1].statusClass).toBe('failed')
        expect(summarizeHar(har2, r).failed).toBe(2)
    })
})

describe('resource types', () => {
    it('maps Chrome’s _resourceType values to the type groups', () => {
        const cases = {
            document: 'document', prefetch: 'document', xhr: 'xhr', fetch: 'xhr', eventsource: 'xhr', script: 'script', stylesheet: 'stylesheet',
            image: 'image', font: 'font', media: 'media', websocket: 'websocket', webtransport: 'websocket', ping: 'other', manifest: 'other',
            preflight: 'other', other: 'other', Document: 'document',
        }
        for (const [raw, group] of Object.entries(cases)) expect(resourceTypeOf({ _resourceType: raw })).toBe(group)
    })

    it('falls back to the MIME type, then Sec-Fetch-Dest and the file extension', () => {
        const byMime = (mimeType) => resourceTypeOf(makeEntry({ response: { content: { size: 1, mimeType } } }))
        expect(byMime('text/html; charset=utf-8')).toBe('document')
        expect(byMime('application/json')).toBe('xhr')
        expect(byMime('application/vnd.api+json')).toBe('xhr')
        expect(byMime('text/javascript')).toBe('script')
        expect(byMime('application/x-javascript')).toBe('script')
        expect(byMime('text/css')).toBe('stylesheet')
        expect(byMime('image/svg+xml')).toBe('image')
        expect(byMime('font/woff2')).toBe('font')
        expect(byMime('application/font-woff')).toBe('font')
        expect(byMime('video/mp4')).toBe('media')
        expect(byMime('application/vnd.apple.mpegurl')).toBe('media')
        expect(byMime('text/event-stream')).toBe('xhr')
        expect(byMime('application/octet-stream')).toBe('other')
        // Content-Type header when content.mimeType is missing
        expect(resourceTypeOf(makeEntry({ response: { content: { size: 0 }, headers: [{ name: 'Content-Type', value: 'text/css' }] } }))).toBe('stylesheet')
        expect(resourceTypeOf(makeEntry({ request: { headers: [{ name: 'Sec-Fetch-Dest', value: 'script' }] }, response: { status: 0, content: { size: 0, mimeType: 'x-unknown' } } }))).toBe('script')
        expect(resourceTypeOf(makeEntry({ request: { headers: [{ name: 'X-Requested-With', value: 'XMLHttpRequest' }] }, response: { content: {} } }))).toBe('xhr')
        expect(resourceTypeOf(makeEntry({ request: { url: 'https://a.test/f/x.woff2?v=1' }, response: { status: 0, content: {} } }))).toBe('font')
        expect(resourceTypeOf(makeEntry({ request: { url: 'wss://a.test/socket' }, response: { status: 101, content: {} } }))).toBe('websocket')
        expect(resourceTypeOf(makeEntry({ request: { headers: [{ name: 'Upgrade', value: 'websocket' }] }, response: { status: 101, content: {} } }))).toBe('websocket')
        expect(resourceTypeOf(null)).toBe('other')
    })

    it('lists every type the table can filter on', () => {
        expect(RESOURCE_TYPES.map(t => t.label)).toEqual(['Document', 'XHR/Fetch', 'JS', 'CSS', 'Image', 'Font', 'Media', 'WebSocket', 'Other'])
    })
})

describe('small helpers', () => {
    it('classifies status codes', () => {
        expect([0, -1, 101, 204, 304, 404, 503, 700, NaN, '200', undefined].map(statusClassOf))
            .toEqual(['failed', 'failed', '1xx', '2xx', '3xx', '4xx', '5xx', 'other', 'failed', 'failed', 'failed'])
    })

    it('measures transfer and content sizes', () => {
        expect(transferSizeOf({ _transferSize: 512, headersSize: 1, bodySize: 1 })).toBe(512)
        expect(transferSizeOf({ headersSize: 200, bodySize: 300 })).toBe(500)
        expect(transferSizeOf({ headersSize: -1, bodySize: 300 })).toBe(300)
        expect(transferSizeOf({ headersSize: -1, bodySize: -1 })).toBe(-1)
        expect(transferSizeOf(undefined)).toBe(-1)
        expect(contentSizeOf({ content: { size: 42 } })).toBe(42)
        expect(contentSizeOf({ content: {} })).toBe(-1)
    })

    it('reads an entry’s time from `time` or its timings', () => {
        expect(entryTime({ time: 12.5 })).toBe(12.5)
        expect(entryTime({ time: -1, timings: { blocked: 1, dns: -1, connect: 10, ssl: 4, send: 1, wait: 20, receive: 3 } })).toBe(35)
        expect(entryTime({})).toBeNull()
    })

    it('splits URLs into host and path as written', () => {
        expect(splitUrl('https://user:pw@a.test:8443/p/a%20b?q=1#frag')).toEqual({ host: 'a.test:8443', path: '/p/a%20b?q=1' })
        expect(splitUrl('https://a.test')).toEqual({ host: 'a.test', path: '/' })
        expect(splitUrl('data:text/plain,hi')).toEqual({ host: '', path: 'data:text/plain,hi' })
    })

    it('formats durations', () => {
        expect([0, 0.04, 2.25, 9.96, 152.4, 999.4, 999.6, 1250, 59_990, 150_000, -1, null, NaN].map(formatMs))
            .toEqual(['0.0 ms', '0.0 ms', '2.3 ms', '10.0 ms', '152 ms', '999 ms', '1.00 s', '1.25 s', '59.99 s', '2.5 min', '—', '—', '—'])
    })

    it('names the sanitized download', () => {
        expect(sanitizedFileName('capture.har')).toBe('capture.sanitized.har')
        expect(sanitizedFileName('www.example.com.json')).toBe('www.example.com.sanitized.har')
        expect(sanitizedFileName('capture.sanitized.har')).toBe('capture.sanitized.har')
        expect(sanitizedFileName('log')).toBe('log.sanitized.har')
        expect(sanitizedFileName('')).toBe('network-log.sanitized.har')
    })

    it('treats empty, redacted and {{variable}} values as not secret', () => {
        expect(['abc', ' x '].every(isSecretValue)).toBe(true)
        expect(['', '   ', REDACTED, '{{token}}', ' {{ api.key }} ', 42, null].some(isSecretValue)).toBe(false)
    })

    it('recognizes sensitive names, including ones redact.js leaves out', () => {
        for (const name of ['Authorization', 'x-api-key', 'api_key', 'access_token', 'password', 'client_secret', 'session', 'sid', 'PHPSESSID', '_csrf', 'Ocp-Apim-Subscription-Key', 'x-functions-key', 'otp', 'code', 'sig']) {
            expect(isSensitiveName(name), name).toBe(true)
        }
        for (const name of ['Access-Control-Allow-Credentials', 'content-type', 'page', 'state', 'q', 'user-agent', 'sec-websocket-key', 'client_id', '', null]) {
            expect(isSensitiveName(name), String(name)).toBe(false)
        }
    })
})

describe('secrets report', () => {
    it('finds every secret planted in the fixture, by category', () => {
        const { counts } = scanHar(fixture())
        expect(counts).toEqual({
            authHeaders: 2, bearer: 1, basic: 1, apiHeaders: 3,
            cookieHeaders: 3, setCookieHeaders: 2, cookies: 7,
            queryParams: 8, urlPasswords: 1,
            requestFields: 7, responseFields: 1,
            requestBodies: 5, responseBodies: 11,
        })
        expect(secretTotal(counts)).toBe(34)
    })

    it('reports names, never values', () => {
        const { names } = scanHar(fixture())
        const list = namesByCategory(names)
        expect(list.queryParams).toEqual([
            { name: 'token', count: 5 }, { name: 'access_token', count: 1 }, { name: 'api_key', count: 1 }, { name: 'token_type', count: 1 },
        ])
        expect(list.authHeaders).toEqual([{ name: 'authorization', count: 2 }])
        expect(list.apiHeaders).toEqual([{ name: 'x-api-key', count: 1 }, { name: 'x-client-context', count: 1 }, { name: 'x-csrf-token', count: 1 }])
        expect(list.cookieHeaders).toEqual([{ name: 'theme', count: 3 }, { name: 'sid', count: 2 }])
        expect(list.setCookieHeaders).toEqual([{ name: 'csrftoken', count: 1 }, { name: 'prefs', count: 1 }])
        expect(list.requestFields.map(n => n.name).sort()).toEqual(['card_token', 'credentials', 'password', 'password', 'session', 'token', 'upload_token'].filter((n, i, a) => a.indexOf(n) === i).sort())
        expect(list.urlPasswords).toEqual([{ name: 'collector', count: 1 }])
        const serialized = JSON.stringify(list)
        for (const secret of PLANTED) expect(serialized).not.toContain(secret)
    })

    it('counts a parameter found in the URL, queryString and :path once per request', () => {
        const har = one({
            request: {
                url: 'https://a.test/x?token=abc',
                queryString: [{ name: 'token', value: 'abc' }],
                headers: [{ name: ':path', value: '/x?token=abc' }],
            },
        })
        expect(scanHar(har).counts.queryParams).toBe(1)
    })

    it('limits and sorts name lists', () => {
        const names = { queryParams: new Map([['b', 1], ['a', 1], ['c', 5]]) }
        expect(namesByCategory(names, 2)).toEqual({ queryParams: [{ name: 'c', count: 5 }, { name: 'a', count: 1 }] })
    })

    it('has a label and a sanitize option for every category', () => {
        for (const c of [...SECRET_CATEGORIES, ...BODY_CATEGORIES]) {
            expect(c.label).toBeTruthy()
            expect(Object.keys(DEFAULT_SANITIZE_OPTIONS)).toContain(c.option)
        }
    })
})

describe('sanitizeHar on the fixture', () => {
    it('leaves no planted secret and no personal data with the default options', () => {
        const { har, format } = parseHar(FIXTURE_TEXT)
        const text = serializeHar(clean(har), format)
        for (const secret of PLANTED) expect(text).not.toContain(secret)
        expect(text).not.toMatch(/SECRET/)
        expect(text).not.toContain('jane.doe@example.com')
        const parsed = JSON.parse(text)
        expect(parsed.log.entries).toHaveLength(15)
        expect(() => validateHar(parsed)).not.toThrow()
    })

    it('removes everything the report found: after = 0, removed = before', () => {
        const har = fixture()
        const { har: out, before } = sanitizeHar(har)
        const after = scanHar(out).counts
        for (const c of SECRET_CATEGORIES) expect(after[c.id], c.id).toBe(0)
        expect(after.responseBodies).toBe(0)
        expect(after.requestBodies).toBe(before.counts.requestBodies) // kept by default
        expect(before.counts).toEqual(scanHar(har).counts)
    })

    it('changes only sensitive values and dropped bodies, keeping keys in order', () => {
        const har = fixture()
        const out = clean(har)
        const changes = diff(har, out)
        expect(changes.length).toBeGreaterThan(30)
        const allowed = [
            /^log\.pages\.0\.title$/,
            /^log\.entries\.\d+\.request\.(url|postData\.text)$/,
            /^log\.entries\.\d+\.request\.(headers|queryString|cookies|postData\.params)\.\d+\.value$/,
            /^log\.entries\.\d+\.response\.(headers|cookies)\.\d+\.value$/,
            /^log\.entries\.\d+\.response\.redirectURL$/,
            /^log\.entries\.\d+\.response\.content\.(text|encoding)$/,
            /^log\.entries\.\d+\._initiator\.url$/,
            /^log\.entries\.\d+\._webSocketMessages\.\d+\.data$/,
        ]
        for (const change of changes) {
            expect(allowed.some(re => re.test(change.path)), change.path).toBe(true)
            if (/content\.(text|encoding)$/.test(change.path)) expect(change.after).toBeUndefined()
            else if (/_webSocketMessages\.1\.data$/.test(change.path)) expect(change.after).toBe('') // received: dropped with response bodies
            else expect(change.after, change.path).toContain(REDACTED)
        }
        // Same keys in the same order wherever nothing was dropped
        const keysOf = (value, path = '') => (value && typeof value === 'object'
            ? [path + ':' + Object.keys(value).join(','), ...Object.keys(value).flatMap(k => keysOf(value[k], `${path}.${k}`))]
            : [])
        const withoutContentText = (value) => JSON.parse(JSON.stringify(value, (k, v) => (k === 'text' || k === 'encoding' ? undefined : v)))
        expect(keysOf(withoutContentText(out))).toEqual(keysOf(withoutContentText(har)))
        // Untouched values are the same objects (shared, not copied)
        expect(out.log.entries[14]).toBe(har.log.entries[14])
        expect(out.log.entries[9]).toBe(har.log.entries[9])
        expect(out.log.entries[5].timings).toBe(har.log.entries[5].timings)
    })

    it('keeps the redacted values readable', () => {
        const out = clean(fixture())
        const [redirect, doc, script, , , xhr, form, notFound, , , , upload, beacon, socket] = out.log.entries
        expect(redirect.response.redirectURL).toBe('https://shop.example.test/account?token=[REDACTED]#access_token=[REDACTED]&token_type=[REDACTED]')
        expect(redirect.request.headers.find(h => h.name === 'Cookie').value).toBe('sid=[REDACTED]; theme=[REDACTED]')
        expect(doc.request.url).toBe('https://shop.example.test/account?token=[REDACTED]')
        expect(doc.request.headers.find(h => h.name === ':path').value).toBe('/account?token=[REDACTED]')
        expect(doc.response.headers.find(h => h.name === 'set-cookie').value).toBe('csrftoken=[REDACTED]; Path=/; Secure; SameSite=Lax\nprefs=[REDACTED]; Path=/; Max-Age=31536000')
        expect(doc.response.headers.find(h => h.name === 'access-control-allow-credentials').value).toBe('true')
        expect(doc.response.cookies.map(c => c.value)).toEqual([REDACTED, REDACTED])
        expect(script._initiator).toEqual({ type: 'parser', url: 'https://shop.example.test/account?token=[REDACTED]', lineNumber: 8 })
        expect(script.request.headers.find(h => h.name === 'referer').value).toBe('https://shop.example.test/account?token=[REDACTED]')
        expect(xhr.request.url).toBe('https://api.example.test/v1/orders?api_key=[REDACTED]&page=1')
        expect(xhr.request.queryString).toEqual([{ name: 'api_key', value: REDACTED }, { name: 'page', value: '1' }])
        expect(xhr.request.headers.find(h => h.name === 'authorization').value).toBe('Bearer [REDACTED]')
        expect(xhr.request.headers.find(h => h.name === 'x-api-key').value).toBe(REDACTED)
        expect(JSON.parse(xhr.request.postData.text)).toEqual({
            item: 'book', qty: 2, payment: { method: 'card', card_token: REDACTED }, credentials: { username: REDACTED, password: REDACTED },
        })
        expect(form.request.postData.text).toBe('username=jane&password=[REDACTED]&remember=1')
        expect(form.request.postData.params[1]).toEqual({ name: 'password', value: REDACTED })
        expect(notFound.request.headers.find(h => h.name === 'authorization').value).toBe('Basic [REDACTED]')
        expect(upload.request.postData.text).toContain('name="upload_token"\r\n\r\n[REDACTED]\r\n')
        expect(upload.request.postData.text).toContain('name="description"\r\n\r\nProfile picture\r\n')
        expect(upload.request.postData.params[2]).toEqual({ name: 'avatar', fileName: 'avatar.png', contentType: 'image/png' })
        expect(beacon.request.url).toBe('https://collector:[REDACTED]@telemetry.example.test/collect')
        expect(beacon.request.postData.text).toBe('{"event":"view","session":"[REDACTED]"}')
        expect(socket.request.url).toBe('wss://api.example.test/live?token=[REDACTED]')
        expect(socket._webSocketMessages.map(m => m.data)).toEqual(['{"type":"auth","token":"[REDACTED]"}', ''])
        expect(out.log.pages[0].title).toBe('https://shop.example.test/account?token=[REDACTED]')
        // Bodies dropped, sizes and types kept
        expect(doc.response.content).toEqual({ size: fixture().log.entries[1].response.content.size, mimeType: 'text/html', compression: fixture().log.entries[1].response.content.compression })
        expect(out.log.entries[4].response.content).toEqual({ size: fixture().log.entries[4].response.content.size, mimeType: 'image/png' })
    })

    it('is idempotent', () => {
        const once = clean(fixture())
        const twice = sanitizeHar(once)
        expect(serializeHar(twice.har, { indent: 2 })).toBe(serializeHar(once, { indent: 2 }))
        expect(secretTotal(twice.before.counts)).toBe(0)
        expect(twice.har).toBe(once)
    })

    it('never changes its input', () => {
        const har = deepFreeze(fixture())
        expect(() => sanitizeHar(har)).not.toThrow()
        expect(serializeHar(har, { indent: 2 })).toBe(FIXTURE_TEXT)
    })

    it('changes nothing with every option off', () => {
        const har = fixture()
        const { har: out } = sanitizeHar(har, ALL_OFF)
        expect(out).toBe(har)
    })

    it.each([
        ['headers', ['authHeaders', 'bearer', 'basic', 'apiHeaders']],
        ['cookies', ['cookieHeaders', 'setCookieHeaders', 'cookies']],
        ['query', ['queryParams', 'urlPasswords']],
        ['bodyFields', ['requestFields', 'responseFields']],
        ['dropRequestBodies', ['requestBodies', 'requestFields']],
        ['dropResponseBodies', ['responseBodies', 'responseFields']],
    ])('option %s removes only its own categories', (option, categories) => {
        const har = fixture()
        const before = scanHar(har).counts
        const after = scanHar(clean(har, only(option))).counts
        for (const id of Object.keys(before)) {
            if (categories.includes(id)) expect(after[id], id).toBe(0)
            else expect(after[id], id).toBe(before[id])
        }
    })

    it('drops request bodies but keeps their MIME type', () => {
        const out = clean(fixture(), { ...DEFAULT_SANITIZE_OPTIONS, dropRequestBodies: true })
        const [, , , , , xhr, form, , , , , upload, beacon, socket] = out.log.entries
        expect(xhr.request.postData).toEqual({ mimeType: 'application/json', text: '' })
        expect(form.request.postData).toEqual({ mimeType: 'application/x-www-form-urlencoded', text: '', params: [] })
        expect(upload.request.postData.params).toEqual([])
        expect(beacon.request.postData.text).toBe('')
        expect(socket._webSocketMessages[0].data).toBe('')
        expect(xhr.request.bodySize).toBe(fixture().log.entries[5].request.bodySize)
        expect(scanHar(out).counts.requestBodies).toBe(0)
    })

    it('redacts fields in kept response bodies', () => {
        const out = clean(fixture(), { ...DEFAULT_SANITIZE_OPTIONS, dropResponseBodies: false })
        const xhr = out.log.entries[5]
        expect(JSON.parse(xhr.response.content.text)).toEqual({ id: 991, status: 'created', access_token: REDACTED, customer: { name: 'Jane Doe', email: 'jane.doe@example.com' } })
        expect(out.log.entries[4].response.content).toEqual(fixture().log.entries[4].response.content) // image untouched
        expect(out.log.entries[1].response.content.text).toBe(fixture().log.entries[1].response.content.text)
        expect(scanHar(out).counts.responseFields).toBe(0)
    })
})

describe('sanitizeHar by category', () => {
    const header = (name, value) => ({ name, value })
    const reqHeaders = (har) => firstEntry(har).request.headers.map(h => h.value)
    const resHeaders = (har) => firstEntry(har).response.headers.map(h => h.value)

    it('keeps the scheme of Authorization headers', () => {
        const har = one({
            request: {
                headers: [
                    header('Authorization', 'Bearer abc.def'), header('authorization', 'Basic dXNlcjpwYXNz'),
                    header('Proxy-Authorization', 'Digest username="u", response="r"'), header('AUTHORIZATION', 'rawtoken'),
                    header('Authorization', ''), header('Authorization', 'Bearer {{token}}'), header('Authorization', 'Bearer [REDACTED]'),
                ],
            },
        })
        const { counts } = scanHar(har)
        expect(counts).toMatchObject({ authHeaders: 4, bearer: 1, basic: 1 })
        expect(reqHeaders(clean(har))).toEqual(['Bearer [REDACTED]', 'Basic [REDACTED]', 'Digest [REDACTED]', REDACTED, '', 'Bearer {{token}}', 'Bearer [REDACTED]'])
    })

    it('hides API key, token and session headers, and credentials under other names', () => {
        const har = one({
            request: {
                headers: [
                    header('X-API-Key', 'k1'), header('x-auth-token', 't1'), header('Ocp-Apim-Subscription-Key', 's1'), header('X-Session-Id', 'sess'),
                    header('X-Forwarded-Auth', 'Bearer fwd'), header('X-Debug', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig-part'),
                    header('Accept', 'text/html'), header('X-Api-Key', '{{apiKey}}'), header('X-Request-Id', 'abc-123'),
                ],
            },
            response: {
                headers: [
                    header('Access-Control-Allow-Credentials', 'true'), header('WWW-Authenticate', 'Bearer realm="api"'),
                    header('X-CSRF-Token', 'csrf1'), header('Content-Type', 'text/html'),
                ],
            },
        })
        expect(scanHar(har).counts).toMatchObject({ apiHeaders: 7, bearer: 1, authHeaders: 0 })
        const out = clean(har)
        expect(reqHeaders(out)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED, 'Bearer [REDACTED]', REDACTED, 'text/html', '{{apiKey}}', 'abc-123'])
        expect(resHeaders(out)).toEqual(['true', 'Bearer realm="api"', REDACTED, 'text/html'])
    })

    it('replaces a JWT inside a longer header value', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'
        const out = clean(one({ request: { headers: [header('X-Context', `v=1; ctx=${jwt}; mode=debug`)] } }))
        expect(reqHeaders(out)).toEqual(['v=1; ctx=[REDACTED]; mode=debug'])
    })

    it('removes cookie values and keeps cookie names and attributes', () => {
        const har = one({
            request: {
                headers: [header('Cookie', 'a=1; b=two;c=; {{x}}=y ;malformed'), header('cookie', 'k={{var}}')],
                cookies: [{ name: 'a', value: '1', path: '/' }, { name: 'c', value: '' }, { name: 'v', value: '{{var}}' }],
            },
            response: {
                headers: [header('Set-Cookie', 'sid=s3cr3t; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly'), header('set-cookie', 'x=1\ny=2; Secure'), header('Set-Cookie', 'gone=; Max-Age=0')],
                cookies: [{ name: 'sid', value: 's3cr3t', httpOnly: true }],
            },
        })
        expect(scanHar(har).counts).toMatchObject({ cookieHeaders: 1, setCookieHeaders: 3, cookies: 2 })
        expect(namesByCategory(scanHar(har).names).cookieHeaders.map(n => n.name)).toEqual(['(unnamed)', '{{x}}', 'a', 'b'])
        const out = clean(har)
        expect(reqHeaders(out)).toEqual(['a=[REDACTED]; b=[REDACTED];c=; {{x}}=[REDACTED] ;[REDACTED]', 'k={{var}}'])
        expect(firstEntry(out).request.cookies).toEqual([{ name: 'a', value: REDACTED, path: '/' }, { name: 'c', value: '' }, { name: 'v', value: '{{var}}' }])
        expect(resHeaders(out)).toEqual(['sid=[REDACTED]; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly', 'x=[REDACTED]\ny=[REDACTED]; Secure', 'gone=; Max-Age=0'])
        expect(firstEntry(out).response.cookies).toEqual([{ name: 'sid', value: REDACTED, httpOnly: true }])
    })

    it('redacts sensitive query parameters in the URL and the queryString list', () => {
        const har = one({
            request: {
                url: 'https://a.test/p?q=shoes&api%5Fkey=k%20y&access_token=t+1&token=&code={{code}}&sig=%7B%7Bsig%7D%7D&page=2&x=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.&passage=1',
                queryString: [{ name: 'q', value: 'shoes' }, { name: 'api%5Fkey', value: 'k%20y' }, { name: 'access_token', value: 't 1' }, { name: 'page', value: '2' }],
            },
        })
        const { counts, names } = scanHar(har)
        expect(counts.queryParams).toBe(4)
        expect(namesByCategory(names).queryParams.map(n => n.name).sort()).toEqual(['access_token', 'api_key', 'passage', 'x'])
        const out = firstEntry(clean(har)).request
        expect(out.url).toBe('https://a.test/p?q=shoes&api%5Fkey=[REDACTED]&access_token=[REDACTED]&token=&code={{code}}&sig=%7B%7Bsig%7D%7D&page=2&x=[REDACTED]&passage=[REDACTED]')
        expect(out.queryString).toEqual([{ name: 'q', value: 'shoes' }, { name: 'api%5Fkey', value: REDACTED }, { name: 'access_token', value: REDACTED }, { name: 'page', value: '2' }])
    })

    it('redacts tokens in fragments, URL passwords, redirects and URL-valued headers', () => {
        const har = one({
            request: {
                url: 'https://user:hunter2@a.test/app#/callback?code=abc&lang=en',
                headers: [
                    header(':path', '/app?session=s1'), header('Referer', 'https://a.test/?token=r1#x'), header('Origin', 'https://a.test'),
                    header('Link', '<https://cdn.test/a.css?sig=l1>; rel=preload'),
                ],
            },
            response: {
                status: 302,
                headers: [header('Location', '/next#access_token=f1&expires_in=3600'), header('Content-Location', 'https://a.test/c?password=c1')],
                redirectURL: '/next#access_token=f1&expires_in=3600',
            },
        })
        expect(scanHar(har).counts).toMatchObject({ urlPasswords: 1, queryParams: 6 })
        const out = firstEntry(clean(har))
        expect(out.request.url).toBe('https://user:[REDACTED]@a.test/app#/callback?code=[REDACTED]&lang=en')
        expect(out.request.headers.map(h => h.value)).toEqual(['/app?session=[REDACTED]', 'https://a.test/?token=[REDACTED]#x', 'https://a.test', '<https://cdn.test/a.css?sig=[REDACTED]>; rel=preload'])
        expect(out.response.headers.map(h => h.value)).toEqual(['/next#access_token=[REDACTED]&expires_in=3600', 'https://a.test/c?password=[REDACTED]'])
        expect(out.response.redirectURL).toBe('/next#access_token=[REDACTED]&expires_in=3600')
        // user names and empty passwords are not secrets
        expect(firstEntry(clean(one({ request: { url: 'https://user:@a.test/' } }))).request.url).toBe('https://user:@a.test/')
    })

    it('handles userinfo and query strings exactly like redact.js', () => {
        const urls = [
            'https://a.test/?api_key=1&b=2',
            'https://u:p@a.test/x?password=&token=t#frag',
            'https://a.test/x?a=1&&=2&token&secret=s=s&Session=1',
            'http://a.test/path?apiKey=%7B%7Bkey%7D%7D&key=k',
            'ftp://only:userinfo@a.test',
            '/relative?jwt=x&page=1',
        ]
        const scrub = (value) => (isSecretValue(decodeURIComponent(value)) ? REDACTED : value)
        for (const url of urls) {
            const ours = firstEntry(clean(one({ request: { url } }))).request.url
            expect(ours, url).toBe(redactUrl(url, scrub))
        }
        expect(SENSITIVE_NAME.test('api_key')).toBe(true)
    })

    it('redacts URLs in page titles, initiators and comments', () => {
        const har = makeHar([makeEntry({
            _initiator: { type: 'script', stack: { callFrames: [{ url: 'https://a.test/app.js?sig=abc', lineNumber: 1 }], parent: { callFrames: [{ url: 'https://a.test/?token=deep' }] } } },
            comment: 'opened from https://a.test/?code=c1 by hand',
        })], { pages: [{ id: 'p', startedDateTime: '2026-01-01T00:00:00.000Z', title: 'https://a.test/?token=t1', pageTimings: {} }], comment: 'see https://a.test/?password=x' })
        expect(scanHar(har).counts.queryParams).toBe(5)
        const out = clean(har)
        expect(out.log.pages[0].title).toBe('https://a.test/?token=[REDACTED]')
        expect(out.log.comment).toBe('see https://a.test/?password=[REDACTED]')
        expect(firstEntry(out)._initiator.stack.callFrames[0].url).toBe('https://a.test/app.js?sig=[REDACTED]')
        expect(firstEntry(out)._initiator.stack.parent.callFrames[0].url).toBe('https://a.test/?token=[REDACTED]')
        expect(firstEntry(out).comment).toBe('opened from https://a.test/?code=[REDACTED] by hand')
    })

    describe('JSON bodies', () => {
        const post = (text, mimeType = 'application/json') => one({ request: { method: 'POST', postData: { mimeType, text } } })
        const outText = (har, options) => firstEntry(clean(har, options)).request.postData.text

        it('redacts sensitive keys at any depth and keeps the formatting', () => {
            const text = '{\n  "user": "jane",\n  "password" : "p1",\n  "profile": {"settings": {"api_key": "k1", "theme": "dark"}},\n  "list": [ {"token": "t1"}, {"token": "t2"} ]\n}'
            const har = post(text)
            expect(scanHar(har).counts.requestFields).toBe(4)
            expect(outText(har)).toBe('{\n  "user": "jane",\n  "password" : "[REDACTED]",\n  "profile": {"settings": {"api_key": "[REDACTED]", "theme": "dark"}},\n  "list": [ {"token": "[REDACTED]"}, {"token": "[REDACTED]"} ]\n}')
        })

        it('redacts everything under a sensitive key, including numbers, and keeps booleans and null', () => {
            const text = '{"credentials":{"user":"u","pin":1234,"remember":true,"hint":null,"keys":["a","b"]},"code":987654,"pass_ok":false}'
            expect(outText(post(text))).toBe('{"credentials":{"user":"[REDACTED]","pin":"[REDACTED]","remember":true,"hint":null,"keys":["[REDACTED]","[REDACTED]"]},"code":"[REDACTED]","pass_ok":false}')
        })

        it('reads escaped keys, keeps big numbers and escapes elsewhere, and leaves {{variables}}', () => {
            const text = '{"pass\\u0077ord":"x\\"y","id":12345678901234567890,"note":"\\u00e9\\n","token":"{{token}}","secret":""}'
            const har = post(text)
            expect(scanHar(har).counts.requestFields).toBe(1)
            expect(outText(har)).toBe('{"pass\\u0077ord":"[REDACTED]","id":12345678901234567890,"note":"\\u00e9\\n","token":"{{token}}","secret":""}')
        })

        it('finds JWTs under any key and in arrays', () => {
            const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'
            expect(outText(post(`{"data":{"value":"${jwt}"},"list":["plain","Bearer ${jwt}"]}`))).toBe('{"data":{"value":"[REDACTED]"},"list":["plain","[REDACTED]"]}')
        })

        it('sniffs JSON sent as text/plain and accepts top-level arrays', () => {
            expect(outText(post('[{"session":"s1"}]', 'text/plain;charset=UTF-8'))).toBe('[{"session":"[REDACTED]"}]')
            expect(outText(post('  {"secret": "s"}  ', ''))).toBe('  {"secret": "[REDACTED]"}  ')
        })

        it('falls back to JWT search for invalid JSON and leaves the rest', () => {
            const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'
            expect(outText(post(`{"password": "p", broken ${jwt}`))).toBe('{"password": "p", broken [REDACTED]')
            expect(outText(post('{"password": {{pw}}}'))).toBe('{"password": {{pw}}}')
            expect(outText(post('{"a":1}{"password":"x"}'))).toBe('{"a":1}{"password":"x"}')
        })

        it('keeps bodies without sensitive fields as they are', () => {
            const har = post('{"query":"{ user { name } }","variables":{"id":1}}')
            expect(scanHar(har).counts.requestFields).toBe(0)
            expect(firstEntry(clean(har))).toBe(firstEntry(har))
        })
    })

    describe('form bodies', () => {
        it('redacts form fields in the text and in params, counting each field once', () => {
            const har = one({
                request: {
                    method: 'POST',
                    postData: {
                        mimeType: 'application/x-www-form-urlencoded; charset=UTF-8',
                        text: 'user=jane&pass%77ord=a%26b&csrf=c1&note=hi+there&token={{t}}',
                        params: [{ name: 'user', value: 'jane' }, { name: 'pass%77ord', value: 'a%26b' }, { name: 'csrf', value: 'c1' }, { name: 'note', value: 'hi+there' }, { name: 'token', value: '{{t}}' }],
                    },
                },
            })
            expect(scanHar(har).counts.requestFields).toBe(2)
            const postData = firstEntry(clean(har)).request.postData
            expect(postData.text).toBe('user=jane&pass%77ord=[REDACTED]&csrf=[REDACTED]&note=hi+there&token={{t}}')
            expect(postData.params.map(p => p.value)).toEqual(['jane', REDACTED, REDACTED, 'hi+there', '{{t}}'])
        })

        it('sniffs form bodies sent without a form MIME type', () => {
            const har = one({ request: { method: 'POST', postData: { mimeType: 'text/plain', text: 'grant_type=password&client_secret=cs1' } } })
            expect(firstEntry(clean(har)).request.postData.text).toBe('grant_type=password&client_secret=[REDACTED]')
        })
    })

    describe('multipart bodies', () => {
        const boundary = '----Boundary7MA4YWxk'
        const body = (lineBreak) => [
            `--${boundary}`, 'Content-Disposition: form-data; name="title"', '', 'Hello',
            `--${boundary}`, 'Content-Disposition: form-data; name="api_key"', '', 'k-123',
            `--${boundary}`, 'Content-Disposition: form-data; name="password"; filename="password.txt"', 'Content-Type: text/plain', '', 'file contents',
            `--${boundary}`, 'content-disposition: form-data; name=session', '', 'line one\nline two',
            `--${boundary}--`, '',
        ].join(lineBreak)

        it.each([['CRLF', '\r\n'], ['LF', '\n']])('redacts non-file fields (%s line breaks)', (_label, lineBreak) => {
            const har = one({ request: { method: 'POST', postData: { mimeType: `multipart/form-data; boundary="${boundary}"`, text: body(lineBreak) } } })
            expect(scanHar(har).counts.requestFields).toBe(2)
            const text = firstEntry(clean(har)).request.postData.text
            expect(text).toBe(body(lineBreak).replace('k-123', REDACTED).replace('line one\nline two', REDACTED))
            expect(text).toContain('file contents')
        })

        it('finds the boundary in the body when the MIME type has none', () => {
            const har = one({ request: { method: 'POST', postData: { mimeType: 'multipart/form-data', text: body('\r\n') } } })
            expect(firstEntry(clean(har)).request.postData.text).not.toContain('k-123')
        })
    })

    it('redacts JWTs in other text bodies', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln'
        const har = one({ request: { method: 'POST', postData: { mimeType: 'application/xml', text: `<auth><t>${jwt}</t><password>x</password></auth>` } } })
        expect(firstEntry(clean(har)).request.postData.text).toBe('<auth><t>[REDACTED]</t><password>x</password></auth>')
    })

    it('redacts base64 JSON responses and leaves binary bodies alone', () => {
        const json = '{"refresh_token":"r1","n":1}'
        const har = makeHar([
            makeEntry({ response: { content: { size: json.length, mimeType: 'application/json', text: Buffer.from(json).toString('base64'), encoding: 'base64' } } }),
            makeEntry({ response: { content: { size: 3, mimeType: 'image/png', text: 'iVBORw0KGgo=', encoding: 'base64' } } }),
            makeEntry({ response: { content: { size: 5, mimeType: 'application/json', text: '%%%not base64', encoding: 'base64' } } }),
        ])
        expect(scanHar(har).counts).toMatchObject({ responseFields: 1, responseBodies: 3 })
        const out = clean(har, { ...DEFAULT_SANITIZE_OPTIONS, dropResponseBodies: false })
        expect(Buffer.from(out.log.entries[0].response.content.text, 'base64').toString()).toBe('{"refresh_token":"[REDACTED]","n":1}')
        expect(out.log.entries[0].response.content.encoding).toBe('base64')
        expect(out.log.entries[1]).toBe(har.log.entries[1])
        expect(out.log.entries[2]).toBe(har.log.entries[2])
    })

    it('handles WebSocket messages like bodies, skipping binary frames', () => {
        const har = one({
            _webSocketMessages: [
                { type: 'send', time: 1, opcode: 1, data: '{"op":"auth","token":"w1"}' },
                { type: 'receive', time: 2, opcode: 1, data: '{"session":"w2","msg":"hi"}' },
                { type: 'receive', time: 3, opcode: 2, data: 'AAECAw==' },
                { type: 'send', time: 4, opcode: 1, data: '' },
            ],
        })
        expect(scanHar(har).counts).toMatchObject({ requestFields: 1, responseFields: 1, requestBodies: 1, responseBodies: 1 })
        const kept = clean(har, { ...DEFAULT_SANITIZE_OPTIONS, dropResponseBodies: false })
        expect(firstEntry(kept)._webSocketMessages.map(m => m.data)).toEqual(['{"op":"auth","token":"[REDACTED]"}', '{"session":"[REDACTED]","msg":"hi"}', 'AAECAw==', ''])
        const dropped = clean(har, { ...DEFAULT_SANITIZE_OPTIONS, dropRequestBodies: true })
        expect(firstEntry(dropped)._webSocketMessages.map(m => m.data)).toEqual(['', '', '', ''])
        expect(firstEntry(dropped)._webSocketMessages[2]).toEqual({ type: 'receive', time: 3, opcode: 2, data: '' })
    })

    it('leaves values that are only {{variables}} everywhere', () => {
        const har = one({
            request: {
                url: 'https://a.test/?token={{token}}&key=%7B%7Bkey%7D%7D',
                headers: [header('Authorization', 'Bearer {{token}}'), header('X-API-Key', '{{ apiKey }}'), header('Cookie', 'sid={{sid}}')],
                cookies: [{ name: 'sid', value: '{{sid}}' }],
                queryString: [{ name: 'token', value: '{{token}}' }],
                postData: { mimeType: 'application/json', text: '{"password":"{{password}}","nested":{"secret":"{{s}}"}}' },
            },
        })
        expect(secretTotal(scanHar(har).counts)).toBe(0)
        expect(firstEntry(clean(har)).request).toBe(firstEntry(har).request)
    })
})

describe('detail view helpers', () => {
    it('pretty-prints JSON like JSON.stringify, without touching values', () => {
        const samples = ['{"a":1,"b":[1,2,{"c":"d"}],"e":{},"f":[],"g":"x,y:{z}","h":"q\\"uote"}', '[]', '"s"', '  [ 1 , {"a" : null} ]  ', '{"t":true,"f":false}']
        for (const s of samples) expect(prettyJson(s)).toBe(JSON.stringify(JSON.parse(s), null, 2))
        expect(prettyJson('{"big":12345678901234567890,"e":"\\u00e9"}')).toBe('{\n  "big": 12345678901234567890,\n  "e": "\\u00e9"\n}')
        expect(prettyJson('{"a":')).toBeNull()
        expect(prettyJson('{"a":1}', '\t')).toBe('{\n\t"a": 1\n}')
    })

    it('picks a highlighting language from the MIME type', () => {
        expect(['application/json', 'application/ld+json', 'text/html', 'application/xml', 'image/svg+xml', 'text/javascript', 'text/css', 'application/graphql', 'application/yaml', 'text/plain', ''].map(bodyLanguage))
            .toEqual(['json', 'json', 'markup', 'markup', 'markup', 'javascript', 'css', 'graphql', 'yaml', 'text', 'text'])
    })

    it('decides how to show response bodies', () => {
        const har = fixture()
        const image = responseBodyView(har.log.entries[4].response.content)
        expect(image).toMatchObject({ kind: 'image', mime: 'image/png' })
        expect(image.dataUrl).toMatch(/^data:image\/png;base64,iVBORw0KGgo/)
        expect(image.bytes).toBe(Buffer.from(har.log.entries[4].response.content.text, 'base64').length)
        expect(responseBodyView(har.log.entries[10].response.content)).toMatchObject({ kind: 'binary', mime: 'font/woff2', bytes: 64 })
        expect(responseBodyView(har.log.entries[5].response.content)).toMatchObject({ kind: 'text', mime: 'application/json' })
        expect(responseBodyView(har.log.entries[14].response.content)).toEqual({ kind: 'none', mime: 'video/mp4', size: 1048576 })
        expect(responseBodyView({ mimeType: 'application/json; charset=utf-8', text: Buffer.from('{"a":"é"}').toString('base64'), encoding: 'base64' }))
            .toMatchObject({ kind: 'text', text: '{"a":"é"}', decoded: true })
        expect(responseBodyView({ mimeType: '', text: Buffer.from([0, 1, 2, 3, 255]).toString('base64'), encoding: 'base64' })).toMatchObject({ kind: 'binary', bytes: 5 })
        const svg = responseBodyView({ mimeType: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' })
        expect(svg.kind).toBe('image')
        expect(svg.dataUrl.startsWith('data:image/svg+xml;charset=utf-8,%3Csvg')).toBe(true)
        expect(responseBodyView(undefined)).toEqual({ kind: 'none', mime: '', size: null })
    })

    it('lists query parameters and cookies', () => {
        expect(queryParamsOf({ url: 'https://a.test/?a=1&b=x%20y&c&d=+#h=1', queryString: [] })).toEqual([
            { name: 'a', value: '1' }, { name: 'b', value: 'x y' }, { name: 'c', value: '' }, { name: 'd', value: ' ' },
        ])
        expect(queryParamsOf({ url: 'https://a.test/?z=9', queryString: [{ name: 'a%20b', value: '%41' }] })).toEqual([{ name: 'a b', value: 'A' }])
        expect(parsePairs('a=1&&b=%E0%A4%A')).toEqual([{ name: 'a', value: '1' }, { name: 'b', value: '%E0%A4%A' }])
        expect(cookiesOf({ cookies: [{ name: 'a', value: '1' }] }, 'request')).toEqual([{ name: 'a', value: '1' }])
        expect(cookiesOf({ headers: [{ name: 'Cookie', value: 'a=1; b=2=3' }], cookies: [] }, 'request')).toEqual([{ name: 'a', value: '1' }, { name: 'b', value: '2=3' }])
        expect(cookiesOf({ headers: [{ name: 'set-cookie', value: 'a=1; Path=/; HttpOnly; SameSite=Strict\nb=2; Secure; Max-Age=60; Domain=x.test; Expires=Wed, 21 Oct 2026 07:28:00 GMT' }] }, 'response')).toEqual([
            { name: 'a', value: '1', path: '/', httpOnly: true, sameSite: 'Strict' },
            { name: 'b', value: '2', secure: true, maxAge: '60', domain: 'x.test', expires: 'Wed, 21 Oct 2026 07:28:00 GMT' },
        ])
    })

    it('breaks timings into phases, with SSL inside connect', () => {
        const { phases, segments, total } = timingBreakdown({ blocked: 2, dns: 10, connect: 30, ssl: 12, send: 1, wait: 50, receive: 7 })
        expect(phases.map(p => [p.id, p.ms])).toEqual([['blocked', 2], ['dns', 10], ['connect', 30], ['ssl', 12], ['send', 1], ['wait', 50], ['receive', 7]])
        expect(segments.map(s => [s.id, s.start, s.ms])).toEqual([['blocked', 0, 2], ['dns', 2, 10], ['connect', 12, 18], ['ssl', 30, 12], ['send', 42, 1], ['wait', 43, 50], ['receive', 93, 7]])
        expect(total).toBe(100)
        const partial = timingBreakdown({ blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: 5.5, receive: 0.5 })
        expect(partial.phases.map(p => p.ms)).toEqual([null, null, null, null, 0, 5.5, 0.5])
        expect(partial.segments.map(s => s.id)).toEqual(['wait', 'receive'])
        expect(timingBreakdown(undefined)).toMatchObject({ segments: [], total: 0 })
    })
})

describe('harToCurl', () => {
    const words = (command) => splitShellWords(command).words

    it('turns the fixture’s XHR into a working command', () => {
        const entry = fixture().log.entries[5]
        const command = harToCurl(entry)
        const args = words(command)
        expect(args[0]).toBe('curl')
        expect(args[1]).toBe(entry.request.url)
        expect(args).not.toContain('-X') // POST is implied by the body
        const headers = args.filter((_, i) => args[i - 1] === '-H')
        expect(headers).toEqual(['accept: application/json', 'authorization: Bearer SECRET-BEARER-7f3a9c', 'content-type: application/json', 'origin: https://shop.example.test', 'referer: https://shop.example.test/', 'x-api-key: SECRET-XAPIKEY-HEADER-0f0f'])
        expect(args[args.indexOf('--data-raw') + 1]).toBe(entry.request.postData.text)
    })

    it('drops Host, Content-Length and pseudo-headers, and turns Accept-Encoding into --compressed', () => {
        const entry = fixture().log.entries[0]
        const args = words(harToCurl(entry))
        const headers = args.filter((_, i) => args[i - 1] === '-H').map(h => h.split(':')[0].toLowerCase())
        expect(headers).not.toContain('host')
        expect(headers).not.toContain('accept-encoding')
        expect(args).toContain('--compressed')
        expect(args).not.toContain('--data-raw')
        expect(words(harToCurl(makeEntry({ request: { headers: [{ name: 'Content-Length', value: '3' }, { name: ':method', value: 'GET' }] } })))).toEqual(['curl', 'https://example.test/'])
    })

    it('quotes values with quotes and line breaks safely', () => {
        const text = `{"q":"it's \\"x\\"","s":"$HOME \`id\`"}\nline 2`
        const entry = makeEntry({ request: { method: 'PUT', url: "https://a.test/it's?x=1&y=2", headers: [{ name: 'X-Note', value: "O'Brien; $(rm -rf ~)" }], postData: { mimeType: 'text/plain', text } } })
        const args = words(harToCurl(entry))
        expect(args).toEqual(['curl', "https://a.test/it's?x=1&y=2", '-X', 'PUT', '-H', "X-Note: O'Brien; $(rm -rf ~)", '--data-raw', text])
    })

    it('uses --head for HEAD and keeps empty headers', () => {
        const args = words(harToCurl(makeEntry({ request: { method: 'HEAD', headers: [{ name: 'X-Empty', value: '' }] } })))
        expect(args).toEqual(['curl', 'https://example.test/', '--head', '-H', 'X-Empty;'])
    })

    it('rebuilds bodies from params when the text is missing', () => {
        const form = makeEntry({ request: { method: 'POST', postData: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'a', value: 'x y' }, { name: 'b', value: 'c%20d' }] } } })
        expect(words(harToCurl(form)).slice(-2)).toEqual(['--data-raw', 'a=x%20y&b=c%20d'])
        const multipart = makeEntry({
            request: {
                method: 'POST',
                headers: [{ name: 'Content-Type', value: 'multipart/form-data; boundary=x' }],
                postData: { mimeType: 'multipart/form-data; boundary=x', params: [{ name: 'title', value: 'Hi' }, { name: 'file', fileName: 'a.png', contentType: 'image/png' }] },
            },
        })
        expect(words(harToCurl(multipart))).toEqual(['curl', 'https://example.test/', '-F', 'title=Hi', '-F', 'file=@a.png;type=image/png'])
    })
})
