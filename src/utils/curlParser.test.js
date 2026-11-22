import { describe, expect, it } from 'vitest'
import { CurlParseError, curlUrlEncode, parseCurl } from './curlParser'

describe('basics', () => {
    it('parses a simple GET', () => {
        const r = parseCurl('curl https://api.example.com/items')
        expect(r).toMatchObject({ method: 'GET', url: 'https://api.example.com/items', headers: [], body: '', form: [], auth: null, implicitContentType: null, dialect: 'posix', warnings: [] })
        expect(r.options).toEqual({ compressed: false, insecure: false, location: false, maxTime: null })
    })

    it('strips a pasted prompt and accepts a path or .exe', () => {
        expect(parseCurl('$ curl https://a.test/').url).toBe('https://a.test/')
        expect(parseCurl('% curl https://a.test/').url).toBe('https://a.test/')
        expect(parseCurl('/usr/bin/curl https://a.test/').url).toBe('https://a.test/')
        expect(parseCurl('curl.exe https://a.test/').url).toBe('https://a.test/')
    })

    it('collects headers in order, from single and double quotes', () => {
        const r = parseCurl(`curl 'https://a.test/x' -H 'Accept: application/json' -H "X-Trace:  abc " --header 'Accept-Language: en'`)
        expect(r.headers).toEqual([
            { key: 'Accept', value: 'application/json' },
            { key: 'X-Trace', value: 'abc' },
            { key: 'Accept-Language', value: 'en' },
        ])
    })

    it('handles a header whose value contains a colon', () => {
        expect(parseCurl(`curl -H 'Referer: https://x.test:8080/p' https://a.test`).headers).toEqual([{ key: 'Referer', value: 'https://x.test:8080/p' }])
    })

    it('removes default headers with "Name:" and sends empty ones with "Name;"', () => {
        const r = parseCurl(`curl -H 'Accept:' -H 'X-Empty;' https://a.test`)
        expect(r.removeHeaders).toEqual(['Accept'])
        expect(r.headers).toEqual([{ key: 'X-Empty', value: '' }])
    })

    it('warns about malformed headers', () => {
        const r = parseCurl(`curl -H 'nocolon' https://a.test`)
        expect(r.headers).toEqual([])
        expect(r.warnings[0]).toMatch(/needs a colon/)
    })
})

describe('methods and bodies', () => {
    it('defaults to POST when there is data, honours -X', () => {
        expect(parseCurl(`curl -d 'a=1' https://a.test`).method).toBe('POST')
        expect(parseCurl(`curl -X PUT -d 'a=1' https://a.test`).method).toBe('PUT')
        expect(parseCurl(`curl -XDELETE https://a.test/1`).method).toBe('DELETE')
        expect(parseCurl(`curl --request patch https://a.test/1`).method).toBe('PATCH')
        expect(parseCurl(`curl -X PURGE https://a.test/1`).method).toBe('PURGE')
        expect(parseCurl(`curl -I https://a.test`).method).toBe('HEAD')
    })

    it('sets the implicit form content type for -d without a Content-Type header', () => {
        const r = parseCurl(`curl -d 'a=1' -d 'b=2' https://a.test`)
        expect(r.body).toBe('a=1&b=2')
        expect(r.implicitContentType).toBe('application/x-www-form-urlencoded')
        const withHeader = parseCurl(`curl -H 'Content-Type: application/json' -d '{"a":1}' https://a.test`)
        expect(withHeader.implicitContentType).toBeNull()
        expect(withHeader.body).toBe('{"a":1}')
    })

    it('keeps --data-raw literally, including @ and backslashes', () => {
        expect(parseCurl(`curl --data-raw '@not-a-file' https://a.test`).body).toBe('@not-a-file')
        expect(parseCurl(`curl --data-raw '{"k":"a\\nb"}' https://a.test`).body).toBe('{"k":"a\\nb"}')
    })

    it('skips @file bodies with a warning', () => {
        const r = parseCurl(`curl -d @payload.json https://a.test`)
        expect(r.body).toBe('')
        expect(r.warnings[0]).toMatch(/files can't be read here/)
    })

    it('encodes --data-urlencode like curl (RFC 3986 unreserved characters only)', () => {
        const r = parseCurl(`curl --data-urlencode 'q=hello world&x=1' --data-urlencode 'plain text' --data-urlencode '=a b' https://a.test`)
        expect(r.body).toBe('q=hello%20world%26x%3D1&plain%20text&a%20b')
        expect(curlUrlEncode("a!b'c(d)e*f~g-h_i.j")).toBe('a%21b%27c%28d%29e%2Af~g-h_i.j')
    })

    it('--json sets JSON headers (unless given) and concatenates pieces', () => {
        const r = parseCurl(`curl --json '{"a":' --json '1}' https://a.test`)
        expect(r.body).toBe('{"a":1}')
        expect(r.method).toBe('POST')
        expect(r.headers).toEqual([{ key: 'Content-Type', value: 'application/json' }, { key: 'Accept', value: 'application/json' }])
        expect(r.implicitContentType).toBeNull()
        const custom = parseCurl(`curl -H 'accept: text/plain' --json '{}' https://a.test`)
        expect(custom.headers.map(h => h.key)).toEqual(['accept', 'Content-Type'])
    })

    it('-G moves the data into the query string', () => {
        expect(parseCurl(`curl -G -d 'a=1' -d 'b=2' https://a.test/s`)).toMatchObject({ method: 'GET', url: 'https://a.test/s?a=1&b=2', body: '' })
        expect(parseCurl(`curl -G -d 'b=2' 'https://a.test/s?a=1'`).url).toBe('https://a.test/s?a=1&b=2')
    })

    it('-I with a body is dropped with a warning', () => {
        const r = parseCurl(`curl -I -d x=1 https://a.test`)
        expect(r.body).toBe('')
        expect(r.warnings.join(' ')).toMatch(/HEAD/)
    })
})

describe('multipart forms', () => {
    it('parses -F text, file and parameter fields', () => {
        const r = parseCurl(`curl -F 'name=Ada' -F 'doc=@report.pdf;type=application/pdf;filename=r.pdf' -F 'note="a;b";type=text/plain' https://a.test/up`)
        expect(r.method).toBe('POST')
        expect(r.form).toEqual([
            { key: 'name', value: 'Ada' },
            { key: 'doc', file: 'report.pdf', contentType: 'application/pdf', filename: 'r.pdf' },
            { key: 'note', value: 'a;b', contentType: 'text/plain' },
        ])
    })

    it('treats --form-string values literally', () => {
        expect(parseCurl(`curl --form-string 'a=@x;type=y' https://a.test`).form).toEqual([{ key: 'a', value: '@x;type=y' }])
    })

    it('rejects combining -F with -d and warns about <file fields', () => {
        const r = parseCurl(`curl -F a=1 -d b=2 https://a.test`)
        expect(r.body).toBe('')
        expect(r.warnings[0]).toMatch(/refuses to combine -F/)
        expect(parseCurl(`curl -F 'a=<f.txt' https://a.test`).form).toEqual([])
    })
})

describe('auth, cookies and misc options', () => {
    it('parses -u with and without a password', () => {
        expect(parseCurl(`curl -u 'ada:p:w' https://a.test`).auth).toEqual({ username: 'ada', password: 'p:w' })
        const r = parseCurl(`curl -u ada https://a.test`)
        expect(r.auth).toEqual({ username: 'ada', password: '' })
        expect(r.warnings[0]).toMatch(/no password/)
    })

    it('maps -A, -e, -b, --oauth2-bearer and -r to headers', () => {
        const r = parseCurl(`curl -A 'Mozilla/5.0' -e 'https://ref.test;auto' -b 'a=1' -b 'b=2' --oauth2-bearer TOK -r 0-99 https://a.test`)
        expect(r.headers).toEqual([
            { key: 'User-Agent', value: 'Mozilla/5.0' },
            { key: 'Referer', value: 'https://ref.test' },
            { key: 'Cookie', value: 'a=1; b=2' },
            { key: 'Authorization', value: 'Bearer TOK' },
            { key: 'Range', value: 'bytes=0-99' },
        ])
    })

    it('ignores a cookie file with a warning', () => {
        const r = parseCurl(`curl -b cookies.txt https://a.test`)
        expect(r.headers).toEqual([])
        expect(r.warnings[0]).toMatch(/reads cookies from a file/)
    })

    it('records --compressed, -k, -L and --max-time, including bundled short flags', () => {
        const r = parseCurl(`curl -skL --compressed --max-time 2.5 https://a.test`)
        expect(r.options).toEqual({ compressed: true, insecure: true, location: true, maxTime: 2.5 })
        expect(r.warnings).toEqual([])
    })

    it('supports --opt=value and --no-<flag>', () => {
        const r = parseCurl(`curl --request=POST --header='X-A: 1' --url=https://a.test/p --no-compressed --compressed --no-insecure`)
        expect(r).toMatchObject({ method: 'POST', url: 'https://a.test/p', headers: [{ key: 'X-A', value: '1' }] })
        expect(r.options.compressed).toBe(true)
    })

    it('silently ignores options that do not change the request', () => {
        const r = parseCurl(`curl -sS -v --fail -o out.json --retry 3 --connect-timeout 5 https://a.test`)
        expect(r.warnings).toEqual([])
    })

    it('warns about options that cannot be reproduced and unknown ones', () => {
        const r = parseCurl(`curl --proxy http://p:8080 --digest --cert c.pem --frobnicate https://a.test`)
        expect(r.warnings.join('\n')).toMatch(/goes through a proxy/)
        expect(r.warnings.join('\n')).toMatch(/Digest authentication/)
        expect(r.warnings.join('\n')).toMatch(/client certificate/)
        expect(r.warnings.join('\n')).toMatch(/unknown option: --frobnicate/)
    })
})

describe('real-world commands', () => {
    it('parses a Chrome "Copy as cURL (bash)" request with $\'…\' strings', () => {
        const cmd = `curl 'https://api.example.com/v1/search?q=a%20b' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'authorization: Bearer abc.def.ghi' \\
  -H 'content-type: application/json' \\
  -b 'sid=xyz' \\
  --data-raw $'{"query":"it\\'s","n":1}' \\
  --compressed`
        const r = parseCurl(cmd)
        expect(r.method).toBe('POST')
        expect(r.url).toBe('https://api.example.com/v1/search?q=a%20b')
        expect(r.body).toBe(`{"query":"it's","n":1}`)
        expect(r.headers.map(h => h.key)).toEqual(['accept', 'authorization', 'content-type', 'Cookie'])
        expect(r.options.compressed).toBe(true)
        expect(r.implicitContentType).toBeNull()
        expect(r.warnings).toEqual([])
    })

    it('handles single quotes inside single-quoted bodies written as \'\\\'\'', () => {
        const r = parseCurl(`curl -d 'say '\\''hi'\\''' https://a.test`)
        expect(r.body).toBe("say 'hi'")
    })

    it('parses Windows cmd syntax with ^ escapes', () => {
        // exactly what Chrome's "Copy as cURL (cmd)" produces for a JSON body {"a":1}
        const cmd = [
            'curl ^"https://a.test/x^" ^',
            '  -H ^"Accept: application/json^" ^',
            '  --data-raw ^"^{^\\^"a^\\^":1^}^"',
        ].join('\r\n')
        const r = parseCurl(cmd)
        expect(r.dialect).toBe('cmd')
        expect(r.url).toBe('https://a.test/x')
        expect(r.headers).toEqual([{ key: 'Accept', value: 'application/json' }])
        expect(r.body).toBe('{"a":1}')
    })

    it('adds http:// to scheme-less URLs with a warning', () => {
        const r = parseCurl('curl localhost:3000/health')
        expect(r.url).toBe('http://localhost:3000/health')
        expect(r.warnings[0]).toMatch(/no scheme/)
    })

    it('uses the first URL and --url, and treats "--" as the end of options', () => {
        const r = parseCurl('curl https://a.test/1 https://a.test/2')
        expect(r.url).toBe('https://a.test/1')
        expect(r.warnings[0]).toMatch(/1 more was ignored/)
        expect(parseCurl('curl -- -weird-host.test').url).toBe('http://-weird-host.test')
    })

    it('converts only the first of several commands, and stops at pipes and &&', () => {
        const two = parseCurl('curl https://a.test/1 curl https://a.test/2')
        expect(two.url).toBe('https://a.test/1')
        expect(two.warnings.join(' ')).toMatch(/first of several curl commands/)
        const piped = parseCurl(`curl -s https://a.test/1 | jq '.a'`)
        expect(piped.url).toBe('https://a.test/1')
        expect(piped.warnings.join(' ')).toMatch(/after “\|” was ignored/)
        expect(parseCurl('curl https://a.test/1 --next https://a.test/2').warnings.join(' ')).toMatch(/before --next/)
    })

    it('keeps shell expansions literal and reports them', () => {
        const r = parseCurl(`curl -H "Authorization: Bearer $TOKEN" https://a.test/$(date +%s)`)
        expect(r.headers[0].value).toBe('Bearer $TOKEN')
        expect(r.url).toBe('https://a.test/$(date +%s)')
        expect(r.warnings.join(' ')).toMatch(/Shell expressions were kept as literal text/)
    })
})

describe('errors', () => {
    it('rejects empty input', () => {
        expect(() => parseCurl('')).toThrow(CurlParseError)
        expect(() => parseCurl('   ')).toThrow('Paste a cURL command to convert.')
        expect(() => parseCurl(null)).toThrow(/Paste a cURL command/)
        expect(() => parseCurl('$')).toThrow(/Paste a cURL command/)
    })
    it('rejects other commands', () => {
        expect(() => parseCurl('wget https://a.test')).toThrow('This doesn\'t look like a cURL command: it should start with “curl”, not “wget”.')
    })
    it('rejects a missing URL', () => {
        expect(() => parseCurl('curl -X POST')).toThrow('No URL found in the cURL command.')
    })
    it('reports unclosed quotes', () => {
        expect(() => parseCurl(`curl -H 'Accept: x https://a.test`)).toThrow(/Check that every quote is closed/)
    })
    it('warns about an option missing its value', () => {
        const r = parseCurl('curl https://a.test -H')
        expect(r.warnings[0]).toBe('-H is missing its value.')
    })
})
