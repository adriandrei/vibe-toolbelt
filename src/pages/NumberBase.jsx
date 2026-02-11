import React, { useState, useCallback } from 'react'
import { Binary, Copy, Check, Trash2, ArrowRight } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const BASES = [
    { id: 'bin', label: 'Binary', base: 2, prefix: '0b', placeholder: '10110101' },
    { id: 'oct', label: 'Octal', base: 8, prefix: '0o', placeholder: '265' },
    { id: 'dec', label: 'Decimal', base: 10, prefix: '', placeholder: '181' },
    { id: 'hex', label: 'Hexadecimal', base: 16, prefix: '0x', placeholder: 'B5' },
]

function formatBinary(bin) {
    return bin.replace(/(.{4})/g, '$1 ').trim()
}

export default function NumberBase() {
    useDocumentTitle('Number Base Converter')
    const [values, setValues] = useState({ bin: '', oct: '', dec: '', hex: '' })
    const [active, setActive] = useState(null)
    const [error, setError] = useState(null)
    const [copied, setCopied] = useState(null)
    const [bitLength, setBitLength] = useState(null)

    const convert = useCallback((value, fromBase) => {
        if (!value.trim()) {
            setValues({ bin: '', oct: '', dec: '', hex: '' })
            setError(null)
            setBitLength(null)
            return
        }
        try {
            // Clean input
            const clean = value.replace(/[\s_]/g, '').replace(/^0[bBxXoO]/, '')
            const num = parseInt(clean, fromBase)
            if (isNaN(num) || num < 0) throw new Error('Invalid number')
            if (num > Number.MAX_SAFE_INTEGER) throw new Error('Number exceeds safe integer limit')

            const bin = num.toString(2)
            setValues({
                bin: fromBase === 2 ? clean : bin,
                oct: num.toString(8),
                dec: num.toString(10),
                hex: num.toString(16).toUpperCase(),
            })
            setBitLength(bin.length)
            setError(null)
        } catch (e) {
            setError(e.message)
        }
    }, [])

    const handleChange = (id, value, base) => {
        setActive(id)
        setValues(prev => ({ ...prev, [id]: value }))
        convert(value, base)
    }

    const copy = (text, key) => {
        navigator.clipboard.writeText(text)
        setCopied(key)
        setTimeout(() => setCopied(null), 2000)
    }

    const clear = () => {
        setValues({ bin: '', oct: '', dec: '', hex: '' })
        setError(null)
        setBitLength(null)
    }

    // Quick presets
    const presets = [
        { label: '255', dec: '255' },
        { label: '1024', dec: '1024' },
        { label: '65535', dec: '65535' },
        { label: '0xFF', dec: '255' },
        { label: 'MAX_INT32', dec: '2147483647' },
    ]

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Number Base Converter</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Convert between Binary, Octal, Decimal, and Hexadecimal
                </p>
            </div>

            {/* Quick Presets */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 600 }}>Quick:</span>
                    {presets.map(p => (
                        <button key={p.label} onClick={() => handleChange('dec', p.dec, 10)} style={{
                            padding: '4px 12px', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
                            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                            color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
                            transition: 'all 0.2s'
                        }}>
                            {p.label}
                        </button>
                    ))}
                    <div style={{ marginLeft: 'auto' }}>
                        <button onClick={clear} style={{ color: 'var(--text-dim)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Trash2 size={12} /> Clear
                        </button>
                    </div>
                </div>
            </div>

            {/* Conversion Fields */}
            <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
                {BASES.map(b => (
                    <div key={b.id} className="glass-panel" style={{
                        padding: 'var(--space-md)',
                        borderLeft: active === b.id ? '3px solid var(--primary)' : '3px solid transparent',
                        transition: 'all 0.2s'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    width: 32, height: 32, borderRadius: 'var(--radius-sm)',
                                    background: 'var(--primary-glow)', color: 'var(--primary)',
                                    fontSize: '0.75rem', fontWeight: 700
                                }}>
                                    {b.base}
                                </span>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{b.label}</div>
                                    {b.prefix && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>prefix: {b.prefix}</div>}
                                </div>
                            </div>
                            {values[b.id] && (
                                <button onClick={() => copy(b.prefix + values[b.id], b.id)} style={{
                                    color: copied === b.id ? 'var(--accent)' : 'var(--text-muted)',
                                    display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem'
                                }}>
                                    {copied === b.id ? <Check size={12} /> : <Copy size={12} />}
                                    {copied === b.id ? 'Copied' : 'Copy'}
                                </button>
                            )}
                        </div>
                        <input
                            type="text"
                            value={b.id === 'bin' && active !== 'bin' ? formatBinary(values[b.id]) : values[b.id]}
                            onChange={e => handleChange(b.id, e.target.value, b.base)}
                            onFocus={() => setActive(b.id)}
                            placeholder={b.placeholder}
                            style={{
                                width: '100%', padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '1rem',
                                letterSpacing: b.id === 'bin' ? '1px' : 'normal'
                            }}
                        />
                    </div>
                ))}
            </div>

            {/* Bit Info */}
            {bitLength !== null && (
                <div className="glass-panel" style={{ padding: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Bit Length</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)' }}>{bitLength} bits</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Byte Size</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>{Math.ceil(bitLength / 8)} bytes</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Fits in</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>
                                {bitLength <= 8 ? 'uint8' : bitLength <= 16 ? 'uint16' : bitLength <= 32 ? 'uint32' : 'uint64'}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '0.9rem' }}>
                    {error}
                </div>
            )}
        </div>
    )
}
