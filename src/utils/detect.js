import cronstrue from 'cronstrue'
import { parseHexText } from './hexdump'

/**
 * Content detection shared by Smart Paste, the command palette and the
 * Universal Inspector.
 *
 * detectFormats(text) returns every match, best first:
 *   { id, label, tool, mode?, confidence (0-1), detail? }
 * analyzeContent(text) returns the best match worth suggesting, or null.
 *
 * `tool` is where the content can be opened (with smart input); `mode` tells
 * that tool how to treat it (e.g. Base64 "decode", Formatters "sql").
 */

const MIN_SUGGEST_CONFIDENCE = 0.6

// Plausible timestamp range: 2000-01-01 .. 2100-01-01
const SEC_MIN = 946684800
const SEC_MAX = 4102444800

function decodeBase64ToBytes(str) {
    let s = str.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    if (s.length % 4 === 1) return null
    while (s.length % 4) s += '='
    try {
        const bin = atob(s)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return bytes
    } catch {
        return null
    }
}

function utf8OrNull(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return null
    }
}

function isMostlyPrintable(text) {
    if (!text) return false
    let printable = 0
    for (const ch of text) {
        const code = ch.codePointAt(0)
        if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) printable++
    }
    return printable / [...text].length > 0.95
}

function parseJwtPart(part) {
    const bytes = decodeBase64ToBytes(part)
    if (!bytes) return null
    const text = utf8OrNull(bytes)
    if (!text) return null
    try {
        const value = JSON.parse(text)
        return value && typeof value === 'object' ? value : null
    } catch {
        return null
    }
}

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`)

function isIPv4(s) {
    return IPV4_RE.test(s)
}

function isIPv6(s) {
    if (!s.includes(':') || !/^[0-9a-fA-F:.]+$/.test(s)) return false
    const parts = s.split('::')
    if (parts.length > 2) return false
    const groups = parts.flatMap(p => (p ? p.split(':') : []))
    let embeddedV4 = false
    if (groups.length && groups[groups.length - 1].includes('.')) {
        if (!isIPv4(groups[groups.length - 1])) return false
        embeddedV4 = true
        groups.pop()
    }
    if (!groups.every(g => /^[0-9a-fA-F]{1,4}$/.test(g))) return false
    const count = groups.length + (embeddedV4 ? 2 : 0)
    return parts.length === 2 ? count < 8 : count === 8
}

const CRON_TOKEN = /^(\*|\?|L|W|#|[0-9A-Za-z]+([-,/#][0-9A-Za-z*]+)*|\*\/\d+)$/
const CRON_MACROS = /^@(yearly|annually|monthly|weekly|daily|midnight|hourly)$/i

function looksLikeCron(s) {
    if (CRON_MACROS.test(s)) return true
    const fields = s.split(/\s+/)
    if (fields.length < 5 || fields.length > 7) return false
    if (!fields.every(f => CRON_TOKEN.test(f))) return false
    // Needs at least one digit or wildcard in the first fields: plain words aren't cron
    if (!fields.slice(0, 5).every(f => /[\d*?]/.test(f) || /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT)/i.test(f))) return false
    try {
        cronstrue.toString(s, { throwExceptionOnParseError: true })
        return true
    } catch {
        return false
    }
}

function looksLikeYaml(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'))
    if (lines.length < 2) return false
    const keyLines = lines.filter(l => /^\s*(- )?[A-Za-z_][\w .-]*:(\s|$)/.test(l))
    const listLines = lines.filter(l => /^\s*- \S/.test(l) && !keyLines.includes(l))
    return keyLines.length > 0 && (keyLines.length + listLines.length) / lines.length > 0.7 && !/^[[{]/.test(text.trim())
}

function looksLikeMarkdown(text) {
    const lines = text.split(/\r?\n/)
    if (lines.length < 2) return false
    let signals = 0
    if (lines.some(l => /^#{1,6}\s+\S/.test(l))) signals++
    if (lines.some(l => /^\s*([-*+]|\d+\.)\s+\S/.test(l))) signals++
    if (/\[[^\]]+\]\([^)]+\)/.test(text)) signals++
    if (/```/.test(text)) signals++
    if (/(\*\*|__)[^*_]+(\*\*|__)/.test(text)) signals++
    return signals >= 2
}

// PEM blocks (certificates, keys, CSRs) the Certificate & Key Inspector reads
const PEM_BLOCK = /-----BEGIN ([A-Z0-9 .#]+)-----\r?\n[\s\S]*?-----END \1-----/g
const PEM_LABELS = [
    [/^(X509 |X\.509 |TRUSTED )?CERTIFICATE$/, 'Certificate', 'Certificates'],
    [/^(NEW )?CERTIFICATE REQUEST$/, 'Certificate signing request', 'Certificate signing requests'],
    [/^(RSA )?PUBLIC KEY$/, 'Public key', 'Public keys'],
    [/^(RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY$/, 'Private key', 'Private keys'],
    [/^(PKCS7|PKCS #7 SIGNED DATA|CMS)$/, 'PKCS #7 certificate bundle', 'PKCS #7 certificate bundles'],
    [/^EC PARAMETERS$/, 'EC parameters', 'EC parameters'],
]
// Lines that may come before the first block: comments in CA bundles, and the
// attribute lines `openssl pkcs12` and `openssl x509 -text` print
const PEM_PREAMBLE_LINE = /^(#|Bag Attributes|Key Attributes|subject=|issuer=|\s)/

function detectPem(text) {
    const start = text.indexOf('-----BEGIN ')
    if (start === -1) return null
    const before = text.slice(0, start)
    if (before.trim() && !before.split(/\r?\n/).every(l => !l.trim() || PEM_PREAMBLE_LINE.test(l))) return null
    const types = [...text.matchAll(PEM_BLOCK)].map(m => m[1])
    if (!types.length) return null
    const known = types.map(type => PEM_LABELS.find(([pattern]) => pattern.test(type))).filter(Boolean)
    if (known.length !== types.length) return null
    const [, one, many] = known[0]
    const same = known.every(k => k === known[0])
    const label = types.length === 1 ? `${one} (PEM)` : same ? `${many} (${types.length}, PEM)` : `${types.length} PEM blocks`
    return { label, detail: types.length > 1 ? `${types.length} blocks` : undefined }
}

// TOML: [tables] and key = value lines whose values are TOML values
const TOML_HEADER = /^\[{1,2}\s*[A-Za-z0-9_"'.\- ]+\s*\]{1,2}$/
const TOML_KEY_VALUE = /^[A-Za-z0-9_"'.\- ]+?\s*=\s*(".*"|'.*'|"""|'''|[+-]?(\d[\d_]*(\.\d+)?([eE][+-]?\d+)?|0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|inf|nan)|true|false|\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}(:\d{2})?|\[.*|\{.*\})\s*(#.*)?$/

function looksLikeToml(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    if (lines.length < 2) return false
    let headers = 0
    let pairs = 0
    let other = 0
    let depth = 0 // open brackets of a multi-line array
    // Brackets outside quoted strings
    const balance = (line) => {
        const bare = line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '')
        return (bare.match(/\[/g) || []).length - (bare.match(/\]/g) || []).length
    }
    for (const line of lines) {
        if (depth > 0) {
            // Items of a multi-line array, up to its closing bracket
            depth = Math.max(0, depth + balance(line))
            continue
        }
        if (TOML_HEADER.test(line)) headers++
        else if (TOML_KEY_VALUE.test(line)) {
            pairs++
            depth = Math.max(0, balance(line.slice(line.indexOf('=') + 1)))
        } else other++
    }
    return pairs >= 1 && (headers >= 1 || pairs >= 2) && other / lines.length <= 0.2
}

// Splits one CSV line, honouring double quotes ("a,b" is one field)
function csvFields(line, delimiter) {
    const fields = []
    let field = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { field += '"'; i++ }
            else if (ch === '"') quoted = false
            else field += ch
        } else if (ch === '"' && field === '') quoted = true
        else if (ch === delimiter) { fields.push(field); field = '' }
        else field += ch
    }
    if (quoted) return null
    fields.push(field)
    return fields
}

// CSV/TSV: every line has the same number of fields (at least two), with
// enough rows that it isn't a sentence with a comma
function detectCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2 || lines.some(l => /^\s*\|.*\|\s*$/.test(l))) return null
    const sample = lines.slice(0, 50)
    for (const delimiter of ['\t', ',', ';']) {
        if (!sample[0].includes(delimiter)) continue
        const counts = sample.map(l => csvFields(l, delimiter)?.length ?? -1)
        const columns = counts[0]
        if (columns < 2 || counts.some(c => c !== columns)) continue
        if (lines.length < 3 && columns < 3) continue
        const header = csvFields(sample[0], delimiter)
        if (header.some(h => !h.trim() || h.length > 60)) continue
        return { delimiter, columns, rows: lines.length - 1 }
    }
    return null
}

function looksLikeXml(text) {
    if (!/^<(\?xml|[A-Za-z_][\w:.-]*)[\s\S]*>$/.test(text)) return false
    if (typeof DOMParser === 'undefined') return /<\/[A-Za-z_][\w:.-]*>\s*$|\/>\s*$/.test(text)
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    return doc.getElementsByTagName('parsererror').length === 0
}

export function detectFormats(raw) {
    if (typeof raw !== 'string') return []
    const text = raw.trim()
    if (!text) return []
    const out = []
    const add = (candidate) => out.push(candidate)
    const singleLine = !/[\r\n]/.test(text)
    const compact = text.replace(/\s+/g, '')

    // cURL command
    if (/^curl(\.exe)?\s/i.test(text)) {
        add({ id: 'curl', label: 'cURL command', tool: '/curl', confidence: 0.98 })
    }

    // PEM certificates, CSRs and keys
    const pem = detectPem(text)
    if (pem) add({ id: 'pem', label: pem.label, tool: '/certificate', confidence: 0.98, detail: pem.detail })

    // JSON Web Token (signature may be empty for unsecured tokens)
    if (singleLine && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(text)) {
        const [h, p] = text.split('.')
        const header = parseJwtPart(h)
        if (header && (header.alg !== undefined || header.typ !== undefined) && parseJwtPart(p)) {
            add({ id: 'jwt', label: 'JSON Web Token', tool: '/jwt', confidence: 0.99, detail: typeof header.alg === 'string' ? header.alg : undefined })
        }
    }

    // URL
    if (singleLine && /^(https?|wss?|ftp):\/\/\S+$/i.test(text)) {
        try {
            new URL(text)
            add({ id: 'url', label: 'URL', tool: '/url', confidence: 0.9 })
        } catch {
            // not a URL
        }
    }

    // Image data URI
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(text) || /^data:image\/svg\+xml(;charset=[\w-]+)?,/i.test(text)) {
        add({ id: 'data-uri', label: 'Image data URI', tool: '/image-base64', mode: 'decode', confidence: 0.95 })
    }

    // SVG
    const isSvg = /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)
    if (isSvg) add({ id: 'svg', label: 'SVG image', tool: '/svg', confidence: 0.95 })

    // JSON (objects and arrays only: a bare number or string isn't worth formatting)
    if (/^[[{]/.test(text)) {
        try {
            const value = JSON.parse(text)
            if (value && typeof value === 'object') add({ id: 'json', label: 'JSON', tool: '/formatters', mode: 'json', confidence: 0.95 })
            // A HAR file (browser network recording) is JSON with log.entries
            if (value && typeof value.log === 'object' && Array.isArray(value.log?.entries)) {
                add({ id: 'har', label: 'HAR (network recording)', tool: '/har', confidence: 0.97, detail: `${value.log.entries.length} requests` })
            }
        } catch {
            // invalid JSON
        }
    }

    // XML (other than SVG)
    if (!isSvg && looksLikeXml(text)) {
        add({ id: 'xml', label: 'XML', tool: '/formatters', mode: 'xml', confidence: 0.85 })
    }

    // HTML document
    if (/^(<!--[\s\S]*?-->\s*)*(<!doctype html\b|<html[\s>])/i.test(text)) {
        add({ id: 'html', label: 'HTML document', tool: '/formatters', mode: 'html', confidence: 0.9 })
    }

    // GraphQL operation or fragment
    if (/^(query|mutation|subscription)\b[^{}]*\{[\s\S]*\}$|^fragment\s+\w+\s+on\s+\w+\s*\{[\s\S]*\}$/.test(text)) {
        add({ id: 'graphql', label: 'GraphQL', tool: '/formatters', mode: 'graphql', confidence: 0.85 })
    }

    // UUID / GUID (any version, plus the nil and max UUIDs)
    if (singleLine && /^[{]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[}]?$/i.test(text)) {
        const version = text.replace(/[{}]/g, '')[14]
        add({ id: 'uuid', label: 'UUID', tool: '/inspect', confidence: 0.9, detail: `v${version}` })
    }

    // IP address / CIDR block
    if (singleLine) {
        const [addr, prefix, extra] = text.split('/')
        const prefixOk = (max) => prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= max)
        if (extra === undefined && isIPv4(addr) && prefixOk(32)) {
            add({ id: 'ipv4', label: prefix === undefined ? 'IPv4 address' : 'IPv4 CIDR block', tool: '/cidr', confidence: 0.92 })
        } else if (extra === undefined && isIPv6(addr) && prefixOk(128)) {
            add({ id: 'ipv6', label: prefix === undefined ? 'IPv6 address' : 'IPv6 CIDR block', tool: '/cidr', confidence: 0.9 })
        }
    }

    // Unix timestamp (seconds, milliseconds, microseconds, nanoseconds)
    if (/^\d{9,19}$/.test(text)) {
        const n = Number(text)
        const len = text.length
        const unit = len <= 10 ? 's' : len <= 13 ? 'ms' : len <= 16 ? 'µs' : 'ns'
        const seconds = unit === 's' ? n : unit === 'ms' ? n / 1e3 : unit === 'µs' ? n / 1e6 : n / 1e9
        if (seconds >= SEC_MIN && seconds < SEC_MAX && [9, 10, 13, 16, 19].includes(len)) {
            add({ id: 'timestamp', label: `Unix timestamp (${unit})`, tool: '/unix', confidence: len === 9 ? 0.6 : 0.92 })
        }
    }

    // Colour
    if (singleLine && (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) || /^(rgb|hsl|hwb)a?\([^)]*\)$/i.test(text))) {
        add({ id: 'color', label: 'Colour', tool: '/color', confidence: 0.9 })
    }

    // Hash digests (hex)
    if (singleLine && /^[0-9a-f]+$/i.test(text)) {
        const names = { 32: 'MD5', 40: 'SHA-1', 56: 'SHA-224', 64: 'SHA-256', 96: 'SHA-384', 128: 'SHA-512' }
        if (names[text.length] && /[a-f]/i.test(text) && /\d/.test(text)) {
            add({ id: 'hash', label: `${names[text.length]} hash`, tool: '/inspect', confidence: 0.75 })
        }
    }

    // Hex dumps (xxd, hexdump -C) and hex bytes with separators ("de ad be ef")
    const hex = !out.length ? parseHexText(text) : null
    if (hex && (hex.format === 'xxd' || hex.format === 'hexdump')) {
        add({ id: 'hex', label: 'Hex dump', tool: '/hex', confidence: 0.9, detail: `${hex.bytes.length} bytes` })
    } else if (hex && hex.format === 'bytes' && hex.bytes.length >= 4 && /[a-f]/i.test(text)) {
        // Six colon-separated bytes are more likely a MAC address
        const mac = hex.bytes.length === 6 && /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(text)
        add({ id: 'hex', label: 'Hex bytes', tool: '/hex', confidence: mac ? 0.5 : 0.7, detail: `${hex.bytes.length} bytes` })
    }

    // Cron expression
    if (singleLine && looksLikeCron(text)) {
        // Five plain numbers are valid cron but more often something else
        const plainNumbers = /^[\d\s]+$/.test(text)
        add({ id: 'cron', label: 'Cron expression', tool: '/cron', confidence: plainNumbers ? 0.5 : 0.9 })
    }

    // User agent
    if (singleLine && (/^Mozilla\/\d/.test(text) || /^[\w.-]+\/[\d.]+ \(.*(Windows NT|Macintosh|Linux|Android|iPhone|iPad)/.test(text))) {
        if (!out.some(c => c.id === 'curl')) add({ id: 'user-agent', label: 'User agent', tool: '/ua', confidence: 0.85 })
    }

    // SQL
    if (/^(select|insert\s+into|update|delete\s+from|create\s+(table|index|view|or)|alter\s+table|drop\s+(table|index|view)|with\s+\w+\s+as)\b/i.test(text)) {
        add({ id: 'sql', label: 'SQL', tool: '/formatters', mode: 'sql', confidence: 0.85 })
    }

    // Base64 (strict: must decode cleanly and not look like a plain word/number/hash)
    if (
        compact.length >= 12 &&
        /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact) &&
        !/^\d+$/.test(compact) &&
        !/^[0-9a-f]+$/i.test(compact) &&
        !out.some(c => ['jwt', 'timestamp', 'hash', 'uuid', 'pem', 'hex'].includes(c.id))
    ) {
        const hasMixedCase = /[a-z]/.test(compact) && /[A-Z]/.test(compact)
        const padded = /=$/.test(compact) || compact.length % 4 === 0
        const bytes = decodeBase64ToBytes(compact)
        if (bytes && bytes.length > 0 && (padded || hasMixedCase)) {
            const decoded = utf8OrNull(bytes)
            const urlSafe = /[-_]/.test(compact)
            if (decoded && /^[[{]/.test(decoded.trim())) {
                add({ id: 'base64', label: 'Base64 (JSON inside)', tool: '/base64', mode: 'decode', confidence: 0.92, detail: urlSafe ? 'url-safe' : undefined })
            } else if (decoded && isMostlyPrintable(decoded) && padded && hasMixedCase) {
                add({ id: 'base64', label: 'Base64 text', tool: '/base64', mode: 'decode', confidence: 0.8, detail: urlSafe ? 'url-safe' : undefined })
            } else if (padded && hasMixedCase && compact.length >= 24) {
                add({ id: 'base64', label: 'Base64 (binary data)', tool: '/base64', mode: 'decode', confidence: 0.55, detail: urlSafe ? 'url-safe' : undefined })
            }
        }
    }

    const markdownLike = looksLikeMarkdown(text)

    // YAML
    if (!out.some(c => c.id === 'json') && !markdownLike && looksLikeYaml(text)) {
        add({ id: 'yaml', label: 'YAML', tool: '/converter', mode: 'yaml', confidence: 0.65 })
    }

    // Markdown
    if (markdownLike) {
        add({ id: 'markdown', label: 'Markdown', tool: '/markdown', confidence: 0.6 })
    }

    const structured = out.some(c => ['json', 'xml', 'svg', 'pem', 'curl', 'sql', 'yaml'].includes(c.id))

    // TOML
    if (!structured && !singleLine && looksLikeToml(text)) {
        add({ id: 'toml', label: 'TOML', tool: '/converter', mode: 'toml', confidence: /^\s*\[/m.test(text) ? 0.8 : 0.7 })
    }

    // CSV / TSV
    const csv = !structured && !singleLine && !markdownLike ? detectCsv(text) : null
    if (csv) {
        add({
            id: 'csv',
            label: csv.delimiter === '\t' ? 'Tab-separated values' : 'CSV',
            tool: '/csv-json',
            confidence: csv.delimiter === '\t' ? 0.75 : 0.7,
            detail: `${csv.columns} columns, ${csv.rows} rows`,
        })
    }

    // Email address
    if (singleLine && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(text)) {
        add({ id: 'email', label: 'Email address', tool: '/inspect', confidence: 0.5 })
    }

    return out.sort((a, b) => b.confidence - a.confidence)
}

export function analyzeContent(text) {
    const [best] = detectFormats(text)
    return best && best.confidence >= MIN_SUGGEST_CONFIDENCE ? best : null
}
