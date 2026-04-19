import React, { useState, useEffect } from 'react'
import { Copy, Trash2, Check, ArrowRightLeft } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSmartInput } from '../hooks/useSmartInput'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'

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

    useSmartInput({ input: setInput })

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
        <div style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            {/* Header & Tabs */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', marginBottom: 'var(--space-md)' }}>
                <h2 className="text-gradient" style={{ fontSize: '1.8rem', marginBottom: 'var(--space-sm)' }}>Base64 Converter</h2>

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

            {/* Split Pane */}
            <div className="split-pane">
                {/* Input */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                        <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            {mode === 'encode' ? 'Text to Encode' : 'Base64 to Decode'}
                        </label>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <PipelineRead onRead={setInput} />
                            {input && (
                                <button
                                    onClick={() => setInput('')}
                                    style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer' }}
                                >
                                    <Trash2 size={12} /> Clear
                                </button>
                            )}
                        </div>
                    </div>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={mode === 'encode' ? 'Type something here...' : 'Paste Base64 here...'}
                        style={{ flex: 1, minHeight: '150px', background: 'rgba(0,0,0,0.2)', resize: 'none' }}
                    />
                </div>

                {/* Output */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                        <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Result</label>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <PipelineSend dataToSend={output} />
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
                                    opacity: output ? 1 : 0.5,
                                    background: 'none',
                                    border: 'none'
                                }}
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                {copied ? 'Copied!' : 'Copy Result'}
                            </button>
                        </div>
                    </div>
                    <textarea
                        readOnly
                        value={output}
                        placeholder="Result will appear here..."
                        style={{
                            flex: 1,
                            minHeight: '150px',
                            backgroundColor: 'rgba(0,0,0,0.2)',
                            borderColor: copied ? 'var(--accent)' : 'var(--border)',
                            resize: 'none'
                        }}
                    />
                </div>
            </div>
        </div>
    )
}
