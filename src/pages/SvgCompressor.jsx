import React, { useState } from 'react'
import { FileCode, Download, Copy, RefreshCw } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function SvgCompressor() {
    useDocumentTitle('SVG Compressor')
    const [input, setInput] = useState('')
    const [output, setOutput] = useState('')
    const [stats, setStats] = useState(null)

    const compress = () => {
        if (!input) return

        let result = input
            // Remove newlines and tabs
            .replace(/[\n\t]/g, '')
            // Remove comments
            .replace(/<!--[\s\S]*?-->/g, '')
            // Remove extra spaces between attributes
            .replace(/\s+/g, ' ')
            // Remove space around tags
            .replace(/>\s+</g, '><')
            // Remove unnecessary spaces around symbols
            .replace(/\s*([=,:])\s*/g, '$1')
            // Simplify floats (optional, can be risky if too aggressive)
            // .replace(/(\d+\.\d{3})\d+/g, '$1') 
            .trim()

        setOutput(result)

        const originalSize = new Blob([input]).size
        const newSize = new Blob([result]).size
        const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1)

        setStats({ originalSize, newSize, savings })
    }

    return (
        <div style={{ minHeight: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
                <h2 className="text-gradient">SVG Compressor</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Simple optimizer to remove whitespace, comments, and redundant data.</p>
            </div>

            <div className="split-pane" style={{ flex: 1, minHeight: 0 }}>
                {/* Input */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)', minHeight: '300px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileCode size={16} /> Input SVG</label>
                        <button
                            onClick={compress}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                background: 'var(--primary)', color: '#fff',
                                border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer'
                            }}
                        >
                            <RefreshCw size={14} /> Compress
                        </button>
                    </div>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Paste your <svg> code here..."
                        style={{
                            flex: 1,
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-main)',
                            padding: 'var(--space-sm)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            resize: 'none'
                        }}
                    />
                </div>

                {/* Output */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)', minHeight: '300px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={16} /> Compressed</label>
                        {stats && (
                            <span style={{ fontSize: '0.8rem', color: '#10b981' }}>
                                Saved {stats.savings}% ({stats.originalSize}B → {stats.newSize}B)
                            </span>
                        )}
                        <button
                            onClick={() => navigator.clipboard.writeText(output)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                background: 'transparent', color: 'var(--primary)',
                                border: '1px solid var(--primary)', padding: '4px 12px', borderRadius: 4, cursor: 'pointer'
                            }}
                        >
                            <Copy size={14} /> Copy
                        </button>
                    </div>
                    <textarea
                        value={output}
                        readOnly
                        placeholder="Compressed SVG will appear here..."
                        style={{
                            flex: 1,
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-main)',
                            padding: 'var(--space-sm)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            resize: 'none'
                        }}
                    />
                </div>
            </div>
        </div>
    )
}
