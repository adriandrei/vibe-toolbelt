import { useMemo, useState } from 'react'
import { v1 as uuidv1, v4 as uuidv4, v5 as uuidv5, v7 as uuidv7 } from 'uuid'
import { RefreshCw } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import SliderField from '../components/ui/SliderField'
import StatusBanner from '../components/ui/StatusBanner'
import { useSmartInput } from '../hooks/useSmartInput'
import { parseUuid } from '../utils/ids'

const VERSIONS = [
    { value: 'v4', label: 'v4', title: 'Random' },
    { value: 'v7', label: 'v7', title: 'Time-ordered' },
    { value: 'v1', label: 'v1', title: 'Time + node' },
    { value: 'v5', label: 'v5', title: 'Name-based' },
]

const VERSION_INFO = {
    v4: '122 random bits. The default choice for unique IDs.',
    v7: 'A Unix millisecond timestamp followed by random bits, so IDs sort by creation time. Good for database keys.',
    v1: 'A timestamp, a clock sequence and a node ID (random here, not your MAC address). Prefer v7 for new systems.',
    v5: 'A SHA-1 hash of a namespace and a name: the same input always gives the same UUID. One UUID per line of names.',
}

const NAMESPACES = [
    { value: 'dns', label: 'DNS', uuid: uuidv5.DNS },
    { value: 'url', label: 'URL', uuid: uuidv5.URL },
    { value: 'oid', label: 'ISO OID', uuid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8' },
    { value: 'x500', label: 'X.500 DN', uuid: '6ba7b814-9dad-11d1-80b4-00c04fd430c8' },
    { value: 'custom', label: 'Custom…' },
]

const MAX_NAMES = 1000

function makeRandom(version, count) {
    const make = version === 'v7' ? uuidv7 : version === 'v1' ? uuidv1 : uuidv4
    return Array.from({ length: count }, () => make())
}

function formatUuid(id, { upper, hyphens, braces }) {
    let out = hyphens ? id : id.replace(/-/g, '')
    if (upper) out = out.toUpperCase()
    return braces ? `{${out}}` : out
}

function Inspector({ value, onChange }) {
    const parsed = value.trim() ? parseUuid(value) : null
    const rows = []
    if (parsed && !parsed.error) {
        rows.push(['Canonical', <span key="c" className="mono">{parsed.canonical}</span>])
        if (parsed.special) rows.push(['Type', parsed.special])
        else {
            rows.push(['Version', parsed.standard ? `${parsed.version}: ${parsed.versionName}` : `${parsed.version} (not meaningful for this variant)`])
            rows.push(['Variant', parsed.variant])
            if (parsed.timestamp !== undefined) {
                const date = new Date(parsed.timestamp)
                rows.push(['Created', Number.isNaN(date.getTime()) ? 'out of range' : `${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })} (${date.toISOString()})`])
            }
            if (parsed.clockSeq !== undefined) rows.push(['Clock sequence', String(parsed.clockSeq)])
            if (parsed.node) rows.push(['Node', <span key="n"><span className="mono">{parsed.node}</span>{parsed.randomNode ? ' (random, multicast bit set)' : ' (may be a MAC address)'}</span>])
        }
    }
    return (
        <section className="card" style={{ display: 'grid', gap: 'var(--space-sm)' }}>
            <div role="heading" aria-level={2} className="section-title">Inspect a UUID</div>
            <Field label="UUID" error={parsed?.error} hint="Any spelling works: braces, no hyphens, upper case or urn:uuid:.">
                <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="018f2a6e-7c1d-7b9a-9f3e-2b1c4d5e6f70" spellCheck={false} autoComplete="off" className="mono" />
            </Field>
            {rows.length > 0 && (
                <div role="table" aria-label="UUID details">
                    {rows.map(([name, content]) => (
                        <div key={name} role="row" style={{ display: 'grid', gridTemplateColumns: 'minmax(7rem, max-content) minmax(0, 1fr)', gap: 'var(--space-md)', padding: '0.4rem 0', borderTop: '1px solid var(--border)', fontSize: '0.9rem' }}>
                            <div role="rowheader" style={{ color: 'var(--text-muted)' }}>{name}</div>
                            <div role="cell" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{content}</div>
                        </div>
                    ))}
                </div>
            )}
            {parsed && !parsed.error && !parsed.special && !parsed.standard && (
                <StatusBanner tone="warning" title="Not a standard UUID">The variant bits mark it as {parsed.variant}, so the version number doesn’t mean anything.</StatusBanner>
            )}
        </section>
    )
}

export default function Uuid() {
    const [version, setVersion] = useState('v4')
    const [count, setCount] = useState(5)
    const [randomIds, setRandomIds] = useState(() => makeRandom('v4', 5))
    const [namespace, setNamespace] = useState('dns')
    const [customNamespace, setCustomNamespace] = useState('')
    const [names, setNames] = useState('example.com')
    const [format, setFormat] = useState({ upper: false, hyphens: true, braces: false })
    const [inspect, setInspect] = useState('')

    useSmartInput({ input: setInspect })

    const regenerate = (nextVersion = version, nextCount = count) => {
        if (nextVersion !== 'v5') setRandomIds(makeRandom(nextVersion, nextCount))
    }

    const namespaceUuid = namespace === 'custom' ? customNamespace.trim() : NAMESPACES.find(n => n.value === namespace).uuid
    const namespaceCheck = useMemo(
        () => (namespace === 'custom' ? (customNamespace.trim() ? parseUuid(customNamespace) : { error: 'Enter the namespace UUID.' }) : null),
        [namespace, customNamespace],
    )

    const nameBased = useMemo(() => {
        if (version !== 'v5') return null
        if (namespaceCheck?.error) return { ids: [], error: `Namespace: ${namespaceCheck.error}` }
        const ns = namespaceCheck ? namespaceCheck.canonical : namespaceUuid
        const lines = names.split('\n').filter(line => line !== '')
        if (!lines.length) return { ids: [], error: 'Enter at least one name.' }
        return { ids: lines.slice(0, MAX_NAMES).map(line => uuidv5(line, ns)), names: lines.slice(0, MAX_NAMES), truncated: lines.length > MAX_NAMES }
    }, [version, names, namespaceUuid, namespaceCheck])

    const ids = version === 'v5' ? nameBased.ids : randomIds
    const formatted = ids.map(id => formatUuid(id, format))
    const all = formatted.join('\n')

    const toggle = (key) => setFormat(f => ({ ...f, [key]: !f[key] }))

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <div>
                    <div className="field-label">Version</div>
                    <SegmentedControl
                        ariaLabel="UUID version"
                        options={VERSIONS.map(v => ({ value: v.value, label: `${v.label} · ${v.title}` }))}
                        value={version}
                        onChange={(next) => {
                            setVersion(next)
                            regenerate(next)
                        }}
                    />
                    <div className="field-hint">{VERSION_INFO[version]}</div>
                </div>

                {version === 'v5' ? (
                    <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
                        <div style={{ display: 'grid', gap: 'var(--space-md)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))' }}>
                            <Field label="Namespace" hint={namespace !== 'custom' ? namespaceUuid : undefined}>
                                <select value={namespace} onChange={(e) => setNamespace(e.target.value)}>
                                    {NAMESPACES.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
                                </select>
                            </Field>
                            {namespace === 'custom' && (
                                <Field label="Namespace UUID" error={customNamespace.trim() ? namespaceCheck?.error : undefined}>
                                    <input type="text" value={customNamespace} onChange={(e) => setCustomNamespace(e.target.value)} placeholder="6ba7b810-9dad-11d1-80b4-00c04fd430c8" spellCheck={false} autoComplete="off" className="mono" />
                                </Field>
                            )}
                        </div>
                        <Field label="Names (one per line)" hint={nameBased?.truncated ? `Only the first ${MAX_NAMES} lines are used.` : 'Each line is hashed exactly as typed (case and spaces matter).'}>
                            <textarea value={names} onChange={(e) => setNames(e.target.value)} spellCheck={false} style={{ minHeight: 100 }} />
                        </Field>
                    </div>
                ) : (
                    <SliderField
                        label="How many"
                        value={count}
                        onChange={(next) => {
                            setCount(next)
                            regenerate(version, next)
                        }}
                        min={1}
                        max={100}
                        showInput
                    />
                )}

                <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                    <legend className="field-label">Format</legend>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', fontSize: '0.9rem' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="checkbox" checked={format.upper} onChange={() => toggle('upper')} /> Uppercase
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="checkbox" checked={format.hyphens} onChange={() => toggle('hyphens')} /> Hyphens
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="checkbox" checked={format.braces} onChange={() => toggle('braces')} /> Braces {'{…}'}
                        </label>
                    </div>
                </fieldset>
            </section>

            <section className="card" style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div role="heading" aria-level={2} className="section-title">
                        UUID {version} <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: '0.85rem' }}>{formatted.length}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        {version !== 'v5' && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => regenerate()}>
                                <RefreshCw size={14} aria-hidden="true" /> Regenerate
                            </button>
                        )}
                        <CopyButton text={all} label="Copy all" variant="primary" disabled={!all} />
                    </div>
                </div>
                {nameBased?.error ? (
                    <StatusBanner tone="danger" title="Can’t generate name-based UUIDs">{nameBased.error}</StatusBanner>
                ) : (
                    <ol style={{ listStyle: 'none', display: 'grid', gap: 2, maxHeight: 440, overflowY: 'auto', padding: 'var(--space-xs)', margin: 0, background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }} aria-label="Generated UUIDs">
                        {formatted.map((id, i) => (
                            <li key={`${i}-${id}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '0.2rem 0.4rem' }}>
                                <span className="mono" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: '0.9rem', color: 'var(--text-code)' }}>
                                    {id}
                                    {nameBased?.names && <span style={{ display: 'block', fontFamily: 'var(--font-family)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>{nameBased.names[i]}</span>}
                                </span>
                                <CopyButton text={id} iconOnly label={`Copy UUID ${i + 1}`} />
                            </li>
                        ))}
                    </ol>
                )}
            </section>

            <Inspector value={inspect} onChange={setInspect} />
        </div>
    )
}
