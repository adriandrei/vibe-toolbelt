import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, Loader2, RotateCcw, Send, Settings, Sparkles, Square, Upload, X } from 'lucide-react'
import { useAI } from '../contexts/AIContext'
import { usePipeline } from '../contexts/PipelineContext'
import { useEscape } from '../hooks/useEscape'
import { BRAND } from '../config/brand'
import CopyButton from './ui/CopyButton'
import StatusBanner from './ui/StatusBanner'
import AssistantMarkdown from './ai/AssistantMarkdown'
import { LoadProgress } from './ai/Progress'
import { AI_PANEL_ID, SETTINGS_PATH } from './ai/constants'
import './ai/ai.css'

const SYSTEM_PROMPT = [
    `You are the developer assistant built into ${BRAND.name}, a set of developer tools that run entirely in the user's browser.`,
    'Help with code, data formats (JSON, YAML, XML, CSV), regular expressions, SQL, tokens, encodings and similar technical work.',
    'Be concise and practical. Format answers in Markdown and put code in fenced code blocks with a language tag.',
    "If the question can't be answered from the information given, say so instead of guessing.",
].join(' ')

const GENERAL_PROMPTS = [
    'Write a regex that matches ISO 8601 dates',
    'What is the difference between JSON and YAML?',
    'Explain what HTTP status 422 means',
]

// How much tool data and earlier conversation is sent along (the model's
// context window is about 4,000 tokens).
const CONTEXT_CHARS = 2000
const HISTORY_CHARS = 6000

let messageSeq = 0
const nextMessageId = () => `m${++messageSeq}`

function fenced(text) {
    const longest = Math.max(0, ...(text.match(/`+/g) || []).map(run => run.length))
    const fence = '`'.repeat(Math.max(3, longest + 1))
    return `${fence}\n${text}\n${fence}`
}

function clip(value) {
    if (value === undefined || value === null) return null
    const text = (typeof value === 'string' ? value : String(value)).trim()
    if (!text) return null
    return text.length > CONTEXT_CHARS ? { text: text.slice(0, CONTEXT_CHARS), clipped: true } : { text, clipped: false }
}

function buildMessages(toolContext, history, question) {
    let system = SYSTEM_PROMPT
    if (toolContext?.tool) {
        let data = {}
        try {
            data = toolContext.getContext?.() || {}
        } catch {
            data = {}
        }
        system += `\n\nThe user is working in the "${toolContext.tool}" tool.`
        const input = clip(data.input)
        const output = clip(data.output)
        if (input) system += `\n\nCurrent input${input.clipped ? ` (first ${CONTEXT_CHARS} characters)` : ''}:\n${fenced(input.text)}`
        if (output) system += `\n\nCurrent output${output.clipped ? ` (first ${CONTEXT_CHARS} characters)` : ''}:\n${fenced(output.text)}`
        if (!input && !output) system += ' The tool has no input yet.'
    }

    const earlier = []
    let used = 0
    for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i]
        if ((message.role !== 'user' && message.role !== 'assistant') || !message.content) continue
        used += message.content.length
        if (used > HISTORY_CHARS) break
        earlier.unshift({ role: message.role, content: message.content })
    }
    while (earlier.length && earlier[0].role !== 'user') earlier.shift()

    return [{ role: 'system', content: system }, ...earlier, { role: 'user', content: question }]
}

/**
 * Slide-in AI chat. Knows the current tool through useRegisterAIContext and
 * keeps one conversation per tool: it starts over only when a different tool
 * registers (not while navigating through pages without AI context).
 */
export default function AIAssistant() {
    const ai = useAI()
    const { chat, abortChat, toolContext, aiPanelOpen, closeAIPanel } = ai
    const { sendText } = usePipeline()
    const tool = toolContext?.tool ?? null

    const [conversation, setConversation] = useState(() => ({ id: 1, tool, messages: [] }))
    const [pending, setPending] = useState(null)
    const [draft, setDraft] = useState('')
    const [error, setError] = useState(null)
    const pendingRef = useRef(null)

    if (tool && tool !== conversation.tool) {
        setConversation(prev => (prev.messages.length === 0 ? { ...prev, tool } : { id: prev.id + 1, tool, messages: [] }))
        setError(null)
        if (pending) setPending(null)
    }

    // An answer for a conversation that was replaced isn't needed any more
    useEffect(() => {
        const id = conversation.id
        return () => {
            if (pendingRef.current?.conversationId === id) {
                pendingRef.current = null
                abortChat()
            }
        }
    }, [conversation.id, abortChat])

    const send = useCallback(async (raw) => {
        const question = raw.trim()
        if (!question || pendingRef.current) return
        const conversationId = conversation.id
        const history = conversation.messages
        const userMessage = { id: nextMessageId(), role: 'user', content: question }
        const answerId = nextMessageId()
        const update = (fn) => setConversation(prev => (prev.id === conversationId ? { ...prev, messages: fn(prev.messages) } : prev))

        update(list => [...list, userMessage])
        setDraft('')
        setError(null)
        setPending({ id: answerId, text: '' })
        pendingRef.current = { conversationId }
        try {
            const result = await chat(buildMessages(toolContext, history, question), {
                onToken: (_token, full) => setPending(prev => (prev?.id === answerId ? { ...prev, text: full } : prev)),
            })
            if (result.text.trim()) {
                update(list => [...list, {
                    id: answerId,
                    role: 'assistant',
                    content: result.text,
                    aborted: result.aborted,
                    truncated: result.finishReason === 'length',
                }])
            }
        } catch (err) {
            // Put the question back so nothing is lost, and say what went wrong
            update(list => list.filter(m => m.id !== userMessage.id))
            setDraft(current => current || question)
            setError({ conversationId, message: err?.message || "The AI couldn't answer." })
        } finally {
            if (pendingRef.current?.conversationId === conversationId) pendingRef.current = null
            setPending(prev => (prev?.id === answerId ? null : prev))
        }
    }, [conversation, chat, toolContext])

    const stop = useCallback(() => {
        if (pendingRef.current) abortChat()
    }, [abortChat])

    const newChat = useCallback(() => {
        setConversation(prev => ({ id: prev.id + 1, tool: prev.tool, messages: [] }))
        setPending(null)
        setError(null)
    }, [])

    const sendToPipeline = useCallback((text) => {
        sendText(text, { source: 'ai', label: 'AI assistant' })
    }, [sendText])

    if (!aiPanelOpen) return null

    return (
        <AssistantPanel
            ai={ai}
            tool={tool}
            messages={conversation.messages}
            pending={pending}
            draft={draft}
            setDraft={setDraft}
            error={error && error.conversationId === conversation.id ? error.message : null}
            onDismissError={() => setError(null)}
            onSend={send}
            onStop={stop}
            onNewChat={newChat}
            onClose={closeAIPanel}
            onSendToPipeline={sendToPipeline}
        />
    )
}

function AssistantPanel({
    ai, tool, messages, pending, draft, setDraft, error, onDismissError,
    onSend, onStop, onNewChat, onClose, onSendToPipeline,
}) {
    const panelRef = useRef(null)
    const bodyRef = useRef(null)
    const inputRef = useRef(null)
    const actionRef = useRef(null)
    const stickToBottom = useRef(true)
    const titleId = useId()
    const loaded = ai.isLoaded
    const model = ai.getModel(ai.selectedModel)
    const hasConversation = messages.length > 0 || Boolean(pending)
    const busyElsewhere = ai.aiStatus === 'thinking' && !pending

    // Focus moves into the panel when it opens, and back where it was when it closes
    useEffect(() => {
        const previous = document.activeElement
        const target = inputRef.current || actionRef.current || panelRef.current
        target?.focus({ preventScroll: true })
        return () => {
            if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) {
                previous.focus({ preventScroll: true })
            }
        }
    }, [])

    // When the model finishes loading while the panel is open, go to the message box
    useEffect(() => {
        if (!loaded) return
        const active = document.activeElement
        if (!active || active === document.body || active === panelRef.current) inputRef.current?.focus({ preventScroll: true })
    }, [loaded])

    // Escape closes the panel when focus is in it (or nowhere in particular)
    useEscape((event) => {
        if (event.defaultPrevented) return
        const active = document.activeElement
        if (active && active !== document.body && !panelRef.current?.contains(active)) return
        event.preventDefault()
        onClose()
    })

    // Follow the conversation unless the user has scrolled up to read
    const streamingText = pending?.text
    useLayoutEffect(() => {
        const el = bodyRef.current
        if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
    }, [messages.length, streamingText, error])

    const handleSend = (text) => {
        stickToBottom.current = true
        onSend(text)
    }

    const subtitle = [tool ?? 'No tool context', loaded ? model?.name : null].filter(Boolean).join(' · ')

    return (
        <section
            id={AI_PANEL_ID}
            ref={panelRef}
            className="ai-panel"
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            tabIndex={-1}
        >
            <div className="ai-panel-header">
                <span className="ai-avatar" aria-hidden="true"><Sparkles size={16} /></span>
                <div className="ai-panel-heading">
                    <div id={titleId} className="ai-panel-title">AI assistant</div>
                    <div className="ai-panel-subtitle" title={subtitle}>{subtitle}</div>
                </div>
                <div className="ai-panel-actions">
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onNewChat}
                        disabled={!hasConversation}
                        aria-label="Start a new chat"
                        title="New chat"
                    >
                        <RotateCcw size={16} aria-hidden="true" />
                    </button>
                    <Link to={SETTINGS_PATH} className="icon-btn" onClick={onClose} aria-label="AI settings" title="AI settings">
                        <Settings size={16} aria-hidden="true" />
                    </Link>
                    <button type="button" className="icon-btn" onClick={onClose} aria-label="Close AI assistant" title="Close (Esc)">
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>
            </div>

            <div
                ref={bodyRef}
                className="ai-panel-body"
                onScroll={() => {
                    const el = bodyRef.current
                    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
                }}
            >
                {hasConversation ? (
                    <div role="log" aria-label="Conversation" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                        {messages.map(message => (
                            <MessageItem key={message.id} message={message} onSendToPipeline={onSendToPipeline} />
                        ))}
                        {pending && <PendingAnswer text={pending.text} />}
                    </div>
                ) : loaded ? (
                    <ReadyEmpty
                        tool={tool}
                        prompts={tool ? ai.toolContext?.suggestedPrompts || [] : GENERAL_PROMPTS}
                        onSend={handleSend}
                        disabled={busyElsewhere}
                    />
                ) : (
                    <NotReady ai={ai} actionRef={actionRef} onClose={onClose} />
                )}
            </div>

            {loaded ? (
                <Composer
                    inputRef={inputRef}
                    draft={draft}
                    setDraft={setDraft}
                    tool={tool}
                    streaming={Boolean(pending)}
                    busyElsewhere={busyElsewhere}
                    error={error}
                    onDismissError={onDismissError}
                    onSend={handleSend}
                    onStop={onStop}
                />
            ) : hasConversation ? (
                <div className="ai-footer-card">
                    <NotReady ai={ai} actionRef={actionRef} onClose={onClose} compact />
                </div>
            ) : null}
        </section>
    )
}

const MessageItem = memo(function MessageItem({ message, onSendToPipeline }) {
    if (message.role === 'user') {
        return (
            <div className="ai-msg ai-msg-user">
                <div className="ai-bubble ai-bubble-user">
                    <span className="sr-only">You: </span>
                    {message.content}
                </div>
            </div>
        )
    }
    return (
        <div className="ai-msg">
            <span className="ai-avatar ai-avatar-sm" aria-hidden="true"><Sparkles size={12} /></span>
            <div className="ai-msg-main">
                <div className="ai-bubble ai-bubble-assistant">
                    <span className="sr-only">Assistant: </span>
                    <AssistantMarkdown text={message.content} />
                </div>
                {message.aborted && <div className="ai-msg-note">Stopped before the end.</div>}
                {message.truncated && <div className="ai-msg-note">The answer reached the length limit. Ask it to continue for the rest.</div>}
                <div className="ai-msg-actions">
                    <CopyButton text={message.content} iconOnly label="Copy answer" />
                    <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        onClick={() => onSendToPipeline(message.content)}
                        aria-label="Send answer to the pipeline"
                        title="Send to pipeline"
                    >
                        <Upload size={14} aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    )
})

function PendingAnswer({ text }) {
    return (
        <div className="ai-msg">
            <span className="ai-avatar ai-avatar-sm" aria-hidden="true"><Sparkles size={12} /></span>
            <div className="ai-msg-main">
                <span className="sr-only">The assistant is writing an answer…</span>
                <div className="ai-bubble ai-bubble-assistant" aria-hidden="true">
                    {text && <AssistantMarkdown text={text} />}
                    <span className="ai-typing"><span /><span /><span /></span>
                </div>
            </div>
        </div>
    )
}

function ReadyEmpty({ tool, prompts, onSend, disabled }) {
    return (
        <div className="ai-empty">
            <div className="ai-empty-icon"><Sparkles size={22} aria-hidden="true" /></div>
            <div className="ai-empty-title">{tool ? `Ask about your ${tool} data` : 'Ask a developer question'}</div>
            <p className="ai-empty-text">
                {tool
                    ? "The assistant sees this tool's current input and output. Everything stays on this device."
                    : 'Open a tool to let the assistant see its input and output. Everything stays on this device.'}
            </p>
            {prompts.length > 0 && (
                <div className="ai-suggestions">
                    <div className="ai-suggestions-label">Try asking</div>
                    {prompts.map(prompt => (
                        <button key={prompt} type="button" className="ai-suggestion" onClick={() => onSend(prompt)} disabled={disabled}>
                            {prompt}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

function EmptyMessage({ icon: Icon, muted = false, spin = false, title, text, compact, children }) {
    if (compact) {
        return (
            <>
                <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{title}</div>
                {text && <div>{text}</div>}
                {children}
            </>
        )
    }
    return (
        <div className="ai-empty">
            <div className={`ai-empty-icon ${muted ? 'is-muted' : ''}`}>
                <Icon size={22} aria-hidden="true" className={spin ? 'spin' : undefined} />
            </div>
            <div className="ai-empty-title">{title}</div>
            {text && <p className="ai-empty-text">{text}</p>}
            {children}
        </div>
    )
}

function NotReady({ ai, actionRef, onClose, compact = false }) {
    const model = ai.getModel(ai.selectedModel)
    const name = model?.name ?? 'the AI model'

    if (ai.aiStatus === 'checking') {
        return <EmptyMessage icon={Loader2} spin muted compact={compact} title="Checking for WebGPU…" text="The assistant runs on your GPU, which needs WebGPU." />
    }

    if (ai.aiStatus === 'unsupported') {
        return (
            <EmptyMessage icon={AlertTriangle} muted compact={compact} title="The assistant can't run in this browser" text={ai.webGPUInfo?.message}>
                <div className="ai-empty-actions">
                    <Link ref={actionRef} to={SETTINGS_PATH} className="btn btn-secondary btn-sm" onClick={onClose}>See requirements</Link>
                </div>
            </EmptyMessage>
        )
    }

    if (ai.aiStatus === 'loading') {
        const loading = ai.getModel(ai.loadingModel)
        return (
            <EmptyMessage icon={Sparkles} compact={compact} title={`Loading ${loading?.name ?? name}`}>
                <LoadProgress
                    className="ai-progress-block"
                    text={ai.loadText}
                    percent={ai.loadProgress}
                    phase={ai.loadPhase}
                    label={`Loading ${loading?.name ?? name}`}
                />
                <div className="ai-empty-actions">
                    <button ref={actionRef} type="button" className="btn btn-secondary btn-sm" onClick={ai.cancelLoad}>
                        {ai.loadFromCache === false ? 'Cancel download' : 'Cancel'}
                    </button>
                </div>
            </EmptyMessage>
        )
    }

    if (ai.aiStatus === 'error') {
        return (
            <EmptyMessage icon={AlertTriangle} muted compact={compact} title={`${name} didn't load`} text={ai.loadError}>
                <div className="ai-empty-actions">
                    <button ref={actionRef} type="button" className="btn btn-primary btn-sm" onClick={() => ai.loadModel(undefined, { background: true })}>
                        Retry
                    </button>
                    <Link to={SETTINGS_PATH} className="btn btn-ghost btn-sm" onClick={onClose}>Settings</Link>
                </div>
            </EmptyMessage>
        )
    }

    // idle: the selected model isn't in memory (another one may be)
    const other = ai.loadedModel && ai.loadedModel !== ai.selectedModel ? ai.getModel(ai.loadedModel) : null
    return (
        <EmptyMessage
            icon={Sparkles}
            compact={compact}
            title={`Load ${name} to chat`}
            text={other
                ? `${other.name} is loaded, but ${name} is selected.`
                : `The assistant runs privately on your GPU. The first load downloads ${model?.size ?? 'about 1 GB'} from huggingface.co; after that it loads from this device.`}
        >
            <div className="ai-empty-actions">
                <button ref={actionRef} type="button" className="btn btn-primary btn-sm" onClick={() => ai.loadModel(undefined, { background: true })}>
                    <Download size={14} aria-hidden="true" /> Load {name}
                </button>
                {other ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => ai.changeModel(other.id)}>
                        Use {other.name}
                    </button>
                ) : (
                    <Link to={SETTINGS_PATH} className="btn btn-ghost btn-sm" onClick={onClose}>Choose model</Link>
                )}
            </div>
        </EmptyMessage>
    )
}

function Composer({ inputRef, draft, setDraft, tool, streaming, busyElsewhere, error, onDismissError, onSend, onStop }) {
    const id = useId()
    const hintId = `${id}-hint`
    const canSend = Boolean(draft.trim()) && !streaming && !busyElsewhere

    // Grow with the text, up to the CSS max-height
    useLayoutEffect(() => {
        const el = inputRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`
    }, [draft, inputRef])

    return (
        <form
            className="ai-composer"
            onSubmit={(event) => {
                event.preventDefault()
                if (canSend) onSend(draft)
            }}
        >
            {error && (
                <StatusBanner
                    tone="danger"
                    title="No answer"
                    action={(
                        <button type="button" className="icon-btn icon-btn-sm" onClick={onDismissError} aria-label="Dismiss error">
                            <X size={14} aria-hidden="true" />
                        </button>
                    )}
                >
                    {error} Your question is back in the box below.
                </StatusBanner>
            )}
            {busyElsewhere && (
                <div className="field-hint" role="status" style={{ marginTop: 0 }}>The AI is finishing a task from a tool. You can send when it's done.</div>
            )}
            <div className="ai-composer-row">
                <label htmlFor={id} className="sr-only">Message the AI assistant</label>
                <textarea
                    id={id}
                    ref={inputRef}
                    rows={1}
                    value={draft}
                    placeholder={tool ? 'Ask about this data…' : 'Ask a developer question…'}
                    aria-describedby={hintId}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            if (canSend) onSend(draft)
                        }
                    }}
                />
                {streaming ? (
                    <button type="button" className="btn btn-danger ai-send" onClick={onStop} aria-label="Stop the answer" title="Stop">
                        <Square size={16} aria-hidden="true" />
                    </button>
                ) : (
                    <button type="submit" className="btn btn-primary ai-send" disabled={!canSend} aria-label="Send message" title="Send (Enter)">
                        <Send size={16} aria-hidden="true" />
                    </button>
                )}
            </div>
            <div id={hintId} className="ai-composer-hint">Enter to send · Shift+Enter for a new line · Runs on this device</div>
        </form>
    )
}
