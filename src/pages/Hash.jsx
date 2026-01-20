import React, { useState, useEffect } from 'react'
import CryptoJS from 'crypto-js'
import { Copy, Hash as HashIcon } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Hash() {
    useDocumentTitle('Hash Generator')
    const [input, setInput] = useState('')
    const [hashes, setHashes] = useState({ md5: '', sha1: '', sha256: '', sha512: '' })

    useEffect(() => {
        if (!input) {
            setHashes({ md5: '', sha1: '', sha256: '', sha512: '' })
            return
        }
        setHashes({
            md5: CryptoJS.MD5(input).toString(),
            sha1: CryptoJS.SHA1(input).toString(),
            sha256: CryptoJS.SHA256(input).toString(),
            sha512: CryptoJS.SHA512(input).toString()
        })
    }, [input])

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text)
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Hash Generator</h2>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                <label style={{ display: 'block', marginBottom: 'var(--space-sm)', color: 'var(--text-muted)' }}>Input Text</label>
                <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Enter text to hash..."
                    style={{ width: '100%', minHeight: '100px', resize: 'vertical' }}
                />
            </div>

            <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
                {Object.entries(hashes).map(([algo, hash]) => (
                    <div key={algo} className="glass-panel" style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ textTransform: 'uppercase', fontWeight: 600, fontSize: '0.8rem', color: 'var(--primary)' }}>{algo}</span>
                            <button
                                onClick={() => copyToClipboard(hash)}
                                style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}
                            >
                                <Copy size={12} /> Copy
                            </button>
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', wordBreak: 'break-all', color: hash ? 'var(--text-main)' : 'var(--text-dim)' }}>
                            {hash || '...'}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
