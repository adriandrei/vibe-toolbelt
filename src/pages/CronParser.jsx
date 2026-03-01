import React, { useState, useEffect } from 'react'
import cronstrue from 'cronstrue'
import { Clock, Info } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSmartInput } from '../hooks/useSmartInput'

export default function CronParser() {
    useDocumentTitle('CRON Parsing')
    const [cron, setCron] = useState('*/5 * * * *')
    const [desc, setDesc] = useState('')
    const [nextDates, setNextDates] = useState([])
    const [error, setError] = useState('')

    useSmartInput({ input: setCron })

    useEffect(() => {
        try {
            const description = cronstrue.toString(cron)
            setDesc(description)
            setError('')

            // Simple next run calculation (cronstrue doesn't do next dates easily without another lib like cron-parser)
            // For now we just show the human readable string which is the main value.
            // If user wants next dates, we'd need 'cron-parser' package.
            // Let's stick to description for now as per "Visualizing cron schedules"
        } catch (e) {
            setDesc('')
            setError('Invalid cron expression')
        }
    }, [cron])

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient">CRON Parser</h2>
                <p style={{ color: 'var(--text-muted)' }}>Translate cron expressions into human-readable descriptions.</p>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-xl)' }}>
                <div style={{ marginBottom: 'var(--space-lg)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-sm)', fontWeight: 500 }}>Cron Expression</label>
                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                        <input
                            type="text"
                            value={cron}
                            onChange={(e) => setCron(e.target.value)}
                            placeholder="*/5 * * * *"
                            style={{
                                flex: 1,
                                padding: '12px',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border)',
                                background: 'var(--bg-app)',
                                color: 'var(--text-main)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '1.2rem'
                            }}
                        />
                    </div>
                    {error && <div style={{ color: '#ef4444', marginTop: 8, fontSize: '0.9rem' }}>{error}</div>}
                </div>

                <div style={{
                    padding: 'var(--space-lg)',
                    background: 'var(--bg-app)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border)',
                    textAlign: 'center',
                    minHeight: '100px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 16
                }}>
                    <Clock size={32} color="var(--primary)" style={{ opacity: 0.8 }} />
                    {desc ? (
                        <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-main)' }}>
                            {desc}
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-muted)' }}>Enter a valid expression</div>
                    )}
                </div>

                <div style={{ marginTop: 'var(--space-xl)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
                    {['*/5 * * * *', '0 0 * * *', '0 12 * * 1-5', '0 0 1 1 *'].map(ex => (
                        <button
                            key={ex}
                            onClick={() => setCron(ex)}
                            style={{
                                padding: '8px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid var(--border)',
                                borderRadius: 6,
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontFamily: 'var(--font-mono)'
                            }}
                        >
                            {ex}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
