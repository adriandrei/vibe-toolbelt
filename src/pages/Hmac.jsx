import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Loader2, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useWorkerClient } from '../utils/workerClient'
import { decodeSecret, encodeBytes, parseDigest, timingSafeEqual, utf8Length } from '../utils/encoding'
import { formatBytes } from '../utils/download'

const ALGORITHMS = [
    { value: 'SHA-256', label: 'HMAC-SHA256' },
    { value: 'SHA-384', label: 'HMAC-SHA384' },
    { value: 'SHA-512', label: 'HMAC-SHA512' },
    { value: 'SHA-1', label: 'HMAC-SHA1 (legacy)' },
    { value: 'MD5', label: 'HMAC-MD5 (legacy)' },
    { value: 'SHA3-256', label: 'HMAC-SHA3-256' },
    { value: 'SHA3-512', label: 'HMAC-SHA3-512' },
]

const DIGEST_BYTES = { 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64, 'SHA-1': 20, MD5: 16, 'SHA3-256': 32, 'SHA3-512': 64 }

const KEY_ENCODINGS = [
    { value: 'text', label: 'Text' },
    { value: 'hex', label: 'Hex' },
    { value: 'base64', label: 'Base64' },
]

const OUTPUT_FORMATS = [
    { value: 'hex', label: 'hex' },
    { value: 'HEX', label: 'HEX' },
    { value: 'base64', label: 'Base64' },
    { value: 'base64url', label: 'Base64url' },
]

const Spinner = (props) => <Loader2 {...props} className="spin" />

export default function Hmac() {
    const [message, setMessage] = useState('')
    const [keyText, setKeyText] = useState('')
    const [keyEncoding, setKeyEncoding] = useState('text')
    const [showKey, setShowKey] = useState(false)
    const [algorithm, setAlgorithm] = useState('SHA-256')
    const [outputFormat, setOutputFormat] = useState('hex')
    const [expected, setExpected] = useState('')
    const [result, setResult] = useState(null) // { id, mac } | { id, error }
    const client = useWorkerClient(() => new Worker(new URL('../workers/crypto.worker.js', import.meta.url), { type: 'module' }))

    const key = useMemo(() => {
        if (!keyText) return { empty: true }
        try {
            const bytes = decodeSecret(keyText, keyEncoding)
            return bytes.length ? { bytes } : { empty: true }
        } catch (error) {
            return { error: `Not valid ${keyEncoding === 'hex' ? 'hex' : 'Base64'}: ${error.message}` }
        }
    }, [keyText, keyEncoding])

    // Identity of the current inputs; results are only shown for the inputs they were computed from
    const inputId = useMemo(() => ({ message, key, algorithm }), [message, key, algorithm])

    useEffect(() => {
        if (!key.bytes) return undefined
        let cancelled = false
        const timer = setTimeout(() => {
            client
                .request('hmac', { algorithm, key: key.bytes, message }, { replace: true })
                .then((mac) => {
                    if (!cancelled) setResult({ id: inputId, mac })
                })
                .catch((error) => {
                    if (!cancelled && !error.cancelled) setResult({ id: inputId, error: error.message })
                })
        }, message.length > 100_000 ? 250 : 60)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [inputId, key, algorithm, message, client])

    const current = result?.id === inputId ? result : null
    const busy = !!key.bytes && !current
    const output = current?.mac ? encodeBytes(current.mac, outputFormat) : ''
    const messageBytes = useMemo(() => utf8Length(message), [message])

    const comparison = useMemo(() => {
        if (!expected.trim()) return null
        let parsed
        try {
            parsed = parseDigest(expected)
        } catch (error) {
            return { error: `Not a hex or Base64 signature: ${error.message}` }
        }
        if (!current?.mac) return { pending: true }
        return { match: timingSafeEqual(current.mac, parsed.bytes), encoding: parsed.encoding, length: parsed.bytes.length, expectedLength: current.mac.length }
    }, [expected, current])

    const algorithmLabel = ALGORITHMS.find(a => a.value === algorithm)?.label

    useRegisterAIContext({
        tool: 'HMAC Generator',
        getContext: () => ({
            input: `Algorithm: ${algorithmLabel}\nMessage (${messageBytes} bytes):\n${message.slice(0, 4000)}`,
            output: output ? `${algorithmLabel} (${outputFormat}): ${output}` : '',
        }),
        suggestedPrompts: [
            'How do I verify a webhook signature with this?',
            'What is the difference between HMAC and a plain hash?',
            'Why does my signature not match the one I received?',
            'How long should an HMAC key be?',
        ],
    })

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <Field
                    label="Message"
                    labelAction={
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <PipelineRead onRead={setMessage} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMessage('')} disabled={!message}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    }
                    hint={`${formatBytes(messageBytes)} of UTF-8. An empty message is allowed. For webhooks, paste the raw body exactly (line breaks are LF, no trailing newline unless the sender added one).`}
                >
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Enter message to hash..."
                        spellCheck={false}
                        style={{ minHeight: 120 }}
                    />
                </Field>

                <div className="split-pane">
                    <div>
                        <Field
                            label="Secret key"
                            labelAction={
                                <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                                    <SegmentedControl size="sm" ariaLabel="Key encoding" options={KEY_ENCODINGS} value={keyEncoding} onChange={setKeyEncoding} />
                                    <button
                                        type="button"
                                        className="icon-btn"
                                        aria-label={showKey ? 'Hide key' : 'Show key'}
                                        aria-pressed={showKey}
                                        title={showKey ? 'Hide key' : 'Show key'}
                                        onClick={() => setShowKey(v => !v)}
                                    >
                                        {showKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                                    </button>
                                </div>
                            }
                            error={key.error}
                            hint={key.bytes
                                ? `${key.bytes.length} bytes (${key.bytes.length * 8} bits)${key.bytes.length < (DIGEST_BYTES[algorithm] || 0) ? `: shorter than the ${DIGEST_BYTES[algorithm] * 8}-bit digest, so weaker than it could be. Fine for testing.` : ''}`
                                : 'Required. Use Hex or Base64 for binary keys.'}
                        >
                            <input
                                type={showKey ? 'text' : 'password'}
                                value={keyText}
                                onChange={(e) => setKeyText(e.target.value)}
                                placeholder="Secret Key"
                                autoComplete="off"
                                spellCheck={false}
                                data-1p-ignore
                                data-lpignore="true"
                                className="mono"
                            />
                        </Field>
                    </div>
                    <div style={{ display: 'grid', gap: 'var(--space-md)', alignContent: 'start' }}>
                        <Field label="Algorithm" hint={algorithm === 'SHA-1' || algorithm === 'MD5' ? 'Still secure as an HMAC, but only use it when a system requires it.' : undefined}>
                            <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>
                                {ALGORITHMS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                            </select>
                        </Field>
                    </div>
                </div>
            </section>

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div role="heading" aria-level={2} className="section-title">{algorithmLabel}</div>
                    <SegmentedControl size="sm" ariaLabel="Output format" options={OUTPUT_FORMATS} value={outputFormat} onChange={setOutputFormat} />
                </div>

                {key.error ? (
                    <StatusBanner tone="danger" title="The key can’t be used">{key.error}</StatusBanner>
                ) : key.empty ? (
                    <div className="field-hint" style={{ marginTop: 0 }}>Enter a secret key to compute the signature.</div>
                ) : current?.error ? (
                    <StatusBanner tone="danger" title="Couldn’t compute the HMAC">{current.error}</StatusBanner>
                ) : (
                    <div>
                        <div className="code-well" style={{ wordBreak: 'break-all', minHeight: '3.2rem', opacity: busy ? 0.55 : 1 }} aria-live="polite" aria-busy={busy}>
                            {output || (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)' }}>
                                    <Spinner size={14} aria-hidden="true" /> Computing…
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end', marginTop: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineSend dataToSend={output} disabled={busy} />
                            <CopyButton text={output} label="Copy signature" disabled={!output || busy} />
                        </div>
                    </div>
                )}

                <Field
                    label="Verify against an expected signature"
                    hint="Paste the signature you received (hex or Base64; prefixes like “sha256=” are ignored). It’s compared as bytes, in constant time."
                    error={comparison?.error}
                >
                    <input
                        type="text"
                        value={expected}
                        onChange={(e) => setExpected(e.target.value)}
                        placeholder="e.g. sha256=8b5f48702995c159…"
                        spellCheck={false}
                        autoComplete="off"
                        className="mono"
                    />
                </Field>
                {comparison && !comparison.error && !comparison.pending && (
                    comparison.match ? (
                        <StatusBanner tone="success" title="Signatures match">
                            The expected {comparison.encoding} value equals the {algorithmLabel} of this message and key.
                        </StatusBanner>
                    ) : (
                        <StatusBanner tone="danger" title="Signatures don’t match">
                            {comparison.length !== comparison.expectedLength
                                ? `The expected value has ${comparison.length} bytes, but ${algorithmLabel} produces ${comparison.expectedLength}: check the algorithm.`
                                : 'Check the key (and its encoding), the algorithm, and that the message is byte-for-byte identical.'}
                        </StatusBanner>
                    )
                )}
            </section>
        </div>
    )
}
