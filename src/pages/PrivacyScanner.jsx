import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eraser, FileSearch, FileText, Loader2, ScanEye, ShieldCheck, Sparkles, Trash2, Type } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import SegmentedControl from '../components/ui/SegmentedControl'
import CopyButton from '../components/ui/CopyButton'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useToast } from '../components/ToastProvider'
import { usePipeline } from '../contexts/PipelineContext'
import { usePane } from '../contexts/pane'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { formatBytes, splitFilename } from '../utils/download'
import { sniffImageType, typeLabel } from '../utils/image'
import {
    findImageRisks, findOfficeRisks, findPdfRisks, isOfficeFile,
    readImageMetadata, readOfficeMetadata, readPdfMetadata,
} from '../utils/metadata'
import { PII_TYPES, PII_TYPE_MAP, redactText, scanText, shortenValue } from '../utils/pii'

const SYNC_LIMIT = 50_000 // larger inputs are scanned in a worker
const MAX_TEXT = 10 * 1024 * 1024
const HIGHLIGHT_LIMIT = 200_000 // characters rendered with highlights
const LIST_LIMIT = 200
const TEXT_FILE_ACCEPT = '.txt,.csv,.tsv,.log,.json,.md,.xml,.yaml,.yml,.ini,.conf,.env,.html,.htm,.js,.ts,.sql,.eml,text/*'

const SEVERITY = {
    high: { label: 'High', badge: 'badge-danger', mark: { background: 'var(--danger-bg)', boxShadow: 'inset 0 -2px 0 var(--danger)' } },
    medium: { label: 'Medium', badge: 'badge-warning', mark: { background: 'var(--warning-bg)', boxShadow: 'inset 0 -2px 0 var(--warning)' } },
    low: { label: 'Low', badge: 'badge-info', mark: { background: 'var(--info-bg)', boxShadow: 'inset 0 -2px 0 var(--info)' } },
}

const SAMPLE = [
    'Hi team, details for the new contractor:',
    '',
    'Email: jane.doe@example.com',
    'Phone: +1 (555) 010-0199',
    'Card on file: 4111 1111 1111 1111',
    'IBAN: GB82 WEST 1234 5698 7654 32',
    'Last login from 203.0.113.42',
    '',
    'Deploy settings:',
    'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    'DB_PASSWORD=correct-horse-battery-staple',
    'STRIPE_KEY=sk_test_EXAMPLE0000000000000000',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.c2lnbmF0dXJlLWV4YW1wbGU',
    ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7EXAMPLE0NLY',
    ['-----END', 'PRIVATE KEY-----'].join(' '),
].join('\n')

// ---------------------------------------------------------------------------
// Text scanning

function lineStarts(text) {
    const starts = [0]
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
    return starts
}

function lineOf(starts, index) {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid] <= index) lo = mid
        else hi = mid - 1
    }
    return lo + 1
}

function Highlighted({ text, findings, enabled }) {
    const limit = Math.min(text.length, HIGHLIGHT_LIMIT)
    const parts = []
    let last = 0
    for (const f of findings) {
        if (f.start >= limit) break
        if (!enabled.has(f.type) || f.start < last) continue
        if (f.start > last) parts.push(text.slice(last, f.start))
        const type = PII_TYPE_MAP[f.type]
        parts.push(
            <mark key={f.start} title={`${type.label}${f.detail ? ` · ${f.detail}` : ''}`} style={{ ...SEVERITY[type.severity].mark, color: 'var(--text-main)', borderRadius: 3, padding: '0 1px' }}>
                {text.slice(f.start, Math.min(f.end, limit))}
            </mark>
        )
        last = f.end
    }
    if (last < limit) parts.push(text.slice(last, limit))
    return (
        <>
            <pre className="code-well" tabIndex={0} aria-label="Scanned text with findings highlighted" style={{ margin: 0, maxHeight: 360, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{parts}</pre>
            {text.length > limit && <p className="field-hint">Highlights cover the first {limit.toLocaleString()} characters; the counts and the redacted copy cover all of it.</p>}
        </>
    )
}

function useTextScan(text) {
    const debounced = useDebouncedValue(text, 300)
    const scanTarget = debounced.length > MAX_TEXT ? debounced.slice(0, MAX_TEXT) : debounced
    const syncResult = useMemo(() => (scanTarget && scanTarget.length <= SYNC_LIMIT ? { text: scanTarget, ...scanText(scanTarget) } : null), [scanTarget])
    const [workerResult, setWorkerResult] = useState(null)

    useEffect(() => {
        if (!scanTarget || scanTarget.length <= SYNC_LIMIT) return undefined
        // A fresh worker per scan: a newer edit simply terminates the older scan
        const worker = new Worker(new URL('../workers/pii.worker.js', import.meta.url), { type: 'module' })
        const finish = (result) => {
            clearTimeout(timer)
            worker.terminate()
            setWorkerResult(result)
        }
        const timer = setTimeout(() => finish({ text: scanTarget, error: 'The scan took too long and was stopped.' }), 30_000)
        worker.onmessage = (event) => finish(event.data?.error ? { text: scanTarget, error: event.data.error } : { text: scanTarget, ...event.data.result })
        worker.onerror = (event) => finish({ text: scanTarget, error: event.message || 'The scanner couldn’t start.' })
        worker.postMessage({ id: 1, text: scanTarget })
        return () => {
            clearTimeout(timer)
            worker.terminate()
        }
    }, [scanTarget])

    const result = !scanTarget ? null : scanTarget.length <= SYNC_LIMIT ? syncResult : (workerResult?.text === scanTarget ? workerResult : null)
    const busy = text !== debounced || (!!scanTarget && !result)
    return { result, busy, truncatedInput: debounced.length > MAX_TEXT }
}

function TextMode({ text, setText }) {
    const toast = useToast()
    const { size } = usePane()
    const inputId = useId()
    const { result, busy, truncatedInput } = useTextScan(text)
    const [disabled, setDisabled] = useState(() => new Set())
    const [style, setStyle] = useState('label')

    const findings = useMemo(() => result?.findings ?? [], [result])
    const enabled = useMemo(() => new Set(PII_TYPES.map(t => t.id).filter(id => !disabled.has(id))), [disabled])
    const activeFindings = useMemo(() => findings.filter(f => enabled.has(f.type)), [findings, enabled])
    const redacted = useMemo(() => (result?.findings ? redactText(result.text, findings, { style, types: enabled }) : ''), [result, findings, style, enabled])
    const starts = useMemo(() => (result?.text ? lineStarts(result.text) : [0]), [result])
    const presentTypes = PII_TYPES.filter(t => result?.counts?.[t.id])
    const hasHigh = activeFindings.some(f => PII_TYPE_MAP[f.type].severity === 'high')

    const toggle = (id) => setDisabled(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    })

    const loadFile = async ([file]) => {
        if (file.size > MAX_TEXT) {
            toast.error(`${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_TEXT)}.`)
            return
        }
        try {
            setText(await file.text())
        } catch (err) {
            toast.error(`Couldn’t read ${file.name}: ${err?.message || 'unknown error'}`)
        }
    }

    return (
        <div className="split-pane">
            <section className="card" aria-label="Input" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <label htmlFor={inputId} className="section-title"><Type size={16} aria-hidden="true" /> Text to scan</label>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <PipelineRead onRead={setText} />
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setText(SAMPLE)}><Sparkles size={14} aria-hidden="true" /> Try a sample</button>
                        {text && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setText('')}><Trash2 size={14} aria-hidden="true" /> Clear</button>}
                    </div>
                </div>
                <textarea
                    id={inputId}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste an email, a log, a config file, a support ticket… Emails, phone numbers, card numbers, IBANs, IP addresses, API keys, tokens and passwords are found as you type."
                    spellCheck={false}
                    style={{ minHeight: 300, flex: 1 }}
                />
                <FileDropZone accept={TEXT_FILE_ACCEPT} onFiles={loadFile} compact icon={FileText} label="Load a text file" hint={size === 'sm' ? undefined : '.txt, .csv, .log, .json, .env…'} />
                <p className="field-hint" style={{ marginTop: 0 }}>Scanning runs entirely in your browser; nothing is uploaded.</p>
            </section>

            <section className="card" aria-label="Findings" aria-busy={busy} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                    <h2 className="section-title"><ScanEye size={16} aria-hidden="true" /> Findings</h2>
                    {busy && text && <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}><Loader2 size={14} className="spin" aria-hidden="true" /> Scanning…</span>}
                </div>

                {!text && <EmptyState icon={ScanEye} title="Nothing to scan yet">Paste text on the left, or try the sample.</EmptyState>}
                {truncatedInput && <StatusBanner tone="warning">Only the first {formatBytes(MAX_TEXT)} of this text is scanned.</StatusBanner>}
                {result?.error && <StatusBanner tone="danger" title="Couldn’t scan this text">{result.error} This is not an all-clear.</StatusBanner>}

                {result?.findings && (
                    <>
                        {findings.length === 0 ? (
                            <StatusBanner tone="success" title="No personal data or secrets found">
                                Checked for emails, phone numbers, card numbers, IBANs, US SSNs, IP addresses, JWTs, API tokens, private keys and passwords. Names and street addresses aren’t detected, so still read it before sharing.
                            </StatusBanner>
                        ) : (
                            <StatusBanner tone={hasHigh ? 'danger' : 'warning'} title={`Found ${activeFindings.length.toLocaleString()} item${activeFindings.length === 1 ? '' : 's'} to review`}>
                                {result.truncated
                                    ? 'There are too many to handle them all, so the redacted copy is turned off rather than left incomplete. Split the text into smaller parts.'
                                    : 'Copy the redacted text below to share a safe version.'}
                            </StatusBanner>
                        )}

                        {presentTypes.length > 0 && (
                            <div>
                                <div role="group" aria-label="Categories to highlight and redact" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {presentTypes.map(t => {
                                        const on = enabled.has(t.id)
                                        return (
                                            <button key={t.id} type="button" className={`chip ${on ? 'is-active' : ''}`} aria-pressed={on} onClick={() => toggle(t.id)} title={on ? 'Leave out of the highlights and the redacted copy' : 'Include again'}>
                                                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--${t.severity === 'high' ? 'danger' : t.severity === 'medium' ? 'warning' : 'info'})` }} />
                                                {t.label} <strong>{result.counts[t.id].toLocaleString()}</strong>
                                            </button>
                                        )
                                    })}
                                </div>
                                <p className="field-hint">Select a category to leave it out of the highlights and the redacted copy.</p>
                            </div>
                        )}

                        {findings.length > 0 && <Highlighted text={result.text} findings={findings} enabled={enabled} />}

                        {findings.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                <SegmentedControl
                                    ariaLabel="Redaction style"
                                    size="sm"
                                    value={style}
                                    onChange={setStyle}
                                    options={[{ value: 'label', label: '[EMAIL] labels' }, { value: 'mask', label: '**** masks' }]}
                                />
                                <CopyButton text={() => redacted} label="Copy redacted text" variant="primary" size="md" disabled={!activeFindings.length || result.truncated} />
                                <PipelineSend dataToSend={activeFindings.length && !result.truncated ? redacted : ''} label="Send redacted to pipeline" />
                            </div>
                        )}

                        {activeFindings.length > 0 && (
                            <details>
                                <summary style={{ cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}>List all {activeFindings.length.toLocaleString()} findings</summary>
                                <ul style={{ listStyle: 'none', margin: 'var(--space-sm) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {activeFindings.slice(0, LIST_LIMIT).map(f => {
                                        const type = PII_TYPE_MAP[f.type]
                                        return (
                                            <li key={f.start} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', fontSize: '0.85rem', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                                                <span className={`badge ${SEVERITY[type.severity].badge}`}>{type.label}</span>
                                                <code className="mono" style={{ overflowWrap: 'anywhere', color: 'var(--text-main)' }}>{shortenValue(f.value)}</code>
                                                <span style={{ color: 'var(--text-dim)' }}>line {lineOf(starts, f.start)}{f.detail ? ` · ${f.detail}` : ''}</span>
                                            </li>
                                        )
                                    })}
                                </ul>
                                {activeFindings.length > LIST_LIMIT && <p className="field-hint">…and {(activeFindings.length - LIST_LIMIT).toLocaleString()} more.</p>}
                            </details>
                        )}
                    </>
                )}
            </section>
        </div>
    )
}

// ---------------------------------------------------------------------------
// File metadata

async function classifyFile(file) {
    const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer())
    const imageType = sniffImageType(head)
    if (imageType === 'image/svg+xml') return { kind: 'svg' }
    if (imageType) return { kind: 'image', imageType }
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return { kind: 'pdf' } // %PDF
    if (isOfficeFile(file)) return { kind: 'office' }
    if (/^image\//.test(file.type) && file.type !== 'image/svg+xml') return { kind: 'image', imageType: file.type }
    try {
        // stream: a multi-byte character cut at the end of the sample isn't an error
        const text = new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true })
        // eslint-disable-next-line no-control-regex
        if (!/[\u0000-\u0008\u000e-\u001a]/.test(text)) return { kind: 'text' }
    } catch {
        // binary
    }
    return { kind: 'unsupported' }
}

// "BodySerialNumber" -> Body<wbr>Serial<wbr>Number for narrow layouts
function breakable(key) {
    const parts = key.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[/_-])/)
    return parts.flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]))
}

function RiskList({ risks }) {
    return (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {risks.map(risk => (
                <li key={risk.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', background: 'var(--bg-subtle)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span className={`badge ${SEVERITY[risk.severity].badge}`}>{SEVERITY[risk.severity].label}</span>
                        <strong style={{ fontSize: '0.95rem' }}>{risk.title}</strong>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 6 }}>{risk.why}</div>
                    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)', gap: '2px 12px', fontSize: '0.85rem', margin: 0 }}>
                        {risk.items.map((item, i) => (
                            <div key={`${item.key}-${i}`} style={{ display: 'contents' }}>
                                <dt style={{ color: 'var(--text-dim)', overflowWrap: 'break-word' }}>{breakable(item.key)}</dt>
                                <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{item.value}</dd>
                            </div>
                        ))}
                    </dl>
                </li>
            ))}
        </ul>
    )
}

function MetadataTable({ rows }) {
    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '0.85rem' }}>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={`${row.group ?? ''}${row.key}-${i}`} style={{ background: i % 2 ? 'var(--bg-subtle)' : 'transparent', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                            <th scope="row" style={{ width: '40%', padding: '6px 10px', textAlign: 'left', fontWeight: 500, color: 'var(--text-muted)', verticalAlign: 'top', overflowWrap: 'break-word' }}>
                                {row.group && <span style={{ color: 'var(--text-dim)' }}>{row.group} · </span>}{breakable(row.key)}
                            </th>
                            <td style={{ padding: '6px 10px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{row.value}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function FileMode({ onScanText }) {
    const navigate = useNavigate()
    const { size } = usePane()
    const { sendMedia } = usePipeline()
    const [file, setFile] = useState(null)
    const [report, setReport] = useState(null)
    const requestRef = useRef(0)

    const scan = async ([next]) => {
        const id = ++requestRef.current
        setFile(next)
        setReport({ status: 'scanning' })
        try {
            const { kind, imageType } = await classifyFile(next)
            let result
            if (kind === 'image') {
                const meta = await readImageMetadata(next)
                result = { kind, imageType, meta, risks: findImageRisks(meta), rows: meta.groups.flatMap(g => g.rows.map(r => ({ ...r, group: g.label }))) }
            } else if (kind === 'pdf') {
                const meta = await readPdfMetadata(next)
                result = meta.encrypted
                    ? { kind, encrypted: true, rows: meta.rows }
                    : { kind, meta, risks: findPdfRisks(meta), rows: meta.rows }
            } else if (kind === 'office') {
                const meta = await readOfficeMetadata(next)
                result = { kind, meta, risks: findOfficeRisks(meta), rows: meta.rows }
            } else {
                result = { kind }
            }
            if (id === requestRef.current) setReport({ status: 'done', ...result })
        } catch (err) {
            if (id === requestRef.current) setReport({ status: 'error', message: err?.message || 'The file couldn’t be read.' })
        }
    }

    const openInExif = () => {
        sendMedia(file, { source: '/privacy-scanner', target: '/exif', kind: 'image' })
        navigate('/exif')
    }

    const scanContents = async () => {
        try {
            onScanText(await file.text())
        } catch (err) {
            setReport({ status: 'error', message: `The file couldn’t be read as text: ${err?.message || 'unknown error'}` })
        }
    }

    const ext = splitFilename(file?.name || '').ext.toUpperCase()
    const done = report?.status === 'done'
    const risks = done ? report.risks : null
    const highCount = risks ? risks.filter(r => r.severity === 'high').length : 0
    const mediumCount = risks ? risks.filter(r => r.severity === 'medium').length : 0
    const typeName = !done ? '' : report.kind === 'image' ? typeLabel(report.imageType || file.type)
        : report.kind === 'pdf' ? 'PDF'
            : report.kind === 'office' ? report.meta.kind
                : report.kind === 'svg' ? 'SVG'
                    : report.kind === 'text' ? 'Text' : ext

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', width: '100%', maxWidth: 900, margin: '0 auto' }}>
            <FileDropZone
                onFiles={scan}
                compact={!!file}
                icon={FileSearch}
                label={file ? 'Scan another file' : 'Drop a file here or click to choose one'}
                hint={file ? (size === 'sm' ? undefined : 'Photo, PDF or Office document') : 'Photos (JPEG, PNG, WebP, HEIC, AVIF, TIFF, GIF), PDFs and Office documents (Word, Excel, PowerPoint, OpenDocument). Nothing is uploaded.'}
                style={file ? undefined : { minHeight: 220 }}
            />

            {file && report && (
                <section className="card" aria-label="Scan result" aria-busy={report.status === 'scanning'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <h2 className="section-title" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{file.name}</h2>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {formatBytes(file.size)}{typeName ? ` · ${typeName}` : ''}
                        </span>
                    </div>

                    {report.status === 'scanning' && (
                        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                            <Loader2 size={16} className="spin" aria-hidden="true" /> Looking for hidden metadata…
                        </div>
                    )}

                    {report.status === 'error' && (
                        <StatusBanner tone="danger" title="Couldn’t analyze this file">
                            {report.message} This is not an all-clear: the file may still contain metadata.
                        </StatusBanner>
                    )}

                    {done && report.kind === 'unsupported' && (
                        <StatusBanner tone="info" title="This file type isn’t supported">
                            The scanner reads hidden metadata in images, PDFs and Office documents. {ext ? `${ext} files` : 'Files like this'} weren’t checked, so this is not an all-clear.
                        </StatusBanner>
                    )}

                    {done && report.kind === 'svg' && (
                        <StatusBanner
                            tone="info"
                            title="SVG metadata is part of the markup"
                            action={<button type="button" className="btn btn-sm btn-secondary" onClick={scanContents}><ScanEye size={14} aria-hidden="true" /> Scan its text</button>}
                        >
                            SVG files are text. Editors often leave a &lt;title&gt;, &lt;metadata&gt; block and inkscape:/sodipodi: attributes with file paths and names. Scan the text, then remove those parts (an SVG optimiser does this).
                        </StatusBanner>
                    )}

                    {done && report.kind === 'text' && (
                        <StatusBanner
                            tone="info"
                            title="Plain text has no hidden metadata"
                            action={<button type="button" className="btn btn-sm btn-secondary" onClick={scanContents}><ScanEye size={14} aria-hidden="true" /> Scan its text</button>}
                        >
                            But the text itself may contain personal data or secrets. Scan its contents to check.
                        </StatusBanner>
                    )}

                    {done && report.encrypted && (
                        <StatusBanner tone="warning" title="Couldn’t read this PDF’s properties">
                            The PDF is encrypted, so its author, title and other properties are encrypted too and can’t be checked here. This is not an all-clear.
                        </StatusBanner>
                    )}

                    {risks && risks.length > 0 && (
                        <StatusBanner
                            tone={highCount ? 'danger' : mediumCount ? 'warning' : 'info'}
                            title={highCount || mediumCount
                                ? `Found ${risks.length} kind${risks.length === 1 ? '' : 's'} of metadata that could identify someone`
                                : 'Only minor metadata found'}
                        >
                            {!highCount && !mediumCount && 'Software names and dates, nothing that names a person or place. '}
                            {report.kind === 'image' && 'Remove it before sharing the photo.'}
                            {report.kind === 'pdf' && 'To remove it, use “Remove Hidden Information” in Acrobat, or clear the document properties and export a fresh copy.'}
                            {report.kind === 'office' && 'To remove it in Office, use File → Info → Check for Issues → Inspect Document.'}
                        </StatusBanner>
                    )}

                    {risks && risks.length === 0 && (
                        <StatusBanner tone="success" title="No identifying metadata found">
                            {report.kind === 'image' && (report.meta.count ? 'Only technical details (size, encoding, colour profile) are stored.' : 'This image has no metadata at all.')}
                            {report.kind === 'pdf' && 'No author, title, comments or other identifying properties are set.'}
                            {report.kind === 'office' && 'No author, company, comments or other identifying properties are set.'}
                            {' '}The visible content itself isn’t checked.
                        </StatusBanner>
                    )}

                    {risks && risks.length > 0 && report.kind === 'image' && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            <button type="button" className="btn btn-primary" onClick={openInExif}>
                                <Eraser size={16} aria-hidden="true" /> Remove metadata in EXIF Viewer
                            </button>
                            <span className="field-hint" style={{ marginTop: 0 }}>Opens this photo there to save a clean copy.</span>
                        </div>
                    )}

                    {risks && risks.length > 0 && <RiskList risks={risks} />}

                    {done && report.rows?.length > 0 && (
                        <details>
                            <summary style={{ cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}>All metadata ({report.rows.length} fields)</summary>
                            <div style={{ marginTop: 'var(--space-sm)' }}><MetadataTable rows={report.rows} /></div>
                        </details>
                    )}
                </section>
            )}
        </div>
    )
}

export default function PrivacyScanner() {
    const [mode, setMode] = useState('text')
    const [text, setText] = useState('')

    return (
        <div className="page page-wide">
            <ToolHeader
                actions={(
                    <SegmentedControl
                        ariaLabel="What to scan"
                        value={mode}
                        onChange={setMode}
                        options={[{ value: 'text', label: 'Text', icon: Type }, { value: 'file', label: 'File metadata', icon: ShieldCheck }]}
                    />
                )}
            />
            {/* Both modes stay mounted so switching keeps the text and the last file report */}
            <div hidden={mode !== 'text'}><TextMode text={text} setText={setText} /></div>
            <div hidden={mode !== 'file'}><FileMode onScanText={(content) => { setText(content); setMode('text') }} /></div>
        </div>
    )
}
