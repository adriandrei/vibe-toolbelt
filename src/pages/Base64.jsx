import { useId, useMemo, useState } from 'react'
import { ArrowDownUp, Download, FileUp, Paperclip, Trash2, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import CopyButton from '../components/ui/CopyButton'
import StatusBanner from '../components/ui/StatusBanner'
import FileDropZone from '../components/ui/FileDropZone'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useObjectURL } from '../hooks/useObjectURL'
import { useToast } from '../components/ToastProvider'
import {
    Base64Error, base64ToBytes, bytesToBase64, decodeUtf8, extensionForMime, hexDump,
    looksBinaryText, looksLikeBase64, normalizeBase64, sniffFileType, textToBase64,
} from '../utils/base64'
import { downloadBlob, downloadText, formatBytes, splitFilename } from '../utils/download'

const MODES = [
    { value: 'encode', label: 'Encode' },
    { value: 'decode', label: 'Decode' },
]

// Huge results are shown truncated; Copy and Download still use all of it
const DISPLAY_LIMIT = 200_000
const MAX_FILE_MB = 25

function encode({ input, file, urlSafe, dataUri }) {
    if (file) {
        const b64 = bytesToBase64(file.bytes, { urlSafe })
        return { kind: 'text', text: dataUri ? `data:${file.type || 'application/octet-stream'};base64,${b64}` : b64 }
    }
    if (!input) return null
    return { kind: 'text', text: textToBase64(input, { urlSafe }) }
}

function decode(input) {
    if (!input.trim()) return null
    const { base64, urlSafe, mime } = normalizeBase64(input)
    const bytes = base64ToBytes(base64)
    const text = decodeUtf8(bytes)
    if (text !== null && !looksBinaryText(text) && !(mime && !/^text\/|json|xml|javascript/.test(mime))) {
        return { kind: 'text', text, urlSafe, bytes: bytes.length }
    }
    const sniffed = sniffFileType(bytes)
    const type = mime ?? sniffed?.mime ?? null
    return {
        kind: 'binary',
        bytes,
        urlSafe,
        mime: type,
        label: sniffed?.label ?? (mime ? mime : null),
        ext: sniffed?.ext ?? (mime ? extensionForMime(mime) : 'bin'),
        invalidText: text === null,
    }
}

export default function Base64() {
    const toast = useToast()
    const inputId = useId()
    const outputId = useId()
    const [mode, setMode] = useState('encode')
    const [input, setInput] = useState('')
    const [file, setFile] = useState(null) // { name, type, bytes } when encoding a file
    const [urlSafe, setUrlSafe] = useState(false)
    const [dataUri, setDataUri] = useState(false)
    // Text loaded programmatically (pipeline, smart input, swap) skips the typing debounce
    const [loaded, setLoaded] = useState('')

    const debouncedInput = useDebouncedValue(input, input.length > 100_000 ? 400 : 120)
    const source = input === '' || input === loaded ? input : debouncedInput

    const { result, error } = useMemo(() => {
        try {
            const r = mode === 'encode' ? encode({ input: source, file, urlSafe, dataUri }) : decode(source)
            return { result: r, error: null }
        } catch (e) {
            if (e instanceof Base64Error) return { result: null, error: e.message }
            if (e instanceof RangeError) return { result: null, error: 'This is too large to process in the browser.' }
            return { result: null, error: e?.message || 'Couldn’t process the input.' }
        }
    }, [mode, source, file, urlSafe, dataUri])

    const outputText = result?.kind === 'text' ? result.text : ''
    const binary = result?.kind === 'binary' ? result : null
    const blob = useMemo(() => (binary ? new Blob([binary.bytes], { type: binary.mime || 'application/octet-stream' }) : null), [binary])
    const imageUrl = useObjectURL(binary?.mime?.startsWith('image/') ? blob : null)

    // Decode text that looks like Base64, encode anything else
    const loadText = (text, forcedMode) => {
        setFile(null)
        setInput(text)
        setLoaded(text)
        setMode(forcedMode === 'encode' || forcedMode === 'decode' ? forcedMode : looksLikeBase64(text) ? 'decode' : 'encode')
    }

    useSmartInput(
        { input: () => {}, mode: () => {} },
        { onInject: (values) => typeof values.input === 'string' && loadText(values.input, values.mode) }
    )

    useRegisterAIContext({
        tool: 'Base64 Encode / Decode',
        getContext: () => ({
            input: file ? `[file ${file.name}, ${file.bytes.length} bytes]` : input,
            output: binary ? `[binary data, ${binary.bytes.length} bytes${binary.label ? `, ${binary.label}` : ''}]` : outputText,
        }),
        suggestedPrompts: ['What does this decoded content contain?', 'Is this valid Base64?', 'Is this a JWT or some other format?', 'Are there any security concerns with this content?'],
    })

    const openFile = async ([f]) => {
        if (!f) return
        try {
            const bytes = new Uint8Array(await f.arrayBuffer())
            setFile({ name: f.name, type: f.type, bytes })
            setInput('')
            setMode('encode')
        } catch {
            toast.error(`Couldn’t read ${f.name}`)
        }
    }

    const swap = () => {
        if (!outputText) return
        setFile(null)
        setInput(outputText)
        setLoaded(outputText)
        if (mode === 'encode') {
            setMode('decode')
        } else {
            setUrlSafe(Boolean(result?.urlSafe))
            setMode('encode')
        }
    }

    const clear = () => {
        setInput('')
        setFile(null)
    }

    const downloadOutput = () => {
        if (binary) {
            const base = file ? splitFilename(file.name).base : 'decoded'
            downloadBlob(blob, `${base}.${binary.ext}`)
        } else if (outputText) {
            if (mode === 'decode') downloadText(outputText, 'decoded.txt')
            else downloadText(outputText, file ? `${file.name}.b64.txt` : 'encoded.b64.txt')
        }
    }

    const shownText = outputText.length > DISPLAY_LIMIT ? outputText.slice(0, DISPLAY_LIMIT) : outputText
    const truncated = shownText.length < outputText.length
    const hasOutput = Boolean(outputText || binary)

    return (
        <div className="page page-wide page-base64">
            <ToolHeader />

            <section className="card card-compact" aria-label="Options" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-lg)' }}>
                <SegmentedControl ariaLabel="Mode" options={MODES} value={mode} onChange={setMode} />
                {mode === 'encode' ? (
                    <>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }} title="Uses - and _ instead of + and /, without = padding (for URLs, file names and JWTs)">
                            <input type="checkbox" checked={urlSafe} onChange={e => setUrlSafe(e.target.checked)} />
                            URL-safe (Base64URL)
                        </label>
                        {file && (
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                <input type="checkbox" checked={dataUri} onChange={e => setDataUri(e.target.checked)} />
                                As a data: URI
                            </label>
                        )}
                    </>
                ) : (
                    <span className="field-hint" style={{ marginTop: 0 }}>Standard and URL-safe Base64 are both accepted; line breaks and a data: prefix are ignored.</span>
                )}
            </section>

            <div className="split-pane">
                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <label htmlFor={inputId} className="section-title">{mode === 'encode' ? 'Text to encode' : 'Base64 to decode'}</label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineRead onRead={(text) => loadText(text)} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={!input && !file}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    </div>
                    {file ? (
                        <div className="code-well" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', minHeight: 'clamp(200px, 36vh, 480px)', justifyContent: 'center', flexDirection: 'column', fontFamily: 'var(--font-family)' }}>
                            <Paperclip size={22} aria-hidden="true" style={{ color: 'var(--primary-text)' }} />
                            <div style={{ fontWeight: 600, color: 'var(--text-main)', textAlign: 'center', wordBreak: 'break-all' }}>{file.name}</div>
                            <div className="field-hint" style={{ marginTop: 0 }}>{formatBytes(file.bytes.length)}{file.type ? ` · ${file.type}` : ''}</div>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFile(null)}>
                                <X size={14} aria-hidden="true" /> Remove file
                            </button>
                        </div>
                    ) : (
                        <textarea
                            id={inputId}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder={mode === 'encode' ? 'Type something here...' : 'Paste Base64 here... (a data: URI works too)'}
                            spellCheck={false}
                            autoCapitalize="off"
                            autoComplete="off"
                            aria-invalid={error ? true : undefined}
                            className={error ? 'field-invalid' : ''}
                            style={{ minHeight: 'clamp(200px, 36vh, 480px)', fontSize: '0.88rem', lineHeight: 1.5, padding: '0.75rem', wordBreak: 'break-all' }}
                        />
                    )}
                    {mode === 'encode' && (
                        <FileDropZone
                            compact
                            onFiles={openFile}
                            icon={FileUp}
                            label={file ? 'Encode a different file' : 'Or encode a file'}
                            hint={`Up to ${MAX_FILE_MB} MB`}
                            maxSizeMB={MAX_FILE_MB}
                            style={{ padding: '0.6rem 0.9rem', fontSize: '0.85rem' }}
                        />
                    )}
                </div>

                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        {binary ? (
                            <div className="section-title" role="heading" aria-level={2}>Decoded bytes</div>
                        ) : (
                            <label htmlFor={outputId} className="section-title">{mode === 'encode' ? 'Base64' : 'Decoded text'}</label>
                        )}
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={swap} disabled={!outputText || !!error} title="Use the result as the new input and switch mode">
                                <ArrowDownUp size={14} aria-hidden="true" /> Swap
                            </button>
                            <CopyButton text={outputText} disabled={!outputText || !!error} />
                        </div>
                    </div>

                    {error && (
                        <StatusBanner tone="danger" title="Not valid Base64">{error}</StatusBanner>
                    )}

                    {binary ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                            <StatusBanner
                                tone={binary.label ? 'info' : 'warning'}
                                title={binary.label ? `Binary data: ${binary.label}` : 'This isn’t text'}
                                action={mode === 'decode' && !binary.label && !binary.mime ? (
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode('encode')}>Encode instead</button>
                                ) : null}
                            >
                                {formatBytes(binary.bytes.length)} decoded{!binary.label && binary.invalidText ? ' — not valid UTF-8 text' : ''}.
                                {!binary.label && !binary.mime && ' If you meant to encode this text, switch to Encode.'}
                            </StatusBanner>
                            {imageUrl && (
                                <div className="checkerboard" style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', padding: 'var(--space-sm)', display: 'flex', justifyContent: 'center' }}>
                                    <img src={imageUrl} alt="Decoded image preview" style={{ maxHeight: 240, objectFit: 'contain' }} />
                                </div>
                            )}
                            <div>
                                <div className="field-label" id={`${outputId}-hex`}>Hex preview{binary.bytes.length > 256 ? ' (first 256 bytes)' : ''}</div>
                                <pre className="code-well" aria-labelledby={`${outputId}-hex`} style={{ margin: 0, whiteSpace: 'pre', overflowX: 'auto', fontSize: '0.78rem', maxHeight: 320 }}>
                                    {hexDump(binary.bytes, 256)}
                                </pre>
                            </div>
                        </div>
                    ) : (
                        <textarea
                            id={outputId}
                            readOnly
                            value={shownText}
                            placeholder={error ? '' : 'Result will appear here...'}
                            spellCheck={false}
                            style={{ minHeight: 'clamp(200px, 36vh, 480px)', fontSize: '0.88rem', lineHeight: 1.5, padding: '0.75rem', background: 'var(--bg-inset)', wordBreak: 'break-all' }}
                        />
                    )}
                    {truncated && (
                        <div className="field-hint" style={{ marginTop: 0 }}>
                            Showing the first {formatBytes(DISPLAY_LIMIT)} of {formatBytes(outputText.length)}. Copy and Download use the full result.
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <span className="field-hint" style={{ marginTop: 0 }}>
                            {outputText && `${outputText.length.toLocaleString()} characters`}
                            {binary && `${binary.bytes.length.toLocaleString()} bytes`}
                        </span>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineSend dataToSend={outputText} disabled={!!error || !outputText} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={downloadOutput} disabled={!hasOutput || !!error}>
                                <Download size={14} aria-hidden="true" /> {binary ? `Download .${binary.ext}` : 'Download'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
