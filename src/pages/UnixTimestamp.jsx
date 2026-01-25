import React, { useState, useEffect } from 'react'
import { Clock, Copy, RefreshCw, Calendar, Play, Pause } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function UnixTimestamp() {
    useDocumentTitle('Unix Timestamp')
    const [now, setNow] = useState(Date.now())
    const [isPaused, setIsPaused] = useState(false)
    const [input, setInput] = useState('')
    const [error, setError] = useState(null)

    // Ticker
    useEffect(() => {
        if (isPaused) return
        const interval = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(interval)
    }, [isPaused])

    // Derived values from Input OR Now
    let displayDate = new Date(now)
    let isInputMode = false

    if (input) {
        isInputMode = true
        // Try to parse input
        // If it's all digits, assume timestamp
        if (/^\d+$/.test(input)) {
            let ts = parseInt(input)
            // Heuristic: if small (< 10000000000), assume seconds, else ms
            // 10000000000 seconds is year 2286. 
            // 3000000000 ms is year 1970 + a bit. 
            // Better heuristic: year 2000 is 946684800 sec.
            // If < 99999999999, treat as seconds?
            // Actually standard Unix is seconds. JS is ms.
            // Let's just standard check: if < 100000000000 (11 digits), treat as seconds
            if (ts < 100000000000) {
                ts *= 1000
            }
            displayDate = new Date(ts)
        } else {
            // Try date string parsing
            const parsed = Date.parse(input)
            if (!isNaN(parsed)) {
                displayDate = new Date(parsed)
            } else {
                // Invalid
                displayDate = null
            }
        }
    }

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text)
    }

    const FormattedRow = ({ label, value, mono = true }) => (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px',
            borderBottom: '1px solid var(--border)',
            gap: '1rem'
        }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                    fontFamily: mono ? 'var(--font-mono)' : 'inherit',
                    color: 'var(--text-main)',
                    fontSize: '0.95rem',
                    textAlign: 'right'
                }}>
                    {value || '-'}
                </span>
                {value && (
                    <button
                        onClick={() => copyToClipboard(value)}
                        className="action-btn"
                        title="Copy"
                        style={{ padding: 4 }}
                    >
                        <Copy size={14} color="var(--primary)" />
                    </button>
                )}
            </div>
        </div>
    )

    return (
        <div className="container">
            <h1 className="tool-title">
                <Clock className="tool-icon" />
                Unix Timestamp Converter
            </h1>
            <p className="tool-desc">
                Convert between Epoch timestamps and human-readable dates. Auto-detects seconds/milliseconds.
            </p>

            <div className="tool-grid" style={{ gridTemplateColumns: '1fr' }}>
                {/* Current Time Section */}
                <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                        <h3 className="section-title" style={{ margin: 0 }}>
                            {isInputMode ? 'Converted Result' : 'Current Time'}
                        </h3>
                        {!isInputMode && (
                            <button
                                onClick={() => setIsPaused(!isPaused)}
                                style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.85rem', color: isPaused ? 'var(--accent)' : 'var(--text-muted)' }}
                            >
                                {isPaused ? <Play size={16} /> : <Pause size={16} />}
                                {isPaused ? 'Resume' : 'Pause'}
                            </button>
                        )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                        {/* Big Ticker */}
                        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                            <div style={{
                                fontSize: '4rem',
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 700,
                                color: 'var(--primary)',
                                textShadow: '0 0 20px rgba(var(--primary-rgb), 0.3)',
                                lineHeight: 1
                            }}>
                                {displayDate ? Math.floor(displayDate.getTime() / 1000) : 'Invalid Date'}
                            </div>
                            <div style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>SECONDS</div>
                        </div>

                        {/* Input Area */}
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                placeholder="Paste timestamp (sec/ms) or date string here to convert..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                style={{
                                    paddingLeft: '40px',
                                    fontSize: '1.1rem',
                                    height: '50px'
                                }}
                            />
                            <Calendar
                                size={18}
                                style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                            />
                            {input && (
                                <button
                                    onClick={() => setInput('')}
                                    style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                                >
                                    Clear
                                </button>
                            )}
                        </div>

                        {/* Details Table */}
                        {displayDate && (
                            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                <FormattedRow
                                    label="Unix Timestamp (milliseconds)"
                                    value={displayDate.getTime().toString()}
                                />
                                <FormattedRow
                                    label="ISO 8601"
                                    value={displayDate.toISOString()}
                                />
                                <FormattedRow
                                    label="Local Time"
                                    value={displayDate.toLocaleString()}
                                    mono={false}
                                />
                                <FormattedRow
                                    label="UTC Time"
                                    value={displayDate.toUTCString()}
                                    mono={false}
                                />
                                <FormattedRow
                                    label="Relative"
                                    value={getRelativeTime(displayDate)}
                                    mono={false}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

function getRelativeTime(date) {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    const diffSec = Math.round(diffMs / 1000)
    const diffMin = Math.round(diffSec / 60)
    const diffHour = Math.round(diffMin / 60)
    const diffDay = Math.round(diffHour / 24)

    if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second')
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
    if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour')
    return rtf.format(diffDay, 'day')
}
