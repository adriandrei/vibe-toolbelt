import { useId, useMemo, useState } from 'react'
import { Link2, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import StatusBanner from '../components/ui/StatusBanner'
import { useSmartInput } from '../hooks/useSmartInput'

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21' }
const KNOWN_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:', 'mailto:', 'tel:', 'data:', 'blob:', 'about:', 'javascript:', 'urn:', 'ssh:', 'git:', 'sftp:', 'magnet:'])

function safeDecode(text) {
    try {
        return decodeURIComponent(text)
    } catch {
        return text
    }
}

// Something like "example.com/path" or "localhost:3000": missing its scheme
const looksLikeHost = (text) => /^(localhost|\[[0-9a-f:.]+\]|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]|$)/i.test(text)

function analyze(raw) {
    const text = raw.trim()
    if (!text) return { state: 'empty' }
    let url
    try {
        url = new URL(text)
    } catch {
        return { state: 'error', suggestion: looksLikeHost(text) ? `https://${text}` : null }
    }
    // "localhost:3000/x" parses with "localhost:" as its scheme
    const suspicious = !KNOWN_SCHEMES.has(url.protocol) && !text.includes('//') && looksLikeHost(text)
    const params = [...url.searchParams]
    const counts = params.reduce((acc, [k]) => acc.set(k, (acc.get(k) ?? 0) + 1), new Map())
    return { state: 'ok', url, params, counts, suggestion: suspicious ? `https://${text}` : null }
}

function paramsJson(params) {
    const out = {}
    for (const [k, v] of params) {
        if (!Object.hasOwn(out, k)) out[k] = v
        else out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v]
    }
    return JSON.stringify(out, null, 2)
}

function Row({ label, value, note, decoded }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(6.5rem, max-content) minmax(0, 1fr) auto', alignItems: 'start', gap: 'var(--space-sm)', padding: '0.6rem var(--space-md)', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', paddingTop: 2 }}>{label}</span>
            <div style={{ minWidth: 0 }}>
                <div className="mono" style={{ fontSize: '0.9rem', overflowWrap: 'anywhere', color: 'var(--text-main)' }}>
                    {value}
                    {note && <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-family)', fontSize: '0.8rem' }}> {note}</span>}
                </div>
                {decoded && decoded !== value && (
                    <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', overflowWrap: 'anywhere' }}>decoded: {decoded}</div>
                )}
            </div>
            <CopyButton iconOnly text={value} label={`Copy ${label.toLowerCase()}`} />
        </div>
    )
}

export default function UrlParser() {
    const inputId = useId()
    const [input, setInput] = useState('')
    useSmartInput({ input: setInput })

    const result = useMemo(() => analyze(input), [input])
    const url = result.state === 'ok' ? result.url : null

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card card-compact">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                    <label htmlFor={inputId} className="field-label" style={{ marginBottom: 0 }}>URL to parse</label>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInput('')} disabled={!input}>
                        <Trash2 size={14} aria-hidden="true" /> Clear
                    </button>
                </div>
                <input
                    id={inputId}
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="https://example.com/path?query=123"
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={result.state === 'error'}
                    aria-describedby={result.state === 'error' ? `${inputId}-error` : undefined}
                    className={result.state === 'error' ? 'field-invalid' : ''}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem' }}
                />
                {result.state === 'error' && (
                    <div id={`${inputId}-error`} style={{ marginTop: 'var(--space-sm)' }}>
                        <StatusBanner
                            tone="danger"
                            title="Not a valid absolute URL"
                            action={result.suggestion && (
                                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setInput(result.suggestion)}>Add https://</button>
                            )}
                        >
                            {result.suggestion
                                ? 'It looks like the scheme is missing. URLs need one, such as https://.'
                                : 'A URL needs a scheme and an address, as in https://example.com/path.'}
                        </StatusBanner>
                    </div>
                )}
                {result.state === 'ok' && result.suggestion && (
                    <div style={{ marginTop: 'var(--space-sm)' }}>
                        <StatusBanner
                            tone="info"
                            title={`“${url.protocol}” was read as the scheme`}
                            action={<button type="button" className="btn btn-sm btn-secondary" onClick={() => setInput(result.suggestion)}>Use https://</button>}
                        >
                            Did you mean {result.suggestion}?
                        </StatusBanner>
                    </div>
                )}
            </section>

            {result.state === 'empty' && (
                <div className="card">
                    <EmptyState icon={Link2} title="Paste a URL">
                        See its scheme, host, port, path, query parameters and fragment, with copy buttons.
                    </EmptyState>
                </div>
            )}

            {url && (
                <section className="card" style={{ padding: 0, overflow: 'hidden' }} aria-label="URL parts">
                    <h2 className="section-title" style={{ padding: 'var(--space-md) var(--space-md) var(--space-sm)' }}>Parts</h2>
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                        <Row label="Normalized" value={url.href} />
                        <Row label="Protocol" value={url.protocol} />
                        {url.username && <Row label="Username" value={url.username} decoded={safeDecode(url.username)} />}
                        {url.password && <Row label="Password" value={url.password} decoded={safeDecode(url.password)} />}
                        {url.host && <Row label="Host" value={url.host} />}
                        {url.hostname && <Row label="Hostname" value={url.hostname} />}
                        {(url.port || DEFAULT_PORTS[url.protocol]) && (
                            <Row label="Port" value={url.port || DEFAULT_PORTS[url.protocol]} note={url.port ? undefined : '(default)'} />
                        )}
                        {url.origin !== 'null' && <Row label="Origin" value={url.origin} />}
                        <Row label="Pathname" value={url.pathname || '/'} decoded={safeDecode(url.pathname)} />
                        {url.search && <Row label="Search" value={url.search} decoded={safeDecode(url.search.replace(/\+/g, ' '))} />}
                        {url.hash && <Row label="Hash" value={url.hash} decoded={safeDecode(url.hash)} />}
                    </div>
                </section>
            )}

            {url && result.params.length > 0 && (
                <section className="card" style={{ padding: 0, overflow: 'hidden' }} aria-label="Query parameters">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', padding: 'var(--space-md) var(--space-md) var(--space-sm)' }}>
                        <h2 className="section-title">
                            Query parameters <span className="badge">{result.params.length}</span>
                        </h2>
                        <CopyButton text={() => paramsJson(result.params)} label="Copy as JSON" />
                    </div>
                    <ol style={{ listStyle: 'none', borderTop: '1px solid var(--border)' }}>
                        {result.params.map(([key, value], i) => (
                            <li
                                key={i}
                                style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-sm)', padding: '0.6rem var(--space-md)', borderBottom: i === result.params.length - 1 ? 'none' : '1px solid var(--border)' }}
                            >
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                        <span className="mono" style={{ color: 'var(--primary-text)', fontWeight: 600, overflowWrap: 'anywhere' }}>{key || <em style={{ color: 'var(--text-dim)' }}>(empty name)</em>}</span>
                                        {result.counts.get(key) > 1 && (
                                            <span className="badge badge-info" title="This name appears more than once">×{result.counts.get(key)}</span>
                                        )}
                                    </div>
                                    <div className="mono" style={{ fontSize: '0.9rem', overflowWrap: 'anywhere', color: value ? 'var(--text-main)' : 'var(--text-dim)' }}>
                                        {value || '(empty)'}
                                    </div>
                                </div>
                                <CopyButton iconOnly text={value} label={`Copy value of ${key || 'parameter'} ${i + 1}`} />
                            </li>
                        ))}
                    </ol>
                </section>
            )}
        </div>
    )
}
