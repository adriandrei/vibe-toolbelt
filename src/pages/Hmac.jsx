import React, { useState, useEffect } from 'react'
import CryptoJS from 'crypto-js'
import { Key, ShieldCheck, Copy } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Hmac() {
    useDocumentTitle('HMAC Generator')
    const [input, setInput] = useState('')
    const [key, setKey] = useState('')
    const [algo, setAlgo] = useState('SHA256')
    const [output, setOutput] = useState('')

    useEffect(() => {
        if (!input || !key) {
            setOutput('')
            return
        }

        try {
            let result = ''
            switch (algo) {
                case 'MD5': result = CryptoJS.HmacMD5(input, key).toString(); break;
                case 'SHA1': result = CryptoJS.HmacSHA1(input, key).toString(); break;
                case 'SHA256': result = CryptoJS.HmacSHA256(input, key).toString(); break;
                case 'SHA512': result = CryptoJS.HmacSHA512(input, key).toString(); break;
                default: result = '';
            }
            setOutput(result)
        } catch (e) {
            setOutput('Error generating HMAC')
        }
    }, [input, key, algo])

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient">HMAC Generator</h2>
                <p style={{ color: 'var(--text-muted)' }}>Keyed-Hash Message Authentication Code</p>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-xl)' }}>
                <div style={{ marginBottom: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Message</label>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Enter message to hash..."
                        style={{
                            width: '100%',
                            minHeight: '100px',
                            padding: '12px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border)',
                            background: 'var(--bg-app)',
                            color: 'var(--text-main)',
                            fontFamily: 'var(--font-mono)'
                        }}
                    />
                </div>

                <div className="split-pane" style={{ marginBottom: 'var(--space-md)' }}>
                    <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Secret Key</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                value={key}
                                onChange={e => setKey(e.target.value)}
                                placeholder="Secret Key"
                                style={{
                                    width: '100%',
                                    padding: '10px 10px 10px 36px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border)',
                                    background: 'var(--bg-app)',
                                    color: 'var(--text-main)',
                                    fontFamily: 'var(--font-mono)'
                                }}
                            />
                            <Key size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Algorithm</label>
                        <select
                            value={algo}
                            onChange={e => setAlgo(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border)',
                                background: 'var(--bg-app)',
                                color: 'var(--text-main)'
                            }}
                        >
                            <option value="SHA256">SHA256</option>
                            <option value="SHA512">SHA512</option>
                            <option value="SHA1">SHA1</option>
                            <option value="MD5">MD5</option>
                        </select>
                    </div>
                </div>

                <div style={{ marginTop: 'var(--space-lg)' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-sm)', fontWeight: 600 }}>HMAC Output</label>
                    <div style={{ position: 'relative' }}>
                        <input
                            type="text"
                            readOnly
                            value={output}
                            placeholder="HMAC will appear here..."
                            style={{
                                width: '100%',
                                padding: '12px',
                                paddingRight: '40px',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--primary)',
                                background: 'rgba(16, 185, 129, 0.05)',
                                color: 'var(--primary)',
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 600
                            }}
                        />
                        {output && (
                            <button
                                onClick={() => navigator.clipboard.writeText(output)}
                                style={{
                                    position: 'absolute',
                                    right: 8,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--primary)',
                                    cursor: 'pointer'
                                }}
                            >
                                <Copy size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
