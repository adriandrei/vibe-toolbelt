import React, { useState, useMemo } from 'react'
import { Type, AlignLeft, Hash, Clock, Trash2 } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'

export default function TextStats() {
    useDocumentTitle('Text Statistics')
    const [text, setText] = useState('')

    const stats = useMemo(() => {
        if (!text) return null

        const chars = text.length
        const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length
        const sentences = text.split(/[.!?]+/).filter(x => x.trim().length > 0).length
        const paragraphs = text.split(/\n+/).filter(x => x.trim().length > 0).length
        const lines = text.split(/\n/).length
        const spaces = text.split(' ').length - 1

        // Reading time: ~225 wpm
        const readTimeMin = Math.ceil(words / 225)
        const speakTimeMin = Math.ceil(words / 130) // ~130 wpm speaking

        // Byte size (UTF-8)
        const bytes = new Blob([text]).size

        // Character frequency (top 5)
        const charFreq = {}
        for (let char of text.replace(/\s/g, '')) {
            charFreq[char] = (charFreq[char] || 0) + 1
        }
        const topChars = Object.entries(charFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)

        // Word frequency (simple, top 5)
        const wordFreq = {}
        const cleanWords = text.toLowerCase().match(/\b\w+\b/g) || []
        for (let w of cleanWords) {
            if (w.length > 3) { // Skip short words
                wordFreq[w] = (wordFreq[w] || 0) + 1
            }
        }
        const topWords = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)

        return { chars, words, sentences, paragraphs, lines, spaces, bytes, readTimeMin, speakTimeMin, topChars, topWords }
    }, [text])

    const statCard = (icon, label, value, sub = '') => (
        <div className="glass-panel" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <div style={{ padding: 10, borderRadius: '50%', background: 'var(--primary-glow)', color: 'var(--primary)' }}>
                {icon}
            </div>
            <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{label}</div>
                {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{sub}</div>}
            </div>
        </div>
    )

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Text Analyztics</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Detailed statistics, reading time, and frequency analysis
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-lg)' }}>

                {/* Input Area */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)' }}>Input Text</label>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <PipelineRead onRead={setText} />
                            {text && (
                                <button onClick={() => setText('')} style={{ color: 'var(--text-dim)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer' }}>
                                    <Trash2 size={12} /> Clear
                                </button>
                            )}
                        </div>
                    </div>
                    <textarea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder="Paste text here to analyze..."
                        style={{
                            width: '100%', minHeight: '400px', flex: 1, resize: 'vertical',
                            padding: '16px', borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)',
                            color: 'var(--text-main)', fontSize: '1rem', lineHeight: 1.6
                        }}
                    />
                </div>

                {/* Stats Panel */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {stats ? (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-xs)' }}>
                                <PipelineSend dataToSend={JSON.stringify(stats, null, 2)} />
                            </div>
                            {statCard(<Type size={20} />, 'Words', stats.words)}
                            {statCard(<Hash size={20} />, 'Characters', stats.chars, `${stats.bytes} bytes`)}
                            {statCard(<AlignLeft size={20} />, 'Lines', stats.lines, `${stats.paragraphs} paragraphs`)}
                            {statCard(<Clock size={20} />, 'Reading Time', `${stats.readTimeMin} min`, `${stats.speakTimeMin} min to speak`)}

                            {/* Frequencies */}
                            <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 'var(--space-md)', color: 'var(--text-muted)' }}>Top Words (&gt;3 chars)</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {stats.topWords.length > 0 ? stats.topWords.map(([w, c]) => (
                                        <div key={w} style={{
                                            padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                                            background: 'rgba(255,255,255,0.05)', fontSize: '0.85rem',
                                            display: 'flex', gap: 6
                                        }}>
                                            <span style={{ color: 'var(--text-main)' }}>{w}</span>
                                            <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{c}</span>
                                        </div>
                                    )) : <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>No data</span>}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div style={{
                            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--text-dim)', textAlign: 'center', padding: 'var(--space-lg)',
                            border: '2px dashed var(--border)', borderRadius: 'var(--radius-lg)'
                        }}>
                            Enter text to view statistics
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
