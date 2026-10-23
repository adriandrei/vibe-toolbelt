import { useMemo, useRef, useState } from 'react'
import { ArrowDownUp, Eye, EyeOff, Loader2, Lock, Trash2, Unlock } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import CodeBlock from '../components/ui/CodeBlock'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { bytesToBase64 } from '../utils/encoding'
import { AesError, GCM_ITERATIONS, decryptGcm, decryptLegacy, detectFormat, encryptGcm, encryptLegacy } from '../utils/aes'

const MODES = [
    { value: 'encrypt', label: 'Encrypt', icon: Lock },
    { value: 'decrypt', label: 'Decrypt', icon: Unlock },
]

const FORMATS = [
    { value: 'gcm', label: 'AES-256-GCM (recommended)' },
    { value: 'openssl', label: 'OpenSSL / CryptoJS (legacy)' },
]

const FORMAT_NAMES = {
    gcm: `AES-256-GCM, PBKDF2-SHA256 (${GCM_ITERATIONS.toLocaleString()} iterations)`,
    openssl: 'OpenSSL / CryptoJS compatible (legacy, AES-256-CBC, MD5 key derivation)',
}

const NODE_SNIPPET = `// Node.js: decrypt "VT v1" (AES-256-GCM) output from this tool
const crypto = require('node:crypto')

function decrypt(base64, passphrase) {
  const data = Buffer.from(base64, 'base64')
  if (data.toString('latin1', 0, 2) !== 'VT' || data[2] !== 1 || data[3] !== 1) throw new Error('Unsupported format')
  const iterations = data.readUInt32BE(4)
  const key = crypto.pbkdf2Sync(passphrase.normalize('NFC'), data.subarray(8, 24), iterations, 32, 'sha256')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(24, 36))
  decipher.setAAD(data.subarray(0, 36))
  decipher.setAuthTag(data.subarray(data.length - 16))
  return Buffer.concat([decipher.update(data.subarray(36, data.length - 16)), decipher.final()]).toString('utf8')
}`

const Spinner = (props) => <Loader2 {...props} className="spin" />

export default function Aes() {
    const [mode, setMode] = useState('encrypt')
    const [format, setFormat] = useState('gcm')
    const [passphrase, setPassphrase] = useState('')
    const [showPassphrase, setShowPassphrase] = useState(false)
    const [text, setText] = useState('')
    const [result, setResult] = useState(null) // { id, output, note } | { id, error }
    const [busyId, setBusyId] = useState(null)
    const runCounter = useRef(0)

    // A result belongs to the exact inputs it was produced from
    const inputId = JSON.stringify([mode, mode === 'encrypt' ? format : '', passphrase, text])
    const current = result?.id === inputId ? result : null
    const busy = busyId === inputId

    const detected = useMemo(() => (mode === 'decrypt' && text.trim() ? detectFormat(text) : null), [mode, text])

    const run = async () => {
        if (!passphrase || (mode === 'encrypt' ? !text : !text.trim()) || busy) return
        const id = inputId
        const ticket = ++runCounter.current
        setBusyId(id)
        try {
            let next
            if (mode === 'encrypt') {
                const output = format === 'gcm' ? await encryptGcm(text, passphrase) : await encryptLegacy(text, passphrase)
                next = { id, output }
            } else {
                const found = detectFormat(text)
                if (found.error) throw new AesError(found.error)
                if (found.format === 'gcm') {
                    const plain = await decryptGcm(found.bytes, passphrase, found.iterations)
                    next = plain.text !== undefined
                        ? { id, output: plain.text }
                        : { id, output: bytesToBase64(plain.bytes), note: `The decrypted data isn’t UTF-8 text, so it’s shown as Base64 (${plain.bytes.length} bytes).` }
                } else {
                    const plain = await decryptLegacy(found.bytes, passphrase)
                    next = { id, output: plain.text, note: plain.kdfId === 'md5' ? null : `Decrypted using ${plain.kdf}.` }
                }
            }
            if (ticket === runCounter.current) setResult(next)
        } catch (error) {
            if (ticket === runCounter.current) setResult({ id, error: error instanceof AesError ? error.message : `${error?.name || 'Error'}: ${error?.message || error}` })
        } finally {
            if (ticket === runCounter.current) setBusyId(null)
        }
    }

    const swap = () => {
        if (!current?.output) return
        setText(current.output)
        setMode(mode === 'encrypt' ? 'decrypt' : 'encrypt')
    }

    const activeFormat = mode === 'encrypt' ? format : detected?.format
    const legacy = activeFormat === 'openssl'
    const canRun = !!passphrase && (mode === 'encrypt' ? text !== '' : !!text.trim() && !detected?.error)
    const weakPassphrase = passphrase && passphrase.length < 12

    useRegisterAIContext({
        tool: 'AES Encrypt / Decrypt',
        getContext: () => ({
            input: `Mode: ${mode}. Format: ${mode === 'encrypt' ? FORMAT_NAMES[format] : detected?.format ? FORMAT_NAMES[detected.format] || 'unknown' : 'n/a'}.`,
            output: current?.error ? `Error: ${current.error}` : '',
        }),
        suggestedPrompts: [
            'Why is AES-GCM better than AES-CBC?',
            'How long should my passphrase be?',
            'How do I decrypt this with OpenSSL?',
            'What does PBKDF2 protect against?',
        ],
    })

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <SegmentedControl ariaLabel="Mode" options={MODES} value={mode} onChange={setMode} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={swap} disabled={!current?.output || busy} title="Use the result as the input in the other mode">
                        <ArrowDownUp size={14} aria-hidden="true" /> Swap
                    </button>
                </div>

                {mode === 'encrypt' ? (
                    <div>
                        <div className="field-label">Format</div>
                        <SegmentedControl ariaLabel="Encryption format" options={FORMATS} value={format} onChange={setFormat} block size="sm" />
                        <div className="field-hint">{FORMAT_NAMES[format]}.</div>
                    </div>
                ) : null}

                {legacy && (
                    <StatusBanner tone="warning" title="Legacy format: no integrity check">
                        The key comes from a single MD5 pass, so passphrases are cheap to guess offline, and AES-CBC can’t detect tampering:
                        a modified ciphertext (or, rarely, a wrong passphrase) can produce garbage instead of an error.
                        Use it only to exchange data with CryptoJS or <code className="mono">openssl enc -aes-256-cbc -md md5 -a</code>.
                    </StatusBanner>
                )}

                <Field
                    label="Passphrase"
                    labelAction={
                        <button
                            type="button"
                            className="icon-btn"
                            aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                            aria-pressed={showPassphrase}
                            title={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                            onClick={() => setShowPassphrase(v => !v)}
                        >
                            {showPassphrase ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                        </button>
                    }
                    hint={weakPassphrase
                        ? `Only ${passphrase.length} characters: short passphrases can be guessed offline${legacy ? ', especially in the legacy format' : ''}. Prefer 4+ random words.`
                        : mode === 'encrypt' ? 'Anyone with the passphrase can decrypt. It isn’t stored anywhere.' : 'The passphrase used to encrypt.'}
                >
                    <input
                        type={showPassphrase ? 'text' : 'password'}
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder="Enter the passphrase…"
                        autoComplete="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                    />
                </Field>

                <Field
                    label={mode === 'encrypt' ? 'Plaintext' : 'Ciphertext'}
                    labelAction={
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <PipelineRead onRead={setText} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText('')} disabled={!text}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    }
                    error={mode === 'decrypt' && text.trim() ? detected?.error : null}
                    hint={mode === 'decrypt'
                        ? detected && !detected.error
                            ? `Detected: ${FORMAT_NAMES[detected.format]}${detected.iterations && detected.iterations !== GCM_ITERATIONS ? ` with ${detected.iterations.toLocaleString()} iterations` : ''}. Line breaks and spaces are ignored.`
                            : 'The format is detected automatically. Line breaks and spaces are ignored.'
                        : 'Press Ctrl+Enter (⌘+Enter on Mac) to encrypt.'}
                >
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault()
                                run()
                            }
                        }}
                        placeholder={mode === 'encrypt' ? 'Text to encrypt...' : 'Paste ciphertext (VlQB… from this tool, or U2FsdGVkX1… from OpenSSL/CryptoJS)'}
                        spellCheck={false}
                        style={{ minHeight: 140 }}
                    />
                </Field>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-primary" onClick={run} disabled={!canRun || busy}>
                        {busy ? <Spinner size={16} aria-hidden="true" /> : mode === 'encrypt' ? <Lock size={16} aria-hidden="true" /> : <Unlock size={16} aria-hidden="true" />}
                        {busy ? (mode === 'encrypt' ? 'Encrypting…' : 'Decrypting…') : mode === 'encrypt' ? 'Encrypt' : 'Decrypt'}
                    </button>
                </div>
            </section>

            <section className="card" style={{ display: 'grid', gap: 'var(--space-sm)' }} aria-live="polite">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div role="heading" aria-level={2} className="section-title">{mode === 'encrypt' ? 'Ciphertext' : 'Decrypted text'}</div>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <PipelineSend dataToSend={current?.output || ''} />
                        <CopyButton text={current?.output || ''} label="Copy" />
                    </div>
                </div>
                {busy ? (
                    <StatusBanner tone="info" icon={Spinner} title={activeFormat === 'gcm' ? 'Deriving the key…' : 'Working…'}>
                        {activeFormat === 'gcm' && `PBKDF2 runs ${(detected?.iterations || GCM_ITERATIONS).toLocaleString()} iterations on purpose, to slow down passphrase guessing.`}
                    </StatusBanner>
                ) : current?.error ? (
                    <StatusBanner tone="danger" title={mode === 'encrypt' ? 'Encryption failed' : 'Decryption failed'}>{current.error}</StatusBanner>
                ) : current?.output !== undefined ? (
                    <>
                        {current.note && <div className="field-hint" style={{ marginTop: 0 }}>{current.note}</div>}
                        <pre className="code-well" style={{ margin: 0, maxHeight: 320, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }} tabIndex={0} aria-label="Result">
                            {current.output || <span style={{ color: 'var(--text-dim)' }}>(empty)</span>}
                        </pre>
                        {mode === 'encrypt' && (
                            <div className="field-hint" style={{ marginTop: 0 }}>
                                A new random salt and IV are used every time, so encrypting the same text twice gives different ciphertexts. Both decrypt.
                            </div>
                        )}
                    </>
                ) : (
                    <div className="field-hint" style={{ marginTop: 0 }}>
                        {result && !current ? 'The inputs changed. ' : ''}
                        {mode === 'encrypt' ? 'Enter a passphrase and some text, then choose Encrypt.' : 'Paste ciphertext and its passphrase, then choose Decrypt.'}
                    </div>
                )}
            </section>

            <details className="card card-compact">
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>About the formats and interoperability</summary>
                <div style={{ display: 'grid', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    <p>
                        <strong style={{ color: 'var(--text-main)' }}>AES-256-GCM (“VT v1”)</strong> is Base64 of: “VT”, version byte 1, KDF byte 1 (PBKDF2-HMAC-SHA256),
                        the iteration count (4 bytes, big-endian), a 16-byte salt, a 12-byte IV, then the ciphertext with its 16-byte tag. The first 36 bytes are
                        authenticated too. The passphrase is NFC-normalised and UTF-8 encoded.
                    </p>
                    <CodeBlock code={NODE_SNIPPET} language="javascript" title="Decrypt it in Node.js" />
                    <p>
                        <strong style={{ color: 'var(--text-main)' }}>Legacy</strong> output is the OpenSSL “Salted__” format, the same as <code className="mono">CryptoJS.AES.encrypt(text, passphrase)</code>.
                        Decrypt it with <code className="mono">openssl enc -d -aes-256-cbc -md md5 -a -A</code>. When decrypting, this page also accepts OpenSSL’s newer
                        defaults (<code className="mono">-md sha256</code> and <code className="mono">-pbkdf2</code>).
                    </p>
                </div>
            </details>
        </div>
    )
}
