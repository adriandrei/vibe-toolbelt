import React, { useState } from 'react'
import { Palette, Copy, Check } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Glass() {
    useDocumentTitle('Glassmorphism Generator')
    const [blur, setBlur] = useState(12)
    const [transparency, setTransparency] = useState(0.2)
    const [saturation, setSaturation] = useState(1.0)
    const [color, setColor] = useState('#ffffff')
    const [copied, setCopied] = useState(false)

    // Calculate distinct RGB
    const hexToRgb = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return `${r}, ${g}, ${b}`
    }

    const generatedCss = `
background: rgba(${hexToRgb(color)}, ${transparency});
backdrop-filter: blur(${blur}px) saturate(${saturation * 100}%);
-webkit-backdrop-filter: blur(${blur}px) saturate(${saturation * 100}%);
border: 1px solid rgba(255, 255, 255, 0.125);
border-radius: 12px;
box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
  `.trim()

    const copyCss = () => {
        navigator.clipboard.writeText(generatedCss)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Glass Generator</h2>
                <p style={{ color: 'var(--text-muted)' }}>Design frosted glass effects for your next project</p>
            </div>

            <div className="split-pane" style={{ alignItems: 'start' }}>

                {/* Controls */}
                <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                    <h3 style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Palette size={20} /> Settings
                    </h3>

                    <div style={{ marginBottom: 'var(--space-lg)' }}>
                        <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                            Blur <span>{blur}px</span>
                        </label>
                        <input
                            type="range" min="0" max="40" value={blur}
                            onChange={(e) => setBlur(e.target.value)}
                            style={{ width: '100%', accentColor: 'var(--primary)' }}
                        />
                    </div>

                    <div style={{ marginBottom: 'var(--space-lg)' }}>
                        <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                            Transparency <span>{Math.round(transparency * 100)}%</span>
                        </label>
                        <input
                            type="range" min="0" max="1" step="0.01" value={transparency}
                            onChange={(e) => setTransparency(e.target.value)}
                            style={{ width: '100%', accentColor: 'var(--primary)' }}
                        />
                    </div>

                    <div style={{ marginBottom: 'var(--space-lg)' }}>
                        <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                            Saturation <span>{Math.round(saturation * 100)}%</span>
                        </label>
                        <input
                            type="range" min="0" max="2" step="0.1" value={saturation}
                            onChange={(e) => setSaturation(e.target.value)}
                            style={{ width: '100%', accentColor: 'var(--primary)' }}
                        />
                    </div>

                    <div style={{ marginBottom: 'var(--space-lg)' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--space-xs)' }}>Base Color</label>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                            <input
                                type="color"
                                value={color}
                                onChange={(e) => setColor(e.target.value)}
                                style={{ width: '50px', padding: 0, height: '40px' }}
                            />
                            <input
                                type="text" value={color} onChange={(e) => setColor(e.target.value)}
                                style={{ textTransform: 'uppercase' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Preview & Code */}
                <div>
                    {/* Visual Preview */}
                    <div style={{
                        backgroundImage: 'url("https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&w=600&q=80")',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        borderRadius: 'var(--radius-lg)',
                        padding: '40px',
                        marginBottom: 'var(--space-lg)',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{
                            background: `rgba(${hexToRgb(color)}, ${transparency})`,
                            backdropFilter: `blur(${blur}px) saturate(${saturation * 100}%)`,
                            WebkitBackdropFilter: `blur(${blur}px) saturate(${saturation * 100}%)`,
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.125)',
                            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
                            padding: '24px',
                            color: '#fff',
                            minHeight: '200px',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center'
                        }}>
                            <h4 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Glassmorphism</h4>
                            <p>Pure CSS effect</p>
                        </div>
                    </div>

                    {/* CSS Code */}
                    <div className="glass-panel" style={{ position: 'relative' }}>
                        <pre style={{
                            padding: 'var(--space-lg)',
                            overflowX: 'auto',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem'
                        }}>
                            {generatedCss}
                        </pre>
                        <button
                            onClick={copyCss}
                            style={{
                                position: 'absolute',
                                top: 'var(--space-sm)',
                                right: 'var(--space-sm)',
                                padding: '6px 12px',
                                borderRadius: 'var(--radius-sm)',
                                background: copied ? 'var(--accent)' : 'var(--primary-glow)',
                                color: copied ? '#fff' : 'var(--primary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: '0.85rem',
                                fontWeight: 500
                            }}
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? 'Copied!' : 'Copy CSS'}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    )
}
