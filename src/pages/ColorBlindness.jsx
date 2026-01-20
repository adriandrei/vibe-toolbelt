import React, { useState } from 'react'
import { Eye, Upload, Image as ImageIcon } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function ColorBlindness() {
    useDocumentTitle('Color Blindness Simulator')
    const [image, setImage] = useState(null)
    const [filter, setFilter] = useState('normal')

    const handleUpload = (e) => {
        const file = e.target.files[0]
        if (file) {
            const reader = new FileReader()
            reader.onload = (ev) => setImage(ev.target.result)
            reader.readAsDataURL(file)
        }
    }

    // SVG Filters for simulation
    // Values approximated from standard color blindness matrices
    const filters = {
        normal: [],
        protanopia: [
            0.567, 0.433, 0, 0, 0,
            0.558, 0.442, 0, 0, 0,
            0, 0.242, 0.758, 0, 0,
            0, 0, 0, 1, 0
        ],
        deuteranopia: [
            0.625, 0.375, 0, 0, 0,
            0.7, 0.3, 0, 0, 0,
            0, 0.3, 0.7, 0, 0,
            0, 0, 0, 1, 0
        ],
        tritanopia: [
            0.95, 0.05, 0, 0, 0,
            0, 0.433, 0.567, 0, 0,
            0, 0.475, 0.525, 0, 0,
            0, 0, 0, 1, 0
        ],
        achromatopsia: [
            0.299, 0.587, 0.114, 0, 0,
            0.299, 0.587, 0.114, 0, 0,
            0.299, 0.587, 0.114, 0, 0,
            0, 0, 0, 1, 0
        ]
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            {/* Filters definitions */}
            <svg style={{ display: 'none' }}>
                <defs>
                    {Object.entries(filters).map(([name, matrix]) => (
                        matrix.length > 0 && (
                            <filter key={name} id={name}>
                                <feColorMatrix type="matrix" values={matrix.join(' ')} />
                            </filter>
                        )
                    ))}
                </defs>
            </svg>

            <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Color Blindness Simulator</h2>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'center', marginBottom: 'var(--space-md)' }}>
                {Object.keys(filters).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className="glass-panel"
                        style={{
                            padding: '8px 16px',
                            textTransform: 'capitalize',
                            background: filter === f ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                            color: filter === f ? '#fff' : 'var(--text-muted)'
                        }}
                    >
                        {f}
                    </button>
                ))}
            </div>

            <div
                className="glass-panel"
                style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative',
                    padding: 'var(--space-md)'
                }}
            >
                {!image ? (
                    <label style={{ cursor: 'pointer', textAlign: 'center', padding: 'var(--space-2xl)' }}>
                        <Upload size={48} style={{ marginBottom: 'var(--space-md)', opacity: 0.5 }} />
                        <div style={{ fontSize: '1.2rem', marginBottom: 'var(--space-sm)' }}>Click to upload an image</div>
                        <div style={{ color: 'var(--text-dim)' }}>JPG, PNG, WebP</div>
                        <input type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
                    </label>
                ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                            <img
                                src={image}
                                alt="Simulation"
                                style={{
                                    maxWidth: '100%',
                                    maxHeight: '100%',
                                    objectFit: 'contain',
                                    filter: filter === 'normal' ? 'none' : `url(#${filter})`
                                }}
                            />
                        </div>
                        <div style={{ marginTop: 'var(--space-md)', textAlign: 'center' }}>
                            <button onClick={() => setImage(null)} style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                Change Image
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
