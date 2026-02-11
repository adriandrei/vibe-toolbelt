import React, { useState, useCallback } from 'react'
import { Link2, Copy, Check, ArrowDownUp, Trash2 } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function UrlEncode() {
    useDocumentTitle('URL Encoder / Decoder')
    const [input, setInput] = useState('')
    const [output, setOutput] = useState('')
    const [mode, setMode] = useState('encode') // encode | decode | encodeComponent | decodeComponent
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState(null)

    const MODES = [
        { id: 'encode', label: 'encodeURI', desc: 'Encodes full URI (preserves :/?#[]@!$&\'()*+,;=)' },
        { id: 'decode', label: 'decodeURI', desc: 'Decodes full URI' },
        { id: 'encodeComponent', label: 'encodeURIComponent', desc: 'Encodes a URI component (encodes everything)' },
        { id: 'decodeComponent', label: 'decodeURIComponent', desc: 'Decodes a URI component' },
    ]

    const process = useCallback((text, m) => {
        if (!text) { setOutput(''); setError(null); return }
        try {
            const fn = { encode: encodeURI, decode: decodeURI, encodeComponent: encodeURIComponent, decodeComponent: decodeURIComponent }
            setOutput(fn[m](text))
            setError(null)
        } catch (e) {
            setOutput('')
            setError(e.message)
        }
    }, [])

    const handleInput = (text) => { setInput(text); process(text, mode) }
    const handleMode = (m) => { setMode(m); process(input, m) }

    const swap = () => {
        setInput(output)
        const swapMap = { encode: 'decode', decode: 'encode', encodeComponent: 'decodeComponent', decodeComponent: 'encodeComponent' }
        const newMode = swapMap[mode]
        setMode(newMode)
        process(output, newMode)
    }

    const copy = () => {
        navigator.clipboard.writeText(output)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>URL Encoder / Decoder</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Encode or decode URLs and URI components
                </p>
            </div>

            {/* Mode selector */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-sm)' }}>
                    {MODES.map(m => (
                        <button
                            key={m.id}
                            onClick={() => handleMode(m.id)}
                            style={{
                                padding: '12px',
                                borderRadius: 'var(--radius-md)',
                                background: mode === m.id ? 'var(--primary-glow)' : 'rgba(255,255,255,0.03)',
                                border: mode === m.id ? '1px solid var(--primary)' : '1px solid var(--border)',
                                color: mode === m.id ? 'var(--primary)' : 'var(--text-muted)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.2s'
                            }}
                        >
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 600 }}>{m.label}</div>
                            <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: 4 }}>{m.desc}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Input */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                    <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Link2 size={14} color="var(--primary)" /> Input
                    </label>
                    <button onClick={() => { setInput(''); setOutput(''); setError(null) }} style={{ color: 'var(--text-dim)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Trash2 size={12} /> Clear
                    </button>
                </div>
                <textarea
                    value={input}
                    onChange={e => handleInput(e.target.value)}
                    placeholder="Enter text to encode or decode..."
                    style={{ width: '100%', minHeight: '120px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
                />
            </div>

            {/* Swap Button */}
            <div style={{ textAlign: 'center', margin: 'var(--space-sm) 0' }}>
                <button
                    onClick={swap}
                    style={{
                        padding: '8px 20px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--primary-glow)',
                        color: 'var(--primary)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        transition: 'all 0.2s'
                    }}
                    title="Swap input ↔ output and toggle encode/decode"
                >
                    <ArrowDownUp size={14} /> Swap
                </button>
            </div>

            {/* Output */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                    <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Output</label>
                    {output && (
                        <button onClick={copy} style={{
                            padding: '4px 12px', borderRadius: 'var(--radius-sm)',
                            background: copied ? 'var(--accent)' : 'var(--primary)', color: '#fff',
                            display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 500
                        }}>
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                    )}
                </div>
                {error ? (
                    <div style={{ color: '#ef4444', fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>{error}</div>
                ) : (
                    <div style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.9rem', wordBreak: 'break-all',
                        color: output ? 'var(--text-main)' : 'var(--text-dim)',
                        minHeight: '80px', background: 'rgba(0,0,0,0.15)', padding: 'var(--space-md)',
                        borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap'
                    }}>
                        {output || 'Result will appear here...'}
                    </div>
                )}
            </div>
        </div>
    )
}
