import { useEffect, useMemo, useState } from 'react'
import { FileText, Loader2, Trash2, Type } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import FileDropZone from '../components/ui/FileDropZone'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useWorkerClient } from '../utils/workerClient'
import { encodeBytes, hasLoneSurrogates, parseDigest, timingSafeEqual, utf8Length } from '../utils/encoding'
import { formatBytes } from '../utils/download'

const ALGORITHMS = [
    { id: 'MD5', weak: true, note: 'Broken for security (collisions are easy). Fine as a checksum.' },
    { id: 'SHA-1', weak: true, note: 'Collisions have been demonstrated. Avoid for signatures.' },
    { id: 'SHA-256' },
    { id: 'SHA-384' },
    { id: 'SHA-512' },
    { id: 'SHA3-256' },
    { id: 'SHA3-512' },
    { id: 'Keccak-256', note: 'Original Keccak padding (Ethereum). Differs from SHA3-256.' },
]
const ALGORITHM_IDS = ALGORITHMS.map(a => a.id)

const FORMATS = [
    { value: 'hex', label: 'hex' },
    { value: 'HEX', label: 'HEX' },
    { value: 'base64', label: 'Base64' },
]

const SOURCES = [
    { value: 'text', label: 'Text', icon: Type },
    { value: 'file', label: 'File', icon: FileText },
]

const MAX_FILE_MB = 512
const Spinner = (props) => <Loader2 {...props} className="spin" />

export default function Hash() {
    const [source, setSource] = useState('text')
    const [text, setText] = useState('')
    const [file, setFile] = useState(null)
    const [format, setFormat] = useState('hex')
    const [expected, setExpected] = useState('')
    const [result, setResult] = useState(null) // { input, digests, size } | { input, error }
    const [progress, setProgress] = useState(null) // { input, value }
    const client = useWorkerClient(() => new Worker(new URL('../workers/crypto.worker.js', import.meta.url), { type: 'module' }))

    const loadText = (value) => {
        setSource('text')
        setText(value)
    }

    useSmartInput({ input: loadText })

    // The input the digests belong to: the text itself, or the File object
    const input = source === 'text' ? text : file

    useEffect(() => {
        if (input === null) return undefined
        let cancelled = false
        const isFile = typeof input !== 'string'
        const delay = isFile ? 0 : input.length > 200_000 ? 300 : input.length > 20_000 ? 120 : 40
        const timer = setTimeout(() => {
            client
                .request('digest', { source: isFile ? { kind: 'file', file: input } : { kind: 'text', text: input }, algorithms: ALGORITHM_IDS }, {
                    replace: true,
                    onProgress: (value) => {
                        if (!cancelled) setProgress({ input, value })
                    },
                })
                .then((res) => {
                    if (!cancelled) setResult({ input, ...res })
                })
                .catch((error) => {
                    if (!cancelled && !error.cancelled) setResult({ input, error: error.message })
                })
        }, delay)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [input, client])

    const current = result && result.input === input ? result : null
    const busy = input !== null && !current
    // While new digests are computed, keep showing the previous ones (dimmed, not copyable) to avoid flicker
    const shown = current || (busy && result && typeof result.input === typeof input ? result : null)
    const digests = shown?.digests || null
    const loneSurrogates = useMemo(() => source === 'text' && hasLoneSurrogates(text), [source, text])
    const textBytes = useMemo(() => utf8Length(text), [text])

    const formatted = useMemo(() => {
        if (!digests) return null
        return Object.fromEntries(ALGORITHM_IDS.map(id => [id, encodeBytes(digests[id], format)]))
    }, [digests, format])

    const comparison = useMemo(() => {
        if (!expected.trim()) return null
        let parsed
        try {
            parsed = parseDigest(expected)
        } catch (error) {
            return { error: `Not a hex or Base64 digest: ${error.message}` }
        }
        const fresh = current?.digests
        if (!fresh) return { pending: true }
        const matches = ALGORITHM_IDS.filter(id => timingSafeEqual(fresh[id], parsed.bytes))
        const sameLength = ALGORITHM_IDS.filter(id => fresh[id].length === parsed.bytes.length)
        return { matches, sameLength, encoding: parsed.encoding, bytes: parsed.bytes.length }
    }, [expected, current])

    useRegisterAIContext({
        tool: 'Hash Generator',
        getContext: () => ({
            input: source === 'file' ? (file ? `File: ${file.name} (${formatBytes(file.size)})` : '') : text.slice(0, 4000),
            output: formatted ? ALGORITHM_IDS.map(id => `${id}: ${formatted[id]}`).join('\n') : '',
        }),
        suggestedPrompts: [
            'Which algorithm should I use for password hashing?',
            'What is the difference between MD5 and SHA-256?',
            'Is MD5 safe to use?',
            'Why does SHA3-256 differ from Keccak-256?',
        ],
    })

    const progressValue = progress && progress.input === input ? progress.value : 0

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <SegmentedControl ariaLabel="What to hash" options={SOURCES} value={source} onChange={setSource} />
                    {source === 'text' && <PipelineRead onRead={loadText} />}
                </div>

                {source === 'text' ? (
                    <Field
                        label="Text"
                        labelAction={
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText('')} disabled={!text}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        }
                        hint={`The UTF-8 bytes of the text are hashed (${formatBytes(textBytes)}). Line breaks count as LF (\\n).`}
                    >
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Enter text to hash..."
                            spellCheck={false}
                            style={{ minHeight: 140 }}
                        />
                    </Field>
                ) : (
                    <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                        <FileDropZone
                            onFiles={([f]) => setFile(f)}
                            maxSizeMB={MAX_FILE_MB}
                            label={file ? 'Drop another file or click to browse' : 'Drop a file here or click to browse'}
                            hint={`Any file up to ${MAX_FILE_MB} MB. It’s read locally and never uploaded.`}
                            compact={!!file}
                        />
                        {file && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', minWidth: 0 }}>
                                <FileText size={16} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                                <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{file.name}</span>
                                <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{formatBytes(file.size)}</span>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)} style={{ marginLeft: 'auto' }}>
                                    <Trash2 size={14} aria-hidden="true" /> Remove
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {loneSurrogates && (
                    <StatusBanner tone="warning" title="Broken characters in the text">
                        The text contains unpaired surrogates (for example half of an emoji). They’re hashed as U+FFFD (bytes EF BF BD), like every browser does.
                    </StatusBanner>
                )}
            </section>

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div role="heading" aria-level={2} className="section-title">
                        Digests
                        {current?.digests && <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: '0.85rem' }}>of {formatBytes(current.size)}{current.size === 0 ? ' (empty input)' : ''}</span>}
                    </div>
                    <SegmentedControl size="sm" ariaLabel="Output format" options={FORMATS} value={format} onChange={setFormat} />
                </div>

                {source === 'file' && !file && <div className="field-hint" style={{ marginTop: 0 }}>Choose a file to see its digests.</div>}

                {busy && (
                    <div style={{ display: 'grid', gap: 'var(--space-xs)' }} aria-live="polite">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            <Spinner size={14} aria-hidden="true" /> Hashing{source === 'file' && progressValue ? ` · ${Math.round(progressValue * 100)}%` : '…'}
                        </div>
                        {source === 'file' && <progress max={1} value={progressValue} style={{ width: '100%' }} aria-label="Hashing progress" />}
                    </div>
                )}

                {current?.error && <StatusBanner tone="danger" title="Couldn’t hash this input">{current.error}</StatusBanner>}

                {(source === 'text' || file) && (
                    <div style={{ display: 'grid', gap: 'var(--space-xs)', opacity: current ? 1 : 0.55, transition: 'opacity 0.15s ease' }} aria-busy={busy}>
                        {ALGORITHMS.map(({ id, weak, note }) => {
                            const value = current ? formatted?.[id] ?? '' : ''
                            const display = formatted?.[id] ?? ''
                            const matched = comparison?.matches?.includes(id)
                            return (
                                <div
                                    key={id}
                                    style={{
                                        display: 'grid',
                                        gap: 'var(--space-xs)',
                                        padding: '0.6rem 0.75rem',
                                        borderRadius: 'var(--radius-md)',
                                        background: 'var(--bg-inset)',
                                        border: `1px solid ${matched ? 'var(--success-border)' : 'var(--border)'}`,
                                        boxShadow: matched ? '0 0 0 1px var(--success-border)' : 'none',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--primary-text)' }}>{id}</span>
                                        {weak && <span className="badge badge-warning" title={note}>weak</span>}
                                        {matched && <span className="badge badge-success">matches</span>}
                                        <span style={{ flex: 1 }} />
                                        <PipelineSend dataToSend={value} label="Send" />
                                        <CopyButton text={value} label={`Copy ${id}`} iconOnly />
                                    </div>
                                    <div className="mono" style={{ fontSize: '0.85rem', wordBreak: 'break-all', color: display ? 'var(--text-code)' : 'var(--text-dim)' }}>
                                        {display || '…'}
                                    </div>
                                    {note && !weak && <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{note}</div>}
                                </div>
                            )
                        })}
                    </div>
                )}

                <Field
                    label="Compare with a known digest"
                    hint="Paste a checksum (hex or Base64) to see which algorithm, if any, it matches."
                    error={comparison?.error}
                >
                    <input
                        type="text"
                        value={expected}
                        onChange={(e) => setExpected(e.target.value)}
                        placeholder="e.g. 9f86d081884c7d65…"
                        spellCheck={false}
                        autoComplete="off"
                        className="mono"
                    />
                </Field>
                {comparison && !comparison.error && !comparison.pending && (
                    comparison.matches.length ? (
                        <StatusBanner tone="success" title={`Match: ${comparison.matches.join(', ')}`}>
                            The {comparison.encoding} value equals the {comparison.matches.join(' and ')} digest of this input.
                        </StatusBanner>
                    ) : (
                        <StatusBanner tone="danger" title="No match">
                            {comparison.sameLength.length
                                ? `It has the length of a ${comparison.sameLength.join(' / ')} digest (${comparison.bytes} bytes), but the value is different.`
                                : `None of the digests has ${comparison.bytes} bytes, so it’s from another algorithm or another input.`}
                        </StatusBanner>
                    )
                )}
            </section>
        </div>
    )
}
