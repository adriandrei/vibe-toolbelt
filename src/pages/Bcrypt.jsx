import React, { useState, useEffect } from 'react'
import bcrypt from 'bcryptjs'
import { Shield, Check, X, RefreshCw, Copy, Eye, EyeOff } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Bcrypt() {
    useDocumentTitle('Bcrypt Hash Generator & Verifier')

    // Hash State
    const [input, setInput] = useState('')
    const [rounds, setRounds] = useState(10)
    const [hash, setHash] = useState('')
    const [isHashing, setIsHashing] = useState(false)
    const [copied, setCopied] = useState(false)

    // Verify State
    const [verifyText, setVerifyText] = useState('')
    const [verifyHash, setVerifyHash] = useState('')
    const [match, setMatch] = useState(null) // null | true | false
    const [isVerifying, setIsVerifying] = useState(false)

    // Generated hash effect
    useEffect(() => {
        const generate = async () => {
            if (!input) { setHash(''); return }
            setIsHashing(true)
            // Small delay to allow UI to render pending state
            setTimeout(() => {
                try {
                    const h = bcrypt.hashSync(input, rounds)
                    setHash(h)
                } catch (e) {
                    setHash('Error generating hash')
                }
                setIsHashing(false)
            }, 100)
        }
        const timer = setTimeout(generate, 500) // Debounce
        return () => clearTimeout(timer)
    }, [input, rounds])

    // Verification effect
    useEffect(() => {
        if (!verifyText || !verifyHash) { setMatch(null); return }
        setIsVerifying(true)
        setTimeout(() => {
            try {
                // bcrypt.compareSync is blocking but fast enough for single checks usually
                const isMatch = bcrypt.compareSync(verifyText, verifyHash)
                setMatch(isMatch)
            } catch (e) {
                setMatch(false)
            }
            setIsVerifying(false)
        }, 100)
    }, [verifyText, verifyHash])

    const copy = () => {
        navigator.clipboard.writeText(hash)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Bcrypt Generator & Verifier</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Secure password hashing using bcrypt
                </p>
            </div>

            <div style={{ display: 'grid', gap: 'var(--space-lg)' }}>
                {/* Generator Section */}
                <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', color: 'var(--primary)' }}>
                        <RefreshCw size={20} />
                        <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Generate Hash</h3>
                    </div>

                    <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)' }}>Password</label>
                            <input
                                type="text"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                placeholder="Enter password to hash..."
                                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', color: 'var(--text-main)', fontSize: '1rem' }}
                            />
                        </div>

                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                                <label style={{ color: 'var(--text-muted)' }}>Salt Rounds</label>
                                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{rounds}</span>
                            </div>
                            <input
                                type="range"
                                min="4"
                                max="16" // Cap at 16 for browser performance
                                value={rounds}
                                onChange={e => setRounds(Number(e.target.value))}
                                style={{ width: '100%', accentColor: 'var(--primary)' }}
                            />
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4 }}>
                                Higher rounds = slower hashing (more secure). Browser limit ~12-14.
                            </div>
                        </div>

                        <div style={{ position: 'relative' }}>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)' }}>Bcrypt Hash</label>
                            <div style={{
                                padding: '16px', borderRadius: 'var(--radius-md)',
                                background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)',
                                minHeight: '60px', display: 'flex', alignItems: 'center'
                            }}>
                                {isHashing ? (
                                    <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Hashing...</span>
                                ) : (
                                    <span style={{ color: hash ? 'var(--text-main)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', fontSize: '0.9rem' }}>
                                        {hash || 'Result will appear here...'}
                                    </span>
                                )}
                            </div>
                            {hash && (
                                <button onClick={copy} style={{
                                    position: 'absolute', right: 10, top: 38,
                                    padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                                    background: copied ? 'var(--accent)' : 'var(--primary)', color: '#fff',
                                    display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 500
                                }}>
                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Verify Section */}
                <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', color: 'var(--accent)' }}>
                        <Shield size={20} />
                        <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Check Password</h3>
                    </div>

                    <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)' }}>Password to check</label>
                            <input
                                type="text"
                                value={verifyText}
                                onChange={e => setVerifyText(e.target.value)}
                                placeholder="Enter password..."
                                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', color: 'var(--text-main)' }}
                            />
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)' }}>Hash to check against</label>
                            <input
                                type="text"
                                value={verifyHash}
                                onChange={e => setVerifyHash(e.target.value.trim())}
                                placeholder="$2a$10$..."
                                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
                            />
                        </div>

                        {verifyText && verifyHash && (
                            <div style={{
                                padding: '16px', borderRadius: 'var(--radius-md)',
                                background: match === true ? 'rgba(34,197,94,0.1)' : match === false ? 'rgba(239,68,68,0.1)' : 'transparent',
                                border: match === true ? '1px solid #22c55e' : match === false ? '1px solid #ef4444' : 'none',
                                display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center'
                            }}>
                                {isVerifying ? (
                                    <span style={{ color: 'var(--text-muted)' }}>Verifying...</span>
                                ) : match === true ? (
                                    <>
                                        <div style={{ background: '#22c55e', borderRadius: '50%', padding: 4, display: 'flex' }}><Check size={16} color="#fff" /></div>
                                        <span style={{ color: '#22c55e', fontWeight: 600 }}>Match! Password is correct.</span>
                                    </>
                                ) : match === false ? (
                                    <>
                                        <div style={{ background: '#ef4444', borderRadius: '50%', padding: 4, display: 'flex' }}><X size={16} color="#fff" /></div>
                                        <span style={{ color: '#ef4444', fontWeight: 600 }}>No match.</span>
                                    </>
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
