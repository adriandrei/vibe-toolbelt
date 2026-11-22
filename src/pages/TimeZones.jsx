import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Clock, Earth, RotateCcw, Users, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import SegmentedControl from '../components/ui/SegmentedControl'
import ShareButton from '../components/ui/ShareButton'
import StatusBanner from '../components/ui/StatusBanner'
import { useToast } from '../components/ToastProvider'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSharedState } from '../hooks/useSharedState'
import {
    HOUR, MAX_ZONES,
    canonicalZone, daysBetween, defaultZones, formatAmount, formatClock, formatOffset, listTimeZones, localZone,
    nextTransition, offsetAt, parseDateTimeLocal, plannerSlots, sanitizeZoneList, searchZones, toDateTimeLocal,
    toIsoInZone, transitionWalls, utcFromFields, zoneAbbreviation, zoneAbbreviations, zoneCity, zonedParts, zonedToInstant,
} from '../utils/timezones'
import './TimeZones.css'

const CYCLES = [
    { value: 'h23', label: '24-hour' },
    { value: 'h12', label: '12-hour' },
]

const LOCALE_CYCLE = (() => {
    try {
        const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle
        return hc === 'h11' || hc === 'h12' ? 'h12' : 'h23'
    } catch {
        return 'h23'
    }
})()

const DATE_STYLES = {
    short: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
    long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
    day: { day: 'numeric', month: 'short', year: 'numeric' },
    weekday: { weekday: 'short' },
}
const dateFormatters = new Map()
function formatDate(zone, ms, style) {
    const key = `${style}|${zone}`
    let f = dateFormatters.get(key)
    if (!f) {
        f = new Intl.DateTimeFormat(undefined, { ...DATE_STYLES[style], timeZone: zone })
        dateFormatters.set(key, f)
    }
    return f.format(ms)
}

const clockOf = (wall, cycle) => formatClock(wall.hour, wall.minute, cycle)
const dayDiffText = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}`

// Compact planner label: "9", "14:30" (24-hour) or "2" + "pm", "2:30" + "pm"
function hourLabel({ hour, minute }, cycle) {
    const minutes = minute ? `:${String(minute).padStart(2, '0')}` : ''
    if (cycle === 'h12') return { main: `${hour % 12 || 12}${minutes}`, sub: hour < 12 ? 'am' : 'pm' }
    return { main: `${hour}${minutes}`, sub: '' }
}

// Abbreviations for the search box ("PST", "CET", "IST"), built once in
// small chunks after the first search, so typing never waits for it.
let abbreviationCache = null
function useAbbreviationIndex(active, year) {
    const [built, setBuilt] = useState(null)
    useEffect(() => {
        if (!active || !year) return undefined
        if (abbreviationCache?.year === year) {
            const timer = setTimeout(() => setBuilt(abbreviationCache), 0)
            return () => clearTimeout(timer)
        }
        let cancelled = false
        let timer
        const zones = listTimeZones()
        const map = new Map()
        let i = 0
        const step = () => {
            if (cancelled) return
            const end = Math.min(zones.length, i + 30)
            for (; i < end; i++) map.set(zones[i], zoneAbbreviations(zones[i], year))
            if (i < zones.length) {
                timer = setTimeout(step, 0)
            } else {
                abbreviationCache = { year, map }
                setBuilt(abbreviationCache)
            }
        }
        timer = setTimeout(step, 0)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [active, year])
    return built?.year === year ? built.map : null
}

function ZonePicker({ label, value, onPick, exclude, atMs, abbreviations, onSearchStart, placeholder, hint }) {
    const id = useId()
    const listId = `${id}-list`
    const inputRef = useRef(null)
    const listRef = useRef(null)
    const [query, setQuery] = useState('')
    const [editing, setEditing] = useState(false)
    const [active, setActive] = useState(0)

    const results = useMemo(() => {
        if (!editing || !query.trim()) return []
        const zones = exclude?.length ? listTimeZones().filter(z => !exclude.includes(z)) : listTimeZones()
        return searchZones(query, { zones, atMs, abbreviations, limit: 50 })
    }, [editing, query, exclude, atMs, abbreviations])
    const open = editing && query.trim() !== ''
    const activeIndex = Math.min(active, results.length - 1)

    useEffect(() => {
        if (!open || activeIndex < 0) return
        listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
    }, [open, activeIndex])

    const choose = (zone) => {
        onPick(zone)
        setQuery('')
        setActive(0)
        if (value !== undefined) inputRef.current?.blur()
    }

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive(i => Math.min(i + 1, results.length - 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive(i => Math.max(i - 1, 0))
        } else if (e.key === 'Enter') {
            if (open && results[activeIndex]) {
                e.preventDefault()
                choose(results[activeIndex])
            }
        } else if (e.key === 'Escape' && query) {
            e.preventDefault()
            e.stopPropagation()
            setQuery('')
        }
    }

    return (
        <div className="tz-picker">
            <label className="field-label" htmlFor={id}>{label}</label>
            <input
                ref={inputRef}
                id={id}
                type="text"
                role="combobox"
                className="tz-picker-input"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
                aria-describedby={hint ? `${id}-hint` : undefined}
                value={editing || value === undefined ? query : value}
                placeholder={editing && value ? `${value} (type to search)` : placeholder}
                onFocus={() => {
                    setEditing(true)
                    setQuery('')
                    setActive(0)
                    onSearchStart?.()
                }}
                onBlur={() => {
                    setEditing(false)
                    setQuery('')
                }}
                onChange={(e) => {
                    setQuery(e.target.value)
                    setActive(0)
                }}
                onKeyDown={onKeyDown}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
            />
            <ul ref={listRef} id={listId} role="listbox" aria-label={`${label}: results`} className="tz-picker-list" hidden={!open}>
                {open && results.length === 0 && <li className="tz-picker-empty" role="presentation">No time zone matches “{query.trim()}”.</li>}
                {open && results.map((zone, i) => (
                    <li
                        key={zone}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === activeIndex}
                        className="tz-picker-option"
                        onMouseDown={(e) => {
                            e.preventDefault()
                            choose(zone)
                        }}
                        onMouseMove={() => {
                            if (i !== activeIndex) setActive(i)
                        }}
                    >
                        <span className="tz-picker-option-name">{zoneCity(zone)}<small>{zone}</small></span>
                        <span className="tz-picker-option-offset">{formatOffset(offsetAt(zone, atMs))}</span>
                    </li>
                ))}
            </ul>
            {hint && <div id={`${id}-hint`} className="field-hint">{hint}</div>}
        </div>
    )
}

function Planner({ sourceZone, year, month, day, zones, selectedMs, cycle, onPick }) {
    const scrollRef = useRef(null)
    const labelsRef = useRef(null)
    const selectedRef = useRef(null)
    const slots = useMemo(() => plannerSlots(sourceZone, { year, month, day }, zones), [sourceZone, year, month, day, zones])
    const selectedIndex = slots.findIndex(s => selectedMs >= s.startMs && selectedMs < s.startMs + HOUR)

    // Centre the chosen hour in the part of the strip the zone names don't
    // cover. Only the strip scrolls, never the page.
    useEffect(() => {
        const box = scrollRef.current
        const el = selectedRef.current
        if (!box || !el) return
        const names = labelsRef.current?.offsetWidth ?? 0
        const visible = box.clientWidth - names
        box.scrollLeft = Math.max(0, el.offsetLeft - names - (visible - el.offsetWidth) / 2)
    }, [selectedIndex, slots])

    const runs = []
    slots.forEach((s, i) => {
        if (!s.allWorking) return
        const last = runs[runs.length - 1]
        if (last && last.end === i - 1) last.end = i
        else runs.push({ start: i, end: i })
    })
    const runText = runs.map(r => `${clockOf(slots[r.start].source, cycle)}–${clockOf(zonedParts(sourceZone, slots[r.end].startMs + HOUR), cycle)}`)
    const sourceCity = zoneCity(sourceZone)

    return (
        <>
            <p className="field-hint" role="status" style={{ margin: 0, color: runs.length ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                {runs.length
                    ? `Everyone is in working hours ${runText.join(' and ')} (${sourceCity} time).`
                    : 'There’s no hour when everyone is in working hours (9:00–17:00 local time).'}
            </p>
            <div className="tz-planner" ref={scrollRef} role="region" aria-label="Hours of the day in each zone" tabIndex={0} style={{ position: 'relative' }}>
                <div className="tz-planner-grid">
                    <div className="tz-planner-labels" ref={labelsRef}>
                        <div className="tz-planner-label">
                            <span>{sourceCity}</span>
                            <small>Input zone</small>
                        </div>
                        {zones.map(zone => (
                            <div key={zone} className="tz-planner-label" title={zone}>
                                <span>{zoneCity(zone)}</span>
                                <small>{formatOffset(offsetAt(zone, slots[0]?.startMs ?? selectedMs))}</small>
                            </div>
                        ))}
                    </div>
                    {slots.map((slot, i) => {
                        const selected = i === selectedIndex
                        const head = hourLabel(slot.source, cycle)
                        // The name starts with exactly the hour shown, then spells out every zone
                        const headText = cycle === 'h12' ? `${head.main} ${head.sub}` : `${slot.source.hour}:${String(slot.source.minute).padStart(2, '0')}`
                        const label = `${headText} in ${sourceCity}: ${slot.cells
                            .map(c => `${zoneCity(c.zone)} ${clockOf(c, cycle)}${c.dayDiff ? ` (${dayDiffText(c.dayDiff)})` : ''}`)
                            .join(', ')}${slot.allWorking ? '. Everyone is in working hours.' : ''}`
                        return (
                            <div
                                key={slot.startMs}
                                ref={selected ? selectedRef : undefined}
                                className={`tz-slot ${slot.allWorking ? 'is-overlap' : ''} ${selected ? 'is-selected' : ''}`}
                                data-hour={slot.source.hour}
                            >
                                {/* The button covers the whole column (see .tz-slot-button::after) */}
                                <button
                                    type="button"
                                    className="tz-cell is-head tz-slot-button"
                                    aria-pressed={selected}
                                    aria-label={label}
                                    title={label}
                                    onClick={() => onPick(slot)}
                                >
                                    {head.main}
                                    {cycle === 'h12' && <>{' '}<span className="tz-cell-sub">{head.sub}</span></>}
                                </button>
                                {slot.cells.map((c) => {
                                    const { main, sub } = hourLabel(c, cycle)
                                    const note = c.dayStart ? formatDate(c.zone, slot.startMs, 'weekday') : sub
                                    return (
                                        <span key={c.zone} aria-hidden="true" className={`tz-cell is-${c.kind} ${c.dayStart ? 'is-day-start' : ''}`}>
                                            {main}
                                            {note && <span className="tz-cell-sub">{note}</span>}
                                        </span>
                                    )
                                })}
                            </div>
                        )
                    })}
                </div>
            </div>
            <ul className="tz-legend" aria-label="Legend">
                <li><span className="tz-swatch is-work" aria-hidden="true" /> Working hours (9–17)</li>
                <li><span className="tz-swatch is-off" aria-hidden="true" /> Morning and evening</li>
                <li><span className="tz-swatch is-night" aria-hidden="true" /> Night (22–7)</li>
                <li><span className="tz-swatch is-overlap" aria-hidden="true" /> Everyone working</li>
            </ul>
        </>
    )
}

export default function TimeZones() {
    const toast = useToast()
    const dateId = useId()
    const compareId = useId()
    const plannerId = useId()
    const [local] = useState(() => localZone())
    const [stored, setStored] = useLocalStorage('tz-zones', null)
    const [storedCycle, setStoredCycle] = useLocalStorage('tz-hour-cycle', null)
    const [sessionZones, setSessionZones] = useState(null)
    const [sourceZone, setSourceZone] = useState(local)
    const [wallInput, setWallInput] = useState(() => toDateTimeLocal(zonedParts(localZone(), Date.now())))
    const [prefer, setPrefer] = useState('earlier')
    const [searchUsed, setSearchUsed] = useState(false)

    const cycle = storedCycle === 'h12' || storedCycle === 'h23' ? storedCycle : LOCALE_CYCLE
    const zones = useMemo(() => sessionZones ?? sanitizeZoneList(stored) ?? defaultZones(local), [sessionZones, stored, local])
    const wall = useMemo(() => parseDateTimeLocal(wallInput), [wallInput])
    const resolved = useMemo(() => (wall ? zonedToInstant(sourceZone, wall, prefer) : null), [wall, sourceZone, prefer])
    const instant = resolved ? resolved.epochMs : null
    const shown = useMemo(() => (instant === null ? null : zonedParts(sourceZone, instant)), [instant, sourceZone])
    const abbreviations = useAbbreviationIndex(searchUsed, wall?.year)

    const rows = useMemo(() => {
        if (instant === null) return []
        return zones.map((zone) => {
            const parts = zonedParts(zone, instant)
            return {
                zone,
                parts,
                offset: offsetAt(zone, instant),
                abbr: zoneAbbreviation(zone, instant),
                dayDiff: daysBetween(shown, parts),
                date: formatDate(zone, instant, 'short'),
                longDate: formatDate(zone, instant, 'long'),
                next: nextTransition(zone, instant),
            }
        })
    }, [zones, instant, shown])

    useSharedState((shared) => {
        if (!shared || typeof shared !== 'object') return
        const zone = canonicalZone(shared.zone)
        if (zone) setSourceZone(zone)
        if (parseDateTimeLocal(shared.wall)) setWallInput(String(shared.wall).slice(0, 16))
        setPrefer(shared.prefer === 'later' ? 'later' : 'earlier')
        const list = sanitizeZoneList(shared.zones)
        if (list) setSessionZones(list)
    })

    const updateZones = (next) => {
        setStored(next)
        setSessionZones(null)
    }

    const addZone = (zone) => {
        if (zones.includes(zone)) {
            toast.info(`${zoneCity(zone)} is already in the list.`)
            return
        }
        if (zones.length >= MAX_ZONES) {
            toast.warning(`You can compare up to ${MAX_ZONES} zones. Remove one first.`)
            return
        }
        updateZones([...zones, zone])
    }

    const moveZone = (zone, delta) => {
        const i = zones.indexOf(zone)
        const j = i + delta
        if (i < 0 || j < 0 || j >= zones.length) return
        const next = [...zones]
        ;[next[i], next[j]] = [next[j], next[i]]
        updateZones(next)
    }

    const resetZones = () => {
        setStored(undefined)
        setSessionZones(null)
    }

    const setFromInstant = (zone, ms) => {
        const parts = zonedParts(zone, ms)
        const check = zonedToInstant(zone, parts)
        setSourceZone(zone)
        setWallInput(toDateTimeLocal(parts))
        setPrefer(check.status === 'overlap' && check.later === ms ? 'later' : 'earlier')
    }

    const goNow = () => {
        setWallInput(toDateTimeLocal(zonedParts(sourceZone, Date.now())))
        setPrefer('earlier')
    }

    const sentence = (row) => {
        const time = clockOf(row.parts, cycle)
        if (row.zone === 'UTC') return `${time} UTC on ${row.longDate}`
        return `${time} on ${row.longDate} in ${zoneCity(row.zone)} (${row.abbr ? `${row.abbr}, ` : ''}${formatOffset(row.offset)})`
    }

    const changeText = (row) => {
        const t = row.next
        if (!t) return 'No clock changes in the next 12 months.'
        const { from, to } = transitionWalls(t)
        const diff = t.offsetAfter - t.offsetBefore
        return `Clocks go ${diff > 0 ? 'forward' : 'back'} ${formatAmount(diff)} on ${formatDate(row.zone, t.atMs, 'day')}, ${clockOf(from, cycle)} → ${clockOf(to, cycle)}`
    }

    const sourceCity = zoneCity(sourceZone)
    const wallDay = wall ? formatDate('UTC', utcFromFields(wall), 'day') : ''
    const sourceOffset = instant === null ? null : offsetAt(sourceZone, instant)
    const sourceAbbr = instant === null ? null : zoneAbbreviation(sourceZone, instant)
    const transition = resolved && resolved.status !== 'ok' && resolved.transitionMs !== null ? transitionWalls(resolved) : null

    return (
        <div className="page page-medium">
            <ToolHeader actions={<ShareButton getState={() => ({ wall: wallInput, zone: sourceZone, prefer, zones })} />} />

            <section className="card" aria-label="Date, time and zone" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div className="tz-input-grid">
                    <div>
                        <label className="field-label" htmlFor={dateId}>Date and time</label>
                        <input
                            id={dateId}
                            type="datetime-local"
                            step="60"
                            min="0001-01-01T00:00"
                            max="9999-12-31T23:59"
                            value={wallInput}
                            aria-invalid={!wall || undefined}
                            aria-describedby={!wall ? `${dateId}-error` : undefined}
                            className={wall ? undefined : 'field-invalid'}
                            onChange={(e) => {
                                setWallInput(e.target.value)
                                setPrefer('earlier')
                            }}
                        />
                    </div>
                    <ZonePicker
                        label="Time zone"
                        value={sourceZone}
                        onPick={(zone) => setSourceZone(zone)}
                        atMs={instant ?? 0}
                        abbreviations={abbreviations}
                        onSearchStart={() => setSearchUsed(true)}
                        placeholder="Search a city or offset"
                    />
                    <button type="button" className="btn btn-secondary" onClick={goNow} style={{ justifySelf: 'start' }}>
                        <Clock size={16} aria-hidden="true" /> Now
                    </button>
                </div>
                {!wall && <div id={`${dateId}-error`} className="field-error" style={{ marginTop: 0 }}>Enter a full date and time (years 1 to 9999).</div>}

                {instant !== null && (
                    <div className="field-hint" style={{ marginTop: 0 }} data-testid="tz-source-summary">
                        {sourceCity} is on {formatOffset(sourceOffset)}{sourceAbbr ? ` (${sourceAbbr})` : ''} at this time. In UTC: <span className="mono">{toIsoInZone('UTC', instant)}</span>
                    </div>
                )}

                {resolved?.status === 'gap' && transition && (
                    <StatusBanner tone="warning" title={`${clockOf(wall, cycle)} doesn’t exist in ${sourceCity} on ${wallDay}`}>
                        Clocks go forward {formatAmount(resolved.offsetAfter - resolved.offsetBefore)} at {clockOf(transition.from, cycle)}, straight to {clockOf(transition.to, cycle)}.
                        {' '}Showing {clockOf(shown, cycle)}{sourceAbbr ? ` ${sourceAbbr}` : ''} ({formatOffset(sourceOffset)}) instead.
                    </StatusBanner>
                )}
                {resolved?.status === 'overlap' && transition && (
                    <StatusBanner tone="info" title={`${clockOf(wall, cycle)} happens twice in ${sourceCity} on ${wallDay}`}>
                        <p style={{ margin: 0 }}>
                            Clocks go back {formatAmount(resolved.offsetBefore - resolved.offsetAfter)} at {clockOf(transition.from, cycle)}, to {clockOf(transition.to, cycle)}. Which one do you mean?
                        </p>
                        <SegmentedControl
                            ariaLabel="Which occurrence"
                            size="sm"
                            value={prefer}
                            onChange={setPrefer}
                            style={{ marginTop: 'var(--space-sm)' }}
                            options={[
                                { value: 'earlier', label: `Earlier, ${zoneAbbreviation(sourceZone, resolved.earlier) ?? formatOffset(resolved.offsetBefore)}` },
                                { value: 'later', label: `Later, ${zoneAbbreviation(sourceZone, resolved.later) ?? formatOffset(resolved.offsetAfter)}` },
                            ]}
                        />
                    </StatusBanner>
                )}
            </section>

            <section className="card" aria-labelledby={compareId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div className="tz-section-head">
                    <h2 id={compareId} className="section-title"><Earth size={16} aria-hidden="true" /> Compare</h2>
                    <SegmentedControl ariaLabel="Clock format" size="sm" options={CYCLES} value={cycle} onChange={setStoredCycle} />
                </div>
                <ZonePicker
                    label="Add a time zone"
                    onPick={addZone}
                    exclude={zones}
                    atMs={instant ?? 0}
                    abbreviations={abbreviations}
                    onSearchStart={() => setSearchUsed(true)}
                    placeholder="City, region, abbreviation or offset (+5:30)"
                />
                {sessionZones && <div className="field-hint" style={{ marginTop: 0 }}>These zones came with a shared link. Changing the list saves it as yours.</div>}

                {zones.length === 0 ? (
                    <EmptyState icon={Earth} title="No zones to compare">
                        Add a zone above, or{' '}
                        <button type="button" className="btn btn-outline btn-sm" onClick={resetZones}>restore the defaults</button>
                    </EmptyState>
                ) : instant !== null && (
                    <ul className="tz-rows" aria-label="Times in each zone">
                        {rows.map((row, i) => {
                            const city = zoneCity(row.zone)
                            return (
                                <li key={row.zone} className={`tz-row ${row.zone === sourceZone ? 'is-source' : ''}`} data-zone={row.zone}>
                                    <div className="tz-row-top">
                                        <div className="tz-row-name">
                                            <div className="tz-row-title">
                                                <h3 className="tz-city">{city}</h3>
                                                {row.zone === sourceZone && <span className="badge badge-primary">Input</span>}
                                                {row.abbr && row.zone !== 'UTC' && <span className="badge" data-testid="tz-abbr">{row.abbr}</span>}
                                                <span className="badge mono" data-testid="tz-offset">{formatOffset(row.offset)}</span>
                                                {row.dayDiff !== 0 && <span className="badge badge-info" data-testid="tz-daydiff">{dayDiffText(row.dayDiff)}</span>}
                                            </div>
                                            {row.zone !== 'UTC' && <div className="tz-zone-id">{row.zone}</div>}
                                        </div>
                                        <div className="tz-row-when">
                                            <div className="tz-time" data-testid="tz-time">{clockOf(row.parts, cycle)}</div>
                                            <div className="tz-date" data-testid="tz-date">{row.date}</div>
                                        </div>
                                    </div>
                                    <div className="tz-row-change" data-testid="tz-change">{changeText(row)}</div>
                                    <div className="tz-row-actions">
                                        <CopyButton text={toIsoInZone(row.zone, instant)} label="ISO 8601" variant="secondary" />
                                        <CopyButton text={sentence(row)} label="Sentence" variant="secondary" />
                                        {row.zone !== sourceZone && (
                                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFromInstant(row.zone, instant)} title={`Enter times in ${city} time`}>
                                                Use as input
                                            </button>
                                        )}
                                        <span className="tz-spacer" />
                                        <button type="button" className="icon-btn icon-btn-sm" onClick={() => moveZone(row.zone, -1)} disabled={i === 0} aria-label={`Move ${city} up`} title="Move up">
                                            <ArrowUp size={14} aria-hidden="true" />
                                        </button>
                                        <button type="button" className="icon-btn icon-btn-sm" onClick={() => moveZone(row.zone, 1)} disabled={i === rows.length - 1} aria-label={`Move ${city} down`} title="Move down">
                                            <ArrowDown size={14} aria-hidden="true" />
                                        </button>
                                        <button type="button" className="icon-btn icon-btn-sm" onClick={() => updateZones(zones.filter(z => z !== row.zone))} aria-label={`Remove ${city}`} title="Remove">
                                            <X size={14} aria-hidden="true" />
                                        </button>
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                )}
                {(stored !== null && stored !== undefined) || sessionZones ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={resetZones} style={{ alignSelf: 'flex-start' }}>
                        <RotateCcw size={14} aria-hidden="true" /> Restore the default zones
                    </button>
                ) : null}
            </section>

            {zones.length > 0 && wall && instant !== null && (
                <section className="card" aria-labelledby={plannerId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div>
                        <h2 id={plannerId} className="section-title"><Users size={16} aria-hidden="true" /> Meeting planner</h2>
                        <p className="field-hint" style={{ margin: 0 }}>
                            {formatDate('UTC', utcFromFields(wall), 'long')} in {sourceCity}, hour by hour. Pick an hour to use it.
                        </p>
                    </div>
                    <Planner
                        sourceZone={sourceZone}
                        year={wall.year}
                        month={wall.month}
                        day={wall.day}
                        zones={zones}
                        selectedMs={instant}
                        cycle={cycle}
                        onPick={(slot) => setFromInstant(sourceZone, slot.startMs)}
                    />
                </section>
            )}
        </div>
    )
}
