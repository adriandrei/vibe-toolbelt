import React, { useState } from 'react'
import { FileJson, FileSpreadsheet, ArrowRight, ArrowLeft, Copy, Check, Trash2, Table } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// Simple CSV Parser
function parseCSV(text, delimiter = ',') {
    const rows = []
    let currentRow = []
    let currentVal = ''
    let insideQuote = false

    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        const next = text[i + 1]

        if (char === '"') {
            if (insideQuote && next === '"') {
                currentVal += '"'
                i++
            } else {
                insideQuote = !insideQuote
            }
        } else if (char === delimiter && !insideQuote) {
            currentRow.push(currentVal)
            currentVal = ''
        } else if (char === '\n' && !insideQuote) { // Handle \r?
            currentRow.push(currentVal)
            rows.push(currentRow)
            currentRow = []
            currentVal = ''
        } else if (char === '\r' && !insideQuote) {
            // ignore
        } else {
            currentVal += char
        }
    }
    if (currentVal || currentRow.length) {
        currentRow.push(currentVal)
        rows.push(currentRow)
    }

    return rows.filter(r => r.length > 0 && (r.length > 1 || r[0] !== ''))
}

// Simple JSON to CSV
function toCSV(data, delimiter = ',') {
    if (!Array.isArray(data)) throw new Error('JSON must be an array of objects')
    if (data.length === 0) return ''

    const headers = Object.keys(data[0])
    const rows = [headers]

    data.forEach(obj => {
        const row = headers.map(h => {
            let val = obj[h] === null || obj[h] === undefined ? '' : String(obj[h])
            if (val.includes(delimiter) || val.includes('"') || val.includes('\n')) {
                val = `"${val.replace(/"/g, '""')}"`
            }
            return val
        })
        rows.push(row)
    })

    return rows.map(r => r.join(delimiter)).join('\n')
}

export default function CsvJson() {
    useDocumentTitle('CSV <-> JSON Converter')
    const [csv, setCsv] = useState('')
    const [json, setJson] = useState('')
    const [error, setError] = useState(null)
    const [copied, setCopied] = useState(null)
    const [delimiter, setDelimiter] = useState(',')

    const convertToJson = () => {
        try {
            setError(null)
            const rows = parseCSV(csv, delimiter)
            if (rows.length < 2) throw new Error('CSV must have at least a header row and one data row')

            const headers = rows[0]
            const result = rows.slice(1).map(row => {
                const obj = {}
                headers.forEach((h, i) => {
                    obj[h.trim()] = row[i] || '' // Handle missing cols
                })
                return obj
            })

            setJson(JSON.stringify(result, null, 2))
        } catch (e) {
            setError(e.message)
        }
    }

    const convertToCsv = () => {
        try {
            setError(null)
            const data = JSON.parse(json)
            const result = toCSV(data, delimiter)
            setCsv(result)
        } catch (e) {
            setError('Invalid JSON: ' + e.message)
        }
    }

    const copy = (text, key) => {
        navigator.clipboard.writeText(text)
        setCopied(key)
        setTimeout(() => setCopied(null), 2000)
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>CSV ↔ JSON Converter</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Convert between CSV (Comma Separated Values) and JSON array
                </p>
            </div>

            {/* Controls */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', justifyContent: 'center', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Delimiter:</label>
                    <select
                        value={delimiter}
                        onChange={e => setDelimiter(e.target.value)}
                        style={{
                            padding: '8px', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)',
                            color: 'var(--text-main)'
                        }}
                    >
                        <option value=",">Comma (,)</option>
                        <option value=";">Semicolon (;)</option>
                        <option value="|">Pipe (|)</option>
                        <option value="	">Tab (\t)</option>
                    </select>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 'var(--space-md)', alignItems: 'center' }}>

                {/* CSV Input */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FileSpreadsheet size={16} color="#22c55e" /> CSV
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setCsv('')} style={{ color: 'var(--text-dim)', padding: 4 }}><Trash2 size={14} /></button>
                            <button onClick={() => copy(csv, 'csv')} style={{ color: copied === 'csv' ? 'var(--accent)' : 'var(--text-dim)', padding: 4 }}>
                                {copied === 'csv' ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                        </div>
                    </div>
                    <textarea
                        value={csv}
                        onChange={e => setCsv(e.target.value)}
                        placeholder="id,name,role&#10;1,Alice,Admin&#10;2,Bob,User"
                        style={{
                            flex: 1, minHeight: '400px', resize: 'vertical',
                            padding: '12px', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)',
                            color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', whiteSpace: 'pre'
                        }}
                    />
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <button onClick={convertToJson} title="Convert CSV to JSON" style={{
                        padding: '12px', borderRadius: '50%',
                        background: 'var(--primary-glow)', border: '1px solid var(--primary)',
                        color: 'var(--primary)', cursor: 'pointer', transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <ArrowRight size={24} />
                    </button>
                    <button onClick={convertToCsv} title="Convert JSON to CSV" style={{
                        padding: '12px', borderRadius: '50%',
                        background: 'var(--primary-glow)', border: '1px solid var(--primary)',
                        color: 'var(--primary)', cursor: 'pointer', transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <ArrowLeft size={24} />
                    </button>
                </div>

                {/* JSON Input */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FileJson size={16} color="#f59e0b" /> JSON
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setJson('')} style={{ color: 'var(--text-dim)', padding: 4 }}><Trash2 size={14} /></button>
                            <button onClick={() => copy(json, 'json')} style={{ color: copied === 'json' ? 'var(--accent)' : 'var(--text-dim)', padding: 4 }}>
                                {copied === 'json' ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                        </div>
                    </div>
                    <textarea
                        value={json}
                        onChange={e => setJson(e.target.value)}
                        placeholder={'[\n  {\n    "id": 1,\n    "name": "Alice"\n  }\n]'}
                        style={{
                            flex: 1, minHeight: '400px', resize: 'vertical',
                            padding: '12px', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)',
                            color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem'
                        }}
                    />
                </div>
            </div>

            {error && (
                <div style={{
                    marginTop: 'var(--space-md)', padding: 'var(--space-md)',
                    borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', textAlign: 'center'
                }}>
                    {error}
                </div>
            )}
        </div>
    )
}
