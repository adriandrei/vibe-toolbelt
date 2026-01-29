import React, { useState, useMemo } from 'react'
import { Copy, Check, Replace, BookOpen, X, ChevronRight } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// Regex Cheat Sheet Data
const CHEAT_SHEET = [
    {
        category: 'Character Classes',
        items: [
            { pattern: '.', desc: 'Any character except newline' },
            { pattern: '\\d', desc: 'Digit (0-9)' },
            { pattern: '\\D', desc: 'Non-digit' },
            { pattern: '\\w', desc: 'Word char (a-z, A-Z, 0-9, _)' },
            { pattern: '\\W', desc: 'Non-word character' },
            { pattern: '\\s', desc: 'Whitespace' },
            { pattern: '\\S', desc: 'Non-whitespace' },
            { pattern: '[abc]', desc: 'Any of a, b, or c' },
            { pattern: '[^abc]', desc: 'Not a, b, or c' },
            { pattern: '[a-z]', desc: 'Character range' },
        ]
    },
    {
        category: 'Quantifiers',
        items: [
            { pattern: '*', desc: '0 or more' },
            { pattern: '+', desc: '1 or more' },
            { pattern: '?', desc: '0 or 1' },
            { pattern: '{n}', desc: 'Exactly n' },
            { pattern: '{n,}', desc: 'n or more' },
            { pattern: '{n,m}', desc: 'Between n and m' },
            { pattern: '*?', desc: 'Lazy 0 or more' },
            { pattern: '+?', desc: 'Lazy 1 or more' },
        ]
    },
    {
        category: 'Anchors',
        items: [
            { pattern: '^', desc: 'Start of string/line' },
            { pattern: '$', desc: 'End of string/line' },
            { pattern: '\\b', desc: 'Word boundary' },
            { pattern: '\\B', desc: 'Non-word boundary' },
        ]
    },
    {
        category: 'Groups & References',
        items: [
            { pattern: '(abc)', desc: 'Capture group' },
            { pattern: '(?:abc)', desc: 'Non-capture group' },
            { pattern: '(?<name>abc)', desc: 'Named group' },
            { pattern: '\\1', desc: 'Backreference' },
            { pattern: '(?=abc)', desc: 'Positive lookahead' },
            { pattern: '(?!abc)', desc: 'Negative lookahead' },
            { pattern: '(?<=abc)', desc: 'Positive lookbehind' },
            { pattern: '(?<!abc)', desc: 'Negative lookbehind' },
        ]
    },
    {
        category: 'Flags',
        items: [
            { pattern: 'g', desc: 'Global (find all)' },
            { pattern: 'i', desc: 'Case insensitive' },
            { pattern: 'm', desc: 'Multiline (^ $ per line)' },
            { pattern: 's', desc: 'Dotall (. matches \\n)' },
            { pattern: 'u', desc: 'Unicode support' },
            { pattern: 'y', desc: 'Sticky (from lastIndex)' },
        ]
    }
]

export default function RegexTester() {
    useDocumentTitle('Regex Tester')
    const [regex, setRegex] = useState('([A-Z])\\w+')
    const [flags, setFlags] = useState('g')
    const [text, setText] = useState('Hello World, this is a Vibe Check.')
    const [mode, setMode] = useState('match') // 'match' | 'replace'
    const [replaceWith, setReplaceWith] = useState('[$1]')
    const [showCheatSheet, setShowCheatSheet] = useState(false)
    const [copied, setCopied] = useState(false)

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

    // Replace result
    const replaceResult = useMemo(() => {
        if (!regex || mode !== 'replace') return null
        try {
            const re = new RegExp(regex, flags)
            return text.replace(re, replaceWith)
        } catch (e) {
            return null
        }
    }, [regex, flags, text, replaceWith, mode])

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

    const handleCopy = (content) => {
        navigator.clipboard.writeText(content)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const insertPattern = (pattern) => {
        setRegex(prev => prev + pattern)
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', gap: 'var(--space-lg)' }}>
            {/* Main Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                    <h2 className="text-gradient">Regex Tester</h2>
                    <p style={{ color: 'var(--text-muted)' }}>Test, match, and replace with regular expressions.</p>
                </div>

                {/* Mode Toggle */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', gap: 'var(--space-md)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                        <button
                            onClick={() => setMode('match')}
                            style={{
                                padding: '8px 16px',
                                borderRadius: 'var(--radius-sm)',
                                background: mode === 'match' ? 'var(--primary)' : 'transparent',
                                color: mode === 'match' ? '#fff' : 'var(--text-muted)',
                                border: '1px solid',
                                borderColor: mode === 'match' ? 'var(--primary)' : 'var(--border)',
                                cursor: 'pointer'
                            }}
                        >
                            Match
                        </button>
                        <button
                            onClick={() => setMode('replace')}
                            style={{
                                padding: '8px 16px',
                                borderRadius: 'var(--radius-sm)',
                                background: mode === 'replace' ? 'var(--primary)' : 'transparent',
                                color: mode === 'replace' ? '#fff' : 'var(--text-muted)',
                                border: '1px solid',
                                borderColor: mode === 'replace' ? 'var(--primary)' : 'var(--border)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4
                            }}
                        >
                            <Replace size={14} /> Replace
                        </button>
                    </div>

                    <div style={{ flex: 1 }}></div>

                    <button
                        onClick={() => setShowCheatSheet(!showCheatSheet)}
                        style={{
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-sm)',
                            background: showCheatSheet ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                            color: showCheatSheet ? '#a855f7' : 'var(--text-muted)',
                            border: '1px solid',
                            borderColor: showCheatSheet ? '#a855f7' : 'var(--border)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                        }}
                    >
                        <BookOpen size={14} /> Cheat Sheet
                    </button>
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

                {/* Replace Input (only in replace mode) */}
                {mode === 'replace' && (
                    <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                        <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 8, display: 'block' }}>
                            Replace With
                            <span style={{ fontSize: '0.75rem', marginLeft: 8, color: 'var(--text-dim)' }}>
                                (Use $1, $2 for capture groups)
                            </span>
                        </label>
                        <input
                            type="text"
                            value={replaceWith}
                            onChange={e => setReplaceWith(e.target.value)}
                            placeholder="Replacement string..."
                            style={{
                                width: '100%',
                                background: 'var(--bg-app)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-md)',
                                padding: '12px',
                                fontSize: '1rem',
                                color: 'var(--text-main)',
                                fontFamily: 'var(--font-mono)'
                            }}
                        />
                    </div>
                )}

                {/* Test String & Results */}
                <div className="split-pane">
                    <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                        <div style={{ marginBottom: 8, color: 'var(--text-muted)' }}>Test String</div>
                        <textarea
                            value={text}
                            onChange={e => setText(e.target.value)}
                            style={{
                                width: '100%',
                                height: '200px',
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
                        <div style={{ marginBottom: 8, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            {mode === 'match' ? 'Match Preview' : 'Replace Result'}
                            {mode === 'replace' && replaceResult && (
                                <button
                                    onClick={() => handleCopy(replaceResult)}
                                    style={{
                                        padding: '4px 8px',
                                        background: 'transparent',
                                        border: '1px solid var(--border)',
                                        borderRadius: 4,
                                        color: copied ? '#10b981' : 'var(--text-muted)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        fontSize: '0.8rem'
                                    }}
                                >
                                    {copied ? <Check size={12} /> : <Copy size={12} />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            )}
                        </div>
                        <div
                            style={{
                                width: '100%',
                                height: '200px',
                                background: 'var(--bg-app)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-md)',
                                padding: '12px',
                                color: mode === 'replace' ? '#a5b4fc' : 'var(--text-main)',
                                fontFamily: 'var(--font-mono)',
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                                lineHeight: 1.5
                            }}
                        >
                            {mode === 'match' ? highlightText() : replaceResult}
                        </div>
                    </div>
                </div>

                {/* Match Details */}
                {mode === 'match' && !matches.error && matches.length > 0 && (
                    <div className="glass-panel" style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)' }}>
                        <div style={{ marginBottom: 12, fontWeight: 600 }}>Match Details ({matches.length})</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {matches.slice(0, 20).map((m, i) => (
                                <div key={i} style={{ padding: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <div style={{
                                        minWidth: 24, height: 24, borderRadius: '50%', background: 'var(--primary)', color: '#fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem'
                                    }}>{i + 1}</div>
                                    <div style={{ fontFamily: 'var(--font-mono)', flex: 1, minWidth: '100px' }}>{m.value}</div>
                                    <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Index: {m.index}</div>
                                    {m.groups.length > 0 && (
                                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                            {m.groups.map((g, gi) => (
                                                <span key={gi} style={{ padding: '2px 6px', background: '#333', borderRadius: 4, fontSize: '0.75rem' }}>${gi + 1}: {g}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {matches.length > 20 && (
                                <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center' }}>
                                    ...and {matches.length - 20} more matches
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Cheat Sheet Sidebar */}
            {showCheatSheet && (
                <div className="glass-panel" style={{
                    width: '280px',
                    padding: 'var(--space-md)',
                    maxHeight: 'calc(100vh - 120px)',
                    overflowY: 'auto',
                    position: 'sticky',
                    top: 'var(--space-lg)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                        <h3 style={{ fontSize: '1rem', color: 'var(--text-main)' }}>Regex Cheat Sheet</h3>
                        <button
                            onClick={() => setShowCheatSheet(false)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {CHEAT_SHEET.map((section) => (
                        <div key={section.category} style={{ marginBottom: 'var(--space-md)' }}>
                            <div style={{
                                fontSize: '0.75rem',
                                color: 'var(--primary)',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                marginBottom: 4
                            }}>
                                {section.category}
                            </div>
                            {section.items.map((item) => (
                                <button
                                    key={item.pattern}
                                    onClick={() => insertPattern(item.pattern.replace(/\\/g, '\\'))}
                                    style={{
                                        display: 'flex',
                                        width: '100%',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '6px 8px',
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: 4,
                                        cursor: 'pointer',
                                        color: 'var(--text-main)',
                                        textAlign: 'left',
                                        gap: 8
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <code style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.85rem',
                                        color: '#a855f7',
                                        minWidth: '60px'
                                    }}>
                                        {item.pattern}
                                    </code>
                                    <span style={{
                                        fontSize: '0.75rem',
                                        color: 'var(--text-dim)',
                                        flex: 1
                                    }}>
                                        {item.desc}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
