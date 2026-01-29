import React, { useState } from 'react'
import { Copy } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Gradient() {
    useDocumentTitle('Gradient Generator')
    const [color1, setColor1] = useState('#6366f1')
    const [color2, setColor2] = useState('#a855f7')
    const [angle, setAngle] = useState(45)

    const gradient = `linear-gradient(${angle}deg, ${color1}, ${color2})`

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient">Gradient Generator</h2>
                <p style={{ color: 'var(--text-muted)' }}>Create beautiful CSS gradients.</p>
            </div>

            <div className="split-pane">
                {/* Controls */}
                <div className="glass-panel" style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Color 1</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input type="color" value={color1} onChange={e => setColor1(e.target.value)} style={{ width: 40, height: 40, padding: 0, border: 'none', background: 'none' }} />
                            <input type="text" value={color1} onChange={e => setColor1(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-main)' }} />
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Color 2</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input type="color" value={color2} onChange={e => setColor2(e.target.value)} style={{ width: 40, height: 40, padding: 0, border: 'none', background: 'none' }} />
                            <input type="text" value={color2} onChange={e => setColor2(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-main)' }} />
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Angle ({angle}°)</label>
                        <input type="range" min="0" max="360" value={angle} onChange={e => setAngle(Number(e.target.value))} style={{ width: '100%' }} />
                    </div>

                    <div style={{ marginTop: 'auto' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>CSS</label>
                        <div style={{ position: 'relative' }}>
                            <code style={{ display: 'block', padding: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontSize: '0.85rem' }}>
                                background: {gradient};
                            </code>
                            <button
                                onClick={() => navigator.clipboard.writeText(`background: ${gradient};`)}
                                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >
                                <Copy size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Preview */}
                <div
                    className="glass-panel"
                    style={{
                        minHeight: '300px', // Use minHeight instead of fixed height
                        background: gradient,
                        borderRadius: 'var(--radius-lg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
                    }}
                >
                    <span style={{
                        background: 'rgba(0,0,0,0.5)',
                        padding: '10px 20px',
                        borderRadius: 20,
                        color: '#fff',
                        backdropFilter: 'blur(4px)'
                    }}>
                        Preview
                    </span>
                </div>
            </div>
        </div>
    )
}
