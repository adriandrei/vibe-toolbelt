import React, { useState, useEffect } from 'react'
import { Shield, ShieldAlert, ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Password() {
    useDocumentTitle('Password Strength')
    const [password, setPassword] = useState('')
    const [show, setShow] = useState(false)
    const [zxcvbn, setZxcvbn] = useState(null)
    const [isLoading, setIsLoading] = useState(false)

    // Dynamically load zxcvbn only when user starts typing
    useEffect(() => {
        if (password && !zxcvbn && !isLoading) {
            setIsLoading(true)
            import('zxcvbn').then(module => {
                setZxcvbn(() => module.default)
                setIsLoading(false)
            })
        }
    }, [password, zxcvbn, isLoading])

    const result = zxcvbn && password ? zxcvbn(password) : null
    const score = result ? result.score : 0 // 0-4

    const getColor = (s) => {
        if (s === 0) return '#ef4444'
        if (s === 1) return '#f97316'
        if (s === 2) return '#eab308'
        if (s === 3) return '#84cc16'
        return '#10b981'
    }

    const getLabel = (s) => {
        if (!password) return 'Enter Password'
        if (isLoading) return 'Analyzing...'
        return ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'][s]
    }

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Password Auditor</h2>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                <div style={{ position: 'relative', marginBottom: 'var(--space-lg)' }}>
                    <input
                        type={show ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Type a password..."
                        style={{
                            width: '100%',
                            paddingRight: '40px',
                            fontSize: '1.2rem',
                            textAlign: 'center'
                        }}
                    />
                    <button
                        onClick={() => setShow(!show)}
                        style={{
                            position: 'absolute',
                            right: 10,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            color: 'var(--text-muted)'
                        }}
                    >
                        {show ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                </div>

                {/* Meter */}
                <div style={{ display: 'flex', gap: 4, height: 8, marginBottom: 'var(--space-md)' }}>
                    {[0, 1, 2, 3, 4].map(i => (
                        <div key={i} style={{
                            flex: 1,
                            background: i <= score && password ? getColor(score) : 'var(--bg-app)',
                            borderRadius: 4,
                            transition: 'all 0.3s'
                        }} />
                    ))}
                </div>

                <div style={{ textAlign: 'center', color: getColor(score), fontWeight: 'bold', fontSize: '1.5rem', marginBottom: 'var(--space-lg)' }}>
                    {getLabel(score)}
                </div>

                {password && (
                    <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                            <span style={{ color: 'var(--text-muted)' }}>Crack Time (Online)</span>
                            <span>{result.crack_times_display.online_no_throttling_10_per_second}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                            <span style={{ color: 'var(--text-muted)' }}>Crack Time (Offline)</span>
                            <span>{result.crack_times_display.offline_slow_hashing_1e4_per_second}</span>
                        </div>

                        {result.feedback.warning && (
                            <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <ShieldAlert size={20} />
                                {result.feedback.warning}
                            </div>
                        )}

                        {result.feedback.suggestions.length > 0 && (
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                <strong>Suggestions:</strong>
                                <ul style={{ paddingLeft: '20px', marginTop: 4 }}>
                                    {result.feedback.suggestions.map(s => <li key={s}>{s}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
