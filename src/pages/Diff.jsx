import React, { useState, useEffect } from 'react'
import * as diff from 'diff'
import { AlertTriangle, Lock, FileDiff } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Diff() {
    useDocumentTitle('Secure Diff')
    const [oldText, setOldText] = useState('')
    const [newText, setNewText] = useState('')
    const [diffResult, setDiffResult] = useState([])

    useEffect(() => {
        if (!oldText && !newText) {
            setDiffResult([])
            return
        }
        const computedDiff = diff.diffLines(oldText, newText)
        setDiffResult(computedDiff)
    }, [oldText, newText])

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>
                    Secure Text Diff
                </h2>
                <div className="flex-center" style={{ gap: 'var(--space-sm)', color: 'var(--text-muted)' }}>
                    <Lock size={16} color="#10b981" />
                    <span style={{ fontSize: '0.9rem' }}>
                        Comparison runs entirely in your browser. No data leaves this device.
                    </span>
                </div>
            </div>

            <div className="split-pane" style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)' }}>Original Text</label>
                    <textarea
                        value={oldText}
                        onChange={(e) => setOldText(e.target.value)}
                        placeholder="Paste original code/text..."
                        style={{ minHeight: '300px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', resize: 'vertical' }}
                    />
                </div>
                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)' }}>New Text</label>
                    <textarea
                        value={newText}
                        onChange={(e) => setNewText(e.target.value)}
                        placeholder="Paste new code/text..."
                        style={{ minHeight: '300px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', resize: 'vertical' }}
                    />
                </div>
            </div>

            {diffResult.length > 0 && (
                <div className="glass-panel" style={{ padding: 'var(--space-lg)', overflowX: 'auto' }}>
                    <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileDiff size={20} color="var(--primary)" /> Comparison Result
                    </h3>
                    <pre style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.9rem',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.5
                    }}>
                        {diffResult.map((part, index) => {
                            const color = part.added ? '#10b981' : part.removed ? '#ef4444' : 'inherit'
                            const bg = part.added ? 'rgba(16, 185, 129, 0.1)' : part.removed ? 'rgba(239, 68, 68, 0.1)' : 'transparent'
                            const prefix = part.added ? '+ ' : part.removed ? '- ' : '  '

                            return (
                                <div key={index} style={{ color, backgroundColor: bg, padding: '0 4px' }}>
                                    {part.value}
                                </div>
                            )
                        })}
                    </pre>
                </div>
            )}
        </div>
    )
}
