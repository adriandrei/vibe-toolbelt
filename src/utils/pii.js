// Detection and redaction of personal data and secrets in text.
// Pure functions with no DOM access, so they also run in a Web Worker
// (src/workers/pii.worker.js).
//
//   const { findings, counts } = scanText(text)
//   const safe = redactText(text, findings)
//
// Every detector is tuned for few false positives: cards must pass Luhn and
// match a card network, IBANs need the right length and mod-97 checksum,
// JWTs must decode, phone numbers need a recognisable format, and so on.

export const PII_TYPES = [
    { id: 'privateKey', label: 'Private keys', redact: 'PRIVATE KEY', severity: 'high' },
    { id: 'jwt', label: 'JWTs', redact: 'JWT', severity: 'high' },
    { id: 'token', label: 'API tokens', redact: 'TOKEN', severity: 'high' },
    { id: 'aws', label: 'AWS keys', redact: 'AWS KEY', severity: 'high' },
    { id: 'secret', label: 'Passwords & secrets', redact: 'SECRET', severity: 'high' },
    { id: 'card', label: 'Card numbers', redact: 'CARD', severity: 'high' },
    { id: 'iban', label: 'IBANs', redact: 'IBAN', severity: 'high' },
    { id: 'ssn', label: 'US SSNs', redact: 'SSN', severity: 'high' },
    { id: 'email', label: 'Emails', redact: 'EMAIL', severity: 'medium' },
    { id: 'phone', label: 'Phone numbers', redact: 'PHONE', severity: 'medium' },
    { id: 'ipv4', label: 'IPv4 addresses', redact: 'IP', severity: 'low' },
    { id: 'ipv6', label: 'IPv6 addresses', redact: 'IP', severity: 'low' },
    { id: 'entropy', label: 'High-entropy strings', redact: 'SECRET', severity: 'medium' },
]

export const PII_TYPE_MAP = Object.fromEntries(PII_TYPES.map((t, i) => [t.id, { ...t, priority: i }]))

// Enough for any realistic paste; beyond this the redacted copy is refused
// rather than silently incomplete (see `truncated`).
const MAX_FINDINGS = 200_000

// ---------------------------------------------------------------------------
// Validators

export function luhnValid(digits) {
    let sum = 0
    let double = false
    for (let i = digits.length - 1; i >= 0; i--) {
        let d = digits.charCodeAt(i) - 48
        if (d < 0 || d > 9) return false
        if (double) {
            d *= 2
            if (d > 9) d -= 9
        }
        sum += d
        double = !double
    }
    return sum % 10 === 0
}

function cardNetwork(d) {
    const n2 = Number(d.slice(0, 2))
    const n3 = Number(d.slice(0, 3))
    const n4 = Number(d.slice(0, 4))
    const n6 = Number(d.slice(0, 6))
    const len = d.length
    if (d[0] === '4' && [13, 16, 19].includes(len)) return 'Visa'
    if (((n2 >= 51 && n2 <= 55) || (n4 >= 2221 && n4 <= 2720)) && len === 16) return 'Mastercard'
    if ((n2 === 34 || n2 === 37) && len === 15) return 'American Express'
    if ((n4 === 6011 || n2 === 65 || (n3 >= 644 && n3 <= 649) || (n6 >= 622126 && n6 <= 622925)) && len >= 16 && len <= 19) return 'Discover'
    if (n4 >= 3528 && n4 <= 3589 && len >= 16 && len <= 19) return 'JCB'
    if (((n3 >= 300 && n3 <= 305) || n2 === 36 || n2 === 38 || n2 === 39) && len >= 14 && len <= 19) return 'Diners Club'
    if (n2 === 62 && len >= 16 && len <= 19) return 'UnionPay'
    if ((n2 === 50 || (n2 >= 56 && n2 <= 69)) && len >= 12 && len <= 19) return 'Maestro'
    return null
}

const IBAN_LENGTHS = {
    AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28,
    CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18,
    FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22,
    IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
    LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18,
    NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31,
    SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29,
    VA: 22, VG: 24, XK: 20, YE: 30,
}

export function ibanValid(iban) {
    const s = iban.replace(/\s+/g, '').toUpperCase()
    if (IBAN_LENGTHS[s.slice(0, 2)] !== s.length || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false
    const rearranged = s.slice(4) + s.slice(0, 4)
    let remainder = 0
    for (const ch of rearranged) {
        const code = ch.charCodeAt(0)
        const value = code >= 65 ? String(code - 55) : ch
        for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97
    }
    return remainder === 1
}

export function shannonEntropy(s) {
    if (!s) return 0
    const freq = new Map()
    for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1)
    let e = 0
    for (const n of freq.values()) {
        const p = n / s.length
        e -= p * Math.log2(p)
    }
    return e
}

function base64UrlJson(part) {
    try {
        let s = part.replace(/-/g, '+').replace(/_/g, '/')
        while (s.length % 4) s += '='
        const binary = atob(s)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        return value && typeof value === 'object' ? value : null
    } catch {
        return null
    }
}

function isValidIPv6(s) {
    const addr = s.split('%')[0]
    const halves = addr.split('::')
    if (halves.length > 2) return false
    const parts = (h) => (h === '' ? [] : h.split(':'))
    const head = parts(halves[0])
    const tail = halves.length === 2 ? parts(halves[1]) : []
    const groups = [...head, ...tail]
    if (!groups.every(g => /^[0-9a-f]{1,4}$/i.test(g))) return false
    return halves.length === 1 ? groups.length === 8 : groups.length <= 7
}

// ---------------------------------------------------------------------------
// Detectors. Each pushes { type, start, end, value, detail? } into `out`.

const EMAIL_RE = /(?<![\w.%+-])[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+([A-Za-z]{2,24})(?![\w-])/g
const FILE_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'map', 'html', 'htm', 'vue', 'lock', 'wasm'])

function detectEmails(text, out) {
    for (const m of text.matchAll(EMAIL_RE)) {
        if (FILE_TLDS.has(m[1].toLowerCase())) continue // icon@2x.png
        const local = m[0].slice(0, m[0].indexOf('@'))
        if (local === 'git' && text[m.index + m[0].length] === ':') continue // git@github.com:org/repo
        if (/^(?:no-?reply|do-?not-?reply|mailer-daemon|postmaster)$/i.test(local)) continue
        out.push({ type: 'email', start: m.index, end: m.index + m[0].length, value: m[0] })
    }
}

// +44 20 7946 0958, +1 (555) 010-0199, +40721234567
const PHONE_INTL_RE = /(?<![\w+])\+(?=\d)[\d \t().-]{7,24}\d(?![\w-]|\.\d)/g
// (555) 010-0199, 555-010-0199, 555.010.0199
const PHONE_NANP_RE = /(?<![\w+.-])(?:\(\s?[2-9]\d{2}\s?\)\s?|[2-9]\d{2}[ .-]?)[2-9]\d{2}[ .-]\d{4}(?![\w-]|\.\d)/g
// National numbers with a trunk 0: 020 7946 0958, 07700 900123, 01 23 45 67 89
const PHONE_TRUNK_RE = /(?<![\w+.-])0\d{1,4}(?:[ .-]\d{2,8}){1,4}(?![\w-]|\.\d)/g

function phoneShapeOk(value) {
    if (/[ .-]{2,}|\(\s*\)|\)\s*\(/.test(value)) return false // doubled separators
    const open = (value.match(/\(/g) || []).length
    const close = (value.match(/\)/g) || []).length
    if (open !== close || open > 1) return false
    const seps = value.match(/[.]/g) || []
    if (seps.length && /\s/.test(value)) return false // mixing dots and spaces looks like prose
    return true
}

function detectPhones(text, out) {
    for (const m of text.matchAll(PHONE_INTL_RE)) {
        const value = m[0].replace(/[\s.-]+$/, '')
        const digits = value.replace(/\D/g, '')
        if (digits.length < 8 || digits.length > 15 || !phoneShapeOk(value)) continue
        out.push({ type: 'phone', start: m.index, end: m.index + value.length, value })
    }
    for (const m of text.matchAll(PHONE_NANP_RE)) {
        if (!phoneShapeOk(m[0])) continue
        out.push({ type: 'phone', start: m.index, end: m.index + m[0].length, value: m[0] })
    }
    for (const m of text.matchAll(PHONE_TRUNK_RE)) {
        const digits = m[0].replace(/\D/g, '')
        if (digits.length < 10 || digits.length > 12 || !phoneShapeOk(m[0])) continue
        if (/^\d{4}-\d{2}-\d{2}$/.test(m[0])) continue // ISO date
        out.push({ type: 'phone', start: m.index, end: m.index + m[0].length, value: m[0] })
    }
}

const CARD_RE = /(?<![\w-])\d(?:[ -]?\d){11,18}(?![\w-])/g

function detectCards(text, out) {
    for (const m of text.matchAll(CARD_RE)) {
        const value = m[0]
        const separators = new Set(value.match(/[ -]/g) || [])
        if (separators.size > 1) continue
        const digits = value.replace(/\D/g, '')
        if (/^(\d)\1+$/.test(digits) || !luhnValid(digits)) continue
        const network = cardNetwork(digits)
        if (!network) continue
        if (separators.size === 1) {
            // Grouped numbers must look like card groups (4-4-4-4, 4-6-5, …)
            const groups = value.split(/[ -]/).map(g => g.length)
            if (groups.some(g => g < 3 || g > 6)) continue
        }
        out.push({ type: 'card', start: m.index, end: m.index + value.length, value, detail: network })
    }
}

const IBAN_RE = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/g

function detectIbans(text, out) {
    for (const m of text.matchAll(IBAN_RE)) {
        const expected = IBAN_LENGTHS[m[0].slice(0, 2)]
        if (!expected) continue
        // Take exactly `expected` characters (spaces don't count)
        let count = 0
        let end = 0
        for (let i = 0; i < m[0].length && count < expected; i++) {
            if (m[0][i] !== ' ') count++
            end = i + 1
        }
        if (count !== expected) continue
        const value = m[0].slice(0, end)
        if (!ibanValid(value)) continue
        out.push({ type: 'iban', start: m.index, end: m.index + value.length, value, detail: value.slice(0, 2) })
    }
}

const SSN_RE = /(?<![\w-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\w-])/g

function detectSsns(text, out) {
    for (const m of text.matchAll(SSN_RE)) {
        out.push({ type: 'ssn', start: m.index, end: m.index + m[0].length, value: m[0] })
    }
}

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4_RE = new RegExp(`(?<![\\w.-])${OCTET}(?:\\.${OCTET}){3}(?![\\w-]|\\.\\d)`, 'g')

function detectIPv4(text, out) {
    for (const m of text.matchAll(IPV4_RE)) {
        const octets = m[0].split('.').map(Number)
        if (octets.every(o => o < 10)) continue // 1.2.3.4 is usually a version
        if (octets[0] === 0 || octets[0] === 127 || octets.every(o => o === 255)) continue // unspecified, loopback, broadcast
        const before = text.slice(Math.max(0, m.index - 40), m.index)
        if (/[A-Za-z][\w.-]*\/$/.test(before)) continue // Chrome/120.0.0.0
        if (/\bv(?:ersion)?\s*$/i.test(before)) continue
        if (/(?:\b(?:see|sections?|sec|chapter|clause|table|figure|fig|item|step|rule|part|annex|appendix)\.?|§)\s*$/i.test(before)) continue // "see 12.7.5.3"
        const [a, b] = octets
        const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
        out.push({ type: 'ipv4', start: m.index, end: m.index + m[0].length, value: m[0], detail: isPrivate ? 'private network' : undefined })
    }
}

const IPV6_RE = /(?<![\w:.%])(?=[0-9A-Fa-f:]*:[0-9A-Fa-f:]*:)[0-9A-Fa-f:]{3,39}(?:%[\w.-]+)?(?![\w:])/g

function detectIPv6(text, out) {
    for (const m of text.matchAll(IPV6_RE)) {
        const value = m[0]
        if (!isValidIPv6(value)) continue
        const groups = value.split('%')[0].split(':').filter(Boolean)
        if (groups.length < 3) continue // "::1", "fe80::1", "a::b"
        if (!groups.some(g => g.length >= 3)) continue // times like 12:30:45 never pass, but be safe
        out.push({ type: 'ipv6', start: m.index, end: m.index + value.length, value })
    }
}

const JWT_RE = /(?<![\w-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*(?![\w-])/g

function detectJwts(text, out) {
    for (const m of text.matchAll(JWT_RE)) {
        const [header] = m[0].split('.')
        const decoded = base64UrlJson(header)
        if (!decoded || (decoded.alg === undefined && decoded.typ === undefined)) continue
        out.push({ type: 'jwt', start: m.index, end: m.index + m[0].length, value: m[0], detail: typeof decoded.alg === 'string' ? decoded.alg : undefined })
    }
}

const AWS_RE = /(?<![A-Z0-9])(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Z0-9])/g

function detectAws(text, out) {
    for (const m of text.matchAll(AWS_RE)) {
        out.push({ type: 'aws', start: m.index, end: m.index + m[0].length, value: m[0], detail: m[0].startsWith('ASIA') ? 'temporary key' : 'access key ID' })
    }
}

const TOKEN_PATTERNS = [
    { re: /(?<![\w-])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}(?![\w-])/g, detail: 'GitHub token' },
    { re: /(?<![\w-])github_pat_[A-Za-z0-9_]{40,255}(?![\w-])/g, detail: 'GitHub fine-grained token' },
    { re: /(?<![\w-])glpat-[A-Za-z0-9_-]{20,}(?![\w-])/g, detail: 'GitLab token' },
    { re: /(?<![\w-])xox[abposre]-[A-Za-z0-9-]{10,250}(?![\w-])/g, detail: 'Slack token' },
    { re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]{20,}/g, detail: 'Slack webhook' },
    { re: /(?<![\w-])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,247}(?![\w-])/g, detail: 'Stripe key' },
    { re: /(?<![\w-])whsec_[A-Za-z0-9]{24,}(?![\w-])/g, detail: 'Stripe webhook secret' },
    { re: /(?<![\w-])AIza[0-9A-Za-z_-]{35}(?![\w-])/g, detail: 'Google API key' },
    { re: /(?<![\w-])sk-ant-[A-Za-z0-9_-]{32,}(?![\w-])/g, detail: 'Anthropic API key' },
    { re: /(?<![\w-])sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}(?![\w-])/g, detail: 'OpenAI-style API key', check: (v) => /\d/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v) && !v.startsWith('sk-ant-') },
    { re: /(?<![\w-])npm_[A-Za-z0-9]{36}(?![\w-])/g, detail: 'npm token' },
    { re: /(?<![\w-])SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![\w-])/g, detail: 'SendGrid key' },
]

const BEARER_RE = /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g

function detectTokens(text, out) {
    for (const { re, detail, check } of TOKEN_PATTERNS) {
        for (const m of text.matchAll(re)) {
            if (check && !check(m[0])) continue
            out.push({ type: 'token', start: m.index, end: m.index + m[0].length, value: m[0], detail })
        }
    }
    for (const m of text.matchAll(BEARER_RE)) {
        const start = m.index + m[0].length - m[1].length
        out.push({ type: 'token', start, end: start + m[1].length, value: m[1], detail: 'Bearer token' })
    }
}

const KEY_BEGIN_RE = /-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY( BLOCK)?-----/g

function detectPrivateKeys(text, out) {
    for (const m of text.matchAll(KEY_BEGIN_RE)) {
        const headerEnd = m.index + m[0].length
        const endMarker = `-----END ${m[1]}PRIVATE KEY${m[2] || ''}-----`
        const endAt = text.indexOf(endMarker, headerEnd)
        let end = -1
        if (endAt !== -1 && endAt - m.index < 40000 && /^[\sA-Za-z0-9+/=:,-]*$/.test(text.slice(headerEnd, endAt))) {
            end = endAt + endMarker.length
        } else {
            // No (clean) END line: take the base64 lines that follow the header
            const body = /^(?:[ \t]*\r?\n[ \t]*[A-Za-z0-9+/=:,-]+)+/.exec(text.slice(headerEnd, headerEnd + 20000))
            if (body && /[A-Za-z0-9+/]{16,}/.test(body[0])) end = headerEnd + body[0].length
        }
        if (end === -1) continue // just the header text, e.g. in code that builds PEM files
        out.push({ type: 'privateKey', start: m.index, end, value: text.slice(m.index, end), detail: `${m[1] ? m[1].trim() : 'PKCS#8'}${m[2] ? ' (PGP)' : ''}`.trim() })
    }
}

// password = "…", API_KEY: …, "client_secret": "…"
const ASSIGN_RE = /(?<![\w.-])([\w.-]{0,40}?(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?key|credentials?|client[_-]?secret)[\w-]{0,20})["']?[ \t]*(?:=>|:=|=|:)[ \t]*(?:"([^"\n]{4,300})"|'([^'\n]{4,300})'|`([^`\n]{4,300})`|([^\s"'`,;)\]}]{4,300}))/gi
const PLACEHOLDER_RE = /^(?:<.*|\$\{.*|\{\{.*|%[a-z(].*|\*+|x{3,}|\.{3,}|•+|null|nil|none|true|false|undefined|empty|changeme|change[_-]?me|password|secret|token|example|redacted|hidden|required|optional|string|number|boolean|any|str|int|text|your[_-].*|my[_-].*|enter[_-].*|<redacted>|\[redacted\]|\[secret\]|\[token\])$/i
const CODE_LIKE_RE = /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(.*|\(.*|process\.env.*|os\.environ.*|\$[A-Za-z_]\w*|ENV\[.*|env\(.*|-----BEGIN .*)$/

function detectSecretAssignments(text, out) {
    for (const m of text.matchAll(ASSIGN_RE)) {
        const key = m[1]
        const quoted = m[2] ?? m[3] ?? m[4]
        const value = quoted ?? m[5]
        if (!value) continue
        const v = value.trim()
        if (PLACEHOLDER_RE.test(v) || CODE_LIKE_RE.test(v)) continue
        if (/^(?:type|name|id|label|field|input|column|placeholder|for|autocomplete|htmlFor|aria[\w-]*)$/i.test(key)) continue
        // Unquoted plain words in code are usually identifiers (password: string),
        // except in UPPER_CASE env files (DB_PASSWORD=hunter)
        const envStyle = /^[A-Z0-9_]+$/.test(key)
        if (quoted === undefined && !envStyle && /^[A-Za-z_]+$/.test(v)) continue
        if (/^\d{1,6}$/.test(v)) continue // timeouts, lengths
        if (/^[\^~<>=*vx\d.\s|-]+$/i.test(v)) continue // version ranges (package.json)
        if (v.startsWith('/')) continue // regexes and paths
        if (v.toLowerCase().replace(/[-_]/g, '') === key.toLowerCase().replace(/[-_]/g, '')) continue // accesskey: 'accessKey'
        const start = m.index + m[0].lastIndexOf(value)
        out.push({ type: 'secret', start, end: start + value.length, value, detail: `value of ${key}` })
    }
    // user:password@host in URLs
    for (const m of text.matchAll(/\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@]{1,64}:([^\s@/]{3,128})@[\w.-]+/gi)) {
        if (PLACEHOLDER_RE.test(m[1])) continue
        const start = m.index + m[0].indexOf(`:${m[1]}@`) + 1
        out.push({ type: 'secret', start, end: start + m[1].length, value: m[1], detail: 'password in URL' })
    }
}

const BLOB_LINE_RE = /^[A-Za-z0-9+/=]{32,}$/

// True when [start, end) is one line of a wrapped base64 block
function isWrappedBlobLine(text, start, end) {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const lineEndRaw = text.indexOf('\n', end)
    const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw
    if (text.slice(lineStart, lineEnd).trim().length !== end - start) return false
    const prevStart = lineStart > 0 ? text.lastIndexOf('\n', lineStart - 2) + 1 : -1
    const prev = prevStart >= 0 ? text.slice(prevStart, lineStart - 1).trim() : ''
    const nextEndRaw = lineEndRaw === -1 ? -1 : text.indexOf('\n', lineEnd + 1)
    const next = lineEndRaw === -1 ? '' : text.slice(lineEnd + 1, nextEndRaw === -1 ? text.length : nextEndRaw).trim()
    return BLOB_LINE_RE.test(prev) || BLOB_LINE_RE.test(next)
}

const ENTROPY_RE = /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/_-]{32,512}={0,2}(?![A-Za-z0-9+/=_-])/g

function detectHighEntropy(text, out) {
    for (const m of text.matchAll(ENTROPY_RE)) {
        const value = m[0]
        const core = value.replace(/=+$/, '')
        if (/^[0-9a-f-]+$/i.test(core)) continue // hashes, UUIDs, commit IDs
        if (/^sha(?:1|256|384|512)-/i.test(core)) continue // subresource integrity hashes
        if (!/[a-z]/.test(core) || !/[A-Z]/.test(core) || !/\d/.test(core)) continue
        const words = core.split(/[/_-]/).filter(part => /^(?:[A-Za-z][a-z]{2,}|[A-Z]{3,})$/.test(part))
        if (words.length >= 3) continue // paths, URLs and slugs
        const before = text.slice(Math.max(0, m.index - 12), m.index)
        if (/base64,$|sha(?:1|256|384|512)-$|data:[^,]*,$/i.test(before)) continue // data URIs, SRI hashes
        if (isWrappedBlobLine(text, m.index, m.index + value.length)) continue // PEM certificates, base64 files
        let steps = 0
        for (let i = 1; i < core.length; i++) if (core.charCodeAt(i) - core.charCodeAt(i - 1) === 1) steps++
        if (steps > core.length / 2) continue // alphabets like 0123…ABC…abc
        if (shannonEntropy(core) < 4.3) continue
        out.push({ type: 'entropy', start: m.index, end: m.index + value.length, value, detail: `${core.length} chars, ${shannonEntropy(core).toFixed(1)} bits/char` })
    }
}

const DETECTORS = [
    detectPrivateKeys, detectJwts, detectTokens, detectAws, detectSecretAssignments,
    detectCards, detectIbans, detectSsns, detectEmails, detectPhones, detectIPv6, detectIPv4,
    detectHighEntropy,
]

// ---------------------------------------------------------------------------
// Scanning

function resolveOverlaps(candidates, textLength) {
    // Higher-priority types win; within a type, longer matches win
    const sorted = [...candidates].sort((a, b) =>
        PII_TYPE_MAP[a.type].priority - PII_TYPE_MAP[b.type].priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start
    )
    const used = new Uint8Array(textLength) // characters already claimed by a kept finding
    const kept = []
    let truncated = false
    outer: for (const c of sorted) {
        for (let i = c.start; i < c.end; i++) if (used[i]) continue outer
        if (kept.length >= MAX_FINDINGS) {
            truncated = true
            break
        }
        used.fill(1, c.start, c.end)
        kept.push(c)
    }
    kept.sort((a, b) => a.start - b.start)
    return { kept, truncated }
}

/**
 * Finds personal data and secrets.
 * Returns { findings: [{ type, start, end, value, detail? }] sorted by position,
 *           counts: { [type]: n }, truncated }.
 */
export function scanText(text) {
    const candidates = []
    if (typeof text !== 'string' || !text) return { findings: [], counts: {}, truncated: false }
    for (const detect of DETECTORS) detect(text, candidates)
    const { kept: findings, truncated } = resolveOverlaps(candidates, text.length)
    const counts = {}
    for (const f of findings) counts[f.type] = (counts[f.type] || 0) + 1
    return { findings, counts, truncated }
}

/**
 * Replaces findings with [LABEL] placeholders (style 'label') or with
 * asterisks of the same length (style 'mask'). Only types in `types`
 * (a Set of ids) are replaced when given.
 */
export function redactText(text, findings, { style = 'label', types } = {}) {
    let out = ''
    let last = 0
    for (const f of findings) {
        if (types && !types.has(f.type)) continue
        if (f.start < last) continue
        out += text.slice(last, f.start)
        out += style === 'mask'
            ? f.value.replace(/[^\s]/g, '*')
            : `[${PII_TYPE_MAP[f.type]?.redact ?? 'REDACTED'}]`
        last = f.end
    }
    return out + text.slice(last)
}

/** A finding's value shortened for lists: whitespace collapsed, long values elided. */
export function shortenValue(value, max = 60) {
    const v = value.replace(/\s+/g, ' ').trim()
    return v.length > max ? `${v.slice(0, max - 12)}…${v.slice(-8)}` : v
}
