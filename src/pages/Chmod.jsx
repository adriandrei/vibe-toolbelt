import React, { useState, useMemo } from 'react'
import { Shield, Copy, Check, RotateCw } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const PERM_NAMES = ['Read', 'Write', 'Execute']
const PERM_LETTERS = ['r', 'w', 'x']
const GROUPS = ['Owner', 'Group', 'Others']
const SPECIAL_BITS = [
    { label: 'Setuid', bit: 4, desc: 'Run as file owner' },
    { label: 'Setgid', bit: 2, desc: 'Run as file group' },
    { label: 'Sticky', bit: 1, desc: 'Restrict deletion' },
]

function permsToOctal(perms) {
    return GROUPS.map((_, i) =>
        (perms[i * 3] ? 4 : 0) + (perms[i * 3 + 1] ? 2 : 0) + (perms[i * 3 + 2] ? 1 : 0)
    ).join('')
}

function permsToSymbolic(perms, special) {
    return GROUPS.map((_, i) => {
        let r = perms[i * 3] ? 'r' : '-'
        let w = perms[i * 3 + 1] ? 'w' : '-'
        let x = perms[i * 3 + 2] ? 'x' : '-'
        // Special bits
        if (i === 0 && (special & 4)) x = perms[i * 3 + 2] ? 's' : 'S'
        if (i === 1 && (special & 2)) x = perms[i * 3 + 2] ? 's' : 'S'
        if (i === 2 && (special & 1)) x = perms[i * 3 + 2] ? 't' : 'T'
        return r + w + x
    }).join('')
}

function octalToPerms(octal) {
    const digits = octal.padStart(3, '0').split('').map(Number)
    const perms = []
    digits.forEach(d => {
        perms.push(!!(d & 4), !!(d & 2), !!(d & 1))
    })
    return perms
}

export default function Chmod() {
    useDocumentTitle('Chmod Calculator')
    const [perms, setPerms] = useState(Array(9).fill(false).map((_, i) => [true, true, true, true, false, true, true, false, true][i]))
    const [special, setSpecial] = useState(0)
    const [octalInput, setOctalInput] = useState('755')
    const [copied, setCopied] = useState(null)

    const octal = permsToOctal(perms)
    const symbolic = permsToSymbolic(perms, special)
    const specialOctal = special > 0 ? special.toString() : ''
    const fullOctal = specialOctal + octal
    const command = `chmod ${fullOctal} filename`

    const togglePerm = (index) => {
        const newPerms = [...perms]
        newPerms[index] = !newPerms[index]
        setPerms(newPerms)
        setOctalInput(permsToOctal(newPerms))
    }

    const toggleSpecial = (bit) => {
        setSpecial(special ^ bit)
    }

    const handleOctalInput = (val) => {
        setOctalInput(val)
        const clean = val.replace(/[^0-7]/g, '')
        if (clean.length === 3) {
            setPerms(octalToPerms(clean))
            setSpecial(0)
        } else if (clean.length === 4) {
            setSpecial(parseInt(clean[0]))
            setPerms(octalToPerms(clean.slice(1)))
        }
    }

    const setPreset = (oct) => {
        handleOctalInput(oct)
    }

    const copy = (text, key) => {
        navigator.clipboard.writeText(text)
        setCopied(key)
        setTimeout(() => setCopied(null), 2000)
    }

    const PRESETS = [
        { label: '777', desc: 'Full access' },
        { label: '755', desc: 'Owner RWX, others RX' },
        { label: '750', desc: 'Owner RWX, group RX' },
        { label: '700', desc: 'Owner only' },
        { label: '644', desc: 'Owner RW, others R' },
        { label: '600', desc: 'Owner RW only' },
        { label: '444', desc: 'Read only' },
        { label: '400', desc: 'Owner read only' },
    ]

    const groupColors = ['#818cf8', '#22c55e', '#f59e0b']

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Chmod Calculator</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Unix file permissions calculator — numeric ↔ symbolic
                </p>
            </div>

            {/* Octal Input */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', textAlign: 'center' }}>
                <label style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block', marginBottom: 'var(--space-sm)' }}>
                    Enter Octal Permission
                </label>
                <input
                    type="text"
                    value={octalInput}
                    onChange={e => handleOctalInput(e.target.value)}
                    maxLength={4}
                    style={{
                        width: 140, padding: '14px', textAlign: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: 700,
                        letterSpacing: '0.15em', borderRadius: 'var(--radius-md)',
                        border: '2px solid var(--primary)', background: 'rgba(0,0,0,0.2)',
                        color: 'var(--primary)'
                    }}
                />
            </div>

            {/* Permission Grid */}
            <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr', gap: 0 }}>
                    {/* Header */}
                    <div style={{ padding: '8px 16px' }}></div>
                    {PERM_NAMES.map(name => (
                        <div key={name} style={{
                            padding: '8px 16px', textAlign: 'center',
                            fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-muted)'
                        }}>
                            {name}
                        </div>
                    ))}

                    {/* Permission rows */}
                    {GROUPS.map((group, gi) => (
                        <React.Fragment key={group}>
                            <div style={{
                                padding: '12px 16px', fontWeight: 600, fontSize: '0.9rem',
                                color: groupColors[gi], display: 'flex', alignItems: 'center', gap: 8,
                                borderTop: '1px solid var(--border)'
                            }}>
                                <Shield size={14} /> {group}
                            </div>
                            {[0, 1, 2].map(pi => (
                                <div key={pi} style={{
                                    padding: '12px 16px', textAlign: 'center',
                                    borderTop: '1px solid var(--border)'
                                }}>
                                    <button
                                        onClick={() => togglePerm(gi * 3 + pi)}
                                        style={{
                                            width: 44, height: 44, borderRadius: 'var(--radius-md)',
                                            background: perms[gi * 3 + pi] ? `${groupColors[gi]}22` : 'rgba(255,255,255,0.03)',
                                            border: perms[gi * 3 + pi] ? `2px solid ${groupColors[gi]}` : '2px solid var(--border)',
                                            color: perms[gi * 3 + pi] ? groupColors[gi] : 'var(--text-dim)',
                                            cursor: 'pointer', fontFamily: 'var(--font-mono)',
                                            fontSize: '1.1rem', fontWeight: 700, transition: 'all 0.15s'
                                        }}
                                    >
                                        {perms[gi * 3 + pi] ? PERM_LETTERS[pi] : '-'}
                                    </button>
                                </div>
                            ))}
                        </React.Fragment>
                    ))}
                </div>

                {/* Special bits */}
                <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 600, marginBottom: 'var(--space-sm)' }}>SPECIAL BITS</div>
                    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        {SPECIAL_BITS.map(sb => (
                            <button key={sb.label} onClick={() => toggleSpecial(sb.bit)} style={{
                                padding: '8px 14px', borderRadius: 'var(--radius-sm)',
                                background: (special & sb.bit) ? 'var(--primary-glow)' : 'rgba(255,255,255,0.03)',
                                border: (special & sb.bit) ? '1px solid var(--primary)' : '1px solid var(--border)',
                                color: (special & sb.bit) ? 'var(--primary)' : 'var(--text-muted)',
                                cursor: 'pointer', fontSize: '0.8rem', transition: 'all 0.2s'
                            }}>
                                {sb.label} <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>({sb.desc})</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Results */}
            <div style={{ display: 'grid', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                {[
                    { label: 'Octal', value: fullOctal, key: 'oct' },
                    { label: 'Symbolic', value: `-${symbolic}`, key: 'sym' },
                    { label: 'Command', value: command, key: 'cmd' },
                ].map(r => (
                    <div key={r.key} className="glass-panel" style={{
                        padding: '12px var(--space-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                        <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--primary)', minWidth: 80, textTransform: 'uppercase' }}>{r.label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', flex: 1, marginLeft: 'var(--space-md)' }}>{r.value}</span>
                        <button onClick={() => copy(r.value, r.key)} style={{
                            color: copied === r.key ? 'var(--accent)' : 'var(--text-muted)',
                            display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem'
                        }}>
                            {copied === r.key ? <Check size={12} /> : <Copy size={12} />}
                            {copied === r.key ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                ))}
            </div>

            {/* Presets */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 600, marginBottom: 'var(--space-sm)' }}>COMMON PRESETS</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-sm)' }}>
                    {PRESETS.map(p => (
                        <button key={p.label} onClick={() => setPreset(p.label)} style={{
                            padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                            background: octal === p.label ? 'var(--primary-glow)' : 'rgba(255,255,255,0.03)',
                            border: octal === p.label ? '1px solid var(--primary)' : '1px solid var(--border)',
                            color: 'var(--text-main)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s'
                        }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary)' }}>{p.label}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 2 }}>{p.desc}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
