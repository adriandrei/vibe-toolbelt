import React, { useState, useEffect } from 'react'
import { RefreshCw, Copy, Check, Settings } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// Small dictionary for readable names
const ADJECTIVES = ['Swift', 'Cyber', 'Neon', 'Happy', 'Brave', 'Quiet', 'Misty', 'Cool', 'Hyper', 'Solar', 'Lunar', 'Cosmic', 'Pixel', 'Retro', 'Nano', 'Vibe', 'Flow', 'Lazy', 'Wild', 'Zen']
const NOUNS = ['Ninja', 'Coder', 'Fox', 'Wolf', 'Panda', 'Tiger', 'Dev', 'Bot', 'Ace', 'Star', 'Moon', 'Sun', 'Orbit', 'Wave', 'Pulse', 'Byte', 'Bit', 'Spark', 'Beam', 'Flux']

export default function Username() {
    useDocumentTitle('Username Generator')
    const [mode, setMode] = useState('readable') // 'readable' | 'random'
    const [length, setLength] = useState(8)
    const [count, setCount] = useState(1)
    const [results, setResults] = useState([])
    const [copiedIndex, setCopiedIndex] = useState(null)

    const generate = () => {
        const newResults = []
        for (let i = 0; i < 5; i++) { // Always generate 5 for variety
            if (mode === 'readable') {
                const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
                const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
                const num = Math.floor(Math.random() * 999)
                newResults.push(`${adj}${noun}${num}`)
            } else {
                const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
                let str = ''
                for (let j = 0; j < length; j++) {
                    str += chars.charAt(Math.floor(Math.random() * chars.length))
                }
                newResults.push(str)
            }
        }
        setResults(newResults)
    }

    // Generate on mount or mode change
    useEffect(generate, [mode, length])

    const copyToClipboard = (text, index) => {
        navigator.clipboard.writeText(text)
        setCopiedIndex(index)
        setTimeout(() => setCopiedIndex(null), 2000)
    }

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="glass-panel" style={{ padding: 'var(--space-xl)' }}>
                <h2 className="text-gradient" style={{ fontSize: '1.8rem', marginBottom: 'var(--space-lg)' }}>Username Generator</h2>

                {/* Controls */}
                <div style={{
                    background: 'rgba(0,0,0,0.2)',
                    padding: 'var(--space-lg)',
                    borderRadius: 'var(--radius-lg)',
                    marginBottom: 'var(--space-lg)'
                }}>
                    <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', alignItems: 'center' }}>
                        <label style={{ color: 'var(--text-muted)' }}>Style:</label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                            <button
                                onClick={() => setMode('readable')}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: mode === 'readable' ? 'var(--primary)' : 'transparent',
                                    color: mode === 'readable' ? '#fff' : 'var(--text-muted)',
                                    border: '1px solid',
                                    borderColor: mode === 'readable' ? 'var(--primary)' : 'var(--border)'
                                }}
                            >Readable</button>
                            <button
                                onClick={() => setMode('random')}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: mode === 'random' ? 'var(--primary)' : 'transparent',
                                    color: mode === 'random' ? '#fff' : 'var(--text-muted)',
                                    border: '1px solid',
                                    borderColor: mode === 'random' ? 'var(--primary)' : 'var(--border)'
                                }}
                            >Random</button>
                        </div>
                    </div>

                    {mode === 'random' && (
                        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
                            <label style={{ color: 'var(--text-muted)' }}>Length: {length}</label>
                            <input
                                type="range" min="4" max="24" value={length}
                                onChange={(e) => setLength(e.target.value)}
                                style={{ accentColor: 'var(--primary)' }}
                            />
                        </div>
                    )}
                </div>

                {/* Action */}
                <button
                    onClick={generate}
                    className="glass-panel"
                    style={{
                        width: '100%',
                        padding: 'var(--space-md)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 'var(--space-md)',
                        marginBottom: 'var(--space-lg)',
                        background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
                        border: 'none',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '1rem'
                    }}
                >
                    <RefreshCw size={20} /> Generate New Names
                </button>

                {/* Results List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    {results.map((result, idx) => (
                        <div key={idx} className="glass-panel" style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: 'var(--space-md)',
                            background: 'rgba(255, 255, 255, 0.03)'
                        }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem' }}>{result}</span>
                            <button
                                onClick={() => copyToClipboard(result, idx)}
                                style={{
                                    color: copiedIndex === idx ? 'var(--accent)' : 'var(--text-muted)',
                                    transition: 'color 0.2s',
                                    padding: 'var(--space-xs)'
                                }}
                                title="Copy"
                            >
                                {copiedIndex === idx ? <Check size={20} /> : <Copy size={20} />}
                            </button>
                        </div>
                    ))}
                </div>

            </div>
        </div>
    )
}
