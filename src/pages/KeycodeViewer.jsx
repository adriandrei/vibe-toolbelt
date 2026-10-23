import { useId, useRef, useState } from 'react'
import { Keyboard, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import StatusBanner from '../components/ui/StatusBanner'
import { isMacPlatform } from '../utils/palette'

const HISTORY_LIMIT = 50
const LOCATIONS = ['Standard key', 'Left-hand key', 'Right-hand key', 'Numpad key']

// Keys whose default action would scroll the page or type into it while the
// capture area has focus. Modifier shortcuts (⌘K, Ctrl+W…) and Tab always
// keep working.
const SCROLL_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Backspace', 'Enter'])

const MODIFIERS = [
    { prop: 'ctrl', label: 'Ctrl', key: 'Control' },
    { prop: 'shift', label: 'Shift', key: 'Shift' },
    { prop: 'alt', label: isMacPlatform ? 'Option' : 'Alt', key: 'Alt' },
    { prop: 'meta', label: isMacPlatform ? 'Command' : 'Meta', key: 'Meta' },
]

const isTouchOnly = () => {
    try {
        return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches
    } catch {
        return false
    }
}

function keyLabel(key) {
    if (key === ' ') return 'Space'
    if (key === '') return '(empty)'
    return key
}

function KeyCard({ label, value, note, copyValue }) {
    return (
        <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-xs)' }}>
                <span className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{label}</span>
                <CopyButton text={copyValue ?? String(value)} iconOnly label={`Copy ${label}`} />
            </div>
            <span className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', overflowWrap: 'anywhere' }}>{value}</span>
            {note && <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{note}</span>}
        </div>
    )
}

export default function KeycodeViewer() {
    const hintId = useId()
    const [event, setEvent] = useState(null)
    const [history, setHistory] = useState([])
    const [focused, setFocused] = useState(false)
    const [announcement, setAnnouncement] = useState('')
    const [touchOnly] = useState(isTouchOnly)
    const nextId = useRef(1)

    const handleKeyDown = (e) => {
        const modified = e.ctrlKey || e.metaKey || e.altKey
        if (!modified && (SCROLL_KEYS.has(e.key) || e.key.length === 1)) e.preventDefault()

        const entry = {
            id: nextId.current++,
            key: e.key,
            code: e.code,
            keyCode: e.keyCode,
            which: e.which,
            location: e.location,
            repeat: e.repeat,
            composing: e.nativeEvent.isComposing || e.keyCode === 229,
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            meta: e.metaKey,
        }
        setEvent(entry)
        if (entry.repeat) return
        setHistory(prev => [entry, ...prev].slice(0, HISTORY_LIMIT))
        const mods = MODIFIERS.filter(m => entry[m.prop] && entry.key !== m.key).map(m => m.label)
        setAnnouncement(`${[...mods, keyLabel(entry.key)].join(' + ')}, code ${entry.code || 'none'}`)
    }

    const activeMods = event ? MODIFIERS.filter(m => event[m.prop]) : []

    return (
        <div className="page page-medium page-keycode">
            <ToolHeader />

            {touchOnly && (
                <StatusBanner tone="info" title="Needs a hardware keyboard">
                    On-screen keyboards only open for text fields, and most report key “Unidentified” (keyCode 229) while composing text. Connect a keyboard to see real key codes.
                </StatusBanner>
            )}

            <div
                role="application"
                tabIndex={0}
                aria-label="Key capture area"
                aria-describedby={hintId}
                onKeyDown={handleKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                // Pasting here isn't meaningful; don't trigger Smart Paste suggestions
                onPaste={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                }}
                style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-sm)',
                    minHeight: 'clamp(13rem, 32vh, 18rem)',
                    padding: 'var(--space-lg) var(--space-md)',
                    textAlign: 'center',
                    borderRadius: 'var(--radius-lg)',
                    border: focused ? '2px solid var(--primary)' : '2px dashed var(--border-strong)',
                    background: focused ? 'var(--primary-glow)' : 'var(--bg-subtle)',
                    boxShadow: focused ? '0 0 0 4px var(--primary-glow)' : 'none',
                    outline: 'none',
                    cursor: focused ? 'default' : 'pointer',
                    transition: 'border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
                    userSelect: 'none',
                    minWidth: 0,
                    containerType: 'inline-size',
                }}
            >
                {event ? (
                    <>
                        <div className="mono" style={{ fontSize: 'clamp(2rem, 11cqi, 4.5rem)', fontWeight: 800, lineHeight: 1.05, color: 'var(--primary-text)', overflowWrap: 'anywhere', maxWidth: '100%' }}>
                            {keyLabel(event.key)}
                        </div>
                        <div className="mono" style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>
                            code <strong style={{ color: 'var(--text-main)' }}>{event.code || '(none)'}</strong>
                        </div>
                        <div role="group" aria-label="Modifier keys" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'var(--space-xs)', marginTop: 'var(--space-xs)' }}>
                            {MODIFIERS.map(m => (
                                <span key={m.prop} className={`badge ${event[m.prop] ? 'badge-primary' : ''}`} style={{ opacity: event[m.prop] ? 1 : 0.75 }}>
                                    {m.label}
                                    <span className="sr-only">{event[m.prop] ? ' (held)' : ' (not held)'}</span>
                                </span>
                            ))}
                            {event.repeat && <span className="badge badge-info">Repeating</span>}
                            {event.composing && <span className="badge badge-warning">Composing (IME)</span>}
                        </div>
                    </>
                ) : (
                    <>
                        <Keyboard size={40} aria-hidden="true" style={{ color: focused ? 'var(--primary-text)' : 'var(--text-dim)' }} />
                        <div style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>
                            {focused ? 'Listening… press any key' : 'Click here, then press keys'}
                        </div>
                    </>
                )}
                <div id={hintId} style={{ fontSize: '0.8rem', color: 'var(--text-dim)', maxWidth: '46ch' }}>
                    {focused
                        ? `Keys are captured only while this box has focus. Tab moves on; shortcuts like ${isMacPlatform ? '⌘K' : 'Ctrl+K'} still work.`
                        : event ? 'Click here to capture more keys.' : 'Keys are captured only while this box has focus.'}
                </div>
            </div>

            <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

            {event && (
                <section aria-label="Key event properties" className="auto-grid" style={{ '--auto-grid-min': '9.5rem' }}>
                    <KeyCard label="event.key" value={keyLabel(event.key)} copyValue={JSON.stringify(event.key)} note="The character or key name" />
                    <KeyCard label="event.code" value={event.code || '(none)'} copyValue={JSON.stringify(event.code)} note="Physical key, ignores layout" />
                    <KeyCard label="event.location" value={event.location} note={LOCATIONS[event.location] ?? 'Unknown location'} />
                    <KeyCard label="Modifiers" value={activeMods.length ? activeMods.map(m => m.label).join(' + ') : 'None'} copyValue={activeMods.map(m => `${m.prop}Key`).join(', ') || 'none'} note="ctrlKey, shiftKey, altKey, metaKey" />
                    <KeyCard label="event.keyCode" value={event.keyCode} note="Deprecated: use key or code" />
                    <KeyCard label="event.which" value={event.which} note="Deprecated: use key or code" />
                </section>
            )}

            {history.length > 0 && (
                <section className="card card-compact" aria-labelledby={`${hintId}-history`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                        <h2 id={`${hintId}-history`} className="section-title">Recent keys <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({history.length})</span></h2>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                                setHistory([])
                                setEvent(null)
                                setAnnouncement('History cleared')
                            }}
                        >
                            <Trash2 size={14} aria-hidden="true" /> Clear
                        </button>
                    </div>
                    <ol role="list" style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                        {history.map((h, index) => (
                            <li
                                key={h.id}
                                title={`code ${h.code || '(none)'} · keyCode ${h.keyCode}`}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    minWidth: '3.25rem',
                                    padding: '0.35rem 0.6rem',
                                    borderRadius: 'var(--radius-sm)',
                                    border: `1px solid ${index === 0 ? 'var(--primary-border)' : 'var(--border)'}`,
                                    background: index === 0 ? 'var(--primary-glow)' : 'var(--bg-subtle)',
                                }}
                            >
                                <span className="mono" style={{ fontWeight: 600, fontSize: '0.85rem', color: index === 0 ? 'var(--primary-text)' : 'var(--text-main)' }}>
                                    {h.key === ' ' ? '␣' : keyLabel(h.key)}
                                </span>
                                <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{h.code || '—'}</span>
                            </li>
                        ))}
                    </ol>
                </section>
            )}
        </div>
    )
}
