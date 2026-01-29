import React, { useState } from 'react'
import JSEncrypt from 'jsencrypt'
import { Key, Copy, RefreshCw, Lock, Unlock } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Rsa() {
    useDocumentTitle('RSA Key Generator')
    const [keySize, setKeySize] = useState('2048')
    const [keys, setKeys] = useState({ public: '', private: '' })
    const [isGenerating, setIsGenerating] = useState(false)

    const generateKeys = () => {
        setIsGenerating(true)
        // Use setTimeout to allow UI to render the loading state before blocking
        setTimeout(() => {
            try {
                const size = parseInt(keySize)
                const crypt = new JSEncrypt({ default_key_size: size })

                // JSEncrypt generation is blocking/synchronous in this build
                crypt.getKey()

                setKeys({
                    public: crypt.getPublicKey(),
                    private: crypt.getPrivateKey()
                })
                setIsGenerating(false)
            } catch (e) {
                console.error('RSA Generation Error:', e)
                setIsGenerating(false)
                alert('Detailed error: ' + e.message)
            }
        }, 100)
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient">RSA Key Generator</h2>
                <p style={{ color: 'var(--text-muted)' }}>Generate secure Public and Private key pairs locally.</p>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-xl)', marginBottom: 'var(--space-xl)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', justifyContent: 'center' }}>
                    <select
                        value={keySize}
                        onChange={e => setKeySize(e.target.value)}
                        style={{
                            padding: '10px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border)',
                            background: 'var(--bg-app)',
                            color: 'var(--text-main)',
                            minWidth: '150px'
                        }}
                    >
                        <option value="1024">1024 bit</option>
                        <option value="2048">2048 bit (Standard)</option>
                        <option value="4096">4096 bit (Secure)</option>
                    </select>

                    <button
                        onClick={generateKeys}
                        disabled={isGenerating}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 24px',
                            background: 'var(--primary)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            cursor: isGenerating ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                            opacity: isGenerating ? 0.7 : 1
                        }}
                    >
                        {isGenerating ? <RefreshCw className="spin" size={18} /> : <Key size={18} />}
                        {isGenerating ? 'Generating...' : 'Generate New Keys'}
                    </button>
                </div>
            </div>

            {(keys.public || keys.private) && (
                <div className="split-pane">
                    <div className="glass-panel" style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#10b981' }}>
                                <Unlock size={16} /> Public Key
                            </label>
                            <button
                                onClick={() => navigator.clipboard.writeText(keys.public)}
                                style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                <Copy size={16} />
                            </button>
                        </div>
                        <textarea
                            readOnly
                            value={keys.public}
                            style={{
                                flex: 1,
                                minHeight: '300px',
                                padding: '12px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border)',
                                background: 'rgba(0,0,0,0.2)',
                                color: 'var(--text-main)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.8rem',
                                resize: 'none',
                                wordBreak: 'break-all'
                            }}
                        />
                    </div>

                    <div className="glass-panel" style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#ef4444' }}>
                                <Lock size={16} /> Private Key
                            </label>
                            <button
                                onClick={() => navigator.clipboard.writeText(keys.private)}
                                style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                <Copy size={16} />
                            </button>
                        </div>
                        <textarea
                            readOnly
                            value={keys.private}
                            style={{
                                flex: 1,
                                minHeight: '300px',
                                padding: '12px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border)',
                                background: 'rgba(0,0,0,0.2)',
                                color: 'var(--text-main)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.8rem',
                                resize: 'none',
                                wordBreak: 'break-all'
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
