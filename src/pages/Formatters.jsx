import React, { useState, useEffect } from 'react'
import { format as formatSql } from 'sql-formatter'
import jmespath from 'jmespath'
import { Braces, Database, Copy, Check, Trash2, FileCode, FileJson, RefreshCw, Filter, AlignLeft, AlignJustify, Code, FileDiff, ArrowRightLeft } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { DiffViewer } from '../components/DiffViewer'
import { useSmartInput } from '../hooks/useSmartInput'
import Editor from '@monaco-editor/react'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'

// Simple XML Formatter
function formatXml(xml, indentChar = '  ') {
    let formatted = ''
    let pad = 0
    xml.split(/>\s*</).forEach(node => {
        if (node.match(/^\/\w/)) pad = Math.max(0, pad - 1)
        formatted += indentChar.repeat(pad) + '<' + node + '>\r\n'
        if (node.match(/^<?\w[^>]*[^\/]$/)) pad += 1
    })
    return formatted.replace(/^<|>\r\n$/g, '')
}

function minifyXml(xml) {
    return xml.replace(/>\s*</g, '><').trim()
}

const SQL_DIALECTS = [
    'sql', 'postgresql', 'mysql', 'mariadb', 'sqlite', 'transactsql', 'plsql', 'bigquery', 'snowflake', 'redshift', 'spark', 'db2'
]

export default function Formatters() {
    useDocumentTitle('Formatters')
    const [mode, setMode] = useState('json') // 'json' | 'sql' | 'xml'
    const [dialect, setDialect] = useState('sql')
    const [input, setInput] = useState('')
    const [output, setOutput] = useState('')
    const [viewMode, setViewMode] = useState('code') // 'code' | 'diff'
    const [error, setError] = useState(null)
    const [copied, setCopied] = useState(false)
    const [indent, setIndent] = useState(2) // 0 for minify, 2 for prettify
    const [jqQuery, setJqQuery] = useState('') // Default empty (identity)

    useSmartInput({ input: setInput, mode: setMode })

    const handleFormat = () => {
        if (!input.trim()) return

        try {
            setError(null)
            if (mode === 'json') {
                let parsed
                try {
                    parsed = JSON.parse(input)
                } catch (e) {
                    setError(`JSON Syntax Error: ${e.message}`)
                    return
                }

                // Apply JMESPath filter
                let filtered = parsed
                if (jqQuery && jqQuery.trim() !== '') {
                    try {
                        filtered = jmespath.search(parsed, jqQuery)
                        if (filtered === null) filtered = null
                    } catch (e) {
                        setError(`Query Error: ${e.message}`)
                        return
                    }
                }

                setOutput(JSON.stringify(filtered, null, indent))
            } else if (mode === 'sql') {
                setOutput(formatSql(input, { language: dialect, tabWidth: 2, keywordCase: 'upper' }))
            } else if (mode === 'xml') {
                if (indent === 0) {
                    setOutput(minifyXml(input))
                } else {
                    setOutput(formatXml(input))
                }
            }
        } catch (e) {
            setError(e.message)
            setOutput('')
        }
    }

    // Auto-format when toggles change (if input exists) with debounce
    useEffect(() => {
        if (!input) return

        const timer = setTimeout(() => {
            handleFormat()
        }, 500)

        return () => clearTimeout(timer)
        return () => clearTimeout(timer)
    }, [indent, jqQuery, mode, dialect])

    const handleCopy = () => {
        if (!output) return
        navigator.clipboard.writeText(output)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '1600px', margin: '0 auto', height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient">Code Formatters</h2>
                <p style={{ color: 'var(--text-muted)' }}>Prettify, Minify, and Query your code.</p>
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
                            borderColor: mode === 'json' ? 'var(--primary)' : 'var(--border)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 6
                        }}
                    >
                        <Braces size={16} /> JSON
                    </button>
                    <button
                        onClick={() => { setMode('sql'); setInput(''); setOutput(''); setError(null); }}
                        style={{
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-sm)',
                            background: mode === 'sql' ? 'var(--primary)' : 'transparent',
                            color: mode === 'sql' ? '#fff' : 'var(--text-muted)',
                            border: '1px solid',
                            borderColor: mode === 'sql' ? 'var(--primary)' : 'var(--border)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 6
                        }}
                    >
                        <Database size={16} /> SQL
                    </button>
                    <button
                        onClick={() => { setMode('xml'); setInput(''); setOutput(''); setError(null); }}
                        style={{
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-sm)',
                            background: mode === 'xml' ? 'var(--primary)' : 'transparent',
                            color: mode === 'xml' ? '#fff' : 'var(--text-muted)',
                            border: '1px solid',
                            borderColor: mode === 'xml' ? 'var(--primary)' : 'var(--border)',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 6
                        }}
                    >
                        <Code size={16} /> XML
                    </button>
                </div>

                {mode === 'sql' && (
                    <>
                        <div style={{ width: 1, height: 24, background: 'var(--border)' }}></div>
                        <select
                            value={dialect}
                            onChange={(e) => setDialect(e.target.value)}
                            style={{
                                padding: '8px',
                                background: 'var(--bg-app)',
                                border: '1px solid var(--border)',
                                color: 'var(--text-main)',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.9rem',
                                outline: 'none'
                            }}
                        >
                            {SQL_DIALECTS.map(d => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
                    </>
                )}

                <div style={{ width: 1, height: 24, background: 'var(--border)' }}></div>

                {/* Minify/Prettify Toggle */}
                {(mode === 'json' || mode === 'xml') && (
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
                )}

                {mode === 'json' && (
                    <>
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

            <div className="split-pane" style={{ flex: 1, minHeight: 0, paddingBottom: 20 }}>
                {/* Input */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileCode size={16} /> Input</label>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <PipelineRead onRead={setInput} />
                            {input && (
                                <button onClick={() => setInput('')} style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', gap: 4, background: 'none', border: 'none', cursor: 'pointer', alignItems: 'center' }}>
                                    <Trash2 size={12} /> Clear
                                </button>
                            )}
                        </div>
                    </div>
                    <div style={{ flex: 1, minHeight: '300px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <Editor
                            height="100%"
                            language={mode}
                            theme="vs-dark"
                            value={input}
                            onChange={(val) => setInput(val || '')}
                            options={{
                                minimap: { enabled: false },
                                fontSize: 14,
                                fontFamily: 'var(--font-mono)',
                                lineNumbers: "on",
                                scrollBeyondLastLine: false,
                                wordWrap: "on",
                                padding: { top: 16 }
                            }}
                        />
                    </div>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileJson size={16} /> Output</label>
                                <div style={{ display: 'flex', background: 'var(--bg-app)', borderRadius: 4, padding: 2 }}>
                                    <button onClick={() => setViewMode('code')} style={{ padding: '2px 8px', borderRadius: 2, border: 'none', background: viewMode === 'code' ? 'var(--primary)' : 'transparent', color: viewMode === 'code' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem' }}>Code</button>
                                    <button onClick={() => setViewMode('diff')} style={{ padding: '2px 8px', borderRadius: 2, border: 'none', background: viewMode === 'diff' ? 'var(--primary)' : 'transparent', color: viewMode === 'diff' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem' }}>Diff</button>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <PipelineSend dataToSend={output} />
                                {output && viewMode === 'code' && (
                                    <button
                                        onClick={handleCopy}
                                        style={{
                                            color: copied ? '#10b981' : 'var(--primary)',
                                            fontSize: '0.8rem',
                                            display: 'flex',
                                            gap: 4,
                                            alignItems: 'center',
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
                            height: '100%',
                            minHeight: '0'
                        }}>
                            {error ? (
                                <div style={{ padding: 'var(--space-md)', color: '#ef4444', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
                                    <strong>Error:</strong> {error}
                                </div>
                            ) : (
                                viewMode === 'diff' ? (
                                    <div style={{ height: '100%', overflow: 'hidden' }}>
                                        <DiffViewer oldText={input} newText={output} viewMode="split" />
                                    </div>
                                ) : (
                                    <div style={{ flex: 1, height: '100%', minHeight: '300px', overflow: 'hidden' }}>
                                        <Editor
                                            height="100%"
                                            language={mode}
                                            theme="vs-dark"
                                            value={output}
                                            options={{
                                                readOnly: true,
                                                minimap: { enabled: false },
                                                fontSize: 14,
                                                fontFamily: 'var(--font-mono)',
                                                lineNumbers: "on",
                                                scrollBeyondLastLine: false,
                                                wordWrap: "on",
                                                padding: { top: 16 }
                                            }}
                                        />
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
    )
}
