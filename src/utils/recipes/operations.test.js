import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { OPERATIONS, changedOptions, defaultOptions, getOperation, normalizeOptions } from './operations.js'
import { runRecipe } from './runner.js'

const encoder = new TextEncoder()
const utf8 = (b) => new TextDecoder().decode(b)
const hex = (b) => Buffer.from(b).toString('hex')

// Every operation must be exercised below; the last test checks the list.
const tested = new Set()

/** Runs one operation (through the runner, so kinds are converted) and returns { value, notes }. */
async function run(id, input, options = {}, { now } = {}) {
    tested.add(id)
    const op = getOperation(id)
    expect(op, id).toBeTruthy()
    const { options: opts, invalid } = normalizeOptions(op, options)
    expect(invalid, `${id} options`).toEqual([])
    const result = await runRecipe(input, [{ op: id, options: opts, enabled: true }], { now })
    if (result.error) {
        const error = new Error(result.error.message)
        error.text = result.error.text
        throw error
    }
    return { value: result.value, notes: result.trail[0].notes.map((n) => `${n.tone}: ${n.text}`) }
}

const value = async (...args) => (await run(...args)).value
const text = async (...args) => {
    const v = await value(...args)
    expect(typeof v).toBe('string')
    return v
}
const fails = async (...args) => {
    try {
        await run(...args)
    } catch (error) {
        return error.message
    }
    throw new Error(`${args[0]} did not fail`)
}

// RFC 4648 §10 test vectors
const RFC_INPUTS = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']
const RFC_BASE64 = ['', 'Zg==', 'Zm8=', 'Zm9v', 'Zm9vYg==', 'Zm9vYmE=', 'Zm9vYmFy']
const RFC_BASE32 = ['', 'MY======', 'MZXQ====', 'MZXW6===', 'MZXW6YQ=', 'MZXW6YTB', 'MZXW6YTBOI======']
const RFC_BASE32HEX = ['', 'CO======', 'CPNG====', 'CPNMU===', 'CPNMUOG=', 'CPNMUOJ1', 'CPNMUOJ1E8======']
const RFC_BASE16 = ['', '66', '666F', '666F6F', '666F6F62', '666F6F6261', '666F6F626172']

describe('Encoding operations', () => {
    it('Base64 encode/decode: RFC 4648 vectors', async () => {
        for (const [i, input] of RFC_INPUTS.entries()) {
            expect(await text('base64-encode', input)).toBe(RFC_BASE64[i])
            expect(utf8(await value('base64-decode', RFC_BASE64[i]))).toBe(input)
        }
    })

    it('Base64: URL-safe alphabet, padding, data: URIs and line breaks', async () => {
        // fb ef ff | fe → 111110 111110 111111 111111 | 111111 100000
        const data = Uint8Array.from([0xfb, 0xef, 0xff, 0xfe])
        expect(Buffer.from(data).toString('base64')).toBe('++///g==')
        expect(await text('base64-encode', data)).toBe('++///g==')
        expect(await text('base64-encode', data, { alphabet: 'url' })).toBe('--___g==')
        expect(await text('base64-encode', data, { alphabet: 'url', padding: false })).toBe('--___g')
        expect(hex(await value('base64-decode', '--___g'))).toBe('fbeffffe')
        expect(utf8(await value('base64-decode', 'data:text/plain;base64,aGVs\nbG8='))).toBe('hello')
        expect((await value('base64-decode', '  \n')).length).toBe(0)
    })

    it('Base64 decode explains bad input', async () => {
        expect(await fails('base64-decode', 'abc!')).toMatch(/^“!” at position 4 isn’t a Base64 character/)
        expect(await fails('base64-decode', 'ab+c-d')).toBe('this mixes the standard (+ /) and URL-safe (- _) alphabets')
        expect(await fails('base64-decode', 'abcde')).toMatch(/^the length is wrong/)
    })

    it('Base32 encode/decode: RFC 4648 vectors, both alphabets', async () => {
        for (const [i, input] of RFC_INPUTS.entries()) {
            expect(await text('base32-encode', input)).toBe(RFC_BASE32[i])
            expect(await text('base32-encode', input, { alphabet: 'hex' })).toBe(RFC_BASE32HEX[i])
            expect(utf8(await value('base32-decode', RFC_BASE32[i]))).toBe(input)
            expect(utf8(await value('base32-decode', RFC_BASE32HEX[i], { alphabet: 'hex' }))).toBe(input)
        }
        expect(await text('base32-encode', 'foobar', { padding: false })).toBe('MZXW6YTBOI')
        expect(await fails('base32-decode', 'MZXW1')).toMatch(/“1” at position 5 isn’t a Base32 character/)
    })

    it('Hex encode/decode: RFC 4648 base16 vectors and formats', async () => {
        for (const [i, input] of RFC_INPUTS.entries()) {
            expect(await text('hex-encode', input, { upper: true })).toBe(RFC_BASE16[i])
            expect(utf8(await value('hex-decode', RFC_BASE16[i]))).toBe(input)
            expect(utf8(await value('hex-decode', RFC_BASE16[i].toLowerCase()))).toBe(input)
        }
        expect(await text('hex-encode', 'Hé', { format: 'space' })).toBe('48 c3 a9')
        expect(await text('hex-encode', 'Hé', { format: 'colon', upper: true })).toBe('48:C3:A9')
        expect(await text('hex-encode', 'Hé', { format: 'escaped' })).toBe('\\x48\\xc3\\xa9')
        expect(await text('hex-encode', 'Hé', { format: 'c' })).toBe('0x48, 0xc3, 0xa9')
        expect(utf8(await value('hex-decode', '0x48, 0xc3, 0xa9'))).toBe('Hé')
        expect(await fails('hex-decode', '48 c'.concat('g'))).toBe('“g” at position 5 isn’t a hex digit (0–9, a–f)')
    })

    it('URL encode/decode: component, full and form', async () => {
        const sample = 'q=café & crème/1?x'
        expect(await text('url-encode', sample)).toBe(encodeURIComponent(sample))
        expect(await text('url-encode', sample, { mode: 'full' })).toBe(encodeURI(sample))
        expect(await text('url-encode', sample, { mode: 'form' })).toBe(new URLSearchParams({ k: sample }).toString().slice(2))
        expect(await text('url-decode', encodeURIComponent(sample))).toBe(sample)
        expect(await text('url-decode', 'a%2Fb%20c', { mode: 'full' })).toBe('a%2Fb c')
        expect(await text('url-decode', 'a+b%2B', { mode: 'form' })).toBe('a b+')
        expect(await fails('url-decode', '50%')).toMatch(/^“%” at position 3 isn’t a valid escape/)
    })

    it('HTML entity encode/decode', async () => {
        expect(await text('html-encode', '<p class="x">Tom & \'Jerry\' é</p>')).toBe('&lt;p class=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39; é&lt;/p&gt;')
        expect(await text('html-encode', 'café ©', { scope: 'all' })).toBe('caf&eacute; &copy;')
        expect(await text('html-encode', 'é😀', { scope: 'all', format: 'hex' })).toBe('&#xE9;&#x1F600;')
        expect(await text('html-decode', '&lt;b&gt;caf&eacute; &copy;2024 &#x1F600; &#128; &NotEqualTilde;')).toBe('<b>café ©2024 😀 € \u2242\u0338')
        const { value: out, notes } = await run('html-decode', '&bogus; &amp;')
        expect(out).toBe('&bogus; &')
        expect(notes).toEqual(['warning: Unknown references left as they are: &bogus;'])
    })

    it('To/from binary', async () => {
        expect(await text('to-binary', 'Hi')).toBe('01001000 01101001')
        expect(await text('to-binary', 'Hi', { separator: 'none' })).toBe('0100100001101001')
        expect(await text('to-binary', new Uint8Array([0, 255]), { separator: 'newline' })).toBe('00000000\n11111111')
        expect(utf8(await value('from-binary', '01001000 01101001'))).toBe('Hi')
        expect(await fails('from-binary', '0112')).toBe('“2” at position 4 isn’t a binary digit (0 or 1)')
    })

    it('To/from char codes', async () => {
        expect(await text('to-charcodes', 'Hé😀')).toBe('72 233 128512')
        expect(await text('to-charcodes', 'Hé😀', { base: 'unicode', separator: 'comma' })).toBe('U+0048, U+00E9, U+1F600')
        expect(await text('to-charcodes', 'Hi', { base: 'hex', separator: 'newline' })).toBe('48\n69')
        expect(await text('from-charcodes', '72 233 128512')).toBe('Hé😀')
        expect(await text('from-charcodes', '48 e9 1f600', { base: 'hex' })).toBe('Hé😀')
        expect(await fails('from-charcodes', '56000')).toMatch(/is a surrogate/)
    })

    it('ROT13 and other shifts', async () => {
        expect(await text('rot13', 'Why did the chicken cross the road?')).toBe('Jul qvq gur puvpxra pebff gur ebnq?')
        expect(await text('rot13', 'Hello', { amount: 1 })).toBe('Ifmmp')
        expect(await text('rot13', 'abc', { amount: 25 })).toBe('zab')
    })
})

describe('Compression operations', () => {
    // GNU gzip 1.13: printf 'hello world\n' | gzip -n
    const GNU_GZIP = '1f8b0800000000000003cb48cdc9c95728cf2fca49e102002d3b08af0c000000'

    it('Gunzip: a known gzip sample made by GNU gzip', async () => {
        expect(utf8(await value('gunzip', Buffer.from(GNU_GZIP, 'hex')))).toBe('hello world\n')
    })

    it('Gzip: output is real gzip (zlib reads it) and round-trips', async () => {
        const input = 'The quick brown fox jumps over the lazy dog. '.repeat(50)
        const gz = await value('gzip', input)
        expect(gz).toBeInstanceOf(Uint8Array)
        expect(hex(gz.subarray(0, 3))).toBe('1f8b08')
        expect(gz.length).toBeLessThan(input.length / 5)
        expect(zlib.gunzipSync(gz).toString()).toBe(input)
        expect(utf8(await value('gunzip', gz))).toBe(input)
        const binary = crypto.randomBytes(5000)
        expect(Buffer.from(await value('gunzip', await value('gzip', binary))).equals(binary)).toBe(true)
    })

    it('Gunzip: explains input that isn’t gzip', async () => {
        expect(await fails('gunzip', 'hello there')).toBe('the input isn’t gzip data: gzip starts with the bytes 1f 8b, this starts with 68 65.')
        expect(await fails('gunzip', 'helloworldfoobar')).toBe('the input isn’t gzip data: gzip starts with the bytes 1f 8b, this starts with 68 65.')
        const b64 = zlib.gzipSync('{"a":1}').toString('base64')
        expect(await fails('gunzip', b64)).toMatch(/It’s compressed data written as Base64: add Base64 decode before this step\.$/)
        expect(await fails('gunzip', GNU_GZIP)).toMatch(/It’s compressed data written as hex: add Hex decode before this step\.$/)
        expect(await fails('gunzip', '1f 8b 08 00 00 00')).toMatch(/written as hex/)
        expect(await fails('gunzip', zlib.deflateSync('hello'))).toMatch(/It looks like zlib data: use Inflate instead\.$/)
        const truncated = Buffer.from(GNU_GZIP, 'hex').subarray(0, 20)
        expect(await fails('gunzip', truncated)).toMatch(/^the gzip data is damaged or incomplete/)
        expect(await fails('gunzip', new Uint8Array(0))).toBe('the input is empty, so there’s nothing to decompress')
    })

    it('Deflate: zlib and raw formats, readable by zlib', async () => {
        const input = 'hello hello hello hello'
        const z = await value('deflate', input)
        const raw = await value('deflate', input, { format: 'raw' })
        expect(z[0]).toBe(0x78)
        expect(zlib.inflateSync(z).toString()).toBe(input)
        expect(zlib.inflateRawSync(raw).toString()).toBe(input)
        // zlib = 2-byte header + the raw stream + 4-byte Adler-32 of the data
        expect(z.length).toBe(raw.length + 6)
        expect(Buffer.from(z).readUInt32BE(z.length - 4)).toBe(adler32(input))
        expect(hex(z.subarray(2, z.length - 4))).toBe(hex(raw))
    })

    it('Inflate: known zlib and raw vectors, detected automatically', async () => {
        const zlibHello = Buffer.from('789ccb48cdc9c90700062c0215', 'hex')
        const rawHello = Buffer.from('cb48cdc9c90700', 'hex')
        let r = await run('inflate', zlibHello)
        expect(utf8(r.value)).toBe('hello')
        expect(r.notes).toEqual(['info: Read as zlib data'])
        r = await run('inflate', rawHello)
        expect(utf8(r.value)).toBe('hello')
        expect(r.notes).toEqual(['info: Read as raw deflate data'])
        expect(utf8(await value('inflate', zlibHello, { format: 'zlib' }))).toBe('hello')
        expect(utf8(await value('inflate', rawHello, { format: 'raw' }))).toBe('hello')
    })

    it('Inflate: format mismatches are explained', async () => {
        const zlibHello = Buffer.from('789ccb48cdc9c90700062c0215', 'hex')
        const rawHello = Buffer.from('cb48cdc9c90700', 'hex')
        expect(await fails('inflate', rawHello, { format: 'zlib' })).toBe('the input isn’t zlib data: it doesn’t start with a zlib header (such as 78 9c), it starts with cb 48. Try the Raw deflate format.')
        expect(await fails('inflate', zlibHello, { format: 'raw' })).toMatch(/^the input isn’t valid raw deflate data, or it’s damaged or incomplete.*It starts with a zlib header: use the zlib format \(or Detect\)\.$/)
        expect(await fails('inflate', zlib.gzipSync('x'))).toBe('this is gzip data, not zlib or raw deflate: use Gunzip instead')
        expect(await fails('inflate', 'definitely not deflate')).toMatch(/^the input isn’t valid deflate \(zlib or raw\) data/)
        expect(await fails('inflate', zlib.deflateSync('hello').toString('base64'))).toMatch(/It’s compressed data written as Base64: add Base64 decode before this step\.$/)
    })
})

function adler32(text) {
    let a = 1
    let b = 0
    for (const byte of encoder.encode(text)) {
        a = (a + byte) % 65521
        b = (b + a) % 65521
    }
    return ((b << 16) | a) >>> 0
}

describe('Data format operations', () => {
    const sample = '{"b":1,"10":2,"big":12345678901234567890,"f":1.0,"s":"caf\\u00e9","a":[1,{"z":null,"y":true}],"o":{}}'

    it('JSON prettify keeps numbers, key order and escapes exactly', async () => {
        expect(await text('json-prettify', sample)).toBe([
            '{',
            '  "b": 1,',
            '  "10": 2,',
            '  "big": 12345678901234567890,',
            '  "f": 1.0,',
            '  "s": "caf\\u00e9",',
            '  "a": [',
            '    1,',
            '    {',
            '      "z": null,',
            '      "y": true',
            '    }',
            '  ],',
            '  "o": {}',
            '}',
        ].join('\n'))
        const plain = '{"x":[1,2,{"y":"z"}],"w":false}'
        expect(await text('json-prettify', plain, { indent: '4' })).toBe(JSON.stringify(JSON.parse(plain), null, 4))
        expect(await text('json-prettify', plain, { indent: 'tab' })).toBe(JSON.stringify(JSON.parse(plain), null, '\t'))
    })

    it('JSON minify and sort keys', async () => {
        expect(await text('json-minify', '{\n  "a": [ 1, 2 ],\n  "big": 12345678901234567890\n}\n')).toBe('{"a":[1,2],"big":12345678901234567890}')
        expect(await text('json-sort-keys', '{"b":{"d":1,"c":[{"f":1,"e":2}]},"a":12345678901234567890}', { indent: 'none' }))
            .toBe('{"a":12345678901234567890,"b":{"c":[{"e":2,"f":1}],"d":1}}')
        expect(await text('json-sort-keys', '{"b":1,"a":2}')).toBe('{\n  "a": 2,\n  "b": 1\n}')
    })

    it('JSON operations explain invalid input and warn about duplicate keys', async () => {
        expect(await fails('json-prettify', '{"a":1,}')).toBe('the input isn’t valid JSON: trailing commas aren’t allowed: remove the last “,” (line 1, column 7)')
        expect(await fails('json-minify', '  ')).toBe('the input is empty: there’s no JSON to read')
        const { notes } = await run('json-prettify', '{"a":1,"a":2}')
        expect(notes).toEqual(['warning: Duplicate keys (kept as written): "a"'])
    })

    it('JSON → YAML', async () => {
        const { value: yaml, notes } = await run('json-to-yaml', '{"name":"api","ports":[80,443],"tls":{"on":true},"big":12345678901234567890,"note":"a\\nb","nothing":null}')
        expect(yaml).toBe('name: api\nports:\n  - 80\n  - 443\ntls:\n  \'on\': true\nbig: 12345678901234567890\nnote: |-\n  a\n  b\nnothing: null')
        expect(notes).toEqual([])
        expect(await text('json-to-yaml', '{"a":{"b":1}}', { indent: '4' })).toBe('a:\n    b: 1')
        const moved = await run('json-to-yaml', '{"b":1,"10":2}')
        expect(moved.value).toBe("'10': 2\nb: 1")
        expect(moved.notes[0]).toMatch(/Integer-like keys/)
    })

    it('YAML → JSON: anchors, merge keys, big integers, several documents', async () => {
        const yaml = 'defaults: &d\n  replicas: 2\nservice:\n  <<: *d\n  name: api\n  id: 12345678901234567890\n  on: yes\n'
        expect(await text('yaml-to-json', yaml, { indent: 'none' })).toBe('{"defaults":{"replicas":2},"service":{"replicas":2,"name":"api","id":12345678901234567890,"on":"yes"}}')
        const multi = await run('yaml-to-json', 'a: 1\n---\nb: 2\n', { indent: 'none' })
        expect(multi.value).toBe('[{"a":1},{"b":2}]')
        expect(multi.notes).toEqual(['info: 2 YAML documents became one JSON array'])
        const inf = await run('yaml-to-json', 'x: .inf', { indent: 'none' })
        expect(inf.value).toBe('{"x":null}')
        expect(inf.notes[0]).toMatch(/^warning: 1 value \(\.inf or \.nan\) became null/)
        expect(await fails('yaml-to-json', 'a: [1, 2')).toMatch(/^the input isn’t valid YAML: .*\(line \d+, column \d+\)$/)
    })

    it('JSON → TOML and TOML → JSON', async () => {
        const toml = await run('json-to-toml', '{"title":"app","count":12345678901234567890,"skip":null,"server":{"host":"x","port":80,"gone":null}}')
        expect(toml.value).toBe('title = "app"\ncount = 12345678901234567890\n\n[server]\nhost = "x"\nport = 80\n')
        expect(toml.notes).toEqual(['warning: TOML has no null, so 2 keys were left out: skip, server.gone'])
        expect(await fails('json-to-toml', '[1,2]')).toBe('TOML needs an object at the top level, but this is an array. Wrap it in a key, for example {"items": …}')
        expect(await fails('json-to-toml', '{"a":[1,null]}')).toBe('TOML has no null, and an array can’t skip values: a[1] is null')
        const json = await text('toml-to-json', 'title = "app"\nbig = 12345678901234567890\nday = 1979-05-27\nwhen = 1979-05-27T07:32:00Z\n[server]\nports = [80, 443]\n', { indent: 'none' })
        expect(json).toBe('{"title":"app","big":12345678901234567890,"day":"1979-05-27","when":"1979-05-27T07:32:00.000Z","server":{"ports":[80,443]}}')
        expect(await fails('toml-to-json', 'a = ')).toMatch(/^the input isn’t valid TOML: /)
    })

    // Header {"alg":"HS256","typ":"JWT"}, payload with a big number and an exp in 2001
    const jwt = (payload) => {
        const part = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
        return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.c2ln`
    }

    it('JWT decode shows header and payload exactly', async () => {
        const token = jwt('{"sub":"42","id":12345678901234567890,"exp":1000000000}')
        const { value: out, notes } = await run('jwt-decode', `Bearer ${token}`, {}, { now: () => 2_000_000_000_000 })
        expect(out).toBe('{\n  "header": {\n    "alg": "HS256",\n    "typ": "JWT"\n  },\n  "payload": {\n    "sub": "42",\n    "id": 12345678901234567890,\n    "exp": 1000000000\n  }\n}')
        expect(notes[0]).toBe('info: Removed the “Bearer” prefix')
        expect(notes[1]).toMatch(/^warning: Expired /)
        expect(await text('jwt-decode', token, { part: 'payload' })).toBe('{\n  "sub": "42",\n  "id": 12345678901234567890,\n  "exp": 1000000000\n}')
        expect(await text('jwt-decode', token, { part: 'header' })).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}')
        expect(await text('jwt-decode', jwt('plain text'), { part: 'payload' })).toBe('"plain text"')
    })

    it('JWT decode explains what isn’t a JWT', async () => {
        expect(await fails('jwt-decode', 'abc.def')).toBe('this isn’t a JWT: a JWT has 3 parts separated by dots, this has 2')
        expect(await fails('jwt-decode', '   ')).toMatch(/^the input is empty/)
        expect(await fails('jwt-decode', '%%%.e30.x')).toMatch(/^the header isn't valid Base64url/)
        const jweHeader = Buffer.from('{"alg":"dir","enc":"A256GCM"}').toString('base64url')
        expect(await fails('jwt-decode', `${jweHeader}..aaa.bbb.ccc`)).toBe('this is an encrypted token (JWE): its payload can’t be read without the key')
    })
})

describe('Hashing operations', () => {
    // FIPS 180 / RFC 1321 test vectors for "abc"
    const ABC = {
        md5: '900150983cd24fb0d6963f7d28e17f72',
        sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        sha384: 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
        sha512: 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    }
    const NODE = { md5: 'md5', sha1: 'sha1', sha256: 'sha256', sha384: 'sha384', sha512: 'sha512' }

    it('digests of "abc" match the standard test vectors', async () => {
        for (const [id, digest] of Object.entries(ABC)) {
            expect(await text(id, 'abc'), id).toBe(digest)
            expect(await text(id, 'abc', { format: 'HEX' }), id).toBe(digest.toUpperCase())
            expect(await text(id, 'abc', { format: 'base64' }), id).toBe(Buffer.from(digest, 'hex').toString('base64'))
        }
    })

    it('hash bytes exactly, including binary and empty input', async () => {
        const data = crypto.randomBytes(300_000)
        for (const [id, algorithm] of Object.entries(NODE)) {
            expect(await text(id, data), id).toBe(crypto.createHash(algorithm).update(data).digest('hex'))
            expect(await text(id, ''), id).toBe(crypto.createHash(algorithm).update('').digest('hex'))
        }
    })
})

describe('Date and time operations', () => {
    it('Unix timestamp → ISO date, detecting the unit per line', async () => {
        const { value: out, notes } = await run('unix-to-date', '1700000000\n1700000000123\n\n1700000000123456\r\n-1')
        expect(out).toBe('2023-11-14T22:13:20.000Z\r\n2023-11-14T22:13:20.123Z\r\n\r\n2023-11-14T22:13:20.123456Z\r\n1969-12-31T23:59:59.000Z')
        expect(notes).toEqual(['info: Read as seconds and milliseconds and microseconds (from the number of digits)'])
        expect(await text('unix-to-date', '1700000000', { unit: 'ms' })).toBe('1970-01-20T16:13:20.000Z')
        expect(await text('unix-to-date', '1700000000000000000', { unit: 'ns' })).toBe('2023-11-14T22:13:20.000Z')
    })

    it('Unix timestamp → ISO date rejects dates and text', async () => {
        expect(await fails('unix-to-date', '1700000000\n2024-05-01')).toBe('line 2: “2024-05-01” is a date, not a Unix timestamp: use Date → Unix timestamp to convert dates')
        expect(await fails('unix-to-date', 'soon')).toBe('“soon” isn’t a Unix timestamp (a number of seconds since 1970)')
    })

    it('Date → Unix timestamp in every unit', async () => {
        expect(await text('date-to-unix', '2023-11-14T22:13:20Z')).toBe('1700000000')
        expect(await text('date-to-unix', '2023-11-14T22:13:20.5Z')).toBe('1700000000.5')
        expect(await text('date-to-unix', '2023-11-14T22:13:20.123Z', { unit: 'ms' })).toBe('1700000000123')
        expect(await text('date-to-unix', '2023-11-15T00:13:20+02:00', { unit: 'us' })).toBe('1700000000000000')
        expect(await text('date-to-unix', '2023-11-14T22:13:20Z', { unit: 'ns' })).toBe('1700000000000000000')
        const dateOnly = await run('date-to-unix', '2024-05-01\n\n2024-05-02')
        expect(dateOnly.value).toBe('1714521600\n\n1714608000')
        expect(dateOnly.notes).toEqual(['info: Dates without a time are read as midnight UTC'])
        const local = await run('date-to-unix', '2024-05-01T12:00:00')
        expect(local.value).toBe(String(Date.parse('2024-05-01T12:00:00') / 1000))
        expect(local.notes[0]).toMatch(/^warning: 1 date has no time zone, so it was read in your time zone/)
    })

    it('Date → Unix timestamp rejects numbers and unreadable text', async () => {
        expect(await fails('date-to-unix', '1700000000')).toBe('“1700000000” is already a number: use Unix timestamp → ISO date to read timestamps')
        expect(await fails('date-to-unix', '2024-05-01\nnot a date')).toBe('line 2: “not a date” isn’t a date this browser can read. Use a format such as 2024-05-01T12:00:00Z')
    })
})

describe('Text operations', () => {
    it('Upper, lower and other cases', async () => {
        expect(await text('upper-case', 'Hello wörld ß')).toBe('HELLO WÖRLD SS')
        expect(await text('lower-case', 'HELLO WÖRLD')).toBe('hello wörld')
        expect(await text('change-case', 'user_id name\nXMLHttpRequest')).toBe('userIdName\nxmlHttpRequest')
        expect(await text('change-case', 'getHTTPResponse code', { case: 'snake' })).toBe('get_http_response_code')
        expect(await text('change-case', 'hello big world', { case: 'kebab' })).toBe('hello-big-world')
        expect(await text('change-case', 'hello big world', { case: 'constant' })).toBe('HELLO_BIG_WORLD')
        expect(await text('change-case', 'the iPhone of NASA', { case: 'title' })).toBe('The iPhone Of NASA')
    })

    it('Reverse keeps emoji and accents whole', async () => {
        expect(await text('reverse', 'ab👨‍👩‍👧c\u0065\u0301')).toBe('\u0065\u0301c👨‍👩‍👧ba')
        expect(await text('reverse', 'one\ntwo\nthree\n', { by: 'lines' })).toBe('three\ntwo\none\n')
    })

    it('Trim the whole text or each line', async () => {
        expect(await text('trim', '  a  \n  b  \n')).toBe('a  \n  b')
        expect(await text('trim', '  a  \n  b  ', { lines: true })).toBe('a\nb')
        expect(await text('trim', '  a  \n  b  ', { lines: true, where: 'start' })).toBe('a  \nb  ')
        expect(await text('trim', '  a  ', { where: 'end' })).toBe('  a')
    })

    it('Sort lines: natural, reverse, case-insensitive; keeps CRLF and the last line break', async () => {
        expect(await text('sort-lines', 'item10\nitem2\nItem1\n')).toBe('Item1\nitem2\nitem10\n')
        expect(await text('sort-lines', 'item10\nitem2', { natural: false })).toBe('item10\nitem2')
        expect(await text('sort-lines', 'b\r\na\r\nc', { order: 'desc' })).toBe('c\r\nb\r\na')
        expect(await text('sort-lines', 'b\nB\na\nA', { ignoreCase: true })).toBe('a\nA\nb\nB')
    })

    it('Unique lines keeps the first of each', async () => {
        const r = await run('unique-lines', 'a\nb\na\nB\nb\n')
        expect(r.value).toBe('a\nb\nB\n')
        expect(r.notes).toEqual(['info: Removed 2 duplicate lines'])
        expect(await text('unique-lines', 'a\nA\nb', { ignoreCase: true })).toBe('a\nb')
    })

    it('Remove empty lines, with or without whitespace-only lines', async () => {
        expect(await text('remove-empty-lines', 'a\n\n  \nb\n')).toBe('a\nb\n')
        expect(await text('remove-empty-lines', 'a\n\n  \nb', { whitespace: false })).toBe('a\n  \nb')
    })

    it('Find & replace: literal text', async () => {
        const r = await run('find-replace', 'a.b.c (1+1)', { find: '.', replace: '[dot]' })
        expect(r.value).toBe('a[dot]b[dot]c (1+1)')
        expect(r.notes).toEqual(['info: Replaced 2 matches'])
        expect(await text('find-replace', 'cost: $5', { find: '$5', replace: '$$1 and $&' })).toBe('cost: $$1 and $&')
        expect(await text('find-replace', 'a,b,c', { find: ',', replace: '\\n' })).toBe('a\nb\nc')
        expect(await text('find-replace', 'x\ny', { find: '\\n', replace: ' \\\\ ' })).toBe('x \\ y')
        expect(await text('find-replace', 'Aa aA', { find: 'a', replace: '-', flags: 'gi' })).toBe('-- --')
        expect(await text('find-replace', 'aaa', { find: 'a', replace: 'b', flags: '' })).toBe('baa')
    })

    it('Find & replace: regular expressions with groups and flags', async () => {
        expect(await text('find-replace', '2024-05-01 and 1999-12-31', { find: '(\\d{4})-(\\d{2})-(\\d{2})', replace: '$3/$2/$1', regex: true })).toBe('01/05/2024 and 31/12/1999')
        expect(await text('find-replace', 'first\nsecond', { find: '^', replace: '> ', regex: true, flags: 'gm' })).toBe('> first\n> second')
        expect(await text('find-replace', 'a b', { find: '(?<x>a)', replace: '[$<x>]', regex: true })).toBe('[a] b')
        const none = await run('find-replace', 'abc', { find: 'z', replace: 'y' })
        expect(none.value).toBe('abc')
        expect(none.notes).toEqual(['info: No matches'])
        const empty = await run('find-replace', 'abc', {})
        expect(empty.value).toBe('abc')
        expect(empty.notes).toEqual(['info: Enter the text to find'])
    })

    it('Find & replace: invalid patterns and flags are explained', async () => {
        expect(await fails('find-replace', 'x', { find: '(a', regex: true })).toBe('the pattern isn’t a valid regular expression: Unterminated group')
        expect(await fails('find-replace', 'x', { find: 'a', flags: 'gx' })).toBe('“x” isn’t a regular expression flag (use g, i, m, s, u, v, y or d)')
        expect(await fails('find-replace', 'x', { find: 'a', flags: 'gg' })).toBe('the flag “g” is listed twice')
        expect(await fails('find-replace', 'x', { find: 'a', flags: 'uv' })).toBe('the flags u and v can’t be combined; use one of them')
    })

    it('Extract with regex: all matches, a numbered or a named group', async () => {
        const log = 'user=ada id=7\nuser=bob id=42\nnoise\nuser=cy id=300'
        const all = await run('regex-extract', log, { pattern: 'id=\\d+' })
        expect(all.value).toBe('id=7\nid=42\nid=300')
        expect(all.notes).toEqual(['info: 3 matches'])
        expect(await text('regex-extract', log, { pattern: 'id=(\\d+)', group: '1' })).toBe('7\n42\n300')
        expect(await text('regex-extract', log, { pattern: 'user=(?<name>\\w+)', group: 'name' })).toBe('ada\nbob\ncy')
        expect(await text('regex-extract', 'A a', { pattern: 'a', flags: 'i' })).toBe('A\na')
        const none = await run('regex-extract', 'abc', { pattern: '\\d' })
        expect(none.value).toBe('')
        expect(none.notes).toEqual(['info: No matches'])
        expect(await fails('regex-extract', 'x', { pattern: '(a)', group: '2' })).toBe('the pattern has only 1 group, so there’s no group 2')
        expect(await fails('regex-extract', 'x', { pattern: 'a', group: '1' })).toBe('the pattern has no groups, so there’s no group 1')
        expect(await fails('regex-extract', 'x', { pattern: '(?<a>x)', group: 'b' })).toBe('the pattern has no group named “b” (it has “a”)')
        expect(await fails('regex-extract', 'x', { pattern: '[' })).toMatch(/^the pattern isn’t a valid regular expression: /)
    })

    it('Count lines, words, characters and bytes', async () => {
        // 25 user-perceived characters (the family emoji is one); its 5 code points take 18 bytes
        const sample = 'Hello wörld 👨‍👩‍👧\nsecond line'
        expect(Buffer.byteLength(sample)).toBe(43)
        expect(await text('count', sample)).toBe('Lines: 2\nWords: 4\nCharacters: 25\nBytes (UTF-8): 43')
        expect(await text('count', '')).toBe('Lines: 0\nWords: 0\nCharacters: 0\nBytes (UTF-8): 0')
        const binary = await run('count', new Uint8Array([0xff, 0x00, 0x80]))
        expect(binary.value).toBe('Bytes: 3')
        expect(binary.notes).toEqual(['info: Binary data: only the bytes are counted'])
    })
})

describe('Registry', () => {
    it('has unique ids, known groups, valid kinds and option defaults', () => {
        const ids = OPERATIONS.map((op) => op.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const op of OPERATIONS) {
            expect(['encoding', 'compression', 'data', 'hashing', 'datetime', 'text']).toContain(op.group)
            expect(['text', 'bytes', 'any']).toContain(op.input)
            expect(['text', 'bytes']).toContain(op.output)
            expect(op.name && op.description, op.id).toBeTruthy()
            expect(typeof op.run).toBe('function')
            // Defaults are valid values, so normalizing them changes nothing
            expect(normalizeOptions(op, defaultOptions(op)).invalid, op.id).toEqual([])
            expect(changedOptions(op, defaultOptions(op)), op.id).toEqual({})
        }
    })

    it('resets invalid option values and drops unknown ones', () => {
        const op = getOperation('find-replace')
        const { options, invalid } = normalizeOptions(op, { find: 5, regex: 'yes', flags: 'g', extra: 1 })
        expect(invalid).toEqual(['find', 'regex'])
        expect(options).toEqual({ find: '', replace: '', regex: false, flags: 'g' })
        expect(normalizeOptions(getOperation('rot13'), { amount: 26 }).invalid).toEqual(['amount'])
        expect(normalizeOptions(getOperation('json-prettify'), { indent: '3' }).options.indent).toBe('2')
    })
})

// Runs last (tests in a file run in order): every registered operation was
// exercised with known vectors above
describe('Coverage', () => {
    it('tests every operation in the registry', () => {
        expect(OPERATIONS.map((op) => op.id).filter((id) => !tested.has(id))).toEqual([])
    })
})
