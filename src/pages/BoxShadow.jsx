import React, { useState } from 'react'
import { Layers, Copy } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function BoxShadow() {
    useDocumentTitle('Box Shadow Generator')
    const [shadows, setShadows] = useState([
        { x: 0, y: 10, blur: 15, spread: -3, color: '#000000', opacity: 0.1, inset: false }
    ])

    const updateShadow = (index, key, value) => {
        const newShadows = [...shadows]
        newShadows[index] = { ...newShadows[index], [key]: value }
        setShadows(newShadows)
    }

    const addShadow = () => {
        setShadows([...shadows, { x: 0, y: 0, blur: 10, spread: 0, color: '#000000', opacity: 0.2, inset: false }])
    }

    const removeShadow = (index) => {
        setShadows(shadows.filter((_, i) => i !== index))
    }

    const getShadowString = () => {
        return shadows.map(s => {
            const rgb = parseInt(s.color.slice(1), 16)
            const r = (rgb >> 16) & 0xff
            const g = (rgb >> 8) & 0xff
            const b = (rgb >> 0) & 0xff
            return `${s.inset ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px rgba(${r}, ${g}, ${b}, ${s.opacity})`
        }).join(', ')
    }

    const css = `box-shadow: ${getShadowString()};`

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div className="split-pane">
                {/* Controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto', paddingRight: '8px' }}>
                    <h2 className="text-gradient">Shadow Layers</h2>

                    {shadows.map((s, i) => (
                        <div key={i} className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                                <strong>Layer {i + 1}</strong>
                                <button
                                    onClick={() => removeShadow(i)}
                                    disabled={shadows.length === 1}
                                    style={{ color: '#ef4444', fontSize: '0.8rem', opacity: shadows.length === 1 ? 0.5 : 1 }}
                                >
                                    Remove
                                </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>X Offset ({s.x}px)</label>
                                    <input type="range" min="-50" max="50" value={s.x} onChange={e => updateShadow(i, 'x', Number(e.target.value))} style={{ width: '100%' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Y Offset ({s.y}px)</label>
                                    <input type="range" min="-50" max="50" value={s.y} onChange={e => updateShadow(i, 'y', Number(e.target.value))} style={{ width: '100%' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Blur ({s.blur}px)</label>
                                    <input type="range" min="0" max="100" value={s.blur} onChange={e => updateShadow(i, 'blur', Number(e.target.value))} style={{ width: '100%' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Spread ({s.spread}px)</label>
                                    <input type="range" min="-50" max="50" value={s.spread} onChange={e => updateShadow(i, 'spread', Number(e.target.value))} style={{ width: '100%' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Opacity ({s.opacity})</label>
                                    <input type="range" min="0" max="1" step="0.01" value={s.opacity} onChange={e => updateShadow(i, 'opacity', Number(e.target.value))} style={{ width: '100%' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Color</label>
                                    <input type="color" value={s.color} onChange={e => updateShadow(i, 'color', e.target.value)} style={{ width: '100%', height: '30px' }} />
                                </div>
                            </div>

                            <label style={{ display: 'flex', alignItems: 'center', marginTop: 'var(--space-sm)', fontSize: '0.9rem', gap: 8 }}>
                                <input type="checkbox" checked={s.inset} onChange={e => updateShadow(i, 'inset', e.target.checked)} />
                                Inset Shadow
                            </label>
                        </div>
                    ))}

                    <button className="glass-panel" onClick={addShadow} style={{ padding: '12px', textAlign: 'center', cursor: 'pointer' }}>
                        + Add Layer
                    </button>
                </div>

                {/* Preview */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                    <div
                        style={{
                            flex: 1,
                            background: '#fff', // always white bg for checking shadows
                            borderRadius: 'var(--radius-lg)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minHeight: '400px'
                        }}
                    >
                        <div style={{
                            width: '200px',
                            height: '200px',
                            background: '#ffffff',
                            borderRadius: '12px',
                            boxShadow: getShadowString()
                        }} />
                    </div>

                    <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                            <strong>CSS Code</strong>
                            <button onClick={() => navigator.clipboard.writeText(css)} style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Copy size={16} /> Copy
                            </button>
                        </div>
                        <code style={{ display: 'block', padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', fontFamily: 'monospace' }}>
                            {css}
                        </code>
                    </div>
                </div>
            </div>
        </div>
    )
}
