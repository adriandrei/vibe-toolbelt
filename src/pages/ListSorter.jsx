import React, { useState, useMemo } from 'react'
import { List, Copy, Check, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Filter, Hash } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function ListSorter() {
    useDocumentTitle('List Sorter & Deduplicator')
    const [input, setInput] = useState('')
    const [copied, setCopied] = useState(false)

    // Options
    const [sortDir, setSortDir] = useState('asc') // asc | desc | none
    const [dedupe, setDedupe] = useState(false)
    const [trimLines, setTrimLines] = useState(true)
    const [removeEmpty, setRemoveEmpty] = useState(true)
    const [caseSensitive, setCaseSensitive] = useState(true)
    const [sortType, setSortType] = useState('alpha') // alpha | numeric | length

    const result = useMemo(() => {
        let lines = input.split('\n')

        if (trimLines) lines = lines.map(l => l.trim())
        if (removeEmpty) lines = lines.filter(l => l.length > 0)

        if (dedupe) {
            if (caseSensitive) {
                // Case Sensitive Dedupe: "Apple" != "apple"
                lines = [...new Set(lines)]
            } else {
                // Ignore Case Dedupe: "Apple" == "apple" -> Keep first occurrence
                const seen = new Set()
                lines = lines.filter(l => {
                    const key = l.toLowerCase()
                    if (seen.has(key)) return false
                    seen.add(key)
                    return true
                })
            }
        }

        if (sortDir !== 'none') {
            lines.sort((a, b) => {
                let cmp
                if (sortType === 'numeric') {
                    cmp = (parseFloat(a) || 0) - (parseFloat(b) || 0)
                } else if (sortType === 'length') {
                    cmp = a.length - b.length
                } else {
                    // If Case Sensitive: Use localeCompare
                    // If Ignore Case: Lowercase both then compare
                    cmp = caseSensitive ? a.localeCompare(b) : a.toLowerCase().localeCompare(b.toLowerCase())
                }
                return sortDir === 'desc' ? -cmp : cmp
            })
        }

        return lines
    }, [input, sortDir, dedupe, trimLines, removeEmpty, caseSensitive, sortType])

    const stats = useMemo(() => {
        const original = input.split('\n').filter(l => l.trim().length > 0)
        return {
            original: original.length,
            result: result.length,
            removed: original.length - result.length,
            duplicates: original.length - new Set(original.map(l => caseSensitive ? l.trim() : l.trim().toLowerCase())).size
        }
    }, [input, result, caseSensitive])

    const copy = () => {
        navigator.clipboard.writeText(result.join('\n'))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const toggleStyle = (active) => ({
        padding: '8px 14px',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--primary-glow)' : 'rgba(255,255,255,0.03)',
        border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
        color: active ? 'var(--primary)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: '0.8rem',
        fontWeight: 500,
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: 4
    })

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>List Sorter & Deduplicator</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Sort, deduplicate, and clean up text lines
                </p>
            </div>

            {/* Options Bar */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Sort Direction */}
                    <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => setSortDir('asc')} style={toggleStyle(sortDir === 'asc')} title="Sort ascending">
                            <ArrowUp size={12} /> A→Z
                        </button>
                        <button onClick={() => setSortDir('desc')} style={toggleStyle(sortDir === 'desc')} title="Sort descending">
                            <ArrowDown size={12} /> Z→A
                        </button>
                        <button onClick={() => setSortDir('none')} style={toggleStyle(sortDir === 'none')} title="No sorting">
                            Off
                        </button>
                    </div>

                    <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

                    {/* Sort Type */}
                    <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => setSortType('alpha')} style={toggleStyle(sortType === 'alpha')}>Abc</button>
                        <button onClick={() => setSortType('numeric')} style={toggleStyle(sortType === 'numeric')}>123</button>
                        <button onClick={() => setSortType('length')} style={toggleStyle(sortType === 'length')}>Len</button>
                    </div>

                    <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

                    {/* Toggles */}
                    <button onClick={() => setDedupe(!dedupe)} style={toggleStyle(dedupe)}>
                        <Filter size={12} /> Dedupe
                    </button>
                    <button onClick={() => setTrimLines(!trimLines)} style={toggleStyle(trimLines)}>
                        Trim
                    </button>
                    <button onClick={() => setRemoveEmpty(!removeEmpty)} style={toggleStyle(removeEmpty)}>
                        Remove Empty
                    </button>
                    <button onClick={() => setCaseSensitive(!caseSensitive)} style={toggleStyle(!caseSensitive)}>
                        Ignore Case
                    </button>
                </div>
            </div>

            {/* Side-by-side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                {/* Input */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <List size={14} color="var(--primary)" /> Input
                        </label>
                        <button onClick={() => setInput('')} style={{ color: 'var(--text-dim)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Trash2 size={12} /> Clear
                        </button>
                    </div>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder={"Paste your list here...\nOne item per line\napple\nbanana\napple\ncherry"}
                        style={{ width: '100%', minHeight: '350px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
                    />
                </div>

                {/* Output */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Result</label>
                        {result.length > 0 && (
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
                    <textarea
                        readOnly
                        value={result.join('\n')}
                        style={{
                            width: '100%', minHeight: '350px', resize: 'vertical',
                            fontFamily: 'var(--font-mono)', fontSize: '0.9rem',
                            background: 'rgba(0,0,0,0.15)', cursor: 'default'
                        }}
                    />
                </div>
            </div>

            {/* Stats */}
            {input && (
                <div className="glass-panel" style={{ padding: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Input Lines</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>{stats.original}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Result Lines</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)' }}>{stats.result}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Removed</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: stats.removed > 0 ? '#ef4444' : 'var(--text-main)' }}>{stats.removed}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Duplicates Found</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: stats.duplicates > 0 ? '#f59e0b' : 'var(--text-main)' }}>{stats.duplicates}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
