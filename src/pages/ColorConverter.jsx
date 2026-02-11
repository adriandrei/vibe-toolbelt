import React, { useState, useCallback } from 'react'
import { Palette, Copy, Check, RefreshCw } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

function hexToRgb(hex) {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
    const n = parseInt(full, 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex({ r, g, b }) {
    return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')
}

function rgbToHsl({ r, g, b }) {
    const rn = r / 255, gn = g / 255, bn = b / 255
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
    const l = (max + min) / 2
    if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    let h = 0
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function hslToRgb({ h, s, l }) {
    const sn = s / 100, ln = l / 100
    if (sn === 0) { const v = Math.round(ln * 255); return { r: v, g: v, b: v } }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
    }
    const hn = h / 360
    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
    const p = 2 * ln - q
    return {
        r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
        g: Math.round(hue2rgb(p, q, hn) * 255),
        b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
    }
}

function rgbToHwb({ r, g, b }) {
    const { h } = rgbToHsl({ r, g, b })
    const w = Math.min(r, g, b) / 255 * 100
    const bl = (1 - Math.max(r, g, b) / 255) * 100
    return { h, w: Math.round(w), b: Math.round(bl) }
}

function randomColor() {
    return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0')
}

export default function ColorConverter() {
    useDocumentTitle('Color Converter')
    const [hex, setHex] = useState('#6366f1')
    const [rgb, setRgb] = useState(hexToRgb('#6366f1'))
    const [hsl, setHsl] = useState(rgbToHsl(hexToRgb('#6366f1')))
    const [copied, setCopied] = useState(null)

    const updateFromHex = useCallback((h) => {
        setHex(h)
        const clean = h.replace('#', '')
        if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(clean)) {
            const r = hexToRgb(h)
            setRgb(r)
            setHsl(rgbToHsl(r))
        }
    }, [])

    const updateFromRgb = useCallback((newRgb) => {
        setRgb(newRgb)
        setHex(rgbToHex(newRgb))
        setHsl(rgbToHsl(newRgb))
    }, [])

    const updateFromHsl = useCallback((newHsl) => {
        setHsl(newHsl)
        const r = hslToRgb(newHsl)
        setRgb(r)
        setHex(rgbToHex(r))
    }, [])

    const randomize = () => {
        const h = randomColor()
        updateFromHex(h)
    }

    const copy = (text, key) => {
        navigator.clipboard.writeText(text)
        setCopied(key)
        setTimeout(() => setCopied(null), 2000)
    }

    const hwb = rgbToHwb(rgb)

    const formats = [
        { label: 'HEX', value: hex.toUpperCase(), key: 'hex' },
        { label: 'RGB', value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`, key: 'rgb' },
        { label: 'HSL', value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`, key: 'hsl' },
        { label: 'HWB', value: `hwb(${hwb.h} ${hwb.w}% ${hwb.b}%)`, key: 'hwb' },
        { label: 'CSS', value: hex.toUpperCase(), key: 'css' },
    ]

    const inputStyle = {
        width: 70, padding: '8px', borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)',
        color: 'var(--text-main)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', textAlign: 'center'
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Color Converter</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Convert between HEX, RGB, HSL, and HWB color formats
                </p>
            </div>

            {/* Color Preview + Picker */}
            <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative' }}>
                        <div style={{
                            width: 140, height: 140, borderRadius: 'var(--radius-lg)',
                            background: hex, boxShadow: `0 8px 32px ${hex}66`,
                            border: '3px solid rgba(255,255,255,0.15)',
                            transition: 'all 0.3s ease'
                        }} />
                        <input
                            type="color"
                            value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#6366f1'}
                            onChange={e => updateFromHex(e.target.value)}
                            style={{
                                position: 'absolute', inset: 0, width: '100%', height: '100%',
                                opacity: 0, cursor: 'pointer'
                            }}
                        />
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                            <Palette size={16} color="var(--primary)" />
                            <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>HEX</label>
                            <input
                                type="text"
                                value={hex}
                                onChange={e => updateFromHex(e.target.value)}
                                style={{ ...inputStyle, width: 120 }}
                                maxLength={7}
                            />
                            <button onClick={randomize} title="Random color" style={{
                                padding: '8px', borderRadius: 'var(--radius-sm)',
                                background: 'var(--primary-glow)', color: 'var(--primary)'
                            }}>
                                <RefreshCw size={14} />
                            </button>
                        </div>

                        {/* HSL Sliders */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                                    <span>Hue</span><span>{hsl.h}°</span>
                                </div>
                                <input type="range" min={0} max={360} value={hsl.h}
                                    onChange={e => updateFromHsl({ ...hsl, h: +e.target.value })}
                                    style={{ width: '100%', accentColor: hex }}
                                />
                            </div>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                                    <span>Saturation</span><span>{hsl.s}%</span>
                                </div>
                                <input type="range" min={0} max={100} value={hsl.s}
                                    onChange={e => updateFromHsl({ ...hsl, s: +e.target.value })}
                                    style={{ width: '100%', accentColor: hex }}
                                />
                            </div>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                                    <span>Lightness</span><span>{hsl.l}%</span>
                                </div>
                                <input type="range" min={0} max={100} value={hsl.l}
                                    onChange={e => updateFromHsl({ ...hsl, l: +e.target.value })}
                                    style={{ width: '100%', accentColor: hex }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* RGB Inputs */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 'var(--space-sm)', display: 'block' }}>RGB Values</label>
                <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                    {['r', 'g', 'b'].map(ch => (
                        <div key={ch} style={{ flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: ch === 'r' ? '#ef4444' : ch === 'g' ? '#22c55e' : '#3b82f6', fontWeight: 700, marginBottom: 4 }}>
                                {ch === 'r' ? 'Red' : ch === 'g' ? 'Green' : 'Blue'}
                            </div>
                            <input
                                type="number" min={0} max={255} value={rgb[ch]}
                                onChange={e => updateFromRgb({ ...rgb, [ch]: Math.min(255, Math.max(0, +e.target.value || 0)) })}
                                style={{ ...inputStyle, width: '100%' }}
                            />
                            <input type="range" min={0} max={255} value={rgb[ch]}
                                onChange={e => updateFromRgb({ ...rgb, [ch]: +e.target.value })}
                                style={{ width: '100%', marginTop: 4, accentColor: ch === 'r' ? '#ef4444' : ch === 'g' ? '#22c55e' : '#3b82f6' }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* All Formats */}
            <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                {formats.map(f => (
                    <div key={f.key} className="glass-panel" style={{
                        padding: '12px var(--space-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                        <span style={{ textTransform: 'uppercase', fontWeight: 600, fontSize: '0.8rem', color: 'var(--primary)', minWidth: 40 }}>{f.label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', flex: 1, marginLeft: 'var(--space-md)' }}>{f.value}</span>
                        <button onClick={() => copy(f.value, f.key)} style={{
                            color: copied === f.key ? 'var(--accent)' : 'var(--text-muted)',
                            display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem'
                        }}>
                            {copied === f.key ? <Check size={12} /> : <Copy size={12} />}
                            {copied === f.key ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}
