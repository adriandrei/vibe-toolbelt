import React, { useState, useEffect } from 'react'
import { format as formatSql } from 'sql-formatter'
import jmespath from 'jmespath'
import { Braces, Database, Copy, Check, Trash2, FileCode, FileJson, RefreshCw, Filter, AlignLeft, AlignJustify } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Formatters() {
    useDocumentTitle('Formatters')
    const [mode, setMode] = useState('json') // 'json' | 'sql'
    const [input, setInput] = useState('')
    const [output, setOutput] = useState('')
    const [error, setError] = useState(null)
    const [copied, setCopied] = useState(false)
    const [indent, setIndent] = useState(2) // 0 for minify, 2 for prettify
    const [jqQuery, setJqQuery] = useState('') // Default empty (identity)

    const handleFormat = () => {
        if (!input.trim()) return

        try {
            setError(null)
            if (mode === 'json') {
                let parsed
                try {
                    parsed = JSON.parse(input)
                } catch (e) {
                    // Try to extract position from error message if possible
                    setError(`JSON Syntax Error: ${e.message}`)
                    return
                }

                // Apply JMESPath filter
                let filtered = parsed
                if (jqQuery && jqQuery.trim() !== '') {
                    try {
                        // jmespath.search(data, query)
                        filtered = jmespath.search(parsed, jqQuery)
                        // Handle null result (no match)
                        if (filtered === null) filtered = null
                    } catch (e) {
                        setError(`Query Error: ${e.message}`)
                        return
                    }
                }

                setOutput(JSON.stringify(filtered, null, indent))
            } else {
                setOutput(formatSql(input, { language: 'sql', tabWidth: 2, keywordCase: 'upper' }))
            }
        } catch (e) {
            setError(e.message)
            setOutput('')
        }
    }

    // Auto-format when toggles change (if input exists)
    // Auto-format when toggles change (if input exists) with debounce
    useEffect(() => {
        if (!input) return

        const timer = setTimeout(() => {
            handleFormat()
        }, 500)

        return () => clearTimeout(timer)
    }, [indent, jqQuery])

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
                <p style={{ color: 'var(--text-muted)' }}>Prettify, Minify, and Query your JSON.</p>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
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

                {mode === 'json' && (
                    <>
                        <div style={{ width: 1, height: 24, background: 'var(--border)' }}></div>

                        {/* Minify/Prettify Toggle */}
                        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                            <button
                                onClick={() => setIndent(2)}
                                title="Prettify (2 spaces)"
                                style={{
                                    padding: '8px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: indent === 2 ? 'rgba(255,255,255,0.1)' : 'transparent',
                                    color: indent === 2 ? 'var(--primary)' : 'var(--text-muted)',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                <AlignLeft size={18} />
                            </button>
                            <button
                                onClick={() => setIndent(0)}
                                title="Minify (0 spaces)"
                                style={{
                                    padding: '8px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: indent === 0 ? 'rgba(255,255,255,0.1)' : 'transparent',
                                    color: indent === 0 ? 'var(--primary)' : 'var(--text-muted)',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                <AlignJustify size={18} />
                            </button>
                        </div>

                        <div style={{ width: 1, height: 24, background: 'var(--border)' }}></div>

                        {/* JQ Query Input */}
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                            <Filter size={16} style={{ color: 'var(--text-muted)' }} />
                            <input
                                type="text"
                                value={jqQuery}
                                onChange={(e) => setJqQuery(e.target.value)}
                                placeholder="JMESPath Filter (e.g. [*].id or people[?age > `20`])"
                                style={{
                                    padding: '6px 10px',
                                    fontSize: '0.9rem',
                                    fontFamily: 'var(--font-mono)',
                                    background: 'var(--bg-app)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-sm)',
                                    color: 'var(--text-main)',
                                    width: '100%',
                                    minWidth: '200px'
                                }}
                            />
                        </div>
                    </>
                )}
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
                        spellCheck="false"
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
                        <RefreshCw size={16} /> Process
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
                            <div style={{ padding: 'var(--space-md)', color: '#ef4444', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
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
                                    color: mode === 'sql' ? '#a5b4fc' : '#86efac',
                                    overflow: 'auto'
                                }}
                                spellCheck="false"
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
