import React, { useState, useEffect } from 'react'
import yaml from 'js-yaml'
import { ArrowRightLeft, Copy, Check, Trash2 } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Converter() {
    useDocumentTitle('JSON <> YAML Converter')
    const [left, setLeft] = useState('')
    const [right, setRight] = useState('')
    const [error, setError] = useState(null)

    // Directions: 'json2yaml' or 'yaml2json'
    // But we want it bidirectional. Let's just assume Left is JSON, Right is YAML for simplicity,
    // or auto-detect. Let's do explicit mode.
    const [mode, setMode] = useState('json2yaml')

    useEffect(() => {
        if (!left.trim()) {
            setRight('')
            setError(null)
            return
        }

        try {
            setError(null)
            if (mode === 'json2yaml') {
                const obj = JSON.parse(left)
                setRight(yaml.dump(obj))
            } else {
                const obj = yaml.load(left)
                setRight(JSON.stringify(obj, null, 2))
            }
        } catch (e) {
            setError(e.message)
            // don't clear right, let user fix left
        }
    }, [left, mode])

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>JSON &lt;&gt; YAML</h2>
            </div>

            <div style={{ marginBottom: 'var(--space-md)', textAlign: 'center' }}>
                <button
                    onClick={() => {
                        setMode(prev => prev === 'json2yaml' ? 'yaml2json' : 'json2yaml')
                        setLeft(right) // Swap content
                        setRight(left)
                        setError(null)
                    }}
                    className="glass-panel"
                    style={{
                        padding: '8px 16px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        color: 'var(--primary)',
                        fontWeight: 600,
                        cursor: 'pointer'
                    }}
                >
                    {mode === 'json2yaml' ? 'JSON' : 'YAML'}
                    <ArrowRightLeft size={16} />
                    {mode === 'json2yaml' ? 'YAML' : 'JSON'}
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                {/* Input */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)' }}>{mode === 'json2yaml' ? 'JSON Input' : 'YAML Input'}</label>
                        <button onClick={() => setLeft('')} style={{ color: 'var(--text-muted)' }}><Trash2 size={14} /></button>
                    </div>
                    <textarea
                        value={left}
                        onChange={e => setLeft(e.target.value)}
                        style={{ minHeight: '400px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                        placeholder={mode === 'json2yaml' ? '{"foo": "bar"}' : 'foo: bar'}
                    />
                </div>

                {/* Output */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)' }}>{mode === 'json2yaml' ? 'YAML Output' : 'JSON Output'}</label>
                        <button
                            onClick={() => navigator.clipboard.writeText(right)}
                            style={{ color: 'var(--primary)', display: 'flex', gap: 4, alignItems: 'center' }}
                        >
                            <Copy size={14} /> Copy
                        </button>
                    </div>
                    <textarea
                        readOnly
                        value={right}
                        style={{
                            minHeight: '400px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            borderColor: error ? '#ef4444' : 'var(--border)'
                        }}
                    />
                    {error && (
                        <div style={{
                            position: 'absolute',
                            bottom: 'var(--space-md)',
                            left: 'var(--space-md)',
                            right: 'var(--space-md)',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid #ef4444',
                            color: '#ef4444',
                            padding: '8px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.8rem'
                        }}>
                            {error}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
