import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronDown, Loader2, Replace, Search, Sparkles, Square, Trash2, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import CopyButton from '../components/ui/CopyButton'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useToast } from '../components/ToastProvider'
import { useAI } from '../contexts/AIContext'
import { usePane } from '../contexts/pane'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { getTool } from '../config/tools'

const TOOL_NAME = getTool('/regex')?.title ?? 'Regex Tester'
const TIMEOUT_MS = 500 // a job running longer than this is stopped
const DEBOUNCE_MS = 150
const MAX_MATCHES = 1000 // matches highlighted and listed
const PREVIEW_LIMIT = 100_000 // characters shown in the preview
const DETAILS_STEP = 50

function supportsFlag(flag) {
    try {
        new RegExp('', flag)
        return true
    } catch {
        return false
    }
}

const FLAGS = [
    { flag: 'g', name: 'global', desc: 'Find all matches, not only the first' },
    { flag: 'i', name: 'ignore case', desc: 'Upper and lower case match each other' },
    { flag: 'm', name: 'multiline', desc: '^ and $ match at every line break' },
    { flag: 's', name: 'dotAll', desc: '. also matches line breaks' },
    { flag: 'u', name: 'unicode', desc: 'Whole code points, \\p{…} classes and stricter syntax' },
    { flag: 'v', name: 'unicode sets', desc: 'Like u, plus set operations in classes ([\\w--\\d]) and string properties' },
    { flag: 'y', name: 'sticky', desc: 'Each match must start where the previous one ended' },
    { flag: 'd', name: 'indices', desc: 'Record group positions (this page always shows them)' },
].map(f => ({ ...f, supported: supportsFlag(f.flag) }))

const KNOWN_FLAGS = new Set(FLAGS.map(f => f.flag))
const SUPPORTED_FLAGS = FLAGS.filter(f => f.supported).map(f => f.flag).join('')

const CHEAT_SHEET = [
    {
        category: 'Character classes',
        items: [
            { pattern: '.', desc: 'Any character except a line break' },
            { pattern: '\\d', desc: 'Digit (0-9)' },
            { pattern: '\\D', desc: 'Not a digit' },
            { pattern: '\\w', desc: 'Word character (A-Z, a-z, 0-9, _)' },
            { pattern: '\\W', desc: 'Not a word character' },
            { pattern: '\\s', desc: 'Whitespace' },
            { pattern: '\\S', desc: 'Not whitespace' },
            { pattern: '[abc]', desc: 'a, b or c' },
            { pattern: '[^abc]', desc: 'Anything but a, b or c' },
            { pattern: '[a-z]', desc: 'Character range' },
            { pattern: '\\p{L}', desc: 'Any letter (needs u or v)' },
        ],
    },
    {
        category: 'Quantifiers',
        items: [
            { pattern: '*', desc: '0 or more' },
            { pattern: '+', desc: '1 or more' },
            { pattern: '?', desc: '0 or 1' },
            { pattern: '{3}', desc: 'Exactly 3' },
            { pattern: '{3,}', desc: '3 or more' },
            { pattern: '{3,5}', desc: 'Between 3 and 5' },
            { pattern: '*?', desc: '0 or more, as few as possible' },
            { pattern: '+?', desc: '1 or more, as few as possible' },
        ],
    },
    {
        category: 'Anchors',
        items: [
            { pattern: '^', desc: 'Start of text (or line with m)' },
            { pattern: '$', desc: 'End of text (or line with m)' },
            { pattern: '\\b', desc: 'Word boundary' },
            { pattern: '\\B', desc: 'Not a word boundary' },
        ],
    },
    {
        category: 'Groups and lookaround',
        items: [
            { pattern: '(abc)', desc: 'Capture group' },
            { pattern: '(?:abc)', desc: 'Group without capturing' },
            { pattern: '(?<name>abc)', desc: 'Named group' },
            { pattern: '\\1', desc: 'Back-reference to group 1' },
            { pattern: '\\k<name>', desc: 'Back-reference to a named group' },
            { pattern: '(?=abc)', desc: 'Followed by abc' },
            { pattern: '(?!abc)', desc: 'Not followed by abc' },
            { pattern: '(?<=abc)', desc: 'Preceded by abc' },
            { pattern: '(?<!abc)', desc: 'Not preceded by abc' },
        ],
    },
]

// "Invalid regular expression: /(/g: Unterminated group" -> "Unterminated group"
function cleanError(message) {
    const m = String(message).match(/^Invalid regular expression: \/[\s\S]*\/[a-z]*: ([\s\S]+)$/)
    return m ? m[1] : String(message)
}

function validate(pattern, flags) {
    const unknown = [...new Set([...flags].filter(c => !KNOWN_FLAGS.has(c)))]
    if (unknown.length) return `Unknown flag${unknown.length > 1 ? 's' : ''} “${unknown.join('')}”. Valid flags: ${SUPPORTED_FLAGS}.`
    const repeated = [...flags].find((c, i) => flags.indexOf(c) !== i)
    if (repeated) return `The ${repeated} flag is listed twice.`
    if (flags.includes('u') && flags.includes('v')) return 'Use either u or v: v already includes everything u does.'
    const unsupported = [...flags].filter(c => !FLAGS.find(f => f.flag === c)?.supported)
    if (unsupported.length) return `This browser doesn't support the ${unsupported.join(', ')} flag.`
    try {
        new RegExp(pattern, flags)
        return null
    } catch (err) {
        return cleanError(err.message)
    }
}

// "/ab+c/gi" -> { pattern: 'ab+c', flags: 'gi' }
function parseRegexLiteral(text) {
    const m = String(text).trim().match(/^\/([\s\S]+)\/([a-z]*)$/)
    if (!m || [...m[2]].some(c => !KNOWN_FLAGS.has(c))) return null
    return { pattern: m[1], flags: m[2] }
}

function sanitizeFlags(flags) {
    let out = [...new Set(String(flags || '').replace(/[^a-z]/g, ''))].filter(c => SUPPORTED_FLAGS.includes(c)).join('')
    if (out.includes('u') && out.includes('v')) out = out.replace('u', '')
    return out
}

// Pulls { pattern, flags } out of a model's answer (JSON, a /literal/ or a code block)
function parseAiAnswer(answer) {
    const text = String(answer || '').replace(/```[a-z]*\n?/gi, '').trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
        try {
            const data = JSON.parse(text.slice(start, end + 1))
            if (typeof data.pattern === 'string' && data.pattern) {
                const literal = parseRegexLiteral(data.pattern)
                if (literal) return { pattern: literal.pattern, flags: sanitizeFlags(data.flags || literal.flags) }
                return { pattern: data.pattern, flags: sanitizeFlags(data.flags) }
            }
        } catch {
            // fall through to a /literal/
        }
    }
    const literal = text.split('\n').map(line => parseRegexLiteral(line.replace(/^[`'"]|[`'"]$/g, ''))).find(Boolean)
    return literal ? { pattern: literal.pattern, flags: sanitizeFlags(literal.flags) } : null
}

const isHigh = (text, i) => {
    const c = text.charCodeAt(i)
    return c >= 0xd800 && c <= 0xdbff
}
const isLow = (text, i) => {
    const c = text.charCodeAt(i)
    return c >= 0xdc00 && c <= 0xdfff
}

const MATCH_STYLES = [
    { background: 'color-mix(in srgb, var(--primary) 24%, transparent)', boxShadow: 'inset 0 -2px 0 var(--primary)' },
    { background: 'color-mix(in srgb, var(--accent) 24%, transparent)', boxShadow: 'inset 0 -2px 0 var(--accent)' },
]
const EMPTY_MATCH_STYLE = {
    display: 'inline-block',
    width: 2,
    height: '1.25em',
    margin: '0 1px',
    verticalAlign: 'text-bottom',
    borderRadius: 1,
    background: 'var(--warning)',
}

// The test text with matches highlighted. Never splits a surrogate pair, so
// emoji stay intact even when a non-Unicode pattern matches half of one.
function highlightMatches(text, matches) {
    const nodes = []
    let pos = 0
    matches.forEach((m, i) => {
        if (m.index > text.length) return
        let start = m.index
        let end = m.end
        if (start > 0 && isLow(text, start) && isHigh(text, start - 1)) start--
        if (end > start && end < text.length && isLow(text, end) && isHigh(text, end - 1)) end++
        if (m.index === m.end) {
            const at = Math.max(start, pos)
            if (at > pos) nodes.push(text.slice(pos, at))
            nodes.push(<span key={i} role="img" aria-label="empty match" style={EMPTY_MATCH_STYLE} title={`Empty match ${i + 1} at index ${m.index}`} />)
            pos = at
            return
        }
        start = Math.max(start, pos)
        if (end <= start) return
        if (start > pos) nodes.push(text.slice(pos, start))
        nodes.push(
            <mark key={i} style={{ ...MATCH_STYLES[i % 2], color: 'inherit', borderRadius: 2 }} title={`Match ${i + 1}: ${m.index}–${m.end}`}>
                {text.slice(start, end)}
            </mark>
        )
        pos = end
    })
    if (pos < text.length) nodes.push(text.slice(pos))
    return nodes
}

const visible = (value) => value.replace(/\n/g, '↵').replace(/\t/g, '⇥')

function GroupChip({ group }) {
    const label = group.name ? group.name : `$${group.n}`
    const missing = group.value === null
    return (
        <span
            className="chip"
            style={{ cursor: 'default', fontSize: '0.75rem', padding: '0.15rem 0.55rem', maxWidth: '100%' }}
            title={missing ? `Group ${group.n} didn't take part in this match` : group.start !== null ? `Group ${group.n}: ${group.start}–${group.end}` : `Group ${group.n}`}
        >
            <span style={{ color: 'var(--primary-text)', fontWeight: 600 }}>{label}</span>
            {missing
                ? <em style={{ color: 'var(--text-dim)' }}>no match</em>
                : <span className="mono" style={{ color: 'var(--text-main)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{group.value === '' ? '""' : visible(group.value)}</span>}
        </span>
    )
}

function CheatSheet({ flags, onInsert, onToggleFlag, compact }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--primary-text)', marginBottom: 4 }}>Flags</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {FLAGS.filter(f => f.supported).map(f => (
                        <button key={f.flag} type="button" className="btn btn-ghost btn-sm" aria-pressed={flags.includes(f.flag)} onClick={() => onToggleFlag(f.flag)} style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left', gap: 'var(--space-sm)', fontWeight: 400 }}>
                            <code className="mono" style={{ minWidth: '4.5em', color: flags.includes(f.flag) ? 'var(--primary-text)' : 'var(--text-main)', fontWeight: 700 }}>{f.flag} {flags.includes(f.flag) ? '✓' : ''}</code>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{f.desc}</span>
                        </button>
                    ))}
                </div>
            </div>
            {CHEAT_SHEET.map(section => (
                <div key={section.category}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--primary-text)', marginBottom: 4 }}>{section.category}</div>
                    <div style={compact ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))' } : { display: 'flex', flexDirection: 'column' }}>
                        {section.items.map(item => (
                            <button key={item.pattern} type="button" className="btn btn-ghost btn-sm" onClick={() => onInsert(item.pattern)} title={`Insert ${item.pattern}`} style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left', gap: 'var(--space-sm)', fontWeight: 400 }}>
                                <code className="mono" style={{ minWidth: '4.5em', color: 'var(--accent-text)', fontWeight: 600 }}>{item.pattern}</code>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{item.desc}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

function AiPanel({ ai, prompt, setPrompt, generating, error, onGenerate, onClose }) {
    const { aiStatus, isLoaded, loadModel, abortChat, webGPUInfo, loadError } = ai
    let body
    if (aiStatus === 'checking') {
        body = <p className="field-hint" style={{ margin: 0 }}>Checking whether on-device AI works in this browser…</p>
    } else if (aiStatus === 'unsupported') {
        body = (
            <StatusBanner tone="info" title="On-device AI isn't available here">
                {webGPUInfo?.message || 'It needs WebGPU, which this browser does not provide.'}{' '}
                <Link to="/ai-settings" style={{ color: 'var(--primary-text)', textDecoration: 'underline' }}>AI settings</Link>
            </StatusBanner>
        )
    } else if (!isLoaded) {
        body = (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', flex: '1 1 240px' }}>
                    {aiStatus === 'loading'
                        ? 'The model is loading…'
                        : aiStatus === 'error'
                            ? `The model failed to load${loadError ? `: ${loadError}` : '.'}`
                            : 'Load the on-device model to turn a description into a pattern. It runs in your browser; nothing is sent anywhere.'}
                </span>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => loadModel()} disabled={aiStatus === 'loading'}>
                    {aiStatus === 'loading' ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                    {aiStatus === 'loading' ? 'Loading…' : aiStatus === 'error' ? 'Try again' : 'Load AI model'}
                </button>
                <Link to="/ai-settings" className="btn btn-ghost btn-sm">AI settings</Link>
            </div>
        )
    } else {
        const busy = aiStatus === 'thinking' && !generating
        body = (
            <form
                onSubmit={(e) => {
                    e.preventDefault()
                    onGenerate()
                }}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}
            >
                <input
                    type="search"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe what to match, e.g. hex colours or IPv4 addresses"
                    aria-label="Describe the pattern you want"
                    disabled={generating}
                    style={{ flex: '1 1 240px', minWidth: 0, padding: '0.55rem 0.75rem', fontSize: '0.9rem' }}
                />
                {generating ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => abortChat()}>
                        <Square size={12} aria-hidden="true" /> Stop
                    </button>
                ) : (
                    <button type="submit" className="btn btn-primary btn-sm" disabled={!prompt.trim() || busy}>
                        <Sparkles size={14} aria-hidden="true" /> Generate
                    </button>
                )}
                {busy && <div className="field-hint" style={{ flexBasis: '100%', margin: 0 }}>The assistant is answering another request; try again in a moment.</div>}
                {generating && (
                    <div className="field-hint" role="status" style={{ flexBasis: '100%', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Loader2 size={12} className="spin" aria-hidden="true" /> Generating a pattern…
                    </div>
                )}
            </form>
        )
    }
    return (
        <div style={{ padding: 'var(--space-sm) var(--space-md)', border: '1px solid var(--primary-border)', background: 'var(--primary-glow)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary-text)' }}>
                    <Sparkles size={14} aria-hidden="true" /> Generate a pattern with AI
                </span>
                <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close AI pattern generator">
                    <X size={14} aria-hidden="true" />
                </button>
            </div>
            {body}
            {error && <div className="field-error" role="alert" style={{ margin: 0 }}>{error}</div>}
        </div>
    )
}

// Width of an element, kept up to date. (usePane().size alone isn't enough:
// the pinned pane currently always reports 'lg'.)
function useWidth(ref) {
    const [width, setWidth] = useState(null)
    useEffect(() => {
        const el = ref.current
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
        observer.observe(el)
        return () => observer.disconnect()
    }, [ref])
    return width
}

const AI_SYSTEM_PROMPT = `You write JavaScript regular expressions. Reply with ONLY a JSON object, no Markdown and no explanation:
{"pattern": "<the regex source, without surrounding slashes>", "flags": "<flags such as g, gi or gm>"}
Escape backslashes as JSON requires. Example for US phone numbers:
{"pattern": "\\\\b\\\\d{3}-\\\\d{3}-\\\\d{4}\\\\b", "flags": "g"}`

export default function RegexTester() {
    const id = useId()
    const toast = useToast()
    const ai = useAI()
    const { size } = usePane()
    const rootRef = useRef(null)
    const width = useWidth(rootRef)
    // The cheat sheet only sits beside the tester when there's room for both
    const wide = size === 'lg' && (width === null || width >= 900)

    const [pattern, setPattern] = useState('([A-Z])\\w+')
    const [flags, setFlags] = useState('g')
    const [text, setText] = useState('Hello World, this is a Vibe Check.')
    const [mode, setMode] = useState('match')
    const [replacement, setReplacement] = useState('[$1]')
    const [showCheatSheet, setShowCheatSheet] = useState(false)

    const [aiOpen, setAiOpen] = useState(false)
    const [aiPrompt, setAiPrompt] = useState('')
    const [generating, setGenerating] = useState(false)
    const [aiError, setAiError] = useState(null)

    const patternRef = useRef(null)
    const workerRef = useRef(null)
    const busyRef = useRef(false)
    const jobIdRef = useRef(0)

    // Syntax and flag problems show instantly, without waiting for the worker
    const syntaxError = useMemo(() => (pattern ? validate(pattern, flags) : null), [pattern, flags])

    const liveJob = useMemo(
        () => ({ pattern, flags, text, mode, replacement: mode === 'replace' ? replacement : '' }),
        [pattern, flags, text, mode, replacement]
    )
    const job = useDebouncedValue(liveJob, DEBOUNCE_MS)
    const jobRunnable = Boolean(job.pattern) && !validate(job.pattern, job.flags)

    const [result, setResult] = useState(null)

    // Kill the worker when leaving the page
    useEffect(() => () => {
        workerRef.current?.terminate()
        workerRef.current = null
    }, [])

    useEffect(() => {
        if (!jobRunnable) {
            // Nothing to run: stop a job that may still be grinding away
            if (busyRef.current) {
                workerRef.current?.terminate()
                workerRef.current = null
                busyRef.current = false
            }
            return undefined
        }
        // A worker still busy with an older job may be stuck: start a fresh one
        let worker = workerRef.current
        if (!worker || busyRef.current) {
            worker?.terminate()
            worker = new Worker(new URL('../workers/regex.worker.js', import.meta.url), { type: 'module' })
            workerRef.current = worker
        }
        const jobId = ++jobIdRef.current
        busyRef.current = true
        const timer = setTimeout(() => {
            worker.terminate()
            if (workerRef.current === worker) workerRef.current = null
            busyRef.current = false
            setResult({ job, timedOut: true })
        }, TIMEOUT_MS)
        worker.onmessage = (event) => {
            if (event.data?.id !== jobId) return
            clearTimeout(timer)
            busyRef.current = false
            setResult({ job, ...event.data })
        }
        worker.onerror = (event) => {
            event.preventDefault?.()
            clearTimeout(timer)
            busyRef.current = false
            setResult({ job, ok: false, error: event.message || 'The matching worker failed to start' })
        }
        worker.postMessage({ id: jobId, ...job, maxMatches: MAX_MATCHES })
        return () => clearTimeout(timer)
    }, [job, jobRunnable])

    // What to show: the result for the current inputs, or (while that's being
    // computed) the previous successful one
    const upToDate = result && result.job === job && liveJob === job
    const lastGood = result && result.ok && !result.timedOut ? result : null
    const shown = !pattern || syntaxError ? null : upToDate ? (result.ok ? result : null) : lastGood
    const pending = Boolean(pattern) && !syntaxError && !upToDate
    const timedOut = upToDate && result.timedOut
    const runError = upToDate && !result.timedOut && !result.ok ? cleanError(result.error) : null

    // "Show more" in the match list starts over when the results change
    const [details, setDetails] = useState({ for: null, count: DETAILS_STEP })
    const detailsShown = details.for === shown ? details.count : DETAILS_STEP

    const toggleFlag = (flag) => {
        setFlags(prev => {
            if (prev.includes(flag)) return prev.replace(flag, '')
            let next = prev + flag
            if (flag === 'u') next = next.replace('v', '')
            if (flag === 'v') next = next.replace('u', '')
            return next
        })
    }

    const insertSnippet = (snippet) => {
        const el = patternRef.current
        const start = el?.selectionStart ?? pattern.length
        const end = el?.selectionEnd ?? start
        setPattern(pattern.slice(0, start) + snippet + pattern.slice(end))
        if (el && wide) {
            requestAnimationFrame(() => {
                el.focus()
                el.setSelectionRange(start + snippet.length, start + snippet.length)
            })
        }
    }

    const handlePatternPaste = (event) => {
        const el = event.currentTarget
        const replacesAll = el.selectionStart === 0 && el.selectionEnd === el.value.length
        const literal = parseRegexLiteral(event.clipboardData?.getData('text') ?? '')
        if (!literal || !replacesAll) return
        event.preventDefault()
        setPattern(literal.pattern)
        setFlags(literal.flags)
        toast.info(`Split /…/${literal.flags} into the pattern and its flags`)
    }

    const generate = async () => {
        const description = aiPrompt.trim()
        if (!description || generating) return
        setGenerating(true)
        setAiError(null)
        try {
            const answer = await ai.chat(
                [{ role: 'system', content: AI_SYSTEM_PROMPT }, { role: 'user', content: description }],
                { temperature: 0.2, maxTokens: 300 }
            )
            if (answer?.aborted) return
            const parsed = parseAiAnswer(answer?.text)
            if (!parsed) throw new Error("The AI's answer didn't contain a pattern. Try describing it differently.")
            const problem = validate(parsed.pattern, parsed.flags)
            if (problem) throw new Error(`The AI suggested an invalid pattern (${problem}). Try again or rephrase.`)
            setPattern(parsed.pattern)
            setFlags(parsed.flags)
            setAiOpen(false)
            setAiPrompt('')
            toast.success(`Pattern generated: /${parsed.pattern}/${parsed.flags}`)
        } catch (err) {
            setAiError(err?.message || 'The AI could not generate a pattern.')
        } finally {
            setGenerating(false)
        }
    }

    useRegisterAIContext({
        tool: TOOL_NAME,
        getContext: () => {
            const lines = [`Pattern: /${pattern}/${flags}`, `Mode: ${mode}`]
            if (mode === 'replace') lines.push(`Replacement: ${replacement}`)
            lines.push(`Test text:\n${text.length > 3000 ? `${text.slice(0, 3000)}\n…(truncated)` : text}`)
            let output
            if (!pattern) output = 'No pattern yet'
            else if (syntaxError) output = `Invalid pattern: ${syntaxError}`
            else if (timedOut) output = `Matching took longer than ${TIMEOUT_MS} ms and was stopped (likely catastrophic backtracking)`
            else if (shown) {
                const list = shown.matches.slice(0, 10).map((m, i) => {
                    const groups = m.groups.map(g => `${g.name || `$${g.n}`}=${g.value === null ? '(no match)' : JSON.stringify(g.value)}`).join(', ')
                    return `${i + 1}. ${JSON.stringify(m.value)} at ${m.index}${groups ? ` [${groups}]` : ''}`
                }).join('\n')
                output = `${shown.total} match${shown.total === 1 ? '' : 'es'}${list ? `:\n${list}` : ''}`
                if (mode === 'replace' && typeof shown.replaced === 'string') output += `\n\nReplace result:\n${shown.replaced.slice(0, 2000)}`
            } else output = 'Matching…'
            return { input: lines.join('\n'), output }
        },
        suggestedPrompts: [
            'Explain this regex pattern in plain English',
            'How can I make this pattern more efficient?',
            'Why is my regex not matching as expected?',
            'Suggest a replacement that wraps each match in quotes',
        ],
    })

    const previewText = shown ? shown.job.text : text
    const previewClipped = previewText.length > PREVIEW_LIMIT
    const highlighted = useMemo(() => {
        if (mode !== 'match' || !shown) return null
        return highlightMatches(shown.job.text.slice(0, PREVIEW_LIMIT), shown.matches.filter(m => m.index <= PREVIEW_LIMIT))
    }, [mode, shown])
    const hasEmptyMatch = Boolean(shown?.matches.some(m => m.index === m.end))
    const replaced = mode === 'replace' && shown && typeof shown.replaced === 'string' ? shown.replaced : null

    let summary = null
    if (shown) {
        const n = shown.total
        summary = shown.countStopped
            ? `At least ${n.toLocaleString()} matches (stopped counting)`
            : n === 0 ? 'No matches' : `${n.toLocaleString()} match${n === 1 ? '' : 'es'}`
        if (shown.truncated) summary += ` · first ${MAX_MATCHES.toLocaleString()} highlighted`
    }

    const cheatSheetToggle = (
        <button type="button" className={`btn btn-sm ${showCheatSheet ? 'btn-outline' : 'btn-ghost'}`} onClick={() => setShowCheatSheet(v => !v)} aria-expanded={showCheatSheet} aria-controls={`${id}-cheatsheet`}>
            <BookOpen size={14} aria-hidden="true" /> Cheat sheet
            {!wide && <ChevronDown size={14} aria-hidden="true" style={{ transform: showCheatSheet ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />}
        </button>
    )

    const cheatSheet = (
        <CheatSheet flags={flags} onInsert={insertSnippet} onToggleFlag={toggleFlag} compact={!wide} />
    )

    return (
        <div ref={rootRef} className="page page-wide">
            <ToolHeader />

            <div style={{ display: 'grid', gridTemplateColumns: wide && showCheatSheet ? 'minmax(0, 1fr) 300px' : 'minmax(0, 1fr)', gap: 'var(--space-lg)', alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <section className="card" aria-label="Pattern" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <label className="field-label" htmlFor={`${id}-pattern`} style={{ margin: 0 }}>Regular expression</label>
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                <button type="button" className={`btn btn-sm ${aiOpen ? 'btn-outline' : 'btn-ghost'}`} onClick={() => setAiOpen(v => !v)} aria-expanded={aiOpen}>
                                    <Sparkles size={14} aria-hidden="true" /> Generate with AI
                                </button>
                                {cheatSheetToggle}
                            </div>
                        </div>

                        {aiOpen && (
                            <AiPanel
                                ai={ai}
                                prompt={aiPrompt}
                                setPrompt={setAiPrompt}
                                generating={generating}
                                error={aiError}
                                onGenerate={generate}
                                onClose={() => setAiOpen(false)}
                            />
                        )}

                        <div
                            className={syntaxError ? 'field-invalid' : ''}
                            style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', minWidth: 0 }}
                        >
                            <span aria-hidden="true" style={{ padding: '0 0.6rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '1.1rem' }}>/</span>
                            <input
                                ref={patternRef}
                                id={`${id}-pattern`}
                                type="text"
                                value={pattern}
                                onChange={(e) => setPattern(e.target.value)}
                                onPaste={handlePatternPaste}
                                spellCheck={false}
                                autoComplete="off"
                                autoCapitalize="off"
                                aria-invalid={syntaxError ? true : undefined}
                                aria-describedby={`${id}-pattern-msg`}
                                placeholder="pattern"
                                style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', boxShadow: 'none', padding: '0.7rem 0', fontFamily: 'var(--font-mono)', fontSize: '1.05rem' }}
                            />
                            <span aria-hidden="true" style={{ padding: '0 0.4rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '1.1rem' }}>/</span>
                            <input
                                type="text"
                                value={flags}
                                onChange={(e) => setFlags(e.target.value.replace(/[\s/]/g, ''))}
                                spellCheck={false}
                                autoComplete="off"
                                autoCapitalize="off"
                                aria-label="Flags"
                                placeholder="flags"
                                style={{ width: '5.5em', flexShrink: 0, border: 'none', borderLeft: '1px solid var(--border)', borderRadius: 0, background: 'transparent', boxShadow: 'none', padding: '0.7rem 0.6rem', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', color: 'var(--primary-text)' }}
                            />
                        </div>
                        <div id={`${id}-pattern-msg`} className={syntaxError ? 'field-error' : 'field-hint'} role={syntaxError ? 'alert' : undefined} style={{ margin: 0 }}>
                            {syntaxError ? `Invalid pattern: ${syntaxError}` : 'Tip: paste a whole /pattern/flags literal and it is split for you.'}
                        </div>

                        <div role="group" aria-label="Flags" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                            {FLAGS.filter(f => f.supported).map(f => (
                                <button
                                    key={f.flag}
                                    type="button"
                                    className={`chip ${flags.includes(f.flag) ? 'is-active' : ''}`}
                                    aria-pressed={flags.includes(f.flag)}
                                    onClick={() => toggleFlag(f.flag)}
                                    title={`${f.flag}: ${f.desc}`}
                                    style={{ fontSize: '0.75rem' }}
                                >
                                    <span className="mono" style={{ fontWeight: 700 }}>{f.flag}</span> {f.name}
                                </button>
                            ))}
                        </div>

                        <div style={{ borderTop: '1px solid var(--border)', marginTop: 'var(--space-xs)', paddingTop: 'var(--space-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                            <SegmentedControl
                                ariaLabel="Mode"
                                options={[{ value: 'match', label: 'Match', icon: Search }, { value: 'replace', label: 'Replace', icon: Replace }]}
                                value={mode}
                                onChange={setMode}
                                style={{ alignSelf: 'flex-start' }}
                            />
                            {mode === 'replace' && (
                                <Field label="Replace with" hint="$1…$99 insert a group, $<name> a named group, $& the whole match, $$ a dollar sign.">
                                    <input
                                        type="text"
                                        value={replacement}
                                        onChange={(e) => setReplacement(e.target.value)}
                                        placeholder="Replacement (may be empty)"
                                        spellCheck={false}
                                        autoComplete="off"
                                        style={{ fontFamily: 'var(--font-mono)', padding: '0.6rem 0.75rem' }}
                                    />
                                </Field>
                            )}
                        </div>
                    </section>

                    {showCheatSheet && !wide && (
                        <section id={`${id}-cheatsheet`} className="card card-compact" aria-label="Regex cheat sheet" style={{ maxHeight: 360, overflowY: 'auto' }}>
                            {cheatSheet}
                        </section>
                    )}

                    <div className="split-pane">
                        <section className="card card-compact">
                            <Field
                                label="Test text"
                                labelAction={
                                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                        <PipelineRead onRead={setText} />
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText('')} disabled={!text}>
                                            <Trash2 size={14} aria-hidden="true" /> Clear
                                        </button>
                                    </div>
                                }
                            >
                                <textarea
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    spellCheck={false}
                                    placeholder="Text to test the pattern against"
                                    style={{ minHeight: 220, lineHeight: 1.5 }}
                                />
                            </Field>
                        </section>

                        <section className="card card-compact" aria-label={mode === 'match' ? 'Matches' : 'Replace result'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 30 }}>
                                <span className="field-label" style={{ margin: 0 }}>{mode === 'match' ? 'Matches' : 'Result'}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                    {pending && <Loader2 size={14} className="spin" aria-label="Updating" style={{ color: 'var(--text-dim)' }} />}
                                    {summary && <span className="badge" aria-live="polite">{summary}</span>}
                                    {mode === 'replace' && (
                                        <>
                                            <PipelineSend dataToSend={replaced ?? ''} disabled={replaced === null || replaced === ''} />
                                            <CopyButton text={replaced ?? ''} disabled={replaced === null || replaced === ''} />
                                        </>
                                    )}
                                </span>
                            </div>
                            {timedOut ? (
                                <StatusBanner tone="danger" title="Pattern took too long">
                                    Matching was stopped after {TIMEOUT_MS} ms. Nested quantifiers such as (a+)+ can take exponential time (catastrophic backtracking); make the pattern more specific.
                                </StatusBanner>
                            ) : runError ? (
                                <StatusBanner tone="danger" title="Couldn't run the pattern">{runError}</StatusBanner>
                            ) : !pattern ? (
                                <EmptyState title="Enter a pattern">Matches are highlighted here as you type.</EmptyState>
                            ) : syntaxError ? (
                                <EmptyState title="Fix the pattern to see matches" />
                            ) : (
                                <div
                                    className="code-well"
                                    style={{ minHeight: 220, maxHeight: 420, color: 'var(--text-main)', lineHeight: 1.5, fontSize: '0.9rem', opacity: pending ? 0.7 : 1, overflowWrap: 'anywhere' }}
                                >
                                    {mode === 'match'
                                        ? (highlighted ?? previewText.slice(0, PREVIEW_LIMIT))
                                        : replaced === null
                                            ? ''
                                            : replaced === ''
                                                ? <em style={{ color: 'var(--text-dim)' }}>(the result is empty)</em>
                                                : shown?.segments
                                                    ? shown.segments.map((s, i) => (s.replaced
                                                        ? (s.empty
                                                            ? <span key={i} role="img" aria-label="removed" style={EMPTY_MATCH_STYLE} title="Replaced with nothing" />
                                                            : <mark key={i} style={{ ...MATCH_STYLES[0], color: 'inherit', borderRadius: 2 }}>{s.text}</mark>)
                                                        : <span key={i}>{s.text}</span>))
                                                    : replaced}
                                </div>
                            )}
                            {mode === 'match' && previewClipped && shown && (
                                <div className="field-hint" style={{ margin: 0 }}>Showing the first {PREVIEW_LIMIT.toLocaleString()} characters.</div>
                            )}
                            {mode === 'match' && hasEmptyMatch && (
                                <div className="field-hint" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={EMPTY_MATCH_STYLE} aria-hidden="true" /> marks an empty (zero-width) match
                                </div>
                            )}
                        </section>
                    </div>

                    {mode === 'match' && shown && shown.matches.length > 0 && (
                        <section className="card card-compact" aria-label="Match details">
                            <h2 className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>Match Details ({shown.total.toLocaleString()}{shown.countStopped ? '+' : ''})</h2>
                            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                                {shown.matches.slice(0, detailsShown).map((m, i) => (
                                    <li key={`${m.index}-${i}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)', padding: '0.4rem 0.6rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', minWidth: 0 }}>
                                        <span className="badge badge-primary" style={{ minWidth: '2.2em', justifyContent: 'center' }}>{i + 1}</span>
                                        <span className="mono" style={{ flex: '1 1 120px', minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-main)' }}>
                                            {m.length === 0 ? <em style={{ color: 'var(--text-dim)' }}>empty match</em> : visible(m.value)}
                                            {m.value.length < m.length && <span style={{ color: 'var(--text-dim)' }}>… ({m.length.toLocaleString()} characters)</span>}
                                        </span>
                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{m.length === 0 ? `at ${m.index}` : `${m.index}–${m.end}`}</span>
                                        {m.groups.length > 0 && (
                                            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flexBasis: '100%', minWidth: 0 }}>
                                                {m.groups.map(g => <GroupChip key={g.n} group={g} />)}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ol>
                            {shown.matches.length > detailsShown && (
                                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--space-sm)' }} onClick={() => setDetails({ for: shown, count: detailsShown + 100 })}>
                                    Show more ({(shown.matches.length - detailsShown).toLocaleString()} more listed{shown.total > shown.matches.length ? `, ${(shown.total - shown.matches.length).toLocaleString()} not listed` : ''})
                                </button>
                            )}
                        </section>
                    )}
                </div>

                {wide && showCheatSheet && (
                    <aside
                        id={`${id}-cheatsheet`}
                        className="card card-compact"
                        aria-label="Regex cheat sheet"
                        style={{
                            position: 'sticky',
                            top: 'calc(var(--header-height) + var(--space-md))',
                            maxHeight: 'calc(100vh - 2 * var(--header-height) - 2 * var(--space-md))',
                            overflowY: 'auto',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                            <h2 className="section-title">Cheat sheet</h2>
                            <button type="button" className="icon-btn icon-btn-sm" onClick={() => setShowCheatSheet(false)} aria-label="Close cheat sheet">
                                <X size={14} aria-hidden="true" />
                            </button>
                        </div>
                        {cheatSheet}
                    </aside>
                )}
            </div>
        </div>
    )
}
