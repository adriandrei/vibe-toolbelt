import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import SliderField from '../components/ui/SliderField'
import StatusBanner from '../components/ui/StatusBanner'
import { ALPHABET_PRESETS, NANOID_ALPHABET, decodeUlid, idsForCollisionProbability, nanoid, ulid, validateAlphabet } from '../utils/ids'

const TYPES = [
    { value: 'nanoid', label: 'Nano ID' },
    { value: 'ulid', label: 'ULID' },
]

const DEFAULTS = { type: 'nanoid', count: 10, size: 21, alphabet: NANOID_ALPHABET }

function generateBatch({ type, count, size, alphabet }) {
    if (type === 'ulid') return { ids: Array.from({ length: count }, () => ulid()) }
    const check = validateAlphabet(alphabet)
    if (check.error) return { ids: [], error: check.error }
    return { ids: Array.from({ length: count }, () => nanoid(size, check.symbols)) }
}

function formatCount(n) {
    if (!Number.isFinite(n)) return '∞'
    if (n < 1e6) return Math.round(n).toLocaleString()
    const exp = Math.floor(Math.log10(n))
    return <>{(n / 10 ** exp).toFixed(1)} × 10<sup>{exp}</sup></>
}

function UlidDecoder() {
    const [value, setValue] = useState('')
    const decoded = value.trim() ? decodeUlid(value) : null
    const date = decoded && !decoded.error ? new Date(decoded.ms) : null
    return (
        <Field
            label="Read a ULID’s timestamp"
            error={decoded?.error}
            hint={date ? `${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })} · ${date.toISOString()} (${decoded.ms} ms)` : 'Paste a ULID to see when it was created.'}
        >
            <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder="01ARYZ6S41TSV4RRFFQ69G5FAV" spellCheck={false} autoComplete="off" className="mono" />
        </Field>
    )
}

export default function NanoId() {
    const [settings, setSettings] = useState(DEFAULTS)
    const [batch, setBatch] = useState(() => generateBatch(DEFAULTS))
    const { type, count, size, alphabet } = settings

    const update = (patch) => {
        const next = { ...settings, ...patch }
        setSettings(next)
        setBatch(generateBatch(next))
    }

    const check = useMemo(() => validateAlphabet(alphabet), [alphabet])
    const activePreset = ALPHABET_PRESETS.find(p => p.value === alphabet)
    const bits = type === 'ulid' ? 80 : check.error ? 0 : size * Math.log2(check.symbols.length)
    const collisionAt = bits ? idsForCollisionProbability(bits) : 0
    const all = batch.ids.join('\n')

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <SegmentedControl ariaLabel="ID type" options={TYPES} value={type} onChange={(value) => update({ type: value })} />

                {type === 'nanoid' ? (
                    <div className="field-hint" style={{ marginTop: 0 }}>
                        Short random IDs (URL-safe by default). Every character is equally likely: random bytes that don’t map to the alphabet are discarded instead of wrapped around.
                    </div>
                ) : (
                    <div className="field-hint" style={{ marginTop: 0 }}>
                        26 characters of Crockford Base32: a 48-bit millisecond timestamp, then 80 random bits. IDs made in the same millisecond increment the random part, so they sort in creation order.
                        Need UUIDs (including time-ordered v7)? Use the <Link to="/uuid" style={{ color: 'var(--primary-text)', textDecoration: 'underline' }}>UUID Generator</Link>.
                    </div>
                )}

                <div style={{ display: 'grid', gap: 'var(--space-md)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))' }}>
                    <SliderField label="How many" value={count} onChange={(value) => update({ count: value })} min={1} max={100} showInput />
                    {type === 'nanoid' && <SliderField label="Length" value={size} onChange={(value) => update({ size: value })} min={4} max={64} showInput />}
                </div>

                {type === 'nanoid' && (
                    <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                        <div>
                            <div className="field-label">Alphabet</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }} role="group" aria-label="Alphabet presets">
                                {ALPHABET_PRESETS.map(p => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        className={`chip ${activePreset?.id === p.id ? 'is-active' : ''}`}
                                        aria-pressed={activePreset?.id === p.id}
                                        onClick={() => update({ alphabet: p.value })}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                                {!activePreset && <span className="chip is-active" aria-hidden="true">Custom</span>}
                            </div>
                        </div>
                        <Field
                            label="Characters"
                            error={check.error}
                            hint={check.error ? undefined : `${check.symbols.length} unique characters${check.warning ? `. ${check.warning}` : ''}`}
                        >
                            <input type="text" value={alphabet} onChange={(e) => update({ alphabet: e.target.value })} spellCheck={false} autoComplete="off" className="mono" />
                        </Field>
                    </div>
                )}

                {bits > 0 && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {type === 'ulid' ? '80 random bits per millisecond' : `${bits.toFixed(1)} bits of randomness per ID`} · a 1% chance of any collision after about {formatCount(collisionAt)} IDs{type === 'ulid' ? ' made in the same millisecond' : ''}.
                    </div>
                )}
            </section>

            <section className="card" style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div role="heading" aria-level={2} className="section-title">
                        {type === 'ulid' ? 'ULIDs' : 'Nano IDs'} <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: '0.85rem' }}>{batch.ids.length}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBatch(generateBatch(settings))} disabled={!!batch.error}>
                            <RefreshCw size={14} aria-hidden="true" /> Regenerate
                        </button>
                        <CopyButton text={all} label="Copy all" variant="primary" disabled={!all} />
                    </div>
                </div>

                {batch.error ? (
                    <StatusBanner tone="danger" title="Fix the alphabet to generate IDs">{batch.error}</StatusBanner>
                ) : (
                    <ol style={{ listStyle: 'none', display: 'grid', gap: 2, maxHeight: 440, overflowY: 'auto', padding: 'var(--space-xs)', margin: 0, background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }} aria-label="Generated IDs">
                        {batch.ids.map((id, i) => (
                            <li key={`${i}-${id}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '0.2rem 0.4rem', borderRadius: 'var(--radius-sm)' }}>
                                <span style={{ width: '2ch', flexShrink: 0, textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }} aria-hidden="true">{i + 1}</span>
                                <span className="mono" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: '0.9rem', color: 'var(--text-code)' }}>{id}</span>
                                <CopyButton text={id} iconOnly label={`Copy ID ${i + 1}`} />
                            </li>
                        ))}
                    </ol>
                )}
            </section>

            {type === 'ulid' && (
                <section className="card">
                    <UlidDecoder />
                </section>
            )}
        </div>
    )
}
