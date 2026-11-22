import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
    decodeUtf8, describeCloseCode, displayUrl, formatClock, formatDelay, hexDump, isJsonContainer, isLocalHost,
    isMixedContent, parseSubprotocols, preflightHeaders, prettyJson, previewText, toBase64, toHex, toHttpUrl,
    toWebSocketUrl, urlForStorage, utf8Length,
} from './realtime'

describe('isLocalHost', () => {
    it.each(['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]'])('treats %s as this machine', (host) => {
        expect(isLocalHost(host)).toBe(true)
    })
    it.each(['example.com', 'localhost.com', '128.0.0.1', '127.0.0', '[::2]', ''])('does not treat %j as this machine', (host) => {
        expect(isLocalHost(host)).toBe(false)
    })
})

describe('isMixedContent', () => {
    it('blocks ws:// and http:// from an https:// page', () => {
        expect(isMixedContent('https:', 'ws://example.com/socket')).toBe(true)
        expect(isMixedContent('https:', 'http://example.com/events')).toBe(true)
    })
    it('allows secure targets, loopback hosts, and anything from an http:// page', () => {
        expect(isMixedContent('https:', 'wss://example.com/socket')).toBe(false)
        expect(isMixedContent('https:', 'ws://localhost:8080/')).toBe(false)
        expect(isMixedContent('https:', 'ws://127.0.0.1:8080/')).toBe(false)
        expect(isMixedContent('http:', 'ws://example.com/')).toBe(false)
        expect(isMixedContent('https:', 'not a url')).toBe(false)
    })
})

describe('toWebSocketUrl', () => {
    it('accepts ws:// and wss:// URLs as they are', () => {
        expect(toWebSocketUrl('  wss://example.com/socket?room=1  ')).toEqual({ url: 'wss://example.com/socket?room=1', converted: false })
        expect(toWebSocketUrl('ws://localhost:8080')).toEqual({ url: 'ws://localhost:8080/', converted: false })
    })

    it('converts http:// and https:// like the WebSocket constructor', () => {
        expect(toWebSocketUrl('https://example.com/socket')).toEqual({ url: 'wss://example.com/socket', converted: true })
        expect(toWebSocketUrl('http://localhost:3000/ws')).toEqual({ url: 'ws://localhost:3000/ws', converted: true })
        expect(toWebSocketUrl('HTTPS://Example.com:8443/a')).toEqual({ url: 'wss://example.com:8443/a', converted: true })
        expect(toWebSocketUrl('https://example.com:443/a').url).toBe('wss://example.com/a')
    })

    it('suggests a scheme for a bare host: wss://, or ws:// for this machine', () => {
        expect(toWebSocketUrl('example.com/socket')).toMatchObject({ suggestion: 'wss://example.com/socket' })
        expect(toWebSocketUrl('127.0.0.1:9000')).toMatchObject({ suggestion: 'ws://127.0.0.1:9000' })
        const localhost = toWebSocketUrl('localhost:8080/socket')
        expect(localhost.error).toContain('“localhost:” was read as the scheme')
        expect(localhost.suggestion).toBe('ws://localhost:8080/socket')
    })

    it('refuses other schemes, fragments and non-URLs', () => {
        expect(toWebSocketUrl('ftp://example.com')).toEqual({ error: expect.stringContaining('not ftp://') })
        expect(toWebSocketUrl('wss://example.com/socket#top').error).toContain('#fragment')
        expect(toWebSocketUrl('wss://example.com/#').error).toContain('#fragment')
        expect(toWebSocketUrl('not a url').error).toContain('isn’t a valid absolute URL')
        expect(toWebSocketUrl('').error).toContain('Enter the URL')
    })
})

describe('toHttpUrl', () => {
    it('accepts http(s) URLs, fragments included', () => {
        expect(toHttpUrl('https://example.com/events#x')).toEqual({ url: 'https://example.com/events#x' })
        expect(toHttpUrl('http://localhost:3000/sse')).toEqual({ url: 'http://localhost:3000/sse' })
    })

    it('turns WebSocket URLs and bare hosts into suggestions', () => {
        expect(toHttpUrl('wss://example.com/events')).toMatchObject({ suggestion: 'https://example.com/events' })
        expect(toHttpUrl('ws://localhost:3000/events')).toMatchObject({ suggestion: 'http://localhost:3000/events' })
        expect(toHttpUrl('example.com/events')).toMatchObject({ suggestion: 'https://example.com/events' })
        expect(toHttpUrl('localhost:3000/sse')).toMatchObject({ suggestion: 'http://localhost:3000/sse' })
    })

    it('refuses other schemes and non-URLs', () => {
        expect(toHttpUrl('ftp://example.com/x').error).toContain('not ftp://')
        expect(toHttpUrl('events please').error).toContain('isn’t a valid absolute URL')
        expect(toHttpUrl(' ').error).toContain('Enter the URL')
    })
})

describe('urlForStorage', () => {
    it('drops passwords and secret-looking query values, keeping the rest', () => {
        expect(urlForStorage('wss://bob:hunter2@example.com/s?token=abc&room=1')).toBe('wss://bob@example.com/s?token=&room=1')
        expect(urlForStorage('https://example.com/events?api_key=k&since=5#frag')).toBe('https://example.com/events?api_key=&since=5#frag')
    })

    it('keeps {{variable}} references, which hold no secret', () => {
        expect(urlForStorage('{{ws_base}}/s?token={{token}}&room=1')).toBe('{{ws_base}}/s?token={{token}}&room=1')
    })

    it('keeps values under names that do not look secret (the documented caveat)', () => {
        expect(urlForStorage('wss://example.com/s?t=abc')).toBe('wss://example.com/s?t=abc')
    })
})

describe('displayUrl', () => {
    it('shows scheme, host and path, without credentials or the query', () => {
        expect(displayUrl('wss://user:pw@example.com:8443/socket?token=abc')).toBe('wss://example.com:8443/socket?…')
        expect(displayUrl('https://example.com/events')).toBe('https://example.com/events')
        expect(displayUrl('nonsense')).toBe('nonsense')
    })
})

describe('parseSubprotocols', () => {
    it('splits on commas and trims', () => {
        expect(parseSubprotocols('')).toEqual({ list: [] })
        expect(parseSubprotocols('chat.v2, json')).toEqual({ list: ['chat.v2', 'json'] })
        expect(parseSubprotocols(' graphql-transport-ws ,, ')).toEqual({ list: ['graphql-transport-ws'] })
    })

    it('accepts a base64url token such as a JWT', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc_-DEF'
        expect(parseSubprotocols(`access_token, ${jwt}`)).toEqual({ list: ['access_token', jwt] })
    })

    it.each(['Bearer abc', 'a/b', 'abc=', 'naïve', '"quoted"'])('refuses %j, which is not a token', (value) => {
        const result = parseSubprotocols(value)
        expect(result.list).toEqual([])
        expect(result.error).toContain(`“${value}” can’t be a subprotocol`)
    })

    it('refuses duplicates, comparing case-sensitively', () => {
        expect(parseSubprotocols('chat, chat').error).toContain('“chat” is listed twice')
        expect(parseSubprotocols('Chat, chat')).toEqual({ list: ['Chat', 'chat'] })
    })
})

describe('describeCloseCode', () => {
    it('names standard, registered and application codes', () => {
        expect(describeCloseCode(1000).name).toBe('Normal closure')
        expect(describeCloseCode(1006).name).toBe('Abnormal closure')
        expect(describeCloseCode(1008).name).toBe('Policy violation')
        expect(describeCloseCode(3000).name).toBe('Unauthorized')
        expect(describeCloseCode(3500).name).toBe('Registered code')
        expect(describeCloseCode(4001).name).toBe('Application code')
        expect(describeCloseCode(1004)).toEqual({ name: 'Unknown code', description: '' })
    })
})

describe('formatting', () => {
    it('formatClock: local time with milliseconds', () => {
        expect(formatClock(new Date(2024, 0, 2, 9, 5, 7, 42).getTime())).toBe('09:05:07.042')
        expect(formatClock(new Date(2024, 0, 2, 23, 59, 59, 999).getTime())).toBe('23:59:59.999')
    })

    it('formatDelay', () => {
        expect(formatDelay(250)).toBe('250 ms')
        expect(formatDelay(3000)).toBe('3 s')
        expect(formatDelay(1500)).toBe('1.5 s')
        expect(formatDelay(120_000)).toBe('2 min')
        expect(formatDelay(125_000)).toBe('2 min 5 s')
    })

    it.each(['', 'abc', 'é', '€', '😀', 'a😀é€\n', '\ud800', '\udc00x', 'x\ud83d'])('utf8Length(%j) matches TextEncoder', (text) => {
        expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length)
    })

    it('previewText collapses whitespace and shortens to the limit', () => {
        expect(previewText('  a\n  b\tc  ')).toBe('a b c')
        const long = previewText('x'.repeat(500), 20)
        expect(long).toBe(`${'x'.repeat(19)}…`)
        expect(previewText('')).toBe('')
    })
})

describe('binary', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x41])

    it('toHex', () => {
        expect(toHex(bytes)).toBe('de ad be ef 00 41')
        expect(toHex(bytes, 2)).toBe('de ad …')
        expect(toHex(new Uint8Array())).toBe('')
    })

    it('hexDump uses the hexdump -C layout', () => {
        expect(hexDump(bytes)).toBe(`00000000  de ad be ef 00 41${' '.repeat(33)}|.....A|`)
        const letters = new TextEncoder().encode('ABCDEFGHIJKLMNOPQ')
        expect(hexDump(letters)).toBe(
            '00000000  41 42 43 44 45 46 47 48  49 4a 4b 4c 4d 4e 4f 50  |ABCDEFGHIJKLMNOP|\n'
            + `00000010  51${' '.repeat(48)}|Q|`,
        )
        expect(hexDump(letters, 16).split('\n')).toHaveLength(1)
        expect(hexDump(new Uint8Array())).toBe('')
    })

    it('toBase64 matches Node, including inputs longer than one chunk', () => {
        const big = Uint8Array.from({ length: 70_001 }, (_, i) => (i * 31 + 7) % 256)
        expect(toBase64(bytes)).toBe('3q2+7wBB')
        expect(toBase64(big)).toBe(Buffer.from(big).toString('base64'))
        expect(toBase64(new Uint8Array())).toBe('')
    })

    it('decodeUtf8 returns text only for valid UTF-8, keeping a BOM', () => {
        expect(decodeUtf8(new TextEncoder().encode('héllo'))).toBe('héllo')
        expect(decodeUtf8(bytes)).toBeNull()
        expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe(`${String.fromCharCode(0xfeff)}a`)
    })
})

describe('JSON', () => {
    it('isJsonContainer accepts objects and arrays only', () => {
        expect(isJsonContainer('{"a":1}')).toBe(true)
        expect(isJsonContainer(' \n[1, 2]')).toBe(true)
        for (const text of ['42', '"x"', 'true', '{bad', '', '[1,]']) expect(isJsonContainer(text)).toBe(false)
        expect(isJsonContainer(null)).toBe(false)
    })

    it('prettyJson only changes whitespace: big numbers and escapes stay as sent', () => {
        const text = '{"id":12345678901234567890,"s":"\\u00e9 [x], {y}: z","a":[],"o":{ },"n":[1,{"b":null}]}'
        expect(prettyJson(text)).toBe([
            '{',
            '  "id": 12345678901234567890,',
            '  "s": "\\u00e9 [x], {y}: z",',
            '  "a": [],',
            '  "o": {},',
            '  "n": [',
            '    1,',
            '    {',
            '      "b": null',
            '    }',
            '  ]',
            '}',
        ].join('\n'))
        expect(prettyJson('{ "a" : [ "q\\"uote" ] }')).toBe('{\n  "a": [\n    "q\\"uote"\n  ]\n}')
    })
})

describe('preflightHeaders', () => {
    it('lists the headers that need a CORS preflight, once each', () => {
        expect(preflightHeaders([
            { key: 'Authorization', value: 'Bearer x' },
            { key: 'Accept', value: 'text/event-stream' },
            { key: 'Last-Event-ID', value: '5' },
            { key: 'Cookie', value: 'a=b' },
            { key: 'Content-Type', value: 'text/plain;charset=UTF-8' },
            { key: 'content-type', value: 'application/json' },
            { key: 'authorization', value: 'again' },
            { key: ' ', value: 'empty name' },
        ])).toEqual(['Authorization', 'Last-Event-ID', 'content-type'])
    })
})
