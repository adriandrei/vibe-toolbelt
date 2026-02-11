import React, { useState } from 'react'
import CryptoJS from 'crypto-js'
import { Lock, Unlock, Copy, Check, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Aes() {
    useDocumentTitle('AES Encryption')
    const [mode, setMode] = useState('encrypt') // encrypt | decrypt
    const [text, setText] = useState('')
    const [key, setKey] = useState('')
    const [result, setResult] = useState('')
    const [error, setError] = useState(null)
    const [showKey, setShowKey] = useState(false)
    const [copied, setCopied] = useState(false)

    const process = () => {
        setError(null)
        setResult('')

        if (!text || !key) return

        try {
            if (mode === 'encrypt') {
                const encrypted = CryptoJS.AES.encrypt(text, key).toString()
                setResult(encrypted)
            } else {
                const decryptedBytes = CryptoJS.AES.decrypt(text, key)
                const decrypted = decryptedBytes.toString(CryptoJS.enc.Utf8)
                if (!decrypted) throw new Error('Invalid key or corrupted data')
                setResult(decrypted)
            }
        } catch (e) {
            setError(e.message || 'Operation failed')
        }
    }

    // Auto-process when inputs change
    React.useEffect(() => {
        const timer = setTimeout(process, 300)
        return () => clearTimeout(timer)
    }, [text, key, mode])

    const copy = () => {
        navigator.clipboard.writeText(result)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>AES Encrypt / Decrypt</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Secure symmetric encryption using AES-256 (CryptoJS)
                </p>
            </div>

            {/* Mode Switcher */}
            <div className="glass-panel" style={{ padding: '4px', display: 'inline-flex', marginBottom: 'var(--space-lg)', position: 'relative', left: '50%', transform: 'translateX(-50%)' }}>
                <button
                    onClick={() => setMode('encrypt')}
                    style={{
                        padding: '10px 24px', borderRadius: 'var(--radius-sm)',
                        background: mode === 'encrypt' ? 'var(--primary)' : 'transparent',
                        color: mode === 'encrypt' ? '#fff' : 'var(--text-muted)',
                        display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, transition: 'all 0.2s'
                    }}
                >
                    <Lock size={16} /> Encrypt
                </button>
                <button
                    onClick={() => setMode('decrypt')}
                    style={{
                        padding: '10px 24px', borderRadius: 'var(--radius-sm)',
                        background: mode === 'decrypt' ? 'var(--primary)' : 'transparent',
                        color: mode === 'decrypt' ? '#fff' : 'var(--text-muted)',
                        display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, transition: 'all 0.2s'
                    }}
                >
                    <Unlock size={16} /> Decrypt
                </button>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>

                {/* Secret Key */}
                <div style={{ marginBottom: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        Secret Passphrase
                    </label>
                    <div style={{ position: 'relative' }}>
                        <input
                            type={showKey ? "text" : "password"}
                            value={key}
                            onChange={e => setKey(e.target.value)}
                            placeholder="Enter a strong secret key..."
                            style={{
                                width: '100%', padding: '12px 40px 12px 12px', borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)',
                                color: 'var(--text-main)', fontSize: '1rem'
                            }}
                        />
                        <button
                            onClick={() => setShowKey(!showKey)}
                            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}
                        >
                            {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-lg)' }}>
                    {/* Input */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                            <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                {mode === 'encrypt' ? 'Plaintext' : 'Ciphertext'}
                            </label>
                            <button onClick={() => setText('')} style={{ color: 'var(--text-dim)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Trash2 size={12} /> Clear
                            </button>
                        </div>
                        <textarea
                            value={text}
                            onChange={e => setText(e.target.value)}
                            placeholder={mode === 'encrypt' ? "Text to encrypt..." : "U2FsdGVkX1..."}
                            style={{
                                width: '100%', minHeight: '150px', resize: 'vertical',
                                padding: '12px', borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)',
                                color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem'
                            }}
                        />
                    </div>

                    {/* Output */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                            <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                {mode === 'encrypt' ? 'Ciphertext' : 'Decrypted Text'}
                            </label>
                            {result && (
                                <button onClick={copy} style={{
                                    padding: '4px 12px', borderRadius: 'var(--radius-sm)',
                                    background: copied ? 'var(--accent)' : 'var(--primary)', color: '#fff',
                                    display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 500
                                }}>
                                    {copied ? <Check size={12} /> : <Copy size={12} />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            )}
                        </div>
                        <div style={{ position: 'relative' }}>
                            {error ? (
                                <div style={{
                                    padding: '16px', borderRadius: 'var(--radius-md)',
                                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                                    color: '#ef4444', minHeight: '150px'
                                }}>
                                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Decryption Failed</div>
                                    <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>{error}</div>
                                </div>
                            ) : (
                                <textarea
                                    readOnly
                                    value={result}
                                    style={{
                                        width: '100%', minHeight: '150px', resize: 'vertical',
                                        padding: '12px', borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border)', background: 'rgba(0,0,0,0.4)',
                                        color: result ? 'var(--text-main)' : 'var(--text-dim)',
                                        fontFamily: 'var(--font-mono)', fontSize: '0.9rem'
                                    }}
                                    placeholder="Result will appear here..."
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
