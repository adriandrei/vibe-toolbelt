import { useEffect, useId, useMemo, useState } from 'react'
import { Clock, Pause, Play, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { useSmartInput } from '../hooks/useSmartInput'
import {
    LOCAL_TIME_ZONE, UNIT_INFO,
    formatInUnit, formatLocal, formatRelativeTo, formatUtc, formatUtcOffset,
    nsFromMs, parseTimestamp, toDateTimeLocalValue, toIsoString, wholeSeconds,
} from '../utils/timestamp'

const UNIT_OPTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: 's', label: 's', title: 'Seconds' },
    { value: 'ms', label: 'ms', title: 'Milliseconds' },
    { value: 'us', label: 'µs', title: 'Microseconds' },
    { value: 'ns', label: 'ns', title: 'Nanoseconds' },
]

const ZONE_NOTES = {
    'utc-date-only': 'A date without a time is read as midnight UTC.',
    local: `No time zone in the text, so it’s read as local time (${LOCAL_TIME_ZONE}).`,
    explicit: 'Time zone taken from the text.',
}

function ResultRow({ label, value, copyLabel, mono = true }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-xs) var(--space-md)', padding: '0.55rem 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <dt style={{ color: 'var(--text-muted)', fontSize: '0.85rem', flex: '1 1 9rem' }}>{label}</dt>
            <dd style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-xs)', flex: '999 1 15rem', minWidth: 0 }}>
                <span style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit', fontSize: '0.9rem', color: 'var(--text-main)', textAlign: 'right', overflowWrap: 'anywhere' }}>
                    {value}
                </span>
                <CopyButton text={value} iconOnly label={copyLabel ?? `Copy ${label}`} />
            </dd>
        </div>
    )
}

function readAs(parsed) {
    if (parsed.source !== 'number') return null
    const unit = UNIT_INFO[parsed.unit].label
    if (parsed.manual) return `Read as ${unit} (your choice)`
    return `Read as ${unit} (${parsed.digits} digit${parsed.digits === 1 ? '' : 's'})`
}

export default function UnixTimestamp() {
    const pickerId = useId()
    const titleId = useId()
    const [input, setInput] = useState('')
    const [unit, setUnit] = useState('auto')
    const [paused, setPaused] = useState(false)
    const [now, setNow] = useState(() => Date.now())

    const loadInput = (value) => {
        setInput(value)
        setNow(Date.now())
    }

    useSmartInput({
        input: (value) => {
            loadInput(value)
            setUnit('auto')
        },
    })

    const parsed = useMemo(() => parseTimestamp(input, unit), [input, unit])
    const live = parsed.status === 'empty'
    const ticking = live && !paused

    // The clock only runs while showing the current time, on second boundaries
    useEffect(() => {
        if (!ticking) return undefined
        let timer
        const tick = () => {
            setNow(Date.now())
            timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5)
        }
        timer = setTimeout(tick, 0)
        return () => clearTimeout(timer)
    }, [ticking])

    // The live clock shows whole seconds
    const liveMs = Math.floor(now / 1000) * 1000
    const view = parsed.status === 'ok'
        ? { ns: parsed.ns, ms: parsed.ms, date: parsed.date }
        : live
            ? { ns: nsFromMs(liveMs), ms: liveMs, date: new Date(liveMs) }
            : null

    const numeric = parsed.source === 'number'
    const usedUnit = numeric ? parsed.unit : null
    const year = view ? view.date.getUTCFullYear() : null
    const farAway = parsed.status === 'ok' && numeric && !parsed.manual && (year < 1900 || year > 2200)
    const pickerValue = view && !live ? toDateTimeLocalValue(view.date) : ''

    return (
        <div className="page page-medium page-unix">
            <ToolHeader />

            <section className="card" aria-label="Input" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <Field
                    label="Timestamp or date"
                    hint="Seconds, ms, µs or ns since 1970 (negative and decimal values work), or a date like 2024-05-01T12:00:00Z. Leave it empty to see the current time."
                >
                    <input
                        type="text"
                        className={parsed.status === 'error' ? 'field-invalid' : undefined}
                        aria-invalid={parsed.status === 'error' || undefined}
                        value={input}
                        onChange={(e) => loadInput(e.target.value)}
                        placeholder="Paste timestamp or date…"
                        spellCheck={false}
                        autoComplete="off"
                        style={{ fontFamily: 'var(--font-mono)' }}
                    />
                </Field>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                    {numeric ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', minWidth: 0 }}>
                            <span className="field-label" style={{ marginBottom: 0 }}>Unit</span>
                            <SegmentedControl
                                ariaLabel="Unit of the number"
                                size="sm"
                                value={unit}
                                onChange={setUnit}
                                options={UNIT_OPTIONS.map(o => (o.value === 'auto'
                                    ? { ...o, label: `Auto (${UNIT_INFO[parsed.autoUnit].short})` }
                                    : o))}
                            />
                        </div>
                    ) : (
                        <span className="field-hint" style={{ marginTop: 0 }}>Numbers are read by digit count: 10 = s, 13 = ms, 16 = µs, 19 = ns.</span>
                    )}
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', marginLeft: 'auto' }}>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                                loadInput(String(Math.floor(Date.now() / 1000)))
                                setUnit('auto')
                            }}
                        >
                            <Clock size={14} aria-hidden="true" /> Now
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadInput('')} disabled={!input}>
                            <X size={14} aria-hidden="true" /> Clear
                        </button>
                    </div>
                </div>

                <div>
                    <label className="field-label" htmlFor={pickerId}>
                        Or pick a date and time <span style={{ fontWeight: 400 }}>({LOCAL_TIME_ZONE}, {formatUtcOffset(view?.date ?? new Date(now))})</span>
                    </label>
                    <input
                        id={pickerId}
                        type="datetime-local"
                        step="1"
                        value={pickerValue}
                        onChange={(e) => {
                            if (!e.target.value) return
                            const ms = new Date(e.target.value).getTime()
                            if (Number.isNaN(ms)) return
                            loadInput(String(Math.floor(ms / 1000)))
                            setUnit('auto')
                        }}
                        style={{ maxWidth: '22rem' }}
                    />
                </div>
            </section>

            <section className="card" aria-labelledby={titleId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <h2 id={titleId} className="section-title">{live ? 'Current time' : 'Converted result'}</h2>
                    {live ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPaused(p => !p)} aria-pressed={paused}>
                            {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                            {paused ? 'Resume' : 'Pause'}
                        </button>
                    ) : parsed.status === 'ok' ? (
                        <span className="badge badge-primary">{numeric ? readAs(parsed) : 'Read as a date'}</span>
                    ) : null}
                </div>

                {parsed.status === 'error' && (
                    <StatusBanner tone="danger" title="Can’t convert this">{parsed.message}</StatusBanner>
                )}

                {view && (
                    <>
                        <div style={{ containerType: 'inline-size', textAlign: 'center', padding: 'var(--space-sm) 0' }}>
                            <div
                                style={{
                                    fontSize: 'clamp(1.75rem, 11cqi, 4rem)',
                                    fontFamily: 'var(--font-mono)',
                                    fontWeight: 700,
                                    color: 'var(--primary-text)',
                                    textShadow: '0 0 24px var(--primary-glow)',
                                    lineHeight: 1.1,
                                    overflowWrap: 'anywhere',
                                    fontVariantNumeric: 'tabular-nums',
                                }}
                            >
                                {wholeSeconds(view.ns)}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.12em', marginTop: 'var(--space-xs)' }}>SECONDS</div>
                        </div>

                        {parsed.status === 'ok' && parsed.source === 'date' && <StatusBanner tone="info">{ZONE_NOTES[parsed.zone]}</StatusBanner>}
                        {farAway && (
                            <StatusBanner tone="info">
                                Read as {UNIT_INFO[usedUnit].label}, that’s the year {year.toLocaleString()}. If the number is in another unit, choose it above.
                            </StatusBanner>
                        )}
                        {parsed.truncated && <StatusBanner tone="info">Digits beyond nanosecond precision were ignored.</StatusBanner>}

                        <dl style={{ margin: 0 }}>
                            <ResultRow label="Seconds" value={formatInUnit(view.ns, 's')} />
                            <ResultRow label="Milliseconds" value={formatInUnit(view.ns, 'ms')} />
                            {(usedUnit === 'us' || usedUnit === 'ns') && <ResultRow label="Microseconds" value={formatInUnit(view.ns, 'us')} />}
                            {usedUnit === 'ns' && <ResultRow label="Nanoseconds" value={formatInUnit(view.ns, 'ns')} />}
                            <ResultRow label="ISO 8601 (UTC)" value={toIsoString(view.date, view.ns)} copyLabel="Copy ISO date" />
                            <ResultRow label={`Local (${LOCAL_TIME_ZONE})`} value={formatLocal(view.date)} mono={false} copyLabel="Copy local time" />
                            <ResultRow label="UTC" value={formatUtc(view.date)} mono={false} copyLabel="Copy UTC time" />
                            <ResultRow label="HTTP date (RFC 9110)" value={view.date.toUTCString()} copyLabel="Copy HTTP date" />
                            {!live && <ResultRow label="Relative" value={formatRelativeTo(view.ms, now)} mono={false} copyLabel="Copy relative time" />}
                        </dl>
                    </>
                )}
            </section>
        </div>
    )
}
