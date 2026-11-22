import { memo, useCallback, useDeferredValue, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowDownLeft, ArrowUpRight, Check, Copy, Info, MessageSquareText, Search, Trash2 } from 'lucide-react'
import CodeBlock from '../ui/CodeBlock'
import CopyButton from '../ui/CopyButton'
import SegmentedControl from '../ui/SegmentedControl'
import { useCopy } from '../../hooks/useCopy'
import { formatBytes } from '../../utils/download'
import { decodeUtf8, formatClock, hexDump, prettyJson, toBase64 } from '../../utils/realtime'
import { LOG_BYTES, LOG_LIMIT } from './useMessageLog'

const DISPLAY_LIMIT = 1_000_000 // characters shown in an opened message
const HEX_LIMIT = 64 * 1024 // bytes shown in a hex dump
const DIRECTIONS = [
    { value: 'all', label: 'All' },
    { value: 'out', label: 'Sent' },
    { value: 'in', label: 'Received' },
]
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
const copyTextOf = (entry) => (entry.kind === 'binary' ? toBase64(entry.bytes) : entry.text)

function DirectionMark({ entry }) {
    if (entry.kind === 'comment') {
        return <span className="api-rt-dir"><MessageSquareText size={14} aria-hidden="true" /><span className="sr-only">Comment</span></span>
    }
    return entry.dir === 'out' ? (
        <span className="api-rt-dir is-out"><ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only">Sent</span></span>
    ) : (
        <span className="api-rt-dir is-in"><ArrowDownLeft size={14} aria-hidden="true" /><span className="sr-only">Received</span></span>
    )
}

function viewsFor(entry, utf8) {
    if (entry.kind === 'binary') {
        return [{ value: 'hex', label: 'Hex' }, { value: 'base64', label: 'Base64' }, ...(utf8 !== null ? [{ value: 'text', label: 'Text' }] : [])]
    }
    return entry.json ? [{ value: 'pretty', label: 'Pretty' }, { value: 'raw', label: 'Raw' }] : [{ value: 'raw', label: 'Raw' }]
}

function MessageDetail({ id, entry }) {
    const utf8 = useMemo(() => (entry.kind === 'binary' ? decodeUtf8(entry.bytes) : null), [entry])
    const views = viewsFor(entry, utf8)
    const [view, setView] = useState(views[0].value)
    const text = useMemo(() => {
        if (view === 'pretty') return prettyJson(entry.text)
        if (view === 'hex') return hexDump(entry.bytes, HEX_LIMIT)
        if (view === 'base64') return toBase64(entry.bytes)
        if (view === 'text') return utf8
        return entry.text
    }, [entry, view, utf8])
    const shown = text.length > DISPLAY_LIMIT ? text.slice(0, DISPLAY_LIMIT) : text
    const viewLabel = views.find(v => v.value === view).label

    return (
        <div id={id} className="api-rt-detail">
            <div className="api-rt-detail-bar">
                {views.length > 1 && <SegmentedControl ariaLabel="Show as" size="sm" value={view} onChange={setView} options={views} />}
                <CopyButton text={text} label={views.length > 1 ? `Copy ${viewLabel.toLowerCase()}` : 'Copy'} />
            </div>
            {/* No inner scrolling (the log scrolls), except sideways for the hex dump,
                which is focusable so that it can be scrolled with the keyboard */}
            {text === '' ? (
                <p className="api-rt-none">{entry.kind === 'event' ? 'No data.' : 'Empty message.'}</p>
            ) : view === 'hex' ? (
                <pre className="code-well api-rt-hex" tabIndex={0} role="region" aria-label="Hex dump">{shown}</pre>
            ) : (
                <CodeBlock code={shown} language={view === 'pretty' || (view === 'raw' && entry.json) ? 'json' : 'text'} showCopy={false} />
            )}
            {view === 'hex' && entry.bytes.length > HEX_LIMIT && (
                <p className="field-hint" style={{ marginTop: 0 }}>The hex dump shows the first {formatBytes(HEX_LIMIT)}. Copy the Base64 view to get all {formatBytes(entry.bytes.length)}.</p>
            )}
            {text.length > DISPLAY_LIMIT && (
                <p className="field-hint" style={{ marginTop: 0 }}>Only the first million characters are shown here; Copy copies all of it.</p>
            )}
        </div>
    )
}

const LogRow = memo(function LogRow({ entry, expanded, copied, noun, onToggle, onCopy }) {
    const detailId = useId()
    const time = formatClock(entry.at)

    if (entry.kind === 'system') {
        return (
            <li className={`api-rt-row api-rt-system tone-${entry.tone}`}>
                <span className="api-rt-dir"><Info size={14} aria-hidden="true" /></span>
                <span className="api-rt-time mono">{time}</span>{' '}
                <span className="api-rt-system-text">{entry.text}</span>
            </li>
        )
    }

    return (
        <li className={`api-rt-row${entry.kind === 'comment' ? ' api-rt-comment' : ''}`}>
            <div className="api-rt-row-head">
                <button
                    type="button"
                    className="api-rt-row-main"
                    aria-expanded={expanded}
                    aria-controls={expanded ? detailId : undefined}
                    onClick={() => onToggle(entry.id)}
                >
                    <DirectionMark entry={entry} />
                    <span className="api-rt-time mono">{time}</span>
                    {entry.kind === 'event' && <span className={`badge mono ${entry.type === 'message' ? '' : 'api-rt-named-type'}`}>{entry.type}</span>}
                    {entry.kind === 'event' && entry.lastEventId !== '' && <span className="api-rt-meta mono">id {entry.lastEventId}</span>}
                    {entry.json && <span className="badge badge-info">JSON</span>}
                    {entry.kind === 'binary' && <span className="badge badge-warning">Binary</span>}
                    {entry.kind !== 'comment' && <span className="api-rt-meta">{formatBytes(entry.size)}</span>}
                    <span className="api-rt-preview mono">{entry.preview || <span className="api-rt-none">{entry.kind === 'event' ? 'no data' : 'empty'}</span>}</span>
                </button>
                <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    onClick={() => onCopy(entry)}
                    aria-label={copied ? 'Copied' : `Copy ${noun} from ${time}`}
                    title={`Copy ${noun}`}
                    style={copied ? { color: 'var(--success)' } : undefined}
                >
                    {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                </button>
            </div>
            {expanded && <MessageDetail id={detailId} entry={entry} />}
        </li>
    )
})

/**
 * The message log of a realtime connection: a list (newest at the bottom) that
 * follows new entries until the user scrolls up, with a filter, an optional
 * direction filter, copy and clear. New incoming entries are announced
 * politely through a separate live region (see useMessageLog).
 */
export default function MessageLog({
    title,
    noun,
    entries,
    dropped,
    announcement,
    onClear,
    directionFilter = false,
    hiddenKinds,
    toolbar,
    empty,
}) {
    const filterId = useId()
    const [query, setQuery] = useState('')
    const [direction, setDirection] = useState('all')
    const [expanded, setExpanded] = useState(() => new Set())
    const [pausedAfter, setPausedAfter] = useState(null) // id of the last entry seen before scrolling up
    const listRef = useRef(null)
    const followRef = useRef(true)
    const { copy, copiedKey } = useCopy()
    const deferredQuery = useDeferredValue(query.trim().toLowerCase())

    const shown = useMemo(() => entries.filter(entry => {
        if (hiddenKinds?.has(entry.kind)) return false
        if (direction !== 'all' && entry.dir !== direction) return false
        return !deferredQuery || entry.search.includes(deferredQuery)
    }), [entries, hiddenKinds, direction, deferredQuery])
    const count = entries.filter(e => e.kind !== 'system' && !hiddenKinds?.has(e.kind)).length
    const filtering = Boolean(deferredQuery) || direction !== 'all'
    const lastId = shown.length ? shown[shown.length - 1].id : 0
    const unseen = pausedAfter === null ? 0 : shown.filter(e => e.id > pausedAfter && e.kind !== 'system').length

    // Keep the newest entry in view while following
    useLayoutEffect(() => {
        const list = listRef.current
        if (list && followRef.current) list.scrollTop = list.scrollHeight
    }, [shown])

    const onScroll = (event) => {
        const list = event.currentTarget
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24
        followRef.current = atBottom
        if (atBottom && pausedAfter !== null) setPausedAfter(null)
        else if (!atBottom && pausedAfter === null) setPausedAfter(lastId)
    }

    const jumpToLatest = () => {
        followRef.current = true
        setPausedAfter(null)
        const list = listRef.current
        if (list) list.scrollTop = list.scrollHeight
    }

    const toggle = useCallback((id) => setExpanded(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    }), [])
    const copyEntry = useCallback((entry) => copy(() => copyTextOf(entry), { key: entry.id }), [copy])

    const clear = () => {
        onClear()
        setExpanded(new Set())
        followRef.current = true
        setPausedAfter(null)
    }

    return (
        <section className="card card-compact api-rt-log-card" aria-label={title}>
            <div className="api-rt-log-head">
                <h2 className="section-title">
                    {title}
                    <span className="badge">{count.toLocaleString()}</span>
                </h2>
                <div className="api-rt-log-tools">
                    <div className="api-rt-filter">
                        <Search size={14} aria-hidden="true" />
                        <label htmlFor={filterId} className="sr-only">{`Filter ${noun}s`}</label>
                        <input id={filterId} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter" spellCheck={false} autoComplete="off" />
                    </div>
                    {directionFilter && <SegmentedControl ariaLabel="Direction" size="sm" value={direction} onChange={setDirection} options={DIRECTIONS} />}
                    {toolbar}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={clear} disabled={!entries.length}>
                        <Trash2 size={14} aria-hidden="true" /> Clear
                    </button>
                </div>
            </div>

            {dropped > 0 && (
                <p className="field-hint" style={{ marginTop: 0 }}>
                    {dropped.toLocaleString()} older {dropped === 1 ? 'entry was' : 'entries were'} removed to save memory. The log keeps the latest {LOG_LIMIT.toLocaleString()} entries, up to {formatBytes(LOG_BYTES)}.
                </p>
            )}

            <div className="api-rt-log-wrap">
                {shown.length > 0 ? (
                    <ol ref={listRef} className="api-rt-log" aria-label={`${title} log`} onScroll={onScroll}>
                        {shown.map(entry => (
                            <LogRow
                                key={entry.id}
                                entry={entry}
                                noun={noun}
                                expanded={expanded.has(entry.id)}
                                copied={copiedKey === entry.id}
                                onToggle={toggle}
                                onCopy={copyEntry}
                            />
                        ))}
                    </ol>
                ) : filtering && count > 0 ? (
                    <p className="api-rt-no-match">{`No ${noun}s match the filter.`}</p>
                ) : empty}
                {pausedAfter !== null && shown.length > 0 && (
                    <button type="button" className="btn btn-sm btn-secondary api-rt-jump" onClick={jumpToLatest}>
                        <ArrowDown size={14} aria-hidden="true" /> {unseen > 0 ? `${plural(unseen, `new ${noun}`)}` : 'Latest'}
                    </button>
                )}
            </div>

            {/* Separate from the list, so that a busy stream is summarised instead of read out entry by entry */}
            <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
            <span className="sr-only" aria-live="polite">{copiedKey !== null ? 'Copied' : ''}</span>
        </section>
    )
}
