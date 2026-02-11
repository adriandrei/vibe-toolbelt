import React, { useState, useEffect } from 'react'
import * as OTPAuth from 'otpauth'
import { QRCodeSVG } from 'qrcode.react'
import { RefreshCw, Copy, Check, Plus, Trash2, QrCode } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Otp() {
    useDocumentTitle('TOTP / OTP Generator')

    // Generator State
    const [secret, setSecret] = useState('')
    const [label, setLabel] = useState('My Account')
    const [issuer, setIssuer] = useState('PrivateToolkit')
    const [uri, setUri] = useState('')
    const [token, setToken] = useState('')
    const [timeLeft, setTimeLeft] = useState(30)
    const [copied, setCopied] = useState(false)

    // Generate random secret on mount
    useEffect(() => {
        if (!secret) generateRandomSecret() // Auto-generate one to start
    }, [])

    // Timer loop
    useEffect(() => {
        const interval = setInterval(() => {
            const seconds = 30 - (Math.floor(Date.now() / 1000) % 30)
            setTimeLeft(seconds)

            if (secret) {
                try {
                    const totp = new OTPAuth.TOTP({
                        issuer: issuer,
                        label: label,
                        algorithm: 'SHA1',
                        digits: 6,
                        period: 30,
                        secret: OTPAuth.Secret.fromBase32(secret)
                    })
                    setToken(totp.generate())
                    setUri(totp.toString())
                } catch (e) {
                    setToken('Invalid Secret')
                }
            }
        }, 1000)
        return () => clearInterval(interval)
    }, [secret, label, issuer])

    const generateRandomSecret = () => {
        const newSecret = new OTPAuth.Secret({ size: 20 }).base32
        setSecret(newSecret)
    }

    const copyToken = () => {
        navigator.clipboard.writeText(token)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>OTP Generator</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Generate TOTP tokens and QR codes for 2FA setup
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 'var(--space-lg)' }}>

                {/* Configuration Panel */}
                <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                        <h3 style={{ fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Plus size={18} color="var(--primary)" /> Configuration
                        </h3>
                        <button onClick={generateRandomSecret} style={{ fontSize: '0.8rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <RefreshCw size={12} /> New Secret
                        </button>
                    </div>

                    <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Secret (Base32)</label>
                            <input
                                type="text"
                                value={secret}
                                onChange={e => setSecret(e.target.value.toUpperCase().replace(/[^A-Z2-7]/g, ''))}
                                placeholder="JBSWY3DPEHPK3PXP"
                                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Account Name</label>
                            <input
                                type="text"
                                value={label}
                                onChange={e => setLabel(e.target.value)}
                                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', color: 'var(--text-main)' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Issuer</label>
                            <input
                                type="text"
                                value={issuer}
                                onChange={e => setIssuer(e.target.value)}
                                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', color: 'var(--text-main)' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Display Panel */}
                <div className="glass-panel" style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>

                    {/* Live Token */}
                    <div style={{ marginBottom: 'var(--space-lg)' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>current token</div>
                        <div onClick={copyToken} style={{
                            fontSize: '3rem', fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '8px',
                            color: 'var(--primary)', cursor: 'pointer', lineHeight: 1
                        }}>
                            {token || '------'}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-sm)' }}>
                            <button onClick={copyToken} style={{
                                color: copied ? 'var(--accent)' : 'var(--text-dim)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6
                            }}>
                                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Click to copy'}
                            </button>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, marginBottom: 'var(--space-xl)', overflow: 'hidden' }}>
                        <div style={{
                            width: `${(timeLeft / 30) * 100}%`, height: '100%',
                            background: timeLeft < 5 ? '#ef4444' : 'var(--primary)',
                            transition: 'width 1s linear, background 0.3s'
                        }} />
                    </div>

                    {/* QR Code */}
                    <div style={{ background: '#fff', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                        <QRCodeSVG value={uri} size={160} />
                    </div>
                    <div style={{ marginTop: 'var(--space-md)', fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <QrCode size={14} /> Scan to add to Authenticator
                    </div>
                </div>
            </div>
        </div>
    )
}
