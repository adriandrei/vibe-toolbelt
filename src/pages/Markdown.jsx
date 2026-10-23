import { useEffect, useId, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Download, Eye, FileCode, FileText, Loader2, Sparkles, Square, Trash2, Undo2, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useAI } from '../contexts/AIContext'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { downloadText } from '../utils/download'

const SAMPLE = `# Project title

A short description with **bold**, _italic_, ~~strikethrough~~ and \`inline code\`.

## Checklist

- [x] Write the README
- [ ] Add screenshots

## Features

| Feature | Supported |
| --- | :---: |
| Tables | ✅ |
| Task lists | ✅ |
| Autolinks like https://example.com | ✅ |

\`\`\`js
console.log('Hello, world!')
\`\`\`

> **Tip:** links open in a new tab, so your document stays here.
`

const SYSTEM_PROMPT = `You are a careful Markdown editor. Improve the user's Markdown document:
fix spelling and grammar, make lists and headings consistent, and make sure code blocks are fenced with a language.
Keep the meaning, structure and all links. Reply with ONLY the improved Markdown document — no preamble, no explanation, no surrounding code fence.`

// Links open in a new tab (in-page anchors excepted); remote images don't send a referrer.
const PREVIEW_COMPONENTS = {
    a: ({ node: _node, href, children, ...props }) => {
        const internal = typeof href === 'string' && href.startsWith('#')
        return (
            <a href={href} {...props} {...(internal ? null : { target: '_blank', rel: 'noopener noreferrer' })}>
                {children}
            </a>
        )
    },
    img: ({ node: _node, alt, ...props }) => <img alt={alt ?? ''} {...props} referrerPolicy="no-referrer" loading="lazy" />,
    table: ({ node: _node, ...props }) => (
        <div className="md-table-wrap">
            <table {...props} />
        </div>
    ),
}

const PREVIEW_CSS = `
.md-preview { color: var(--text-main); line-height: 1.65; font-size: 0.95rem; overflow-wrap: anywhere; }
.md-preview > :first-child { margin-top: 0; }
.md-preview > :last-child { margin-bottom: 0; }
.md-preview h1, .md-preview h2, .md-preview h3, .md-preview h4, .md-preview h5, .md-preview h6 { margin: 1.4em 0 0.6em; font-weight: 650; line-height: 1.25; color: var(--text-main); }
.md-preview h1 { font-size: 1.85em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
.md-preview h2 { font-size: 1.45em; padding-bottom: 0.25em; border-bottom: 1px solid var(--border); }
.md-preview h3 { font-size: 1.2em; }
.md-preview h4 { font-size: 1.05em; }
.md-preview h5 { font-size: 0.95em; }
.md-preview h6 { font-size: 0.9em; color: var(--text-muted); }
.md-preview p, .md-preview ul, .md-preview ol, .md-preview blockquote, .md-preview pre, .md-preview .md-table-wrap, .md-preview dl { margin: 0 0 1em; }
.md-preview ul, .md-preview ol { padding-left: 1.6em; }
.md-preview li + li { margin-top: 0.25em; }
.md-preview li > ul, .md-preview li > ol { margin: 0.25em 0 0; }
.md-preview ul.contains-task-list { list-style: none; padding-left: 0.4em; }
.md-preview .task-list-item input[type="checkbox"] { margin: 0 0.5em 0 0; vertical-align: -0.1em; }
.md-preview code { font-family: var(--font-mono); font-size: 0.86em; padding: 0.12em 0.4em; border-radius: 6px; background: var(--bg-subtle); border: 1px solid var(--border); color: var(--text-code); }
.md-preview pre { padding: 0.9em 1em; overflow: auto; background: var(--bg-inset); border: 1px solid var(--border); border-radius: var(--radius-md); line-height: 1.5; }
.md-preview pre code { padding: 0; border: 0; background: none; font-size: 0.85em; }
.md-preview blockquote { padding: 0.25em 1em; color: var(--text-muted); border-left: 4px solid var(--border-strong); }
.md-preview a { color: var(--primary-text); text-decoration: underline; text-underline-offset: 2px; }
.md-preview img { max-width: 100%; height: auto; border-radius: var(--radius-sm); }
.md-preview hr { border: 0; border-top: 1px solid var(--border-strong); margin: 1.5em 0; }
.md-preview .md-table-wrap { overflow-x: auto; }
.md-preview table { border-collapse: collapse; min-width: 50%; }
.md-preview th, .md-preview td { border: 1px solid var(--border-hover); padding: 0.45em 0.8em; text-align: left; vertical-align: top; overflow-wrap: normal; }
.md-preview th { background: var(--bg-subtle); font-weight: 600; }
.md-preview tbody tr:nth-child(2n) td { background: var(--bg-subtle); }
.md-preview del { color: var(--text-muted); }
.md-preview .footnotes { font-size: 0.88em; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 0.8em; }
`

// Models often wrap the whole answer in a ```markdown fence
function cleanModelOutput(text) {
    const t = text.trim()
    const m = t.match(/^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n?```$/i)
    return m ? m[1] : t
}

function htmlDocument(body) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Document</title>
<style>
body { font-family: system-ui, sans-serif; line-height: 1.6; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #1f2328; }
pre, code { font-family: ui-monospace, Menlo, Consolas, monospace; }
pre { background: #f6f8fa; padding: 1rem; overflow: auto; border-radius: 6px; }
table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: 0.4em 0.8em; }
img { max-width: 100%; } blockquote { color: #59636e; border-left: 4px solid #d0d7de; margin: 0; padding: 0 1em; }
</style>
</head>
<body>
${body}
</body>
</html>
`
}

function MarkdownPreview({ children, className = '' }) {
    return (
        <div className={`md-preview ${className}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={PREVIEW_COMPONENTS}>
                {children}
            </ReactMarkdown>
        </div>
    )
}

export default function Markdown() {
    const editorId = useId()
    const [input, setInput] = useState(SAMPLE)
    // { text, status: 'streaming' | 'done' | 'stopped' | 'error', error? }
    const [suggestion, setSuggestion] = useState(null)
    const [suggestionView, setSuggestionView] = useState('rendered')
    const [previous, setPrevious] = useState(null)
    const { aiStatus, isLoaded, loadModel, loadError, chat, abortChat } = useAI()

    const runRef = useRef(0)
    const streamingRef = useRef(false)
    const abortRef = useRef(abortChat)
    const renderHtmlRef = useRef(null)

    useEffect(() => {
        abortRef.current = abortChat
    })

    // Stop our own generation when leaving the page
    useEffect(() => () => {
        runRef.current++
        if (streamingRef.current) abortRef.current?.()
    }, [])

    // Static HTML export (loaded in the background, used by Copy/Download HTML)
    useEffect(() => {
        let alive = true
        import('react-dom/server')
            .then((mod) => {
                if (alive) renderHtmlRef.current = mod.renderToStaticMarkup
            })
            .catch(() => {})
        return () => {
            alive = false
        }
    }, [])

    useSmartInput({ input: (value) => typeof value === 'string' && setInput(value) })

    useRegisterAIContext({
        tool: 'Markdown Editor',
        getContext: () => ({ input, output: suggestion?.text }),
        suggestedPrompts: ['Suggest a better structure for this document', 'Write an introduction paragraph', 'Turn this into a README with install and usage sections'],
    })

    const streaming = suggestion?.status === 'streaming'

    const toHtml = () => {
        const render = renderHtmlRef.current
        if (!render) return ''
        return render(
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{input}</ReactMarkdown>
        )
    }

    const improve = async () => {
        const runId = ++runRef.current
        streamingRef.current = true
        setPrevious(null)
        setSuggestionView('rendered')
        setSuggestion({ text: '', status: 'streaming' })
        let acc = ''
        try {
            const result = await chat(
                [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: input },
                ],
                {
                    onToken: (token, full) => {
                        if (runRef.current !== runId) return
                        acc = typeof full === 'string' ? full : acc + token
                        setSuggestion(s => (s ? { ...s, text: acc } : s))
                    },
                }
            )
            if (runRef.current !== runId) return
            const text = cleanModelOutput(result?.text ?? acc)
            if (!text) {
                setSuggestion({ text: '', status: 'error', error: result?.aborted ? 'Stopped before any text was written.' : 'The model returned no text.' })
            } else {
                setSuggestion({ text, status: result?.aborted ? 'stopped' : 'done' })
            }
        } catch (e) {
            if (runRef.current !== runId) return
            setSuggestion(s => ({ text: s?.text ?? '', status: 'error', error: e?.message || 'The AI request failed.' }))
        } finally {
            if (runRef.current === runId) streamingRef.current = false
        }
    }

    const accept = () => {
        if (!suggestion?.text) return
        setPrevious(input)
        setInput(suggestion.text)
        setSuggestion(null)
    }

    const discard = () => {
        runRef.current++
        if (streamingRef.current) {
            streamingRef.current = false
            abortChat()
        }
        setSuggestion(null)
    }

    // The AI button follows the model's state
    let aiButton
    if (streaming) {
        aiButton = <button type="button" className="btn btn-primary btn-sm" disabled><Loader2 size={14} className="spin" aria-hidden="true" /> Improving…</button>
    } else if (aiStatus === 'ready' || (aiStatus === 'error' && isLoaded)) {
        aiButton = <button type="button" className="btn btn-primary btn-sm" onClick={improve} disabled={!input.trim()}><Sparkles size={14} aria-hidden="true" /> Improve with AI</button>
    } else if (aiStatus === 'idle' || aiStatus === 'error') {
        aiButton = <button type="button" className="btn btn-outline btn-sm" onClick={() => loadModel()}><Sparkles size={14} aria-hidden="true" /> Load AI model</button>
    } else if (aiStatus === 'loading') {
        aiButton = <button type="button" className="btn btn-outline btn-sm" disabled><Loader2 size={14} className="spin" aria-hidden="true" /> Loading model…</button>
    } else if (aiStatus === 'thinking') {
        aiButton = <button type="button" className="btn btn-outline btn-sm" disabled title="The AI is answering another request"><Loader2 size={14} className="spin" aria-hidden="true" /> AI is busy…</button>
    } else if (aiStatus === 'checking') {
        aiButton = <button type="button" className="btn btn-outline btn-sm" disabled><Loader2 size={14} className="spin" aria-hidden="true" /> Checking AI…</button>
    } else {
        aiButton = <button type="button" className="btn btn-outline btn-sm" disabled title="On-device AI needs WebGPU (for example Chrome or Edge on desktop)"><Sparkles size={14} aria-hidden="true" /> AI unavailable</button>
    }

    const words = input.trim() ? input.trim().split(/\s+/).length : 0
    const paneHeight = 'clamp(320px, 62vh, 900px)'

    return (
        <div className="page page-wide page-markdown">
            <style>{PREVIEW_CSS}</style>
            <ToolHeader />

            <section className="card card-compact" aria-label="Document actions" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)' }}>
                {aiButton}
                {aiStatus === 'error' && !isLoaded && loadError && (
                    <span className="field-hint" style={{ marginTop: 0, color: 'var(--danger)' }}>Couldn’t load the model: {loadError}</span>
                )}
                {aiStatus === 'unsupported' && (
                    <span className="field-hint" style={{ marginTop: 0 }}>This browser can’t run the on-device model.</span>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', marginLeft: 'auto' }}>
                    <CopyButton text={toHtml} label="Copy HTML" disabled={!input.trim()} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText(input, 'document.md', 'text/markdown;charset=utf-8')} disabled={!input.trim()}>
                        <Download size={14} aria-hidden="true" /> .md
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText(htmlDocument(toHtml()), 'document.html', 'text/html;charset=utf-8')} disabled={!input.trim()}>
                        <Download size={14} aria-hidden="true" /> .html
                    </button>
                </div>
            </section>

            {previous !== null && (
                <StatusBanner
                    tone="success"
                    title="AI suggestion applied"
                    action={(
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setInput(previous); setPrevious(null) }}>
                            <Undo2 size={14} aria-hidden="true" /> Undo
                        </button>
                    )}
                />
            )}

            {suggestion && (
                <section className="card card-compact" aria-label="AI suggestion" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', borderColor: 'var(--primary-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <div className="section-title" role="heading" aria-level={2}>
                            <Sparkles size={16} aria-hidden="true" style={{ color: 'var(--primary-text)' }} /> AI suggestion
                            <span className={`badge ${suggestion.status === 'error' ? 'badge-danger' : suggestion.status === 'done' ? 'badge-success' : 'badge-primary'}`} aria-live="polite">
                                {suggestion.status === 'streaming' ? 'Writing…' : suggestion.status === 'stopped' ? 'Stopped' : suggestion.status === 'error' ? 'Failed' : 'Ready to review'}
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <SegmentedControl
                                size="sm"
                                ariaLabel="Suggestion view"
                                value={suggestionView}
                                onChange={setSuggestionView}
                                options={[{ value: 'rendered', label: 'Preview', icon: Eye }, { value: 'source', label: 'Markdown', icon: FileCode }]}
                            />
                            {streaming ? (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => abortChat()}>
                                    <Square size={12} aria-hidden="true" /> Stop
                                </button>
                            ) : (
                                <button type="button" className="btn btn-primary btn-sm" onClick={accept} disabled={!suggestion.text}>
                                    <Check size={14} aria-hidden="true" /> Accept
                                </button>
                            )}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={discard}>
                                <X size={14} aria-hidden="true" /> Discard
                            </button>
                        </div>
                    </div>
                    {suggestion.status === 'error' && (
                        <StatusBanner tone="danger" title="The AI couldn’t finish">{suggestion.error}</StatusBanner>
                    )}
                    {suggestion.text ? (
                        suggestionView === 'rendered' ? (
                            <div className="code-well" style={{ maxHeight: 420, whiteSpace: 'normal', fontFamily: 'var(--font-family)', fontSize: 'inherit', color: 'var(--text-main)' }}>
                                <MarkdownPreview>{suggestion.text}</MarkdownPreview>
                            </div>
                        ) : (
                            <pre className="code-well" style={{ maxHeight: 420, margin: 0 }}>{suggestion.text}</pre>
                        )
                    ) : streaming && (
                        <div className="field-hint" role="status" style={{ marginTop: 0 }}>Waiting for the model…</div>
                    )}
                    {!streaming && suggestion.text && (
                        <div className="field-hint" style={{ marginTop: 0 }}>Accept replaces your document (you can undo it); Discard keeps it as it is.</div>
                    )}
                </section>
            )}

            <div className="split-pane">
                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <label htmlFor={editorId} className="section-title"><FileText size={16} aria-hidden="true" /> Markdown</label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineRead onRead={setInput} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input || streaming}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    </div>
                    <textarea
                        id={editorId}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        readOnly={streaming}
                        aria-describedby={streaming ? `${editorId}-lock` : undefined}
                        placeholder="# Start writing…"
                        spellCheck
                        style={{ height: paneHeight, minHeight: 240, fontSize: '0.9rem', lineHeight: 1.6, padding: '0.85rem', opacity: streaming ? 0.75 : 1 }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <span id={`${editorId}-lock`} className="field-hint" style={{ marginTop: 0 }}>
                            {streaming ? 'Editing is paused while the AI writes its suggestion.' : `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${input.length.toLocaleString()} characters`}
                        </span>
                        <PipelineSend dataToSend={input} />
                    </div>
                </div>

                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', minHeight: 34 }}>
                        <div className="section-title" role="heading" aria-level={2}><Eye size={16} aria-hidden="true" /> Preview</div>
                    </div>
                    <div
                        className="markdown-body"
                        tabIndex={0}
                        aria-label="Rendered preview"
                        style={{ height: paneHeight, minHeight: 240, overflowY: 'auto', padding: '0.85rem 1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)' }}
                    >
                        {input.trim() ? (
                            <MarkdownPreview>{input}</MarkdownPreview>
                        ) : (
                            <p style={{ color: 'var(--text-dim)' }}>Nothing to preview yet.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
