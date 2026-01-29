import React, { useState, useMemo } from 'react'
import { Copy, Flag } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function RegexTester() {
    useDocumentTitle('Regex Tester')
    const [regex, setRegex] = useState('([A-Z])\\w+')
    const [flags, setFlags] = useState('g')
    const [text, setText] = useState('Hello World, this is a Vibe Check.')

    // Parse Regex
    const matches = useMemo(() => {
        if (!regex) return []
        try {
            const re = new RegExp(regex, flags)
            const results = []
            let match

            // Handle global vs non-global
            if (flags.includes('g')) {
                while ((match = re.exec(text)) !== null) {
                    results.push({
                        index: match.index,
                        value: match[0],
                        groups: match.slice(1)
                    })
                    if (re.lastIndex === match.index) {
                        re.lastIndex++ // Avoid infinite loops with zero-width matches
                    }
                }
            } else {
                match = re.exec(text)
                if (match) {
                    results.push({
                        index: match.index,
                        value: match[0],
                        groups: match.slice(1)
                    })
                }
            }
            return results
        } catch (e) {
            return { error: e.message }
        }
    }, [regex, flags, text])

    const toggleFlag = (flag) => {
        setFlags(prev => prev.includes(flag) ? prev.replace(flag, '') : prev + flag)
    }

    const highlightText = () => {
        if (matches.error) return text
        if (matches.length === 0) return text

        let lastIndex = 0
        const elements = []

        matches.forEach((m, i) => {
            // Text before match
            if (m.index > lastIndex) {
                elements.push(text.substring(lastIndex, m.index))
            }
            // Match
            elements.push(
                <span key={i} style={{ background: 'rgba(16, 185, 129, 0.3)', borderRadius: 2, borderBottom: '2px solid #10b981' }}>
                    {m.value}
                </span>
            )
            lastIndex = m.index + m.value.length
        })

        if (lastIndex < text.length) {
            elements.push(text.substring(lastIndex))
        }

        return elements
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient">Regex Tester</h2>
                <p style={{ color: 'var(--text-muted)' }}>Test and debug your regular expressions.</p>
            </div>

            {/* Regex Input */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 8, display: 'block' }}>Regular Expression</label>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <div style={{ padding: '0 12px', color: 'var(--text-dim)', fontSize: '1.2rem' }}>/</div>
                    <input
                        type="text"
                        value={regex}
                        onChange={e => setRegex(e.target.value)}
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            padding: '12px 0',
                            fontSize: '1.1rem',
                            color: 'var(--text-main)',
                            fontFamily: 'var(--font-mono)',
                            outline: 'none'
                        }}
                    />
                    <div style={{ padding: '0 12px', color: 'var(--text-dim)', fontSize: '1.2rem', borderLeft: '1px solid var(--border)' }}>/</div>
                    <input
                        type="text"
                        value={flags}
                        onChange={e => setFlags(e.target.value.replace(/[^gimsuy]/g, ''))}
                        style={{
                            width: '60px',
                            background: 'transparent',
                            border: 'none',
                            padding: '12px 0',
                            fontSize: '1.1rem',
                            color: 'var(--primary)',
                            fontFamily: 'var(--font-mono)',
                            outline: 'none'
                        }}
                    />
                </div>

                {matches.error && (
                    <div style={{ color: '#ef4444', fontSize: '0.9rem', marginTop: 8 }}>
                        Invalid Regex: {matches.error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    {['g', 'i', 'm', 's', 'u', 'y'].map(f => (
                        <button
                            key={f}
                            onClick={() => toggleFlag(f)}
                            style={{
                                padding: '4px 8px',
                                borderRadius: 4,
                                border: `1px solid ${flags.includes(f) ? 'var(--primary)' : 'var(--border)'}`,
                                background: flags.includes(f) ? 'rgba(var(--primary-rgb), 0.1)' : 'transparent',
                                color: flags.includes(f) ? 'var(--primary)' : 'var(--text-muted)',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontFamily: 'var(--font-mono)'
                            }}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* Test String & Highlight */}
            <div className="split-pane">

                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <div style={{ marginBottom: 8, color: 'var(--text-muted)' }}>Test String</div>
                    <textarea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        style={{
                            width: '100%',
                            height: '300px',
                            background: 'var(--bg-app)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-md)',
                            padding: '12px',
                            color: 'var(--text-main)',
                            fontFamily: 'var(--font-mono)',
                            resize: 'vertical',
                            lineHeight: 1.5
                        }}
                        spellCheck="false"
                    />
                </div>

                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <div style={{ marginBottom: 8, color: 'var(--text-muted)' }}>Match Preview</div>
                    <div
                        style={{
                            width: '100%',
                            height: '300px',
                            background: 'var(--bg-app)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-md)',
                            padding: '12px',
                            color: 'var(--text-main)',
                            fontFamily: 'var(--font-mono)',
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            lineHeight: 1.5
                        }}
                    >
                        {highlightText()}
                    </div>
                </div>
            </div>

            {/* Match Details */}
            {!matches.error && matches.length > 0 && (
                <div className="glass-panel" style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)' }}>
                    <div style={{ marginBottom: 12, fontWeight: 600 }}>Match Details ({matches.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {matches.map((m, i) => (
                            <div key={i} style={{ padding: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, display: 'flex', gap: 12, alignItems: 'center' }}>
                                <div style={{
                                    minWidth: 24, height: 24, borderRadius: '50%', background: 'var(--primary)', color: '#fff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem'
                                }}>{i + 1}</div>
                                <div style={{ fontFamily: 'var(--font-mono)', flex: 1 }}>{m.value}</div>
                                <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Index: {m.index}</div>
                                {m.groups.length > 0 && (
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        {m.groups.map((g, gi) => (
                                            <span key={gi} style={{ padding: '2px 6px', background: '#333', borderRadius: 4, fontSize: '0.75rem' }}>$ {gi + 1}: {g}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
