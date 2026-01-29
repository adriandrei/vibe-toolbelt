import React from 'react'
import { History, Trash2, X, EyeOff, Eye, ExternalLink } from 'lucide-react'
import { useHistory, formatRelativeTime } from '../hooks/useHistory'
import { Link } from 'react-router-dom'

// Tool icon/color mapping
const TOOL_CONFIG = {
    base64: { color: '#a855f7', label: 'Base64' },
    hash: { color: '#3b82f6', label: 'Hash' },
    hmac: { color: '#06b6d4', label: 'HMAC' },
    jwt: { color: '#f59e0b', label: 'JWT' },
    uuid: { color: '#10b981', label: 'UUID' },
    password: { color: '#ef4444', label: 'Password' },
    regex: { color: '#ec4899', label: 'Regex' },
    diff: { color: '#8b5cf6', label: 'Diff' },
    formatters: { color: '#22c55e', label: 'JSON/SQL' },
    converter: { color: '#64748b', label: 'Converter' },
    markdown: { color: '#0ea5e9', label: 'Markdown' },
    default: { color: '#6b7280', label: 'Tool' }
}

export default function HistoryPanel({ isOpen, onClose }) {
    const { history, incognitoMode, clearHistory, removeEntry, toggleIncognito } = useHistory()

    if (!isOpen) return null

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                right: 0,
                bottom: 0,
                width: '360px',
                maxWidth: '100vw',
                background: 'var(--bg-secondary)',
                borderLeft: '1px solid var(--border)',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '-4px 0 20px rgba(0,0,0,0.3)'
            }}
        >
            {/* Header */}
            <div style={{
                padding: 'var(--space-md)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm)'
            }}>
                <History size={20} color="var(--primary)" />
                <h3 style={{ flex: 1, margin: 0, fontSize: '1.1rem' }}>Recent Operations</h3>
                <button
                    onClick={onClose}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: 4
                    }}
                >
                    <X size={20} />
                </button>
            </div>

            {/* Controls */}
            <div style={{
                padding: 'var(--space-sm) var(--space-md)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                gap: 'var(--space-sm)',
                alignItems: 'center'
            }}>
                <button
                    onClick={toggleIncognito}
                    style={{
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-sm)',
                        background: incognitoMode ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                        color: incognitoMode ? '#ef4444' : 'var(--text-muted)',
                        border: `1px solid ${incognitoMode ? '#ef4444' : 'var(--border)'}`,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: '0.85rem'
                    }}
                    title={incognitoMode ? 'Disable incognito mode' : 'Enable incognito mode (no history saved)'}
                >
                    {incognitoMode ? <EyeOff size={14} /> : <Eye size={14} />}
                    {incognitoMode ? 'Incognito ON' : 'Incognito'}
                </button>

                <div style={{ flex: 1 }}></div>

                {history.length > 0 && !incognitoMode && (
                    <button
                        onClick={clearHistory}
                        style={{
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            border: '1px solid var(--border)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: '0.85rem'
                        }}
                    >
                        <Trash2 size={14} /> Clear All
                    </button>
                )}
            </div>

            {/* History List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-sm)' }}>
                {incognitoMode ? (
                    <div style={{
                        textAlign: 'center',
                        padding: 'var(--space-xl)',
                        color: 'var(--text-dim)'
                    }}>
                        <EyeOff size={48} style={{ opacity: 0.3, marginBottom: 'var(--space-md)' }} />
                        <p>Incognito mode is active.</p>
                        <p style={{ fontSize: '0.85rem' }}>No operations are being saved.</p>
                    </div>
                ) : history.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        padding: 'var(--space-xl)',
                        color: 'var(--text-dim)'
                    }}>
                        <History size={48} style={{ opacity: 0.3, marginBottom: 'var(--space-md)' }} />
                        <p>No recent operations.</p>
                        <p style={{ fontSize: '0.85rem' }}>Your activity will appear here.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                        {history.map((entry) => {
                            const config = TOOL_CONFIG[entry.tool] || TOOL_CONFIG.default
                            return (
                                <div
                                    key={entry.id}
                                    style={{
                                        padding: 'var(--space-sm)',
                                        background: 'rgba(255,255,255,0.03)',
                                        borderRadius: 'var(--radius-sm)',
                                        border: '1px solid var(--border)'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <span style={{
                                            padding: '2px 6px',
                                            borderRadius: 4,
                                            background: `${config.color}20`,
                                            color: config.color,
                                            fontSize: '0.75rem',
                                            fontWeight: 600
                                        }}>
                                            {config.label}
                                        </span>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                                            {entry.action}
                                        </span>
                                        <span style={{ flex: 1 }}></span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                                            {formatRelativeTime(entry.timestamp)}
                                        </span>
                                        <button
                                            onClick={() => removeEntry(entry.id)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: 'var(--text-dim)',
                                                cursor: 'pointer',
                                                padding: 2
                                            }}
                                            title="Remove"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                    {entry.inputPreview && (
                                        <div style={{
                                            fontSize: '0.8rem',
                                            color: 'var(--text-muted)',
                                            fontFamily: 'var(--font-mono)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {entry.inputPreview}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div style={{
                padding: 'var(--space-sm) var(--space-md)',
                borderTop: '1px solid var(--border)',
                fontSize: '0.75rem',
                color: 'var(--text-dim)',
                textAlign: 'center'
            }}>
                {incognitoMode
                    ? 'History is disabled in incognito mode'
                    : `${history.length} items stored locally`
                }
            </div>
        </div>
    )
}
