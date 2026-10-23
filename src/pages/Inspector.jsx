import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import cronstrue from 'cronstrue'
import {
    AlertCircle, ArrowRight, AtSign, Binary, Braces, Calendar, CalendarClock, Clock, Code, Cpu, Database,
    FileText, Fingerprint, Hash, Image, KeyRound, Link as LinkIcon, Monitor, Network, Palette, ScanSearch,
    Shapes, Sigma, Tag, TerminalSquare, Trash2,
} from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import CopyButton from '../components/ui/CopyButton'
import CodeBlock from '../components/ui/CodeBlock'
import EmptyState from '../components/ui/EmptyState'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineRead } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { detectFormats } from '../utils/detect'
import { openInTool } from '../utils/smartNav'
import { formatXml } from '../utils/xml'
import { contrastRatio, parseColor, toHex, toRgbString } from '../utils/color'
import { charFrequency, countCodePoints, countGraphemes, countLines, getWords, shannonEntropy, utf8ByteLength } from '../utils/textMetrics'
import { formatBytes } from '../utils/download'
import { getTool } from '../config/tools'

const TOOL_NAME = getTool('/inspect')?.title ?? 'Universal Inspector'
const DETECT_LIMIT = 200_000 // characters: format detection runs regexes and parsers
const PREVIEW_LIMIT = 1_000_000 // characters: pretty-printing
const DISPLAY_LIMIT = 100_000 // characters shown in a preview
const HASH_LIMIT = 10_000_000 // characters hashed

const ICONS = {
    curl: TerminalSquare, jwt: KeyRound, url: LinkIcon, 'data-uri': Image, svg: Shapes, json: Braces, xml: Code,
    uuid: Fingerprint, ipv4: Network, ipv6: Network, timestamp: Clock, color: Palette, hash: Hash, cron: CalendarClock,
    'user-agent': Monitor, sql: Database, base64: Binary, yaml: FileText, markdown: FileText, email: AtSign,
    mac: Cpu, semver: Tag, 'iso-date': Calendar, hex: Binary,
}

const SAMPLES = [
    { label: 'JWT', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' },
    { label: 'UUID', value: '018f4d5e-8c3a-7b2e-9f1d-3c5a7e9b1d2f' },
    { label: 'Timestamp', value: '1700000000' },
    { label: 'Base64', value: 'eyJ1c2VyIjoiYWRhIiwicm9sZXMiOlsiYWRtaW4iXX0=' },
    { label: 'JSON', value: '{"id": 42, "tags": ["a", "b"], "active": true}' },
    { label: 'Colour', value: '#7c3aed' },
]

// ---------- Decoding helpers ----------

function base64ToBytes(s) {
    let b = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
    if (!/^[A-Za-z0-9+/]*$/.test(b) || b.length % 4 === 1) return null
    b += '='.repeat((4 - (b.length % 4)) % 4)
    try {
        const bin = atob(b)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return bytes
    } catch {
        return null
    }
}

function utf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return null
    }
}

function isReadable(text) {
    if (!text) return false
    let ok = 0
    let total = 0
    for (const ch of text) {
        total++
        const c = ch.codePointAt(0)
        if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127 && !(c >= 0x80 && c < 0xa0))) ok++
    }
    return ok / total > 0.95
}

function hexDump(bytes, limit = 256) {
    const lines = []
    for (let i = 0; i < Math.min(bytes.length, limit); i += 16) {
        const row = [...bytes.slice(i, Math.min(i + 16, limit))]
        const hex = row.map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ')
        const ascii = row.map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
        lines.push(`${i.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`)
    }
    if (bytes.length > limit) lines.push(`… ${(bytes.length - limit).toLocaleString()} more bytes`)
    return lines.join('\n')
}

const MAGIC = [
    { name: 'PNG image', bytes: [0x89, 0x50, 0x4e, 0x47] },
    { name: 'JPEG image', bytes: [0xff, 0xd8, 0xff] },
    { name: 'GIF image', bytes: [0x47, 0x49, 0x46, 0x38] },
    { name: 'PDF document', bytes: [0x25, 0x50, 0x44, 0x46] },
    { name: 'ZIP archive (also docx, xlsx, jar…)', bytes: [0x50, 0x4b, 0x03, 0x04] },
    { name: 'gzip data', bytes: [0x1f, 0x8b] },
    { name: 'WebAssembly module', bytes: [0x00, 0x61, 0x73, 0x6d] },
    { name: 'ELF executable', bytes: [0x7f, 0x45, 0x4c, 0x46] },
]

function sniff(bytes) {
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'WebP image'
    return MAGIC.find(m => m.bytes.every((b, i) => bytes[i] === b))?.name ?? null
}

function prettyIfJson(text) {
    const t = text.trim()
    if (!/^[[{]/.test(t)) return null
    try {
        const value = JSON.parse(t)
        return value && typeof value === 'object' ? JSON.stringify(value, null, 2) : null
    } catch {
        return null
    }
}

function relativeTime(date) {
    const diff = date.getTime() - Date.now()
    const abs = Math.abs(diff)
    const units = [['year', 31_536_000_000], ['month', 2_592_000_000], ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000], ['second', 1000]]
    const [unit, ms] = units.find(([, size]) => abs >= size) ?? units[units.length - 1]
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(diff / ms), unit)
}

function dateRows(date) {
    return [
        ['UTC (ISO 8601)', date.toISOString()],
        ['Local time', date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })],
        ['Relative', relativeTime(date)],
        ['Unix seconds', String(Math.floor(date.getTime() / 1000))],
        ['Unix milliseconds', String(date.getTime())],
    ]
}

// Same unit rule as the shared detector: 10 digits = s, 13 = ms, 16 = µs, 19 = ns
function timestampRows(digits) {
    const len = digits.length
    const unit = len <= 10 ? 'seconds' : len <= 13 ? 'milliseconds' : len <= 16 ? 'microseconds' : 'nanoseconds'
    const divisor = { seconds: null, milliseconds: 1n, microseconds: 1000n, nanoseconds: 1000000n }[unit]
    const ms = divisor === null ? Number(digits) * 1000 : Number(BigInt(digits) / divisor)
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return null
    return [['Read as', `Unix time in ${unit}`], ...dateRows(date)]
}

const UUID_VERSIONS = {
    1: 'time-based (Gregorian time + node ID)',
    2: 'DCE security',
    3: 'name-based (MD5)',
    4: 'random',
    5: 'name-based (SHA-1)',
    6: 'time-ordered (reordered v1)',
    7: 'time-ordered (Unix milliseconds + random)',
    8: 'custom / vendor-specific',
}

function uuidRows(text) {
    const hex = text.replace(/[{}-]/g, '').toLowerCase()
    if (/^0{32}$/.test(hex)) return [['Kind', 'Nil UUID (all zeros)']]
    if (/^f{32}$/.test(hex)) return [['Kind', 'Max UUID (all ones)']]
    const version = parseInt(hex[12], 16)
    const v = parseInt(hex[16], 16)
    const variant = (v & 0x8) === 0 ? 'NCS (legacy)' : (v & 0xc) === 0x8 ? 'RFC 9562 / RFC 4122' : (v & 0xe) === 0xc ? 'Microsoft (legacy)' : 'reserved'
    const rows = [['Version', `${version}${UUID_VERSIONS[version] ? `: ${UUID_VERSIONS[version]}` : ' (unknown)'}`], ['Variant', variant]]
    let ms = null
    if (version === 7) ms = parseInt(hex.slice(0, 12), 16)
    if (version === 1 || version === 6) {
        const ticks = version === 1
            ? (BigInt(`0x${hex.slice(13, 16)}`) << 48n) | (BigInt(`0x${hex.slice(8, 12)}`) << 32n) | BigInt(`0x${hex.slice(0, 8)}`)
            : (BigInt(`0x${hex.slice(0, 8)}`) << 28n) | (BigInt(`0x${hex.slice(8, 12)}`) << 12n) | BigInt(`0x${hex.slice(13, 16)}`)
        ms = Number(ticks / 10000n) - 12219292800000 // 100 ns ticks since 1582-10-15
    }
    if (ms !== null) {
        const date = new Date(ms)
        if (!Number.isNaN(date.getTime())) rows.push(['Created', `${date.toISOString()} (${relativeTime(date)})`])
    }
    return rows
}

const HASH_GUESSES = {
    32: 'MD5, MD4 or NTLM (128 bits)',
    40: 'SHA-1 or RIPEMD-160 (160 bits)',
    56: 'SHA-224 or SHA3-224 (224 bits)',
    64: 'SHA-256, SHA3-256 or BLAKE2s (256 bits)',
    96: 'SHA-384 or SHA3-384 (384 bits)',
    128: 'SHA-512, SHA3-512 or BLAKE2b (512 bits)',
}

function colorRows(text) {
    const c = parseColor(text)
    if (!c) return null
    const r = c.r / 255
    const g = c.g / 255
    const b = c.b / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    let h = 0
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h = Math.round(h * 60 + 360) % 360
    const hsl = `hsl(${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%${c.a < 1 ? ` / ${c.a}` : ''})`
    const white = contrastRatio(c, { r: 255, g: 255, b: 255 })
    const black = contrastRatio(c, { r: 0, g: 0, b: 0 })
    return {
        color: c,
        rows: [
            ['Hex', toHex(c)],
            ['RGB', toRgbString(c)],
            ['HSL', hsl],
            ['Contrast with white', `${white.toFixed(2)}:1`],
            ['Contrast with black', `${black.toFixed(2)}:1`],
        ],
    }
}

// ---------- Inspector-only detections ----------

const MAC_RE = /^(?:[0-9a-f]{2}([:-])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}|[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})$/i
const SEMVER_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/i
const HEX_RE = /^(?:0x)?(?:[0-9a-f]{2})+$/i
const HEX_SEPARATED_RE = /^[0-9a-f]{2}(?:[\s:,-][0-9a-f]{2})+$/i

function detectExtras(text, formats) {
    const out = []
    if (/[\r\n]/.test(text)) return out
    const ids = new Set(formats.map(f => f.id))

    const mac = text.match(MAC_RE)
    if (mac) {
        const first = parseInt(text.replace(/[^0-9a-f]/gi, '').slice(0, 2), 16)
        out.push({
            id: 'mac',
            label: 'MAC address',
            detail: `${first & 1 ? 'multicast' : 'unicast'}, ${first & 2 ? 'locally administered' : 'globally unique (OUI)'}`,
        })
    }

    const semver = text.match(SEMVER_RE)
    if (semver) {
        const [, major, minor, patch, pre, build] = semver
        out.push({
            id: 'semver',
            label: 'Semantic version',
            detail: `major ${major} · minor ${minor} · patch ${patch}${pre ? ` · pre-release ${pre}` : ''}${build ? ` · build ${build}` : ''}`,
        })
    }

    if (ISO_RE.test(text) && !Number.isNaN(Date.parse(text))) {
        out.push({ id: 'iso-date', label: 'ISO 8601 date', tool: '/unix' })
    }

    // Short padded Base64 ("w7xiZXI=" is "über") is below the shared detector's
    // minimum length; accept it when it decodes to readable UTF-8
    if (!ids.has('base64') && formats.length === 0 && /^[A-Za-z0-9+/_-]{2,10}={1,2}$/.test(text) && text.length % 4 === 0) {
        const bytes = base64ToBytes(text)
        const decoded = bytes && utf8(bytes)
        if (decoded && isReadable(decoded)) out.push({ id: 'base64', label: 'Base64 text', tool: '/base64', mode: 'decode', confidence: 0.6 })
    }

    const compactHex = text.replace(/^0x/i, '').replace(/[\s:,-]/g, '')
    if (
        !ids.has('hash') && !ids.has('uuid') && !ids.has('timestamp') && !ids.has('color') && !mac &&
        (HEX_RE.test(text) || HEX_SEPARATED_RE.test(text)) && compactHex.length >= 16 &&
        (/[a-f]/i.test(compactHex) || /^0x|[\s:,-]/i.test(text))
    ) {
        out.push({ id: 'hex', label: 'Hexadecimal data', detail: `${(compactHex.length / 2).toLocaleString()} bytes` })
    }
    return out
}

// ---------- Previews ----------

function buildPreviews(text, candidates) {
    const trimmed = text.trim()
    const previews = []
    const ids = new Set(candidates.map(c => c.id))
    const big = trimmed.length > PREVIEW_LIMIT

    if (ids.has('timestamp')) {
        const rows = timestampRows(trimmed)
        if (rows) previews.push({ id: 'timestamp', title: 'Timestamp interpretation', rows })
    }
    if (ids.has('iso-date')) {
        previews.push({ id: 'iso-date', title: 'Date interpretation', rows: dateRows(new Date(Date.parse(trimmed))) })
    }
    if (ids.has('jwt')) {
        const [h, p, sig] = trimmed.split('.')
        const decode = (part) => {
            const bytes = base64ToBytes(part)
            const json = bytes && utf8(bytes)
            try {
                return json ? JSON.parse(json) : null
            } catch {
                return null
            }
        }
        const header = decode(h)
        const payload = decode(p)
        if (header && payload) {
            const rows = []
            for (const claim of ['iat', 'nbf', 'exp']) {
                if (typeof payload[claim] === 'number') {
                    const date = new Date(payload[claim] * 1000)
                    const name = { iat: 'Issued (iat)', nbf: 'Not before (nbf)', exp: 'Expires (exp)' }[claim]
                    rows.push([name, `${date.toISOString()} (${relativeTime(date)})`])
                }
            }
            rows.push(['Signature', sig ? `${base64ToBytes(sig)?.length ?? '?'} bytes, not verified here` : 'none (unsecured token)'])
            previews.push({ id: 'jwt', title: 'JWT decoded preview', code: JSON.stringify({ header, payload }, null, 2), language: 'json', rows })
        }
    }
    if (ids.has('json') && !big) {
        try {
            previews.push({ id: 'json', title: 'Formatted JSON preview', code: JSON.stringify(JSON.parse(trimmed), null, 2), language: 'json' })
        } catch {
            // detection said JSON; ignore if it changed
        }
    }
    if (ids.has('xml') && !big) {
        try {
            previews.push({ id: 'xml', title: 'Formatted XML preview', code: formatXml(trimmed), language: 'markup' })
        } catch (err) {
            previews.push({ id: 'xml', title: 'XML preview', error: err.message })
        }
    }
    if (ids.has('base64') && !big) {
        const bytes = base64ToBytes(trimmed)
        if (bytes) {
            const decoded = utf8(bytes)
            if (decoded !== null && isReadable(decoded)) {
                const pretty = prettyIfJson(decoded)
                previews.push({
                    id: 'base64',
                    title: 'Base64 decoded preview',
                    code: pretty ?? decoded,
                    language: pretty ? 'json' : 'text',
                    rows: [['Decoded size', `${bytes.length.toLocaleString()} bytes, UTF-8 text${pretty ? ' (JSON)' : ''}`]],
                })
            } else {
                const kind = sniff(bytes)
                previews.push({
                    id: 'base64',
                    title: 'Base64 decoded preview',
                    code: hexDump(bytes),
                    language: 'text',
                    rows: [['Decoded size', `${bytes.length.toLocaleString()} bytes of binary data`], ...(kind ? [['Looks like', kind]] : [])],
                })
            }
        }
    }
    if (ids.has('hex')) {
        const compact = trimmed.replace(/^0x/i, '').replace(/[\s:,-]/g, '')
        const bytes = new Uint8Array(compact.length / 2)
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16)
        const decoded = utf8(bytes)
        const readable = decoded !== null && isReadable(decoded)
        const kind = sniff(bytes)
        previews.push({
            id: 'hex',
            title: 'Hex decoded preview',
            code: readable ? decoded : hexDump(bytes),
            language: 'text',
            rows: [['Bytes', bytes.length.toLocaleString()], ['As UTF-8', readable ? 'readable text' : 'not text'], ...(kind ? [['Looks like', kind]] : [])],
        })
    }
    if (ids.has('uuid')) previews.push({ id: 'uuid', title: 'UUID details', rows: uuidRows(trimmed) })
    if (ids.has('hash')) {
        const guess = HASH_GUESSES[trimmed.length]
        previews.push({
            id: 'hash',
            title: 'Hash details',
            rows: [
                ['Length', `${trimmed.length} hex characters (${trimmed.length * 4} bits)`],
                ['Likely algorithm', guess ?? 'unknown'],
                ['Note', 'A digest can’t be reversed; compare it with the hash of a known input instead.'],
            ],
        })
    }
    if (ids.has('color')) {
        const info = colorRows(trimmed)
        if (info) previews.push({ id: 'color', title: 'Colour details', rows: info.rows, color: info.color })
    }
    if (ids.has('cron')) {
        try {
            previews.push({ id: 'cron', title: 'Cron schedule', rows: [['Runs', cronstrue.toString(trimmed, { use24HourTimeFormat: true })]] })
        } catch {
            // not describable after all
        }
    }
    if (ids.has('email')) {
        const at = trimmed.lastIndexOf('@')
        previews.push({ id: 'email', title: 'Email parts', rows: [['Local part', trimmed.slice(0, at)], ['Domain', trimmed.slice(at + 1)]] })
    }
    return previews
}

function analyze(text) {
    if (!text) return null
    const trimmed = text.trim()
    const canDetect = trimmed.length > 0 && text.length <= DETECT_LIMIT
    const formats = canDetect ? detectFormats(text) : []
    const extras = canDetect ? detectExtras(trimmed, formats) : []
    const candidates = [...formats, ...extras]
    const entropy = shannonEntropy(text)
    return {
        tooLargeToDetect: !canDetect && trimmed.length > 0,
        candidates,
        previews: canDetect ? buildPreviews(text, candidates) : [],
        stats: {
            characters: countGraphemes(text),
            codePoints: countCodePoints(text),
            utf16: text.length,
            bytes: utf8ByteLength(text),
            lines: countLines(text),
            words: getWords(text).length,
        },
        entropy,
        topChars: charFrequency(text, { limit: 10 }),
    }
}

async function computeHashes(text) {
    const data = new TextEncoder().encode(text)
    const algorithms = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']
    const digests = await Promise.all(algorithms.map(a => crypto.subtle.digest(a, data)))
    return algorithms.map((name, i) => ({
        name,
        value: Array.from(new Uint8Array(digests[i]), b => b.toString(16).padStart(2, '0')).join(''),
    }))
}

// ---------- UI pieces ----------

function SectionHeading({ icon: Icon, children }) {
    return (
        <h2 className="section-title" style={{ marginBottom: 'var(--space-md)' }}>
            {Icon && <Icon size={18} aria-hidden="true" style={{ color: 'var(--primary-text)' }} />}
            {children}
        </h2>
    )
}

function Rows({ rows }) {
    return (
        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)', gap: '0.35rem var(--space-md)', margin: 0, fontSize: '0.9rem' }}>
            {rows.map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                    <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
                    <dd className="mono" style={{ color: 'var(--text-main)', overflowWrap: 'anywhere', fontSize: '0.85rem' }}>{v}</dd>
                </div>
            ))}
        </dl>
    )
}

function Stat({ label, value, hint }) {
    return (
        <div style={{ padding: 'var(--space-sm)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', minWidth: 0 }}>
            <div style={{ fontSize: '1.35rem', fontWeight: 650, color: 'var(--primary-text)', lineHeight: 1.2, overflowWrap: 'anywhere' }}>{value}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{label}</div>
            {hint && <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{hint}</div>}
        </div>
    )
}

const ENTROPY_LEVELS = {
    low: { label: 'Low: structured or repetitive', badge: 'badge-success', color: 'var(--success)' },
    medium: { label: 'Medium: text or mixed data', badge: 'badge-warning', color: 'var(--warning)' },
    high: { label: 'High: looks random (key, hash, ciphertext or compressed)', badge: 'badge-danger', color: 'var(--danger)' },
}

export default function Inspector() {
    const navigate = useNavigate()
    const [input, setInput] = useState('')
    useSmartInput({ input: setInput })

    // Wait for typing to pause before analysing large inputs
    const text = useDebouncedValue(input, input.length > 20000 ? 300 : 0)
    const analysis = useMemo(() => analyze(text), [text])

    // Hashes are async; drop results that belong to an older input
    const [hashes, setHashes] = useState(null)
    useEffect(() => {
        if (!text || text.length > HASH_LIMIT || !globalThis.crypto?.subtle) return undefined
        let cancelled = false
        computeHashes(text)
            .then(values => {
                if (!cancelled) setHashes({ text, values })
            })
            .catch(() => {
                if (!cancelled) setHashes({ text, values: null })
            })
        return () => {
            cancelled = true
        }
    }, [text])
    const hashValues = hashes && hashes.text === text ? hashes.values : null

    useRegisterAIContext({
        tool: TOOL_NAME,
        getContext: () => {
            if (!analysis) return { input: '', output: 'No input yet' }
            const found = analysis.candidates.map(c => `${c.label}${c.detail ? ` (${c.detail})` : ''}`).join(', ') || 'no specific format'
            const s = analysis.stats
            return {
                input: text.length > 3000 ? `${text.slice(0, 3000)}\n…(truncated)` : text,
                output: `Detected: ${found}. ${s.characters} characters, ${s.bytes} bytes, ${s.lines} lines, ${s.words} words. Entropy ${analysis.entropy.bits.toFixed(2)} bits per character (${analysis.entropy.level}).`,
            }
        },
        suggestedPrompts: [
            'What is this data and where might it come from?',
            'Explain the decoded content',
            'Does this input contain anything sensitive?',
        ],
    })

    const stats = analysis?.stats
    const entropy = analysis?.entropy
    const level = entropy ? ENTROPY_LEVELS[entropy.level] : null

    return (
        <div className="page page-wide">
            <ToolHeader />

            <section className="card">
                <Field
                    label="Input"
                    hint="Detects JSON, XML, JWTs, UUIDs, Base64, hex, timestamps, URLs, IPs, colours, hashes, cron and more. Nothing leaves your browser."
                    labelAction={
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <PipelineRead onRead={setInput} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    }
                >
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Paste any text, token, URL, JSON, timestamp or encoded data…"
                        spellCheck={false}
                        style={{ minHeight: 150, fontSize: '0.92rem' }}
                    />
                </Field>
            </section>

            {!analysis ? (
                <section className="card">
                    <EmptyState icon={ScanSearch} title="Paste anything to inspect it">
                        Or try an example:
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', justifyContent: 'center', marginTop: 'var(--space-sm)' }}>
                            {SAMPLES.map(s => (
                                <button key={s.label} type="button" className="chip" onClick={() => setInput(s.value)}>{s.label}</button>
                            ))}
                        </div>
                    </EmptyState>
                </section>
            ) : (
                <>
                    <div className="auto-grid" style={{ '--auto-grid-min': '320px', alignItems: 'start' }}>
                        <section className="card" aria-label="Detected format">
                            <SectionHeading icon={ScanSearch}>Detected format</SectionHeading>
                            {analysis.tooLargeToDetect ? (
                                <StatusBanner tone="info" title="Too large to detect">
                                    Format detection is skipped above {(DETECT_LIMIT / 1000).toLocaleString()} K characters. Statistics and hashes still work.
                                </StatusBanner>
                            ) : analysis.candidates.length ? (
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                                    {analysis.candidates.map(c => {
                                        const Icon = ICONS[c.id] ?? FileText
                                        const target = c.tool && c.tool !== '/inspect' ? getTool(c.tool) : null
                                        const swatch = c.id === 'color' ? parseColor(text.trim()) : null
                                        return (
                                            <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', padding: 'var(--space-sm) var(--space-md)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                                                {swatch ? (
                                                    <span aria-hidden="true" className="checkerboard" style={{ width: 18, height: 18, borderRadius: 4, border: '1px solid var(--border-strong)', overflow: 'hidden', flexShrink: 0 }}>
                                                        <span style={{ display: 'block', width: '100%', height: '100%', background: toRgbString(swatch) }} />
                                                    </span>
                                                ) : (
                                                    <Icon size={18} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                                                )}
                                                <span style={{ flex: '1 1 140px', minWidth: 0 }}>
                                                    <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{c.label}</span>
                                                    {c.detail && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> · {c.detail}</span>}
                                                    {c.confidence !== undefined && c.confidence < 0.7 && <span className="badge" style={{ marginLeft: 6 }}>possible</span>}
                                                </span>
                                                {target && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline btn-sm"
                                                        onClick={() => openInTool(navigate, c.tool, { input: text, mode: c.mode })}
                                                        title={`Open this input in ${target.title}${c.mode ? ` (${c.mode})` : ''}`}
                                                    >
                                                        Open in {target.label} <ArrowRight size={14} aria-hidden="true" />
                                                    </button>
                                                )}
                                            </li>
                                        )
                                    })}
                                </ul>
                            ) : (
                                <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--text-dim)', margin: 0 }}>
                                    <AlertCircle size={16} aria-hidden="true" /> No specific format detected. Plain text?
                                </p>
                            )}
                        </section>

                        <section className="card" aria-label="Statistics">
                            <SectionHeading icon={FileText}>Statistics</SectionHeading>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-sm)' }}>
                                <Stat
                                    label="Characters"
                                    value={stats.characters.toLocaleString()}
                                    hint={stats.codePoints !== stats.characters || stats.utf16 !== stats.characters
                                        ? `${stats.codePoints.toLocaleString()} code points · ${stats.utf16.toLocaleString()} UTF-16 units`
                                        : null}
                                />
                                <Stat label="Bytes (UTF-8)" value={stats.bytes.toLocaleString()} hint={stats.bytes >= 1024 ? formatBytes(stats.bytes) : null} />
                                <Stat label="Lines" value={stats.lines.toLocaleString()} />
                                <Stat label="Words" value={stats.words.toLocaleString()} />
                            </div>

                            <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 6 }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                        <Sigma size={14} aria-hidden="true" /> Shannon entropy
                                    </span>
                                    <span className={`badge ${level.badge}`} style={{ whiteSpace: 'normal' }}>{level.label}</span>
                                </div>
                                <div
                                    role="meter"
                                    aria-label="Entropy compared with random data"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={Math.round(entropy.ratio * 100)}
                                    style={{ height: 8, background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}
                                >
                                    <div style={{ width: `${Math.round(entropy.ratio * 100)}%`, height: '100%', background: level.color, transition: 'width 0.3s' }} />
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 6 }}>
                                    {entropy.bits.toFixed(3)} bits per character
                                    {entropy.maxBits > 0 && ` · random ${entropy.alphabet.name} of this length would score about ${entropy.maxBits.toFixed(2)}`}
                                    {entropy.total > 0 && ` · ≈${Math.round(entropy.bits * entropy.total).toLocaleString()} bits in total`}
                                    {entropy.total < 16 && ' · too short for a reliable estimate'}
                                </div>
                            </div>
                        </section>

                        <section className="card" aria-label="Hash values">
                            <SectionHeading icon={Hash}>Hash values</SectionHeading>
                            {text.length > HASH_LIMIT ? (
                                <p style={{ color: 'var(--text-dim)', margin: 0 }}>Skipped: the input is larger than {formatBytes(HASH_LIMIT)}.</p>
                            ) : !globalThis.crypto?.subtle ? (
                                <p style={{ color: 'var(--text-dim)', margin: 0 }}>Hashing needs a secure (https) page.</p>
                            ) : hashValues ? (
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                                    {hashValues.map(h => (
                                        <li key={h.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '0.3rem 0.5rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', minWidth: 0 }}>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '4.8em', flexShrink: 0 }}>{h.name}</span>
                                            <code className="mono" title={h.value} style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', color: 'var(--text-code)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.value}</code>
                                            <CopyButton text={h.value} iconOnly label={`Copy ${h.name}`} />
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p style={{ color: 'var(--text-dim)', margin: 0 }}>{hashes?.text === text ? 'Hashing failed in this browser.' : 'Hashing…'}</p>
                            )}
                            <p className="field-hint" style={{ marginBottom: 0 }}>Of the UTF-8 bytes, exactly as typed (no trimming).</p>
                        </section>

                        {analysis.topChars.length > 0 && (
                            <section className="card" aria-label="Character frequency">
                                <SectionHeading icon={Binary}>Character frequency</SectionHeading>
                                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {analysis.topChars.map(item => (
                                        <li key={item.char} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }} title={item.name}>
                                            <code className="mono" style={{ minWidth: '3.2em', textAlign: 'center', color: item.invisible ? 'var(--text-dim)' : 'var(--primary-text)', fontSize: item.label.length > 2 ? '0.7rem' : '0.95rem' }}>{item.label}</code>
                                            <div style={{ flex: 1, height: 14, background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }} aria-hidden="true">
                                                <div style={{ width: `${(item.percent / analysis.topChars[0].percent) * 100}%`, minWidth: 2, height: '100%', background: 'linear-gradient(90deg, var(--primary), var(--accent))' }} />
                                            </div>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '5.5em', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                                {item.count.toLocaleString()} ({item.percent.toFixed(1)}%)
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}
                    </div>

                    {analysis.previews.map(p => (
                        <section key={p.id} className="card" aria-label={p.title}>
                            <SectionHeading icon={ICONS[p.id] ?? Code}>{p.title}</SectionHeading>
                            {p.color && (
                                <div className="checkerboard" style={{ height: 56, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
                                    <div style={{ height: '100%', background: toRgbString(p.color) }} />
                                </div>
                            )}
                            {p.error && <StatusBanner tone="danger" title="Couldn't format it">{p.error}</StatusBanner>}
                            {p.rows && <Rows rows={p.rows} />}
                            {p.code !== undefined && (
                                <CodeBlock
                                    code={p.code.length > DISPLAY_LIMIT ? `${p.code.slice(0, DISPLAY_LIMIT)}\n… (preview truncated)` : p.code}
                                    language={p.language}
                                    maxHeight={360}
                                    style={{ marginTop: p.rows ? 'var(--space-md)' : 0 }}
                                />
                            )}
                        </section>
                    ))}
                </>
            )}
        </div>
    )
}
