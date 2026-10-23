import { useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FileCode2, TerminalSquare, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CodeBlock from '../components/ui/CodeBlock'
import EmptyState from '../components/ui/EmptyState'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSmartInput } from '../hooks/useSmartInput'
import { parseCurl } from '../utils/curlParser'
import { CODE_TARGETS, generateCode, targetLanguage } from '../utils/codeGenerator'
import { openInTool } from '../utils/smartNav'
import { usePane } from '../contexts/pane'

const API_TESTER_PATH = '/api-tester'

const EXAMPLE = `curl 'https://jsonplaceholder.typicode.com/posts' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' \\
  --data-raw $'{"title":"O\\'Brien\\'s first post","body":"Hello\\\\nworld \\u0021","userId":1}'`

const METHOD_COLORS = { GET: 'var(--success)', POST: 'var(--info)', PUT: 'var(--warning)', PATCH: 'var(--accent-text)', DELETE: 'var(--danger)' }

function formatSize(text) {
    const bytes = new TextEncoder().encode(text).length
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function Summary({ request }) {
    const facts = []
    facts.push(`${request.headers.length} header${request.headers.length === 1 ? '' : 's'}`)
    if (request.form.length) facts.push(`${request.form.length} form field${request.form.length === 1 ? '' : 's'}`)
    else if (request.body) facts.push(`body ${formatSize(request.body)}`)
    if (request.auth) facts.push('Basic auth')
    if (request.options.compressed) facts.push('compressed')
    if (request.options.location) facts.push('follows redirects')
    if (request.options.insecure) facts.push('insecure TLS')
    if (request.dialect === 'cmd') facts.push('Windows cmd syntax')
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'baseline', minWidth: 0 }}>
                <span className="mono" style={{ fontWeight: 700, color: METHOD_COLORS[request.method] ?? 'var(--text-muted)' }}>{request.method}</span>
                <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-main)', overflowWrap: 'anywhere', minWidth: 0 }}>{request.url}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {facts.map(f => <span key={f} className="badge">{f}</span>)}
            </div>
        </div>
    )
}

export default function Curl() {
    const navigate = useNavigate()
    const { size } = usePane()
    const inputId = useId()
    const [command, setCommand] = useState('')
    const [storedTarget, setTarget] = useLocalStorage('curl-target', 'fetch')
    const target = CODE_TARGETS.some(t => t.value === storedTarget) ? storedTarget : 'fetch'
    useSmartInput({ input: setCommand })

    const result = useMemo(() => {
        if (!command.trim()) return null
        try {
            return { request: parseCurl(command) }
        } catch (error) {
            return { error: error.message }
        }
    }, [command])
    const request = result?.request ?? null
    const code = useMemo(() => (request ? generateCode(request, target) : ''), [request, target])
    const targetInfo = CODE_TARGETS.find(t => t.value === target)

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="split-pane">
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <label htmlFor={inputId} className="section-title">
                            <TerminalSquare size={16} aria-hidden="true" style={{ color: 'var(--primary-text)' }} /> cURL command
                        </label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineRead onRead={setCommand} />
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCommand(EXAMPLE)}>Example</button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCommand('')} disabled={!command}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    </div>
                    <textarea
                        id={inputId}
                        value={command}
                        onChange={e => setCommand(e.target.value)}
                        placeholder={"curl -X POST 'https://api.example.com/items' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\": \"Ada\"}'"}
                        spellCheck={false}
                        aria-describedby={`${inputId}-hint`}
                        rows={10}
                        style={{ fontSize: '0.85rem' }}
                    />
                    <p id={`${inputId}-hint`} className="field-hint" style={{ marginTop: 0 }}>
                        Paste from a terminal, API docs or Chrome DevTools (right-click a request → Copy → Copy as cURL, bash or cmd). Nothing is run or sent.
                    </p>

                    {result?.error && (
                        <StatusBanner tone="danger" title="Can't read this command">{result.error}</StatusBanner>
                    )}
                    {request && (
                        <>
                            <div className="code-well" style={{ padding: 'var(--space-sm) var(--space-md)', fontFamily: 'var(--font-family)' }}>
                                <Summary request={request} />
                            </div>
                            {request.warnings.length > 0 && (
                                <StatusBanner tone="warning" title={request.warnings.length === 1 ? 'One thing to check' : `${request.warnings.length} things to check`}>
                                    <ul style={{ paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {request.warnings.map(w => <li key={w}>{w}</li>)}
                                    </ul>
                                </StatusBanner>
                            )}
                            <div>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={() => openInTool(navigate, API_TESTER_PATH, { input: command.trim() })}
                                >
                                    Open in API Tester <ArrowRight size={16} aria-hidden="true" />
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <h2 className="section-title">
                            <FileCode2 size={16} aria-hidden="true" style={{ color: 'var(--primary-text)' }} /> Output
                        </h2>
                        <SegmentedControl
                            ariaLabel="Output language"
                            size="sm"
                            value={target}
                            onChange={setTarget}
                            options={CODE_TARGETS.map(t => ({
                                value: t.value,
                                label: size === 'sm' ? t.label : t.value === 'curl' ? 'cURL (normalized)' : t.title,
                                title: t.value === 'curl' ? 'Cleaned-up cURL command' : t.title,
                            }))}
                        />
                    </div>
                    {code ? (
                        <>
                            <CodeBlock code={code} language={targetLanguage(target)} title={targetInfo.title} copyLabel="Copy code" />
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <PipelineSend dataToSend={code} />
                            </div>
                        </>
                    ) : (
                        <EmptyState icon={FileCode2} title={result?.error ? 'No output' : 'Paste a cURL command'}>
                            {result?.error
                                ? 'Fix the command on the left to see the converted code.'
                                : 'It is converted to JavaScript fetch(), Python requests or a cleaned-up cURL command as you type.'}
                        </EmptyState>
                    )}
                </div>
            </div>
        </div>
    )
}
