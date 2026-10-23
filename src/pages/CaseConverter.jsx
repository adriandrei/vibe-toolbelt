import { useMemo, useState } from 'react'
import { Trash2, Wand2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import CopyButton from '../components/ui/CopyButton'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { CASES } from '../utils/caseConvert'

const EXAMPLE = 'XMLHttpRequest getHTTPResponseCode\nuser_id2Name\nhello, world! iPhone NASA ärgerÜber'
const PREVIEW_LIMIT = 5000

function ResultRow({ label, value, perLine }) {
    const shown = value.length > PREVIEW_LIMIT ? `${value.slice(0, PREVIEW_LIMIT)}…` : value
    return (
        <li style={{ listStyle: 'none', padding: 'var(--space-sm) var(--space-md)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.03em' }}>
                    {label}
                    {perLine && <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}> · per line</span>}
                </span>
                <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
                    <PipelineSend dataToSend={value} label="Send" />
                    <CopyButton text={value} iconOnly label={`Copy ${label}`} />
                </div>
            </div>
            <div
                className="mono"
                style={{ marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.92rem', color: value ? 'var(--text-main)' : 'var(--text-dim)', maxHeight: '9.5em', overflowY: 'auto' }}
            >
                {shown || '—'}
            </div>
            {value.length > PREVIEW_LIMIT && (
                <div className="field-hint">Showing the first {PREVIEW_LIMIT.toLocaleString()} characters; Copy and Send use all of it.</div>
            )}
        </li>
    )
}

export default function CaseConverter() {
    const [input, setInput] = useState('')
    const source = useDebouncedValue(input, input.length > 50000 ? 250 : 0)
    const results = useMemo(() => CASES.map(c => ({ ...c, value: source ? c.convert(source) : '' })), [source])
    const multiline = /[\r\n]/.test(source.trim())

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="split-pane" style={{ alignItems: 'start' }}>
                <section className="card">
                    <Field
                        label="Text"
                        hint="Identifier styles (camelCase, snake_case…) convert each line separately and drop punctuation."
                        labelAction={
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <PipelineRead onRead={setInput} />
                                {!input && (
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInput(EXAMPLE)}>
                                        <Wand2 size={14} aria-hidden="true" /> Example
                                    </button>
                                )}
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input}>
                                    <Trash2 size={14} aria-hidden="true" /> Clear
                                </button>
                            </div>
                        }
                    >
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type or paste text, e.g. getHTTPResponseCode or user first name"
                            spellCheck={false}
                            style={{ minHeight: 260 }}
                        />
                    </Field>
                </section>

                <section className="card" aria-label="Conversions">
                    <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', margin: 0, padding: 0 }}>
                        {results.map(r => (
                            <ResultRow key={r.id} label={r.label} value={r.value} perLine={r.identifier && multiline} />
                        ))}
                    </ul>
                </section>
            </div>
        </div>
    )
}
