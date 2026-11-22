import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { CODE_TARGETS, base64Utf8, generateCode, isForbiddenHeader, jsString, pyString, targetLanguage } from './codeGenerator'
import { parseCurl } from './curlParser'

// A JS string literal must evaluate back to the original value
const evalJs = (literal) => new Function(`return ${literal}`)()

const NASTY = [
    '', 'plain', "it's", 'back\\slash', 'line\nbreak\r\n', 'tab\there', 'nul\u0000bell\u0007', 'del\u007f c1\u0085',
    '\u2028\u2029', 'emoji 😀', 'lone \ud800 surrogate', '${not} `template`', '"double"', '日本語',
]

describe('string literals', () => {
    it.each(NASTY)('jsString round-trips %j', (value) => {
        const literal = jsString(value)
        expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true)
        expect(literal).not.toMatch(/[\n\r\u2028\u2029]/)
        expect(evalJs(literal)).toBe(value)
    })

    it('jsString escapes quotes and backslashes explicitly', () => {
        expect(jsString("a'b\\c")).toBe("'a\\'b\\\\c'")
        expect(jsString('x\ny')).toBe("'x\\ny'")
        expect(jsString('\u0001')).toBe("'\\x01'")
    })

    it('pyString escapes like a Python 3 literal', () => {
        expect(pyString("a'b\\c\n")).toBe("'a\\'b\\\\c\\n'")
        expect(pyString('\u0000\u007f')).toBe("'\\x00\\x7f'")
        expect(pyString('日本語 😀')).toBe("'日本語 😀'")
        expect(pyString('\ud800')).toBe("'\\ud800'")
    })

    it('base64Utf8 encodes UTF-8 bytes', () => {
        expect(base64Utf8('ü:pw')).toBe(Buffer.from('ü:pw', 'utf8').toString('base64'))
        expect(base64Utf8('')).toBe('')
    })
})

describe('headers and targets', () => {
    it('identifies forbidden headers (fetch drops them)', () => {
        for (const h of ['Cookie', 'host', 'Origin', 'Content-Length', 'Sec-Fetch-Mode', 'Proxy-Authorization', ' Referer ']) expect(isForbiddenHeader(h), h).toBe(true)
        for (const h of ['Authorization', 'Accept', 'Content-Type', 'X-Secret']) expect(isForbiddenHeader(h), h).toBe(false)
    })
    it('lists targets and languages', () => {
        expect(CODE_TARGETS.map(t => t.value)).toEqual(['fetch', 'python', 'curl'])
        expect(targetLanguage('python')).toBe('python')
        expect(targetLanguage('nope')).toBe('text')
    })
})

describe('curl output', () => {
    it('writes a minimal GET', () => {
        expect(generateCode({ url: 'https://a.test/x' })).toBe("curl 'https://a.test/x'")
    })

    it('writes method, headers, auth, body and options on continuation lines', () => {
        const out = generateCode({
            method: 'PUT', url: 'https://a.test/x', headers: [{ key: 'Accept', value: 'a/b' }, { key: 'X-Empty', value: '' }],
            removeHeaders: ['Expect'], auth: { username: 'u', password: 'p w' }, body: '{"a":1}',
            options: { compressed: true, insecure: true, location: true, maxTime: 5 },
        })
        expect(out).toBe([
            "curl 'https://a.test/x' \\", "  -X PUT \\", "  -H 'Accept: a/b' \\", "  -H 'X-Empty;' \\", "  -H 'Expect:' \\", "  -u 'u:p w' \\",
            `  --data-raw '{"a":1}' \\`, '  --compressed \\', '  --insecure \\', '  --location \\', '  --max-time 5',
        ].join('\n'))
    })

    it('omits -X for GET and for POST with a body, uses --head for HEAD', () => {
        expect(generateCode({ method: 'POST', url: 'https://a.test', body: 'x' })).not.toMatch(/-X/)
        expect(generateCode({ method: 'GET', url: 'https://a.test' })).not.toMatch(/-X/)
        expect(generateCode({ method: 'POST', url: 'https://a.test' })).toMatch(/-X POST/)
        expect(generateCode({ method: 'head', url: 'https://a.test', body: 'ignored' })).toBe("curl 'https://a.test' \\\n  --head")
    })

    it('writes multipart forms, choosing -F or --form-string safely', () => {
        const out = generateCode({
            url: 'https://a.test', form: [
                { key: 'a', value: 'plain' }, { key: 'b', value: 'x;y', contentType: 'text/plain' }, { key: 'c', value: '@literal' },
                { key: 'd', file: 'f.png', contentType: 'image/png', filename: 'p.png' },
            ],
        })
        expect(out).toContain("-F 'a=plain'")
        expect(out).toContain(`-F 'b="x;y";type=text/plain'`)
        expect(out).toContain("--form-string 'c=@literal'")
        expect(out).toContain("-F 'd=@f.png;type=image/png;filename=p.png'")
    })

    it('survives a round trip through parseCurl, including awkward characters', () => {
        const request = {
            method: 'PATCH', url: "https://a.test/it's?x=1&y=$HOME", headers: [{ key: 'X-Q', value: `it's "quoted" $VAR \`cmd\`` }],
            auth: { username: 'ada', password: "p'w" }, body: `{"s":"line\nbreak 'q' \\ ü"}`, options: { compressed: true },
        }
        const parsed = parseCurl(generateCode(request, 'curl'))
        expect(parsed).toMatchObject({ method: 'PATCH', url: request.url, headers: request.headers, auth: request.auth, body: request.body })
        expect(parsed.options.compressed).toBe(true)
        expect(parsed.warnings.filter(w => !/Shell expressions/.test(w))).toEqual([])
    })
})

describe('fetch output', () => {
    it('writes a JSON POST that reads JSON back', () => {
        const out = generateCode({ method: 'POST', url: 'https://a.test/x', headers: [{ key: 'Content-Type', value: 'application/json' }], body: '{"a":1}' }, 'fetch')
        expect(out).toBe([
            "fetch('https://a.test/x', {", "  method: 'POST',", '  headers: {', "    'Content-Type': 'application/json'", '  },', `  body: '{"a":1}'`, '})',
            '  .then((response) => response.json())', '  .then((data) => console.log(data))', '  .catch((error) => console.error(error));',
        ].join('\n'))
    })

    it('adds the implicit form Content-Type and Basic auth via btoa', () => {
        const out = generateCode({ method: 'POST', url: 'https://a.test', body: 'a=1', implicitContentType: 'application/x-www-form-urlencoded', auth: { username: 'u', password: 'p' } }, 'fetch')
        expect(out).toContain("'Content-Type': 'application/x-www-form-urlencoded'")
        expect(out).toContain("'Authorization': 'Basic ' + btoa('u:p')")
        expect(out).toContain('response.text()')
    })

    it('pre-encodes non-ASCII credentials instead of using btoa', () => {
        const out = generateCode({ url: 'https://a.test', auth: { username: 'ü', password: 'p' } }, 'fetch')
        expect(out).toContain(`'Authorization': 'Basic ${Buffer.from('ü:p').toString('base64')}'`)
        expect(out).not.toContain('btoa')
    })

    it('notes forbidden headers, insecure and body-with-GET', () => {
        const out = generateCode({ method: 'GET', url: 'https://a.test', headers: [{ key: 'Cookie', value: 'a=1' }], body: 'x', options: { insecure: true } }, 'fetch')
        expect(out).toMatch(/\/\/ Note: Browsers don't let pages set Cookie; fetch\(\) drops it there/)
        expect(out).toMatch(/\/\/ Note: fetch\(\) can't send a body with GET/)
        expect(out).toMatch(/can't skip TLS certificate checks/)
        expect(out).not.toContain('body:')
    })

    it('uses FormData for multipart and drops the hand-written multipart header', () => {
        const out = generateCode({
            method: 'POST', url: 'https://a.test', headers: [{ key: 'Content-Type', value: 'multipart/form-data; boundary=x' }],
            form: [{ key: 'a', value: "it's" }, { key: 'f', file: 'C:\\dir\\r.pdf', contentType: 'application/pdf' }],
        }, 'fetch')
        expect(out).toContain('const formData = new FormData();')
        expect(out).toContain("formData.append('a', 'it\\'s');")
        expect(out).toContain("new File([/* contents of C:\\dir\\r.pdf */], 'r.pdf', { type: 'application/pdf' })")
        expect(out).toContain('body: formData')
        expect(out).not.toMatch(/Content-Type'/)
        expect(out).toMatch(/boundary/)
    })

    it('uses a template literal for multi-line bodies and escapes it', () => {
        const out = generateCode({ method: 'POST', url: 'https://a.test', body: 'a`b${c}\nd\\' }, 'fetch')
        expect(out).toContain('body: `a\\`b\\${c}\nd\\\\`')
    })

    it('uses an array of pairs for repeated headers, and a timeout signal', () => {
        const out = generateCode({ url: 'https://a.test', headers: [{ key: 'X-A', value: '1' }, { key: 'x-a', value: '2' }], options: { maxTime: 2.5 } }, 'fetch')
        expect(out).toContain("['X-A', '1'],")
        expect(out).toContain('signal: AbortSignal.timeout(2500)')
    })

    it('reports status for HEAD', () => {
        expect(generateCode({ method: 'HEAD', url: 'https://a.test' }, 'fetch')).toContain('.then((response) => response.status)')
    })
})

describe('python output', () => {
    it('writes a GET with headers', () => {
        expect(generateCode({ url: 'https://a.test', headers: [{ key: 'Accept', value: 'x' }] }, 'python')).toBe([
            'import requests', '', "url = 'https://a.test'", '', 'headers = {', "    'Accept': 'x',", '}', '',
            'response = requests.get(url, headers=headers)', 'print(response.status_code)', 'print(response.text)',
        ].join('\n'))
    })

    it('writes data, auth, verify and timeout; encodes non-ASCII bodies', () => {
        const out = generateCode({ method: 'POST', url: 'https://a.test', body: 'ü', auth: { username: 'u', password: 'p' }, options: { insecure: true, maxTime: 3 } }, 'python')
        expect(out).toContain("data = 'ü'")
        expect(out).toContain("response = requests.post(url, data=data.encode('utf-8'), auth=('u', 'p'), verify=False, timeout=3)")
        expect(generateCode({ method: 'POST', url: 'https://a.test', body: 'abc' }, 'python')).toContain('requests.post(url, data=data)')
    })

    it('splits multi-line bodies into adjacent literals', () => {
        const out = generateCode({ method: 'POST', url: 'https://a.test', body: 'a\nb\n' }, 'python')
        expect(out).toContain("data = (\n    'a\\n'\n    'b\\n'\n)")
    })

    it('uses requests.request for unusual methods and files= for forms', () => {
        const out = generateCode({ method: 'PURGE', url: 'https://a.test', form: [{ key: 'a', value: 'v' }, { key: 'f', file: 'dir/x.txt', contentType: 'text/plain' }] }, 'python')
        expect(out).toContain("    ('a', (None, 'v')),")
        expect(out).toContain("    ('f', ('x.txt', open('dir/x.txt', 'rb'), 'text/plain')),")
        expect(out).toContain("requests.request('PURGE', url, files=files)")
    })

    it('combines repeated headers and says so', () => {
        const out = generateCode({ url: 'https://a.test', headers: [{ key: 'Cookie', value: 'a=1' }, { key: 'cookie', value: 'b=2' }, { key: 'X', value: '1' }, { key: 'x', value: '2' }] }, 'python')
        expect(out).toContain("'Cookie': 'a=1; b=2',")
        expect(out).toContain("'X': '1, 2',")
        expect(out).toMatch(/^# Note: Repeated headers were combined/)
    })

    it('does not print a body for HEAD', () => {
        const out = generateCode({ method: 'HEAD', url: 'https://a.test' }, 'python')
        expect(out).toContain('requests.head(url)')
        expect(out).not.toContain('response.text')
    })
})

describe('input handling', () => {
    it('ignores headers without a name and tolerates missing input', () => {
        expect(generateCode({ url: 'https://a.test', headers: [{ key: ' ', value: 'x' }, null] })).toBe("curl 'https://a.test'")
        expect(generateCode(undefined)).toBe("curl ''")
    })
    it('falls back to curl for an unknown target', () => {
        expect(generateCode({ url: 'https://a.test' }, 'ruby')).toBe("curl 'https://a.test'")
    })
})
