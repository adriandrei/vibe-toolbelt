import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, ExternalLink, FileStack, FileText, Loader2, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import Field from '../components/ui/Field'
import { useToast } from '../components/ToastProvider'
import { useObjectURL } from '../hooks/useObjectURL'
import { useLeaveGuard } from '../hooks/useLeaveGuard'
import { downloadBlob, formatBytes, splitFilename } from '../utils/download'

const MODES = [
    { value: 'merge', label: 'Merge PDFs' },
    { value: 'pages', label: 'Extract, rotate & split' },
]

const ROTATIONS = [
    { value: 0, label: 'None' },
    { value: 90, label: '90°' },
    { value: 180, label: '180°' },
    { value: 270, label: '270°' },
]

const OUTPUTS = [
    { value: 'pdf', label: 'One PDF' },
    { value: 'zip', label: 'One PDF per page (ZIP)' },
]

const MAX_OUTPUT_PAGES = 10_000
const ACCEPT = '.pdf,application/pdf'

/**
 * Parses a page selection such as "1-3, 5, 8-" against the page count.
 * Entry order and repeats are kept; "N-" runs to the last page and "-N"
 * starts at the first. Blank selects every page.
 * Returns { pages } (1-based) or { error }.
 */
function parsePageSelection(input, pageCount) {
    const text = input.trim()
    if (!text) return { pages: Array.from({ length: pageCount }, (_, i) => i + 1), all: true }
    const tokens = text.replace(/[‐-―−]/g, '-').replace(/\s*-\s*/g, '-').split(/[\s,;]+/).filter(Boolean)
    const pages = []
    const outOfRange = (n) => `Page ${n} doesn’t exist: this PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.`
    for (const token of tokens) {
        let start
        let end
        const single = token.match(/^\d+$/)
        const range = token.match(/^(\d*)-(\d*)$/)
        if (single) {
            start = end = Number(token)
        } else if (range && (range[1] || range[2])) {
            start = range[1] ? Number(range[1]) : 1
            end = range[2] ? Number(range[2]) : pageCount
        } else {
            return { error: `Can’t read “${token}”. Use page numbers and ranges such as 1-3, 5, 8-.` }
        }
        if (start < 1 || end < 1) return { error: 'Pages are numbered from 1.' }
        if (start > pageCount) return { error: outOfRange(start) }
        if (end > pageCount) return { error: outOfRange(end) }
        if (start > end) return { error: `“${token}” runs backwards. Did you mean ${end}-${start}?` }
        if (pages.length + (end - start + 1) > MAX_OUTPUT_PAGES) return { error: `That selects more than ${MAX_OUTPUT_PAGES.toLocaleString()} pages.` }
        for (let n = start; n <= end; n++) pages.push(n)
    }
    return { pages }
}

function describeError(err, fallbackName) {
    const name = err?.fileName || fallbackName
    if (err?.kind === 'encrypted') return `“${name}” is password-protected (encrypted). Remove the protection first, for example by printing it to a new PDF.`
    if (err?.kind === 'not-pdf') return `“${name}” isn’t a PDF file.`
    if (err?.kind === 'corrupt') return `“${name}” couldn’t be read; it may be damaged. (${err.message})`
    return err?.message || 'Something went wrong while processing the PDF.'
}

function summarize(pages) {
    const shown = pages.slice(0, 24).join(', ')
    return pages.length > 24 ? `${shown}, … (${pages.length.toLocaleString()} pages)` : shown
}

// Runs PDF jobs in a worker, created on first use and terminated on unmount
function usePdfWorker() {
    const workerRef = useRef(null)
    const pendingRef = useRef(new Map())
    const nextIdRef = useRef(0)

    useEffect(() => {
        const pending = pendingRef.current
        return () => {
            workerRef.current?.terminate()
            workerRef.current = null
            for (const job of pending.values()) job.reject(new Error('Cancelled'))
            pending.clear()
        }
    }, [])

    return useCallback((type, payload, onProgress) => new Promise((resolve, reject) => {
        const pending = pendingRef.current
        if (!workerRef.current) {
            const worker = new Worker(new URL('../workers/pdf.worker.js', import.meta.url), { type: 'module' })
            worker.onmessage = (event) => {
                const { id, result, error, progress } = event.data
                const job = pending.get(id)
                if (!job) return
                if (progress) {
                    job.onProgress?.(progress)
                    return
                }
                pending.delete(id)
                if (error) job.reject(Object.assign(new Error(error.message), error))
                else job.resolve(result)
            }
            worker.onerror = (event) => {
                for (const job of pending.values()) job.reject(new Error(event.message || 'The PDF worker stopped unexpectedly.'))
                pending.clear()
                worker.terminate()
                workerRef.current = null
            }
            workerRef.current = worker
        }
        const id = ++nextIdRef.current
        pending.set(id, { resolve, reject, onProgress })
        workerRef.current.postMessage({ id, type, payload })
    }), [])
}

function FileRow({ entry, index, count, onMove, onRemove }) {
    const url = useObjectURL(entry.file)
    const { name, size } = entry.file
    return (
        <li
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm)',
                padding: '0.6rem 0.75rem',
                background: 'var(--bg-subtle)',
                border: `1px solid ${entry.status === 'error' ? 'var(--danger-border)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
            }}
        >
            <FileText size={18} aria-hidden="true" style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</div>
                <div style={{ fontSize: '0.8rem', color: entry.status === 'error' ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {entry.status === 'checking' && 'Reading…'}
                    {entry.status === 'ready' && `${entry.pages} page${entry.pages === 1 ? '' : 's'} · ${formatBytes(size)}`}
                    {entry.status === 'error' && entry.error}
                </div>
            </div>
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                {url && entry.status === 'ready' && (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="icon-btn" aria-label={`Open ${name} in a new tab`} title="Open in a new tab">
                        <ExternalLink size={16} aria-hidden="true" />
                    </a>
                )}
                {onMove && (
                    <>
                        <button type="button" className="icon-btn" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label={`Move ${name} up`} title="Move up">
                            <ArrowUp size={16} aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-btn" onClick={() => onMove(index, 1)} disabled={index === count - 1} aria-label={`Move ${name} down`} title="Move down">
                            <ArrowDown size={16} aria-hidden="true" />
                        </button>
                    </>
                )}
                <button type="button" className="icon-btn" onClick={() => onRemove(entry.id)} aria-label={`Remove ${name}`} title="Remove">
                    <Trash2 size={16} aria-hidden="true" />
                </button>
            </div>
        </li>
    )
}

export default function PdfTools() {
    const toast = useToast()
    const runJob = usePdfWorker()
    const pagesId = useId()
    const idRef = useRef(0)

    const [mode, setMode] = useState('merge')
    const [files, setFiles] = useState([]) // merge list
    const [single, setSingle] = useState(null) // extract/rotate/split source
    const [selection, setSelection] = useState('')
    const [rotation, setRotation] = useState(0)
    const [output, setOutput] = useState('pdf')
    const [busy, setBusy] = useState(null) // { label, done, total }
    const [error, setError] = useState(null)

    useLeaveGuard(!!busy, 'A PDF is still being processed. Leave anyway?')

    const inspect = (entry, apply) => {
        runJob('inspect', { file: entry.file })
            .then(({ pages }) => apply(entry.id, { status: 'ready', pages }))
            .catch(err => apply(entry.id, { status: 'error', error: describeError(err, entry.file.name) }))
    }

    const newEntry = (file) => ({ id: ++idRef.current, file, status: 'checking', pages: null, error: null })

    // ---- merge
    const updateFile = (id, patch) => setFiles(list => list.map(f => (f.id === id ? { ...f, ...patch } : f)))
    const addFiles = (list) => {
        const entries = list.map(newEntry)
        setFiles(prev => [...prev, ...entries])
        setError(null)
        entries.forEach(entry => inspect(entry, updateFile))
    }
    const moveFile = (index, delta) => setFiles((list) => {
        const target = index + delta
        if (target < 0 || target >= list.length) return list
        const next = [...list]
        ;[next[index], next[target]] = [next[target], next[index]]
        return next
    })
    const removeFile = (id) => setFiles(list => list.filter(f => f.id !== id))

    const readyFiles = files.filter(f => f.status === 'ready')
    const totalPages = readyFiles.reduce((sum, f) => sum + f.pages, 0)
    const canMerge = files.length >= 2 && readyFiles.length === files.length && !busy

    const merge = async () => {
        setError(null)
        setBusy({ label: 'Merging', done: 0, total: files.length })
        try {
            const { bytes, pages } = await runJob('merge', { files: files.map(f => f.file) }, p => setBusy(b => (b ? { ...b, ...p } : b)))
            const blob = new Blob([bytes], { type: 'application/pdf' })
            downloadBlob(blob, 'merged.pdf')
            toast.success(`Downloaded merged.pdf (${pages} pages, ${formatBytes(blob.size)})`)
        } catch (err) {
            setError(describeError(err))
        } finally {
            setBusy(null)
        }
    }

    // ---- extract / rotate / split
    const updateSingle = (id, patch) => setSingle(entry => (entry && entry.id === id ? { ...entry, ...patch } : entry))
    const pickSingle = ([file]) => {
        const entry = newEntry(file)
        setSingle(entry)
        setSelection('')
        setError(null)
        inspect(entry, updateSingle)
    }

    const parsed = single?.status === 'ready' ? parsePageSelection(selection, single.pages) : null
    const canExtract = !!parsed?.pages && !busy

    const extract = async () => {
        if (!parsed?.pages) return
        setError(null)
        const split = output === 'zip'
        const base = splitFilename(single.file.name).base || 'document'
        setBusy({ label: split ? 'Splitting' : 'Building PDF', done: 0, total: split ? parsed.pages.length : 0 })
        try {
            const { bytes, pages } = await runJob(
                'extract',
                { file: single.file, pages: parsed.pages, rotation, split, baseName: base },
                p => setBusy(b => (b ? { ...b, ...p } : b)),
            )
            const name = split ? `${base}-pages.zip` : parsed.all ? `${base}-rotated.pdf` : `${base}-pages.pdf`
            const blob = new Blob([bytes], { type: split ? 'application/zip' : 'application/pdf' })
            downloadBlob(blob, name)
            toast.success(`Downloaded ${name} (${pages} page${pages === 1 ? '' : 's'}, ${formatBytes(blob.size)})`)
        } catch (err) {
            setError(describeError(err, single.file.name))
        } finally {
            setBusy(null)
        }
    }

    const progressText = busy ? `${busy.label}…${busy.total ? ` ${busy.done}/${busy.total}` : ''}` : null
    const nothingToRotate = parsed?.all && rotation === 0 && output === 'pdf'

    return (
        <div className="page page-medium">
            <ToolHeader />

            <SegmentedControl ariaLabel="Tool" value={mode} onChange={(m) => { setMode(m); setError(null) }} options={MODES} block disabled={!!busy} />

            {mode === 'merge' && (
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <FileDropZone
                        accept={ACCEPT}
                        multiple
                        onFiles={addFiles}
                        icon={FileStack}
                        label={files.length ? 'Add more PDFs' : 'Drop PDFs here or click to browse'}
                        hint="Files are combined in the order shown below. Nothing is uploaded."
                        compact={files.length > 0}
                    />

                    {files.length > 0 && (
                        <ol aria-label="Files to merge" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                            {files.map((entry, i) => (
                                <FileRow key={entry.id} entry={entry} index={i} count={files.length} onMove={moveFile} onRemove={removeFile} />
                            ))}
                        </ol>
                    )}

                    {error && <StatusBanner tone="danger" title="Merge failed">{error}</StatusBanner>}

                    <button type="button" className="btn btn-primary btn-lg" onClick={merge} disabled={!canMerge}>
                        {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
                        {busy ? progressText : canMerge ? `Merge ${files.length} files (${totalPages} pages)` : 'Merge and download'}
                    </button>
                    <div className="field-hint" style={{ margin: 0 }}>
                        {files.length === 1
                            ? 'Add at least one more PDF to merge.'
                            : files.some(f => f.status === 'error')
                                ? 'Remove the files that can’t be read to continue.'
                                : 'The merged file keeps every page, but not bookmarks, form fields or links (a pdf-lib limitation).'}
                    </div>
                </div>
            )}

            {mode === 'pages' && (
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                    {single ? (
                        <ul style={{ listStyle: 'none' }}>
                            <FileRow entry={single} index={0} count={1} onRemove={() => { setSingle(null); setError(null) }} />
                        </ul>
                    ) : null}
                    <FileDropZone
                        accept={ACCEPT}
                        onFiles={pickSingle}
                        icon={FileText}
                        label={single ? 'Choose a different PDF' : 'Drop a PDF here or click to browse'}
                        hint={single ? undefined : 'Pick pages, rotate them, or split the file into one PDF per page.'}
                        compact={!!single}
                    />

                    {single?.status === 'ready' && (
                        <>
                            <Field
                                label="Pages"
                                error={parsed?.error}
                                hint={parsed?.pages ? (parsed.all ? `All ${single.pages} pages. Type e.g. 1-3, 5, 8- to pick some.` : `${parsed.pages.length} page${parsed.pages.length === 1 ? '' : 's'}: ${summarize(parsed.pages)}`) : undefined}
                            >
                                <input
                                    id={pagesId}
                                    type="text"
                                    value={selection}
                                    onChange={e => setSelection(e.target.value)}
                                    placeholder={`All pages (1-${single.pages})`}
                                    spellCheck={false}
                                    autoComplete="off"
                                    className={parsed?.error ? 'field-invalid' : undefined}
                                />
                            </Field>

                            <div>
                                <span className="field-label">Rotate clockwise</span>
                                <SegmentedControl ariaLabel="Rotate clockwise" value={rotation} onChange={setRotation} options={ROTATIONS} size="sm" />
                            </div>

                            <div>
                                <span className="field-label">Output</span>
                                <SegmentedControl ariaLabel="Output" value={output} onChange={setOutput} options={OUTPUTS} size="sm" />
                            </div>

                            {error && <StatusBanner tone="danger" title="Couldn’t create the file">{error}</StatusBanner>}

                            <button type="button" className="btn btn-primary btn-lg" onClick={extract} disabled={!canExtract || nothingToRotate}>
                                {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
                                {busy ? progressText : output === 'zip' ? 'Download ZIP' : 'Download PDF'}
                            </button>
                            <div className="field-hint" style={{ margin: 0 }}>
                                {nothingToRotate
                                    ? 'Pick some pages, a rotation or the ZIP output.'
                                    : 'Pages are copied in the order you list them, repeats included. New files don’t keep bookmarks, form fields or links.'}
                            </div>
                        </>
                    )}
                    {single?.status === 'error' && <StatusBanner tone="danger" title="Can’t open this PDF">{single.error}</StatusBanner>}
                </div>
            )}
        </div>
    )
}
