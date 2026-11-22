import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Eraser, FileUp, FilterX, Loader2, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import StatusBanner from '../components/ui/StatusBanner'
import SegmentedControl from '../components/ui/SegmentedControl'
import CopyButton from '../components/ui/CopyButton'
import CodeBlock from '../components/ui/CodeBlock'
import EmptyState from '../components/ui/EmptyState'
import { useToast } from '../components/ToastProvider'
import { useSmartInput } from '../hooks/useSmartInput'
import { useIncomingFiles } from '../hooks/useIncomingFiles'
import { useWorkerClient } from '../utils/workerClient'
import { downloadBlob, formatBytes } from '../utils/download'
import { formatXml } from '../utils/xml'
import {
    BODY_CATEGORIES, DEFAULT_SANITIZE_OPTIONS, RESOURCE_TYPES, SECRET_CATEGORIES, STATUS_CLASSES,
    bodyLanguage, cookiesOf, formatMs, harToCurl, isSensitiveName, parsePairs, prettyJson, queryParamsOf,
    responseBodyView, sanitizedFileName, secretTotal, timingBreakdown,
} from '../utils/har'
import './HarViewer.css'

const ROW_HEIGHT = 34 // px: rows have a fixed height so only the visible ones are rendered
const OVERSCAN = 6
const DISPLAY_LIMIT = 100_000 // characters of a body shown before "Show all"
const PRETTY_LIMIT = 5_000_000 // bigger bodies are shown as they are

const PHASES = { reading: 'Reading', parsing: 'Parsing', indexing: 'Indexing the requests in' }
const SANITIZE_PHASES = { sanitizing: 'Sanitizing…', writing: 'Writing the copy…' }
const TYPE_LABELS = Object.fromEntries(RESOURCE_TYPES.map(t => [t.id, t.label]))
const TYPE_ORDER = Object.fromEntries(RESOURCE_TYPES.map((t, k) => [t.id, k]))
const STATUS_LABELS = Object.fromEntries(STATUS_CLASSES.map(c => [c.id, c.label]))
// The status filters the table always offers; 1xx and other only when present
const MAIN_STATUSES = ['2xx', '3xx', '4xx', '5xx', 'failed']

// `optional` columns are hidden in narrow layouts and beside the details;
// on phones the method moves into the URL cell.
const COLUMNS = [
    { key: 'method', label: 'Method', className: 'har-col-method' },
    { key: 'status', label: 'Status' },
    { key: 'name', label: 'URL' },
    { key: 'type', label: 'Type', optional: true },
    { key: 'size', label: 'Size', numeric: true },
    { key: 'time', label: 'Time', numeric: true },
    { key: 'waterfall', label: 'Waterfall', optional: true },
]

const SANITIZE_CHOICES = [
    { id: 'headers', label: 'Remove Authorization, Proxy-Authorization and other secret-looking header values', hint: 'API keys, tokens, session IDs and CSRF tokens. The scheme word (Bearer, Basic) is kept.' },
    { id: 'cookies', label: 'Remove cookies', hint: 'Cookie and Set-Cookie headers and the cookie lists. Cookie names are kept.' },
    { id: 'query', label: 'Redact sensitive query parameters', hint: 'In URLs, query lists, Referer and Location headers and page titles. Also passwords in URLs.' },
    { id: 'bodyFields', label: 'Redact sensitive fields in request bodies', hint: 'Form fields and JSON fields such as password or token, at any depth. Also in response bodies you keep.' },
    { id: 'dropRequestBodies', label: 'Drop request bodies entirely', hint: 'Request bodies can hold personal data too, such as names and addresses.' },
    { id: 'dropResponseBodies', label: 'Drop response bodies', hint: 'Recommended: they often hold personal data. Sizes and types are kept.' },
]

const TIMING_COLORS = {
    blocked: 'var(--text-dim)',
    dns: 'var(--info)',
    connect: 'var(--warning)',
    ssl: 'var(--accent)',
    send: 'var(--success)',
    wait: 'var(--primary)',
    receive: 'color-mix(in srgb, var(--info) 55%, var(--success))',
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const SORTERS = {
    method: (a, b) => compareText(a.method, b.method),
    status: (a, b) => a.status - b.status,
    name: (a, b) => compareText(a.host, b.host) || compareText(a.path, b.path),
    type: (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type],
    size: (a, b) => a.transferred - b.transferred,
    time: (a, b) => (a.time ?? -1) - (b.time ?? -1),
    waterfall: (a, b) => (a.offset ?? Number.MAX_VALUE) - (b.offset ?? Number.MAX_VALUE),
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const statusText = (row) => (row.statusClass === 'failed' ? 'Failed' : String(row.status))
const sizeText = (row) => (row.fromCache ? 'cached' : row.transferred >= 0 ? formatBytes(row.transferred) : '—')
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Remote address as DevTools shows it: the server IP and the URL's port
function remoteAddress(entry) {
    const ip = typeof entry.serverIPAddress === 'string' ? entry.serverIPAddress.replace(/^\[|\]$/g, '') : ''
    if (!ip) return ''
    const match = /^([a-z][\w+.-]*):\/\/(?:[^/?#@]*@)?(?:\[[^\]]*\]|[^/?#:]*)(?::(\d+))?/i.exec(entry.request?.url ?? '')
    const port = match?.[2] || { http: '80', ws: '80', https: '443', wss: '443' }[match?.[1]?.toLowerCase()] || ''
    const host = ip.includes(':') ? `[${ip}]` : ip
    return port ? `${host}:${port}` : host
}

function prettify(text, mime) {
    if (!text || text.length > PRETTY_LIMIT) return null
    const type = String(mime ?? '').toLowerCase()
    const first = /\S/.exec(text.slice(0, 200))?.[0]
    if (type.includes('json') || first === '{' || first === '[') {
        const pretty = prettyJson(text)
        if (pretty !== null) return { text: pretty, language: 'json' }
    }
    if (type.includes('xml') && !type.includes('html')) {
        try {
            return { text: formatXml(text), language: 'markup' }
        } catch {
            return null
        }
    }
    return null
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ------------------------------------------------------------ open / load ---

// `paste` lives in the page, so the text survives an error and can be fixed
function OpenCard({ onFile, onText, error, paste, setPaste }) {
    const pasteId = useId()
    return (
        <section className="card har-card" aria-label="Open a HAR file">
            {error && <StatusBanner tone="danger" title="Couldn’t open this file">{error}</StatusBanner>}
            <FileDropZone
                accept=".har,.json"
                allowPaste
                onFiles={([file]) => onFile(file)}
                icon={FileUp}
                label="Drop a HAR file here or click to choose one"
                hint="In your browser’s DevTools, open the Network panel and choose “Export HAR” (Save all as HAR). Files up to 500 MB."
                style={{ minHeight: 180 }}
            />
            <p className="field-hint har-privacy">
                <ShieldCheck size={14} aria-hidden="true" /> The file is processed on this device. Nothing is uploaded.
            </p>
            <div>
                <label htmlFor={pasteId} className="field-label">Or paste HAR JSON</label>
                <textarea
                    id={pasteId}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder='{"log": {"version": "1.2", "entries": [ … ]}}'
                    spellCheck={false}
                    rows={4}
                    className="har-paste"
                />
                <div className="har-actions" style={{ marginTop: 'var(--space-sm)' }}>
                    <button type="button" className="btn btn-secondary" disabled={!paste.trim()} onClick={() => onText(paste)}>
                        Open pasted JSON
                    </button>
                </div>
            </div>
        </section>
    )
}

function LoadingCard({ loading, onCancel }) {
    return (
        <section className="card har-card" aria-label="Opening the file" aria-busy="true">
            <div className="har-loading">
                <div role="status" className="har-loading-text">
                    <Loader2 size={18} className="spin" aria-hidden="true" />
                    <span>{PHASES[loading.phase] ?? 'Reading'} <strong>{loading.name}</strong> ({formatBytes(loading.size)})…</span>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
            </div>
            <p className="field-hint" style={{ marginTop: 0 }}>Big files take a few seconds. The page stays responsive while they load.</p>
        </section>
    )
}

function FileBar({ file, summary, malformed, onFile, onClose }) {
    const details = [
        formatBytes(file.size),
        plural(summary.requests, 'request'),
        summary.creator && `exported by ${summary.creator}`,
        summary.version && `HAR ${summary.version}`,
    ].filter(Boolean).join(' · ')
    return (
        <section className="card card-compact har-filebar" aria-label="File">
            <div className="har-filebar-info">
                <div className="har-filebar-name">{file.name}</div>
                <div className="field-hint" style={{ marginTop: 0 }}>{details}</div>
                {malformed > 0 && (
                    <div className="field-hint" style={{ marginTop: 0, color: 'var(--warning)' }}>
                        {plural(malformed, 'entry has', 'entries have')} no request URL and {malformed === 1 ? 'is' : 'are'} listed without one.
                    </div>
                )}
            </div>
            <FileDropZone compact accept=".har,.json" onFiles={([next]) => onFile(next)} icon={FileUp} label="Open another" ariaLabel="Open another HAR file" style={{ padding: '0.45rem 0.8rem', fontSize: '0.85rem' }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                <X size={14} aria-hidden="true" /> Close
            </button>
        </section>
    )
}

// ----------------------------------------------------------------- summary ---

function SummaryCard({ summary }) {
    const titleId = useId()
    const s = summary
    const stats = [
        { label: 'Requests', value: s.requests.toLocaleString() },
        { label: 'Failed', value: s.failed.toLocaleString(), tone: s.failed ? 'danger' : null, hint: 'No response' },
        { label: '4xx errors', value: s.clientErrors.toLocaleString(), tone: s.clientErrors ? 'warning' : null },
        { label: '5xx errors', value: s.serverErrors.toLocaleString(), tone: s.serverErrors ? 'danger' : null },
        { label: 'Transferred', value: formatBytes(s.transferred), hint: 'Over the network' },
        { label: 'Resources', value: formatBytes(s.size), hint: 'Uncompressed' },
        { label: 'Total time', value: formatMs(s.totalTime.ms), hint: s.totalTime.source === 'onLoad' ? 'Until page load' : s.totalTime.source === 'span' ? 'First to last request' : null },
        { label: 'Domains', value: s.domains.length.toLocaleString() },
    ]
    const types = RESOURCE_TYPES.filter(t => s.byType[t.id].count > 0)
    const most = Math.max(1, ...types.map(t => s.byType[t.id].count))
    const pageTimes = [s.onContentLoad !== null && `DOMContentLoaded ${formatMs(s.onContentLoad)}`, s.onLoad !== null && `Load ${formatMs(s.onLoad)}`].filter(Boolean)
    return (
        <section className="card har-card" aria-labelledby={titleId}>
            <h2 id={titleId} className="section-title">Summary</h2>
            <dl className="har-stats">
                {stats.map(stat => (
                    <div key={stat.label} className={`har-stat ${stat.tone ? `tone-${stat.tone}` : ''}`}>
                        <dt>{stat.label}{stat.hint && <span className="har-stat-hint">{stat.hint}</span>}</dt>
                        <dd>{stat.value}</dd>
                    </div>
                ))}
            </dl>
            {pageTimes.length > 0 && <p className="field-hint" style={{ marginTop: 0 }}>First page: {pageTimes.join(' · ')}</p>}
            {types.length > 0 && (
                <div className="har-summary-split">
                    <table className="har-table">
                        <caption className="sr-only">Requests by type</caption>
                        <thead>
                            <tr><th scope="col">Type</th><th scope="col" className="har-num">Requests</th><th scope="col" className="har-num">Transferred</th></tr>
                        </thead>
                        <tbody>
                            {types.map(t => (
                                <tr key={t.id}>
                                    <th scope="row">{t.label}</th>
                                    <td className="har-num">
                                        <span className="har-share" aria-hidden="true"><span style={{ width: `${(s.byType[t.id].count / most) * 100}%` }} /></span>
                                        {s.byType[t.id].count.toLocaleString()}
                                    </td>
                                    <td className="har-num">{formatBytes(s.byType[t.id].transferred)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div>
                        <table className="har-table">
                            <caption className="sr-only">Requests by domain</caption>
                            <thead>
                                <tr><th scope="col">Domain</th><th scope="col" className="har-num">Requests</th></tr>
                            </thead>
                            <tbody>
                                {s.domains.slice(0, 8).map(d => (
                                    <tr key={d.host}><th scope="row" className="har-domain">{d.host}</th><td className="har-num">{d.count.toLocaleString()}</td></tr>
                                ))}
                            </tbody>
                        </table>
                        {s.domains.length > 8 && (
                            <details className="har-more">
                                <summary>{plural(s.domains.length - 8, 'more domain')}</summary>
                                <ul>
                                    {s.domains.slice(8).map(d => <li key={d.host}><span className="har-domain">{d.host}</span> <span className="har-dim">{d.count.toLocaleString()}</span></li>)}
                                </ul>
                            </details>
                        )}
                    </div>
                </div>
            )}
        </section>
    )
}

// ----------------------------------------------------------------- secrets ---

const nameList = (names) => names.map(n => (n.count > 1 ? `${n.name} ×${n.count}` : n.name)).join(', ')

function SecretsCard({ secrets }) {
    const titleId = useId()
    const { counts, names } = secrets
    const total = secretTotal(counts)
    const present = SECRET_CATEGORIES.filter(c => counts[c.id] > 0)
    const bodies = BODY_CATEGORIES.filter(c => counts[c.id] > 0).map(c => `${counts[c.id].toLocaleString()} ${c.label.toLowerCase()}`)
    return (
        <section className="card har-card" aria-labelledby={titleId}>
            <h2 id={titleId} className="section-title"><ShieldAlert size={16} aria-hidden="true" /> Secrets found</h2>
            {total === 0 ? (
                <StatusBanner tone="success" title="No secrets found">
                    Checked headers, cookies, URLs, form and JSON fields and JWTs. Bodies can still hold personal data.
                </StatusBanner>
            ) : (
                <StatusBanner tone="warning" title={`${plural(total, 'secret')} in this file`}>
                    Sanitize it before you share it. Only names are listed here, never values.
                </StatusBanner>
            )}
            {present.length > 0 && (
                <ul className="har-secrets" aria-label="Secrets by kind">
                    {present.map(c => (
                        <li key={c.id} className={c.subset ? 'is-subset' : undefined}>
                            <span className="har-secret-label">{c.label}</span>
                            <span className="har-secret-count">{counts[c.id].toLocaleString()}</span>
                            {!c.subset && names?.[c.id]?.length > 0 && <span className="har-secret-names">{nameList(names[c.id])}</span>}
                        </li>
                    ))}
                </ul>
            )}
            {bodies.length > 0 && (
                <p className="field-hint" style={{ marginTop: 0 }}>
                    The file also holds {bodies.join(' and ')}, which can contain personal data such as names and email addresses.
                </p>
            )}
        </section>
    )
}

// ---------------------------------------------------------------- sanitize ---

function SanitizeCard({ options, onOption, onSanitize, sanitizing, result, onDownload }) {
    const titleId = useId()
    const leftover = result ? secretTotal(result.after) : 0
    const removed = result ? secretTotal(result.before) - leftover : 0
    const rows = result ? [...SECRET_CATEGORIES, ...BODY_CATEGORIES].filter(c => result.before[c.id] > 0) : []
    return (
        <section className="card har-card" aria-labelledby={titleId}>
            <h2 id={titleId} className="section-title"><Eraser size={16} aria-hidden="true" /> Sanitize and download</h2>
            <fieldset className="har-options" disabled={!!sanitizing}>
                <legend className="sr-only">What to remove</legend>
                {SANITIZE_CHOICES.map(choice => (
                    <label key={choice.id} className="har-option">
                        <input type="checkbox" checked={!!options[choice.id]} onChange={(e) => onOption(choice.id, e.target.checked)} />
                        <span>
                            {choice.label}
                            <span className="har-option-hint">{choice.hint}</span>
                        </span>
                    </label>
                ))}
            </fieldset>
            <p className="field-hint" style={{ marginTop: 0 }}>
                Values are replaced with [REDACTED]; everything else stays as it was, so the copy still opens in DevTools.
            </p>
            <div className="har-actions">
                <button type="button" className="btn btn-primary" onClick={onSanitize} disabled={!!sanitizing}>
                    {sanitizing ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Eraser size={16} aria-hidden="true" />}
                    {sanitizing ? SANITIZE_PHASES[sanitizing] ?? 'Sanitizing…' : 'Sanitize'}
                </button>
            </div>
            {result && (
                <>
                    {leftover === 0 ? (
                        <StatusBanner tone="success" title={removed ? `Removed ${plural(removed, 'secret')}` : 'Sanitized copy ready'}>
                            The copy was scanned again: no secrets are left in it.
                        </StatusBanner>
                    ) : (
                        <StatusBanner tone="warning" title={`${plural(leftover, 'secret')} left in the copy`}>
                            {removed ? `Removed ${removed.toLocaleString()}. ` : ''}The rest stay because their options are off.
                        </StatusBanner>
                    )}
                    {rows.length > 0 && (
                        <table className="har-table har-compare">
                            <caption className="sr-only">Before and after sanitizing</caption>
                            <thead>
                                <tr><th scope="col">What</th><th scope="col" className="har-num">Before</th><th scope="col" className="har-num">After</th></tr>
                            </thead>
                            <tbody>
                                {rows.map(c => (
                                    <tr key={c.id}>
                                        <th scope="row" className={c.subset ? 'har-subset' : undefined}>{c.label}</th>
                                        <td className="har-num">{result.before[c.id].toLocaleString()}</td>
                                        <td className={`har-num ${result.after[c.id] === 0 ? 'har-zero' : 'har-left'}`}>{result.after[c.id].toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <div className="har-actions">
                        <button type="button" className="btn btn-primary" onClick={onDownload}>
                            <Download size={16} aria-hidden="true" /> Download {result.fileName}
                        </button>
                        <span className="field-hint" style={{ marginTop: 0 }}>{formatBytes(result.size)} · {plural(result.entries, 'request')}</span>
                    </div>
                </>
            )}
        </section>
    )
}

// ------------------------------------------------------------------- table ---

function Waterfall({ row, span }) {
    if (row.offset === null || !span) return null
    const left = Math.min(100, (row.offset / span) * 100)
    const width = Math.min(100 - left, ((row.time ?? 0) / span) * 100)
    const isError = row.statusClass === 'failed' || row.statusClass === '4xx' || row.statusClass === '5xx'
    return (
        <>
            <span className={`har-wf ${isError ? 'is-error' : ''}`} aria-hidden="true">
                <span style={{ left: `${left}%`, width: `${width}%` }} />
            </span>
            <span className="sr-only">Starts at {formatMs(row.offset)}</span>
        </>
    )
}

function RequestGrid({ rows, span, sort, onSort, selected, onSelect, onClose, labelledBy, focusTick }) {
    const scrollRef = useRef(null)
    const rowRefs = useRef(new Map())
    const [scrollTop, setScrollTop] = useState(0)
    const [viewHeight, setViewHeight] = useState(0)
    const [active, setActive] = useState(0)
    const [focusRequest, setFocusRequest] = useState(null)

    const count = rows.length
    const activePos = Math.min(active, Math.max(0, count - 1))

    useEffect(() => {
        const el = scrollRef.current
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(([entry]) => setViewHeight(entry.contentRect.height))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    // Focus a row once it's rendered (after keyboard moves)
    useEffect(() => {
        if (focusRequest) rowRefs.current.get(focusRequest.pos)?.focus({ preventScroll: true })
    }, [focusRequest])

    // The page asks for focus back on the table (after closing the details)
    const handledFocusTick = useRef(focusTick)
    useEffect(() => {
        if (focusTick === handledFocusTick.current) return
        handledFocusTick.current = focusTick
        rowRefs.current.get(activePos)?.focus({ preventScroll: true })
    }, [focusTick, activePos])

    const height = viewHeight || 480
    // Rows can shrink (filters) before the browser clamps the scroll position
    const top = Math.max(0, Math.min(scrollTop, count * ROW_HEIGHT - height))
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN)
    const last = Math.min(count, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN)
    const tabStop = activePos >= first && activePos < last ? activePos : first

    const moveTo = (pos) => {
        if (!count) return
        const target = Math.max(0, Math.min(count - 1, pos))
        const el = scrollRef.current
        if (el) {
            const rowTop = target * ROW_HEIGHT
            if (rowTop < el.scrollTop) el.scrollTop = rowTop
            else if (rowTop + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = rowTop + ROW_HEIGHT - el.clientHeight
            setScrollTop(el.scrollTop)
        }
        setActive(target)
        setFocusRequest({ pos: target })
        // With the details open, the selection follows the keyboard (as in DevTools)
        if (selected !== null) onSelect(rows[target].i, false)
    }

    const onRowKeyDown = (event, pos) => {
        const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight || 480) / ROW_HEIGHT) - 1)
        switch (event.key) {
            case 'ArrowDown': moveTo(pos + 1); break
            case 'ArrowUp': moveTo(pos - 1); break
            case 'PageDown': moveTo(pos + page); break
            case 'PageUp': moveTo(pos - page); break
            case 'Home': moveTo(0); break
            case 'End': moveTo(count - 1); break
            case 'Enter':
            case ' ':
                onSelect(rows[pos].i, true)
                break
            case 'Escape':
                if (selected === null) return
                onClose()
                break
            default:
                return
        }
        event.preventDefault()
    }

    const visible = []
    for (let pos = first; pos < last; pos++) visible.push(pos)

    return (
        <div className="har-grid-x">
            <div role="grid" aria-labelledby={labelledBy} aria-rowcount={count + 1} className="har-grid">
                <div role="rowgroup" className="har-grid-head">
                    <div role="row" aria-rowindex={1} className="har-row">
                        {COLUMNS.map(col => {
                            const sorted = sort?.key === col.key
                            const Icon = !sorted ? ChevronsUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
                            return (
                                <div
                                    key={col.key}
                                    role="columnheader"
                                    aria-sort={sorted ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                                    className={`har-head-cell ${col.optional ? 'har-col-optional' : ''} ${col.className ?? ''}`}
                                >
                                    <button type="button" className={`har-sort ${col.numeric ? 'is-numeric' : ''} ${sorted ? 'is-active' : ''}`} onClick={() => onSort(col.key)}>
                                        {col.label}
                                        <Icon size={12} aria-hidden="true" />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>
                <div ref={scrollRef} className="har-grid-body" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
                    <div role="rowgroup" className="har-grid-rows" style={{ height: count * ROW_HEIGHT }}>
                        {visible.map(pos => {
                            const row = rows[pos]
                            const isSelected = row.i === selected
                            return (
                                <div
                                    key={row.i}
                                    ref={(el) => {
                                        if (el) rowRefs.current.set(pos, el)
                                        else rowRefs.current.delete(pos)
                                    }}
                                    role="row"
                                    aria-rowindex={pos + 2}
                                    aria-selected={isSelected}
                                    tabIndex={pos === tabStop ? 0 : -1}
                                    className={`har-row ${isSelected ? 'is-selected' : ''}`}
                                    style={{ transform: `translateY(${pos * ROW_HEIGHT}px)` }}
                                    title={row.url}
                                    onClick={() => {
                                        setActive(pos)
                                        onSelect(row.i, true)
                                    }}
                                    onFocus={() => setActive(pos)}
                                    onKeyDown={(e) => onRowKeyDown(e, pos)}
                                >
                                    <div role="gridcell" className="har-cell har-method har-col-method">{row.method || '—'}</div>
                                    <div role="gridcell" className={`har-cell har-status har-status-${row.statusClass}`}>{statusText(row)}</div>
                                    <div role="gridcell" className="har-cell har-name">
                                        <span className="har-method har-name-method">{row.method || '—'}</span>
                                        <span className="har-host">{row.host}</span>
                                        <span className="har-path">{row.path}</span>
                                    </div>
                                    <div role="gridcell" className="har-cell har-col-optional">{TYPE_LABELS[row.type]}</div>
                                    <div role="gridcell" className="har-cell har-num" title={row.fromCache ? `From the ${row.fromCache} cache` : undefined}>{sizeText(row)}</div>
                                    <div role="gridcell" className="har-cell har-num">{formatMs(row.time)}</div>
                                    <div role="gridcell" className="har-cell har-col-optional har-wf-cell"><Waterfall row={row} span={span} /></div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}

// ------------------------------------------------------------------ detail ---

function KeyValueList({ items, empty, label }) {
    if (!items.length) return <p className="har-empty">{empty}</p>
    return (
        <dl className="har-kv" aria-label={label}>
            {items.map((item, k) => (
                <div key={k} className="har-kv-row">
                    <dt>
                        {item.name || <span className="har-dim">(no name)</span>}
                        {item.secret && <span className="badge badge-warning har-secret-badge">secret</span>}
                    </dt>
                    <dd>
                        {item.value}
                        {item.note && <span className="har-kv-note">{item.note}</span>}
                    </dd>
                </div>
            ))}
        </dl>
    )
}

function headerItems(headers) {
    return (Array.isArray(headers) ? headers : []).filter(isObject).map(h => ({
        name: String(h.name ?? ''),
        value: String(h.value ?? ''),
        secret: isSensitiveName(h.name),
    }))
}

const headersText = (headers) => headerItems(headers).map(h => `${h.name}: ${h.value}`).join('\n')

function BodyText({ text, mime, label }) {
    const pretty = useMemo(() => prettify(text, mime), [text, mime])
    const [mode, setMode] = useState('pretty')
    const [showAll, setShowAll] = useState(false)
    const usePretty = mode === 'pretty' && pretty !== null
    const shown = usePretty ? pretty.text : text
    const truncated = !showAll && shown.length > DISPLAY_LIMIT
    const language = usePretty ? pretty.language : bodyLanguage(mime)
    return (
        <div className="har-body">
            <div className="har-body-bar">
                {pretty !== null && (
                    <SegmentedControl ariaLabel={`${label} format`} size="sm" value={mode} onChange={setMode} options={[{ value: 'pretty', label: 'Pretty' }, { value: 'raw', label: 'Raw' }]} />
                )}
                <CopyButton text={shown} label={`Copy ${label.toLowerCase()}`} />
            </div>
            <CodeBlock code={truncated ? shown.slice(0, DISPLAY_LIMIT) : shown} language={language} maxHeight={420} showCopy={false} />
            {truncated && (
                <div className="har-actions">
                    <span className="field-hint" style={{ marginTop: 0 }}>Showing the first {DISPLAY_LIMIT.toLocaleString()} of {shown.length.toLocaleString()} characters.</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAll(true)}>Show all</button>
                </div>
            )}
        </div>
    )
}

function GeneralTab({ entry, row, page }) {
    const req = isObject(entry.request) ? entry.request : {}
    const res = isObject(entry.response) ? entry.response : {}
    const initiator = isObject(entry._initiator) ? entry._initiator : null
    const initiatorUrl = initiator?.url ?? initiator?.stack?.callFrames?.find(f => f?.url)?.url
    const status = row.statusClass === 'failed'
        ? `Failed${res._error ? `: ${res._error}` : ' (no response)'}`
        : `${row.status}${res.statusText ? ` ${res.statusText}` : ''}`
    const items = [
        { name: 'URL', value: req.url || '—' },
        { name: 'Method', value: row.method || '—' },
        { name: 'Status', value: status },
        { name: 'HTTP version', value: res.httpVersion || req.httpVersion || '—' },
        { name: 'Remote address', value: remoteAddress(entry) || '—' },
        { name: 'Server IP address', value: entry.serverIPAddress || '—' },
        { name: 'Connection', value: entry.connection || '—' },
        { name: 'Type', value: `${TYPE_LABELS[row.type]}${entry._resourceType ? ` (${entry._resourceType})` : ''}` },
        { name: 'MIME type', value: row.mime || '—' },
        { name: 'Started', value: `${entry.startedDateTime ?? '—'}${row.offset !== null ? ` (+${formatMs(row.offset)})` : ''}` },
        { name: 'Time', value: formatMs(row.time) },
        { name: 'Transferred', value: row.fromCache ? `From the ${row.fromCache} cache` : row.transferred >= 0 ? `${formatBytes(row.transferred)} (${row.transferred.toLocaleString()} bytes)` : '—' },
        { name: 'Resource size', value: row.size >= 0 ? `${formatBytes(row.size)} (${row.size.toLocaleString()} bytes)` : '—' },
        entry._priority && { name: 'Priority', value: entry._priority },
        initiator && { name: 'Initiator', value: [initiator.type, initiatorUrl].filter(Boolean).join(': ') },
        res.redirectURL && { name: 'Redirect URL', value: res.redirectURL },
        page && { name: 'Page', value: page.title || page.id },
        entry.comment && { name: 'Comment', value: String(entry.comment) },
    ].filter(Boolean)
    return (
        <>
            <KeyValueList items={items} label="General" empty="" />
            {req.url && (
                <div className="har-actions">
                    <CopyButton text={req.url} label="Copy URL" />
                </div>
            )}
        </>
    )
}

function HeadersTab({ message, label }) {
    const items = headerItems(message?.headers)
    return (
        <>
            <KeyValueList items={items} label={label} empty={`No ${label.toLowerCase()} in the file.`} />
            {items.length > 0 && (
                <div className="har-actions">
                    <CopyButton text={headersText(message.headers)} label={`Copy ${label.toLowerCase()}`} />
                    {message.headersSize > 0 && <span className="field-hint" style={{ marginTop: 0 }}>{formatBytes(message.headersSize)}</span>}
                </div>
            )}
        </>
    )
}

function cookieNote(cookie) {
    const parts = [
        cookie.domain && `Domain ${cookie.domain}`,
        cookie.path && `Path ${cookie.path}`,
        cookie.expires && `Expires ${cookie.expires}`,
        cookie.maxAge && `Max-Age ${cookie.maxAge}`,
        cookie.httpOnly && 'HttpOnly',
        cookie.secure && 'Secure',
        cookie.sameSite && `SameSite ${cookie.sameSite}`,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : null
}

function CookiesTab({ entry }) {
    const sent = cookiesOf(entry.request, 'request')
    const received = cookiesOf(entry.response, 'response')
    const items = (list) => list.map(c => ({ name: String(c.name ?? ''), value: String(c.value ?? ''), note: cookieNote(c) }))
    return (
        <>
            <h4 className="har-subtitle">Sent with the request ({sent.length})</h4>
            <KeyValueList items={items(sent)} label="Request cookies" empty="No cookies were sent." />
            <h4 className="har-subtitle">Set by the response ({received.length})</h4>
            <KeyValueList items={items(received)} label="Response cookies" empty="The response set no cookies." />
        </>
    )
}

function RequestBodyTab({ entry, index }) {
    const req = isObject(entry.request) ? entry.request : {}
    const post = isObject(req.postData) ? req.postData : null
    const text = typeof post?.text === 'string' ? post.text : ''
    const params = Array.isArray(post?.params) ? post.params.filter(isObject) : []
    if (!post || (!text && !params.length)) return <p className="har-empty">No request body.</p>
    const mime = String(post.mimeType ?? '')
    const isForm = /x-www-form-urlencoded/i.test(mime)
    const fields = params.length
        ? params.map(p => ({
            name: String(p.name ?? ''),
            value: p.fileName !== undefined ? `File: ${p.fileName}${p.contentType ? ` (${p.contentType})` : ''}` : String(p.value ?? ''),
            secret: isSensitiveName(p.name),
        }))
        : isForm ? parsePairs(text).map(p => ({ ...p, secret: isSensitiveName(p.name) })) : []
    return (
        <>
            <p className="field-hint" style={{ marginTop: 0 }}>
                {mime || 'No MIME type'}{req.bodySize > 0 ? ` · ${formatBytes(req.bodySize)}` : ''}
            </p>
            {fields.length > 0 && <KeyValueList items={fields} label="Form fields" empty="" />}
            {text && <BodyText key={`req-${index}`} text={text} mime={mime} label="Request body" />}
        </>
    )
}

function ImagePreview({ src, alt }) {
    const [size, setSize] = useState(null)
    return (
        <figure className="har-figure">
            <div className="stage checkerboard har-image">
                <img src={src} alt={alt} onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />
            </div>
            {size && <figcaption className="field-hint">{size.width} × {size.height} px</figcaption>}
        </figure>
    )
}

function ResponseBodyTab({ entry, index }) {
    const content = isObject(entry.response) ? entry.response.content : null
    const view = useMemo(() => responseBodyView(content), [content])
    const meta = [view.mime || 'No MIME type', view.size !== null && formatBytes(view.size)].filter(Boolean).join(' · ')
    if (view.kind === 'none') {
        return (
            <p className="har-empty">
                No response body in the file. Browsers leave out the bodies of redirects, failed and some cached requests, and a sanitizer may have removed them.
            </p>
        )
    }
    if (view.kind === 'image') {
        return (
            <>
                <p className="field-hint" style={{ marginTop: 0 }}>{meta}</p>
                <ImagePreview key={`img-${index}`} src={view.dataUrl} alt={`Response image (${view.mime}, ${formatBytes(view.bytes)})`} />
                {view.text && <BodyText key={`svg-${index}`} text={view.text} mime={view.mime} label="Response body" />}
            </>
        )
    }
    if (view.kind === 'binary') {
        return (
            <p className="har-empty">
                Binary content ({view.mime || 'unknown type'}, {formatBytes(view.bytes)}) isn’t shown.
            </p>
        )
    }
    return (
        <>
            <p className="field-hint" style={{ marginTop: 0 }}>{meta}{view.decoded ? ' · decoded from base64' : ''}</p>
            <BodyText key={`res-${index}`} text={view.text} mime={view.mime} label="Response body" />
        </>
    )
}

function TimingsTab({ entry, row }) {
    const { phases, segments, total } = timingBreakdown(entry.timings)
    const ssl = phases.find(p => p.id === 'ssl')?.ms
    return (
        <>
            {segments.length > 0 ? (
                <div className="har-timing-bar" aria-hidden="true">
                    {segments.map(s => (
                        <span key={s.id} style={{ width: `${(s.ms / total) * 100}%`, background: TIMING_COLORS[s.id] }} />
                    ))}
                </div>
            ) : (
                <p className="har-empty">No timings in the file for this request.</p>
            )}
            <table className="har-table har-timings">
                <caption className="sr-only">Timing phases</caption>
                <thead>
                    <tr><th scope="col">Phase</th><th scope="col" className="har-num">Time</th></tr>
                </thead>
                <tbody>
                    {phases.map(p => (
                        <tr key={p.id}>
                            <th scope="row">
                                <span className="har-swatch" style={{ background: TIMING_COLORS[p.id] }} aria-hidden="true" />
                                {p.label}{p.id === 'connect' && ssl ? ' (includes SSL/TLS)' : ''}
                            </th>
                            <td className="har-num">{p.ms === null ? 'n/a' : formatMs(p.ms)}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr><th scope="row">Total</th><td className="har-num">{formatMs(row.time)}</td></tr>
                </tfoot>
            </table>
            {row.offset !== null && <p className="field-hint" style={{ marginTop: 0 }}>Started {formatMs(row.offset)} after the first request.</p>}
        </>
    )
}

function detailTabs(entry) {
    const req = isObject(entry?.request) ? entry.request : {}
    const res = isObject(entry?.response) ? entry.response : {}
    const count = (list) => (Array.isArray(list) ? list.length : 0)
    return [
        { value: 'general', label: 'General' },
        { value: 'requestHeaders', label: `Request headers (${count(req.headers)})` },
        { value: 'query', label: `Query (${queryParamsOf(req).length})` },
        { value: 'cookies', label: `Cookies (${cookiesOf(req, 'request').length + cookiesOf(res, 'response').length})` },
        { value: 'requestBody', label: 'Request body' },
        { value: 'responseHeaders', label: `Response headers (${count(res.headers)})` },
        { value: 'responseBody', label: 'Response body' },
        { value: 'timings', label: 'Timings' },
    ]
}

function DetailPanel({ index, row, detail, error, tab, onTab, onClose, panelRef }) {
    const titleId = useId()
    const entry = detail && detail.index === index ? detail.entry : null
    const usable = isObject(entry)
    const statusClass = row ? `har-status-${row.statusClass}` : ''
    return (
        <section
            ref={panelRef}
            className="har-detail"
            aria-labelledby={titleId}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation()
                    onClose()
                }
            }}
        >
            <div className="har-detail-head">
                <h3 id={titleId} className="har-detail-title">
                    <span>{row?.method || '—'}</span>{' '}
                    <span className={statusClass}>{row ? statusText(row) : ''}</span>{' '}
                    <span className="har-detail-url">{row?.url || '(no URL)'}</span>
                </h3>
                <div className="har-detail-actions">
                    <CopyButton text={() => harToCurl(entry)} label="Copy as cURL" disabled={!usable} />
                    <button type="button" className="icon-btn" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            </div>
            {error && <StatusBanner tone="danger" title="Couldn’t show this request">{error}</StatusBanner>}
            {!entry && !error && (
                <div role="status" className="har-loading-text"><Loader2 size={16} className="spin" aria-hidden="true" /> Loading…</div>
            )}
            {entry && !usable && <p className="har-empty">This entry isn’t an object, so there’s nothing to show.</p>}
            {usable && (
                <>
                    <SegmentedControl ariaLabel="Request details" size="sm" value={tab} onChange={onTab} options={detailTabs(entry)} />
                    <div className="har-detail-body">
                        {tab === 'general' && <GeneralTab entry={entry} row={row} page={detail.page} />}
                        {tab === 'requestHeaders' && <HeadersTab message={entry.request} label="Request headers" />}
                        {tab === 'query' && <KeyValueList items={queryParamsOf(entry.request).map(q => ({ ...q, secret: isSensitiveName(q.name) }))} label="Query parameters" empty="No query parameters." />}
                        {tab === 'cookies' && <CookiesTab entry={entry} />}
                        {tab === 'requestBody' && <RequestBodyTab entry={entry} index={index} />}
                        {tab === 'responseHeaders' && <HeadersTab message={entry.response} label="Response headers" />}
                        {tab === 'responseBody' && <ResponseBodyTab entry={entry} index={index} />}
                        {tab === 'timings' && <TimingsTab entry={entry} row={row} />}
                    </div>
                </>
            )}
        </section>
    )
}

// -------------------------------------------------------------------- page ---

export default function HarViewer() {
    const toast = useToast()
    const requestsTitleId = useId()
    const client = useWorkerClient(() => new Worker(new URL('../workers/har.worker.js', import.meta.url), { type: 'module' }))

    const [file, setFile] = useState(null) // { name, size }
    const [data, setData] = useState(null) // { rows, summary, secrets, malformed }
    const [loading, setLoading] = useState(null) // { name, size, phase }
    const [error, setError] = useState(null)
    const [paste, setPaste] = useState('')

    const [query, setQuery] = useState('')
    const [types, setTypes] = useState([])
    const [statuses, setStatuses] = useState([])
    const [sort, setSort] = useState(null) // { key, dir: 1 | -1 }

    const [selected, setSelected] = useState(null)
    const [detail, setDetail] = useState(null)
    const [detailError, setDetailError] = useState(null)
    const [tab, setTab] = useState('general')
    const [revealTick, setRevealTick] = useState(0)
    const [focusTick, setFocusTick] = useState(0)

    const [options, setOptions] = useState(DEFAULT_SANITIZE_OPTIONS)
    const [sanitizing, setSanitizing] = useState(null) // phase while running
    const [result, setResult] = useState(null)

    const loadRef = useRef(0)
    const detailRef = useRef(0)
    const sanitizeRef = useRef(0)
    const panelRef = useRef(null)
    const tableRef = useRef(null)
    const mountedRef = useRef(false)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const resetView = () => {
        detailRef.current++
        sanitizeRef.current++
        setQuery('')
        setTypes([])
        setStatuses([])
        setSort(null)
        setSelected(null)
        setDetail(null)
        setDetailError(null)
        setSanitizing(null)
        setResult(null)
    }

    const load = async (payload, meta, attempt = 0) => {
        const id = attempt ? loadRef.current : ++loadRef.current
        if (!attempt) {
            resetView()
            setData(null)
            setFile(null)
            setError(null)
            setLoading({ ...meta, phase: 'reading' })
        }
        try {
            const loaded = await client.request('load', payload, {
                replace: true,
                onProgress: (progress) => {
                    if (loadRef.current === id && progress?.phase) setLoading(current => (current ? { ...current, phase: progress.phase } : current))
                },
            })
            if (loadRef.current !== id) return
            setData(loaded)
            setFile(meta)
            setLoading(null)
            setPaste('')
        } catch (e) {
            if (loadRef.current !== id) return
            if (e?.cancelled) {
                // Our own Cancel and Close change loadRef first. Anything else stopped the
                // worker from outside (the page remounting in development): try again.
                if (mountedRef.current && attempt < 2) load(payload, meta, attempt + 1)
                return
            }
            setLoading(null)
            setError(e?.message || 'The file couldn’t be read.')
        }
    }

    const openFile = (next) => {
        if (next) load({ file: next }, { name: next.name, size: next.size })
    }

    const openText = (text, name = 'pasted.har') => {
        if (typeof text !== 'string' || !text.trim()) return
        load({ text }, { name, size: new Blob([text]).size })
    }

    const cancelLoad = () => {
        loadRef.current++
        client.cancel()
        setLoading(null)
    }

    const close = () => {
        loadRef.current++
        resetView()
        client.terminate() // frees the parsed file
        setData(null)
        setFile(null)
        setError(null)
    }

    useSmartInput({ input: () => {} }, { onInject: (values) => openText(values.input) })
    useIncomingFiles('/har', ([next]) => openFile(next))

    const select = (index, reveal) => {
        const id = ++detailRef.current
        setSelected(index)
        setDetailError(null)
        if (reveal) setRevealTick(t => t + 1)
        client.request('entry', { index })
            .then((next) => {
                if (detailRef.current === id) setDetail(next)
            })
            .catch((e) => {
                if (!e?.cancelled && detailRef.current === id) setDetailError(e?.message || 'The request couldn’t be read.')
            })
    }

    const closeDetail = () => {
        detailRef.current++
        setSelected(null)
        setDetail(null)
        setDetailError(null)
        setFocusTick(t => t + 1)
    }

    // On narrow layouts the details open below the table: bring them into view
    useEffect(() => {
        if (!revealTick) return
        const panel = panelRef.current
        const table = tableRef.current
        if (panel && table && panel.getBoundingClientRect().top >= table.getBoundingClientRect().bottom - 1) {
            panel.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
        }
    }, [revealTick])

    const runSanitize = async () => {
        const id = ++sanitizeRef.current
        setResult(null)
        setSanitizing('sanitizing')
        try {
            const next = await client.request('sanitize', { options }, {
                onProgress: (progress) => {
                    if (sanitizeRef.current === id && progress?.phase) setSanitizing(progress.phase)
                },
            })
            if (sanitizeRef.current !== id) return
            setResult({ ...next, fileName: sanitizedFileName(file?.name) })
        } catch (e) {
            if (!e?.cancelled && sanitizeRef.current === id) toast.error(`Couldn’t sanitize the file: ${e?.message || 'unknown error'}`)
        } finally {
            if (sanitizeRef.current === id) setSanitizing(null)
        }
    }

    const setOption = (id, value) => {
        setOptions(current => ({ ...current, [id]: value }))
        setResult(null)
    }

    const deferredQuery = useDeferredValue(query)
    const visibleRows = useMemo(() => {
        if (!data) return []
        const q = deferredQuery.trim().toLowerCase()
        let list = data.rows
        if (q || types.length || statuses.length) {
            list = list.filter(r => (!types.length || types.includes(r.type))
                && (!statuses.length || statuses.includes(r.statusClass))
                && (!q || r.url.toLowerCase().includes(q)))
        }
        if (sort) {
            const by = SORTERS[sort.key]
            list = [...list].sort((a, b) => by(a, b) * sort.dir || a.i - b.i)
        }
        return list
    }, [data, deferredQuery, types, statuses, sort])

    const toggleIn = (setList, id) => setList(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
    const onSort = (key) => setSort(s => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))
    const filtered = query.trim() !== '' || types.length > 0 || statuses.length > 0
    const clearFilters = () => {
        setQuery('')
        setTypes([])
        setStatuses([])
    }

    const summary = data?.summary
    const statusFilters = summary ? STATUS_CLASSES.filter(c => MAIN_STATUSES.includes(c.id) || summary.statusClasses[c.id] > 0) : []

    return (
        <div className="page">
            <ToolHeader />

            {!data && !loading && <OpenCard onFile={openFile} onText={(text) => openText(text)} error={error} paste={paste} setPaste={setPaste} />}
            {loading && <LoadingCard loading={loading} onCancel={cancelLoad} />}

            {data && file && (
                <>
                    <FileBar file={file} summary={summary} malformed={data.malformed} onFile={openFile} onClose={close} />
                    <SummaryCard summary={summary} />
                    <div className="split-pane har-split">
                        <SecretsCard secrets={data.secrets} />
                        <SanitizeCard
                            options={options}
                            onOption={setOption}
                            onSanitize={runSanitize}
                            sanitizing={sanitizing}
                            result={result}
                            onDownload={() => result && downloadBlob(result.blob, result.fileName)}
                        />
                    </div>

                    <section className="card har-card" aria-labelledby={requestsTitleId}>
                        <div className="har-requests-head">
                            <h2 id={requestsTitleId} className="section-title">Requests</h2>
                            <p className="field-hint" style={{ marginTop: 0 }} aria-live="polite">
                                {filtered ? `Showing ${visibleRows.length.toLocaleString()} of ${plural(data.rows.length, 'request')}` : plural(data.rows.length, 'request')}
                            </p>
                        </div>

                        {data.rows.length > 0 && (
                            <div className="har-filters">
                                <div className="har-search">
                                    <Search size={15} aria-hidden="true" />
                                    <input
                                        type="search"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Filter by URL"
                                        aria-label="Filter by URL"
                                        spellCheck={false}
                                        autoComplete="off"
                                    />
                                </div>
                                <div role="group" aria-label="Filter by type" className="har-chips">
                                    <span className="har-chips-label" aria-hidden="true">Type</span>
                                    {RESOURCE_TYPES.map(t => {
                                        const on = types.includes(t.id)
                                        const n = summary.byType[t.id].count
                                        return (
                                            <button key={t.id} type="button" className={`chip ${on ? 'is-active' : ''}`} aria-pressed={on} disabled={!n && !on} onClick={() => toggleIn(setTypes, t.id)}>
                                                {t.label} <span className="har-chip-count">{n.toLocaleString()}</span>
                                            </button>
                                        )
                                    })}
                                </div>
                                <div role="group" aria-label="Filter by status" className="har-chips">
                                    <span className="har-chips-label" aria-hidden="true">Status</span>
                                    {statusFilters.map(c => {
                                        const on = statuses.includes(c.id)
                                        const n = summary.statusClasses[c.id]
                                        return (
                                            <button key={c.id} type="button" className={`chip ${on ? 'is-active' : ''}`} aria-pressed={on} disabled={!n && !on} onClick={() => toggleIn(setStatuses, c.id)}>
                                                {STATUS_LABELS[c.id]} <span className="har-chip-count">{n.toLocaleString()}</span>
                                            </button>
                                        )
                                    })}
                                    {filtered && (
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
                                            <FilterX size={14} aria-hidden="true" /> Clear filters
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="har-browser-host">
                            <div className={`har-browser ${selected !== null ? 'has-detail' : ''}`}>
                                <div ref={tableRef} className="har-browser-main">
                                    {data.rows.length === 0 ? (
                                        <EmptyState title="This file has no requests">Its log.entries list is empty.</EmptyState>
                                    ) : visibleRows.length === 0 ? (
                                        <EmptyState title="No requests match these filters">
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>
                                        </EmptyState>
                                    ) : (
                                        <RequestGrid
                                            rows={visibleRows}
                                            span={summary.span}
                                            sort={sort}
                                            onSort={onSort}
                                            selected={selected}
                                            onSelect={select}
                                            onClose={closeDetail}
                                            labelledBy={requestsTitleId}
                                            focusTick={focusTick}
                                        />
                                    )}
                                    {data.rows.length > 0 && (
                                        <p className="field-hint">Select a request to see its details. Arrow keys move between requests; Esc closes the details.</p>
                                    )}
                                </div>
                                {selected !== null && (
                                    <DetailPanel
                                        index={selected}
                                        row={data.rows[selected]}
                                        detail={detail}
                                        error={detailError}
                                        tab={tab}
                                        onTab={setTab}
                                        onClose={closeDetail}
                                        panelRef={panelRef}
                                    />
                                )}
                            </div>
                        </div>
                    </section>
                </>
            )}
        </div>
    )
}
