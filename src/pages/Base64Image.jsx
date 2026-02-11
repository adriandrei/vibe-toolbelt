import React, { useState, useRef, useEffect } from 'react'
import { Upload, FileImage, Copy, Check, Trash2, Code, FileCode } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Base64Image() {
    useDocumentTitle('Base64 Image Encoder')
    const [file, setFile] = useState(null)
    const [preview, setPreview] = useState(null)
    const [base64, setBase64] = useState('')
    const [copied, setCopied] = useState(null)
    const fileInputRef = useRef(null)

    const handleFile = (file) => {
        if (!file) return

        // Create preview
        const objectUrl = URL.createObjectURL(file)
        setFile(file)
        setPreview(objectUrl)

        // Convert to Base64
        const reader = new FileReader()
        reader.onloadend = () => {
            setBase64(reader.result)
        }
        reader.readAsDataURL(file)
    }

    const onDrop = (e) => {
        e.preventDefault()
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0])
        }
    }

    const clear = () => {
        setFile(null)
        setPreview(null)
        setBase64('')
        if (preview) URL.revokeObjectURL(preview)
    }

    // Cleanup
    useEffect(() => {
        return () => {
            if (preview) URL.revokeObjectURL(preview)
        }
    }, [preview])

    const copyToClipboard = (text, key) => {
        navigator.clipboard.writeText(text)
        setCopied(key)
        setTimeout(() => setCopied(null), 2000)
    }

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
                <h2 className="text-gradient">Base64 Image Encoder</h2>
                <p style={{ color: 'var(--text-muted)' }}>Convert images to Data URI strings for embedding.</p>
            </div>

            <div className="split-pane" style={{ flex: 1, minHeight: 0 }}>
                {/* Visual / Drop Zone */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileImage size={16} /> Image File</label>
                        {file && (
                            <button
                                onClick={clear}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    background: 'transparent', color: 'var(--text-muted)',
                                    border: 'none', cursor: 'pointer', fontSize: '0.85rem'
                                }}
                            >
                                <Trash2 size={14} /> Clear
                            </button>
                        )}
                    </div>

                    {!file ? (
                        <div
                            onDrop={onDrop}
                            onDragOver={e => e.preventDefault()}
                            onClick={() => fileInputRef.current.click()}
                            style={{
                                flex: 1,
                                border: '2px dashed var(--border)',
                                borderRadius: 'var(--radius-md)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                background: 'rgba(255,255,255,0.02)',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.05)' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                accept="image/*"
                                onChange={e => handleFile(e.target.files[0])}
                                style={{ display: 'none' }}
                            />
                            <Upload size={32} style={{ color: 'var(--text-dim)', marginBottom: 'var(--space-sm)' }} />
                            <p style={{ color: 'var(--text-muted)' }}>Drop image here or click</p>
                        </div>
                    ) : (
                        <div style={{
                            flex: 1,
                            background: '#000',
                            borderRadius: 'var(--radius-md)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            position: 'relative'
                        }}>
                            <img
                                src={preview}
                                alt="Preview"
                                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                            />
                            <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                padding: '8px 12px',
                                background: 'rgba(0,0,0,0.7)',
                                backdropFilter: 'blur(4px)',
                                color: '#fff',
                                fontSize: '0.8rem',
                                display: 'flex',
                                justifyContent: 'space-between'
                            }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{file.name}</span>
                                <span style={{ opacity: 0.8 }}>{formatSize(file.size)}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Code / Output */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Code size={16} /> Base64 String</label>
                    </div>

                    <textarea
                        value={base64}
                        readOnly
                        placeholder="Base64 string will appear here..."
                        style={{
                            flex: 1,
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-main)',
                            padding: 'var(--space-sm)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            resize: 'none',
                            marginBottom: 'var(--space-md)'
                        }}
                    />

                    {/* Action Buttons */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-sm)' }}>
                        <button
                            disabled={!base64}
                            onClick={() => copyToClipboard(base64, 'raw')}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                padding: '10px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                color: copied === 'raw' ? '#10b981' : 'var(--text-main)',
                                cursor: base64 ? 'pointer' : 'not-allowed',
                                opacity: base64 ? 1 : 0.5
                            }}
                        >
                            {copied === 'raw' ? <Check size={16} /> : <Copy size={16} />}
                            Copy Raw
                        </button>

                        <button
                            disabled={!base64}
                            onClick={() => copyToClipboard(`<img src="${base64}" alt="${file?.name || 'image'}" />`, 'html')}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                padding: '10px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                color: copied === 'html' ? '#10b981' : 'var(--text-main)',
                                cursor: base64 ? 'pointer' : 'not-allowed',
                                opacity: base64 ? 1 : 0.5
                            }}
                        >
                            {copied === 'html' ? <Check size={16} /> : <FileCode size={16} />}
                            Copy HTML
                        </button>

                        <button
                            disabled={!base64}
                            onClick={() => copyToClipboard(`background-image: url('${base64}');`, 'css')}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                padding: '10px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                color: copied === 'css' ? '#10b981' : 'var(--text-main)',
                                cursor: base64 ? 'pointer' : 'not-allowed',
                                opacity: base64 ? 1 : 0.5
                            }}
                        >
                            {copied === 'css' ? <Check size={16} /> : <Code size={16} />}
                            Copy CSS
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
