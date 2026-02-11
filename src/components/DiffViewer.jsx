import React, { useMemo } from 'react'
import * as diff from 'diff'
import { FileDiff } from 'lucide-react'

export const DiffViewer = ({ oldText, newText, viewMode = 'unified' }) => {
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

    if (!oldText && !newText) return null

    return (
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
    )
}
