import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileSearch, FileUp, Loader2, LocateFixed, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import CopyButton from '../components/ui/CopyButton'
import { PipelineRead } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { usePane } from '../contexts/pane'
import { formatBytes } from '../utils/download'
import { sniffFileType } from '../utils/base64'

const PAGE_SIZE = 512

const hex2 = (b) => b.toString(16).padStart(2, '0').toUpperCase()
const hexOffset = (n, digits) => n.toString(16).toUpperCase().padStart(digits, '0')
const printable = (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')

// Text from the pipeline or smart input: hex digits become bytes, anything else is UTF-8
function textToFile(text) {
    const compact = text.replace(/0x/gi, '').replace(/[\s:,-]/g, '')
    if (compact.length >= 2 && compact.length % 2 === 0 && /^[0-9a-f]+$/i.test(compact) && /[\s:,-]|^[0-9a-f]+$/i.test(text.trim())) {
        const bytes = new Uint8Array(compact.length / 2)
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16)
        return { file: new File([bytes], 'hex-input.bin', { type: 'application/octet-stream' }), note: 'Hex text converted to bytes' }
    }
    return { file: new File([text], 'text-input.txt', { type: 'text/plain' }), note: 'Text shown as UTF-8 bytes' }
}

function parseOffset(text) {
    const t = text.trim().toLowerCase().replace(/_/g, '')
    if (!t) return null
    if (/^0x[0-9a-f]+$/.test(t)) return parseInt(t.slice(2), 16)
    if (/^[0-9a-f]+h$/.test(t)) return parseInt(t.slice(0, -1), 16)
    if (/^\d+$/.test(t)) return Number(t)
    if (/^[0-9a-f]+$/.test(t)) return parseInt(t, 16)
    return NaN
}

export default function HexViewer() {
    const pane = usePane()
    const gotoId = useId()
    const [file, setFile] = useState(null)
    const [note, setNote] = useState(null)
    const [offset, setOffset] = useState(0)
    const [page, setPage] = useState(null) // { file, offset, bytes }
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [kind, setKind] = useState(null)
    const [highlight, setHighlight] = useState(null)
    const [gotoText, setGotoText] = useState('')
    const [gotoError, setGotoError] = useState(null)
    const requestRef = useRef(0)

    const size = file?.size ?? 0
    const totalPages = Math.max(1, Math.ceil(size / PAGE_SIZE))
    const pageIndex = Math.floor(offset / PAGE_SIZE)
    const narrow = pane.size === 'sm'
    const cols = narrow ? 8 : 16
    const gap = narrow ? '1ch' : '2ch'
    const offsetDigits = Math.max(8, (Math.max(size, 1) - 1).toString(16).length)

    // Read only the visible page; newer requests win over slower, older ones
    useEffect(() => {
        if (!file || file.size === 0) return undefined
        const request = ++requestRef.current
        const slow = setTimeout(() => {
            if (requestRef.current === request) setLoading(true)
        }, 150)
        file.slice(offset, offset + PAGE_SIZE).arrayBuffer()
            .then((buffer) => {
                if (requestRef.current !== request) return
                setPage({ file, offset, bytes: new Uint8Array(buffer) })
                setError(null)
            })
            .catch((e) => {
                if (requestRef.current !== request) return
                setPage(null)
                setError(e?.name === 'NotReadableError'
                    ? 'The file can’t be read any more. It may have been changed, moved or deleted; open it again.'
                    : `Couldn’t read the file: ${e?.message || e}`)
            })
            .finally(() => {
                clearTimeout(slow)
                if (requestRef.current === request) setLoading(false)
            })
        return () => clearTimeout(slow)
    }, [file, offset])

    // File type from the first bytes
    useEffect(() => {
        if (!file || file.size === 0) return undefined
        let alive = true
        file.slice(0, 64).arrayBuffer()
            .then((buffer) => {
                if (alive) setKind(sniffFileType(new Uint8Array(buffer)))
            })
            .catch(() => {})
        return () => {
            alive = false
        }
    }, [file])

    const open = (next, noteText = null) => {
        requestRef.current++
        setFile(next)
        setNote(noteText)
        setOffset(0)
        setPage(null)
        setKind(null)
        setError(null)
        setLoading(false)
        setHighlight(null)
        setGotoText('')
        setGotoError(null)
    }

    const close = () => open(null)

    const loadText = (text) => {
        if (typeof text !== 'string' || !text) return
        const { file: f, note: n } = textToFile(text)
        open(f, n)
    }

    useSmartInput({ input: () => {} }, { onInject: (values) => loadText(values.input) })

    const goToPage = (index) => {
        const clamped = Math.min(Math.max(index, 0), totalPages - 1)
        setOffset(clamped * PAGE_SIZE)
    }

    const goToOffset = (event) => {
        event?.preventDefault()
        const n = parseOffset(gotoText)
        if (n === null) return
        if (!Number.isFinite(n) || Number.isNaN(n)) {
            setGotoError('Use a decimal number (1024) or hex (0x400).')
            return
        }
        if (n >= size) {
            setGotoError(`The file ends at offset 0x${hexOffset(Math.max(size - 1, 0), 1)} (${(size - 1).toLocaleString()}).`)
            return
        }
        setGotoError(null)
        setHighlight(n)
        setOffset(Math.floor(n / PAGE_SIZE) * PAGE_SIZE)
    }

    const onDumpKeyDown = (event) => {
        const map = { PageDown: pageIndex + 1, PageUp: pageIndex - 1, Home: 0, End: totalPages - 1 }
        if (event.key in map) {
            event.preventDefault()
            goToPage(map[event.key])
        }
    }

    const bytes = page && page.file === file && page.offset === offset ? page.bytes : null

    const columns = useMemo(() => {
        if (!bytes) return null
        const offsets = []
        const hex = []
        const ascii = []
        for (let row = 0; row * cols < bytes.length; row++) {
            const start = row * cols
            const slice = bytes.subarray(start, start + cols)
            const rowOffset = offset + start
            offsets.push(hexOffset(rowOffset, offsetDigits))
            const hexCells = []
            const asciiCells = []
            for (let i = 0; i < cols; i++) {
                const b = slice[i]
                const sep = i === 0 ? '' : i === cols / 2 ? '  ' : ' '
                const h = b === undefined ? '  ' : hex2(b)
                const a = b === undefined ? ' ' : printable(b)
                if (highlight === rowOffset + i && b !== undefined) {
                    hexCells.push(sep, <mark key={`h${i}`} className="hex-mark">{h}</mark>)
                    asciiCells.push(<mark key={`a${i}`} className="hex-mark">{a}</mark>)
                } else {
                    hexCells.push(sep + h)
                    asciiCells.push(a)
                }
            }
            hex.push(hexCells)
            ascii.push(asciiCells)
        }
        return { offsets, hex, ascii }
    }, [bytes, cols, offset, offsetDigits, highlight])

    const pageDump = () => {
        if (!bytes) return ''
        const lines = []
        for (let start = 0; start < bytes.length; start += cols) {
            const slice = [...bytes.subarray(start, start + cols)]
            lines.push(`${hexOffset(offset + start, offsetDigits)}  ${slice.map(hex2).join(' ').padEnd(cols * 3 - 1)}  ${slice.map(printable).join('')}`)
        }
        return lines.join('\n')
    }

    const headerCells = Array.from({ length: cols }, (_, i) => `${i === 0 ? '' : i === cols / 2 ? '  ' : ' '}${hex2(i)}`).join('')
    const hexWidth = `${cols * 3}ch`
    const rangeEnd = Math.min(offset + PAGE_SIZE, size) - 1

    return (
        <div className="page page-medium page-hex">
            <style>{'.hex-mark { background: var(--primary-glow); color: var(--primary-text); outline: 1px solid var(--primary-border); border-radius: 2px; }'}</style>
            <ToolHeader />

            {!file ? (
                <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <FileDropZone
                        onFiles={([f]) => f && open(f)}
                        label="Drop a file here or click to choose one"
                        hint="Any file type and size. Only the page on screen is read, and nothing leaves your device."
                        icon={FileUp}
                    />
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <PipelineRead onRead={loadText} />
                    </div>
                </section>
            ) : (
                <>
                    <section className="card card-compact" aria-label="File" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-md)' }}>
                        <FileSearch size={22} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                            <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{file.name}</div>
                            <div className="field-hint" style={{ marginTop: 0 }}>
                                {size.toLocaleString()} bytes ({formatBytes(size)})
                                {kind ? ` · ${kind.label}` : file.type ? ` · ${file.type}` : ''}
                                {note ? ` · ${note}` : ''}
                            </div>
                        </div>
                        <FileDropZone compact onFiles={([f]) => f && open(f)} icon={FileUp} label="Open another" ariaLabel="Open another file" style={{ padding: '0.45rem 0.8rem', fontSize: '0.85rem' }} />
                        <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
                            <X size={14} aria-hidden="true" /> Close
                        </button>
                    </section>

                    {size === 0 ? (
                        <section className="card">
                            <EmptyState icon={FileSearch} title="This file is empty">It contains 0 bytes, so there’s nothing to show.</EmptyState>
                        </section>
                    ) : (
                        <section className="card card-compact" aria-label="Hex dump" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                                <nav aria-label="Pages" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => goToPage(0)} disabled={pageIndex === 0} aria-label="First page" title="First page (Home)">
                                        <ChevronsLeft size={14} aria-hidden="true" />
                                    </button>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => goToPage(pageIndex - 1)} disabled={pageIndex === 0} title="Previous page (Page Up)">
                                        <ChevronLeft size={14} aria-hidden="true" /> Prev
                                    </button>
                                    <span className="field-hint" style={{ marginTop: 0, padding: '0 6px', whiteSpace: 'nowrap' }} aria-live="polite">
                                        Page {(pageIndex + 1).toLocaleString()} of {totalPages.toLocaleString()}
                                    </span>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => goToPage(pageIndex + 1)} disabled={pageIndex >= totalPages - 1} title="Next page (Page Down)">
                                        Next <ChevronRight size={14} aria-hidden="true" />
                                    </button>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => goToPage(totalPages - 1)} disabled={pageIndex >= totalPages - 1} aria-label="Last page" title="Last page (End)">
                                        <ChevronsRight size={14} aria-hidden="true" />
                                    </button>
                                </nav>
                                <form onSubmit={goToOffset} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <label htmlFor={gotoId} className="sr-only">Go to offset</label>
                                    <input
                                        id={gotoId}
                                        type="text"
                                        value={gotoText}
                                        onChange={e => { setGotoText(e.target.value); setGotoError(null) }}
                                        placeholder="Offset: 0x1F0 or 496"
                                        spellCheck={false}
                                        autoComplete="off"
                                        aria-invalid={gotoError ? true : undefined}
                                        aria-describedby={gotoError ? `${gotoId}-error` : undefined}
                                        className={gotoError ? 'field-invalid' : ''}
                                        style={{ width: '11.5rem', padding: '0.35rem 0.6rem', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}
                                    />
                                    <button type="submit" className="btn btn-secondary btn-sm" disabled={!gotoText.trim()}>
                                        <LocateFixed size={14} aria-hidden="true" /> Go
                                    </button>
                                </form>
                            </div>
                            {gotoError && <div id={`${gotoId}-error`} className="field-error" style={{ marginTop: 0 }}>{gotoError}</div>}

                            {error && <StatusBanner tone="danger" title="Read error">{error}</StatusBanner>}

                            <div
                                role="region"
                                aria-label={`Bytes 0x${hexOffset(offset, offsetDigits)} to 0x${hexOffset(rangeEnd, offsetDigits)}. Page Up and Page Down change the page.`}
                                tabIndex={0}
                                onKeyDown={onDumpKeyDown}
                                className="code-well"
                                style={{ position: 'relative', whiteSpace: 'normal', padding: narrow ? 'var(--space-sm)' : 'var(--space-sm) var(--space-md)', fontSize: narrow ? '0.72rem' : '0.8rem', lineHeight: 1.6, overflowX: 'auto', minHeight: 120, fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "calt" 0' }}
                            >
                                <div style={{ display: 'flex', gap, width: 'max-content', color: 'var(--text-dim)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 4, whiteSpace: 'pre', userSelect: 'none' }} aria-hidden="true">
                                    <span style={{ width: `${offsetDigits}ch` }}>Offset</span>
                                    <span style={{ width: hexWidth }}>{headerCells}</span>
                                    <span style={{ width: `calc(${cols + 1}ch + 1px)`, paddingLeft: '1ch' }}>ASCII</span>
                                </div>
                                {columns ? (
                                    <div style={{ display: 'flex', gap, width: 'max-content' }}>
                                        <pre style={{ margin: 0, width: `${offsetDigits}ch`, color: 'var(--primary-text)', userSelect: 'none', font: 'inherit', whiteSpace: 'pre' }}>
                                            {columns.offsets.join('\n')}
                                        </pre>
                                        <pre style={{ margin: 0, width: hexWidth, color: 'var(--text-code)', font: 'inherit', whiteSpace: 'pre' }}>
                                            {columns.hex.map((cells, i) => <Fragment key={i}>{cells}{'\n'}</Fragment>)}
                                        </pre>
                                        <pre style={{ margin: 0, width: `calc(${cols + 1}ch + 1px)`, color: 'var(--text-muted)', font: 'inherit', whiteSpace: 'pre', borderLeft: '1px solid var(--border)', paddingLeft: '1ch' }}>
                                            {columns.ascii.map((cells, i) => <Fragment key={i}>{cells}{'\n'}</Fragment>)}
                                        </pre>
                                    </div>
                                ) : !error && (
                                    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', padding: 'var(--space-md) 0', fontFamily: 'var(--font-family)' }}>
                                        <Loader2 size={16} className="spin" aria-hidden="true" /> Reading…
                                    </div>
                                )}
                                {loading && columns && (
                                    <div role="status" style={{ position: 'absolute', top: 8, right: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontFamily: 'var(--font-family)' }}>
                                        <Loader2 size={14} className="spin" aria-hidden="true" /> Reading…
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                                <span className="field-hint mono" style={{ marginTop: 0 }}>
                                    0x{hexOffset(offset, offsetDigits)} – 0x{hexOffset(rangeEnd, offsetDigits)}
                                </span>
                                <CopyButton text={pageDump} label="Copy page" disabled={!bytes} />
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    )
}
