import { useId, useMemo, useState } from 'react'
import { Download, FileUp, Shapes, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import FileDropZone from '../components/ui/FileDropZone'
import SliderField from '../components/ui/SliderField'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useToast } from '../components/ToastProvider'
import { useSmartInput } from '../hooks/useSmartInput'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { DEFAULT_SVG_OPTIONS, optimizeSvg, svgDataUrl } from '../utils/svg'
import { downloadText, formatBytes, splitFilename } from '../utils/download'

const OPTION_LABELS = [
    { key: 'removeComments', label: 'Remove comments', hint: 'Licence comments that start with “<!--!” are kept.' },
    { key: 'removeMetadata', label: 'Remove metadata and editor data', hint: 'DOCTYPE, <metadata>, Inkscape, Illustrator, Sketch and Figma data.' },
    { key: 'collapseWhitespace', label: 'Minify whitespace and numbers', hint: 'Text, <style>, <script> and xml:space="preserve" content is left alone.' },
    { key: 'removeUnusedIds', label: 'Remove unreferenced ids', hint: 'Can break CSS or scripts outside the file that target them.' },
    { key: 'roundNumbers', label: 'Round numbers', hint: 'Lossy, but shrinks path data the most.' },
]

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

function describeRemoved(removed) {
    const parts = []
    if (removed.comments) parts.push(plural(removed.comments, 'comment'))
    if (removed.metadata) parts.push(plural(removed.metadata, 'metadata block'))
    if (removed.editorData) parts.push(plural(removed.editorData, 'editor attribute/element'))
    if (removed.whitespace) parts.push(plural(removed.whitespace, 'whitespace node'))
    if (removed.emptyGroups) parts.push(plural(removed.emptyGroups, 'empty group'))
    if (removed.ids) parts.push(plural(removed.ids, 'unused id'))
    return parts.length ? `Removed ${parts.join(', ')}.` : 'Nothing to remove; whitespace and numbers were tidied.'
}

function Preview({ title, src, size }) {
    const [failedSrc, setFailedSrc] = useState(null)
    return (
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', minWidth: 0 }}>
            <figcaption style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)', fontSize: '0.85rem' }}>
                <strong>{title}</strong>
                <span className="mono" style={{ color: 'var(--text-muted)' }}>{formatBytes(size)}</span>
            </figcaption>
            <div className="checkerboard" style={{ height: 220, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-sm)' }}>
                {failedSrc === src ? (
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>The browser couldn’t render this SVG as an image.</span>
                ) : (
                    <img src={src} alt={`${title} preview`} onError={() => setFailedSrc(src)} style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%', objectFit: 'contain' }} />
                )}
            </div>
        </figure>
    )
}

export default function SvgCompressor() {
    const toast = useToast()
    const inputId = useId()
    const outputId = useId()
    const optionsId = useId()
    const [input, setInput] = useState('')
    const [fileName, setFileName] = useState(null)
    const [options, setOptions] = useState({ ...DEFAULT_SVG_OPTIONS })

    const load = (text, name = null) => {
        setInput(text)
        setFileName(name)
    }

    useSmartInput({ input: (value) => load(value) })

    // Optimise as you type (debounced); big files get a longer pause
    const debounced = useDebouncedValue(input, input.length > 500_000 ? 600 : 200)
    const stale = debounced !== input
    const result = useMemo(() => (debounced.trim() ? optimizeSvg(debounced, options) : null), [debounced, options])
    const ok = result && !result.error
    const output = ok ? result.output : ''
    const beforeUrl = useMemo(() => (ok ? svgDataUrl(result.source) : null), [ok, result])
    const afterUrl = useMemo(() => (ok ? svgDataUrl(result.output) : null), [ok, result])

    const saved = ok ? result.before - result.after : 0
    const percent = ok && result.before ? (saved / result.before) * 100 : 0
    const downloadName = `${fileName ? splitFilename(fileName).base : 'optimized'}.min.svg`

    const onFiles = async ([file]) => {
        try {
            load(await file.text(), file.name)
        } catch (err) {
            toast.error(`Couldn’t read ${file.name}: ${err.message}`)
        }
    }

    const setOption = (key, value) => setOptions(prev => ({ ...prev, [key]: value }))

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="card card-compact" role="group" aria-label="Optimizations">
                <div className="auto-grid" style={{ '--auto-grid-min': '230px', gap: 'var(--space-sm) var(--space-lg)', alignItems: 'start' }}>
                    {OPTION_LABELS.map(opt => (
                        <div key={opt.key} style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start' }}>
                            <input
                                id={`${optionsId}-${opt.key}`}
                                type="checkbox"
                                checked={options[opt.key]}
                                onChange={e => setOption(opt.key, e.target.checked)}
                                aria-describedby={`${optionsId}-${opt.key}-hint`}
                                style={{ marginTop: '0.2rem' }}
                            />
                            <div style={{ minWidth: 0 }}>
                                <label htmlFor={`${optionsId}-${opt.key}`} style={{ fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer' }}>{opt.label}</label>
                                <div id={`${optionsId}-${opt.key}-hint`} className="field-hint" style={{ marginTop: 0 }}>{opt.hint}</div>
                            </div>
                        </div>
                    ))}
                    {options.roundNumbers && (
                        <SliderField label="Decimal places" value={options.precision} onChange={v => setOption('precision', v)} min={0} max={5} />
                    )}
                </div>
            </div>

            <div className="split-pane">
                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <label className="field-label" htmlFor={inputId} style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Shapes size={15} aria-hidden="true" /> Input SVG{fileName ? ` · ${fileName}` : ''}
                        </label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', alignItems: 'center' }}>
                            <PipelineRead onRead={text => load(text)} />
                            <FileDropZone accept=".svg,image/svg+xml" onFiles={onFiles} compact ariaLabel="Open an SVG file" style={{ padding: '0.3rem 0.65rem', borderWidth: 1, gap: 6 }}>
                                <FileUp size={14} aria-hidden="true" />
                                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Open file</span>
                            </FileDropZone>
                            <button type="button" className="icon-btn icon-btn-sm" onClick={() => load('')} disabled={!input} aria-label="Clear input" title="Clear">
                                <X size={14} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                    <textarea
                        id={inputId}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Paste your <svg> markup here…"
                        spellCheck={false}
                        aria-invalid={!!result?.error}
                        aria-describedby={result?.error ? `${inputId}-error` : undefined}
                        className={result?.error && !stale ? 'field-invalid' : undefined}
                        style={{ minHeight: 280, flex: 1, fontSize: '0.8rem', whiteSpace: 'pre', overflowWrap: 'normal' }}
                    />
                    {result?.error && !stale && (
                        <div id={`${inputId}-error`}>
                            <StatusBanner tone="danger" title="Not valid SVG">{result.error}</StatusBanner>
                        </div>
                    )}
                    {ok && result.fixes.length > 0 && (
                        <StatusBanner tone="info" title="Fixed for standalone use">{result.fixes.join(' ')}</StatusBanner>
                    )}
                </div>

                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <label className="field-label" htmlFor={outputId} style={{ marginBottom: 0 }}>Optimized</label>
                        {stale && input.trim() ? (
                            <span className="badge">Updating…</span>
                        ) : ok ? (
                            <span className={`badge ${saved > 0 ? 'badge-success' : 'badge-warning'}`}>
                                {saved > 0
                                    ? `Saved ${percent.toFixed(1)}% (${formatBytes(result.before)} → ${formatBytes(result.after)})`
                                    : `${formatBytes(-saved)} larger: nothing left to remove`}
                            </span>
                        ) : null}
                    </div>
                    <textarea
                        id={outputId}
                        value={output}
                        readOnly
                        placeholder="The optimized SVG appears here as you type."
                        spellCheck={false}
                        style={{ minHeight: 280, flex: 1, fontSize: '0.8rem', background: 'var(--bg-inset)', opacity: stale ? 0.6 : 1, wordBreak: 'break-all' }}
                    />
                    {ok && !stale && <div className="field-hint" style={{ margin: 0 }}>{describeRemoved(result.removed)}</div>}
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <CopyButton text={output} label="Copy SVG" variant="secondary" disabled={!ok || stale} />
                        <button type="button" className="btn btn-secondary btn-sm" disabled={!ok || stale} onClick={() => downloadText(output, downloadName, 'image/svg+xml')}>
                            <Download size={14} aria-hidden="true" /> Download .svg
                        </button>
                        <PipelineSend dataToSend={output} disabled={!ok || stale} />
                    </div>
                </div>
            </div>

            <section className="card card-compact" aria-label="Preview">
                {ok ? (
                    <div className="auto-grid" style={{ '--auto-grid-min': '240px' }}>
                        <Preview title="Before" src={beforeUrl} size={result.before} />
                        <Preview title="After" src={afterUrl} size={result.after} />
                    </div>
                ) : (
                    <EmptyState icon={Shapes} title="Preview">Paste or open an SVG to compare the original with the optimized version.</EmptyState>
                )}
            </section>
        </div>
    )
}
