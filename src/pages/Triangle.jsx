import React, { useState } from 'react'
import { Copy } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Triangle() {
    useDocumentTitle('Triangle Generator')
    const [direction, setDirection] = useState('top')
    const [color, setColor] = useState('#10b981')
    const [width, setWidth] = useState(100)

    // Logic for CSS triangle border trick
    // Top: border-left/right transp, border-bottom color
    const getStyles = () => {
        const solid = `${width}px solid ${color}`
        const transp = `${width}px solid transparent`

        const base = {
            width: 0,
            height: 0,
            borderLeft: transp,
            borderRight: transp,
            borderBottom: solid
        }

        switch (direction) {
            case 'top': return { ...base, borderTop: 'none', borderBottom: solid, borderLeft: transp, borderRight: transp };
            case 'bottom': return { ...base, borderBottom: 'none', borderTop: solid, borderLeft: transp, borderRight: transp };
            case 'left': return { ...base, borderLeft: 'none', borderRight: solid, borderTop: transp, borderBottom: transp };
            case 'right': return { ...base, borderRight: 'none', borderLeft: solid, borderTop: transp, borderBottom: transp };
            default: return base;
        }
    }

    const styleObj = getStyles()

    const cssOutput = `width: 0;
height: 0;
border-style: solid;
border-width: ${direction === 'top' || direction === 'bottom' ? `0 ${width}px ${width}px ${width}px` : `${width}px ${direction === 'left' ? width + 'px' : '0'} ${width}px ${direction === 'right' ? width + 'px' : '0'}`};
border-color: ${direction === 'top' ? `transparent transparent ${color} transparent` :
            direction === 'bottom' ? `${color} transparent transparent transparent` :
                direction === 'left' ? `transparent ${color} transparent transparent` :
                    `transparent transparent transparent ${color}`
        };`
    // Note: The specific shorthand border-width/color above is approximate, usually it's cleaner to list explicitly.
    // Let's generate cleaner CSS for the user.

    const generateCleanCss = () => {
        let borders = ''
        const w = width + 'px'
        if (direction === 'top') {
            borders = `border-left: ${w} solid transparent;
border-right: ${w} solid transparent;
border-bottom: ${w} solid ${color};`
        } else if (direction === 'bottom') {
            borders = `border-left: ${w} solid transparent;
border-right: ${w} solid transparent;
border-top: ${w} solid ${color};`
        } else if (direction === 'left') {
            borders = `border-top: ${w} solid transparent;
border-bottom: ${w} solid transparent;
border-right: ${w} solid ${color};`
        } else { // right
            borders = `border-top: ${w} solid transparent;
border-bottom: ${w} solid transparent;
border-left: ${w} solid ${color};`
        }

        return `width: 0;
height: 0;
${borders}`
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient">Triangle Generator</h2>
                <p style={{ color: 'var(--text-muted)' }}>Pure CSS triangles generator.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 1fr', gap: 'var(--space-xl)' }}>
                <div className="glass-panel" style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Direction</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {['top', 'bottom', 'left', 'right'].map(d => (
                                <button
                                    key={d}
                                    onClick={() => setDirection(d)}
                                    style={{
                                        padding: 8,
                                        borderRadius: 6,
                                        border: `1px solid ${direction === d ? 'var(--primary)' : 'var(--border)'}`,
                                        background: direction === d ? 'var(--primary-glow)' : 'transparent',
                                        color: direction === d ? 'var(--primary)' : 'var(--text-muted)',
                                        cursor: 'pointer',
                                        textTransform: 'capitalize'
                                    }}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Color</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 40, height: 40, border: 'none', background: 'none' }} />
                            <input type="text" value={color} onChange={e => setColor(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-main)' }} />
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Size ({width}px)</label>
                        <input type="range" min="10" max="300" value={width} onChange={e => setWidth(Number(e.target.value))} style={{ width: '100%' }} />
                    </div>

                    <div style={{ marginTop: 'auto' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>CSS</label>
                        <div style={{ position: 'relative' }}>
                            <pre style={{ display: 'block', padding: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontSize: '0.8rem', overflow: 'auto' }}>
                                {generateCleanCss()}
                            </pre>
                            <button
                                onClick={() => navigator.clipboard.writeText(generateCleanCss())}
                                style={{ position: 'absolute', right: 8, top: 8, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >
                                <Copy size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Preview */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border)' }}>
                    <div style={styleObj} />
                </div>
            </div>
        </div>
    )
}
