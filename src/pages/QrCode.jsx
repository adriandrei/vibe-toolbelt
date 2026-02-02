import React, { useState, useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { Download, QrCode as QrIcon, Copy } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function QrCode() {
    useDocumentTitle('QR Code Generator')
    const [text, setText] = useState('https://example.com')
    const [size, setSize] = useState(256)
    const [fgColor, setFgColor] = useState('#000000')
    const [bgColor, setBgColor] = useState('#ffffff')
    const [level, setLevel] = useState('M') // L, M, Q, H
    const [includeMargin, setIncludeMargin] = useState(true)

    const canvasRef = useRef(null)

    const downloadQr = () => {
        const canvas = document.querySelector('canvas') // qrcode.react renders a canvas
        if (canvas) {
            const url = canvas.toDataURL('image/png')
            const a = document.createElement('a')
            a.download = 'qrcode.png'
            a.href = url
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
        }
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient">QR Code Generator</h2>
                <p style={{ color: 'var(--text-muted)' }}>Generate customizable QR codes instantly.</p>
            </div>

            <div className="split-pane">
                {/* Controls */}
                <div className="glass-panel" style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Content</label>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Type URL or text..."
                            style={{ width: '100%', minHeight: '80px', resize: 'vertical' }}
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Size ({size}px)</label>
                            <input
                                type="range"
                                min="128"
                                max="1024"
                                step="32"
                                value={size}
                                onChange={(e) => setSize(Number(e.target.value))}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Error Correction</label>
                            <select
                                value={level}
                                onChange={(e) => setLevel(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border)',
                                    background: 'var(--bg-app)',
                                    color: 'var(--text-main)'
                                }}
                            >
                                <option value="L">Low (7%)</option>
                                <option value="M">Medium (15%)</option>
                                <option value="Q">Quartile (25%)</option>
                                <option value="H">High (30%)</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Foreground</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input type="color" value={fgColor} onChange={e => setFgColor(e.target.value)} style={{ width: 40, height: 40, padding: 0, border: 'none', background: 'none' }} />
                                <input type="text" value={fgColor} onChange={e => setFgColor(e.target.value)} style={{ flex: 1, padding: 8 }} />
                            </div>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Background</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} style={{ width: 40, height: 40, padding: 0, border: 'none', background: 'none' }} />
                                <input type="text" value={bgColor} onChange={e => setBgColor(e.target.value)} style={{ flex: 1, padding: 8 }} />
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                            type="checkbox"
                            checked={includeMargin}
                            onChange={(e) => setIncludeMargin(e.target.checked)}
                            id="margin-check"
                            style={{ width: 'auto' }}
                        />
                        <label htmlFor="margin-check" style={{ cursor: 'pointer' }}>Include Margin</label>
                    </div>
                </div>

                {/* Preview */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div className="glass-panel flex-center" style={{
                        padding: 'var(--space-xl)',
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(255, 255, 255, 0.02)'
                    }}>
                        <div style={{
                            padding: '20px',
                            background: bgColor,
                            borderRadius: includeMargin ? 0 : 'var(--radius-md)',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                        }}>
                            <QRCodeCanvas
                                value={text}
                                size={size}
                                bgColor={bgColor}
                                fgColor={fgColor}
                                level={level}
                                includeMargin={includeMargin}
                                style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
                            />
                        </div>
                    </div>

                    <button
                        onClick={downloadQr}
                        style={{
                            width: '100%',
                            padding: '14px',
                            background: 'var(--primary)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '1rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            boxShadow: 'var(--primary-shadow)'
                        }}
                    >
                        <Download size={18} /> Download PNG
                    </button>
                </div>
            </div>
        </div>
    )
}
