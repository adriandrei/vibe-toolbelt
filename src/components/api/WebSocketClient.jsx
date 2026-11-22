import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Braces, Info, Loader2, Plug, RadioTower, Send, Square, Unplug } from 'lucide-react'
import EmptyState from '../ui/EmptyState'
import Field from '../ui/Field'
import StatusBanner from '../ui/StatusBanner'
import { useToast } from '../ToastProvider'
import { usePane } from '../../contexts/pane'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { isMacPlatform } from '../../utils/palette'
import {
    describeCloseCode, displayUrl, isJsonContainer, isMixedContent, parseSubprotocols, prettyJson, toWebSocketUrl, urlForStorage,
} from '../../utils/realtime'
import EnvironmentPicker from './EnvironmentPicker'
import MessageLog from './MessageLog'
import { binaryEntry, systemEntry, textEntry, useMessageLog } from './useMessageLog'

const SEND_SHORTCUT = isMacPlatform ? '⌘ Enter' : 'Ctrl + Enter'
const JSON_CHECK_LIMIT = 2_000_000
const STATUS = {
    idle: { label: 'Not connected', badge: '' },
    connecting: { label: 'Connecting…', badge: 'badge-info' },
    open: { label: 'Connected', badge: 'badge-success' },
    closing: { label: 'Closing…', badge: 'badge-warning' },
}

const closeLabel = (code) => `${code} ${describeCloseCode(code).name}`

// One line for the log about how a connection ended
function closeSummary({ code, reason, opened, byUser }) {
    const why = reason ? `: “${reason}”` : ''
    if (byUser) return opened ? `Disconnected (${closeLabel(code)})` : 'Connection attempt cancelled'
    if (!opened) return `Couldn’t connect (${closeLabel(code)})`
    if (code === 1006) return `Connection lost (${closeLabel(code)})`
    return `Closed by the server with ${closeLabel(code)}${why}`
}

function closeTone({ code, opened, byUser }) {
    if (byUser) return 'info'
    if (!opened) return 'danger'
    return code === 1000 || code === 1001 ? 'info' : 'warning'
}

function ConnectFailure({ conn, origin }) {
    return (
        <StatusBanner tone="danger" title="Couldn’t connect">
            <p>The browser doesn’t tell pages why a WebSocket failed: it only reports close code 1006. Likely causes:</p>
            <ul className="api-rt-causes">
                {conn.mixed && (
                    <li><strong>Mixed content:</strong> this page is served over https://, so the browser blocks insecure ws:// connections. Use wss://.</li>
                )}
                <li><strong>No WebSocket server at this URL:</strong> the host can’t be reached, or the path answers with an ordinary HTTP response (such as 404) instead of switching protocols.</li>
                <li><strong>The server refused the handshake</strong>, for example because it checks the Origin ({origin}) or wants credentials. Browsers can’t send an Authorization header with a WebSocket (see the note above).</li>
                {conn.requested?.length > 0 && (
                    <li><strong>No subprotocol was accepted:</strong> the server must pick one of {conn.requested.join(', ')}, or the browser drops the connection.</li>
                )}
                {conn.url?.startsWith('wss:') && <li><strong>The certificate isn’t trusted</strong>, or the server doesn’t speak TLS on this port.</li>}
                <li><strong>An extension, firewall or proxy</strong> blocked it.</li>
            </ul>
            <p>The browser’s developer console shows the exact reason.</p>
        </StatusBanner>
    )
}

function ProblemBanner({ problem, envName, onUseSuggestion, onManageEnvs }) {
    switch (problem.kind) {
        case 'invalid-url':
            return (
                <StatusBanner
                    tone="danger"
                    title="Can’t connect: the URL isn’t valid"
                    action={problem.suggestion && (
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => onUseSuggestion(problem.suggestion)}>
                            Use {problem.suggestion.split('://')[0]}://
                        </button>
                    )}
                >
                    {problem.message}
                </StatusBanner>
            )
        case 'unresolved':
            return (
                <StatusBanner tone="danger" title={`Can’t connect: ${problem.where === 'URL' ? 'the URL uses' : 'the subprotocols use'} undefined variables`} action={<button type="button" className="btn btn-sm btn-secondary" onClick={onManageEnvs}>Environments</button>}>
                    {problem.names.map(n => `{{${n}}}`).join(', ')} {problem.names.length === 1 ? 'isn’t' : 'aren’t'} defined in the “{envName}” environment.
                </StatusBanner>
            )
        case 'protocols':
            return <StatusBanner tone="danger" title="Can’t connect: check the subprotocols">{problem.message}</StatusBanner>
        case 'mixed':
            return (
                <StatusBanner tone="danger" title="Blocked: an insecure WebSocket from a secure page">
                    This page is served over https://, and browsers don’t allow ws:// connections from it (mixed content). Use wss://, or a ws:// server on this machine (localhost).
                </StatusBanner>
            )
        default:
            return <StatusBanner tone="danger" title="The browser refused to open this connection">{problem.message}</StatusBanner>
    }
}

/**
 * WebSocket client: connect (with optional subprotocols), send text messages,
 * and log what goes each way. Binary messages arrive as ArrayBuffers and are
 * shown as hex or Base64. Nothing from the connection is stored, except the
 * URL with its secrets removed (urlForStorage).
 */
export default function WebSocketClient({ hidden, envs, activeEnvId, onSelectEnv, onManageEnvs, resolveVars, onLiveChange }) {
    const toast = useToast()
    const { size } = usePane()
    const compact = size === 'sm'
    const urlId = useId()
    const protocolsId = useId()
    const messageId = useId()

    const [storedUrl, setStoredUrl] = useLocalStorage('api-ws-url', '')
    const [url, setUrl] = useState(() => (typeof storedUrl === 'string' ? storedUrl : ''))
    const [protocols, setProtocols] = useState('')
    const [message, setMessage] = useState('')
    const [conn, setConn] = useState({ phase: 'idle' })
    const [problem, setProblem] = useState(null)
    const sessionRef = useRef(null) // { ws, opened, byUser } of the current connection
    const liveRef = useRef(onLiveChange)
    const log = useMessageLog()

    useEffect(() => {
        liveRef.current = onLiveChange
    })

    // Leaving the page closes the connection
    useEffect(() => () => {
        const session = sessionRef.current
        sessionRef.current = null
        if (!session) return
        const { ws } = session
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.close(1000)
    }, [])

    const envName = envs.find(e => e.id === activeEnvId)?.name ?? ''
    const live = conn.phase === 'connecting' || conn.phase === 'open' || conn.phase === 'closing'

    const connect = () => {
        if (sessionRef.current) return
        const urlVars = new Set()
        const target = toWebSocketUrl(resolveVars(url.trim(), urlVars))
        if (urlVars.size) return setProblem({ kind: 'unresolved', names: [...urlVars], where: 'URL' })
        if (target.error) return setProblem({ kind: 'invalid-url', message: target.error, suggestion: target.suggestion })
        const protocolVars = new Set()
        const sub = parseSubprotocols(resolveVars(protocols, protocolVars))
        if (protocolVars.size) return setProblem({ kind: 'unresolved', names: [...protocolVars], where: 'subprotocols' })
        if (sub.error) return setProblem({ kind: 'protocols', message: sub.error })
        const mixed = isMixedContent(window.location.protocol, target.url)

        let ws
        try {
            ws = sub.list.length ? new WebSocket(target.url, sub.list) : new WebSocket(target.url)
        } catch (error) {
            // Chrome and Firefox throw a SecurityError for mixed content
            return setProblem(mixed && error?.name === 'SecurityError' ? { kind: 'mixed' } : { kind: 'refused', message: error?.message || String(error) })
        }
        ws.binaryType = 'arraybuffer'
        const session = { ws, opened: false, byUser: false }
        sessionRef.current = session
        setStoredUrl(urlForStorage(url))
        setProblem(null)
        setConn({ phase: 'connecting', url: target.url, requested: sub.list, mixed })
        liveRef.current?.(true)
        log.push(systemEntry(`Connecting to ${displayUrl(target.url)}${sub.list.length ? ` with subprotocols ${sub.list.join(', ')}` : ''}`))

        ws.onopen = () => {
            if (sessionRef.current !== session) return
            session.opened = true
            setConn(c => ({ ...c, phase: 'open', protocol: ws.protocol, extensions: ws.extensions }))
            log.push(systemEntry(`Connected${ws.protocol ? `, subprotocol ${ws.protocol}` : ''}${ws.extensions ? `, extensions ${ws.extensions}` : ''}`, 'success'))
        }
        ws.onmessage = (event) => {
            if (sessionRef.current !== session) return
            const { data } = event
            if (typeof data === 'string') log.push(textEntry('in', data))
            else if (data instanceof Blob) data.arrayBuffer().then(buffer => log.push(binaryEntry('in', buffer)))
            else log.push(binaryEntry('in', data))
        }
        ws.onclose = (event) => {
            if (sessionRef.current !== session) return
            sessionRef.current = null
            liveRef.current?.(false)
            const result = { code: event.code, reason: event.reason, opened: session.opened, byUser: session.byUser }
            setConn(c => ({ ...c, phase: 'closed', ...result }))
            log.push(systemEntry(closeSummary(result), closeTone(result)))
        }
    }

    const disconnect = () => {
        const session = sessionRef.current
        if (!session) return
        session.byUser = true
        session.ws.close(1000)
        setConn(c => ({ ...c, phase: 'closing' }))
    }

    const send = () => {
        const session = sessionRef.current
        if (!session || session.ws.readyState !== WebSocket.OPEN) {
            toast.info('Connect first, then send the message.')
            return
        }
        const unresolved = new Set()
        const text = resolveVars(message, unresolved)
        try {
            session.ws.send(text)
        } catch (error) {
            toast.error(`The message wasn’t sent: ${error.message}`)
            return
        }
        log.push(textEntry('out', text))
        if (unresolved.size) toast.warning(`Sent with undefined variables left as written: ${[...unresolved].map(n => `{{${n}}}`).join(', ')}.`, 6000)
    }

    // ------------------------------------------------------ derived UI ---
    const missingVars = useMemo(() => {
        const names = new Set()
        resolveVars(url, names)
        resolveVars(protocols, names)
        return [...names]
    }, [url, protocols, resolveVars])
    const preview = useMemo(() => toWebSocketUrl(resolveVars(url.trim())), [url, resolveVars])
    const mixedWarning = Boolean(preview.url) && isMixedContent(window.location.protocol, preview.url)
    const jsonError = useMemo(() => {
        if (!/^\s*[[{]/.test(message) || message.length > JSON_CHECK_LIMIT) return null
        const filled = resolveVars(message)
        try {
            JSON.parse(filled)
            return null
        } catch (error) {
            // Undefined {{variables}} can't be checked
            return filled.includes('{{') ? null : error.message
        }
    }, [message, resolveVars])
    const canFormat = message.length <= JSON_CHECK_LIMIT && isJsonContainer(message)
    const status = conn.phase === 'closed'
        ? {
            label: conn.byUser ? (conn.opened ? 'Disconnected' : 'Cancelled') : conn.opened ? 'Closed' : 'Couldn’t connect',
            badge: !conn.opened && !conn.byUser ? 'badge-danger' : '',
        }
        : STATUS[conn.phase]
    const closeInfo = conn.phase === 'closed' ? describeCloseCode(conn.code) : null
    const isOpen = conn.phase === 'open'

    const onComposerKeyDown = (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            if (message !== '') send()
        }
    }

    return (
        <div className="api-rt-panel" hidden={hidden}>
            <form
                className="card card-compact api-rt-stack"
                aria-label="WebSocket connection"
                onSubmit={event => {
                    event.preventDefault()
                    if (!live) connect()
                }}
            >
                <div className="api-rt-line">
                    <label htmlFor={urlId} className="sr-only">WebSocket URL</label>
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
                        readOnly={live}
                        placeholder="wss://example.com/socket or {{ws_url}}"
                        spellCheck={false}
                        autoComplete="off"
                    />
                    {/* Separate keys, so a Disconnect click can't turn into a submit */}
                    {conn.phase === 'open' || conn.phase === 'connecting' ? (
                        <button key="disconnect" type="button" className="btn btn-danger" onClick={disconnect} style={{ flex: compact ? '1 1 100%' : '0 0 auto' }}>
                            {conn.phase === 'open' ? <><Unplug size={16} aria-hidden="true" /> Disconnect</> : <><Square size={16} aria-hidden="true" /> Cancel</>}
                        </button>
                    ) : conn.phase === 'closing' ? (
                        <button key="closing" type="button" className="btn btn-secondary" disabled style={{ flex: compact ? '1 1 100%' : '0 0 auto' }}>
                            <Loader2 size={16} className="spin" aria-hidden="true" /> Closing…
                        </button>
                    ) : (
                        <button key="connect" type="submit" className="btn btn-primary" style={{ flex: compact ? '1 1 100%' : '0 0 auto' }}>
                            <Plug size={16} aria-hidden="true" /> Connect
                        </button>
                    )}
                </div>

                <div className="api-rt-line api-rt-spread">
                    <EnvironmentPicker envs={envs} activeId={activeEnvId} onSelect={onSelectEnv} onManage={onManageEnvs} compact={compact} />
                    <div className="api-rt-status" role="status">
                        <span className={`badge ${status.badge}`}>
                            {(conn.phase === 'connecting' || conn.phase === 'closing') && <Loader2 size={12} className="spin" aria-hidden="true" />}
                            {status.label}
                        </span>
                        {/* The spaces keep the announced text readable; flex layout ignores them */}
                        {isOpen && conn.protocol && <>{' '}<span>Subprotocol <span className="mono">{conn.protocol}</span></span></>}
                        {isOpen && conn.extensions && <>{' '}<span className="mono">{conn.extensions}</span></>}
                        {closeInfo && <>{' '}<span className="mono">{closeLabel(conn.code)}</span></>}
                        {closeInfo && conn.reason && <>{' '}<span className="api-rt-reason">“{conn.reason}”</span></>}
                    </div>
                </div>

                {closeInfo && conn.opened && closeInfo.description && conn.code !== 1000 && (
                    <p className="field-hint" style={{ marginTop: 0 }}>{conn.code}: {closeInfo.description}</p>
                )}

                <Field
                    label="Subprotocols (optional)"
                    hint="Comma-separated, such as graphql-transport-ws. The server must accept one, or the browser closes the connection."
                >
                    <input
                        id={protocolsId}
                        type="text"
                        value={protocols}
                        onChange={e => {
                            setProtocols(e.target.value)
                            setProblem(null)
                        }}
                        readOnly={live}
                        placeholder="chat.v2, json"
                        spellCheck={false}
                        autoComplete="off"
                        className="api-rt-compact-input mono"
                    />
                </Field>

                <p className="field-hint api-rt-note">
                    <Info size={13} aria-hidden="true" />
                    <span>
                        Browsers can’t send headers such as Authorization with a WebSocket. If the server allows it, pass a token in the query string (?token=…) or as a subprotocol.
                        When this page remembers the URL it only blanks values named like token, key or auth, and servers often log URLs, so prefer a {'{{variable}}'} and a short-lived token.
                    </span>
                </p>

                {preview.converted && !live && (
                    <p className="field-hint" style={{ marginTop: 0, overflowWrap: 'anywhere' }}>
                        Connects to <span className="mono">{preview.url}</span>: http:// and https:// become ws:// and wss://.
                    </p>
                )}
                {problem && (
                    <ProblemBanner
                        problem={problem}
                        envName={envName}
                        onUseSuggestion={value => {
                            setUrl(value)
                            setProblem(null)
                        }}
                        onManageEnvs={onManageEnvs}
                    />
                )}
                {!problem && conn.phase === 'closed' && !conn.opened && !conn.byUser && <ConnectFailure conn={conn} origin={window.location.origin} />}
                {!problem && conn.phase === 'closed' && conn.opened && !conn.byUser && conn.code === 1006 && (
                    <StatusBanner tone="warning" title="Connection lost">
                        It ended without a close frame: the network dropped, the server stopped, or a proxy closed a connection it considered idle. Some servers expect regular messages or pings to keep it open.
                    </StatusBanner>
                )}
                {missingVars.length > 0 && !problem && (
                    <StatusBanner tone="warning" title="Undefined variables" action={<button type="button" className="btn btn-sm btn-secondary" onClick={onManageEnvs}>Environments</button>}>
                        {missingVars.map(n => `{{${n}}}`).join(', ')} {missingVars.length === 1 ? 'isn’t' : 'aren’t'} set in “{envName}”.
                    </StatusBanner>
                )}
                {mixedWarning && !live && !problem && (
                    <StatusBanner tone="warning" title="This ws:// connection will be blocked">
                        The page is served over https://, and browsers block insecure WebSockets from it (mixed content). Use wss:// if the server supports it.
                    </StatusBanner>
                )}
            </form>

            <div className="split-pane">
                <section className="card card-compact api-rt-stack" aria-label="Compose message">
                    <Field
                        label="Message"
                        hint={jsonError ? `Not valid JSON (${jsonError}). It’s sent as written.` : `{{variables}} are filled in when sending. ${SEND_SHORTCUT} sends.`}
                        labelAction={(
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMessage(prettyJson(message))} disabled={!canFormat} title={canFormat ? 'Indent the JSON message' : 'The message isn’t a JSON object or array'}>
                                <Braces size={14} aria-hidden="true" /> Format JSON
                            </button>
                        )}
                    >
                        <textarea
                            id={messageId}
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            onKeyDown={onComposerKeyDown}
                            placeholder={'{"type": "ping"}'}
                            spellCheck={false}
                            rows={8}
                            style={{ fontSize: '0.85rem' }}
                        />
                    </Field>
                    <div className="api-rt-line">
                        <button type="button" className="btn btn-primary" onClick={send} disabled={!isOpen || message === ''} title={`Send (${SEND_SHORTCUT})`}>
                            <Send size={16} aria-hidden="true" /> Send
                        </button>
                        {!isOpen && <span className="field-hint" style={{ marginTop: 0 }}>Connect to send messages.</span>}
                    </div>
                </section>

                <MessageLog
                    title="Messages"
                    noun="message"
                    entries={log.entries}
                    dropped={log.dropped}
                    announcement={log.announcement}
                    onClear={log.clear}
                    directionFilter
                    empty={(
                        <EmptyState icon={RadioTower} title="No messages yet">
                            Connect, then send a message. Messages from the server appear here as they arrive, newest at the bottom.
                        </EmptyState>
                    )}
                />
            </div>
        </div>
    )
}
