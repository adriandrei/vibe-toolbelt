import React, { useState, useCallback } from 'react'
import { Code, Copy, Check, ArrowDownUp, Trash2, BookOpen } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const COMMON_ENTITIES = [
    { char: '&', entity: '&amp;', name: 'Ampersand' },
    { char: '<', entity: '&lt;', name: 'Less than' },
    { char: '>', entity: '&gt;', name: 'Greater than' },
    { char: '"', entity: '&quot;', name: 'Double quote' },
    { char: "'", entity: '&#39;', name: 'Single quote' },
    { char: ' ', entity: '&nbsp;', name: 'Non-breaking space' },
    { char: '©', entity: '&copy;', name: 'Copyright' },
    { char: '®', entity: '&reg;', name: 'Registered' },
    { char: '™', entity: '&trade;', name: 'Trademark' },
    { char: '€', entity: '&euro;', name: 'Euro' },
    { char: '£', entity: '&pound;', name: 'Pound' },
    { char: '¥', entity: '&yen;', name: 'Yen' },
    { char: '…', entity: '&hellip;', name: 'Ellipsis' },
    { char: '—', entity: '&mdash;', name: 'Em dash' },
    { char: '–', entity: '&ndash;', name: 'En dash' },
    { char: '←', entity: '&larr;', name: 'Left arrow' },
    { char: '→', entity: '&rarr;', name: 'Right arrow' },
    { char: '↑', entity: '&uarr;', name: 'Up arrow' },
    { char: '↓', entity: '&darr;', name: 'Down arrow' },
    { char: '♥', entity: '&hearts;', name: 'Heart' },
    { char: '★', entity: '&#9733;', name: 'Star' },
    { char: '✓', entity: '&#10003;', name: 'Check mark' },
    { char: '✗', entity: '&#10007;', name: 'Cross mark' },
    { char: '°', entity: '&deg;', name: 'Degree' },
    { char: '±', entity: '&plusmn;', name: 'Plus-minus' },
]

function htmlEncode(str) {
    const el = document.createElement('textarea')
    el.textContent = str
    // Convert to named/numeric entities
    return str.replace(/[\u00A0-\u9999<>&"']/g, c => `&#${c.charCodeAt(0)};`)
}

function htmlDecode(str) {
    const el = document.createElement('textarea')
    el.innerHTML = str
    return el.value
}

export default function HtmlEntity() {
    useDocumentTitle('HTML Entity Encoder')
    const [input, setInput] = useState('')
    const [output, setOutput] = useState('')
    const [mode, setMode] = useState('encode')
    const [copied, setCopied] = useState(false)
    const [showRef, setShowRef] = useState(false)
    const [error, setError] = useState(null)

    const process = useCallback((text, m) => {
        if (!text) { setOutput(''); setError(null); return }
        try {
            setOutput(m === 'encode' ? htmlEncode(text) : htmlDecode(text))
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
        const newMode = mode === 'encode' ? 'decode' : 'encode'
        setMode(newMode)
        process(output, newMode)
    }

    const copy = () => {
        navigator.clipboard.writeText(output)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const insertEntity = (char) => {
        const newInput = input + char
        setInput(newInput)
        process(newInput, mode)
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>HTML Entity Encoder</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Encode special characters to HTML entities and decode them back
                </p>
            </div>

            {/* Mode Toggle */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    {['encode', 'decode'].map(m => (
                        <button key={m} onClick={() => handleMode(m)} style={{
                            flex: 1, minWidth: 140, padding: '12px 16px', borderRadius: 'var(--radius-md)',
                            background: mode === m ? 'var(--primary-glow)' : 'rgba(255,255,255,0.03)',
                            border: mode === m ? '1px solid var(--primary)' : '1px solid var(--border)',
                            color: mode === m ? 'var(--primary)' : 'var(--text-muted)',
                            fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', textTransform: 'capitalize'
                        }}>
                            {m === 'encode' ? '→ Encode to Entities' : '← Decode from Entities'}
                        </button>
                    ))}
                    <button onClick={() => setShowRef(!showRef)} style={{
                        padding: '12px 16px', borderRadius: 'var(--radius-md)',
                        background: showRef ? 'var(--primary-glow)' : 'rgba(255,255,255,0.03)',
                        border: showRef ? '1px solid var(--primary)' : '1px solid var(--border)',
                        color: showRef ? 'var(--primary)' : 'var(--text-muted)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem'
                    }}>
                        <BookOpen size={14} /> Reference
                    </button>
                </div>
            </div>

            {/* Input */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                    <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Code size={14} color="var(--primary)" /> Input
                    </label>
                    <button onClick={() => { setInput(''); setOutput(''); setError(null) }} style={{ color: 'var(--text-dim)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Trash2 size={12} /> Clear
                    </button>
                </div>
                <textarea
                    value={input}
                    onChange={e => handleInput(e.target.value)}
                    placeholder={mode === 'encode' ? 'Enter text with special characters...' : 'Enter HTML entities like &amp; &lt; &#169;...'}
                    style={{ width: '100%', minHeight: '120px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
                />
            </div>

            {/* Swap */}
            <div style={{ textAlign: 'center', margin: 'var(--space-sm) 0' }}>
                <button onClick={swap} style={{
                    padding: '8px 20px', borderRadius: 'var(--radius-md)', background: 'var(--primary-glow)',
                    color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: '0.85rem', fontWeight: 500, transition: 'all 0.2s'
                }}>
                    <ArrowDownUp size={14} /> Swap
                </button>
            </div>

            {/* Output */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
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

            {/* Reference Panel */}
            {showRef && (
                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <h3 style={{ fontSize: '1rem', color: 'var(--primary)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <BookOpen size={16} /> Common HTML Entities
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-sm)' }}>
                        {COMMON_ENTITIES.map(ent => (
                            <button
                                key={ent.entity}
                                onClick={() => insertEntity(ent.char)}
                                style={{
                                    padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                                    color: 'var(--text-main)', cursor: 'pointer', textAlign: 'left',
                                    display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.2s'
                                }}
                            >
                                <span style={{ fontSize: '1.3rem', width: 28, textAlign: 'center' }}>{ent.char}</span>
                                <div>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--primary)' }}>{ent.entity}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{ent.name}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
