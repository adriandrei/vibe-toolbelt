import { useId, useMemo, useState } from 'react'
import { ArrowDownUp, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'

// application/x-www-form-urlencoded, as URLSearchParams serialises it:
// only A–Z a–z 0–9 * - . _ stay as they are, and spaces become +
const formEncode = (text) =>
    encodeURIComponent(text)
        .replace(/[!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
        .replace(/%20/g, '+')
const formDecode = (text) => decodeURIComponent(text.replace(/\+/g, ' '))

const VARIANTS = {
    component: {
        label: 'Component',
        encode: encodeURIComponent,
        decode: decodeURIComponent,
        encodeHelp: <>encodeURIComponent: for a single query value or path segment. Keeps <code className="mono">A–Z a–z 0–9 - _ . ! ~ * ' ( )</code> and percent-encodes everything else, including <code className="mono">/ ? & = + #</code> and spaces (as %20).</>,
        decodeHelp: <>decodeURIComponent: decodes every %XX escape. A <code className="mono">+</code> stays a plus sign; use Form for form data, where + means a space.</>,
    },
    uri: {
        label: 'Full URL',
        encode: encodeURI,
        decode: decodeURI,
        encodeHelp: <>encodeURI: for a complete URL. Keeps the characters that give a URL its structure (<code className="mono">: / ? # & = + $ , ; @</code>) and <code className="mono">A–Z a–z 0–9 - _ . ! ~ * ' ( )</code>. Spaces, non-ASCII, <code className="mono">[ ]</code> and <code className="mono">%</code> are encoded, so existing escapes get encoded again.</>,
        decodeHelp: <>decodeURI: decodes escapes except those for characters with a meaning in URLs (<code className="mono">%23 %24 %26 %2B %2C %2F %3A %3B %3D %3F %40</code>). They stay encoded so the URL keeps its structure.</>,
    },
    form: {
        label: 'Form (+ for spaces)',
        encode: formEncode,
        decode: formDecode,
        encodeHelp: <>application/x-www-form-urlencoded, as HTML forms and URLSearchParams send data: spaces become <code className="mono">+</code>, and everything except <code className="mono">A–Z a–z 0–9 * - . _</code> is percent-encoded.</>,
        decodeHelp: <>Form decoding, as servers read form posts and query strings: <code className="mono">+</code> becomes a space, then %XX escapes are decoded.</>,
    },
}

// Explains why decoding failed, pointing at the first bad escape
function decodeProblem(text) {
    const lone = /%(?![0-9a-fA-F]{2})/.exec(text)
    if (lone) {
        return `“${text.slice(lone.index, lone.index + 3)}” at position ${lone.index + 1} isn't a valid escape: % must be followed by two hex digits (write a literal % as %25).`
    }
    const runs = /(?:%[0-9a-fA-F]{2})+/g
    let m
    while ((m = runs.exec(text)) !== null) {
        try {
            decodeURIComponent(m[0])
        } catch {
            return `The escapes “${m[0].length > 30 ? m[0].slice(0, 29) + '…' : m[0]}” at position ${m.index + 1} aren't valid UTF-8 (a multi-byte character is cut off or malformed).`
        }
    }
    return 'The text contains a malformed escape sequence.'
}

function convert(input, direction, variant) {
    if (!input) return { output: '', error: null }
    const v = VARIANTS[variant]
    try {
        return { output: direction === 'encode' ? v.encode(input) : v.decode(input), error: null }
    } catch {
        if (direction === 'encode') {
            return { output: '', error: 'The text contains an unpaired surrogate (half of an emoji or another character outside the Basic Multilingual Plane), which can\'t be encoded.' }
        }
        return { output: '', error: decodeProblem(variant === 'form' ? input.replace(/\+/g, ' ') : input) }
    }
}

export default function UrlEncode() {
    const inputId = useId()
    const outputId = useId()
    const [input, setInput] = useState('')
    const [direction, setDirection] = useState('encode')
    const [variant, setVariant] = useState('component')

    const { output, error } = useMemo(() => convert(input, direction, variant), [input, direction, variant])
    const canSwap = output !== '' && !error

    const swap = () => {
        if (!canSwap) return
        setInput(output)
        setDirection(d => (d === 'encode' ? 'decode' : 'encode'))
    }

    const help = direction === 'encode' ? VARIANTS[variant].encodeHelp : VARIANTS[variant].decodeHelp

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card card-compact" aria-label="Mode" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
                    <SegmentedControl
                        ariaLabel="Direction"
                        value={direction}
                        onChange={setDirection}
                        options={[{ value: 'encode', label: 'Encode' }, { value: 'decode', label: 'Decode' }]}
                    />
                    <SegmentedControl
                        ariaLabel="Encoding"
                        value={variant}
                        onChange={setVariant}
                        options={Object.entries(VARIANTS).map(([value, v]) => ({ value, label: v.label }))}
                    />
                </div>
                <p className="field-hint" style={{ marginTop: 0 }}>{help}</p>
            </section>

            <section className="card card-compact">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                    <label htmlFor={inputId} className="field-label" style={{ marginBottom: 0 }}>
                        {direction === 'encode' ? 'Text to encode' : 'Text to decode'}
                    </label>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <PipelineRead onRead={setInput} />
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInput('')} disabled={!input}>
                            <Trash2 size={14} aria-hidden="true" /> Clear
                        </button>
                    </div>
                </div>
                <textarea
                    id={inputId}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={direction === 'encode' ? 'https://example.com/search?q=café & crème' : 'q%3Dcaf%C3%A9%20%26%20cr%C3%A8me'}
                    spellCheck={false}
                    rows={5}
                />
            </section>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                    type="button"
                    className="btn btn-outline"
                    onClick={swap}
                    disabled={!canSwap}
                    title={canSwap ? `Use the output as input and switch to ${direction === 'encode' ? 'decoding' : 'encoding'}` : 'Nothing to swap yet'}
                >
                    <ArrowDownUp size={16} aria-hidden="true" /> Swap
                </button>
            </div>

            <section className="card card-compact">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                    <span id={outputId} className="field-label" style={{ marginBottom: 0 }}>{direction === 'encode' ? 'Encoded' : 'Decoded'}</span>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <PipelineSend dataToSend={output} disabled={!!error} />
                        <CopyButton text={error ? '' : output} variant="secondary" />
                    </div>
                </div>
                {error ? (
                    <StatusBanner tone="danger" title={direction === 'encode' ? "Can't encode this text" : "Can't decode this text"}>{error}</StatusBanner>
                ) : (
                    <pre
                        className="code-well"
                        aria-labelledby={outputId}
                        style={{ minHeight: '5rem', margin: 0, overflowWrap: 'anywhere', color: output ? 'var(--text-code)' : 'var(--text-dim)' }}
                    >
                        {output || 'The result appears here as you type.'}
                    </pre>
                )}
            </section>
        </div>
    )
}
