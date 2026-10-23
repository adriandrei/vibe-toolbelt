import { useId, useMemo, useState } from 'react'
import yaml from 'js-yaml'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { ArrowLeftRight, Download, FileInput, FileOutput, Play, Sparkles, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CodeBlock from '../components/ui/CodeBlock'
import CopyButton from '../components/ui/CopyButton'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { parseXml } from '../utils/xml'
import { downloadText } from '../utils/download'

const FORMATS = [
    { value: 'json', label: 'JSON', ext: 'json', mime: 'application/json', prism: 'json' },
    { value: 'yaml', label: 'YAML', ext: 'yaml', mime: 'application/yaml', prism: 'yaml' },
    { value: 'toml', label: 'TOML', ext: 'toml', mime: 'application/toml', prism: 'toml' },
    { value: 'xml', label: 'XML', ext: 'xml', mime: 'application/xml', prism: 'markup' },
]
const FORMAT_IDS = FORMATS.map(f => f.value)
const formatInfo = (id) => FORMATS.find(f => f.value === id) ?? FORMATS[0]

const SAMPLES = {
    json: `{
  "service": {
    "name": "billing-api",
    "version": "2.4.1",
    "released": "2024-05-01",
    "replicas": 3,
    "debug": false,
    "ports": [8080, 9090],
    "owner": { "team": "payments", "email": "payments@example.com" },
    "endpoints": [
      { "path": "/invoices", "methods": ["GET", "POST"] },
      { "path": "/refunds", "methods": ["POST"] }
    ]
  }
}`,
    yaml: `# Anchors, merge keys and dates are supported
defaults: &defaults
  replicas: 2
  region: eu-west-1
service:
  name: billing-api
  released: 2024-05-01
  <<: *defaults
  replicas: 3
  ports: [8080, 9090]
  notes: |
    Multi-line text
    stays intact.
`,
    toml: `title = "billing-api"
released = 2024-05-01
started = 2024-05-01T09:30:00Z

[owner]
team = "payments"
email = "payments@example.com"

[database]
ports = [5432, 5433]
enabled = true

[[endpoints]]
path = "/invoices"
methods = ["GET", "POST"]

[[endpoints]]
path = "/refunds"
methods = ["POST"]
`,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book id="bk101" available="true">
    <author>Gambardella, Matthew</author>
    <title>XML Developer's Guide</title>
    <price currency="USD">44.95</price>
    <description><![CDATA[An in-depth look at <XML> & friends.]]></description>
  </book>
  <book id="bk102" available="false">
    <author>Ralls, Kim</author>
    <title>Midnight Rain</title>
    <price currency="USD">5.95</price>
  </book>
</catalog>`,
}

const LIVE_LIMIT = 2_000_000

class ConvertError extends Error {
    constructor(title, message, extra = {}) {
        super(message)
        this.title = title
        Object.assign(this, extra)
    }
}

// ---------------------------------------------------------------- helpers

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

function lineColumn(text, position) {
    const before = text.slice(0, position)
    const line = before.split('\n').length
    return { line, column: position - before.lastIndexOf('\n') }
}

function guessFormat(text) {
    const t = text.trimStart()
    if (/^[[{]/.test(t)) {
        try {
            JSON.parse(t)
            return 'json'
        } catch {
            // `[table]` headers start TOML documents too
        }
    }
    if (t.startsWith('<')) return 'xml'
    if (/^\s*\[[\w.\s"'-]+\]\s*$/m.test(t) && /^\s*[\w."'-]+\s*=/m.test(t)) return 'toml'
    if (/^\s*[\w."'-]+\s*=\s*\S/m.test(t) && !/^\s*[\w-]+\s*:\s/m.test(t)) return 'toml'
    if (/^[[{]/.test(t)) return 'json'
    return 'yaml'
}

// YAML 1.2 core schema (dates stay strings, no surprises like `on`/`yes`)
// plus merge keys (<<: *defaults).
const YAML_LOAD_SCHEMA = yaml.CORE_SCHEMA.extend({ implicit: [yaml.types.merge] })
// BigInts (large TOML integers) are written as plain YAML integers.
const YAML_DUMP_SCHEMA = yaml.DEFAULT_SCHEMA.extend({
    implicit: [new yaml.Type('tag:vibe-toolbelt,2024:bigint', {
        kind: 'scalar',
        predicate: (v) => typeof v === 'bigint',
        represent: (v) => v.toString(),
        resolve: () => false,
    })],
})

// ----- XML → value

const XML_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/

function inferScalar(text) {
    if (text === 'true') return true
    if (text === 'false') return false
    if (XML_NUMBER.test(text)) {
        const n = Number(text)
        // Only canonical numbers: "007", "1.50" and huge integers stay strings
        if (Number.isFinite(n) && String(n) === text) return n
    }
    return text
}

function elementToValue(el, infer) {
    const scalar = (s) => (infer ? inferScalar(s) : s)
    const obj = Object.create(null)
    let hasAttributes = false
    for (const attr of el.attributes) {
        obj[`@${attr.name}`] = scalar(attr.value)
        hasAttributes = true
    }
    const segments = []
    let buffer = ''
    let hasChildElements = false
    const flush = (leading) => {
        if (buffer.trim()) {
            if (!('#text' in obj)) obj['#text'] = null // keeps the text's position in the key order
            segments.push({ text: buffer, leading })
        }
        buffer = ''
    }
    for (const node of el.childNodes) {
        if (node.nodeType === 1) {
            flush(!hasChildElements)
            hasChildElements = true
            const name = node.nodeName
            const value = elementToValue(node, infer)
            if (name in obj) {
                if (Array.isArray(obj[name])) obj[name].push(value)
                else obj[name] = [obj[name], value]
            } else {
                obj[name] = value
            }
        } else if (node.nodeType === 3 || node.nodeType === 4) {
            buffer += node.nodeValue // text and CDATA; comments and PIs are skipped
        }
    }
    const trailing = buffer.trim() !== ''
    flush(!hasChildElements)
    if (trailing) segments[segments.length - 1].trailing = true

    if (!hasChildElements) {
        const text = segments.length ? segments[0].text.trim() : ''
        if (!hasAttributes) return scalar(text)
        if (text) obj['#text'] = scalar(text)
        return obj
    }
    if (segments.length) {
        // Mixed content: keep inner spacing, trim only the element's outer edges
        const texts = segments.map((s) => {
            let t = s.text
            if (s.leading) t = t.trimStart()
            if (s.trailing) t = t.trimEnd()
            return t
        })
        obj['#text'] = texts.length === 1 ? texts[0] : texts
    }
    return obj
}

function xmlToValue(text, infer) {
    const { doc, error } = parseXml(text)
    if (error) {
        const lc = error.match(/line (\d+) at column (\d+)/)
        throw new ConvertError('Invalid XML', error, { location: lc ? { line: Number(lc[1]), column: Number(lc[2]) } : null })
    }
    const root = doc.documentElement
    const out = Object.create(null)
    out[root.nodeName] = elementToValue(root, infer)
    return out
}

// ----- value → XML

// Conservative XML names: letters or "_" first, then letters, digits, marks, "_", "-", "."
const VALID_NAME = /^[\p{L}_][\p{L}\p{Nd}\p{M}_.-]*(?::[\p{L}_][\p{L}\p{Nd}\p{M}_.-]*)?$/u
const INVALID_NAME_CHAR = /[^\p{L}\p{Nd}\p{M}_.-]/gu
const NAME_START = /^[\p{L}_]/u
// Characters XML 1.0 can't contain at all, even escaped
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

const escapeText = (s) => s.replace(INVALID_XML_CHARS, '\uFFFD').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;')

function scalarText(v) {
    if (v instanceof Date) return v.toISOString()
    if (v === null || v === undefined) return ''
    return String(v)
}

const isScalar = (v) => v === null || v === undefined || typeof v !== 'object' || v instanceof Date

function valueToXml(value, { indent = '  ' } = {}) {
    const renamed = new Map()
    const xmlName = (raw) => {
        const key = String(raw)
        if (VALID_NAME.test(key)) return key
        let name = key.replace(INVALID_NAME_CHAR, '_')
        if (!NAME_START.test(name)) name = `_${name}`
        renamed.set(key, name)
        return name
    }

    // Splits an object into attributes, text and child elements
    const parts = (obj) => {
        const attrs = []
        const children = []
        let text = null
        for (const key of Object.keys(obj)) {
            const v = obj[key]
            if (key.length > 1 && key[0] === '@' && isScalar(v)) attrs.push(` ${xmlName(key.slice(1))}="${escapeAttr(scalarText(v))}"`)
            else if (key === '#text' && (isScalar(v) || (Array.isArray(v) && v.every(isScalar)))) text = { at: children.length, value: v }
            else children.push([key, v])
        }
        return { attrs: attrs.join(''), children, text }
    }

    // Arrays become repeated elements; nested arrays become <item> lists
    const expand = (key, v) => {
        if (!Array.isArray(v)) return [[key, v]]
        if (!v.length) return [[key, null]]
        return v.map(item => [key, Array.isArray(item) ? { item } : item])
    }

    const inline = (name, v) => {
        const tag = xmlName(name)
        if (isScalar(v)) {
            const t = scalarText(v)
            return t ? `<${tag}>${escapeText(t)}</${tag}>` : `<${tag}/>`
        }
        if (Array.isArray(v)) return inline(name, { item: v })
        const { attrs, children, text } = parts(v)
        const texts = text ? (Array.isArray(text.value) ? text.value : [text.value]).map(t => escapeText(scalarText(t))) : []
        const kids = []
        children.forEach(([k, c], i) => {
            if (text && i === text.at) kids.push(texts[0])
            for (const [ek, ec] of expand(k, c)) kids.push(inline(ek, ec))
        })
        if (text && text.at >= children.length) kids.push(texts[0])
        kids.push(...texts.slice(1))
        return kids.length ? `<${tag}${attrs}>${kids.join('')}</${tag}>` : `<${tag}${attrs}/>`
    }

    const lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    const write = (name, v, depth) => {
        const pad = indent.repeat(depth)
        const tag = xmlName(name)
        if (isScalar(v)) {
            lines.push(pad + inline(name, v))
            return
        }
        if (Array.isArray(v)) {
            write(name, { item: v }, depth)
            return
        }
        const { attrs, children, text } = parts(v)
        if (text && (children.length || Array.isArray(text.value))) {
            // Mixed content: written on one line so its spacing is preserved
            lines.push(pad + inline(name, v))
            return
        }
        const kids = children.flatMap(([k, c]) => expand(k, c))
        if (text) {
            lines.push(`${pad}<${tag}${attrs}>${escapeText(scalarText(text.value))}</${tag}>`)
        } else if (!kids.length) {
            lines.push(`${pad}<${tag}${attrs}/>`)
        } else {
            lines.push(`${pad}<${tag}${attrs}>`)
            for (const [k, c] of kids) write(k, c, depth + 1)
            lines.push(`${pad}</${tag}>`)
        }
    }

    // A single top-level key becomes the root element; anything else is wrapped in <root>
    const keys = isRecord(value) ? Object.keys(value) : []
    if (keys.length === 1 && isRecord(value[keys[0]]) && keys[0][0] !== '@' && keys[0][0] !== '#') write(keys[0], value[keys[0]], 0)
    else write('root', value, 0)

    const notices = []
    if (renamed.size) {
        const list = [...renamed].slice(0, 4).map(([from, to]) => `"${from}" → ${to}`).join(', ')
        notices.push({ tone: 'warning', title: `${renamed.size} key${renamed.size > 1 ? 's were' : ' was'} renamed`, body: `XML element and attribute names can’t contain spaces or start with a digit: ${list}${renamed.size > 4 ? ', …' : ''}.` })
    }
    return { text: lines.join('\n'), notices }
}

// ----- value checks per target

function pathLabel(path) {
    return path.reduce((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${p}` : String(p)), '') || 'the top level'
}

function walk(value, visit, path = []) {
    visit(value, path)
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, [...path, i]))
    else if (isRecord(value)) for (const k of Object.keys(value)) walk(value[k], visit, [...path, k])
}

function toJsonText(value, indent) {
    const notices = []
    let bigints = 0
    let nonFinite = 0
    const out = JSON.stringify(value, (key, v) => {
        if (typeof v === 'bigint') {
            bigints++
            return typeof JSON.rawJSON === 'function' ? JSON.rawJSON(v.toString()) : v.toString()
        }
        if (typeof v === 'number' && !Number.isFinite(v)) nonFinite++
        return v
    }, indent)
    if (nonFinite) notices.push({ tone: 'warning', title: 'Infinity and NaN became null', body: `JSON has no way to write ${nonFinite} non-finite number${nonFinite > 1 ? 's' : ''} (.inf / .nan), so ${nonFinite > 1 ? 'they were' : 'it was'} written as null.` })
    if (bigints && typeof JSON.rawJSON !== 'function') notices.push({ tone: 'warning', title: 'Large integers written as strings', body: 'This browser can’t write integers above 2⁵³ as JSON numbers without losing precision, so they were quoted.' })
    return { text: out ?? 'null', notices }
}

function toTomlText(value) {
    if (!isRecord(value)) {
        throw new ConvertError('Can’t write TOML', `TOML needs a table (an object) at the top level, but this is ${Array.isArray(value) ? 'an array' : value === null ? 'null' : `a ${typeof value}`}.`, {
            hint: 'Wrap the data in a key, for example {"items": [ … ]}.',
        })
    }
    const droppedNulls = []
    walk(value, (v, path) => {
        if (v !== null && v !== undefined) return
        const parentIsArray = typeof path[path.length - 1] === 'number'
        if (parentIsArray) throw new ConvertError('Can’t write TOML', `TOML has no null, and arrays can’t skip values: ${pathLabel(path)} is null.`)
        droppedNulls.push(pathLabel(path))
    })
    const text = stringifyToml(value)
    const notices = droppedNulls.length
        ? [{ tone: 'warning', title: `${droppedNulls.length} null value${droppedNulls.length > 1 ? 's' : ''} left out`, body: `TOML has no null, so these keys were omitted: ${droppedNulls.slice(0, 4).join(', ')}${droppedNulls.length > 4 ? ', …' : ''}.` }]
        : []
    return { text, notices }
}

// ----- the conversion

function parseSource(text, format, { inferXml }) {
    switch (format) {
        case 'json': {
            const clean = text.replace(/^\uFEFF/, '')
            try {
                return { value: JSON.parse(clean) }
            } catch (e) {
                const message = String(e.message)
                const pos = message.match(/at position (\d+)/)
                const lc = message.match(/line (\d+) column (\d+)/)
                const location = lc ? { line: Number(lc[1]), column: Number(lc[2]) } : pos ? lineColumn(clean, Number(pos[1])) : null
                throw new ConvertError('Invalid JSON', message, { location })
            }
        }
        case 'yaml': {
            let docs
            try {
                docs = yaml.loadAll(text, null, { schema: YAML_LOAD_SCHEMA })
            } catch (e) {
                const mark = e.mark
                throw new ConvertError('Invalid YAML', e.reason ? `${e.reason}${mark ? ` (line ${mark.line + 1}, column ${mark.column + 1})` : ''}` : String(e.message), {
                    snippet: mark?.snippet,
                    location: mark ? { line: mark.line + 1, column: mark.column + 1 } : null,
                })
            }
            if (docs.length <= 1) return { value: docs[0] ?? null }
            return {
                value: docs.map(d => d ?? null),
                multiDoc: true,
                notices: [{ tone: 'info', title: `${docs.length} YAML documents`, body: 'The documents separated by --- were converted as one array, one item per document.' }],
            }
        }
        case 'toml':
            try {
                return { value: parseToml(text, { integersAsBigInt: 'asNeeded' }) }
            } catch (e) {
                const message = String(e.message).split('\n')[0].replace(/^Invalid TOML document:\s*/, '')
                throw new ConvertError('Invalid TOML', e.line ? `${message} (line ${e.line}, column ${e.column})` : message, {
                    snippet: e.codeblock,
                    location: e.line ? { line: e.line, column: e.column } : null,
                })
            }
        case 'xml':
            return { value: xmlToValue(text, inferXml) }
        default:
            throw new ConvertError('Unknown format', format)
    }
}

function serialize(parsed, format, { indent }) {
    const { value, multiDoc } = parsed
    switch (format) {
        case 'json':
            return toJsonText(value, indent)
        case 'yaml': {
            const opts = { schema: YAML_DUMP_SCHEMA, noRefs: true, lineWidth: -1, indent }
            const docs = multiDoc && Array.isArray(value) ? value : [value]
            return { text: docs.map(d => yaml.dump(d, opts)).join('---\n').trimEnd(), notices: [] }
        }
        case 'toml':
            return toTomlText(value)
        case 'xml':
            return valueToXml(value, { indent: ' '.repeat(indent) })
        default:
            throw new ConvertError('Unknown format', format)
    }
}

function convert(text, from, to, options) {
    if (!text.trim()) return { output: '', error: null, notices: [] }
    try {
        const parsed = parseSource(text, from, options)
        let result
        try {
            result = serialize(parsed, to, options)
        } catch (e) {
            if (e instanceof ConvertError) throw e
            throw new ConvertError(`Can’t write ${formatInfo(to).label}`, String(e.message || e))
        }
        return { output: result.text, error: null, notices: [...(parsed.notices || []), ...result.notices] }
    } catch (e) {
        const error = e instanceof ConvertError
            ? { title: e.title, message: e.message, hint: e.hint, snippet: e.snippet }
            : { title: `Invalid ${formatInfo(from).label}`, message: String(e?.message || e) }
        return { output: '', error, notices: [] }
    }
}

// ---------------------------------------------------------------- page

export default function Converter() {
    const fromId = useId()
    const toId = useId()
    const inputId = useId()
    const [input, setInput] = useState('')
    const [from, setFrom] = useState('json')
    const [to, setTo] = useState('yaml')
    const [indent, setIndent] = useState(2)
    const [inferXml, setInferXml] = useState(true)
    const [manual, setManual] = useState('')

    const large = input.length > LIVE_LIMIT
    const debounced = useDebouncedValue(input, input.length > 200_000 ? 600 : 200)
    const source = large ? (manual === input ? input : '') : debounced

    const result = useMemo(() => convert(source, from, to, { indent, inferXml }), [source, from, to, indent, inferXml])
    const { output, error, notices } = result
    const pending = large && manual !== input

    const changeFrom = (next) => {
        setFrom(next)
        if (next === to) setTo(next === 'json' ? 'yaml' : 'json')
    }

    const load = (text, format) => {
        const f = FORMAT_IDS.includes(format) ? format : guessFormat(text)
        setInput(text)
        setManual(text)
        changeFrom(f)
    }

    useSmartInput(
        {
            input: (value) => {
                if (typeof value === 'string') setInput(value)
            },
            mode: () => {},
        },
        { onInject: (values) => typeof values.input === 'string' && load(values.input, values.mode) }
    )

    useRegisterAIContext({
        tool: 'Data Converter',
        getContext: () => ({ input, output }),
        suggestedPrompts: [
            `Explain the structure of this ${formatInfo(from).label}`,
            `Is anything lost converting ${formatInfo(from).label} to ${formatInfo(to).label}?`,
            'Suggest a cleaner structure for this config',
        ],
    })

    const swap = () => {
        if (!output || error) return
        setInput(output)
        setManual(output)
        setFrom(to)
        setTo(from)
    }

    const fromInfo = formatInfo(from)
    const toInfo = formatInfo(to)
    const selectStyle = { width: 'auto', padding: '0.45rem 0.7rem', fontSize: '0.9rem' }

    return (
        <div className="page page-wide page-converter">
            <ToolHeader />

            <section className="card card-compact" aria-label="Conversion options" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <label htmlFor={fromId} className="field-label" style={{ marginBottom: 0 }}>From</label>
                    <select id={fromId} value={from} onChange={e => changeFrom(e.target.value)} style={selectStyle}>
                        {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <button type="button" className="icon-btn" onClick={swap} disabled={!output || !!error} aria-label="Swap: convert the output back" title="Swap input and output">
                        <ArrowLeftRight size={16} aria-hidden="true" />
                    </button>
                    <label htmlFor={toId} className="field-label" style={{ marginBottom: 0 }}>To</label>
                    <select id={toId} value={to} onChange={e => setTo(e.target.value)} style={selectStyle}>
                        {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                </div>
                {to !== 'toml' && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Indent
                        <select value={indent} onChange={e => setIndent(Number(e.target.value))} style={selectStyle}>
                            <option value={2}>2 spaces</option>
                            <option value={4}>4 spaces</option>
                        </select>
                    </label>
                )}
                {from === 'xml' && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }} title="Turn values like 42 and true into numbers and booleans">
                        <input type="checkbox" checked={inferXml} onChange={e => setInferXml(e.target.checked)} />
                        Detect numbers and booleans
                    </label>
                )}
            </section>

            <div className="split-pane">
                <div className="card card-compact" role="region" aria-label="Input" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <label htmlFor={inputId} className="section-title"><FileInput size={16} aria-hidden="true" /> {fromInfo.label} input</label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineRead onRead={(text) => load(text)} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(SAMPLES[from], from)}>
                                <Sparkles size={14} aria-hidden="true" /> Sample
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setInput(''); setManual('') }} disabled={!input}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    </div>
                    <textarea
                        id={inputId}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder={`Paste ${fromInfo.label} here...`}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoComplete="off"
                        style={{ minHeight: 'clamp(240px, 45vh, 560px)', fontSize: '0.85rem', lineHeight: 1.5, padding: '0.75rem', whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto' }}
                    />
                    {pending && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => setManual(input)}>
                                <Play size={14} aria-hidden="true" /> Convert
                            </button>
                            <span className="field-hint" style={{ marginTop: 0 }}>Large input: live conversion is paused.</span>
                        </div>
                    )}
                </div>

                <div className="card card-compact" role="region" aria-label="Output" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <div className="section-title" role="heading" aria-level={2}><FileOutput size={16} aria-hidden="true" /> {toInfo.label} output</div>
                        <CopyButton text={output} disabled={!output || !!error} />
                    </div>

                    {error && (
                        <StatusBanner tone="danger" title={error.title}>
                            <div className="mono" style={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{error.message}</div>
                            {error.snippet && (
                                <pre className="mono" style={{ margin: '6px 0 0', fontSize: '0.78rem', whiteSpace: 'pre', overflowX: 'auto', color: 'var(--text-muted)' }}>{error.snippet}</pre>
                            )}
                            {error.hint && <div style={{ marginTop: 4 }}>{error.hint}</div>}
                        </StatusBanner>
                    )}
                    {notices.map(n => (
                        <StatusBanner key={n.title} tone={n.tone} title={n.title}>{n.body}</StatusBanner>
                    ))}

                    {output ? (
                        <CodeBlock code={output} language={toInfo.prism} maxHeight="clamp(240px, 60vh, 720px)" wrap={false} showCopy={false} />
                    ) : !error && (
                        <div className="code-well" style={{ minHeight: 'clamp(240px, 45vh, 560px)', display: 'flex' }}>
                            <EmptyState title={`Your ${toInfo.label} appears here`} style={{ margin: 'auto' }}>
                                Paste {fromInfo.label} as the input, or load a sample.
                            </EmptyState>
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <PipelineSend dataToSend={output} disabled={!!error} />
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText(output, `converted.${toInfo.ext}`, toInfo.mime)} disabled={!output || !!error}>
                            <Download size={14} aria-hidden="true" /> Download
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
