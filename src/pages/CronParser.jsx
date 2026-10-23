import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { useSmartInput } from '../hooks/useSmartInput'
import { CRON_FIELDS, LAYOUT_NOTES, analyzeCron, describeField } from '../utils/cron'
import { LOCAL_TIME_ZONE, formatRelativeTo } from '../utils/timestamp'

const EXAMPLES = [
    { expr: '*/15 * * * *', label: 'Every quarter hour' },
    { expr: '0 * * * *', label: 'Hourly' },
    { expr: '0 9 * * 1-5', label: 'Weekdays at 9' },
    { expr: '30 2 * * 0', label: 'Sundays at 2:30' },
    { expr: '0 0 1 * *', label: 'Monthly' },
    { expr: '0 0 L * *', label: 'Last day of the month' },
    { expr: '@daily', label: 'Daily macro' },
    { expr: '0 */10 * * * *', label: 'With seconds' },
]

const RUN_COUNTS = [5, 10, 25]

// Follow the locale's clock style by default (e.g. 24-hour in most of Europe)
const LOCALE_USES_24H = (() => {
    try {
        const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle
        return cycle === 'h23' || cycle === 'h24'
    } catch {
        return false
    }
})()

const pad = (n) => String(n).padStart(2, '0')

// ISO 8601 with the offset of the chosen zone, without milliseconds
function toIsoInZone(date, timezone) {
    if (timezone === 'utc') return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
    const offset = -date.getTimezoneOffset()
    const sign = offset >= 0 ? '+' : '-'
    const abs = Math.abs(offset)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function layoutLabel(split) {
    if (split.macro && split.expansion) return `${split.macro} = ${split.expansion}`
    if (split.layout === 5) return '5 fields'
    if (split.layout === '6-seconds') return '6 fields · seconds first'
    if (split.layout === '6-year') return '6 fields · year last'
    if (split.layout === 7) return '7 fields'
    return null
}

function FieldTable({ fields, use24Hour }) {
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                        <th scope="col" style={{ padding: '0 var(--space-sm) var(--space-xs) 0', fontWeight: 600 }}>Field</th>
                        <th scope="col" style={{ padding: '0 var(--space-sm) var(--space-xs)', fontWeight: 600 }}>Value</th>
                        <th scope="col" style={{ padding: '0 0 var(--space-xs) var(--space-sm)', fontWeight: 600 }}>Meaning</th>
                    </tr>
                </thead>
                <tbody>
                    {fields.map(({ name, value }) => (
                        <tr key={name} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
                            <th scope="row" style={{ padding: 'var(--space-sm) var(--space-sm) var(--space-sm) 0', textAlign: 'left', fontWeight: 500, color: 'var(--text-main)' }}>
                                {CRON_FIELDS[name].label}
                                <div style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-dim)' }}>{CRON_FIELDS[name].allowed}</div>
                            </th>
                            <td style={{ padding: 'var(--space-sm)' }}>
                                <code className="mono" style={{ color: 'var(--text-code)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.1rem 0.4rem', whiteSpace: value.length > 10 ? 'normal' : 'nowrap', overflowWrap: 'anywhere' }}>{value}</code>
                            </td>
                            <td style={{ padding: 'var(--space-sm) 0 var(--space-sm) var(--space-sm)', color: 'var(--text-muted)' }}>
                                {describeField(name, value, { use24Hour })}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

export default function CronParser() {
    const inputId = useId()
    const [expression, setExpression] = useState('*/5 * * * *')
    const [timezone, setTimezone] = useState('local')
    const [use24Hour, setUse24Hour] = useState(LOCALE_USES_24H)
    const [count, setCount] = useState(10)
    const [now, setNow] = useState(() => Date.now())

    useSmartInput({ input: setExpression })

    // Keep "next runs" and their relative times current
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 10_000)
        return () => clearInterval(timer)
    }, [])

    const deferredExpression = useDeferredValue(expression)
    const analysis = useMemo(
        () => analyzeCron(deferredExpression, { use24Hour, timezone, count, from: new Date(now) }),
        [deferredExpression, use24Hour, timezone, count, now]
    )

    const ok = analysis.status === 'ok'
    const split = ok ? analysis.split : null
    const hasSeconds = Boolean(split?.fields.some(f => f.name === 'second' && f.value !== '0'))

    const runFormat = useMemo(() => new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: hasSeconds ? '2-digit' : undefined,
        hour12: !use24Hour,
        timeZone: timezone === 'utc' ? 'UTC' : undefined,
        timeZoneName: 'short',
    }), [hasSeconds, use24Hour, timezone])

    const runs = ok ? analysis.runs : null
    const runsText = runs?.length ? runs.map(d => toIsoInZone(d, timezone)).join('\n') : ''
    const layoutNote = split?.layout ? LAYOUT_NOTES[split.layout] : null

    return (
        <div className="page page-medium page-cron">
            <ToolHeader />

            <section className="card" aria-label="Expression" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <Field
                    label="Cron expression"
                    error={analysis.status === 'error' ? analysis.message : undefined}
                    hint={layoutNote ?? 'Minute, hour, day of month, month and day of week. 6- and 7-field expressions (with seconds or a year) and shortcuts like @daily work too.'}
                    labelAction={<CopyButton text={expression.trim()} iconOnly label="Copy expression" />}
                >
                    <input
                        id={inputId}
                        type="text"
                        className={analysis.status === 'error' ? 'field-invalid' : undefined}
                        value={expression}
                        onChange={(e) => setExpression(e.target.value)}
                        placeholder="*/5 * * * *"
                        spellCheck={false}
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem' }}
                    />
                </Field>

                <div>
                    <div className="field-label">Examples</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                        {EXAMPLES.map(example => (
                            <button
                                key={example.expr}
                                type="button"
                                className={`chip ${expression.trim() === example.expr ? 'is-active' : ''}`}
                                aria-pressed={expression.trim() === example.expr}
                                title={example.label}
                                onClick={() => setExpression(example.expr)}
                            >
                                <code className="mono" style={{ fontSize: '0.78rem' }}>{example.expr}</code>
                                <span className="sr-only">{example.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', minWidth: 0 }}>
                        <span className="field-label" style={{ marginBottom: 0 }}>Time zone</span>
                        <SegmentedControl
                            ariaLabel="Time zone for upcoming runs"
                            size="sm"
                            value={timezone}
                            onChange={setTimezone}
                            options={[
                                { value: 'local', label: `Local (${LOCAL_TIME_ZONE})` },
                                { value: 'utc', label: 'UTC' },
                            ]}
                        />
                    </div>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: '0.875rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={use24Hour} onChange={(e) => setUse24Hour(e.target.checked)} />
                        24-hour clock
                    </label>
                </div>
            </section>

            {analysis.status === 'empty' && (
                <section className="card">
                    <EmptyState icon={CalendarClock} title="Enter a cron expression">
                        For example <code className="mono">0 9 * * 1-5</code> runs at 9:00 on weekdays. Pick an example above to start.
                    </EmptyState>
                </section>
            )}

            {ok && (
                <>
                    <section className="card" aria-label="Description" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
                            <div style={{ minWidth: 0 }}>
                                <p style={{ fontSize: 'clamp(1.15rem, 1rem + 1vw, 1.5rem)', fontWeight: 600, color: 'var(--text-main)', lineHeight: 1.35 }} aria-live="polite">
                                    {analysis.description}
                                </p>
                                {layoutLabel(split) && (
                                    <span className="badge" style={{ marginTop: 'var(--space-sm)', fontFamily: 'var(--font-mono)' }}>{layoutLabel(split)}</span>
                                )}
                            </div>
                            <CopyButton text={analysis.description} iconOnly label="Copy description" />
                        </div>
                        {analysis.warnings.map(w => (
                            <StatusBanner key={w.text} tone={w.tone}>{w.text}</StatusBanner>
                        ))}
                    </section>

                    <div className="split-pane" style={{ alignItems: 'start' }}>
                        {split.fields.length > 0 && (
                            <section className="card card-compact" aria-labelledby={`${inputId}-fields`} style={{ minWidth: 0 }}>
                                <h2 id={`${inputId}-fields`} className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>Field by field</h2>
                                <FieldTable fields={split.fields} use24Hour={use24Hour} />
                            </section>
                        )}

                        {runs !== null || analysis.runsNote ? (
                            <section className="card card-compact" aria-labelledby={`${inputId}-runs`} style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                                    <h2 id={`${inputId}-runs`} className="section-title">Next runs</h2>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                                        <select
                                            aria-label="Number of runs to show"
                                            value={count}
                                            onChange={(e) => setCount(Number(e.target.value))}
                                            style={{ width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                                        >
                                            {RUN_COUNTS.map(n => <option key={n} value={n}>{n} runs</option>)}
                                        </select>
                                        <CopyButton text={runsText} label="Copy" />
                                    </div>
                                </div>
                                {analysis.runsNote && <StatusBanner tone="warning">{analysis.runsNote}</StatusBanner>}
                                {runs?.length > 0 && (
                                    <ol role="list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                                        {runs.map((run, index) => (
                                            <li
                                                key={run.getTime()}
                                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-sm)', flexWrap: 'wrap', padding: '0.45rem 0', borderTop: index ? '1px solid var(--border)' : 'none' }}
                                            >
                                                <time dateTime={run.toISOString()} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                                                    {runFormat.format(run)}
                                                </time>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{formatRelativeTo(run.getTime(), now)}</span>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                                {runs?.length === 0 && <p className="field-hint">No upcoming runs.</p>}
                            </section>
                        ) : null}
                    </div>
                </>
            )}
        </div>
    )
}
