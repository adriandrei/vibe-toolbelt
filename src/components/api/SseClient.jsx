import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Info, Loader2, Play, Plus, Radio, Square, Trash2, TriangleAlert } from 'lucide-react'
import EmptyState from '../ui/EmptyState'
import StatusBanner from '../ui/StatusBanner'
import { usePane } from '../../contexts/pane'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useNow } from '../../utils/clock'
import { isForbiddenHeader } from '../../utils/codeGenerator'
import { formatBytes } from '../../utils/download'
import { getStatusText } from '../../utils/httpStatus'
import { displayUrl, formatDelay, isMixedContent, preflightHeaders, toHttpUrl, urlForStorage } from '../../utils/realtime'
import { createEventStreamParser, isEventStream, lastEventIdHeader } from '../../utils/sse'
import EnvironmentPicker from './EnvironmentPicker'
import MessageLog from './MessageLog'
import { commentEntry, eventEntry, systemEntry, useMessageLog } from './useMessageLog'

const DEFAULT_RETRY = 3000 // EventSource's usual reconnection time
const MAX_DELAY = 2_147_483_647 // the longest setTimeout delay
const PREVIEW_LIMIT = 64 * 1024 // bytes of an error response shown
const PREVIEW_WAIT = 3000 // ms to wait for them
const COMMON_HEADERS = ['Accept', 'Authorization', 'Cache-Control', 'Last-Event-ID', 'X-API-Key', 'X-Request-ID']
const COMMENTS = new Set(['comment'])
const SETUP_ERROR = /Failed to execute|Invalid (name|value)|is not a valid|includes credentials/i
const STATUS = {
    idle: { label: 'Not connected', badge: '' },
    connecting: { label: 'Connecting…', badge: 'badge-info' },
    open: { label: 'Receiving', badge: 'badge-success' },
    waiting: { label: 'Waiting to reconnect', badge: 'badge-warning' },
    stopped: { label: 'Stopped', badge: '' },
    ended: { label: 'Stream ended', badge: '' },
    lost: { label: 'Connection lost', badge: 'badge-warning' },
    failed: { label: 'Failed', badge: 'badge-danger' },
}

let rowCounter = 0
const newRowId = () => `sse-h${++rowCounter}`
// When a reconnection that starts in `ms` will happen (called from timers, not during render)
const timeIn = (ms) => Date.now() + ms

// The start of a response that isn't an event stream (an error page or JSON
// error, usually): at most PREVIEW_LIMIT bytes, waiting at most PREVIEW_WAIT ms
async function readPreview(res) {
    if (!res.body) return { text: '', truncated: false }
    const reader = res.body.getReader()
    const timer = setTimeout(() => reader.cancel().catch(() => {}), PREVIEW_WAIT)
    const chunks = []
    let size = 0
    try {
        while (size <= PREVIEW_LIMIT) {
            const { value, done } = await reader.read()
            if (done) break
            chunks.push(value)
            size += value.length
        }
    } catch {
        // keep what arrived
    } finally {
        clearTimeout(timer)
        reader.cancel().catch(() => {})
    }
    const bytes = new Uint8Array(Math.min(size, PREVIEW_LIMIT))
    let offset = 0
    for (const chunk of chunks) {
        if (offset >= bytes.length) break
        const part = chunk.subarray(0, bytes.length - offset)
        bytes.set(part, offset)
        offset += part.length
    }
    return { text: new TextDecoder().decode(bytes), truncated: size > PREVIEW_LIMIT }
}

function HeaderRows({ rows, onChange }) {
    const listId = useId()
    const update = (id, field, value) => onChange(rows.map(r => (r.id === id ? { ...r, [field]: value } : r)))
    return (
        <div className="api-rt-stack">
            <datalist id={listId}>
                {COMMON_HEADERS.map(h => <option key={h} value={h} />)}
            </datalist>
            {rows.length === 0 && <p className="field-hint" style={{ marginTop: 0 }}>No headers yet.</p>}
            {rows.map((row, i) => (
                <div key={row.id}>
                    <div className="api-rt-kv">
                        <input type="text" value={row.key} onChange={e => update(row.id, 'key', e.target.value)} placeholder="Header" aria-label={`Header ${i + 1} name`} list={listId} spellCheck={false} autoComplete="off" />
                        <input type="text" value={row.value} onChange={e => update(row.id, 'value', e.target.value)} placeholder="Value" aria-label={`Header ${i + 1} value`} spellCheck={false} autoComplete="off" />
                        <button type="button" className="icon-btn" onClick={() => onChange(rows.filter(r => r.id !== row.id))} aria-label={`Remove header ${i + 1}`}>
                            <Trash2 size={16} aria-hidden="true" />
                        </button>
                    </div>
                    {isForbiddenHeader(row.key) && (
                        <div className="field-hint api-rt-row-note">
                            <TriangleAlert size={12} aria-hidden="true" /> Browsers don’t let pages send this header.
                        </div>
                    )}
                </div>
            ))}
            <div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([...rows, { id: newRowId(), key: '', value: '' }])} style={{ color: 'var(--primary-text)' }}>
                    <Plus size={14} aria-hidden="true" /> Add header
                </button>
            </div>
        </div>
    )
}

function Countdown({ at }) {
    const now = useNow()
    const seconds = Math.max(0, Math.ceil((at - now) / 1000))
    return <span aria-hidden="true">{seconds > 0 ? `in ${seconds} s` : 'now'}</span>
}

const eventSourceNote = ({ retry, lastEventId }) => (
    `EventSource would reconnect after ${formatDelay(retry)}${lastEventId ? ` and send Last-Event-ID: ${lastEventId}` : ''}. `
    + 'Tick “Reconnect automatically” to do the same. A server stops reconnections by answering 204 No Content.'
)

function BodyPreview({ body }) {
    if (!body.text) return <p>The response had no body.</p>
    return (
        <>
            <p>The response {body.truncated ? `started with (first ${formatBytes(PREVIEW_LIMIT)})` : 'was'}:</p>
            <pre className="code-well api-rt-body" tabIndex={0} role="region" aria-label="Response body">{body.text}</pre>
        </>
    )
}

function Outcome({ outcome }) {
    switch (outcome.kind) {
        case 'network':
            return (
                <StatusBanner tone="danger" title="No response: the request was blocked or the server couldn’t be reached">
                    <p>The browser doesn’t tell pages why a request failed. Likely causes:</p>
                    <ul className="api-rt-causes">
                        {outcome.offline && <li><strong>You’re offline.</strong> Check your connection.</li>}
                        {outcome.mixed && <li><strong>Mixed content:</strong> this page is served over https://, so the browser blocks plain http:// requests. Use https://.</li>}
                        <li>
                            <strong>CORS:</strong> the server has to allow requests from {outcome.origin} with an Access-Control-Allow-Origin header.
                            {outcome.preflight.length > 0 && <> Because of {outcome.preflight.join(', ')}, the browser first sends a preflight (OPTIONS) request, and the server must list {outcome.preflight.length === 1 ? 'that header' : 'those headers'} in Access-Control-Allow-Headers.</>}
                            {outcome.credentials && <> With “Send cookies” on, it must also send Access-Control-Allow-Credentials: true and name this origin exactly, not *.</>}
                        </li>
                        <li><strong>The server can’t be reached:</strong> a wrong host name, a DNS failure, a refused connection or an invalid TLS certificate.</li>
                        <li><strong>An extension</strong>, such as an ad or privacy blocker, cancelled it.</li>
                    </ul>
                    <p>The browser’s developer console shows the exact reason.</p>
                </StatusBanner>
            )
        case 'status':
            return (
                <StatusBanner tone="danger" title={`The server answered ${outcome.status} ${outcome.statusText}`.trim()}>
                    <p>
                        {outcome.status === 204
                            ? '204 No Content is how a server tells clients to stop reconnecting.'
                            : 'An event stream needs a 200 response. EventSource would fail here too, and not reconnect.'}
                        {(outcome.status === 401 || outcome.status === 403) && ' Check the Authorization header or the cookies.'}
                    </p>
                    {outcome.status !== 204 && <BodyPreview body={outcome.body} />}
                </StatusBanner>
            )
        case 'content-type':
            return (
                <StatusBanner tone="danger" title="The response isn’t an event stream">
                    <p>
                        It’s {outcome.contentType ? <span className="mono">{outcome.contentType}</span> : 'sent without a Content-Type'}, but event streams must be text/event-stream.
                        EventSource refuses anything else.
                    </p>
                    <BodyPreview body={outcome.body} />
                </StatusBanner>
            )
        case 'setup':
            return <StatusBanner tone="danger" title="The browser refused to send this request">{outcome.message}</StatusBanner>
        case 'ended':
            return <StatusBanner tone="info" title="The server ended the stream">{eventSourceNote(outcome)}</StatusBanner>
        case 'lost':
            return <StatusBanner tone="warning" title="The connection was lost">{eventSourceNote(outcome)}</StatusBanner>
        default:
            return null
    }
}

/**
 * Server-sent events client. Uses fetch() and a ReadableStream instead of
 * EventSource, so it can send custom headers (EventSource can't), and parses
 * the stream with the standard's rules (utils/sse.js). Reconnecting is
 * optional and works like EventSource: after the server's retry time, with
 * Last-Event-ID, and never after an HTTP error.
 */
export default function SseClient({ hidden, envs, activeEnvId, onSelectEnv, onManageEnvs, resolveVars, onLiveChange }) {
    const { size } = usePane()
    const compact = size === 'sm'
    const urlId = useId()
    const cookiesId = useId()
    const reconnectId = useId()
    const commentsId = useId()

    const [storedUrl, setStoredUrl] = useLocalStorage('api-sse-url', '')
    const [url, setUrl] = useState(() => (typeof storedUrl === 'string' ? storedUrl : ''))
    const [headers, setHeaders] = useState([])
    const [withCredentials, setWithCredentials] = useState(false)
    const [autoReconnect, setAutoReconnect] = useState(false)
    const [showComments, setShowComments] = useState(false)
    const [conn, setConn] = useState({ phase: 'idle' })
    const [problem, setProblem] = useState(null)
    const [notes, setNotes] = useState([])
    const runRef = useRef(null)
    const liveRef = useRef(onLiveChange)
    const log = useMessageLog()

    useEffect(() => {
        liveRef.current = onLiveChange
    })

    // Leaving the page stops the stream
    useEffect(() => () => {
        const run = runRef.current
        runRef.current = null
        run?.controller?.abort()
        clearTimeout(run?.timer)
    }, [])

    const envName = envs.find(e => e.id === activeEnvId)?.name ?? ''
    const running = conn.phase === 'connecting' || conn.phase === 'open' || conn.phase === 'waiting'

    const finish = (run, outcome) => {
        if (runRef.current !== run) return
        runRef.current = null
        liveRef.current?.(false)
        setConn({ phase: 'closed', outcome })
        if (outcome.kind === 'network') log.push(systemEntry('No response: the request was blocked or the server couldn’t be reached', 'danger'))
        else if (outcome.kind === 'status') log.push(systemEntry(`The server answered ${outcome.status} ${outcome.statusText}`.trim(), 'danger'))
        else if (outcome.kind === 'content-type') log.push(systemEntry(`The response is ${outcome.contentType || 'without a Content-Type'}, not text/event-stream`, 'danger'))
        else if (outcome.kind === 'setup') log.push(systemEntry('The browser refused to send the request', 'danger'))
    }

    const wait = (run) => {
        const delay = Math.min(run.retry, MAX_DELAY)
        run.timer = setTimeout(() => {
            run.timer = null
            if (runRef.current === run) openStream(run)
        }, delay)
        setConn({ phase: 'waiting', retryAt: timeIn(delay), lastEventId: run.lastEventId })
        log.push(systemEntry(`Reconnecting in ${formatDelay(delay)}`))
    }

    const openStream = async (run) => {
        const reconnecting = run.attempt > 0
        run.attempt++
        const controller = new AbortController()
        run.controller = controller
        const requestHeaders = new Headers(run.headers)
        const resumeFrom = reconnecting && run.lastEventId ? run.lastEventId : ''
        if (resumeFrom) requestHeaders.set('Last-Event-ID', lastEventIdHeader(resumeFrom))
        setConn({ phase: 'connecting', reconnecting })
        log.push(systemEntry(`${reconnecting ? 'Reconnecting to' : 'Connecting to'} ${displayUrl(run.url)}${resumeFrom ? ` with Last-Event-ID: ${resumeFrom}` : ''}`))

        let res
        try {
            res = await fetch(run.url, {
                headers: requestHeaders,
                signal: controller.signal,
                cache: 'no-store',
                credentials: run.credentials ? 'include' : 'same-origin',
                redirect: 'follow',
            })
        } catch (error) {
            if (runRef.current !== run) return
            if (error instanceof TypeError && SETUP_ERROR.test(error.message)) {
                finish(run, { kind: 'setup', message: error.message })
            } else if (reconnecting && run.reconnect) {
                // EventSource keeps retrying after network errors
                log.push(systemEntry('No response: the request was blocked or the server couldn’t be reached', 'danger'))
                wait(run)
            } else {
                finish(run, {
                    kind: 'network',
                    origin: window.location.origin,
                    offline: navigator.onLine === false,
                    mixed: isMixedContent(window.location.protocol, run.url),
                    credentials: run.credentials,
                    preflight: preflightHeaders([...run.sent, ...(resumeFrom ? [{ key: 'Last-Event-ID', value: resumeFrom }] : [])]),
                })
            }
            return
        }
        if (runRef.current !== run) return

        const contentType = res.headers.get('content-type') || ''
        const statusText = res.statusText || getStatusText(res.status)
        if (res.status !== 200 || !isEventStream(contentType)) {
            const body = await readPreview(res)
            if (runRef.current !== run) return
            finish(run, { kind: res.status !== 200 ? 'status' : 'content-type', status: res.status, statusText, contentType, body })
            return
        }

        setConn({ phase: 'open', contentType, redirectedTo: res.redirected ? res.url : null })
        log.push(systemEntry(`Connected: ${res.status} ${statusText}, ${contentType}${res.redirected ? `, after a redirect to ${displayUrl(res.url)}` : ''}`, 'success'))
        const parser = createEventStreamParser({
            lastEventId: run.lastEventId,
            onEvent: (event) => log.push(eventEntry(event)),
            onRetry: (ms) => {
                run.retry = ms
                log.push(systemEntry(`The server set the reconnection time to ${formatDelay(ms)} (retry: ${ms})`))
            },
            onComment: (text) => log.push(commentEntry(text)),
        })
        let lost = false
        try {
            // A 200 response always has a body; an empty one simply ends at once
            const reader = res.body?.getReader()
            while (reader) {
                const { value, done } = await reader.read()
                if (done || runRef.current !== run) break
                parser.feed(value)
            }
        } catch {
            lost = true
        }
        if (runRef.current !== run) return

        const { discarded } = parser.end()
        run.lastEventId = parser.lastEventId
        run.lastEnd = lost ? 'lost' : 'ended'
        if (discarded) log.push(systemEntry('The stream ended in the middle of an event (no blank line after it), so that event was discarded, as EventSource does', 'warning'))
        log.push(systemEntry(lost ? 'The connection was lost' : 'The server ended the stream', 'warning'))
        if (run.reconnect) wait(run)
        else finish(run, { kind: run.lastEnd, retry: run.retry, lastEventId: run.lastEventId })
    }

    const start = () => {
        if (runRef.current) return
        const urlVars = new Set()
        const target = toHttpUrl(resolveVars(url.trim(), urlVars))
        if (urlVars.size) return setProblem({ kind: 'unresolved', names: [...urlVars] })
        if (target.error) return setProblem({ kind: 'invalid-url', message: target.error, suggestion: target.suggestion })

        const headerVars = new Set()
        const list = headers.filter(h => h.key.trim()).map(h => ({ key: resolveVars(h.key.trim(), headerVars), value: resolveVars(h.value, headerVars) }))
        const built = new Headers()
        for (const h of list) {
            try {
                built.append(h.key, h.value)
            } catch {
                return setProblem({ kind: 'header', message: `The header “${h.key}” can’t be sent. Names may only use letters, digits and !#$%&'*+-.^_\`|~, and values must be Latin-1 text without line breaks.` })
            }
        }
        if (!built.has('accept')) built.set('Accept', 'text/event-stream')

        const nextNotes = []
        const dropped = [...new Set(list.filter(h => isForbiddenHeader(h.key)).map(h => h.key))]
        if (dropped.length) nextNotes.push(`The browser doesn’t let pages send ${dropped.join(', ')}, so ${dropped.length > 1 ? 'they were' : 'it was'} left out.`)
        if (headerVars.size) nextNotes.push(`Sent with undefined variables left as written: ${[...headerVars].map(n => `{{${n}}}`).join(', ')}.`)

        const run = {
            url: target.url,
            headers: built,
            sent: list,
            credentials: withCredentials,
            reconnect: autoReconnect,
            retry: DEFAULT_RETRY,
            lastEventId: '',
            lastEnd: 'ended',
            attempt: 0,
            controller: null,
            timer: null,
        }
        runRef.current = run
        setStoredUrl(urlForStorage(url))
        setProblem(null)
        setNotes(nextNotes)
        liveRef.current?.(true)
        openStream(run)
    }

    const stop = () => {
        const run = runRef.current
        if (!run) return
        runRef.current = null
        run.controller?.abort()
        clearTimeout(run.timer)
        liveRef.current?.(false)
        setConn({ phase: 'closed', outcome: { kind: 'stopped' } })
        log.push(systemEntry('Stopped'))
    }

    const changeReconnect = (checked) => {
        setAutoReconnect(checked)
        const run = runRef.current
        if (!run) return
        run.reconnect = checked
        // Waiting to reconnect: stop waiting
        if (!checked && run.timer) {
            clearTimeout(run.timer)
            run.timer = null
            finish(run, { kind: run.lastEnd, retry: run.retry, lastEventId: run.lastEventId })
        }
    }

    // ------------------------------------------------------ derived UI ---
    const missingVars = useMemo(() => {
        const names = new Set()
        resolveVars(url, names)
        headers.forEach(h => {
            resolveVars(h.key, names)
            resolveVars(h.value, names)
        })
        return [...names]
    }, [url, headers, resolveVars])
    const preview = useMemo(() => toHttpUrl(resolveVars(url.trim())), [url, resolveVars])
    const mixedWarning = Boolean(preview.url) && isMixedContent(window.location.protocol, preview.url)
    const commentCount = log.entries.filter(e => e.kind === 'comment').length
    const outcome = conn.phase === 'closed' ? conn.outcome : null
    const statusKey = !outcome ? conn.phase : ['stopped', 'ended', 'lost'].includes(outcome.kind) ? outcome.kind : 'failed'
    const status = STATUS[statusKey]
    const statusLabel = conn.phase === 'connecting' && conn.reconnecting ? 'Reconnecting…' : status.label

    return (
        <div className="api-rt-panel" hidden={hidden}>
            <form
                className="card card-compact api-rt-stack"
                aria-label="Event stream connection"
                onSubmit={event => {
                    event.preventDefault()
                    if (!running) start()
                }}
            >
                <div className="api-rt-line">
                    <label htmlFor={urlId} className="sr-only">Event stream URL</label>
                    <input
                        id={urlId}
                        type="text"
                        inputMode="url"
                        className="api-rt-url"
                        value={url}
                        onChange={e => {
                            setUrl(e.target.value)
                            setProblem(null)
                        }}
                        readOnly={running}
                        placeholder="https://example.com/events or {{sse_url}}"
                        spellCheck={false}
                        autoComplete="off"
                    />
                    {/* Separate keys, so a Stop click can't turn into a submit */}
                    {running ? (
                        <button key="stop" type="button" className="btn btn-danger" onClick={stop} style={{ flex: compact ? '1 1 100%' : '0 0 auto' }}>
                            <Square size={16} aria-hidden="true" /> Stop
                        </button>
                    ) : (
                        <button key="connect" type="submit" className="btn btn-primary" style={{ flex: compact ? '1 1 100%' : '0 0 auto' }}>
                            <Play size={16} aria-hidden="true" /> Connect
                        </button>
                    )}
                </div>

                <div className="api-rt-line api-rt-spread">
                    <EnvironmentPicker envs={envs} activeId={activeEnvId} onSelect={onSelectEnv} onManage={onManageEnvs} compact={compact} />
                    <div className="api-rt-status">
                        <span role="status">
                            <span className={`badge ${status.badge}`}>
                                {conn.phase === 'connecting' && <Loader2 size={12} className="spin" aria-hidden="true" />}
                                {statusLabel}
                            </span>
                        </span>
                        {conn.phase === 'waiting' && <Countdown at={conn.retryAt} />}
                        {conn.phase === 'open' && <span className="mono">{conn.contentType}</span>}
                    </div>
                </div>

                {conn.phase === 'open' && conn.redirectedTo && (
                    <p className="field-hint" style={{ marginTop: 0, overflowWrap: 'anywhere' }}>Redirected to <span className="mono">{conn.redirectedTo}</span></p>
                )}
                {problem?.kind === 'invalid-url' && (
                    <StatusBanner
                        tone="danger"
                        title="Can’t connect: the URL isn’t valid"
                        action={problem.suggestion && (
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setUrl(problem.suggestion); setProblem(null) }}>
                                Use {problem.suggestion.split('://')[0]}://
                            </button>
                        )}
                    >
                        {problem.message}
                    </StatusBanner>
                )}
                {problem?.kind === 'unresolved' && (
                    <StatusBanner tone="danger" title="Can’t connect: the URL uses undefined variables" action={<button type="button" className="btn btn-sm btn-secondary" onClick={onManageEnvs}>Environments</button>}>
                        {problem.names.map(n => `{{${n}}}`).join(', ')} {problem.names.length === 1 ? 'isn’t' : 'aren’t'} defined in the “{envName}” environment.
                    </StatusBanner>
                )}
                {problem?.kind === 'header' && <StatusBanner tone="danger" title="Can’t connect: check the headers">{problem.message}</StatusBanner>}
                {!problem && outcome && <Outcome outcome={outcome} />}
                {notes.length > 0 && conn.phase !== 'idle' && (
                    <StatusBanner tone="warning" title={notes.length === 1 ? 'Note' : 'Notes'}>
                        <ul className="api-rt-causes">{notes.map(n => <li key={n}>{n}</li>)}</ul>
                    </StatusBanner>
                )}
                {missingVars.length > 0 && !problem && (
                    <StatusBanner tone="warning" title="Undefined variables" action={<button type="button" className="btn btn-sm btn-secondary" onClick={onManageEnvs}>Environments</button>}>
                        {missingVars.map(n => `{{${n}}}`).join(', ')} {missingVars.length === 1 ? 'isn’t' : 'aren’t'} set in “{envName}”.
                    </StatusBanner>
                )}
                {mixedWarning && !running && !problem && (
                    <StatusBanner tone="warning" title="This http:// request will probably be blocked">
                        The page is served over https://, and browsers block plain http:// requests from it (mixed content). Use https:// if the server supports it.
                    </StatusBanner>
                )}
            </form>

            <div className="split-pane">
                <section className="card card-compact api-rt-stack" aria-label="Request headers and options">
                    <h2 className="section-title">Headers</h2>
                    <HeaderRows rows={headers} onChange={setHeaders} />
                    <p className="field-hint" style={{ marginTop: 0 }}>
                        Accept: text/event-stream is added unless you set it. Values can use {'{{variables}}'}.
                        Headers such as Authorization make a cross-origin server answer a CORS preflight first (EventSource can’t send them at all).
                    </p>
                    <div className="api-rt-check">
                        <input id={cookiesId} type="checkbox" checked={withCredentials} onChange={e => setWithCredentials(e.target.checked)} aria-describedby={`${cookiesId}-hint`} />
                        <div>
                            <label htmlFor={cookiesId}>Send cookies</label>
                            <p id={`${cookiesId}-hint`} className="field-hint">
                                Sends the browser’s cookies for the site, like EventSource’s withCredentials. The server must allow it with Access-Control-Allow-Credentials.
                            </p>
                        </div>
                    </div>
                    <div className="api-rt-check">
                        <input id={reconnectId} type="checkbox" checked={autoReconnect} onChange={e => changeReconnect(e.target.checked)} aria-describedby={`${reconnectId}-hint`} />
                        <div>
                            <label htmlFor={reconnectId}>Reconnect automatically</label>
                            <p id={`${reconnectId}-hint`} className="field-hint">
                                Like EventSource: after the stream ends or drops, wait for the retry time ({formatDelay(DEFAULT_RETRY)} unless the server sets one), then reconnect with Last-Event-ID. Never after an HTTP error.
                            </p>
                        </div>
                    </div>
                    {running && (
                        <p className="field-hint api-rt-note" style={{ marginTop: 0 }}>
                            <Info size={13} aria-hidden="true" />
                            <span>Header and cookie changes apply the next time you connect.</span>
                        </p>
                    )}
                </section>

                <MessageLog
                    title="Events"
                    noun="event"
                    entries={log.entries}
                    dropped={log.dropped}
                    announcement={log.announcement}
                    onClear={log.clear}
                    hiddenKinds={showComments ? undefined : COMMENTS}
                    toolbar={(
                        <label htmlFor={commentsId} className="api-rt-inline-check">
                            <input id={commentsId} type="checkbox" checked={showComments} onChange={e => setShowComments(e.target.checked)} />
                            Show comments ({commentCount.toLocaleString()})
                        </label>
                    )}
                    empty={(
                        <EmptyState icon={Radio} title="No events yet">
                            Connect to start receiving events. Each one shows its type, id, data and the time it arrived.
                        </EmptyState>
                    )}
                />
            </div>
        </div>
    )
}
