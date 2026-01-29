import React, { useState, useEffect, useMemo } from 'react'
import * as diff from 'diff'
import { Lock, FileDiff, LayoutPanelLeft, AlignJustify, Copy, Check } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Diff() {
    useDocumentTitle('Secure Diff')
    const [oldText, setOldText] = useState('')
    const [newText, setNewText] = useState('')
    const [viewMode, setViewMode] = useState('unified') // 'unified' | 'split'
    const [copied, setCopied] = useState(false)

    // Compute diffs
    const unifiedDiff = useMemo(() => {
        if (!oldText && !newText) return []
        return diff.diffLines(oldText, newText)
    }, [oldText, newText])

    const splitDiff = useMemo(() => {
        if (!oldText && !newText) return { left: [], right: [] }

        const changes = diff.diffLines(oldText, newText)
        const left = []
        const right = []

        changes.forEach((part) => {
            const lines = part.value.split('\n').filter((_, i, arr) => i < arr.length - 1 || part.value.slice(-1) !== '\n' || i === arr.length - 1)

            if (part.added) {
                // Added lines go to right side with placeholder on left
                lines.forEach((line, i) => {
                    if (line !== '' || i < lines.length - 1) {
                        left.push({ type: 'placeholder', value: '' })
                        right.push({ type: 'added', value: line })
                    }
                })
            } else if (part.removed) {
                // Removed lines go to left side with placeholder on right
                lines.forEach((line, i) => {
                    if (line !== '' || i < lines.length - 1) {
                        left.push({ type: 'removed', value: line })
                        right.push({ type: 'placeholder', value: '' })
                    }
                })
            } else {
                // Unchanged lines go to both sides
                lines.forEach((line, i) => {
                    if (line !== '' || i < lines.length - 1) {
                        left.push({ type: 'unchanged', value: line })
                        right.push({ type: 'unchanged', value: line })
                    }
                })
            }
        })

        return { left, right }
    }, [oldText, newText])

    // Stats
    const stats = useMemo(() => {
        let added = 0, removed = 0
        unifiedDiff.forEach(part => {
            if (part.added) added += part.value.split('\n').length - 1
            if (part.removed) removed += part.value.split('\n').length - 1
        })
        return { added, removed }
    }, [unifiedDiff])

    const handleCopyPatch = () => {
        const patch = diff.createPatch('file', oldText, newText)
        navigator.clipboard.writeText(patch)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
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

            {/* Controls */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', gap: 'var(--space-md)', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                    <button
                        onClick={() => setViewMode('unified')}
                        style={{
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-sm)',
                            background: viewMode === 'unified' ? 'var(--primary)' : 'transparent',
                            color: viewMode === 'unified' ? '#fff' : 'var(--text-muted)',
                            border: '1px solid',
                            borderColor: viewMode === 'unified' ? 'var(--primary)' : 'var(--border)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                        }}
                    >
                        <AlignJustify size={14} /> Unified
                    </button>
                    <button
                        onClick={() => setViewMode('split')}
                        style={{
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-sm)',
                            background: viewMode === 'split' ? 'var(--primary)' : 'transparent',
                            color: viewMode === 'split' ? '#fff' : 'var(--text-muted)',
                            border: '1px solid',
                            borderColor: viewMode === 'split' ? 'var(--primary)' : 'var(--border)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                        }}
                    >
                        <LayoutPanelLeft size={14} /> Side-by-Side
                    </button>
                </div>

                <div style={{ flex: 1 }}></div>

                {(oldText || newText) && (
                    <>
                        <div style={{ display: 'flex', gap: 'var(--space-md)', fontSize: '0.85rem' }}>
                            <span style={{ color: '#10b981' }}>+{stats.added} added</span>
                            <span style={{ color: '#ef4444' }}>-{stats.removed} removed</span>
                        </div>
                        <button
                            onClick={handleCopyPatch}
                            style={{
                                padding: '8px 12px',
                                borderRadius: 'var(--radius-sm)',
                                background: 'transparent',
                                color: copied ? '#10b981' : 'var(--text-muted)',
                                border: '1px solid var(--border)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: '0.85rem'
                            }}
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? 'Copied!' : 'Copy Patch'}
                        </button>
                    </>
                )}
            </div>

            {/* Input Areas */}
            <div className="split-pane" style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)' }}>Original Text</label>
                    <textarea
                        value={oldText}
                        onChange={(e) => setOldText(e.target.value)}
                        placeholder="Paste original code/text..."
                        style={{ minHeight: '200px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', resize: 'vertical' }}
                    />
                </div>
                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)' }}>New Text</label>
                    <textarea
                        value={newText}
                        onChange={(e) => setNewText(e.target.value)}
                        placeholder="Paste new code/text..."
                        style={{ minHeight: '200px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', resize: 'vertical' }}
                    />
                </div>
            </div>

            {/* Diff Result */}
            {unifiedDiff.length > 0 && (
                <div className="glass-panel" style={{ padding: 'var(--space-lg)', overflowX: 'auto' }}>
                    <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileDiff size={20} color="var(--primary)" /> Comparison Result
                    </h3>

                    {viewMode === 'unified' ? (
                        /* Unified View */
                        <pre style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            lineHeight: 1.6,
                            margin: 0
                        }}>
                            {unifiedDiff.map((part, index) => {
                                const color = part.added ? '#10b981' : part.removed ? '#ef4444' : 'inherit'
                                const bg = part.added ? 'rgba(16, 185, 129, 0.1)' : part.removed ? 'rgba(239, 68, 68, 0.1)' : 'transparent'
                                const prefix = part.added ? '+ ' : part.removed ? '- ' : '  '

                                return (
                                    <div key={index} style={{ color, backgroundColor: bg }}>
                                        {part.value.split('\n').map((line, li, arr) => (
                                            li < arr.length - 1 || line ? (
                                                <div key={li} style={{ padding: '0 8px' }}>
                                                    <span style={{ color: 'var(--text-dim)', userSelect: 'none', marginRight: 8 }}>{prefix}</span>
                                                    {line}
                                                </div>
                                            ) : null
                                        ))}
                                    </div>
                                )
                            })}
                        </pre>
                    ) : (
                        /* Side-by-Side View */
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                            {/* Headers */}
                            <div style={{
                                padding: '8px 12px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                fontWeight: 600,
                                fontSize: '0.85rem',
                                borderRadius: 'var(--radius-sm) 0 0 0'
                            }}>
                                Original
                            </div>
                            <div style={{
                                padding: '8px 12px',
                                background: 'rgba(16, 185, 129, 0.1)',
                                fontWeight: 600,
                                fontSize: '0.85rem',
                                borderRadius: '0 var(--radius-sm) 0 0'
                            }}>
                                New
                            </div>

                            {/* Content */}
                            <div style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.85rem',
                                lineHeight: 1.6,
                                borderRight: '1px solid var(--border)'
                            }}>
                                {splitDiff.left.map((line, i) => (
                                    <div
                                        key={i}
                                        style={{
                                            padding: '2px 8px',
                                            minHeight: '1.6em',
                                            background: line.type === 'removed'
                                                ? 'rgba(239, 68, 68, 0.15)'
                                                : line.type === 'placeholder'
                                                    ? 'rgba(255,255,255,0.02)'
                                                    : 'transparent',
                                            color: line.type === 'removed' ? '#ef4444' : 'inherit'
                                        }}
                                    >
                                        {line.type !== 'placeholder' && (
                                            <>
                                                <span style={{ color: 'var(--text-dim)', userSelect: 'none', marginRight: 8 }}>
                                                    {line.type === 'removed' ? '-' : ' '}
                                                </span>
                                                {line.value}
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.85rem',
                                lineHeight: 1.6
                            }}>
                                {splitDiff.right.map((line, i) => (
                                    <div
                                        key={i}
                                        style={{
                                            padding: '2px 8px',
                                            minHeight: '1.6em',
                                            background: line.type === 'added'
                                                ? 'rgba(16, 185, 129, 0.15)'
                                                : line.type === 'placeholder'
                                                    ? 'rgba(255,255,255,0.02)'
                                                    : 'transparent',
                                            color: line.type === 'added' ? '#10b981' : 'inherit'
                                        }}
                                    >
                                        {line.type !== 'placeholder' && (
                                            <>
                                                <span style={{ color: 'var(--text-dim)', userSelect: 'none', marginRight: 8 }}>
                                                    {line.type === 'added' ? '+' : ' '}
                                                </span>
                                                {line.value}
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
