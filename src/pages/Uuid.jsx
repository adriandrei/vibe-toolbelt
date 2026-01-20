import React, { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Copy, RefreshCw, Check, Fingerprint } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Uuid() {
    useDocumentTitle('UUID Generator')
    const [count, setCount] = useState(5)
    const [uuids, setUuids] = useState([])
    const [copied, setCopied] = useState(false)

    const generate = () => {
        const newUuids = Array.from({ length: count }, () => uuidv4())
        setUuids(newUuids)
    }

    // Generate on mount or count change
    React.useEffect(generate, [count])

    const copyAll = () => {
        navigator.clipboard.writeText(uuids.join('\n'))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div className="glass-panel" style={{ padding: 'var(--space-xl)' }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
                    <div>
                        <h2 className="text-gradient" style={{ fontSize: '1.8rem' }}>Bulk UUID Generator</h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Generate version 4 (random) UUIDs</p>
                    </div>
                    <Fingerprint size={32} color="var(--primary)" style={{ opacity: 0.5 }} />
                </div>

                <div style={{
                    display: 'flex',
                    gap: 'var(--space-md)',
                    alignItems: 'center',
                    marginBottom: 'var(--space-lg)',
                    background: 'rgba(0,0,0,0.2)',
                    padding: 'var(--space-md)',
                    borderRadius: 'var(--radius-md)'
                }}>
                    <div style={{ flexGrow: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                            <label>Quantity: {count}</label>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max="50"
                            value={count}
                            onChange={(e) => setCount(Number(e.target.value))}
                            style={{ accentColor: 'var(--primary)' }}
                        />
                    </div>

                    <button
                        onClick={generate}
                        title="Regenerate"
                        style={{
                            padding: 'var(--space-sm)',
                            background: 'var(--primary-glow)',
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--primary)'
                        }}
                    >
                        <RefreshCw size={20} />
                    </button>
                </div>

                <div className="glass-panel" style={{
                    background: 'rgba(0,0,0,0.3)',
                    marginBottom: 'var(--space-md)',
                    position: 'relative'
                }}>
                    <textarea
                        readOnly
                        value={uuids.join('\n')}
                        style={{
                            minHeight: '300px',
                            fontFamily: 'var(--font-mono)',
                            border: 'none',
                            background: 'transparent',
                            resize: 'none'
                        }}
                    />
                    <button
                        onClick={copyAll}
                        style={{
                            position: 'absolute',
                            top: 'var(--space-sm)',
                            right: 'var(--space-sm)',
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-sm)',
                            background: copied ? 'var(--accent)' : 'var(--primary)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: '0.85rem',
                            fontWeight: 500,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                        }}
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? 'Copied!' : 'Copy All'}
                    </button>
                </div>

            </div>
        </div>
    )
}
