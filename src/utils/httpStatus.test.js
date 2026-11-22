import { describe, expect, it } from 'vitest'
import { STATUS_CATEGORIES, STATUS_CODES, getStatusCategory, getStatusInfo, getStatusText, specUrl } from './httpStatus'

describe('status table', () => {
    it('has unique, sorted, well-formed entries', () => {
        const codes = STATUS_CODES.map(s => s.code)
        expect(new Set(codes).size).toBe(codes.length)
        expect(codes).toEqual([...codes].sort((a, b) => a - b))
        for (const s of STATUS_CODES) {
            expect(s.code).toBeGreaterThanOrEqual(100)
            expect(s.code).toBeLessThan(600)
            expect(s.text.length).toBeGreaterThan(0)
            expect(s.desc.length).toBeGreaterThan(10)
            expect(s.spec).toMatch(/^RFC \d+$/)
            expect(s.cat).toBe(`${String(s.code)[0]}xx`)
            expect(STATUS_CATEGORIES.map(c => c.id)).toContain(s.cat)
        }
    })

    it('contains the common codes with their RFC 9110 names', () => {
        const expected = {
            100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content',
            301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
            400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable',
            408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 411: 'Length Required', 412: 'Precondition Failed', 413: 'Content Too Large',
            414: 'URI Too Long', 415: 'Unsupported Media Type', 416: 'Range Not Satisfiable', 417: 'Expectation Failed',
            421: 'Misdirected Request', 422: 'Unprocessable Content', 426: 'Upgrade Required', 428: 'Precondition Required', 429: 'Too Many Requests',
            431: 'Request Header Fields Too Large', 451: 'Unavailable For Legal Reasons',
            500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
            505: 'HTTP Version Not Supported', 511: 'Network Authentication Required',
        }
        for (const [code, text] of Object.entries(expected)) expect(getStatusText(code), code).toBe(text)
        expect(getStatusText(418)).toMatch(/teapot/i)
    })
})

describe('lookups', () => {
    it('getStatusInfo accepts numbers and numeric strings', () => {
        expect(getStatusInfo(404)).toMatchObject({ code: 404, text: 'Not Found', cat: '4xx' })
        expect(getStatusInfo('404')).toBe(getStatusInfo(404))
        expect(getStatusInfo(299)).toBeNull()
        expect(getStatusInfo('abc')).toBeNull()
        expect(getStatusInfo(undefined)).toBeNull()
    })

    it('getStatusText returns an empty string for unknown codes', () => {
        expect(getStatusText(299)).toBe('')
        expect(getStatusText(null)).toBe('')
    })

    it('getStatusCategory covers 1xx-5xx only, even for unregistered codes', () => {
        expect(getStatusCategory(100).label).toBe('Informational')
        expect(getStatusCategory(299).label).toBe('Success')
        expect(getStatusCategory('302').label).toBe('Redirection')
        expect(getStatusCategory(499).label).toBe('Client error')
        expect(getStatusCategory(599).label).toBe('Server error')
        expect(getStatusCategory(99)).toBeNull()
        expect(getStatusCategory(600)).toBeNull()
        expect(getStatusCategory('x')).toBeNull()
    })

    it('specUrl links RFC numbers only', () => {
        expect(specUrl('RFC 9110')).toBe('https://www.rfc-editor.org/rfc/rfc9110.html')
        expect(specUrl('RFC 2518')).toBe('https://www.rfc-editor.org/rfc/rfc2518.html')
        expect(specUrl('HTML Living Standard')).toBeNull()
        expect(specUrl('')).toBeNull()
        expect(specUrl(undefined)).toBeNull()
        expect(specUrl('RFC 9110 and more')).toBeNull()
    })
})
