import { describe, expect, it } from 'vitest'
import { PII_TYPES, PII_TYPE_MAP, ibanValid, luhnValid, redactText, scanText, shannonEntropy, shortenValue } from './pii'

const types = (text) => scanText(text).findings.map(f => f.type)
const values = (text, type) => scanText(text).findings.filter(f => f.type === type).map(f => f.value)
const has = (text, type) => types(text).includes(type)

describe('luhnValid', () => {
    it.each(['4111111111111111', '5555555555554444', '378282246310005', '6011111111111117', '79927398713', '0'])('accepts %s', (n) => expect(luhnValid(n)).toBe(true))
    it.each(['4111111111111112', '79927398710', '12', '4111a11111111111'])('rejects %s', (n) => expect(luhnValid(n)).toBe(false))
})

describe('ibanValid', () => {
    it('accepts published example IBANs, with or without spaces and in lower case', () => {
        for (const iban of ['GB82 WEST 1234 5698 7654 32', 'DE89370400440532013000', 'FR1420041010050500013M02606', 'NL91 ABNA 0417 1643 00', 'ch9300762011623852957']) {
            expect(ibanValid(iban), iban).toBe(true)
        }
    })
    it('rejects wrong checksum, wrong length and unknown country', () => {
        expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false)
        expect(ibanValid('GB82 WEST 1234 5698 7654 3')).toBe(false)
        expect(ibanValid('XX82 WEST 1234 5698 7654 32')).toBe(false)
        expect(ibanValid('')).toBe(false)
    })
})

describe('shannonEntropy', () => {
    it('is exact for simple distributions', () => {
        expect(shannonEntropy('')).toBe(0)
        expect(shannonEntropy('aaaa')).toBe(0)
        expect(shannonEntropy('abcd')).toBeCloseTo(2, 12)
        expect(shannonEntropy('aabb')).toBeCloseTo(1, 12)
    })
})

describe('payment and bank data', () => {
    it('finds cards by network, with spaces or dashes', () => {
        const f = scanText('Visa 4111 1111 1111 1111, MC 5555-5555-5555-4444, Amex 3782 822463 10005, Discover 6011111111111117.').findings
        expect(f.map(x => [x.type, x.detail])).toEqual([['card', 'Visa'], ['card', 'Mastercard'], ['card', 'American Express'], ['card', 'Discover']])
    })
    it('ignores numbers that fail Luhn, repeat one digit, mix separators or have no card network', () => {
        for (const t of ['4111 1111 1111 1112', '0000000000000000', '4111-1111 1111-1111', '1234567890123456', 'order 4111111111111111x', '4111 1111 11111111']) {
            expect(has(t, 'card'), t).toBe(false)
        }
    })
    it('finds IBANs and ignores near misses', () => {
        expect(values('Pay to GB82 WEST 1234 5698 7654 32 today', 'iban')).toEqual(['GB82 WEST 1234 5698 7654 32'])
        expect(scanText('DE89370400440532013000').findings[0]).toMatchObject({ type: 'iban', detail: 'DE' })
        expect(has('GB82 WEST 1234 5698 7654 33', 'iban')).toBe(false)
    })
    it('finds US SSNs but not invalid area, group or serial numbers', () => {
        expect(values('SSN 123-45-6789.', 'ssn')).toEqual(['123-45-6789'])
        for (const t of ['000-12-3456', '666-12-3456', '900-12-3456', '123-00-6789', '123-45-0000', '1123-45-6789']) expect(has(t, 'ssn'), t).toBe(false)
    })
})

describe('contact data', () => {
    it('finds emails and skips file names, git remotes and no-reply senders', () => {
        expect(values('Mail ada.lovelace+tag@example.co.uk now', 'email')).toEqual(['ada.lovelace+tag@example.co.uk'])
        for (const t of ['icon@2x.png', 'git@github.com:org/repo.git', 'noreply@example.com', 'do-not-reply@example.com', 'a@b']) expect(has(t, 'email'), t).toBe(false)
    })
    it('finds phone numbers in international, North American and national trunk formats', () => {
        expect(values('Call +44 20 7946 0958 or +1 (415) 555-0132', 'phone')).toEqual(['+44 20 7946 0958', '+1 (415) 555-0132'])
        expect(values('Call (415) 555-0132 or 415-555-0132 or 415.555.0132', 'phone')).toHaveLength(3)
        expect(values('Tel 020 7946 0958', 'phone')).toEqual(['020 7946 0958'])
        expect(values('Tel +40721234567', 'phone')).toEqual(['+40721234567'])
    })
    it('does not mistake dates, versions, short numbers or amounts for phones', () => {
        for (const t of ['2024-05-01', '1.2.3', '12345', '+123', 'ID 123-45-678', 'v10.20.30', '3.14159265', '1,234,567.89']) expect(has(t, 'phone'), t).toBe(false)
    })
    it('finds public IPv4 and flags private ones, skipping versions and loopback', () => {
        const f = scanText('Hosts 203.0.113.7 and 192.168.1.10; user-agent Chrome/120.0.0.0; version 12.34.56.78; 127.0.0.1 0.0.0.0 1.2.3.4').findings
        expect(f.map(x => [x.value, x.detail])).toEqual([['203.0.113.7', undefined], ['192.168.1.10', 'private network']])
    })
    it('finds IPv6 addresses but not times or short forms', () => {
        expect(values('addr 2001:db8:85a3::8a2e:370:7334 ok', 'ipv6')).toEqual(['2001:db8:85a3::8a2e:370:7334'])
        for (const t of ['at 12:30:45 UTC', '::1', 'fe80::1', 'a::b']) expect(has(t, 'ipv6'), t).toBe(false)
    })
})

describe('secrets and tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    it('finds JWTs that decode, with the algorithm', () => {
        expect(scanText(`token ${jwt}`).findings).toEqual([expect.objectContaining({ type: 'jwt', value: jwt, detail: 'HS256' })])
        expect(has('eyJhYWFhYWFhYWFh.eyJiYmJiYmJiYmJi.sig', 'jwt')).toBe(false) // header is not JSON
    })
    it('finds AWS access keys', () => {
        expect(scanText('key AKIAIOSFODNN7EXAMPLE end').findings[0]).toMatchObject({ type: 'aws', detail: 'access key ID' })
        expect(scanText('ASIAIOSFODNN7EXAMPLE').findings[0].detail).toBe('temporary key')
        expect(has('XAKIAIOSFODNN7EXAMPLE', 'aws')).toBe(false)
    })
    it('finds well-known token formats', () => {
        const cases = [
            ['ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', 'GitHub token'],
            ['glpat-abcdefghij1234567890', 'GitLab token'],
            ['xoxb-1234567890-abcdefghij', 'Slack token'],
            ['sk_live_' + 'a1B2c3D4e5F6g7H8', 'Stripe key'],
            ['AIza' + 'SyA1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q', 'Google API key'],
            ['npm_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', 'npm token'],
        ]
        for (const [token, detail] of cases) {
            const f = scanText(`use ${token} here`).findings
            expect(f, token).toHaveLength(1)
            expect(f[0]).toMatchObject({ type: 'token', detail, value: token })
        }
    })
    it('finds only the token after Bearer', () => {
        const f = scanText('Authorization: Bearer abcdEFGH1234567890xyz.-_').findings
        expect(f[0]).toMatchObject({ type: 'token', detail: 'Bearer token', value: 'abcdEFGH1234567890xyz.-_' })
    })
    it('finds PEM private keys, whole', () => {
        const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtestkeytestkeytestkey\nabcdefghijklmnop==\n-----END RSA PRIVATE KEY-----'
        const f = scanText(`before\n${pem}\nafter`).findings
        expect(f).toEqual([expect.objectContaining({ type: 'privateKey', value: pem, detail: 'RSA' })])
        expect(has('-----BEGIN PRIVATE KEY-----', 'privateKey')).toBe(false) // header text alone
    })
    it('finds password-like assignments and skips placeholders and code', () => {
        expect(values('password = "hunter2hunter2"', 'secret')).toEqual(['hunter2hunter2'])
        expect(values('DB_PASSWORD=s3cretValue', 'secret')).toEqual(['s3cretValue'])
        expect(values('{"client_secret": "abcd1234efgh"}', 'secret')).toEqual(['abcd1234efgh'])
        expect(values('api_key: sk-notreal-value', 'secret')).toEqual(['sk-notreal-value'])
        for (const t of ['password = "changeme"', 'password: string', 'password = process.env.PASSWORD', 'token = ${TOKEN}', 'password = null', 'timeout = 3000', 'password = "<your password>"', 'password: user.password', 'secret = "****"']) {
            expect(has(t, 'secret'), t).toBe(false)
        }
    })
    it('finds the password in a URL', () => {
        const f = scanText('postgres://admin:S3cr3tPass@db.internal:5432/app').findings
        expect(f).toEqual([expect.objectContaining({ type: 'secret', value: 'S3cr3tPass', detail: 'password in URL' })])
    })
    it('finds high-entropy strings, but not hashes, UUIDs, words or paths', () => {
        const random = 'Zk3Qx9Lm2Vb7Nt5Rw8Yh4Jc6Pd1Fs0Ga'
        expect(scanText(`value ${random} end`).findings[0]).toMatchObject({ type: 'entropy', value: random })
        for (const t of [
            'da39a3ee5e6b4b0d3255bfef95601890afd80709', '919108f7-52d1-4320-9bac-f847db4148a8', 'sha256-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd',
            'internationalizationLocalizationConfiguration', 'src/components/ui/Button/Button_primary_variant', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789',
        ]) expect(has(t, 'entropy'), t).toBe(false)
    })
})

describe('scanText', () => {
    it('returns empty results for empty and non-string input', () => {
        expect(scanText('')).toEqual({ findings: [], counts: {}, truncated: false })
        expect(scanText(null)).toEqual({ findings: [], counts: {}, truncated: false })
        expect(scanText('Nothing sensitive here, just prose.').findings).toEqual([])
    })
    it('reports positions, sorted, with counts', () => {
        const text = 'a@example.com then 203.0.113.7 then b@example.org'
        const { findings, counts } = scanText(text)
        expect(findings.map(f => f.start)).toEqual([...findings.map(f => f.start)].sort((a, b) => a - b))
        for (const f of findings) expect(text.slice(f.start, f.end)).toBe(f.value)
        expect(counts).toEqual({ email: 2, ipv4: 1 })
    })
    it('lets higher-priority types win overlapping text', () => {
        // a GitHub token assigned to a "token" variable is reported once, as a token (higher priority than a generic secret)
        const { findings } = scanText(`token = "ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"`)
        expect(findings).toHaveLength(1)
        expect(findings[0].type).toBe('token')
        // a JWT inside a Bearer header is a JWT, not a generic token
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'
        expect(scanText(`Bearer ${jwt}`).findings.map(f => f.type)).toEqual(['jwt'])
    })
    it('has consistent type metadata', () => {
        expect(PII_TYPES.map(t => t.id)).toEqual(Object.keys(PII_TYPE_MAP))
        expect(PII_TYPE_MAP.privateKey.priority).toBe(0)
        expect(PII_TYPE_MAP.email.severity).toBe('medium')
    })
})

describe('redactText', () => {
    const text = 'Mail a@example.com or call +44 20 7946 0958 from 203.0.113.7.'
    const { findings } = scanText(text)
    it('replaces findings with labels', () => {
        expect(redactText(text, findings)).toBe('Mail [EMAIL] or call [PHONE] from [IP].')
    })
    it('masks with asterisks of equal length, keeping spaces', () => {
        const masked = redactText(text, findings, { style: 'mask' })
        expect(masked).toBe('Mail ************* or call *** ** **** **** from ***********.')
        expect(masked).toHaveLength(text.length)
    })
    it('only redacts selected types', () => {
        expect(redactText(text, findings, { types: new Set(['email']) })).toBe('Mail [EMAIL] or call +44 20 7946 0958 from 203.0.113.7.')
        expect(redactText(text, findings, { types: new Set() })).toBe(text)
    })
    it('returns the text unchanged without findings', () => {
        expect(redactText('plain', [])).toBe('plain')
    })
    it('re-scanning redacted text finds nothing', () => {
        expect(scanText(redactText(text, findings)).findings).toEqual([])
    })
})

describe('shortenValue', () => {
    it('collapses whitespace and elides long values', () => {
        expect(shortenValue('  a \n b  ')).toBe('a b')
        const long = 'x'.repeat(100)
        expect(shortenValue(long)).toBe(`${'x'.repeat(48)}…${'x'.repeat(8)}`)
        expect(shortenValue(long, 20)).toHaveLength(8 + 1 + 8)
        expect(shortenValue('short')).toBe('short')
    })
})
