import { Buffer } from 'node:buffer'
// Note: in Node there is no DOMParser, so XML detection uses its regex-only fallback here.
import { describe, expect, it } from 'vitest'
import { analyzeContent as analyzeViaAnalyzers, detectFormats as detectViaAnalyzers } from './analyzers'
import { analyzeContent, detectFormats } from './detect'

const ids = (text) => detectFormats(text).map(f => f.id)
const first = (text) => detectFormats(text)[0]

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

describe('detectFormats basics', () => {
    it('returns nothing for empty or non-string input', () => {
        expect(detectFormats('')).toEqual([])
        expect(detectFormats('   \n ')).toEqual([])
        expect(detectFormats(null)).toEqual([])
        expect(detectFormats(42)).toEqual([])
    })
    it('sorts best match first', () => {
        const results = detectFormats('{"a":1}')
        expect(results.map(r => r.confidence)).toEqual([...results.map(r => r.confidence)].sort((a, b) => b - a))
    })
    it('analyzers.js re-exports the same functions', () => {
        expect(detectViaAnalyzers).toBe(detectFormats)
        expect(analyzeViaAnalyzers).toBe(analyzeContent)
    })
})

describe('supported content types', () => {
    it('cURL', () => {
        expect(first("curl -H 'A: b' https://x.test")).toMatchObject({ id: 'curl', tool: '/curl' })
        expect(first('curl.exe https://x.test').id).toBe('curl')
    })
    it('JWT, with the algorithm as detail, and not when it is just three dotted words', () => {
        expect(first(JWT)).toMatchObject({ id: 'jwt', tool: '/jwt', detail: 'HS256', confidence: 0.99 })
        expect(ids('aaa.bbb.ccc')).not.toContain('jwt')
        // header decodes to JSON without alg/typ
        const noAlg = `${Buffer.from('{"x":1}').toString('base64url')}.${Buffer.from('{"a":1}').toString('base64url')}.sig`
        expect(ids(noAlg)).not.toContain('jwt')
        // unsecured token with empty signature
        const unsecured = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"a":1}').toString('base64url')}.`
        expect(ids(unsecured)).toContain('jwt')
    })
    it('URL', () => {
        expect(first('https://example.com/a?b=1')).toMatchObject({ id: 'url', tool: '/url' })
        expect(ids('wss://x.test/socket')).toContain('url')
        expect(ids('ftp://x.test/file')).toContain('url')
    })
    it('image data URI and SVG', () => {
        expect(first('data:image/png;base64,iVBORw0KGgo=')).toMatchObject({ id: 'data-uri', tool: '/image-base64', mode: 'decode' })
        expect(ids('data:image/svg+xml;charset=utf-8,%3Csvg%3E')).toContain('data-uri')
        expect(first('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toMatchObject({ id: 'svg', tool: '/svg' })
        expect(ids('<?xml version="1.0"?>\n<!-- c -->\n<svg viewBox="0 0 1 1"></svg>')).toContain('svg')
        expect(ids('<svg xmlns="x"></svg>')).not.toContain('xml')
    })
    it('JSON objects and arrays', () => {
        expect(first('{"a":[1,2]}')).toMatchObject({ id: 'json', tool: '/formatters', mode: 'json' })
        expect(first('[1, 2, 3]').id).toBe('json')
    })
    it('XML', () => {
        expect(first('<?xml version="1.0"?><root><a>1</a></root>')).toMatchObject({ id: 'xml', mode: 'xml' })
        expect(first('<a><b/></a>').id).toBe('xml')
    })
    it('UUID with version detail, braces allowed', () => {
        expect(first('919108f7-52d1-4320-9bac-f847db4148a8')).toMatchObject({ id: 'uuid', detail: 'v4', tool: '/inspect' })
        expect(first('{017F22E2-79B0-7CC3-98C4-DC0C0C07398F}')).toMatchObject({ id: 'uuid', detail: 'v7' })
    })
    it('IPv4 and IPv6 addresses and CIDR blocks', () => {
        expect(first('192.168.0.1')).toMatchObject({ id: 'ipv4', label: 'IPv4 address', tool: '/cidr' })
        expect(first('10.0.0.0/8')).toMatchObject({ id: 'ipv4', label: 'IPv4 CIDR block' })
        expect(first('2001:db8::1')).toMatchObject({ id: 'ipv6', label: 'IPv6 address' })
        expect(first('::1').id).toBe('ipv6')
        expect(first('::ffff:192.0.2.1').id).toBe('ipv6')
        expect(first('fe80::/10')).toMatchObject({ id: 'ipv6', label: 'IPv6 CIDR block' })
        expect(first('1:2:3:4:5:6:7:8').id).toBe('ipv6')
    })
    it('Unix timestamps in each unit, with the unit in the label', () => {
        expect(first('1700000000')).toMatchObject({ id: 'timestamp', label: 'Unix timestamp (s)', confidence: 0.92 })
        expect(first('1700000000000').label).toBe('Unix timestamp (ms)')
        expect(first('1700000000000000').label).toBe('Unix timestamp (µs)')
        expect(first('1700000000000000000').label).toBe('Unix timestamp (ns)')
        expect(first('946684800')).toMatchObject({ id: 'timestamp', confidence: 0.6 }) // 9 digits: weaker
    })
    it('colours', () => {
        for (const c of ['#fff', '#ffff', '#ff8800', '#ff880080', 'rgb(1, 2, 3)', 'rgba(1,2,3,.5)', 'hsl(120 50% 50%)', 'hwb(120 10% 10%)']) {
            expect(first(c), c).toMatchObject({ id: 'color', tool: '/color' })
        }
    })
    it('hex digests by length', () => {
        const hash = (n) => 'a1'.repeat(n / 2)
        expect(first(hash(32))).toMatchObject({ id: 'hash', label: 'MD5 hash' })
        expect(first(hash(40)).label).toBe('SHA-1 hash')
        expect(first(hash(56)).label).toBe('SHA-224 hash')
        expect(first(hash(64)).label).toBe('SHA-256 hash')
        expect(first(hash(96)).label).toBe('SHA-384 hash')
        expect(first(hash(128)).label).toBe('SHA-512 hash')
    })
    it('cron expressions and macros', () => {
        expect(first('*/5 * * * *')).toMatchObject({ id: 'cron', tool: '/cron', confidence: 0.9 })
        expect(first('0 9 * * MON-FRI').id).toBe('cron')
        expect(first('@daily').id).toBe('cron')
        expect(first('0 0 12 * * ?').id).toBe('cron')
        expect(first('1 2 3 4 5')).toMatchObject({ id: 'cron', confidence: 0.5 }) // plain numbers: weak
    })
    it('user agents (but a curl command is not one)', () => {
        expect(first('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toMatchObject({ id: 'user-agent', tool: '/ua' })
        expect(first('okhttp/4.9.3 (Linux; Android 13)').id).toBe('user-agent')
        expect(ids('curl -A "Mozilla/5.0 (Windows NT 10.0)" https://x.test')).not.toContain('user-agent')
    })
    it('SQL', () => {
        for (const q of ['SELECT * FROM t', 'insert into t values (1)', 'UPDATE t SET a=1', 'delete from t', 'CREATE TABLE t (a int)', 'with x as (select 1) select * from x']) {
            expect(ids(q), q).toContain('sql')
        }
    })
    it('Base64 flavours', () => {
        expect(first(Buffer.from('{"user":"ada","admin":true}').toString('base64'))).toMatchObject({ id: 'base64', label: 'Base64 (JSON inside)', mode: 'decode' })
        expect(first(Buffer.from('Hello, this is a sentence').toString('base64'))).toMatchObject({ id: 'base64', label: 'Base64 text' })
        expect(first(Buffer.from('{"k":"??>>"}').toString('base64url')).detail).toBe('url-safe')
        expect(first(Buffer.from(Array.from({ length: 30 }, (_, i) => 0xf0 + (i % 16))).toString('base64')).label).toBe('Base64 (binary data)')
    })
    it('YAML and Markdown', () => {
        expect(first('name: app\nversion: 1\nitems:\n  - a\n  - b')).toMatchObject({ id: 'yaml', tool: '/converter', mode: 'yaml' })
        const md = '# Title\n\n- one\n- two\n\nsee [x](https://x.test)'
        expect(ids(md)).toContain('markdown')
        expect(ids(md)).not.toContain('yaml')
    })
    it('email addresses (weak)', () => {
        expect(first('ada@example.com')).toMatchObject({ id: 'email', confidence: 0.5 })
    })
})

describe('look-alikes that must not be detected', () => {
    const none = (text, ...forbidden) => {
        const found = ids(text)
        for (const id of forbidden) expect(found, `${text} should not be ${id}`).not.toContain(id)
    }
    it('plain words and sentences', () => {
        expect(detectFormats('hello')).toEqual([])
        expect(detectFormats('The quick brown fox jumps over the lazy dog.')).toEqual([])
        expect(detectFormats('selection of items')).toEqual([]) // starts with "select" but not as a word
    })
    it('JSON scalars and broken JSON', () => {
        none('42', 'json')
        none('"text"', 'json')
        none('{"a":1', 'json')
        none('[1, 2', 'json')
        none('{a: 1}', 'json')
        none('null', 'json')
    })
    it('almost-IPs and almost-CIDRs', () => {
        for (const t of ['256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '10.0.0.0/33', '1.2.3.4/8/8', '1.2.3.4/abc']) none(t, 'ipv4', 'ipv6')
        for (const t of ['1:2:3', ':::', '1::2::3', 'gggg::1', '1:2:3:4:5:6:7:8:9', '::1/129', '1:2:3:4:5:6:7::8']) none(t, 'ipv6')
    })
    it('numbers outside the plausible timestamp range or with odd lengths', () => {
        for (const t of ['123', '12345678', '1234567890123456789012', '123456789012', '100000000', '99999999999']) none(t, 'timestamp')
        none('1700000000.5', 'timestamp')
        none('4200000000', 'timestamp') // year 2103
    })
    it('hex strings of the wrong length or without digits/letters', () => {
        none('abcdef12', 'hash')
        none('a1'.repeat(15), 'hash') // 30 chars
        none('abcdefabcdefabcdefabcdefabcdefab', 'hash') // 32 letters, no digit
        none('12345678901234567890123456789012', 'hash') // 32 digits, no letter
        none('g1'.repeat(16), 'hash')
    })
    it('malformed UUIDs', () => {
        none('919108f7-52d1-4320-9bac-f847db4148a', 'uuid')
        none('919108f7-52d1-4320-9bac-f847db4148a8a', 'uuid')
        none('919108f752d143209bacf847db4148a8', 'uuid')
        none('919108g7-52d1-4320-9bac-f847db4148a8', 'uuid')
    })
    it('malformed colours', () => {
        none('#ff', 'color')
        none('#fffff', 'color')
        none('#gggggg', 'color')
        none('rgb 1 2 3', 'color')
        none('red', 'color')
    })
    it('things that are not cron', () => {
        none('hello world foo bar baz', 'cron')
        none('* * * *', 'cron')
        none('* * * * * * * *', 'cron')
        none('99 99 99 99 99', 'cron')
        none('a b c d e', 'cron')
        none('@sometimes', 'cron')
    })
    it('not URLs', () => {
        none('example.com', 'url')
        none('https://', 'url')
        none('https://a b', 'url')
        none('mailto:a@b.co', 'url')
        none('https://x.test\nhttps://y.test', 'url')
    })
    it('not emails', () => {
        none('a@b', 'email')
        none('a b@c.com', 'email')
        none('@handle', 'email')
    })
    it('not JWTs', () => {
        none('a.b', 'jwt')
        none('1.2.3', 'jwt')
        none('a.b.c.d', 'jwt')
        none(`${JWT}\nextra`, 'jwt')
    })
    it('Base64 look-alikes: words, short strings, numbers, hex, identifiers with spaces', () => {
        none('Supercalifragilistic', 'base64') // 20 letters, mixed case needed and decode must be valid
        none('shortone', 'base64')
        none('1234567890123456', 'base64')
        none('deadbeefdeadbeef', 'base64')
        none('hello world this is plain', 'base64')
        none('abcdefghijklm', 'base64') // 13 chars: all lower case and not padded
    })
    it('not XML or SVG', () => {
        none('<not closed', 'xml')
        none('a < b > c', 'xml')
        none('<div>text', 'xml')
        none('<svg-like></svg-like>', 'svg')
    })
    it('not YAML: prose with a colon, a single line, JSON', () => {
        none('Note: this is a sentence', 'yaml')
        none('a: 1', 'yaml')
        none('{"a": 1,\n"b": 2}', 'yaml')
    })
    it('not SQL: words merely resembling statements', () => {
        none('selected rows', 'sql')
        none('updated yesterday', 'sql')
        none('drop it', 'sql')
    })
    it('not markdown from a single signal', () => {
        none('# just a heading\nand text', 'markdown')
        none('- a\n- b', 'markdown')
    })
})

describe('analyzeContent', () => {
    it('suggests the best match when confident', () => {
        expect(analyzeContent(JWT)).toMatchObject({ id: 'jwt' })
        expect(analyzeContent('{"a":1}')).toMatchObject({ id: 'json' })
    })
    it('returns null below the 0.6 threshold or for nothing', () => {
        expect(analyzeContent('ada@example.com')).toBeNull() // 0.5
        expect(analyzeContent('1 2 3 4 5')).toBeNull() // plain-number cron, 0.5
        expect(analyzeContent('hello')).toBeNull()
        expect(analyzeContent('')).toBeNull()
    })
    it('accepts the 0.6 confidence timestamp and markdown', () => {
        expect(analyzeContent('946684800')).toMatchObject({ id: 'timestamp' })
        expect(analyzeContent('# T\n\n- a\n- b')).toMatchObject({ id: 'markdown' })
    })
})

describe('certificates, HAR, TOML, CSV and hex', () => {
    const CERT = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ0FGRQ==\n-----END CERTIFICATE-----'
    const KEY = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----'

    it('PEM blocks go to the certificate inspector, named by type and count', () => {
        expect(first(CERT)).toMatchObject({ id: 'pem', tool: '/certificate', label: 'Certificate (PEM)' })
        expect(first(`${CERT}\n${CERT}\n${CERT}`)).toMatchObject({ id: 'pem', label: 'Certificates (3, PEM)', detail: '3 blocks' })
        expect(first(`${CERT}\n${KEY}`)).toMatchObject({ id: 'pem', label: '2 PEM blocks' })
        expect(first('-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----')).toMatchObject({ label: 'Certificate signing request (PEM)' })
        expect(first('-----BEGIN RSA PUBLIC KEY-----\nMIIB\n-----END RSA PUBLIC KEY-----')).toMatchObject({ label: 'Public key (PEM)' })
        expect(first(KEY)).toMatchObject({ label: 'Private key (PEM)' })
        expect(ids(CERT)).not.toContain('base64')
    })

    it('does not claim PEM-looking text it cannot open', () => {
        expect(ids('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA==\n-----END OPENSSH PRIVATE KEY-----')).not.toContain('pem')
        expect(ids('-----BEGIN CERTIFICATE-----\nMIIB (no end marker)')).not.toContain('pem')
        expect(ids('-----BEGIN CERTIFICATE-----\nMIIB\n-----END PRIVATE KEY-----')).not.toContain('pem')
    })

    it('HAR files rank above plain JSON', () => {
        const har = JSON.stringify({ log: { version: '1.2', entries: [{}, {}] } })
        expect(first(har)).toMatchObject({ id: 'har', tool: '/har', detail: '2 requests' })
        expect(ids(har)).toContain('json')
        expect(ids(JSON.stringify({ log: 'x', entries: [] }))).not.toContain('har')
    })

    it('TOML documents', () => {
        const cargo = '[package]\nname = "demo"\nversion = "0.1.0"\nedition = 2021\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\n'
        expect(first(cargo)).toMatchObject({ id: 'toml', tool: '/converter', mode: 'toml', confidence: 0.8 })
        expect(first('title = "TOML"\nenabled = true\nports = [ 8000, 8001 ]\nstarted = 1979-05-27T07:32:00Z')).toMatchObject({ id: 'toml', confidence: 0.7 })
        const multiline = '[server]\nhosts = [\n  "alpha",\n  "omega",\n]\nport = 8080'
        expect(first(multiline)).toMatchObject({ id: 'toml' })
    })

    it('not TOML: INI with bare words, prose, one line, JSON', () => {
        expect(ids('[database]\nuser = admin\nhost = localhost')).not.toContain('toml')
        expect(ids('x = "1"')).not.toContain('toml')
        expect(ids('We agreed that a = b.\nThen c = d follows.')).not.toContain('toml')
        expect(ids('{"a": 1}')).not.toContain('toml')
    })

    it('CSV and TSV with consistent columns, quotes included', () => {
        expect(first('name,email,age\nAda,ada@example.com,36\n"Lovelace, A.",a@example.com,36')).toMatchObject({ id: 'csv', tool: '/csv-json', detail: '3 columns, 2 rows' })
        expect(first('id\tname\n1\tpen\n2\tink')).toMatchObject({ id: 'csv', label: 'Tab-separated values', confidence: 0.75 })
        expect(first('a;b;c\n1;2;3')).toMatchObject({ id: 'csv', detail: '3 columns, 1 rows' })
    })

    it('not CSV: prose, ragged lines, two short lines, Markdown tables, JSON', () => {
        expect(ids('Hello, world')).not.toContain('csv')
        expect(ids('a,b\n1,2')).not.toContain('csv')
        expect(ids('one, two, three\nfour\nfive, six')).not.toContain('csv')
        expect(ids('| a | b |\n|---|---|\n| 1 | 2 |')).not.toContain('csv')
        expect(ids('[1, 2,\n 3, 4]')).not.toContain('csv')
        expect(ids(',x\n1,2\n3,4')).not.toContain('csv')
    })

    it('hex dumps and hex bytes go to the Hex Viewer', () => {
        const xxd = '00000000: 4865 6c6c 6f0a                           Hello.'
        expect(first(xxd)).toMatchObject({ id: 'hex', label: 'Hex dump', tool: '/hex', detail: '6 bytes' })
        const hexdump = '00000000  48 65 6c 6c 6f 0a                                 |Hello.|\n00000006'
        expect(first(hexdump)).toMatchObject({ id: 'hex', label: 'Hex dump' })
        expect(first('de ad be ef 00 01')).toMatchObject({ id: 'hex', label: 'Hex bytes', confidence: 0.7 })
        expect(first('0xca, 0xfe, 0xba, 0xbe')).toMatchObject({ id: 'hex' })
    })

    it('not hex: all-digit pairs, MAC addresses (weak), hashes and short runs', () => {
        expect(ids('10 20 30 40')).not.toContain('hex')
        expect(detectFormats('00:1a:2b:3c:4d:5e').find(f => f.id === 'hex')?.confidence).toBe(0.5)
        expect(analyzeContent('00:1a:2b:3c:4d:5e')?.id).not.toBe('hex')
        expect(ids('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).not.toContain('hex')
        expect(ids('ab cd')).not.toContain('hex')
    })
})

describe('more PEM shapes, HTML and GraphQL', () => {
    const B = (type) => `-----BEGIN ${type}-----\nMIIB\n-----END ${type}-----`

    it('PEM types printed by openssl ecparam, DSA keys and CMS bundles', () => {
        expect(first(`${B('EC PARAMETERS')}\n${B('EC PRIVATE KEY')}`)).toMatchObject({ id: 'pem', label: '2 PEM blocks' })
        expect(first(B('DSA PRIVATE KEY'))).toMatchObject({ label: 'Private key (PEM)' })
        expect(first(B('X.509 CERTIFICATE'))).toMatchObject({ label: 'Certificate (PEM)' })
        expect(first(B('CMS'))).toMatchObject({ label: 'PKCS #7 certificate bundle (PEM)' })
    })

    it('comment and attribute lines may come before the first block', () => {
        expect(first(`# Root CA bundle\n# updated 2026\n\n${B('CERTIFICATE')}`)).toMatchObject({ id: 'pem' })
        expect(first(`Bag Attributes\n    localKeyID: 01 00\nsubject=CN = test\nissuer=CN = test\n${B('CERTIFICATE')}`)).toMatchObject({ id: 'pem' })
        expect(ids(`Here is my certificate:\n${B('CERTIFICATE')}`)).not.toContain('pem')
    })

    it('HTML documents go to the formatter in HTML mode', () => {
        expect(first('<!DOCTYPE html>\n<html><head><title>x</title></head><body><p>Hi<br></body></html>')).toMatchObject({ id: 'html', tool: '/formatters', mode: 'html' })
        expect(first('<!-- page -->\n<html lang="en"><body></body></html>')).toMatchObject({ id: 'html' })
        expect(ids('<div>fragment</div>')).not.toContain('html')
    })

    it('GraphQL operations and fragments', () => {
        expect(first('query GetUser($id: ID!) {\n  user(id: $id) { name }\n}')).toMatchObject({ id: 'graphql', mode: 'graphql' })
        expect(first('mutation { like(id: 1) { count } }')).toMatchObject({ id: 'graphql' })
        expect(first('fragment UserParts on User { id name }')).toMatchObject({ id: 'graphql' })
        expect(ids('query the database for users')).not.toContain('graphql')
        expect(ids('subscription renewal is due {soon}?')).not.toContain('graphql')
    })
})
