import React, { useState, useEffect } from 'react'
import { Copy, Trash2, Check, ArrowRightLeft } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// Unicode safe Encode/Decode
const toBase64 = (str) => {
    try {
        return btoa(String.fromCharCode(...new TextEncoder().encode(str)))
    } catch (e) {
        return 'Error: Use valid text'
    }
}

const fromBase64 = (str) => {
    try {
        return new TextDecoder().decode(Uint8Array.from(atob(str), c => c.charCodeAt(0)))
    } catch (e) {
        return 'Invalid Base64 string'
    }
}

export default function Base64() {
    useDocumentTitle('Base64 Converter')
    const [mode, setMode] = useState('encode') // 'encode' | 'decode'
    const [input, setInput] = useState('')
    const [output, setOutput] = useState('')
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (!input) {
            setOutput('')
            return
        }
        if (mode === 'encode') {
            setOutput(toBase64(input))
        } else {
            setOutput(fromBase64(input))
        }
    }, [input, mode])

    const handleCopy = () => {
        if (!output) return
        navigator.clipboard.writeText(output)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div className="glass-panel" style={{ padding: 'var(--space-xl)' }}>

                {/* Header & Tabs */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
                    <h2 className="text-gradient" style={{ fontSize: '1.8rem' }}>Base64 Converter</h2>

                    <div style={{
                        background: 'var(--bg-app)',
                        padding: '4px',
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        border: '1px solid var(--border)'
                    }}>
                        {['encode', 'decode'].map((m) => (
                            <button
                                key={m}
                                onClick={() => setMode(m)}
                                style={{
                                    padding: 'var(--space-xs) var(--space-md)',
                                    borderRadius: 'var(--radius-sm)',
                                    backgroundColor: mode === m ? 'var(--primary)' : 'transparent',
                                    color: mode === m ? '#fff' : 'var(--text-muted)',
                                    fontWeight: mode === m ? 600 : 400,
                                    textTransform: 'capitalize',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Input */}
                <div style={{ marginBottom: 'var(--space-lg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                        <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            {mode === 'encode' ? 'Text to Encode' : 'Base64 to Decode'}
                        </label>
                        {input && (
                            <button
                                onClick={() => setInput('')}
                                style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                                <Trash2 size={12} /> Clear
                            </button>
                        )}
                    </div>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={mode === 'encode' ? 'Type something here...' : 'Paste Base64 here...'}
                        style={{ minHeight: '150px' }}
                    />
                </div>

                {/* Action Icon (Visual only) */}
                <div className="flex-center" style={{ marginBottom: 'var(--space-lg)', opacity: 0.5 }}>
                    <ArrowRightLeft size={24} color="var(--primary)" />
                </div>

                {/* Output */}
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                        <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Result</label>
                        <button
                            onClick={handleCopy}
                            disabled={!output}
                            style={{
                                color: copied ? 'var(--accent)' : 'var(--primary)',
                                fontSize: '0.9rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                cursor: output ? 'pointer' : 'not-allowed',
                                opacity: output ? 1 : 0.5
                            }}
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? 'Copied!' : 'Copy Result'}
                        </button>
                    </div>
                    <textarea
                        readOnly
                        value={output}
                        placeholder="Result will appear here..."
                        style={{
                            minHeight: '150px',
                            backgroundColor: 'rgba(0,0,0,0.2)',
                            borderColor: copied ? 'var(--accent)' : 'var(--border)'
                        }}
                    />
                </div>

            </div>
        </div>
    )
}
