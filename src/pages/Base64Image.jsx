import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Download, FileImage, ImageDown, ImageOff, Loader2, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import SegmentedControl from '../components/ui/SegmentedControl'
import CopyButton from '../components/ui/CopyButton'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import Field from '../components/ui/Field'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useToast } from '../components/ToastProvider'
import { usePane } from '../contexts/pane'
import { useSmartInput } from '../hooks/useSmartInput'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useObjectURL } from '../hooks/useObjectURL'
import { downloadBlob, formatBytes, splitFilename } from '../utils/download'
import { extensionForType, sniffImageType, typeLabel } from '../utils/image'

const ACCEPT = 'image/*,.svg,.ico,.heic,.heif,.avif,.bmp,.tif,.tiff'
const WARN_BYTES = 2 * 1024 * 1024 // data URIs above this slow pages down
const MAX_BYTES = 25 * 1024 * 1024
const PREVIEW_CHARS = 3000 // characters shown on screen; copies always use the full value
const MAX_DECODE_CHARS = 60 * 1024 * 1024

function escapeAttr(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function bytesToBase64(bytes) {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

/**
 * Accepts a data URI (base64 or percent-encoded) or raw Base64 and returns
 * { bytes, type, declared, warning } or { error }.
 */
function parseImageData(raw) {
    const text = raw.trim()
    if (!text) return null
    if (text.length > MAX_DECODE_CHARS) return { error: `That’s ${text.length.toLocaleString()} characters. The limit is ${MAX_DECODE_CHARS.toLocaleString()}.` }
    let declared = null
    let payload = text
    let isBase64 = true
    if (/^data:/i.test(text)) {
        const comma = text.indexOf(',')
        if (comma === -1) return { error: 'This data URI has no comma between the header and the data.' }
        const parts = text.slice(5, comma).split(';').map(p => p.trim().toLowerCase())
        declared = parts[0] || null
        isBase64 = parts.slice(1).includes('base64')
        payload = text.slice(comma + 1)
    }
    let bytes
    if (isBase64) {
        const clean = payload.replace(/\s+/g, '').replace(/%3D/gi, '=').replace(/-/g, '+').replace(/_/g, '/')
        const bad = clean.search(/[^A-Za-z0-9+/=]/)
        if (bad !== -1) return { error: `Not valid Base64: unexpected “${clean[bad]}” at character ${(bad + 1).toLocaleString()}.` }
        if (/=[^=]/.test(clean)) return { error: 'Not valid Base64: “=” padding can only appear at the end.' }
        const body = clean.replace(/=+$/, '')
        if (body.length % 4 === 1) return { error: 'Not valid Base64: the length is off by one character, so the data is probably cut short.' }
        let binary
        try {
            binary = atob(body + '='.repeat((4 - (body.length % 4)) % 4))
        } catch {
            return { error: 'Not valid Base64.' }
        }
        bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    } else {
        try {
            bytes = new TextEncoder().encode(decodeURIComponent(payload))
        } catch {
            return { error: 'The data URI contains invalid percent-encoding.' }
        }
    }
    if (!bytes.length) return { error: 'There’s no data to decode.' }
    const sniffed = sniffImageType(bytes.subarray(0, 4096))
    const declaredImage = declared && declared.startsWith('image/') ? declared : null
    const type = sniffed || declaredImage
    if (!type) {
        return {
            error: declared && !declaredImage
                ? `This data URI holds ${declared}, not an image.`
                : 'This doesn’t look like an image: the data doesn’t start with a known image signature (PNG, JPEG, GIF, WebP, SVG…).',
        }
    }
    let warning = null
    if (!sniffed) warning = `The data doesn’t match a known image format, so it’s shown as ${declared}. It may be damaged.`
    else if (declared && declared !== sniffed && !(declared === 'image/jpg' && sniffed === 'image/jpeg')) warning = `The header says ${declared}, but the data is ${typeLabel(sniffed)}.`
    return { bytes, type, declared, warning }
}

function DataPreview({ value }) {
    const truncated = value.length > PREVIEW_CHARS
    return (
        <pre className="code-well" aria-label="Data URI preview" style={{ margin: 0, maxHeight: 220, wordBreak: 'break-all', whiteSpace: 'pre-wrap', fontSize: '0.78rem' }}>
            {truncated ? value.slice(0, PREVIEW_CHARS) : value}
            {truncated && (
                <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
                    {`… ${(value.length - PREVIEW_CHARS).toLocaleString()} more characters. The copy buttons copy everything.`}
                </span>
            )}
        </pre>
    )
}

function EncodePanel({ active }) {
    const toast = useToast()
    const { size } = usePane()
    const [file, setFile] = useState(null)
    const [state, setState] = useState({ status: 'idle' })
    const [dims, setDims] = useState(null)
    const [alt, setAlt] = useState('')
    const readerRef = useRef(null)
    const previewUrl = useObjectURL(file)

    useEffect(() => () => readerRef.current?.abort(), [])

    const handleFile = async (next) => {
        readerRef.current?.abort()
        readerRef.current = null
        if (next.size > MAX_BYTES) {
            toast.error(`${next.name} is ${formatBytes(next.size)}. Data URIs that big aren’t practical; the limit is ${formatBytes(MAX_BYTES)}.`)
            return
        }
        setFile(next)
        setDims(null)
        setAlt(splitFilename(next.name || 'image').base.replace(/[-_]+/g, ' ').trim())
        setState({ status: 'reading' })
        let sniffed = null
        try {
            sniffed = sniffImageType(new Uint8Array(await next.slice(0, 4096).arrayBuffer()))
        } catch {
            // the full read below reports errors
        }
        const reader = new FileReader()
        readerRef.current = reader
        reader.onload = () => {
            if (readerRef.current !== reader) return
            let dataUri = typeof reader.result === 'string' ? reader.result : ''
            const comma = dataUri.indexOf(',')
            if (comma === -1) {
                setState({ status: 'error', message: 'The file couldn’t be encoded.' })
                return
            }
            // Files with a missing or wrong MIME type (e.g. .heic) get the real one
            const type = sniffed || next.type || 'application/octet-stream'
            dataUri = `data:${type};base64,${dataUri.slice(comma + 1)}`
            setState({ status: 'done', dataUri, type, base64Start: `data:${type};base64,`.length })
        }
        reader.onerror = () => {
            if (readerRef.current !== reader) return
            setState({ status: 'error', message: reader.error?.message || 'The file couldn’t be read.' })
        }
        reader.readAsDataURL(next)
    }

    const clear = () => {
        readerRef.current?.abort()
        readerRef.current = null
        setFile(null)
        setDims(null)
        setState({ status: 'idle' })
    }

    const done = state.status === 'done'
    const dataUri = done ? state.dataUri : ''
    const sizeAttrs = dims ? ` width="${dims.w}" height="${dims.h}"` : ''

    return (
        <div className="split-pane">
            <section className="card" aria-label="Image" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                    <h2 className="section-title"><FileImage size={16} aria-hidden="true" /> Image</h2>
                    {file && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>
                            <Trash2 size={14} aria-hidden="true" /> Clear
                        </button>
                    )}
                </div>
                {!file ? (
                    <FileDropZone
                        accept={ACCEPT}
                        onFiles={([f]) => handleFile(f)}
                        allowPaste={active}
                        icon={ImageDown}
                        label="Drop an image, paste it, or click to browse"
                        hint={`PNG, JPEG, GIF, WebP, SVG, ICO… up to ${formatBytes(MAX_BYTES)}. Small images (icons, placeholders) make the best data URIs.`}
                        style={{ minHeight: 260, flex: 1 }}
                    />
                ) : (
                    <>
                        <div className="checkerboard" style={{ position: 'relative', height: 260, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid var(--border)' }}>
                            {previewUrl && (
                                <img
                                    key={previewUrl}
                                    src={previewUrl}
                                    alt={`Preview of ${file.name}`}
                                    onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            )}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                            <strong style={{ color: 'var(--text-main)' }}>{file.name}</strong>
                            {' · '}{formatBytes(file.size)}
                            {done && ` · ${typeLabel(state.type)}`}
                            {dims && ` · ${dims.w}×${dims.h}`}
                        </div>
                        <FileDropZone accept={ACCEPT} onFiles={([f]) => handleFile(f)} compact label="Use a different image" hint={size === 'sm' ? undefined : 'or drop / paste it'} allowPaste={active} />
                    </>
                )}
            </section>

            <section className="card" aria-label="Base64 output" aria-busy={state.status === 'reading'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <h2 className="section-title">Data URI</h2>
                    {done && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {dataUri.length.toLocaleString()} characters (+{Math.round((dataUri.length / Math.max(1, file.size) - 1) * 100)}%)
                        </span>
                    )}
                </div>
                {state.status === 'idle' && (
                    <EmptyState icon={ImageDown} title="Nothing encoded yet">Choose an image to get its data URI, HTML and CSS snippets.</EmptyState>
                )}
                {state.status === 'reading' && (
                    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', padding: 'var(--space-lg) 0' }}>
                        <Loader2 size={16} className="spin" aria-hidden="true" /> Encoding…
                    </div>
                )}
                {state.status === 'error' && <StatusBanner tone="danger" title="Couldn’t read the file">{state.message}</StatusBanner>}
                {done && (
                    <>
                        {file.size > WARN_BYTES && (
                            <StatusBanner tone="warning" title="That’s a large data URI">
                                Inlining {formatBytes(file.size)} makes HTML and CSS slow to load and can’t be cached separately. Data URIs work best for images under a few KB.
                            </StatusBanner>
                        )}
                        <DataPreview value={dataUri} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                            <CopyButton text={() => dataUri} label="Copy data URI" variant="secondary" />
                            <CopyButton text={() => dataUri.slice(state.base64Start)} label="Copy raw Base64" variant="secondary" />
                            <CopyButton text={() => `<img src="${dataUri}" alt="${escapeAttr(alt)}"${sizeAttrs}>`} label="Copy HTML <img>" variant="secondary" />
                            <CopyButton text={() => `background-image: url("${dataUri}");`} label="Copy CSS" variant="secondary" />
                            <PipelineSend dataToSend={dataUri} />
                        </div>
                        <Field label="Alt text for the HTML snippet" hint="Describe the image for screen readers. Leave empty for decorative images.">
                            <input type="text" value={alt} onChange={(e) => setAlt(e.target.value)} style={{ padding: '0.55rem 0.75rem', fontSize: '0.9rem' }} />
                        </Field>
                    </>
                )}
            </section>
        </div>
    )
}

function DecodePanel({ text, setText }) {
    const inputId = useId()
    const debounced = useDebouncedValue(text, 250)
    const parsed = useMemo(() => parseImageData(debounced), [debounced])
    const blob = useMemo(() => (parsed?.bytes ? new Blob([parsed.bytes], { type: parsed.type }) : null), [parsed])
    const url = useObjectURL(blob)
    const [view, setView] = useState({ url: null, dims: null, failed: false })
    const viewForUrl = view.url === url ? view : { url, dims: null, failed: false }
    const pending = text !== debounced

    return (
        <div className="split-pane">
            <section className="card" aria-label="Encoded input" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <label htmlFor={inputId} className="section-title">Data URI or Base64</label>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <PipelineRead onRead={setText} />
                        {text && (
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setText('')}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        )}
                    </div>
                </div>
                <textarea
                    id={inputId}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={'data:image/png;base64,iVBORw0KGgo…\n\nor just the Base64 part'}
                    spellCheck={false}
                    autoComplete="off"
                    style={{ minHeight: 260, flex: 1, wordBreak: 'break-all', fontSize: '0.8rem' }}
                />
                <div className="field-hint" style={{ marginTop: 0 }}>
                    {text ? `${text.length.toLocaleString()} characters` : 'Percent-encoded SVG data URIs work too.'}
                </div>
            </section>

            <section className="card" aria-label="Decoded image" aria-busy={pending} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                <h2 className="section-title">Decoded image</h2>
                {!parsed && <EmptyState icon={ImageDown} title="Nothing to decode yet">Paste a data URI or Base64 to see the image and download it.</EmptyState>}
                {parsed?.error && <StatusBanner tone="danger" title="Can’t decode this">{parsed.error}</StatusBanner>}
                {parsed?.bytes && (
                    <>
                        {parsed.warning && <StatusBanner tone="warning">{parsed.warning}</StatusBanner>}
                        <div className="checkerboard" style={{ height: 260, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid var(--border)' }}>
                            {viewForUrl.failed ? (
                                <div className="stage" style={{ alignSelf: 'stretch', flex: 1, display: 'flex' }}>
                                    <EmptyState icon={ImageOff} title="No preview" style={{ color: 'var(--on-stage)', flex: 1 }}>
                                        This browser can’t display {typeLabel(parsed.type)} images, but you can still download the file.
                                    </EmptyState>
                                </div>
                            ) : url && (
                                <img
                                    key={url}
                                    src={url}
                                    alt="Decoded image"
                                    onLoad={(e) => setView({ url, dims: { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }, failed: false })}
                                    onError={() => setView({ url, dims: null, failed: true })}
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            )}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            <strong style={{ color: 'var(--text-main)' }}>{typeLabel(parsed.type)}</strong>
                            {' · '}{formatBytes(parsed.bytes.length)}
                            {viewForUrl.dims && ` · ${viewForUrl.dims.w}×${viewForUrl.dims.h}`}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => downloadBlob(blob, `decoded-image.${extensionForType(parsed.type, 'bin')}`)}>
                                <Download size={14} aria-hidden="true" /> Download .{extensionForType(parsed.type, 'bin')}
                            </button>
                            <CopyButton text={() => `data:${parsed.type};base64,${bytesToBase64(parsed.bytes)}`} label="Copy as data URI" variant="secondary" />
                            <CopyButton text={() => bytesToBase64(parsed.bytes)} label="Copy raw Base64" variant="secondary" />
                        </div>
                    </>
                )}
            </section>
        </div>
    )
}

export default function Base64Image() {
    const [mode, setMode] = useState('encode')
    const [decodeText, setDecodeText] = useState('')

    // Smart paste / palette send image data URIs here as { input, mode: 'decode' }
    useSmartInput(
        { input: setDecodeText, mode: (m) => setMode(m === 'encode' ? 'encode' : 'decode') },
        { onInject: (values) => { if (values.input && values.mode !== 'encode') setMode('decode') } },
    )

    return (
        <div className="page page-wide">
            <ToolHeader
                actions={(
                    <SegmentedControl
                        ariaLabel="Mode"
                        value={mode}
                        onChange={setMode}
                        options={[{ value: 'encode', label: 'Image → Base64' }, { value: 'decode', label: 'Base64 → Image' }]}
                    />
                )}
            />
            {/* Both panels stay mounted so switching modes keeps their state */}
            <div hidden={mode !== 'encode'}><EncodePanel active={mode === 'encode'} /></div>
            <div hidden={mode !== 'decode'}><DecodePanel text={decodeText} setText={setDecodeText} /></div>
        </div>
    )
}
