import { useId, useMemo, useState } from 'react'
import { Braces, Download, FileCode, Sparkles, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import CodeBlock from '../components/ui/CodeBlock'
import CopyButton from '../components/ui/CopyButton'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import Field from '../components/ui/Field'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { generateTypes, normalizeRootName, parseJsonSample } from '../utils/typegen'
import { downloadText } from '../utils/download'

const TARGETS = [
    { value: 'typescript', label: 'TypeScript', prism: 'typescript', copy: 'Copy TypeScript', file: 'types.ts', mime: 'text/plain' },
    { value: 'go', label: 'Go', prism: 'go', copy: 'Copy Go', file: 'types.go', mime: 'text/plain' },
    { value: 'schema', label: 'JSON Schema', prism: 'json', copy: 'Copy schema', file: 'schema.json', mime: 'application/json' },
]

const SAMPLE = `[
  {
    "id": 101,
    "name": "Vibe Workstation",
    "price": 1299.0,
    "active": true,
    "tags": ["frontend", "offline"],
    "owner": { "name": "Jane", "role": "Lead Developer" },
    "discontinuedAt": null
  },
  {
    "id": 102,
    "name": "Travel Kit",
    "price": 89.5,
    "active": false,
    "tags": [],
    "owner": { "name": "Sam", "role": "Designer", "email": "sam@example.com" },
    "discontinuedAt": "2024-02-01"
  }
]`

function describeJsonError(text, error) {
    const message = String(error?.message || error)
    if (/line \d+ column \d+/.test(message)) return message
    const pos = message.match(/at position (\d+)/)
    if (!pos) return message
    const before = text.slice(0, Number(pos[1]))
    const line = before.split('\n').length
    return `${message} (line ${line}, column ${Number(pos[1]) - before.lastIndexOf('\n')})`
}

export default function TypeConverter() {
    const inputId = useId()
    const rootId = useId()
    const [input, setInput] = useState(SAMPLE)
    const [target, setTarget] = useState('typescript')
    const [rootName, setRootName] = useState('Root')

    const debounced = useDebouncedValue(input, input.length > 100_000 ? 500 : 150)
    const parsed = useMemo(() => {
        if (!debounced.trim()) return { empty: true }
        try {
            return { value: parseJsonSample(debounced) }
        } catch (e) {
            return { error: describeJsonError(debounced, e) }
        }
    }, [debounced])

    const typeName = normalizeRootName(rootName)
    const output = useMemo(
        () => ('value' in parsed ? generateTypes(parsed.value, { target, rootName: typeName }) : ''),
        [parsed, target, typeName]
    )
    const targetInfo = TARGETS.find(t => t.value === target) ?? TARGETS[0]
    const status = input.trim() === '' ? 'empty' : parsed.error ? 'invalid' : 'valid'

    useSmartInput({ input: (value) => typeof value === 'string' && setInput(value) })

    useRegisterAIContext({
        tool: 'JSON to Types',
        getContext: () => ({ input, output }),
        suggestedPrompts: [
            'Which fields should really be optional?',
            'Add JSDoc comments to these types',
            'Write a validation function for this type',
            'Explain the JSON Schema constraints shown here',
        ],
    })

    return (
        <div className="page page-wide page-type-converter">
            <ToolHeader />

            <section className="card card-compact" aria-label="Output options" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 'var(--space-sm) var(--space-lg)' }}>
                <div>
                    <div className="field-label">Generate</div>
                    <SegmentedControl ariaLabel="Output language" options={TARGETS} value={target} onChange={setTarget} />
                </div>
                <Field
                    label="Root type name"
                    hint={typeName !== rootName.trim() ? `Used as ${typeName}` : null}
                    style={{ minWidth: 180, flex: '0 1 240px' }}
                >
                    <input
                        id={rootId}
                        type="text"
                        value={rootName}
                        onChange={e => setRootName(e.target.value)}
                        placeholder="Root"
                        spellCheck={false}
                        autoComplete="off"
                        autoCapitalize="off"
                        style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
                    />
                </Field>
            </section>

            <div className="split-pane">
                <div className="card card-compact" role="region" aria-label="JSON input" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <label htmlFor={inputId} className="section-title">
                            <Braces size={16} aria-hidden="true" /> JSON sample
                            {status === 'valid' && <span className="badge badge-success">Valid</span>}
                            {status === 'invalid' && <span className="badge badge-danger">Invalid</span>}
                        </label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineRead onRead={setInput} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInput(SAMPLE)}>
                                <Sparkles size={14} aria-hidden="true" /> Sample
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    </div>
                    <textarea
                        id={inputId}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Paste a JSON object or an array of objects…"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoComplete="off"
                        aria-invalid={status === 'invalid' || undefined}
                        className={status === 'invalid' ? 'field-invalid' : ''}
                        style={{ minHeight: 'clamp(260px, 50vh, 600px)', fontSize: '0.85rem', lineHeight: 1.5, padding: '0.75rem' }}
                    />
                    <div className="field-hint" style={{ marginTop: 0 }}>
                        Every item of every array is inspected: keys missing from some items become optional, and mixed values become unions.
                    </div>
                </div>

                <div className="card card-compact" role="region" aria-label="Generated types" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <div className="section-title" role="heading" aria-level={2}><FileCode size={16} aria-hidden="true" /> {targetInfo.label}</div>
                        <CopyButton text={output} label={targetInfo.copy} />
                    </div>

                    {parsed.error && status === 'invalid' && (
                        <StatusBanner tone="danger" title="Invalid JSON">
                            <span className="mono" style={{ fontSize: '0.82rem' }}>{parsed.error}</span>
                        </StatusBanner>
                    )}

                    {output ? (
                        <CodeBlock code={output} language={targetInfo.prism} maxHeight="clamp(260px, 65vh, 760px)" wrap={false} showCopy={false} />
                    ) : (
                        <div className="code-well" style={{ minHeight: 'clamp(260px, 50vh, 600px)', display: 'flex' }}>
                            <EmptyState title={status === 'invalid' ? 'Fix the JSON to see types' : 'Types appear here'} style={{ margin: 'auto' }}>
                                {status === 'invalid' ? 'The sample must be valid JSON.' : 'Paste a JSON sample, such as an API response.'}
                            </EmptyState>
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <PipelineSend dataToSend={output} disabled={!output} />
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText(output, targetInfo.file, targetInfo.mime)} disabled={!output}>
                            <Download size={14} aria-hidden="true" /> Download
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
