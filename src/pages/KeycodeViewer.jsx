import React, { useState, useEffect } from 'react'
import { Keyboard, Command, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, CornerDownLeft } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function KeycodeViewer() {
    useDocumentTitle('Keycode Viewer')
    const [event, setEvent] = useState(null)
    const [history, setHistory] = useState([])

    useEffect(() => {
        const handleKeyDown = (e) => {
            e.preventDefault()
            const newData = {
                key: e.key,
                code: e.code,
                keyCode: e.keyCode,
                which: e.which,
                location: e.location,
                modifiers: {
                    ctrl: e.ctrlKey,
                    shift: e.shiftKey,
                    alt: e.altKey,
                    meta: e.metaKey
                },
                timestamp: Date.now()
            }
            setEvent(newData)
            setHistory(prev => [newData, ...prev].slice(0, 10))
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    const KeyCard = ({ label, value, highlight }) => (
        <div className="glass-panel" style={{
            padding: 'var(--space-md)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            borderColor: highlight ? 'var(--primary)' : 'var(--border)',
            background: highlight ? 'rgba(var(--primary-rgb), 0.05)' : undefined
        }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>{label}</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: highlight ? 'var(--primary)' : 'var(--text-main)' }}>
                {value === ' ' ? 'Space' : value}
            </span>
        </div>
    )

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', minHeight: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

            {!event ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                    <Keyboard size={64} style={{ marginBottom: 'var(--space-md)' }} />
                    <h2>Press any key on your keyboard</h2>
                </div>
            ) : (
                <>
                    <div style={{ textAlign: 'center', marginBottom: 40, marginTop: 40 }}>
                        <div style={{
                            fontSize: '6rem',
                            fontWeight: 800,
                            color: 'var(--primary)',
                            lineHeight: 1,
                            textShadow: '0 0 20px rgba(var(--primary-rgb), 0.3)'
                        }}>
                            {event.keyCode}
                        </div>
                        <div style={{ fontSize: '2rem', marginTop: 16, color: 'var(--text-main)' }}>
                            {event.key === ' ' ? '(Space)' : event.key}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-md)', width: '100%', marginBottom: 40 }}>
                        <KeyCard label="event.key" value={event.key} />
                        <KeyCard label="event.code" value={event.code} />
                        <KeyCard label="event.which" value={event.which} />
                        <KeyCard label="event.location" value={event.location} />
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 40 }}>
                        {['Ctrl', 'Shift', 'Alt', 'Meta'].map(mod => {
                            const active = event.modifiers[mod.toLowerCase()]
                            return (
                                <div key={mod} style={{
                                    padding: '8px 16px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: active ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                                    color: active ? '#fff' : 'var(--text-dim)',
                                    fontWeight: 600,
                                    transition: 'all 0.1s'
                                }}>
                                    {mod}
                                </div>
                            )
                        })}
                    </div>

                    {/* Simple History */}
                    {history.length > 0 && (
                        <div style={{ width: '100%', opacity: 0.7 }}>
                            <h4 style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>Recent Keys</h4>
                            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10 }}>
                                {history.map((h, i) => (
                                    <div key={h.timestamp + i} className="glass-panel" style={{ padding: '8px 12px', minWidth: 60, textAlign: 'center', fontSize: '0.85rem' }}>
                                        <div style={{ fontWeight: 600, color: i === 0 ? 'var(--primary)' : 'var(--text-main)' }}>{h.key === ' ' ? '␣' : h.key}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{h.keyCode}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
