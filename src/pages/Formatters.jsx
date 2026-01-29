import React, { useState } from 'react'
import { format as formatSql } from 'sql-formatter'
import { Braces, Database, Copy, Check, Trash2 } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Formatters() {
    useDocumentTitle('Formatters')
    const [mode, setMode] = useState('json') // 'json' | 'sql'
    const [input, setInput] = useState('')
    const [output, setOutput] = useState('')
    const [error, setError] = useState(null)
    const [copied, setCopied] = useState(false)

    const handleFormat = () => {
        if (!input.trim()) return

        try {
            setError(null)
            if (mode === 'json') {
                const parsed = JSON.parse(input)
                setOutput(JSON.stringify(parsed, null, 2))
            } else {
                setOutput(formatSql(input, { language: 'sql', tabWidth: 2, keywordCase: 'upper' }))
            }
        } catch (e) {
            setError(e.message)
            setOutput('')
        }
    }

    const handleCopy = () => {
        if (!output) return
        navigator.clipboard.writeText(output)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <button
                    onClick={() => { setMode('json'); setInput(''); setOutput(''); setError(null); }}
                    style={{
                        flex: 1,
                        padding: 'var(--space-md)',
                        borderRadius: 'var(--radius-md)',
                        background: mode === 'json' ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                        color: mode === 'json' ? '#fff' : 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        fontWeight: 600,
                        fontSize: '1.1rem',
                        transition: 'all 0.2s',
                        border: '1px solid var(--border)'
                    }}
                >
                    <Braces size={20} /> JSON
                </button>
                <button
                    onClick={() => { setMode('sql'); setInput(''); setOutput(''); setError(null); }}
                    style={{
                        flex: 1,
                        padding: 'var(--space-md)',
                        borderRadius: 'var(--radius-md)',
                        background: mode === 'sql' ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                        color: mode === 'sql' ? '#fff' : 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        fontWeight: 600,
                        fontSize: '1.1rem',
                        transition: 'all 0.2s',
                        border: '1px solid var(--border)'
                    }}
                >
                    <Database size={20} /> SQL
                </button>
            </div>

            <div className="split-pane">
                {/* Input */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                        <label style={{ color: 'var(--text-muted)' }}>Input</label>
                        <button onClick={() => setInput('')} style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', gap: 4 }}>
                            <Trash2 size={12} /> Clear
                        </button>
                    </div>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={mode === 'json' ? 'Paste minified JSON...' : 'Paste messy SQL...'}
                        style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.85rem', resize: 'none', background: 'rgba(0,0,0,0.2)', minHeight: '300px' }}
                    />
                    <button
                        onClick={handleFormat}
                        style={{
                            marginTop: 'var(--space-md)',
                            padding: 'var(--space-md)',
                            background: 'var(--primary)',
                            color: '#fff',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer'
                        }}
                    >
                        Format {mode.toUpperCase()}
                    </button>
                </div>

                {/* Output */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                        <label style={{ color: 'var(--text-muted)' }}>Output</label>
                        {output && (
                            <button
                                onClick={handleCopy}
                                style={{ color: copied ? 'var(--accent)' : 'var(--primary)', fontSize: '0.8rem', display: 'flex', gap: 4 }}
                            >
                                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                            </button>
                        )}
                    </div>
                    <div style={{
                        flex: 1,
                        background: 'rgba(0,0,0,0.3)',
                        borderRadius: 'var(--radius-md)',
                        border: error ? '1px solid #ef4444' : '1px solid var(--border)',
                        overflow: 'hidden',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: '300px'
                    }}>
                        {error ? (
                            <div style={{ padding: 'var(--space-md)', color: '#ef4444' }}>
                                <strong>Error:</strong> {error}
                            </div>
                        ) : (
                            <textarea
                                readOnly
                                value={output}
                                style={{
                                    flex: 1,
                                    width: '100%',
                                    padding: 'var(--space-md)',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '0.85rem',
                                    background: 'transparent',
                                    border: 'none',
                                    resize: 'none',
                                    color: mode === 'sql' ? '#a5b4fc' : '#86efac'
                                }}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
