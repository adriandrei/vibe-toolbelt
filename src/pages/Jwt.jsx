import React, { useState, useEffect } from 'react'
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const decodePart = (part) => {
    try {
        const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(decoded)
    } catch (e) {
        return null
    }
}

export default function Jwt() {
    useDocumentTitle('JWT Decoder')
    const [token, setToken] = useState('')
    const [decoded, setDecoded] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!token) {
            setDecoded(null)
            setError(null)
            return
        }

        const parts = token.split('.')
        if (parts.length !== 3) {
            setError('Invalid JWT format (must have 3 parts)')
            setDecoded(null)
            return
        }

        const header = decodePart(parts[0])
        const payload = decodePart(parts[1])
        const signature = parts[2]

        if (!header || !payload) {
            setError('Failed to decode Base64Url components')
            setDecoded(null)
            return
        }

        setError(null)
        setDecoded({ header, payload, signature })
    }, [token])

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div className="glass-panel" style={{ padding: 'var(--space-xl)' }}>
                <h2 className="text-gradient" style={{ fontSize: '1.8rem', marginBottom: 'var(--space-lg)' }}>JWT Decoder</h2>

                {/* Input */}
                <div style={{ marginBottom: 'var(--space-xl)' }}>
                    <label style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-sm)' }}>
                        Paste JWT Token
                    </label>
                    <textarea
                        value={token}
                        onChange={(e) => setToken(e.target.value.trim())}
                        placeholder="eyJh..."
                        style={{
                            fontFamily: 'var(--font-mono)',
                            minHeight: '100px',
                            color: error ? 'var(--accent)' : 'var(--text-main)',
                            borderColor: error ? 'var(--accent)' : 'var(--border)'
                        }}
                    />
                    {error && (
                        <div style={{ color: 'var(--accent)', marginTop: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ShieldAlert size={16} /> {error}
                        </div>
                    )}
                </div>

                {/* Results */}
                {decoded ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-lg)' }}>
                        {/* Header */}
                        <div>
                            <h3 style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }}></span>
                                Header
                            </h3>
                            <pre className="glass-panel" style={{
                                padding: 'var(--space-md)',
                                margin: 0,
                                overflowX: 'auto',
                                fontSize: '0.9rem',
                                border: '1px solid rgba(239, 68, 68, 0.2)'
                            }}>
                                {JSON.stringify(decoded.header, null, 2)}
                            </pre>
                        </div>

                        {/* Payload */}
                        <div>
                            <h3 style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#a855f7' }}></span>
                                Payload
                            </h3>
                            <pre className="glass-panel" style={{
                                padding: 'var(--space-md)',
                                margin: 0,
                                overflowX: 'auto',
                                fontSize: '0.9rem',
                                border: '1px solid rgba(168, 85, 247, 0.2)'
                            }}>
                                {JSON.stringify(decoded.payload, null, 2)}
                            </pre>
                        </div>

                        {/* Signature */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <h3 style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#3b82f6' }}></span>
                                Signature
                            </h3>
                            <div className="glass-panel" style={{
                                padding: 'var(--space-md)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.9rem',
                                wordBreak: 'break-all',
                                color: 'var(--text-muted)',
                                border: '1px solid rgba(59, 130, 246, 0.2)'
                            }}>
                                HMACSHA256(
                                <br />&nbsp;&nbsp;base64UrlEncode(header) + "." +
                                <br />&nbsp;&nbsp;base64UrlEncode(payload),
                                <br />&nbsp;&nbsp;your-256-bit-secret
                                <br />)
                            </div>
                        </div>
                    </div>
                ) : (
                    !error && !token && (
                        <div style={{
                            padding: 'var(--space-xl)',
                            textAlign: 'center',
                            color: 'var(--text-dim)',
                            border: '2px dashed var(--border)',
                            borderRadius: 'var(--radius-lg)'
                        }}>
                            <ShieldCheck size={48} style={{ opacity: 0.2, marginBottom: 'var(--space-md)' }} />
                            <p>Enter a JWT to see its details.</p>
                        </div>
                    )
                )}
            </div>
        </div>
    )
}
