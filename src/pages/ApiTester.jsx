import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
    Check, Clock, Code2, Download, Eye, EyeOff, FolderOpen, Globe, History, Import, Loader2, Lock,
    Plus, Save, Send, Settings2, Square, Trash2, TriangleAlert, X,
} from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CodeBlock from '../components/ui/CodeBlock'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { useToast } from '../components/ToastProvider'
import { usePane } from '../contexts/pane'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useObjectURL } from '../hooks/useObjectURL'
import { useSmartInput } from '../hooks/useSmartInput'
import { parseCurl } from '../utils/curlParser'
import { CODE_TARGETS, base64Utf8, generateCode, isForbiddenHeader, targetLanguage } from '../utils/codeGenerator'
import { getStatusCategory, getStatusText } from '../utils/httpStatus'
import { downloadBlob, formatBytes } from '../utils/download'
import { isMacPlatform } from '../utils/palette'

// ------------------------------------------------------------ constants ---

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const METHOD_COLORS = { GET: 'var(--success)', POST: 'var(--info)', PUT: 'var(--warning)', PATCH: 'var(--accent-text)', DELETE: 'var(--danger)' }
const NO_BODY = new Set(['GET', 'HEAD'])
const BODY_TYPES = [
    { value: 'none', label: 'None' },
    { value: 'json', label: 'JSON', contentType: 'application/json' },
    { value: 'text', label: 'Text', contentType: 'text/plain;charset=UTF-8' },
    { value: 'xml', label: 'XML', contentType: 'application/xml' },
    { value: 'form', label: 'URL-encoded', contentType: 'application/x-www-form-urlencoded' },
    { value: 'multipart', label: 'Multipart' },
]
const BODY_TYPE_VALUES = new Set(BODY_TYPES.map(t => t.value))
const AUTH_TYPES = [{ value: 'none', label: 'None' }, { value: 'basic', label: 'Basic' }, { value: 'bearer', label: 'Bearer token' }]
const NO_AUTH = { type: 'none', username: '', password: '', token: '' }
const DEFAULT_ENVS = [{ id: 'default', name: 'Default', vars: [] }]
const DEFAULT_REQUEST = {
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    headers: [{ key: 'Accept', value: 'application/json' }],
    bodyType: 'json',
    body: '',
    auth: NO_AUTH,
}
const DEFAULT_TIMEOUT = 30
const HISTORY_LIMIT = 50
const HISTORY_BODY_LIMIT = 100_000
const DISPLAY_LIMIT = 2_000_000
const BODY_HEIGHT = 480
const COMMON_HEADERS = ['Accept', 'Accept-Language', 'Authorization', 'Cache-Control', 'Content-Type', 'If-Match', 'If-None-Match', 'User-Agent', 'X-API-Key', 'X-Request-ID', 'X-Requested-With']
const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g
const SAFELISTED_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']
const SEND_SHORTCUT = isMacPlatform ? '⌘ Enter' : 'Ctrl + Enter'

// Row ids only need to be unique among rows that are on screen together,
// including ones restored from storage that were created in other sessions
const SESSION = Math.random().toString(36).slice(2, 8)
let idCounter = 0
const newId = () => `${SESSION}-${++idCounter}`
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ------------------------------------------------------- URL and query ---

function splitUrl(url) {
    const hashAt = url.indexOf('#')
    const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt)
    const queryAt = beforeHash.indexOf('?')
    return {
        base: queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt),
        query: queryAt === -1 ? '' : beforeHash.slice(queryAt + 1),
        hash: hashAt === -1 ? '' : url.slice(hashAt),
    }
}

function formDecode(text) {
    try {
        return decodeURIComponent(text.replace(/\+/g, ' '))
    } catch {
        return text
    }
}

function parsePair(raw) {
    const eq = raw.indexOf('=')
    return eq === -1
        ? { key: formDecode(raw), value: '' }
        : { key: formDecode(raw.slice(0, eq)), value: formDecode(raw.slice(eq + 1)) }
}

function parseQueryRows(url) {
    const { query } = splitUrl(url)
    if (!query) return []
    return query.split('&').filter(Boolean).map(raw => ({ id: newId(), ...parsePair(raw), raw }))
}

// Percent-encodes a query key or value, leaving {{variables}} and the
// characters that are safe in a query (: / @ , ; $ ? [ ]) readable
function encodeQueryPart(text) {
    return text
        .split(/(\{\{\s*[\w.-]+\s*\}\})/)
        .map((part, i) => (i % 2 ? part : encodeURIComponent(part).replace(/%(3A|2F|40|2C|3B|24|3F|5B|5D)/gi, m => decodeURIComponent(m))))
        .join('')
}

function buildUrl(url, rows) {
    const { base, hash } = splitUrl(url)
    const query = rows
        .filter(r => r.key !== '' || r.value !== '')
        .map(row => {
            // Untouched parameters keep their original encoding (signed URLs care)
            if (row.raw !== undefined) {
                const original = parsePair(row.raw)
                if (original.key === row.key && original.value === row.value) return row.raw
            }
            const key = encodeQueryPart(row.key)
            return row.value === '' ? key : `${key}=${encodeQueryPart(row.value)}`
        })
        .join('&')
    return base + (query ? `?${query}` : '') + hash
}

const looksLikeHost = (text) => /^(localhost|\[[0-9a-f:.]+\]|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]|$)/i.test(text)

function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]'
}

// ----------------------------------------------------------- variables ---

function substitute(text, vars, unresolved) {
    // A function replacement, so "$&" or "$1" in a value is never special
    return String(text ?? '').replace(VAR_RE, (match, name) => {
        if (vars.has(name)) return vars.get(name)
        unresolved?.add(name)
        return match
    })
}

function collectVars(text, into) {
    for (const m of String(text ?? '').matchAll(VAR_RE)) into.add(m[1])
}

function normalizeEnvs(stored) {
    const list = Array.isArray(stored) ? stored.filter(e => isObject(e) && e.id !== undefined && e.id !== null) : []
    const envs = list.map(e => ({
        id: String(e.id),
        name: typeof e.name === 'string' && e.name.trim() ? e.name : 'Untitled',
        vars: Array.isArray(e.vars)
            ? e.vars.filter(isObject).map((v, i) => ({ id: v.id ?? `${e.id}-${i}`, key: String(v.key ?? ''), value: String(v.value ?? '') }))
            : [],
    }))
    return envs.length ? envs : DEFAULT_ENVS
}

// ------------------------------------------------------ request model ---

const headerValue = (rows, name) => rows.find(h => h.key.trim().toLowerCase() === name)?.value ?? ''

function decodeBase64Utf8(b64) {
    try {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return null
    }
}

// Moves a Bearer or Basic Authorization header into the Auth tab
function deriveAuth(headers) {
    const index = headers.findIndex(h => h.key.trim().toLowerCase() === 'authorization')
    if (index === -1) return { auth: NO_AUTH, headers }
    const value = headers[index].value.trim()
    const rest = headers.filter((_, i) => i !== index)
    const bearer = /^Bearer\s+(\S.*)$/i.exec(value)
    if (bearer) return { auth: { ...NO_AUTH, type: 'bearer', token: bearer[1].trim() }, headers: rest }
    const basic = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(value)
    if (basic) {
        const decoded = decodeBase64Utf8(basic[1])
        const colon = decoded?.indexOf(':') ?? -1
        if (colon !== -1) return { auth: { ...NO_AUTH, type: 'basic', username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }, headers: rest }
    }
    return { auth: NO_AUTH, headers }
}

function guessBodyType(contentType, body) {
    const ct = contentType.toLowerCase()
    if (ct.includes('json')) return 'json'
    if (ct.includes('x-www-form-urlencoded')) return 'form'
    if (ct.includes('xml')) return 'xml'
    if (ct) return 'text'
    if (!body) return 'json'
    return /^\s*[[{]/.test(body) ? 'json' : 'text'
}

function clampTimeout(value) {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.min(600, Math.round(n)) : DEFAULT_TIMEOUT
}

function normalizeAuth(auth) {
    if (!isObject(auth) || !['none', 'basic', 'bearer'].includes(auth.type)) return null
    return { type: auth.type, username: String(auth.username ?? ''), password: String(auth.password ?? ''), token: String(auth.token ?? '') }
}

// Stored (or imported) request → editable state, with fresh row objects so
// that saved items are never shared with, or changed by, later edits
function hydrate(stored) {
    const rows = (list) => (Array.isArray(list) ? list : []).filter(isObject).map(r => ({ id: newId(), key: String(r.key ?? ''), value: String(r.value ?? '') }))
    const url = typeof stored.url === 'string' ? stored.url : ''
    let headers = rows(stored.headers)
    let auth = normalizeAuth(stored.auth)
    if (!auth) ({ auth, headers } = deriveAuth(headers))
    const body = typeof stored.body === 'string' ? stored.body : ''
    const method = typeof stored.method === 'string' && stored.method.trim() ? stored.method.trim() : 'GET'
    return {
        method: METHODS.includes(method.toUpperCase()) ? method.toUpperCase() : method,
        url,
        params: parseQueryRows(url),
        headers,
        bodyType: BODY_TYPE_VALUES.has(stored.bodyType) ? stored.bodyType : guessBodyType(headerValue(headers, 'content-type'), body),
        body,
        form: rows(stored.form),
        auth,
        options: { timeout: clampTimeout(stored.options?.timeout), credentials: Boolean(stored.options?.credentials) },
    }
}

// Editable state → plain data for history and saved requests
function dehydrate(req) {
    const keep = (list) => list.filter(r => r.key.trim() || r.value.trim()).map(({ key, value }) => ({ key, value }))
    return {
        method: req.method,
        url: req.url,
        headers: keep(req.headers),
        bodyType: req.bodyType,
        body: req.body,
        form: keep(req.form),
        auth: { ...req.auth },
        options: { ...req.options },
    }
}

const signature = (stored) => JSON.stringify([stored.method, stored.url, stored.headers, stored.bodyType, stored.body, stored.form, stored.auth])

/**
 * What would actually be sent: variables replaced, auth and Content-Type
 * headers added. With `forCode`, Basic auth stays as { username, password }
 * so that the generated code can use curl -u or requests' auth=.
 */
function resolveRequest(req, vars, { forCode = false } = {}) {
    const unresolved = new Set()
    const sub = vars ? (text) => substitute(text, vars, unresolved) : (text) => String(text ?? '')
    const url = sub(req.url.trim())
    const urlUnresolved = [...unresolved]
    const method = req.method
    const formRows = req.form.filter(f => f.key.trim())
    const hasContent = req.bodyType === 'multipart' ? formRows.length > 0 : req.body !== ''
    const sendsBody = !NO_BODY.has(method) && req.bodyType !== 'none' && hasContent
    const authActive = (req.auth.type === 'basic' && (req.auth.username || req.auth.password)) || (req.auth.type === 'bearer' && req.auth.token.trim())

    let headers = req.headers.filter(h => h.key.trim()).map(h => ({ key: sub(h.key.trim()), value: sub(h.value) }))
    const ignoredAuthHeader = Boolean(authActive) && headers.some(h => h.key.toLowerCase() === 'authorization')
    if (authActive) headers = headers.filter(h => h.key.toLowerCase() !== 'authorization')

    let auth = null
    if (authActive && req.auth.type === 'basic') {
        const username = sub(req.auth.username)
        const password = sub(req.auth.password)
        if (forCode) auth = { username, password }
        else headers.push({ key: 'Authorization', value: `Basic ${base64Utf8(`${username}:${password}`)}` })
    } else if (authActive && req.auth.type === 'bearer') {
        headers.push({ key: 'Authorization', value: `Bearer ${sub(req.auth.token).trim()}` })
    }

    let droppedMultipartType = false
    if (sendsBody && req.bodyType === 'multipart') {
        const before = headers.length
        headers = headers.filter(h => !(h.key.toLowerCase() === 'content-type' && /multipart\/form-data/i.test(h.value)))
        droppedMultipartType = headers.length !== before
    } else if (sendsBody && !headers.some(h => h.key.toLowerCase() === 'content-type')) {
        const type = BODY_TYPES.find(t => t.value === req.bodyType)?.contentType
        if (type) headers.push({ key: 'Content-Type', value: type })
    }

    return {
        method,
        url,
        headers,
        body: sendsBody && req.bodyType !== 'multipart' ? sub(req.body) : '',
        form: sendsBody && req.bodyType === 'multipart' ? formRows.map(f => ({ key: sub(f.key.trim()), value: sub(f.value) })) : [],
        auth,
        unresolved: [...unresolved],
        urlUnresolved,
        ignoredAuthHeader,
        droppedMultipartType,
        bodyIgnored: NO_BODY.has(method) && req.bodyType !== 'none' && hasContent,
    }
}

function validateTarget(resolved) {
    if (resolved.urlUnresolved.length) return { kind: 'unresolved', names: resolved.urlUnresolved }
    const text = resolved.url
    if (!text) return { kind: 'invalid-url', message: 'Enter the URL to send the request to.' }
    let url
    try {
        url = new URL(text)
    } catch {
        if (looksLikeHost(text)) return { kind: 'invalid-url', message: 'The URL has no scheme. Requests need an absolute URL that starts with https:// or http://.', suggestion: `https://${text}` }
        return { kind: 'invalid-url', message: 'This isn\'t a valid absolute URL. It should look like https://api.example.com/users.' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        if (looksLikeHost(text)) return { kind: 'invalid-url', message: `“${url.protocol}” was read as the scheme. Requests need an absolute URL that starts with https:// or http://.`, suggestion: `https://${text}` }
        return { kind: 'invalid-url', message: `A browser can only send HTTP requests, so the URL must start with https:// or http://, not ${url.protocol}//.` }
    }
    return { url }
}

// Why the browser has to send a CORS preflight (OPTIONS) first
function preflightReasons(resolved) {
    const reasons = []
    if (!['GET', 'HEAD', 'POST'].includes(resolved.method)) reasons.push(`the ${resolved.method} method`)
    for (const h of resolved.headers) {
        const name = h.key.toLowerCase()
        if (isForbiddenHeader(name)) continue
        if (name === 'content-type') {
            const type = h.value.split(';')[0].trim().toLowerCase()
            if (!SAFELISTED_TYPES.includes(type)) reasons.push(`Content-Type: ${type}`)
        } else if (!['accept', 'accept-language', 'content-language'].includes(name)) {
            reasons.push(`the ${h.key} header`)
        }
    }
    return [...new Set(reasons)]
}

// --------------------------------------------------------- responses ---

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|x-ndjson|ld\+json|problem\+json|yaml|x-yaml|toml|sql)|image\/svg\+xml)|[+](json|xml)\b/i

function isTextual(contentType, bytes) {
    if (contentType) return TEXT_TYPES.test(contentType)
    // No Content-Type: treat it as text unless it has NUL bytes
    const sample = bytes.subarray(0, 4096)
    return !sample.includes(0)
}

function languageFor(contentType, text) {
    const ct = contentType.toLowerCase()
    if (ct.includes('json')) return 'json'
    if (ct.includes('html') || ct.includes('xml') || ct.includes('svg')) return 'markup'
    if (ct.includes('javascript') || ct.includes('ecmascript')) return 'javascript'
    if (ct.includes('css')) return 'css'
    if (!ct && /^\s*[[{]/.test(text)) return 'json'
    return 'text'
}

function decodeText(buffer, contentType) {
    const charset = /charset=["']?([^;"'\s]+)/i.exec(contentType)?.[1]
    try {
        return new TextDecoder(charset || 'utf-8').decode(buffer)
    } catch {
        return new TextDecoder('utf-8').decode(buffer)
    }
}

// Re-indents valid JSON by changing whitespace only, so big numbers and
// escapes stay exactly as the server sent them
function prettyJson(text) {
    const out = []
    let indent = 0
    let inString = false
    const newline = () => '\n' + '  '.repeat(indent)
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (inString) {
            out.push(c)
            if (c === '\\') out.push(text[++i] ?? '')
            else if (c === '"') inString = false
            continue
        }
        if (c === '"') {
            inString = true
            out.push(c)
        } else if (c === '{' || c === '[') {
            let j = i + 1
            while (j < text.length && /\s/.test(text[j])) j++
            if (text[j] === (c === '{' ? '}' : ']')) {
                out.push(c, text[j])
                i = j
            } else {
                indent++
                out.push(c, newline())
            }
        } else if (c === '}' || c === ']') {
            indent--
            out.push(newline(), c)
        } else if (c === ',') {
            out.push(',', newline())
        } else if (c === ':') {
            out.push(': ')
        } else if (!/\s/.test(c)) {
            out.push(c)
        }
    }
    return out.join('')
}

function buildResponse(res, buffer, { ttfb, total, method }) {
    const contentType = res.headers.get('content-type') || ''
    const bytes = new Uint8Array(buffer)
    const size = buffer.byteLength
    const isImage = /^image\//i.test(contentType)
    const textual = size > 0 && isTextual(contentType, bytes)
    let text = null
    let pretty = null
    let language = 'text'
    if (textual) {
        text = decodeText(buffer, contentType)
        language = languageFor(contentType, text)
        if (language === 'json' && text.length <= 5_000_000) {
            try {
                JSON.parse(text)
                pretty = prettyJson(text)
            } catch {
                language = 'text'
            }
        }
    }
    let kind = 'binary'
    if (size === 0) kind = 'empty'
    else if (/html/i.test(contentType) && textual) kind = 'html'
    else if (isImage) kind = 'image'
    else if (textual) kind = 'text'
    return {
        status: res.status,
        statusText: res.statusText || getStatusText(res.status),
        url: res.url,
        redirected: res.redirected,
        type: res.type,
        headers: [...res.headers.entries()],
        contentType,
        size,
        ttfb,
        time: total,
        kind,
        text,
        pretty,
        language,
        blob: new Blob([buffer], { type: contentType || 'application/octet-stream' }),
        method,
    }
}

function formatDuration(ms) {
    if (ms < 1000) return `${Math.round(ms)} ms`
    return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

function fileNameFor(response) {
    let name = 'response'
    try {
        const last = new URL(response.url).pathname.split('/').filter(Boolean).pop()
        if (last) name = last
    } catch {
        // keep the default
    }
    const ext = { json: 'json', markup: response.kind === 'html' ? 'html' : 'xml', javascript: 'js', css: 'css' }[response.language]
    if (!/\.\w{1,5}$/.test(name)) {
        const sub = response.contentType.split(';')[0].split('/')[1]
        name += `.${ext || (response.kind === 'image' && sub ? sub.replace('svg+xml', 'svg') : response.kind === 'text' ? 'txt' : 'bin')}`
    }
    return name
}

function withBase(html, url) {
    if (!url) return html
    const tag = `<base href="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + tag) : tag + html
}

function selectAllWithin(event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        const range = document.createRange()
        range.selectNodeContents(event.currentTarget)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
    }
}

async function probeReachability(url) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
        await fetch(url, { mode: 'no-cors', method: 'HEAD', cache: 'no-store', credentials: 'omit', signal: controller.signal })
        return 'reachable'
    } catch {
        return 'unreachable'
    } finally {
        clearTimeout(timer)
    }
}

// --------------------------------------------------- small components ---

function MethodLabel({ method, style }) {
    return <span className="mono" style={{ fontWeight: 700, fontSize: '0.75rem', color: METHOD_COLORS[method] ?? 'var(--text-muted)', ...style }}>{method}</span>
}

function StatusBadge({ status, text }) {
    const cat = getStatusCategory(status)
    const style = cat ? { color: cat.color, background: cat.bg, borderColor: cat.border } : { color: 'var(--danger)', background: 'var(--danger-bg)', borderColor: 'var(--danger-border)' }
    return <span className="badge mono" style={{ ...style, fontSize: '0.8rem' }}>{status ? `${status} ${text}`.trim() : text}</span>
}

function KeyValueEditor({ rows, onChange, noun, keyPlaceholder = 'Name', valuePlaceholder = 'Value', suggestions, rowNote, valueType = 'text' }) {
    const listId = useId()
    const update = (id, field, value) => onChange(rows.map(r => (r.id === id ? { ...r, [field]: value } : r)))
    const remove = (id) => onChange(rows.filter(r => r.id !== id))
    const add = () => onChange([...rows, { id: newId(), key: '', value: '' }])
    const compactInput = { padding: '0.5rem 0.65rem', fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {suggestions && (
                <datalist id={listId}>
                    {suggestions.map(s => <option key={s} value={s} />)}
                </datalist>
            )}
            {rows.length === 0 && <p className="field-hint" style={{ marginTop: 0 }}>No {noun}s yet.</p>}
            {rows.map((row, i) => {
                const note = rowNote?.(row)
                return (
                    <div key={row.id}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) auto', gap: 'var(--space-xs)', alignItems: 'center' }}>
                            <input
                                type="text"
                                value={row.key}
                                onChange={e => update(row.id, 'key', e.target.value)}
                                placeholder={keyPlaceholder}
                                aria-label={`${noun} ${i + 1} name`}
                                list={suggestions ? listId : undefined}
                                spellCheck={false}
                                autoComplete="off"
                                style={compactInput}
                            />
                            <input
                                type={valueType}
                                value={row.value}
                                onChange={e => update(row.id, 'value', e.target.value)}
                                placeholder={valuePlaceholder}
                                aria-label={`${noun} ${i + 1} value`}
                                spellCheck={false}
                                autoComplete="off"
                                style={compactInput}
                            />
                            <button type="button" className="icon-btn" onClick={() => remove(row.id)} aria-label={`Remove ${noun} ${i + 1}`}>
                                <Trash2 size={16} aria-hidden="true" />
                            </button>
                        </div>
                        {note && (
                            <div className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--warning)' }}>
                                <TriangleAlert size={12} aria-hidden="true" /> {note}
                            </div>
                        )}
                    </div>
                )
            })}
            <div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={add} style={{ color: 'var(--primary-text)' }}>
                    <Plus size={14} aria-hidden="true" /> Add {noun}
                </button>
            </div>
        </div>
    )
}

// ---------------------------------------------------------- modals ---

function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose }) {
    return (
        <Modal
            open
            onClose={onClose}
            title={title}
            size="sm"
            footer={(
                <>
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-danger" onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
                </>
            )}
        >
            <p style={{ color: 'var(--text-muted)' }}>{message}</p>
        </Modal>
    )
}

function SaveModal({ defaultName, existingNames, onSave, onClose }) {
    const formId = useId()
    const inputRef = useRef(null)
    const [name, setName] = useState(defaultName)
    const [error, setError] = useState(null)
    const replaces = existingNames.includes(name.trim())

    const submit = (event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) {
            setError('Give the request a name.')
            return
        }
        onSave(trimmed)
    }

    return (
        <Modal
            open
            onClose={onClose}
            title="Save request"
            size="sm"
            initialFocusRef={inputRef}
            footer={(
                <>
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" form={formId} className="btn btn-primary"><Save size={16} aria-hidden="true" /> {replaces ? 'Replace' : 'Save'}</button>
                </>
            )}
        >
            <form id={formId} onSubmit={submit}>
                <Field label="Name" error={error} hint={replaces ? 'Replaces the saved request with this name.' : 'Saved with its headers, auth and body, in this browser only.'}>
                    <input ref={inputRef} type="text" value={name} onChange={e => { setName(e.target.value); setError(null) }} placeholder="Get user profile" autoComplete="off" />
                </Field>
            </form>
        </Modal>
    )
}

function ImportModal({ onImport, onClose }) {
    const fieldId = useId()
    const inputRef = useRef(null)
    const [text, setText] = useState('')
    const [error, setError] = useState(null)

    const submit = () => {
        const result = onImport(text)
        if (result.ok) onClose()
        else setError(result.error)
    }

    return (
        <Modal
            open
            onClose={onClose}
            title="Import cURL"
            size="md"
            initialFocusRef={inputRef}
            footer={(
                <>
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={submit} disabled={!text.trim()}><Import size={16} aria-hidden="true" /> Import</button>
                </>
            )}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <Field label="cURL command" hint="Bash or Windows cmd syntax, e.g. from Chrome DevTools: right-click a request → Copy → Copy as cURL. Replaces the current request.">
                    <textarea
                        id={fieldId}
                        ref={inputRef}
                        value={text}
                        onChange={e => { setText(e.target.value); setError(null) }}
                        onKeyDown={e => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                e.preventDefault()
                                e.stopPropagation()
                                if (text.trim()) submit()
                            }
                        }}
                        placeholder={"curl 'https://api.example.com/items' \\\n  -H 'Authorization: Bearer …' \\\n  --data-raw '{\"name\":\"Ada\"}'"}
                        spellCheck={false}
                        rows={8}
                        style={{ fontSize: '0.85rem' }}
                    />
                </Field>
                {error && <StatusBanner tone="danger" title="Can't import this command">{error}</StatusBanner>}
            </div>
        </Modal>
    )
}

function CodeModal({ req, vars, envName, onClose }) {
    const substituteId = useId()
    const [storedTarget, setTarget] = useLocalStorage('api-code-target', 'curl')
    const target = CODE_TARGETS.some(t => t.value === storedTarget) ? storedTarget : 'curl'
    const [useVars, setUseVars] = useState(true)

    const resolved = useMemo(() => resolveRequest(req, useVars ? vars : null, { forCode: true }), [req, vars, useVars])
    const code = useMemo(() => generateCode({
        method: resolved.method,
        url: resolved.url,
        headers: resolved.headers,
        body: resolved.body,
        form: resolved.form,
        auth: resolved.auth,
        options: { credentials: req.options.credentials ? 'include' : undefined },
    }, target), [resolved, target, req.options.credentials])

    return (
        <Modal open onClose={onClose} title="Generate code" size="lg">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', alignItems: 'center', justifyContent: 'space-between' }}>
                    <SegmentedControl ariaLabel="Language" value={target} onChange={setTarget} options={CODE_TARGETS.map(t => ({ value: t.value, label: t.label, title: t.title }))} />
                    <label htmlFor={substituteId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        <input id={substituteId} type="checkbox" checked={useVars} onChange={e => setUseVars(e.target.checked)} />
                        Fill in variables from “{envName}”
                    </label>
                </div>
                {useVars && resolved.unresolved.length > 0 && (
                    <StatusBanner tone="warning" title="Some variables aren't defined">
                        {resolved.unresolved.map(n => `{{${n}}}`).join(', ')} {resolved.unresolved.length === 1 ? 'is' : 'are'} left as written.
                    </StatusBanner>
                )}
                <CodeBlock code={code} language={targetLanguage(target)} title={CODE_TARGETS.find(t => t.value === target).title} copyLabel="Copy code" maxHeight={420} />
            </div>
        </Modal>
    )
}

function EnvModal({ envs, activeId, setEnvs, setActiveId, onClose }) {
    const nameId = useId()
    const revealId = useId()
    const [editingId, setEditingId] = useState(activeId)
    const [reveal, setReveal] = useState(false)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const editing = envs.find(e => e.id === editingId) ?? envs[0]

    const update = (fn) => setEnvs(prev => normalizeEnvs(prev).map(e => (e.id === editing.id ? fn(e) : e)))
    const create = () => {
        const id = `env-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        setEnvs(prev => [...normalizeEnvs(prev), { id, name: 'New environment', vars: [] }])
        setEditingId(id)
        setConfirmDelete(false)
    }
    const remove = () => {
        const remaining = envs.filter(e => e.id !== editing.id)
        setEnvs(prev => {
            const list = normalizeEnvs(prev).filter(e => e.id !== editing.id)
            return list.length ? list : DEFAULT_ENVS
        })
        const next = remaining[0] ?? DEFAULT_ENVS[0]
        if (activeId === editing.id) setActiveId(next.id)
        setEditingId(next.id)
        setConfirmDelete(false)
    }

    return (
        <Modal open onClose={onClose} title="Environments" size="lg" footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-lg)' }}>
                <nav aria-label="Environments" style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                    {envs.map(env => (
                        <button
                            key={env.id}
                            type="button"
                            className={`btn btn-sm ${env.id === editing.id ? 'btn-secondary' : 'btn-ghost'}`}
                            aria-current={env.id === editing.id ? 'true' : undefined}
                            onClick={() => { setEditingId(env.id); setConfirmDelete(false) }}
                            style={{ justifyContent: 'space-between', whiteSpace: 'normal', textAlign: 'left', color: env.id === editing.id ? 'var(--text-main)' : undefined }}
                        >
                            <span style={{ overflowWrap: 'anywhere' }}>{env.name}</span>
                            {env.id === activeId && <span className="badge badge-success">In use</span>}
                        </button>
                    ))}
                    <button type="button" className="btn btn-sm btn-outline" onClick={create} style={{ marginTop: 'var(--space-xs)' }}>
                        <Plus size={14} aria-hidden="true" /> New environment
                    </button>
                </nav>

                <div style={{ flex: '999 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <Field label="Name" style={{ flex: '1 1 200px' }}>
                            <input id={nameId} type="text" value={editing.name} onChange={e => update(env => ({ ...env, name: e.target.value }))} style={{ padding: '0.55rem 0.75rem' }} />
                        </Field>
                        {editing.id === activeId ? (
                            <span className="badge badge-success" style={{ marginBottom: 10 }}><Check size={12} aria-hidden="true" /> Used for requests</span>
                        ) : (
                            <button type="button" className="btn btn-secondary" onClick={() => setActiveId(editing.id)}>Use for requests</button>
                        )}
                    </div>

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                            <h3 className="section-title">Variables</h3>
                            <label htmlFor={revealId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                <input id={revealId} type="checkbox" checked={reveal} onChange={e => setReveal(e.target.checked)} /> Show values
                            </label>
                        </div>
                        <KeyValueEditor
                            rows={editing.vars}
                            onChange={vars => update(env => ({ ...env, vars }))}
                            noun="variable"
                            keyPlaceholder="base_url"
                            valuePlaceholder="https://api.example.com"
                            valueType={reveal ? 'text' : 'password'}
                        />
                        <p className="field-hint">
                            Write <code className="mono">{'{{name}}'}</code> in the URL, params, headers, auth or body. Names may use letters, digits, _ . and -.
                            Values are filled in when sending and are stored in this browser only.
                        </p>
                        {editing.vars.some(v => v.key && !/^[\w.-]+$/.test(v.key.trim())) && (
                            <p className="field-error">Some names have characters that can't be used in {'{{…}}'}; they won't be replaced.</p>
                        )}
                    </div>

                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
                        {!confirmDelete ? (
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(true)} style={{ color: 'var(--danger)' }}>
                                <Trash2 size={14} aria-hidden="true" /> Delete “{editing.name}”
                            </button>
                        ) : (
                            <>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Delete this environment and its {plural(editing.vars.length, 'variable')}?</span>
                                <button type="button" className="btn btn-sm btn-danger" onClick={remove}>Delete</button>
                                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    )
}

// ----------------------------------------------------- response panel ---

function NetworkHelp({ failure, onProbe }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            <p>The browser doesn't tell pages why a request failed. Likely causes:</p>
            <ul style={{ paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {failure.offline && <li><strong style={{ color: 'var(--text-main)' }}>You're offline.</strong> Check your connection.</li>}
                {failure.mixedContent && (
                    <li><strong style={{ color: 'var(--text-main)' }}>Mixed content:</strong> this page is served over https://, so the browser blocks plain http:// requests. Use https:// if the API supports it.</li>
                )}
                <li>
                    <strong style={{ color: 'var(--text-main)' }}>CORS:</strong> the server has to allow requests from {failure.origin} with an Access-Control-Allow-Origin header.
                    {failure.preflight.length > 0 && <> This request also needs a preflight (OPTIONS) because of {failure.preflight.join(', ')}, which the server must allow too.</>}
                    {failure.credentials && <> With “Send cookies” on, it must also send Access-Control-Allow-Credentials: true and name this origin exactly.</>}
                </li>
                <li><strong style={{ color: 'var(--text-main)' }}>The server can't be reached:</strong> a wrong host name, DNS failure, refused connection or an invalid TLS certificate.</li>
                <li><strong style={{ color: 'var(--text-main)' }}>An extension</strong>, such as an ad or privacy blocker, cancelled it.</li>
            </ul>
            <p>The browser's developer console shows the exact reason. Code from the Code button runs outside the browser, where CORS doesn't apply.</p>
            {failure.canProbe && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={onProbe} disabled={failure.probe === 'checking'}>
                        {failure.probe === 'checking' ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Globe size={14} aria-hidden="true" />} Check if the server is reachable
                    </button>
                    <span role="status" style={{ fontSize: '0.85rem' }}>
                        {failure.probe === 'reachable' && 'The server answered a simple no-CORS request, so it is reachable: CORS (or the preflight) is the likely cause.'}
                        {failure.probe === 'unreachable' && 'Even a simple request got no answer, so the server is probably unreachable, or an extension blocked it.'}
                    </span>
                </div>
            )}
        </div>
    )
}

function FailureView({ failure, envName, onUseSuggestion, onManageEnvs, onProbe }) {
    switch (failure.kind) {
        case 'invalid-url':
            return (
                <StatusBanner
                    tone="danger"
                    title="Can't send: the URL isn't valid"
                    action={failure.suggestion && <button type="button" className="btn btn-sm btn-secondary" onClick={() => onUseSuggestion(failure.suggestion)}>Use https://</button>}
                >
                    {failure.message}
                </StatusBanner>
            )
        case 'unresolved':
            return (
                <StatusBanner tone="danger" title="Can't send: the URL uses undefined variables" action={<button type="button" className="btn btn-sm btn-secondary" onClick={onManageEnvs}>Environments</button>}>
                    {failure.names.map(n => `{{${n}}}`).join(', ')} {failure.names.length === 1 ? 'isn\'t' : 'aren\'t'} defined in the “{envName}” environment.
                </StatusBanner>
            )
        case 'setup':
            return <StatusBanner tone="danger" title="The browser refused to send this request">{failure.message}</StatusBanner>
        case 'timeout':
            return (
                <StatusBanner tone="danger" title={`No response within ${failure.seconds} s`}>
                    The request was stopped. Check that the server is up, or raise the timeout in the Options tab.
                </StatusBanner>
            )
        case 'cancelled':
            return <StatusBanner tone="info" title="Request cancelled">No response was received.</StatusBanner>
        default:
            return (
                <StatusBanner tone="danger" title="No response: the request was blocked or the server couldn't be reached">
                    <NetworkHelp failure={failure} onProbe={onProbe} />
                </StatusBanner>
            )
    }
}

function ResponseView({ response, tab, setTab, mode, setMode }) {
    const previewable = response.kind === 'image' || response.kind === 'html'
    const activeTab = tab === 'preview' && !previewable ? 'body' : tab
    const imageUrl = useObjectURL(response.kind === 'image' && activeTab === 'preview' ? response.blob : null)

    const fullText = mode === 'pretty' && response.pretty ? response.pretty : response.text
    const shown = useMemo(() => (fullText && fullText.length > DISPLAY_LIMIT ? fullText.slice(0, DISPLAY_LIMIT) : fullText), [fullText])
    const truncated = Boolean(fullText && fullText.length > DISPLAY_LIMIT)
    const headerText = useMemo(() => response.headers.map(([k, v]) => `${k}: ${v}`).join('\n'), [response.headers])
    const srcDoc = useMemo(() => (response.kind === 'html' ? withBase(response.text, response.url) : ''), [response])

    const tabs = [
        { value: 'body', label: 'Body' },
        ...(previewable ? [{ value: 'preview', label: 'Preview' }] : []),
        { value: 'headers', label: `Headers (${response.headers.length})` },
    ]

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                <SegmentedControl ariaLabel="Response view" size="sm" value={activeTab} onChange={setTab} options={tabs} />
                <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                    {activeTab === 'body' && response.pretty && (
                        <SegmentedControl ariaLabel="Body format" size="sm" value={mode} onChange={setMode} options={[{ value: 'pretty', label: 'Pretty' }, { value: 'raw', label: 'Raw' }]} />
                    )}
                    {activeTab === 'headers'
                        ? <CopyButton text={headerText} label="Copy headers" />
                        : response.text !== null && <CopyButton text={fullText ?? ''} label="Copy body" />}
                    {response.size > 0 && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadBlob(response.blob, fileNameFor(response))}>
                            <Download size={14} aria-hidden="true" /> Download
                        </button>
                    )}
                </div>
            </div>

            {activeTab === 'body' && (
                <>
                    {response.kind === 'empty' && (
                        <p className="code-well" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-family)' }}>
                            No body{response.method === 'HEAD' ? ' (HEAD responses never have one)' : response.status === 204 ? ' (204 No Content)' : response.status === 304 ? ' (304 Not Modified)' : ''}.
                        </p>
                    )}
                    {response.text === null && response.kind !== 'empty' && (
                        <div className="code-well" style={{ fontFamily: 'var(--font-family)', color: 'var(--text-muted)' }}>
                            Binary response: {response.contentType || 'unknown type'}, {formatBytes(response.size)}.
                            {response.kind === 'image' ? ' See the Preview tab, or download it.' : ' Download it to open it.'}
                        </div>
                    )}
                    {shown !== null && shown !== undefined && (
                        <div
                            tabIndex={0}
                            role="region"
                            aria-label="Response body. Press Control or Command + A to select all of it."
                            onKeyDown={selectAllWithin}
                            style={{ borderRadius: 'var(--radius-md)', minWidth: 0 }}
                        >
                            <CodeBlock code={shown} language={response.language} maxHeight={BODY_HEIGHT} showCopy={false} />
                        </div>
                    )}
                    {truncated && <p className="field-hint">Only the first {formatBytes(DISPLAY_LIMIT)} are shown. Download the response to see all of it.</p>}
                </>
            )}

            {activeTab === 'preview' && response.kind === 'image' && (
                <div className="stage checkerboard" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 'var(--space-md)' }}>
                    {imageUrl && <img src={imageUrl} alt={`Response image (${response.contentType})`} style={{ maxWidth: '100%', maxHeight: BODY_HEIGHT, objectFit: 'contain' }} />}
                </div>
            )}
            {activeTab === 'preview' && response.kind === 'html' && (
                <>
                    <iframe
                        title="HTML preview"
                        sandbox=""
                        srcDoc={srcDoc}
                        style={{ width: '100%', height: BODY_HEIGHT, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: '#fff' }}
                    />
                    <p className="field-hint" style={{ marginTop: 0 }}>Scripts, forms and pop-ups are disabled in the preview.</p>
                </>
            )}

            {activeTab === 'headers' && (
                <div className="code-well" style={{ padding: 0, fontFamily: 'var(--font-family)', maxHeight: BODY_HEIGHT }}>
                    {response.headers.length === 0 ? (
                        <p style={{ padding: 'var(--space-md)', color: 'var(--text-dim)' }}>No headers are visible to this page.</p>
                    ) : (
                        <dl>
                            {response.headers.map(([k, v], i) => (
                                <div key={`${k}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, 30%) minmax(0, 1fr)', gap: 'var(--space-sm)', padding: '0.45rem var(--space-md)', borderBottom: i === response.headers.length - 1 ? 'none' : '1px solid var(--border)', fontSize: '0.85rem' }}>
                                    <dt className="mono" style={{ color: 'var(--primary-text)', overflowWrap: 'anywhere' }}>{k}</dt>
                                    <dd className="mono" style={{ color: 'var(--text-code)', overflowWrap: 'anywhere' }}>{v}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                </div>
            )}
            {activeTab === 'headers' && response.type === 'cors' && (
                <p className="field-hint" style={{ marginTop: 0 }}>
                    For cross-origin requests, browsers only show Cache-Control, Content-Language, Content-Length, Content-Type, Expires, Last-Modified and Pragma, plus any headers the server lists in Access-Control-Expose-Headers.
                </p>
            )}
        </div>
    )
}

// ------------------------------------------------------------- page ---

export default function ApiTester() {
    const toast = useToast()
    const { size } = usePane()
    const compact = size === 'sm'
    const urlId = useId()
    const methodId = useId()
    const envSelectId = useId()
    const timeoutId = useId()
    const credentialsId = useId()
    const bodyId = useId()
    const tokenId = useId()
    const userId = useId()
    const passId = useId()

    const [history, setHistory] = useLocalStorage('api-history', [])
    const [collections, setCollections] = useLocalStorage('api-collections', [])
    const [storedEnvs, setEnvs] = useLocalStorage('api-envs', DEFAULT_ENVS)
    const [activeEnvId, setActiveEnvId] = useLocalStorage('api-active-env', 'default')

    const envs = useMemo(() => normalizeEnvs(storedEnvs), [storedEnvs])
    const activeEnv = envs.find(e => e.id === activeEnvId) ?? envs[0]
    const vars = useMemo(() => new Map(activeEnv.vars.filter(v => v.key.trim()).map(v => [v.key.trim(), v.value])), [activeEnv])
    const historyList = useMemo(() => (Array.isArray(history) ? history.filter(h => isObject(h) && (isObject(h.request) || typeof h.url === 'string')) : []), [history])
    const savedList = useMemo(() => (Array.isArray(collections) ? collections.filter(c => isObject(c) && c.id !== undefined) : []), [collections])

    const [req, setReq] = useState(() => hydrate(DEFAULT_REQUEST))
    const [requestTab, setRequestTab] = useState('params')
    const [phase, setPhase] = useState('idle') // idle | loading | done | error
    const [response, setResponse] = useState(null)
    const [failure, setFailure] = useState(null)
    const [notes, setNotes] = useState([])
    const [loadedName, setLoadedName] = useState('')
    const [modal, setModal] = useState(null) // env | save | code | import | { confirm }
    const [dock, setDock] = useState('history')
    const [showPassword, setShowPassword] = useState(false)
    const [responseTab, setResponseTab] = useState('body')
    const [bodyMode, setBodyMode] = useState('pretty')
    const abortRef = useRef(null)

    useEffect(() => () => {
        const run = abortRef.current
        abortRef.current = null
        run?.controller.abort()
    }, [])

    // ------------------------------------------------------ editing ---
    const patch = (changes) => setReq(r => ({ ...r, ...changes }))
    const setUrl = (url) => setReq(r => ({ ...r, url, params: parseQueryRows(url) }))
    const setParams = (params) => setReq(r => ({ ...r, params, url: buildUrl(r.url, params) }))
    const setAuth = (changes) => setReq(r => ({ ...r, auth: { ...r.auth, ...changes } }))
    const setOptions = (changes) => setReq(r => ({ ...r, options: { ...r.options, ...changes } }))

    const replaceRequest = (next, name = '') => {
        const run = abortRef.current
        abortRef.current = null
        run?.controller.abort()
        setReq(next)
        setLoadedName(name)
        setResponse(null)
        setFailure(null)
        setNotes([])
        setPhase('idle')
    }

    // --------------------------------------------------- cURL import ---
    const applyCurl = (text) => {
        const trimmed = String(text ?? '').trim()
        let parsed
        try {
            parsed = parseCurl(trimmed)
        } catch (error) {
            // A plain URL is fine too
            if (/^https?:\/\/\S+$/i.test(trimmed)) {
                setUrl(trimmed)
                return { ok: true, warnings: [] }
            }
            return { ok: false, error: error.message }
        }
        const warnings = [...parsed.warnings]
        const textFields = parsed.form.filter(f => f.file === undefined)
        if (textFields.length !== parsed.form.length) warnings.push('File fields (-F name=@file) can\'t be sent from here and were left out.')
        if (parsed.options.insecure) warnings.push('Browsers always check TLS certificates, so --insecure has no effect here.')
        const forbidden = parsed.headers.filter(h => isForbiddenHeader(h.key)).map(h => h.key)
        if (forbidden.length) warnings.push(`Browsers won't send ${plural(forbidden.length, 'header')} from this command (${forbidden.slice(0, 3).join(', ')}${forbidden.length > 3 ? '…' : ''}); they stay in the Headers tab for generated code.`)

        const contentType = headerValue(parsed.headers, 'content-type') || parsed.implicitContentType || ''
        const bodyType = textFields.length ? 'multipart' : parsed.body ? guessBodyType(contentType, parsed.body) : 'json'
        const next = hydrate({
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers,
            bodyType,
            body: parsed.body,
            form: textFields.map(f => ({ key: f.key, value: f.value })),
            auth: parsed.auth ? { type: 'basic', username: parsed.auth.username, password: parsed.auth.password } : undefined,
            options: { timeout: parsed.options.maxTime ?? req.options.timeout, credentials: req.options.credentials },
        })
        replaceRequest(next)
        setRequestTab(next.body || next.form.length ? 'body' : next.headers.length ? 'headers' : 'params')
        return { ok: true, warnings }
    }

    const importWithFeedback = (text) => {
        const result = applyCurl(text)
        if (!result.ok) return result
        if (result.warnings.length) {
            toast.warning(`Imported, with ${plural(result.warnings.length, 'note')}: ${result.warnings[0]}${result.warnings.length > 1 ? ' …' : ''}`, 9000)
        } else {
            toast.success('cURL command imported')
        }
        return result
    }

    useSmartInput({
        input: (text) => {
            const result = importWithFeedback(text)
            if (!result.ok) toast.error(`Couldn't import the cURL command: ${result.error}`)
        },
    })

    // ------------------------------------------------- history/saved ---
    const addHistory = (stored, status, time) => {
        const entry = { id: `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), status, time: Math.round(time), request: stored }
        if (stored.body.length > HISTORY_BODY_LIMIT) entry.request = { ...stored, body: '', bodyOmitted: true }
        const sig = signature(entry.request)
        setHistory(prev => [entry, ...(Array.isArray(prev) ? prev : []).filter(h => !isObject(h) || !isObject(h.request) || signature(h.request) !== sig)].slice(0, HISTORY_LIMIT))
    }

    const loadEntry = (entry, name = '') => {
        if (isObject(entry.request)) {
            replaceRequest(hydrate(entry.request), name)
            if (entry.request.bodyOmitted) toast.warning('The body of this request was too large to keep in history, so it was left empty.')
        } else if (typeof entry.url === 'string') {
            // Entries saved by older versions: a saved request with top-level
            // fields, or a history item with only the method and URL
            if (entry.headers || entry.body) replaceRequest(hydrate(entry), name)
            else replaceRequest({ ...req, method: entry.method || req.method, url: entry.url, params: parseQueryRows(entry.url) }, name)
        }
    }

    const saveRequest = (name) => {
        const stored = dehydrate(req)
        setCollections(prev => {
            const list = Array.isArray(prev) ? prev.filter(isObject) : []
            const existing = list.find(c => c.name === name)
            const item = { id: existing?.id ?? `c-${Date.now().toString(36)}`, name, at: Date.now(), request: stored }
            return existing ? list.map(c => (c.id === existing.id ? item : c)) : [...list, item]
        })
        setLoadedName(name)
        setDock('saved')
        setModal(null)
        toast.success(`Saved “${name}”`)
    }

    // ----------------------------------------------------------- send ---
    const send = async () => {
        if (phase === 'loading') return
        const resolved = resolveRequest(req, vars)
        const check = validateTarget(resolved)
        if (!check.url) {
            setResponse(null)
            setNotes([])
            setFailure(check)
            setPhase('error')
            return
        }
        const target = check.url

        const sentNotes = []
        const dropped = [...new Set(resolved.headers.filter(h => isForbiddenHeader(h.key)).map(h => h.key))]
        if (dropped.length) sentNotes.push(`The browser doesn't let pages send ${dropped.join(', ')}, so ${dropped.length > 1 ? 'they were' : 'it was'} left out.${dropped.some(d => d.toLowerCase() === 'cookie') ? ' To send this site\'s own cookies, turn on “Send cookies” in Options.' : ''}`)
        if (resolved.unresolved.length) sentNotes.push(`Sent with undefined variables left as written: ${resolved.unresolved.map(n => `{{${n}}}`).join(', ')}.`)
        if (resolved.ignoredAuthHeader) sentNotes.push('The Authorization row in Headers was replaced by the Auth tab.')
        if (resolved.bodyIgnored) sentNotes.push(`${req.method} requests can't have a body in browsers, so the body wasn't sent.`)
        if (resolved.droppedMultipartType) sentNotes.push('The multipart Content-Type header was left out so the browser can add the boundary.')

        const mixedContent = window.location.protocol === 'https:' && target.protocol === 'http:' && !isLocalHost(target.hostname)
        const controller = new AbortController()
        const run = { controller, reason: null }
        abortRef.current?.controller.abort()
        abortRef.current = run
        const seconds = req.options.timeout
        const timer = setTimeout(() => {
            run.reason = 'timeout'
            controller.abort()
        }, seconds * 1000)

        setPhase('loading')
        setFailure(null)
        setResponse(null)
        setNotes(sentNotes)
        const stored = dehydrate(req)
        const startedAt = performance.now()

        try {
            const headers = new Headers()
            for (const h of resolved.headers) {
                try {
                    headers.append(h.key, h.value)
                } catch {
                    throw Object.assign(new Error(`The header “${h.key}” can't be sent. Names may only use letters, digits and !#$%&'*+-.^_\`|~, and values must be Latin-1 text without line breaks.`), { setup: true })
                }
            }
            let body
            if (resolved.form.length) {
                body = new FormData()
                resolved.form.forEach(f => body.append(f.key, f.value))
            } else if (resolved.body !== '') {
                body = resolved.body
            }
            const res = await fetch(target.href, {
                method: resolved.method,
                headers,
                body,
                signal: controller.signal,
                credentials: req.options.credentials ? 'include' : 'same-origin',
                cache: 'no-store',
                redirect: 'follow',
            })
            const ttfb = performance.now() - startedAt
            const buffer = await res.arrayBuffer()
            const total = performance.now() - startedAt
            if (abortRef.current !== run) return
            setResponse(buildResponse(res, buffer, { ttfb, total, method: resolved.method }))
            setPhase('done')
            addHistory(stored, res.status, total)
        } catch (error) {
            if (abortRef.current !== run) return
            const elapsed = performance.now() - startedAt
            let info
            if (error.setup) info = { kind: 'setup', message: error.message }
            else if (run.reason === 'timeout') info = { kind: 'timeout', seconds }
            else if (error.name === 'AbortError') info = { kind: 'cancelled' }
            else if (error instanceof TypeError && /Failed to execute|Invalid (name|value|method)|is not a valid|cannot have body|forbidden method/i.test(error.message)) info = { kind: 'setup', message: error.message }
            else {
                info = {
                    kind: 'network',
                    message: error.message,
                    url: target.href,
                    origin: window.location.origin,
                    offline: navigator.onLine === false,
                    mixedContent,
                    credentials: req.options.credentials,
                    preflight: preflightReasons(resolved),
                    // Cross-origin isolation (COEP) blocks the no-cors probe
                    canProbe: !window.crossOriginIsolated && !mixedContent,
                    probe: null,
                }
            }
            setFailure({ ...info, elapsed })
            setPhase('error')
            if (info.kind === 'network' || info.kind === 'timeout') addHistory(stored, 0, elapsed)
        } finally {
            clearTimeout(timer)
            if (abortRef.current === run) abortRef.current = null
        }
    }

    const cancel = () => {
        const run = abortRef.current
        if (run) {
            run.reason = 'cancel'
            run.controller.abort()
        }
    }

    const probe = async () => {
        const url = failure?.url
        if (!url) return
        setFailure(f => (f && f.url === url ? { ...f, probe: 'checking' } : f))
        const result = await probeReachability(url)
        setFailure(f => (f && f.url === url ? { ...f, probe: result } : f))
    }

    // ---------------------------------------------------- derived UI ---
    const usedVars = useMemo(() => {
        const used = new Set()
        collectVars(req.url, used)
        req.headers.forEach(h => { collectVars(h.key, used); collectVars(h.value, used) })
        if (req.bodyType === 'multipart') req.form.forEach(f => { collectVars(f.key, used); collectVars(f.value, used) })
        else if (req.bodyType !== 'none') collectVars(req.body, used)
        if (req.auth.type === 'basic') { collectVars(req.auth.username, used); collectVars(req.auth.password, used) }
        if (req.auth.type === 'bearer') collectVars(req.auth.token, used)
        return used
    }, [req])
    const missingVars = [...usedVars].filter(name => !vars.has(name))
    const previewUrl = substitute(req.url.trim(), vars)
    let mixedContentWarning = false
    try {
        const u = new URL(previewUrl)
        mixedContentWarning = typeof window !== 'undefined' && window.location.protocol === 'https:' && u.protocol === 'http:' && !isLocalHost(u.hostname)
    } catch {
        // not a valid URL yet
    }
    const authHeaderRow = req.headers.find(h => h.key.trim().toLowerCase() === 'authorization')
    const authActive = req.auth.type !== 'none'
    const bodyCount = req.bodyType === 'multipart' ? req.form.filter(f => f.key.trim()).length : req.body ? 1 : 0
    const jsonError = useMemo(() => {
        if (req.bodyType !== 'json' || !req.body.trim() || req.body.length > 2_000_000) return null
        const filled = substitute(req.body, vars)
        try {
            JSON.parse(filled)
            return null
        } catch (error) {
            // Undefined {{variables}} can't be checked
            return filled.includes('{{') ? null : error.message
        }
    }, [req.bodyType, req.body, vars])
    const contentTypeRow = headerValue(req.headers, 'content-type')
    const autoContentType = BODY_TYPES.find(t => t.value === req.bodyType)?.contentType
    const methods = METHODS.includes(req.method) ? METHODS : [...METHODS, req.method]
    const loading = phase === 'loading'

    const onKeyDown = (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.target.closest?.('[role="dialog"]')) {
            event.preventDefault()
            send()
        }
    }

    const setDot = <><span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} /><span className="sr-only">(set)</span></>
    const tabOptions = [
        { value: 'params', label: `Params${req.params.length ? ` (${req.params.length})` : ''}` },
        { value: 'auth', label: <>Auth{authActive && setDot}</> },
        { value: 'headers', label: `Headers${req.headers.length ? ` (${req.headers.length})` : ''}` },
        { value: 'body', label: <>Body{bodyCount > 0 && !NO_BODY.has(req.method) && req.bodyType !== 'none' && setDot}</> },
        { value: 'options', label: 'Options' },
    ]

    return (
        <div className="page page-wide" onKeyDown={onKeyDown}>
            <ToolHeader />

            {/* Request line */}
            <form
                className="card card-compact"
                aria-label="Request"
                onSubmit={event => {
                    event.preventDefault()
                    send()
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}
            >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
                    <label htmlFor={methodId} className="sr-only">Method</label>
                    <select
                        id={methodId}
                        value={req.method}
                        onChange={e => patch({ method: e.target.value })}
                        style={{ width: 'auto', flex: '0 0 auto', padding: '0.6rem 0.5rem', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem', color: METHOD_COLORS[req.method] ?? 'var(--text-main)' }}
                    >
                        {methods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <label htmlFor={urlId} className="sr-only">URL</label>
                    <input
                        id={urlId}
                        type="text"
                        inputMode="url"
                        value={req.url}
                        onChange={e => setUrl(e.target.value)}
                        placeholder="https://api.example.com/users or {{base_url}}/users"
                        spellCheck={false}
                        autoComplete="off"
                        style={{ flex: '1 1 160px', minWidth: 0, width: 'auto', padding: '0.6rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
                    />
                    {/* Separate keys: reusing one element for both would let a Cancel
                        click turn back into a submit and send the request again */}
                    {loading ? (
                        <button key="cancel" type="button" className="btn btn-danger" onClick={cancel} style={{ flex: compact ? '1 1 100%' : '0 0 auto' }}>
                            <Square size={16} aria-hidden="true" /> Cancel
                        </button>
                    ) : (
                        <button key="send" type="submit" className="btn btn-primary" style={{ flex: compact ? '1 1 100%' : '0 0 auto' }} title={`Send (${SEND_SHORTCUT})`}>
                            <Send size={16} aria-hidden="true" /> Send
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center', minWidth: 0 }}>
                        <label htmlFor={envSelectId} className="field-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>
                            {compact ? 'Env' : 'Environment'}
                        </label>
                        <select
                            id={envSelectId}
                            value={activeEnv.id}
                            onChange={e => setActiveEnvId(e.target.value)}
                            style={{ width: 'auto', maxWidth: compact ? 150 : 220, padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                        >
                            {envs.map(e => <option key={e.id} value={e.id}>{e.name} ({plural(e.vars.length, 'var')})</option>)}
                        </select>
                        <button type="button" className="icon-btn" onClick={() => setModal('env')} aria-label="Manage environments" title="Manage environments">
                            <Settings2 size={16} aria-hidden="true" />
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal('import')}>
                            <Import size={14} aria-hidden="true" /> Import cURL
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal('code')} title="Generate cURL, fetch or Python code">
                            <Code2 size={14} aria-hidden="true" /> Code
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal('save')}>
                            <Save size={14} aria-hidden="true" /> Save
                        </button>
                    </div>
                </div>
                {missingVars.length > 0 && (
                    <StatusBanner tone="warning" title="Undefined variables" action={<button type="button" className="btn btn-sm btn-secondary" onClick={() => setModal('env')}>Environments</button>}>
                        {missingVars.map(n => `{{${n}}}`).join(', ')} {missingVars.length === 1 ? 'isn\'t' : 'aren\'t'} set in “{activeEnv.name}”.
                    </StatusBanner>
                )}
                {mixedContentWarning && (
                    <StatusBanner tone="warning" title="This http:// request will probably be blocked">
                        The page is served over https://, and browsers block plain http:// requests from it (mixed content). Use https:// if the API supports it.
                    </StatusBanner>
                )}
            </form>

            <div className="split-pane">
                {/* Request details */}
                <section className="card card-compact" aria-label="Request details" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <SegmentedControl ariaLabel="Request section" size="sm" value={requestTab} onChange={setRequestTab} options={tabOptions} />

                    {requestTab === 'params' && (
                        <>
                            <KeyValueEditor rows={req.params} onChange={setParams} noun="parameter" keyPlaceholder="page" valuePlaceholder="2" />
                            <p className="field-hint" style={{ marginTop: 0 }}>Query parameters and the URL stay in sync. Values are encoded for you; {'{{variables}}'} are kept as written.</p>
                        </>
                    )}

                    {requestTab === 'auth' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                            <SegmentedControl ariaLabel="Authorization type" value={req.auth.type} onChange={type => setAuth({ type })} options={AUTH_TYPES} />
                            {req.auth.type === 'none' && authHeaderRow && (
                                <StatusBanner
                                    tone="info"
                                    title="Using the Authorization header from the Headers tab"
                                    action={deriveAuth(req.headers).auth.type !== 'none' && (
                                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setReq(r => ({ ...r, ...deriveAuth(r.headers) }))}>Edit here</button>
                                    )}
                                >
                                    <span className="mono" style={{ overflowWrap: 'anywhere' }}>{authHeaderRow.value.slice(0, 80)}{authHeaderRow.value.length > 80 ? '…' : ''}</span>
                                </StatusBanner>
                            )}
                            {req.auth.type === 'none' && !authHeaderRow && <p className="field-hint" style={{ marginTop: 0 }}>No Authorization header is sent.</p>}
                            {authActive && authHeaderRow && (
                                <StatusBanner tone="warning">The Authorization row in the Headers tab is ignored while this is set.</StatusBanner>
                            )}
                            {req.auth.type === 'basic' && (
                                <>
                                    <Field label="Username">
                                        <input id={userId} type="text" value={req.auth.username} onChange={e => setAuth({ username: e.target.value })} autoComplete="off" spellCheck={false} />
                                    </Field>
                                    <Field
                                        label="Password"
                                        labelAction={(
                                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowPassword(s => !s)} aria-pressed={showPassword}>
                                                {showPassword ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />} {showPassword ? 'Hide' : 'Show'}
                                            </button>
                                        )}
                                    >
                                        <input id={passId} type={showPassword ? 'text' : 'password'} value={req.auth.password} onChange={e => setAuth({ password: e.target.value })} autoComplete="off" spellCheck={false} />
                                    </Field>
                                    <p className="field-hint" style={{ marginTop: 0 }}>Encoded (UTF-8, Base64) when the request is sent, after {'{{variables}}'} are filled in.</p>
                                </>
                            )}
                            {req.auth.type === 'bearer' && (
                                <Field label="Token" hint="Sent as Authorization: Bearer <token>. {{variables}} work here.">
                                    <textarea id={tokenId} value={req.auth.token} onChange={e => setAuth({ token: e.target.value })} rows={4} spellCheck={false} style={{ minHeight: 0, fontSize: '0.85rem' }} />
                                </Field>
                            )}
                        </div>
                    )}

                    {requestTab === 'headers' && (
                        <>
                            <KeyValueEditor
                                rows={req.headers}
                                onChange={headers => patch({ headers })}
                                noun="header"
                                keyPlaceholder="Header"
                                suggestions={COMMON_HEADERS}
                                rowNote={row => (isForbiddenHeader(row.key) ? 'Browsers don\'t let pages send this header; it only appears in generated code.' : null)}
                            />
                            <p className="field-hint" style={{ marginTop: 0 }}>
                                {[
                                    authActive && 'Authorization comes from the Auth tab.',
                                    !contentTypeRow && autoContentType && bodyCount > 0 && !NO_BODY.has(req.method) && `Content-Type: ${autoContentType} is added for the body.`,
                                    'Header values can use {{variables}}.',
                                ].filter(Boolean).join(' ')}
                            </p>
                        </>
                    )}

                    {requestTab === 'body' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                            <SegmentedControl ariaLabel="Body type" size="sm" value={req.bodyType} onChange={bodyType => patch({ bodyType })} options={BODY_TYPES} />
                            {NO_BODY.has(req.method) && req.bodyType !== 'none' && (
                                <StatusBanner tone="info">{req.method} requests can't have a body in browsers, so it won't be sent. Switch the method to POST, PUT or PATCH to send one.</StatusBanner>
                            )}
                            {req.bodyType === 'none' && <p className="field-hint" style={{ marginTop: 0 }}>No body is sent.</p>}
                            {req.bodyType === 'multipart' && (
                                <>
                                    <KeyValueEditor rows={req.form} onChange={form => patch({ form })} noun="field" keyPlaceholder="name" valuePlaceholder="value" />
                                    <p className="field-hint" style={{ marginTop: 0 }}>Sent as multipart/form-data; the browser sets the boundary. Text fields only: use the generated code for file uploads.</p>
                                </>
                            )}
                            {req.bodyType !== 'none' && req.bodyType !== 'multipart' && (
                                <Field
                                    label="Body"
                                    error={jsonError ? `Not valid JSON: ${jsonError}` : null}
                                    hint={contentTypeRow ? `Sent with Content-Type: ${contentTypeRow} (from the Headers tab).` : `Sent with Content-Type: ${autoContentType}, unless you set one in Headers.`}
                                    labelAction={req.bodyType === 'json' && req.body.trim() && !jsonError && (
                                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch({ body: prettyJson(req.body) })}>Format</button>
                                    )}
                                >
                                    <textarea
                                        id={bodyId}
                                        value={req.body}
                                        onChange={e => patch({ body: e.target.value })}
                                        placeholder={req.bodyType === 'json' ? '{\n  "title": "foo",\n  "userId": 1\n}' : req.bodyType === 'form' ? 'name=Ada&lang=en' : req.bodyType === 'xml' ? '<item>…</item>' : 'Request body'}
                                        spellCheck={false}
                                        rows={10}
                                        style={{ fontSize: '0.85rem' }}
                                    />
                                </Field>
                            )}
                        </div>
                    )}

                    {requestTab === 'options' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                            <Field label="Timeout (seconds)" hint="The request is cancelled if no complete response arrives in time.">
                                <input
                                    id={timeoutId}
                                    type="number"
                                    min={1}
                                    max={600}
                                    value={req.options.timeout}
                                    onChange={e => setOptions({ timeout: clampTimeout(e.target.value) })}
                                    style={{ maxWidth: 140, padding: '0.5rem 0.65rem' }}
                                />
                            </Field>
                            <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start' }}>
                                <input id={credentialsId} type="checkbox" checked={req.options.credentials} onChange={e => setOptions({ credentials: e.target.checked })} style={{ marginTop: 4 }} />
                                <label htmlFor={credentialsId} style={{ fontSize: '0.9rem' }}>
                                    Send cookies
                                    <span className="field-hint" style={{ display: 'block', marginTop: 2 }}>
                                        Includes the browser's own cookies for the target site (credentials: “include”). The server must allow it with Access-Control-Allow-Credentials. A Cookie header can't be set by hand.
                                    </span>
                                </label>
                            </div>
                        </div>
                    )}
                </section>

                {/* Response */}
                <section className="card card-compact" aria-label="Response" aria-busy={loading} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                        <h2 className="section-title">Response</h2>
                        {phase === 'done' && response && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.85rem', color: 'var(--text-muted)' }} role="status">
                                <StatusBadge status={response.status} text={response.statusText} />
                                <span title={`First byte after ${formatDuration(response.ttfb)}`}>
                                    <Clock size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {formatDuration(response.time)}
                                </span>
                                <span>{formatBytes(response.size)}</span>
                            </div>
                        )}
                        {phase === 'error' && failure && (failure.kind === 'network' || failure.kind === 'timeout') && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.85rem', color: 'var(--text-muted)' }} role="status">
                                <StatusBadge status={0} text={failure.kind === 'timeout' ? 'Timed out' : 'No response'} />
                                {failure.elapsed !== undefined && <span>{formatDuration(failure.elapsed)}</span>}
                            </div>
                        )}
                    </div>

                    {notes.length > 0 && phase !== 'idle' && (
                        <StatusBanner tone="warning" title={notes.length === 1 ? 'Note' : 'Notes'}>
                            <ul style={{ paddingLeft: '1.1rem' }}>{notes.map(n => <li key={n}>{n}</li>)}</ul>
                        </StatusBanner>
                    )}

                    {phase === 'idle' && (
                        <EmptyState icon={Send} title="No response yet">
                            Send the request to see its status, headers and body. <span style={{ whiteSpace: 'nowrap' }}><span className="kbd">{SEND_SHORTCUT}</span> sends</span> from anywhere on this page.
                        </EmptyState>
                    )}
                    {loading && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-xl)', color: 'var(--text-muted)' }} role="status">
                            <Loader2 size={28} className="spin" aria-hidden="true" style={{ color: 'var(--primary-text)' }} />
                            Waiting for the response…
                            <button type="button" className="btn btn-sm btn-secondary" onClick={cancel}><X size={14} aria-hidden="true" /> Cancel</button>
                        </div>
                    )}
                    {phase === 'error' && failure && (
                        <FailureView
                            failure={failure}
                            envName={activeEnv.name}
                            onUseSuggestion={suggestion => setUrl(suggestion)}
                            onManageEnvs={() => setModal('env')}
                            onProbe={probe}
                        />
                    )}
                    {phase === 'done' && response && (
                        <>
                            {response.redirected && (
                                <p className="field-hint" style={{ marginTop: 0, overflowWrap: 'anywhere' }}>Redirected to <span className="mono">{response.url}</span></p>
                            )}
                            <ResponseView response={response} tab={responseTab} setTab={setResponseTab} mode={bodyMode} setMode={setBodyMode} />
                        </>
                    )}
                </section>
            </div>

            {/* History and saved requests */}
            <section className="card card-compact" aria-label="History and saved requests" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                    <SegmentedControl
                        ariaLabel="List"
                        size="sm"
                        value={dock}
                        onChange={setDock}
                        options={[
                            { value: 'history', label: `History (${historyList.length})`, icon: History },
                            { value: 'saved', label: `Saved (${savedList.length})`, icon: FolderOpen },
                        ]}
                    />
                    {dock === 'history' && historyList.length > 0 && (
                        <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            style={{ color: 'var(--danger)' }}
                            onClick={() => setModal({ confirm: { title: 'Clear history?', message: `This removes all ${plural(historyList.length, 'request')} from the history in this browser. Saved requests are kept.`, confirmLabel: 'Clear history', onConfirm: () => setHistory([]) } })}
                        >
                            <Trash2 size={14} aria-hidden="true" /> Clear history
                        </button>
                    )}
                </div>

                {dock === 'history' && (historyList.length === 0 ? (
                    <p className="field-hint" style={{ marginTop: 0 }}>Requests you send appear here, newest first (up to {HISTORY_LIMIT}).</p>
                ) : (
                    <ul className="auto-grid" style={{ '--auto-grid-min': '260px', listStyle: 'none', gap: 'var(--space-xs)', maxHeight: 280, overflowY: 'auto' }}>
                        {historyList.map((entry, i) => {
                            const r = isObject(entry.request) ? entry.request : entry
                            const at = entry.at ?? entry.timestamp
                            return (
                                <li key={entry.id ?? `${at}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-subtle)', minWidth: 0 }}>
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-ghost"
                                        onClick={() => loadEntry(entry)}
                                        title={`Load ${r.method} ${r.url}`}
                                        style={{ flex: 1, minWidth: 0, flexDirection: 'column', alignItems: 'stretch', gap: 2, fontWeight: 400, textAlign: 'left' }}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)', minWidth: 0 }}>
                                            <MethodLabel method={r.method} style={{ flexShrink: 0 }} />
                                            <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-main)', fontSize: '0.8rem' }}>{r.url}</span>
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                                            {entry.status !== undefined && <StatusBadge status={entry.status} text={entry.status ? '' : 'failed'} />}
                                            {at && <span>{new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                                            {entry.time !== undefined && <span>{formatDuration(entry.time)}</span>}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-btn icon-btn-sm"
                                        aria-label={`Remove ${r.method} ${r.url} from history`}
                                        onClick={() => setHistory(prev => (Array.isArray(prev) ? prev.filter(h => h !== entry && (!entry.id || h?.id !== entry.id)) : []))}
                                    >
                                        <X size={14} aria-hidden="true" />
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                ))}

                {dock === 'saved' && (savedList.length === 0 ? (
                    <p className="field-hint" style={{ marginTop: 0 }}>Save a request with the Save button to keep it, with its headers, auth and body.</p>
                ) : (
                    <ul className="auto-grid" style={{ '--auto-grid-min': '260px', listStyle: 'none', gap: 'var(--space-xs)', maxHeight: 280, overflowY: 'auto' }}>
                        {savedList.map(item => {
                            const r = isObject(item.request) ? item.request : item
                            return (
                                <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: item.name === loadedName ? 'var(--primary-glow)' : 'var(--bg-subtle)', minWidth: 0 }}>
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-ghost"
                                        onClick={() => loadEntry(item, item.name)}
                                        title={`Load “${item.name}”`}
                                        style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: 'var(--space-sm)', fontWeight: 400, whiteSpace: 'normal', textAlign: 'left' }}
                                    >
                                        <MethodLabel method={r.method} style={{ minWidth: '3.2rem' }} />
                                        <span style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ display: 'block', color: 'var(--text-main)', fontWeight: 600, overflowWrap: 'anywhere' }}>{item.name}</span>
                                            <span className="mono" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</span>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-btn icon-btn-sm"
                                        aria-label={`Delete saved request “${item.name}”`}
                                        onClick={() => setModal({ confirm: { title: 'Delete saved request?', message: `“${item.name}” will be removed from this browser.`, confirmLabel: 'Delete', onConfirm: () => setCollections(prev => (Array.isArray(prev) ? prev.filter(c => c?.id !== item.id) : [])) } })}
                                    >
                                        <Trash2 size={14} aria-hidden="true" />
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                ))}

                <p className="field-hint" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 0, borderTop: '1px solid var(--border)', paddingTop: 'var(--space-sm)' }}>
                    <Lock size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }} />
                    <span>
                        History, saved requests and environments are stored only in this browser (localStorage), including any tokens, passwords and cookies they contain.
                        Requests go straight from your browser to the server you enter.
                    </span>
                </p>
            </section>

            {modal === 'env' && (
                <EnvModal envs={envs} activeId={activeEnv.id} setEnvs={setEnvs} setActiveId={setActiveEnvId} onClose={() => setModal(null)} />
            )}
            {modal === 'save' && (
                <SaveModal defaultName={loadedName} existingNames={savedList.map(c => c.name)} onSave={saveRequest} onClose={() => setModal(null)} />
            )}
            {modal === 'code' && <CodeModal req={req} vars={vars} envName={activeEnv.name} onClose={() => setModal(null)} />}
            {modal === 'import' && <ImportModal onImport={importWithFeedback} onClose={() => setModal(null)} />}
            {isObject(modal) && modal.confirm && <ConfirmModal {...modal.confirm} onClose={() => setModal(null)} />}
        </div>
    )
}
