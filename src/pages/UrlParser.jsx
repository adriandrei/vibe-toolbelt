import React, { useState, useEffect } from 'react'
import { Link2, Copy, AlertCircle } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function UrlParser() {
    useDocumentTitle('URL Parser')
    const [input, setInput] = useState('')
    const [parsed, setParsed] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!input) {
            setParsed(null)
            setError(null)
            return
        }

        try {
            const url = new URL(input)
            const params = {}
            for (const [key, value] of url.searchParams) {
                params[key] = value
            }

            setParsed({
                Protocol: url.protocol,
                Host: url.host,
                Hostname: url.hostname,
                Port: url.port,
                Pathname: url.pathname,
                Hash: url.hash,
                Origin: url.origin,
                Params: params
            })
            setError(null)
        } catch (e) {
            setParsed(null)
            setError('Invalid URL')
        }
    }, [input])

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>URL Parser</h2>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
                    <Link2 size={16} color="var(--primary)" />
                    <label>URL to parse</label>
                </div>
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="https://example.com/path?query=123"
                    style={{ width: '100%', padding: '12px', fontSize: '1rem' }}
                />
                {error && (
                    <div style={{ color: '#ef4444', marginTop: 8, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertCircle size={14} /> {error}
                    </div>
                )}
            </div>

            {parsed && (
                <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
                    {Object.entries(parsed).map(([key, value]) => (
                        (key !== 'Params' && value) && (
                            <div key={key} className="glass-panel" style={{ padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{key}</span>
                                <span style={{ fontFamily: 'var(--font-mono)' }}>{value}</span>
                            </div>
                        )
                    ))}

                    {Object.keys(parsed.Params).length > 0 && (
                        <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                            <h3 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>Query Parameters</h3>
                            {Object.entries(parsed.Params).map(([k, v]) => (
                                <div key={k} style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4,
                                    marginBottom: 12,
                                    fontSize: '0.9rem',
                                    borderBottom: '1px solid var(--border)',
                                    paddingBottom: 8
                                }}>
                                    <div style={{ color: 'var(--primary)', fontWeight: 500 }}>{k}</div>
                                    <div style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all', paddingLeft: 8 }}>{v}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
