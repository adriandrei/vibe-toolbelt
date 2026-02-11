import React, { useState, useCallback } from 'react'
import { Fingerprint, Copy, Check, RefreshCw, Clock } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// Nano ID generator (no dependency needed – simple crypto.getRandomValues implementation)
const NANO_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'
function nanoid(size = 21, alphabet = NANO_ALPHABET) {
    const bytes = crypto.getRandomValues(new Uint8Array(size))
    let id = ''
    for (let i = 0; i < size; i++) {
        id += alphabet[bytes[i] % alphabet.length]
    }
    return id
}

// ULID generator
const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford's Base32
function ulid() {
    const now = Date.now()
    // 10-char timestamp (48-bit ms since epoch)
    let ts = ''
    let t = now
    for (let i = 9; i >= 0; i--) {
        ts = ULID_ENCODING[t % 32] + ts
        t = Math.floor(t / 32)
    }
    // 16-char random
    const bytes = crypto.getRandomValues(new Uint8Array(10))
    let rand = ''
    for (let i = 0; i < 10; i++) {
        rand += ULID_ENCODING[bytes[i] % 32]
    }
    return ts + rand
}

// CUID-like (simplified)
let cuidCounter = 0
function cuid2() {
    cuidCounter++
    const ts = Date.now().toString(36)
    const count = cuidCounter.toString(36)
    const fp = Math.random().toString(36).slice(2, 6)
    const rand = crypto.getRandomValues(new Uint8Array(8))
    let r = ''
    for (let i = 0; i < 8; i++) r += (rand[i] % 36).toString(36)
    return 'c' + ts + count + fp + r
}

const ID_TYPES = [
    {
        id: 'nanoid',
        label: 'Nano ID',
        desc: 'Compact, URL-safe, cryptographically secure unique IDs',
        generate: (size) => nanoid(size),
        defaultSize: 21,
        sizeRange: [4, 64],
        color: '#818cf8'
    },
    {
        id: 'ulid',
        label: 'ULID',
        desc: 'Universally Unique Lexicographically Sortable Identifier',
        generate: () => ulid(),
        defaultSize: 26,
        sizeRange: null,
        color: '#22c55e'
    },
    {
        id: 'cuid',
        label: 'CUID2-like',
        desc: 'Collision-resistant IDs optimized for horizontal scaling',
        generate: () => cuid2(),
        defaultSize: null,
        sizeRange: null,
        color: '#f59e0b'
    },
    {
        id: 'custom',
        label: 'Custom Nano ID',
        desc: 'Nano ID with custom alphabet',
        generate: (size, alphabet) => nanoid(size, alphabet),
        defaultSize: 21,
        sizeRange: [4, 64],
        color: '#ec4899'
    },
]

const ALPHABETS = [
    { label: 'Default', value: NANO_ALPHABET },
    { label: 'Alphanumeric', value: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
    { label: 'Lowercase', value: 'abcdefghijklmnopqrstuvwxyz' },
    { label: 'Numbers', value: '0123456789' },
    { label: 'Hex', value: '0123456789abcdef' },
    { label: 'No Look-alikes', value: '2346789ABCDEFGHJKMNPQRTUVWXYZabcdefghjkmnpqrtuvwxyz' },
]

export default function NanoId() {
    useDocumentTitle('Nano ID / ULID Generator')
    const [activeType, setActiveType] = useState('nanoid')
    const [count, setCount] = useState(10)
    const [size, setSize] = useState(21)
    const [alphabet, setAlphabet] = useState(NANO_ALPHABET)
    const [ids, setIds] = useState([])
    const [copied, setCopied] = useState(false)
    const [genTime, setGenTime] = useState(null)

    const generate = useCallback(() => {
        const type = ID_TYPES.find(t => t.id === activeType)
        const start = performance.now()
        const newIds = Array.from({ length: count }, () => {
            if (activeType === 'custom') return type.generate(size, alphabet)
            if (activeType === 'nanoid') return type.generate(size)
            return type.generate()
        })
        setGenTime((performance.now() - start).toFixed(2))
        setIds(newIds)
    }, [activeType, count, size, alphabet])

    React.useEffect(() => { generate() }, [generate])

    const copyAll = () => {
        navigator.clipboard.writeText(ids.join('\n'))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const activeConfig = ID_TYPES.find(t => t.id === activeType)

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>ID Generator</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Generate Nano IDs, ULIDs, and custom unique identifiers
                </p>
            </div>

            {/* Type Selector */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-sm)' }}>
                    {ID_TYPES.map(t => (
                        <button key={t.id} onClick={() => setActiveType(t.id)} style={{
                            padding: '12px', borderRadius: 'var(--radius-md)',
                            background: activeType === t.id ? `${t.color}15` : 'rgba(255,255,255,0.03)',
                            border: activeType === t.id ? `1px solid ${t.color}` : '1px solid var(--border)',
                            color: activeType === t.id ? t.color : 'var(--text-muted)',
                            cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s'
                        }}>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{t.label}</div>
                            <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: 4 }}>{t.desc}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Config */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{
                    display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', flexWrap: 'wrap',
                    background: 'rgba(0,0,0,0.2)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)'
                }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Quantity</label>
                            <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>{count}</span>
                        </div>
                        <input type="range" min={1} max={100} value={count}
                            onChange={e => setCount(+e.target.value)}
                            style={{ width: '100%', accentColor: activeConfig.color }}
                        />
                    </div>

                    {activeConfig.sizeRange && (
                        <div style={{ flex: 1, minWidth: 140 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Length</label>
                                <span style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>{size}</span>
                            </div>
                            <input type="range" min={activeConfig.sizeRange[0]} max={activeConfig.sizeRange[1]} value={size}
                                onChange={e => setSize(+e.target.value)}
                                style={{ width: '100%', accentColor: activeConfig.color }}
                            />
                        </div>
                    )}

                    <button onClick={generate} title="Regenerate" style={{
                        padding: '10px', background: `${activeConfig.color}22`, borderRadius: 'var(--radius-md)',
                        color: activeConfig.color, border: `1px solid ${activeConfig.color}44`
                    }}>
                        <RefreshCw size={20} />
                    </button>
                </div>

                {/* Custom alphabet */}
                {activeType === 'custom' && (
                    <div style={{ marginTop: 'var(--space-md)' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-sm)' }}>
                            Alphabet
                        </label>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                            {ALPHABETS.map(a => (
                                <button key={a.label} onClick={() => setAlphabet(a.value)} style={{
                                    padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem',
                                    background: alphabet === a.value ? `${activeConfig.color}22` : 'rgba(255,255,255,0.03)',
                                    border: alphabet === a.value ? `1px solid ${activeConfig.color}` : '1px solid var(--border)',
                                    color: alphabet === a.value ? activeConfig.color : 'var(--text-muted)',
                                    cursor: 'pointer'
                                }}>
                                    {a.label}
                                </button>
                            ))}
                        </div>
                        <input type="text" value={alphabet} onChange={e => setAlphabet(e.target.value)}
                            style={{ width: '100%', padding: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                        />
                    </div>
                )}
            </div>

            {/* Output */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Generated IDs</span>
                        {genTime && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                                <Clock size={10} /> {genTime}ms
                            </span>
                        )}
                    </div>
                    <button onClick={copyAll} style={{
                        padding: '6px 14px', borderRadius: 'var(--radius-sm)',
                        background: copied ? 'var(--accent)' : activeConfig.color, color: '#fff',
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 500,
                        boxShadow: `0 2px 8px ${activeConfig.color}33`
                    }}>
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copied!' : 'Copy All'}
                    </button>
                </div>
                <textarea
                    readOnly
                    value={ids.join('\n')}
                    style={{
                        width: '100%', minHeight: '300px', fontFamily: 'var(--font-mono)', fontSize: '0.9rem',
                        background: 'rgba(0,0,0,0.15)', border: 'none', resize: 'none', cursor: 'default',
                        padding: 'var(--space-md)', borderRadius: 'var(--radius-sm)'
                    }}
                />
            </div>
        </div>
    )
}
