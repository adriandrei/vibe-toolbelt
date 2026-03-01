import React, { useState, useMemo } from 'react'
import { Sparkles, Copy, Check, ArrowRight, FileText, Hash, Lock, Globe, Code, Braces, Key, Binary, AlertCircle, Zap, Database } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Link } from 'react-router-dom'

// Detection patterns
const PATTERNS = {
    jwt: /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    base64: /^[A-Za-z0-9+/]+={0,2}$/,
    base64url: /^[A-Za-z0-9_-]+={0,2}$/,
    hex: /^(0x)?[0-9a-fA-F]+$/,
    url: /^https?:\/\/[^\s]+$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
    ipv6: /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/i,
    mac: /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/,
    iso8601: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/,
    unixTimestamp: /^\d{10,13}$/,
    semver: /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/,
    color: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    cron: /^[*0-9,/-]+\s+[*0-9,/-]+\s+[*0-9,/-]+\s+[*0-9,/-]+\s+[*0-9,/-]+$/,
    cidr: /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
    xml: /^<([a-zA-Z0-9]+)[^>]*>[\s\S]*<\/\1>$/,
    sql: /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\s+/i
}

// Simple XML Formatter
function formatXml(xml) {
    let formatted = ''
    let pad = 0
    xml.split(/>\s*</).forEach(node => {
        if (node.match(/^\/\w/)) pad = Math.max(0, pad - 1)
        formatted += '  '.repeat(pad) + '<' + node + '>\r\n'
        if (node.match(/^<?\w[^>]*[^\/]$/)) pad += 1
    })
    return formatted.replace(/^<|>\r\n$/g, '') // Cleanup edges
}

// Calculate Shannon entropy
function calculateEntropy(str) {
    if (!str) return 0
    const freq = {}
    for (const char of str) {
        freq[char] = (freq[char] || 0) + 1
    }
    const len = str.length
    let entropy = 0
    for (const char in freq) {
        const p = freq[char] / len
        entropy -= p * Math.log2(p)
    }
    return entropy
}

// Detect all formats
function detectFormats(input) {
    if (!input?.trim()) return []
    const trimmed = input.trim()
    const formats = []

    // JSON
    try {
        JSON.parse(trimmed)
        formats.push({ type: 'json', label: 'JSON', icon: Braces, color: '#22c55e', link: '/formatters', stateParams: { input: trimmed, mode: 'json' } })
    } catch { /* ignore */ }

    // XML
    if (PATTERNS.xml.test(trimmed)) {
        formats.push({ type: 'xml', label: 'XML', icon: Code, color: '#f97316', link: '/formatters', stateParams: { input: trimmed, mode: 'xml' } })
    }

    // SQL
    if (PATTERNS.sql.test(trimmed)) {
        formats.push({ type: 'sql', label: 'SQL Query', icon: Database, color: '#3b82f6', link: '/formatters', stateParams: { input: trimmed, mode: 'sql' } })
    }

    // Hex (only if pure hex and long enough)
    if (formats.length === 0 && trimmed.length >= 32 && PATTERNS.hex.test(trimmed.replace(/^0x/, ''))) {
        formats.push({ type: 'hex', label: 'Hexadecimal', icon: Binary, color: '#ef4444', link: '/hex' })
    }

    // Base64 (only if not already detected as something else and long enough)
    if (formats.length === 0 && trimmed.length > 10 && PATTERNS.base64.test(trimmed)) {
        try {
            atob(trimmed)
            formats.push({ type: 'base64', label: 'Base64 Encoded', icon: Lock, color: '#a855f7', link: '/base64' })
        } catch { /* ignore */ }
    }

    // JWT
    if (PATTERNS.jwt.test(trimmed)) {
        formats.push({ type: 'jwt', label: 'JWT Token', icon: Key, color: '#f59e0b', link: '/jwt', stateParams: { input: trimmed } })
    }

    // UUID
    if (PATTERNS.uuid.test(trimmed)) {
        formats.push({ type: 'uuid', label: 'UUID', icon: Hash, color: '#8b5cf6', link: '/uuid', stateParams: { input: trimmed } })
    }

    // URL
    if (PATTERNS.url.test(trimmed)) {
        formats.push({ type: 'url', label: 'URL', icon: Globe, color: '#3b82f6', link: '/url', stateParams: { input: trimmed } })
    }

    // Email
    if (PATTERNS.email.test(trimmed)) {
        formats.push({ type: 'email', label: 'Email Address', icon: FileText, color: '#06b6d4' })
    }

    // IPv4
    if (PATTERNS.ipv4.test(trimmed)) {
        const parts = trimmed.split('.')
        if (parts.every(p => parseInt(p) <= 255)) {
            formats.push({ type: 'ipv4', label: 'IPv4 Address', icon: Globe, color: '#10b981', link: '/cidr' })
        }
    }

    // IPv6
    if (PATTERNS.ipv6.test(trimmed)) {
        formats.push({ type: 'ipv6', label: 'IPv6 Address', icon: Globe, color: '#10b981', link: '/cidr' })
    }

    // MAC
    if (PATTERNS.mac.test(trimmed)) {
        formats.push({ type: 'mac', label: 'MAC Address', icon: Binary, color: '#64748b' })
    }

    // Unix Timestamp
    if (PATTERNS.unixTimestamp.test(trimmed)) {
        const ts = parseInt(trimmed)
        const date = new Date(ts.toString().length === 10 ? ts * 1000 : ts)
        if (!isNaN(date.getTime())) {
            formats.push({ type: 'timestamp', label: 'Unix Timestamp', icon: FileText, color: '#a855f7', link: '/unix' })
        }
    }

    // ISO 8601
    if (PATTERNS.iso8601.test(trimmed)) {
        formats.push({ type: 'iso8601', label: 'ISO 8601 Date', icon: FileText, color: '#a855f7', link: '/unix' })
    }

    // Semver
    if (PATTERNS.semver.test(trimmed)) {
        formats.push({ type: 'semver', label: 'Semantic Version', icon: Code, color: '#64748b' })
    }

    // Color
    if (PATTERNS.color.test(trimmed)) {
        formats.push({ type: 'color', label: 'Hex Color', icon: Zap, color: trimmed, link: '/gradient', stateParams: { input: trimmed } })
    }

    // Cron
    if (PATTERNS.cron.test(trimmed)) {
        formats.push({ type: 'cron', label: 'Cron Expression', icon: FileText, color: '#f97316', link: '/cron' })
    }

    // CIDR
    if (PATTERNS.cidr.test(trimmed)) {
        formats.push({ type: 'cidr', label: 'CIDR Notation', icon: Globe, color: '#14b8a6', link: '/cidr' })
    }



    return formats
}

// Async hash calculation
async function computeHashes(input) {
    if (!input || typeof crypto.subtle === 'undefined') return null

    const encoder = new TextEncoder()
    const data = encoder.encode(input)

    const [, sha1, sha256, sha512] = await Promise.all([
        // MD5 not available in SubtleCrypto, we'll skip it
        Promise.resolve(null),
        crypto.subtle.digest('SHA-1', data),
        crypto.subtle.digest('SHA-256', data),
        crypto.subtle.digest('SHA-512', data)
    ])

    const toHex = (buffer) => Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0')).join('')

    return {
        sha1: toHex(sha1),
        sha256: toHex(sha256),
        sha512: toHex(sha512)
    }
}

export default function Inspector() {
    useDocumentTitle('Universal Inspector')
    const [input, setInput] = useState('')
    const [hashes, setHashes] = useState(null)
    const [copied, setCopied] = useState(null)
    const [previewCopied, setPreviewCopied] = useState(false)

    // Compute stats
    const stats = useMemo(() => {
        if (!input) return null

        const lines = input.split('\n')
        const words = input.trim().split(/\s+/).filter(Boolean)
        const bytes = new TextEncoder().encode(input).length
        const entropy = calculateEntropy(input)

        // Character frequency (top 10)
        const freq = {}
        for (const char of input) {
            const display = char === '\n' ? '\\n' : char === '\t' ? '\\t' : char === ' ' ? '␣' : char
            freq[display] = (freq[display] || 0) + 1
        }
        const topChars = Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([char, count]) => ({ char, count, percent: ((count / input.length) * 100).toFixed(1) }))

        return {
            chars: input.length,
            bytes,
            lines: lines.length,
            words: words.length,
            entropy: entropy.toFixed(3),
            entropyMax: Math.log2(256).toFixed(3),
            topChars
        }
    }, [input])

    // Detect formats
    const formats = useMemo(() => detectFormats(input), [input])

    // Compute hashes when input changes
    React.useEffect(() => {
        if (input && input.length < 100000) {
            computeHashes(input).then(setHashes)
        } else {
            setHashes(null)
        }
    }, [input])

    // Preview content
    const preview = useMemo(() => {
        if (!input) return null
        const trimmed = input.trim()

        // Unix timestamp
        if (PATTERNS.unixTimestamp.test(trimmed)) {
            const ts = parseInt(trimmed)
            const date = new Date(ts.toString().length === 10 ? ts * 1000 : ts)
            if (!isNaN(date.getTime())) {
                return { type: 'timestamp', content: date.toISOString() + '\n' + date.toLocaleString() }
            }
        }

        // Try JSON formatting
        try {
            const parsed = JSON.parse(trimmed)
            return { type: 'json', content: JSON.stringify(parsed, null, 2) }
        } catch { /* ignore */ }

        // Try XML formatting
        if (PATTERNS.xml.test(trimmed)) {
            try {
                return { type: 'xml', content: formatXml(trimmed) }
            } catch { /* ignore */ }
        }

        // Try Base64 decode
        if (PATTERNS.base64.test(trimmed) && trimmed.length > 10) {
            try {
                const decoded = atob(trimmed)
                // Check if it's printable
                if (/^[\x20-\x7E\n\r\t]+$/.test(decoded)) {
                    return { type: 'base64-decoded', content: decoded }
                }
            } catch { /* ignore */ }
        }

        // JWT decode
        if (PATTERNS.jwt.test(trimmed)) {
            try {
                const parts = trimmed.split('.')
                const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')))
                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
                return {
                    type: 'jwt',
                    content: JSON.stringify({ header, payload }, null, 2)
                }
            } catch { /* ignore */ }
        }

        return null
    }, [input])

    const handleCopy = (value, key) => {
        navigator.clipboard.writeText(value)
        setCopied(key)
        setTimeout(() => setCopied(null), 2000)
    }

    const handlePreviewCopy = () => {
        if (!preview?.content) return
        navigator.clipboard.writeText(preview.content)
        setPreviewCopied(true)
        setTimeout(() => setPreviewCopied(false), 2000)
    }

    const entropyLevel = stats ? (
        parseFloat(stats.entropy) < 3 ? 'low' :
            parseFloat(stats.entropy) < 5 ? 'medium' : 'high'
    ) : null

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <Sparkles size={32} /> Universal Inspector
                </h2>
                <p style={{ color: 'var(--text-muted)' }}>Paste anything. We'll tell you everything about it.</p>
            </div>

            {/* Input */}
            <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Paste any text, token, URL, JSON, timestamp, or encoded data..."
                    style={{
                        width: '100%',
                        minHeight: '150px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.95rem',
                        resize: 'vertical'
                    }}
                    spellCheck="false"
                />
            </div>

            {input && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 'var(--space-md)' }}>

                    {/* Detected Formats */}
                    <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                        <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Zap size={18} color="var(--primary)" /> Detected Format
                        </h3>
                        {formats.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                                {formats.map((format) => (
                                    <div
                                        key={format.type}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            padding: 'var(--space-sm) var(--space-md)',
                                            background: `${format.color}15`,
                                            border: `1px solid ${format.color}40`,
                                            borderRadius: 'var(--radius-md)'
                                        }}
                                    >
                                        <format.icon size={18} style={{ color: format.color }} />
                                        <span style={{ flex: 1, fontWeight: 500 }}>{format.label}</span>
                                        {format.link && (
                                            <Link
                                                to={format.link}
                                                state={format.stateParams || { input: input.trim() }}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                    color: format.color,
                                                    fontSize: '0.85rem',
                                                    textDecoration: 'none'
                                                }}
                                            >
                                                Open Tool <ArrowRight size={14} />
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <AlertCircle size={16} /> No specific format detected
                            </div>
                        )}
                    </div>

                    {/* Statistics */}
                    {stats && (
                        <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                            <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <FileText size={18} color="var(--primary)" /> Statistics
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-sm)' }}>
                                <div style={{ padding: 'var(--space-sm)', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)' }}>
                                    <div style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--primary)' }}>{stats.chars.toLocaleString()}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Characters</div>
                                </div>
                                <div style={{ padding: 'var(--space-sm)', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)' }}>
                                    <div style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--primary)' }}>{stats.bytes.toLocaleString()}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Bytes (UTF-8)</div>
                                </div>
                                <div style={{ padding: 'var(--space-sm)', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)' }}>
                                    <div style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--primary)' }}>{stats.lines.toLocaleString()}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Lines</div>
                                </div>
                                <div style={{ padding: 'var(--space-sm)', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)' }}>
                                    <div style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--primary)' }}>{stats.words.toLocaleString()}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Words</div>
                                </div>
                            </div>

                            {/* Entropy */}
                            <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm)', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Shannon Entropy</span>
                                    <span style={{
                                        fontSize: '0.75rem',
                                        padding: '2px 8px',
                                        borderRadius: 'var(--radius-sm)',
                                        background: entropyLevel === 'high' ? 'rgba(239, 68, 68, 0.2)' :
                                            entropyLevel === 'medium' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                                        color: entropyLevel === 'high' ? '#ef4444' :
                                            entropyLevel === 'medium' ? '#f59e0b' : '#22c55e'
                                    }}>
                                        {entropyLevel === 'high' ? 'High (possibly encrypted/random)' :
                                            entropyLevel === 'medium' ? 'Medium' : 'Low (structured/repetitive)'}
                                    </span>
                                </div>
                                <div style={{
                                    height: 8,
                                    background: 'var(--bg-app)',
                                    borderRadius: 4,
                                    overflow: 'hidden'
                                }}>
                                    <div style={{
                                        width: `${(parseFloat(stats.entropy) / 8) * 100}%`,
                                        height: '100%',
                                        background: entropyLevel === 'high' ? '#ef4444' :
                                            entropyLevel === 'medium' ? '#f59e0b' : '#22c55e',
                                        transition: 'width 0.3s'
                                    }} />
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
                                    {stats.entropy} / 8.000 bits per character
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Hashes */}
                    {hashes && (
                        <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                            <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Hash size={18} color="var(--primary)" /> Hash Values
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                                {[
                                    { name: 'SHA-1', value: hashes.sha1 },
                                    { name: 'SHA-256', value: hashes.sha256 },
                                    { name: 'SHA-512', value: hashes.sha512?.slice(0, 64) + '...' }
                                ].map((hash) => (
                                    <div key={hash.name} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        padding: 'var(--space-xs) var(--space-sm)',
                                        background: 'rgba(255,255,255,0.03)',
                                        borderRadius: 'var(--radius-sm)'
                                    }}>
                                        <span style={{
                                            fontSize: '0.75rem',
                                            color: 'var(--text-dim)',
                                            minWidth: 60
                                        }}>{hash.name}</span>
                                        <code style={{
                                            flex: 1,
                                            fontSize: '0.75rem',
                                            fontFamily: 'var(--font-mono)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>{hash.value}</code>
                                        <button
                                            onClick={() => handleCopy(hash.name === 'SHA-512' ? hashes.sha512 : hash.value, hash.name)}
                                            style={{
                                                padding: 4,
                                                background: 'transparent',
                                                border: 'none',
                                                color: copied === hash.name ? '#22c55e' : 'var(--text-muted)',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {copied === hash.name ? <Check size={14} /> : <Copy size={14} />}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Character Frequency */}
                    {stats && stats.topChars.length > 0 && (
                        <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                            <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Binary size={18} color="var(--primary)" /> Character Frequency
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {stats.topChars.map((item, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <code style={{
                                            width: 24,
                                            textAlign: 'center',
                                            fontFamily: 'var(--font-mono)',
                                            color: 'var(--primary)'
                                        }}>{item.char}</code>
                                        <div style={{
                                            flex: 1,
                                            height: 16,
                                            background: 'var(--bg-app)',
                                            borderRadius: 4,
                                            overflow: 'hidden'
                                        }}>
                                            <div style={{
                                                width: `${parseFloat(item.percent)}%`,
                                                height: '100%',
                                                background: 'linear-gradient(90deg, var(--primary), #a855f7)',
                                                minWidth: 2
                                            }} />
                                        </div>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', minWidth: 50, textAlign: 'right' }}>
                                            {item.count} ({item.percent}%)
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Preview */}
                    {preview && (
                        <div className="glass-panel" style={{ padding: 'var(--space-lg)', gridColumn: '1 / -1', position: 'relative' }}>
                            <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Code size={18} color="var(--primary)" />
                                {preview.type === 'json' && 'Formatted JSON Preview'}
                                {preview.type === 'xml' && 'XML Structure Preview'}
                                {preview.type === 'base64-decoded' && 'Base64 Decoded Preview'}
                                {preview.type === 'jwt' && 'JWT Decoded Preview'}
                                {preview.type === 'timestamp' && 'Timestamp Interpretation'}
                            </h3>
                            <button
                                onClick={handlePreviewCopy}
                                style={{
                                    position: 'absolute',
                                    top: 'var(--space-lg)',
                                    right: 'var(--space-lg)',
                                    padding: '6px 12px',
                                    background: 'var(--bg-app)',
                                    border: '1px solid var(--border)',
                                    color: previewCopied ? '#22c55e' : 'var(--text-muted)',
                                    borderRadius: 'var(--radius-sm)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: '0.8rem'
                                }}
                            >
                                {previewCopied ? <Check size={14} /> : <Copy size={14} />}
                                {previewCopied ? 'Copied' : 'Copy'}
                            </button>
                            <pre style={{
                                padding: 'var(--space-md)',
                                background: 'var(--bg-app)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.85rem',
                                overflow: 'auto',
                                maxHeight: '300px',
                                margin: 0
                            }}>
                                {preview.content}
                            </pre>
                        </div>
                    )}
                </div>
            )}

            {/* Empty state */}
            {!input && (
                <div className="glass-panel" style={{
                    padding: 'var(--space-xl)',
                    textAlign: 'center',
                    color: 'var(--text-dim)'
                }}>
                    <Sparkles size={48} style={{ opacity: 0.2, marginBottom: 'var(--space-md)' }} />
                    <p>Paste any content to analyze it</p>
                    <p style={{ fontSize: '0.85rem', marginTop: 'var(--space-sm)' }}>
                        Supports: JSON, XML, SQL, JWT, UUID, Base64, URLs, IPs, timestamps, colors, cron expressions, and more
                    </p>
                </div>
            )}
        </div>
    )
}
