import { Fragment, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import { CLASSES, SETGID, SETUID, STICKY, formatChmodExpression, formatOctal, formatSymbolic, parseModeInput } from '../utils/chmod'

const PERMS = [
    { bit: 4, letter: 'r', name: 'Read' },
    { bit: 2, letter: 'w', name: 'Write' },
    { bit: 1, letter: 'x', name: 'Execute' },
]

const SPECIALS = [
    { bit: SETUID, name: 'Setuid', octal: '4000', file: 'Runs with the file owner’s privileges', dir: 'Ignored on most systems' },
    { bit: SETGID, name: 'Setgid', octal: '2000', file: 'Runs with the file’s group privileges', dir: 'New files inherit the directory’s group' },
    { bit: STICKY, name: 'Sticky', octal: '1000', file: 'Ignored on most systems', dir: 'Only owners can delete or rename their files (like /tmp)' },
]

const PRESETS = [
    { mode: 0o755, desc: 'Programs and directories' },
    { mode: 0o644, desc: 'Regular files' },
    { mode: 0o600, desc: 'Private files (SSH keys)' },
    { mode: 0o700, desc: 'Private directories' },
    { mode: 0o750, desc: 'Owner + group, no others' },
    { mode: 0o640, desc: 'Group-readable files' },
    { mode: 0o775, desc: 'Group-writable directories' },
    { mode: 0o664, desc: 'Group-writable files' },
    { mode: 0o444, desc: 'Read-only for everyone' },
    { mode: 0o777, desc: 'Everyone can do anything (avoid)' },
    { mode: 0o1777, desc: 'Shared temp directory (/tmp)' },
    { mode: 0o2775, desc: 'Shared team directory' },
    { mode: 0o4755, desc: 'Setuid program' },
]

const FILE_TYPES = [
    { value: 'file', label: 'File' },
    { value: 'dir', label: 'Directory' },
]

function describeClass(mode, { shift }) {
    const parts = PERMS.filter(p => mode & (p.bit << shift)).map(p => p.name.toLowerCase())
    return parts.length ? parts.join(', ') : 'no access'
}

export default function Chmod() {
    const [mode, setMode] = useState(0o755)
    const [text, setText] = useState('755')
    const [fileType, setFileType] = useState('file')
    const [path, setPath] = useState('file.txt')
    const isDirectory = fileType === 'dir'

    // The mode is the source of truth; the text box follows it unless the user is typing
    const setFromMode = (next) => {
        setMode(next)
        setText(formatOctal(next))
    }

    const parsed = parseModeInput(text, mode, { isDirectory })
    const relative = parsed?.kind === 'relative' ? parsed : null

    const onTextChange = (value) => {
        setText(value)
        const result = parseModeInput(value, mode, { isDirectory })
        if (result && !result.error && result.kind !== 'relative') {
            setMode(result.mode)
            if (result.type === 'd') setFileType('dir')
            else if (result.type === '-') setFileType('file')
        }
    }

    const applyRelative = () => {
        if (relative) setFromMode(relative.mode)
    }

    const octal = formatOctal(mode)
    const symbolic = formatSymbolic(mode)
    const lsString = `${isDirectory ? 'd' : '-'}${symbolic}`
    const target = path.trim() || 'file'
    const quoted = /^[\w./-]+$/.test(target) ? target : `'${target.replace(/'/g, `'\\''`)}'`
    const outputs = [
        { key: 'octal', label: 'Octal', value: octal },
        { key: 'symbolic', label: 'Symbolic', value: symbolic },
        { key: 'ls', label: 'ls -l', value: lsString },
        { key: 'cmd', label: 'Command', value: `chmod ${octal} ${quoted}` },
        { key: 'cmd-sym', label: 'Command (symbolic)', value: `chmod ${formatChmodExpression(mode)} ${quoted}` },
    ]

    let hint = 'Octal (755, 4755), symbolic (rwxr-xr-x, drwxr-x---), or a change like u+x, go-w or a=rX.'
    if (parsed?.kind === 'octal' && text.trim().length < 3) hint = `Read as ${formatOctal(parsed.mode).padStart(4, '0')}: chmod pads short values with zeros on the left.`
    if (relative) hint = `Applying “${text.trim()}” to ${formatOctal(mode)} gives ${formatOctal(relative.mode)} (${formatSymbolic(relative.mode)}). Press Enter or Apply.`

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <Field
                    label="Mode"
                    labelAction={relative ? (
                        <button type="button" className="btn btn-primary btn-sm" onClick={applyRelative}>
                            <CornerDownLeft size={14} aria-hidden="true" /> Apply {formatOctal(relative.mode)}
                        </button>
                    ) : null}
                    error={parsed?.error ? `${parsed.error} Showing ${octal}, the last valid mode.` : null}
                    hint={hint}
                >
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => onTextChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') applyRelative()
                        }}
                        onBlur={() => {
                            if (!relative && !parsed?.error && parsed) setText(formatOctal(mode))
                        }}
                        spellCheck={false}
                        autoComplete="off"
                        autoCapitalize="off"
                        className={`mono ${parsed?.error ? 'field-invalid' : ''}`}
                        style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '0.05em' }}
                    />
                </Field>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div role="heading" aria-level={2} className="section-title">Permissions</div>
                    <SegmentedControl ariaLabel="File type" options={FILE_TYPES} value={fileType} onChange={setFileType} size="sm" />
                </div>

                <div
                    role="group"
                    aria-label="Permissions"
                    style={{ display: 'grid', gridTemplateColumns: 'minmax(4.5rem, max-content) repeat(3, minmax(0, 1fr)) minmax(1.5rem, max-content)', alignItems: 'center', gap: 'var(--space-xs) var(--space-sm)' }}
                >
                    <span />
                    {PERMS.map(p => (
                        <span key={p.name} style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>{p.name}</span>
                    ))}
                    <span style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }} aria-hidden="true">#</span>
                    {CLASSES.map(c => (
                        <Fragment key={c.key}>
                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.name}</span>
                            {PERMS.map(p => {
                                const on = !!(mode & (p.bit << c.shift))
                                return (
                                    <button
                                        key={p.name}
                                        type="button"
                                        aria-pressed={on}
                                        aria-label={`${c.name} ${p.name.toLowerCase()}`}
                                        onClick={() => setFromMode(mode ^ (p.bit << c.shift))}
                                        className="mono"
                                        style={{
                                            height: '2.75rem',
                                            width: '100%',
                                            maxWidth: '5rem',
                                            justifySelf: 'center',
                                            borderRadius: 'var(--radius-md)',
                                            border: `1px solid ${on ? 'var(--primary-border)' : 'var(--border)'}`,
                                            background: on ? 'var(--primary-glow)' : 'var(--bg-subtle)',
                                            color: on ? 'var(--primary-text)' : 'var(--text-dim)',
                                            fontSize: '1.1rem',
                                            fontWeight: 700,
                                            transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                                        }}
                                    >
                                        {on ? p.letter : '–'}
                                    </button>
                                )
                            })}
                            <span className="mono" style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)' }} aria-hidden="true">{(mode >> c.shift) & 7}</span>
                        </Fragment>
                    ))}
                </div>

                <div>
                    <div className="field-label">Special bits</div>
                    <div role="group" aria-label="Special bits" style={{ display: 'grid', gap: 'var(--space-xs)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))' }}>
                        {SPECIALS.map(s => {
                            const on = !!(mode & s.bit)
                            return (
                                <button
                                    key={s.name}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => setFromMode(mode ^ s.bit)}
                                    style={{
                                        textAlign: 'left',
                                        padding: '0.5rem 0.75rem',
                                        borderRadius: 'var(--radius-md)',
                                        border: `1px solid ${on ? 'var(--primary-border)' : 'var(--border)'}`,
                                        background: on ? 'var(--primary-glow)' : 'var(--bg-subtle)',
                                    }}
                                >
                                    <span style={{ fontWeight: 600, color: on ? 'var(--primary-text)' : 'var(--text-main)' }}>{s.name}</span>{' '}
                                    <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{s.octal}</span>
                                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)' }}>{isDirectory ? s.dir : s.file}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            </section>

            <section className="card" style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div role="heading" aria-level={2} className="section-title">Result</div>
                    <Field label="Path in commands" style={{ flex: '0 1 14rem', minWidth: 0 }}>
                        <input type="text" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} autoComplete="off" className="mono" style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }} />
                    </Field>
                </div>
                <div style={{ display: 'grid', gap: 'var(--space-xs)' }}>
                    {outputs.map(o => (
                        <div key={o.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '0.45rem 0.75rem', background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--primary-text)' }}>{o.label}</div>
                                <div className="mono" style={{ overflowWrap: 'anywhere', color: 'var(--text-code)' }}>{o.value}</div>
                            </div>
                            <CopyButton text={o.value} iconOnly label={`Copy ${o.label.toLowerCase()}`} />
                        </div>
                    ))}
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--text-muted)', display: 'grid', gap: 2 }}>
                    {CLASSES.map(c => <li key={c.key}><strong style={{ color: 'var(--text-main)', fontWeight: 600 }}>{c.name}</strong>: {describeClass(mode, c)}</li>)}
                    {SPECIALS.filter(s => mode & s.bit).map(s => <li key={s.name}><strong style={{ color: 'var(--text-main)', fontWeight: 600 }}>{s.name}</strong>: {isDirectory ? s.dir : s.file}</li>)}
                </ul>
            </section>

            <section className="card">
                <div role="heading" aria-level={2} className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>Common modes</div>
                <div style={{ display: 'grid', gap: 'var(--space-xs)', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 11rem), 1fr))' }}>
                    {PRESETS.map(p => {
                        const active = mode === p.mode
                        return (
                            <button
                                key={p.mode}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setFromMode(p.mode)}
                                style={{
                                    textAlign: 'left',
                                    padding: '0.5rem 0.75rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: `1px solid ${active ? 'var(--primary-border)' : 'var(--border)'}`,
                                    background: active ? 'var(--primary-glow)' : 'var(--bg-subtle)',
                                }}
                            >
                                <span className="mono" style={{ display: 'block', fontWeight: 700, color: active ? 'var(--primary-text)' : 'var(--text-main)' }}>
                                    {formatOctal(p.mode)} <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--text-dim)' }}>{formatSymbolic(p.mode)}</span>
                                </span>
                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)' }}>{p.desc}</span>
                            </button>
                        )
                    })}
                </div>
            </section>
        </div>
    )
}
