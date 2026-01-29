import React, { useState } from 'react'
import { format as formatSql } from 'sql-formatter'
import { Braces, Database, Copy, Check, Trash2, FileCode, FileJson, RefreshCw } from 'lucide-react'
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
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient">Code Formatters</h2>
                <p style={{ color: 'var(--text-muted)' }}>Prettify your JSON and SQL code.</p>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                    <button
                        onClick={() => { setMode('json'); setInput(''); setOutput(''); setError(null); }}
                        style={{
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-sm)',
                            background: mode === 'json' ? 'var(--primary)' : 'transparent',
                            color: mode === 'json' ? '#fff' : 'var(--text-muted)',
                            border: '1px solid',
                            borderColor: mode === 'json' ? 'var(--primary)' : 'var(--border)'
                        }}
                    >
                        JSON
                    </button>
                    <button
                        onClick={() => { setMode('sql'); setInput(''); setOutput(''); setError(null); }}
                        style={{
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-sm)',
                            background: mode === 'sql' ? 'var(--primary)' : 'transparent',
                            color: mode === 'sql' ? '#fff' : 'var(--text-muted)',
                            border: '1px solid',
                            borderColor: mode === 'sql' ? 'var(--primary)' : 'var(--border)'
                        }}
                    >
                        SQL
                    </button>
                </div>
            </div>

            <div className="split-pane">
                {/* Input */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileCode size={16} /> Input</label>
                        <button onClick={() => setInput('')} style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', gap: 4 }}>
                            <Trash2 size={12} /> Clear
                        </button>
                    </div>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={mode === 'json' ? 'Paste minified JSON...' : 'Paste messy SQL...'}
                        style={{
                            flex: 1,
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            resize: 'vertical',
                            background: 'rgba(0,0,0,0.2)',
                            minHeight: '300px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-main)',
                            padding: 'var(--space-sm)'
                        }}
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
                            cursor: 'pointer',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6
                        }}
                    >
                        <RefreshCw size={16} /> Format {mode.toUpperCase()}
                    </button>
                </div>

                {/* Output */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileJson size={16} /> Output</label>
                        {output && (
                            <button
                                onClick={handleCopy}
                                style={{
                                    color: copied ? '#10b981' : 'var(--primary)',
                                    fontSize: '0.8rem',
                                    display: 'flex',
                                    gap: 4,
                                    background: 'transparent',
                                    border: `1px solid ${copied ? '#10b981' : 'var(--primary)'}`,
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                            </button>
                        )}
                    </div>
                    <div style={{
                        flex: 1,
                        background: 'rgba(0,0,0,0.2)',
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
