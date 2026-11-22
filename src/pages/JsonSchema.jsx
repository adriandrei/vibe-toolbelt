import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Braces, FileCheck2, ListChecks, Loader2, Play, RotateCcw, Sparkles, Trash2, Wand2, Workflow } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import ShareButton from '../components/ui/ShareButton'
import StatusBanner from '../components/ui/StatusBanner'
import { useToast } from '../components/ToastProvider'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useSharedState } from '../hooks/useSharedState'
import { useSmartInput } from '../hooks/useSmartInput'
import { openInTool } from '../utils/smartNav'
import {
    DRAFTS, DRAFT_LABELS, DRAFT_VALUES, EXAMPLE_DATA, EXAMPLE_SCHEMA,
    detectDraft, formatJson, lintSchema, loadValidator, parseDocument, validateData,
} from '../utils/schemaValidate'
import './JsonSchema.css'

// Above this many characters (schema + data), checking waits for a button press
const LIVE_LIMIT = 1_000_000
const MAX_SHOWN = 200

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

function InputPanel({ title, noun, icon: Icon, value, onChange, parsed, onFormat, onClear, footer, placeholder, hint }) {
    const id = useId()
    const invalid = parsed.status === 'error'
    const yamlInput = parsed.status === 'ok' && parsed.format === 'yaml'
    return (
        <div className="card card-compact jsonschema-panel" role="region" aria-label={title}>
            <div className="jsonschema-panel-head">
                <label htmlFor={id} className="section-title">
                    <Icon size={16} aria-hidden="true" /> {title}
                    {parsed.status === 'ok' && <span className="badge badge-success">{yamlInput ? 'YAML' : 'JSON'}</span>}
                    {invalid && <span className="badge badge-danger">Invalid</span>}
                </label>
                <div className="jsonschema-panel-actions">
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={onFormat}
                        disabled={parsed.status === 'empty' || parsed.status === 'error'}
                        aria-label={yamlInput ? `Convert ${noun} to JSON` : `Format ${noun}`}
                        title={yamlInput ? 'Rewrite the YAML as formatted JSON' : 'Pretty-print with 2-space indents'}
                    >
                        <Wand2 size={14} aria-hidden="true" /> {yamlInput ? 'To JSON' : 'Format'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} disabled={!value} aria-label={`Clear ${noun}`}>
                        <Trash2 size={14} aria-hidden="true" /> Clear
                    </button>
                </div>
            </div>
            <textarea
                id={id}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                aria-invalid={invalid || undefined}
                aria-describedby={`${id}-msg`}
                className={`jsonschema-input ${invalid ? 'field-invalid' : ''}`}
            />
            <div className="jsonschema-panel-foot">
                {invalid
                    ? <div id={`${id}-msg`} className="field-error" style={{ marginTop: 0, overflowWrap: 'anywhere' }}>{parsed.message}</div>
                    : <div id={`${id}-msg`} className="field-hint" style={{ marginTop: 0 }}>{hint}</div>}
                {footer}
            </div>
        </div>
    )
}

function IssueList({ issues, tone }) {
    return (
        <ul className="jsonschema-list" style={{ marginTop: 'var(--space-xs)' }}>
            {issues.map((issue, i) => (
                <li key={i} className={`jsonschema-issue ${tone === 'warning' ? 'is-warning' : ''}`}>
                    <span className="jsonschema-path">#{issue.pointer}</span>
                    <span className="jsonschema-message">{issue.message}</span>
                </li>
            ))}
        </ul>
    )
}

function ErrorItem({ entry, summary = false }) {
    const optionTitle = entry.keyword === 'minContains' ? 'Items that don’t match' : 'Why each option failed'
    return (
        <li className={`jsonschema-issue ${summary ? 'is-summary' : ''}`}>
            <div className="jsonschema-issue-head">
                <span className="jsonschema-path">{entry.path}</span>
                <span className="badge mono">{entry.keyword}</span>
            </div>
            <div className="jsonschema-message">{entry.message}</div>
            <dl className="jsonschema-meta">
                <div><dt>JSON Pointer</dt><dd>{entry.pointer || '(root)'}</dd></div>
                <div><dt>Schema</dt><dd>{entry.schemaPointer}</dd></div>
            </dl>
            {entry.details?.length > 0 && (
                <details className="jsonschema-details">
                    <summary>{optionTitle}</summary>
                    {entry.details.map((group, i) => (
                        <div key={i} className="jsonschema-option">
                            {group.label && <div className="jsonschema-option-label">{group.label}</div>}
                            <ul>
                                {group.causes.map((c, j) => (
                                    <li key={j}><code>{c.path}</code> {c.message}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </details>
            )}
        </li>
    )
}

export default function JsonSchema() {
    const navigate = useNavigate()
    const toast = useToast()
    const draftId = useId()
    const resultsId = useId()
    const [schemaText, setSchemaText] = useState('')
    const [dataText, setDataText] = useState('')
    const [draft, setDraft] = useState('auto')
    const [manual, setManual] = useState(null)
    const [Validator, setValidator] = useState(null)
    const [loadState, setLoadState] = useState({ failed: false, attempt: 0 })

    const size = schemaText.length + dataText.length
    const large = size > LIVE_LIMIT
    const delay = size > 200_000 ? 600 : 200
    const debouncedSchema = useDebouncedValue(schemaText, delay)
    const debouncedData = useDebouncedValue(dataText, delay)
    const pending = large && !(manual && manual.schema === schemaText && manual.data === dataText)
    const schemaSource = large ? (pending ? null : schemaText) : debouncedSchema
    const dataSource = large ? (pending ? null : dataText) : debouncedData

    const schemaParsed = useMemo(() => (schemaSource === null ? { status: 'pending' } : parseDocument(schemaSource)), [schemaSource])
    const dataParsed = useMemo(() => (dataSource === null ? { status: 'pending' } : parseDocument(dataSource)), [dataSource])

    const schemaInfo = useMemo(() => {
        if (schemaParsed.status !== 'ok') return null
        const detected = detectDraft(schemaParsed.value)
        const effective = draft === 'auto' ? detected.draft : draft
        return { detected, draft: effective, ...lintSchema(schemaParsed.value, effective) }
    }, [schemaParsed, draft])

    const ready = Boolean(schemaInfo && schemaInfo.errors.length === 0 && dataParsed.status === 'ok')

    // The validator is loaded the first time there is something to check
    const attempt = loadState.attempt
    useEffect(() => {
        if (!ready || Validator) return undefined
        let cancelled = false
        loadValidator()
            .then((loaded) => {
                if (cancelled) return
                setValidator(() => loaded)
                setLoadState(s => ({ ...s, failed: false }))
            })
            .catch(() => {
                if (!cancelled) setLoadState(s => ({ ...s, failed: true }))
            })
        return () => {
            cancelled = true
        }
    }, [ready, Validator, attempt])

    const result = useMemo(
        () => (ready && Validator ? validateData(Validator, schemaParsed.value, dataParsed.value, schemaInfo.draft) : null),
        [ready, Validator, schemaParsed, dataParsed, schemaInfo]
    )

    useSmartInput({ input: (value) => typeof value === 'string' && setDataText(value) })

    useSharedState((shared) => {
        if (!shared || typeof shared !== 'object') return
        if (typeof shared.schema === 'string') setSchemaText(shared.schema)
        if (typeof shared.data === 'string') setDataText(shared.data)
        setDraft(DRAFT_VALUES.includes(shared.draft) ? shared.draft : 'auto')
    })

    const draftName = schemaInfo ? DRAFT_LABELS[schemaInfo.draft] : null
    const errorsText = result?.status === 'invalid'
        ? result.causes.map(c => `${c.path}: ${c.message} (${c.keyword} at ${c.schemaPointer})`).join('\n')
        : ''
    const verdict = result?.status === 'valid'
        ? 'Valid: the data matches the schema.'
        : result?.status === 'invalid'
            ? `Invalid: ${plural(result.causes.length, 'problem')}.\n${errorsText}`
            : ''

    useRegisterAIContext({
        tool: 'JSON Schema Validator',
        getContext: () => ({ input: `Schema:\n${schemaText}\n\nData:\n${dataText}`, output: verdict }),
        suggestedPrompts: [
            'Explain these validation errors',
            'Fix the data so it matches the schema',
            'Is this schema too strict or too loose anywhere?',
        ],
    })

    const reformat = (text, set, noun) => {
        const parsed = parseDocument(text)
        if (parsed.status !== 'ok') {
            toast.error(`The ${noun} isn’t valid JSON or YAML yet.`)
            return
        }
        set(parsed.format === 'json' ? formatJson(text) : JSON.stringify(parsed.value, null, 2))
    }

    const loadExample = () => {
        setSchemaText(EXAMPLE_SCHEMA)
        setDataText(EXAMPLE_DATA)
        setDraft('auto')
    }

    const generateSchema = () => {
        const parsed = parseDocument(dataText)
        if (parsed.status !== 'ok') return
        const input = parsed.format === 'json' ? dataText.trim() : JSON.stringify(parsed.value, null, 2)
        openInTool(navigate, '/type-converter', { input, mode: 'schema' })
    }

    const mismatch = schemaInfo && draft !== 'auto' && schemaInfo.detected.source === 'schema' && schemaInfo.detected.draft !== draft
    const draftHint = !schemaInfo
        ? 'Read from "$schema", 2020-12 if there’s none.'
        : draft === 'auto'
            ? `Using ${draftName} (${schemaInfo.detected.source === 'schema' ? 'from $schema' : 'no $schema, so the latest'}).`
            : `Using ${draftName}.`

    const shown = result?.status === 'invalid' ? result.causes.slice(0, MAX_SHOWN) : []
    const bothEmpty = schemaParsed.status === 'empty' && dataParsed.status === 'empty'

    return (
        <div className="page page-wide">
            <ToolHeader
                actions={<ShareButton getState={() => ({ schema: schemaText, data: dataText, draft })} disabled={!schemaText.trim() && !dataText.trim()} />}
            />

            <section className="card card-compact jsonschema-options" aria-label="Options">
                <label htmlFor={draftId} className="field-label" style={{ marginBottom: 0 }}>Draft</label>
                <select id={draftId} value={draft} onChange={e => setDraft(e.target.value)} aria-describedby={`${draftId}-hint`}>
                    {DRAFTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                <span id={`${draftId}-hint`} className="field-hint" style={{ marginTop: 0, flex: '1 1 14rem' }}>{draftHint}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={loadExample}>
                    <Sparkles size={14} aria-hidden="true" /> Load example
                </button>
            </section>

            <div className="split-pane">
                <InputPanel
                    title="Schema"
                    noun="schema"
                    icon={FileCheck2}
                    value={schemaText}
                    onChange={setSchemaText}
                    parsed={schemaParsed}
                    onFormat={() => reformat(schemaText, setSchemaText, 'schema')}
                    onClear={() => setSchemaText('')}
                    placeholder={'{\n  "type": "object",\n  "required": ["name"]\n}'}
                    hint="JSON Schema as JSON or YAML."
                />
                <InputPanel
                    title="Data"
                    noun="data"
                    icon={Braces}
                    value={dataText}
                    onChange={setDataText}
                    parsed={dataParsed}
                    onFormat={() => reformat(dataText, setDataText, 'data')}
                    onClear={() => setDataText('')}
                    placeholder={'{\n  "name": "Ada"\n}'}
                    hint="The JSON or YAML to check."
                    footer={(
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={generateSchema}
                            disabled={dataParsed.status !== 'ok'}
                            title="Open JSON to Types with this data to generate a schema from it"
                        >
                            <Workflow size={14} aria-hidden="true" /> Generate schema
                        </button>
                    )}
                />
            </div>

            <section className="card jsonschema-results" aria-labelledby={resultsId}>
                <div className="jsonschema-results-head">
                    <h2 id={resultsId} className="section-title"><ListChecks size={16} aria-hidden="true" /> Result</h2>
                    {result?.status === 'invalid' && <CopyButton text={errorsText} label="Copy errors" />}
                </div>

                {pending ? (
                    <StatusBanner
                        tone="info"
                        title="Large input"
                        action={(
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => setManual({ schema: schemaText, data: dataText })}>
                                <Play size={14} aria-hidden="true" /> Validate
                            </button>
                        )}
                    >
                        Live checking is paused for inputs over {(LIVE_LIMIT / 1_000_000).toLocaleString()} million characters.
                    </StatusBanner>
                ) : bothEmpty ? (
                    <EmptyState icon={ListChecks} title="Nothing to check yet">
                        Paste a schema and the data to check, or{' '}
                        <button type="button" className="btn btn-outline btn-sm" onClick={loadExample} style={{ verticalAlign: 'baseline' }}>load the example</button>
                    </EmptyState>
                ) : (
                    <>
                        {schemaParsed.status === 'error' && (
                            <StatusBanner tone="danger" title="The schema can’t be read">
                                <span className="mono" style={{ fontSize: '0.82rem' }}>{schemaParsed.message}</span>
                            </StatusBanner>
                        )}
                        {schemaInfo && schemaInfo.errors.length > 0 && (
                            <StatusBanner tone="danger" title={`Schema problems (${schemaInfo.errors.length})`}>
                                Fix these first: the data isn’t checked until the schema is usable.
                                <IssueList issues={schemaInfo.errors} tone="danger" />
                            </StatusBanner>
                        )}
                        {schemaInfo && schemaInfo.warnings.length > 0 && (
                            <StatusBanner tone="warning" title={`Schema warnings (${schemaInfo.warnings.length})`}>
                                <IssueList issues={schemaInfo.warnings} tone="warning" />
                            </StatusBanner>
                        )}
                        {schemaInfo?.detected.note && draft === 'auto' && <StatusBanner tone="info">{schemaInfo.detected.note}</StatusBanner>}
                        {mismatch && (
                            <StatusBanner tone="warning">
                                The schema’s "$schema" says {DRAFT_LABELS[schemaInfo.detected.draft]}, but {draftName} is selected.
                            </StatusBanner>
                        )}

                        {dataParsed.status === 'error' && (
                            <StatusBanner tone="danger" title="The data can’t be read">
                                <span className="mono" style={{ fontSize: '0.82rem' }}>{dataParsed.message}</span>
                            </StatusBanner>
                        )}
                        {schemaParsed.status === 'empty' && dataParsed.status !== 'empty' && (
                            <StatusBanner tone="info">Add a schema to check the data against.</StatusBanner>
                        )}
                        {schemaInfo && schemaInfo.errors.length === 0 && dataParsed.status === 'empty' && (
                            <StatusBanner tone="info" title="The schema is ready">Add the data to validate against it.</StatusBanner>
                        )}

                        {ready && !Validator && (loadState.failed ? (
                            <StatusBanner
                                tone="danger"
                                title="Couldn’t load the validator"
                                action={(
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLoadState(s => ({ failed: false, attempt: s.attempt + 1 }))}>
                                        <RotateCcw size={14} aria-hidden="true" /> Try again
                                    </button>
                                )}
                            >
                                Check your connection: the validator is downloaded the first time it’s needed.
                            </StatusBanner>
                        ) : (
                            <div className="field-hint" role="status" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginTop: 0 }}>
                                <Loader2 size={14} className="spin" aria-hidden="true" /> Loading the validator…
                            </div>
                        ))}

                        {result?.status === 'schema-error' && (
                            <StatusBanner tone="danger" title="The schema can’t be used">{result.message}</StatusBanner>
                        )}
                        {result?.status === 'valid' && (
                            <StatusBanner tone="success" title="Valid">The data matches the schema ({draftName}).</StatusBanner>
                        )}
                        {result?.status === 'invalid' && (
                            <>
                                <StatusBanner tone="danger" title={`Invalid: ${plural(result.causes.length, 'problem')}`}>
                                    The data doesn’t match the schema ({draftName}).
                                </StatusBanner>
                                <ol className="jsonschema-list" aria-label="Validation errors">
                                    {shown.map((entry, i) => <ErrorItem key={i} entry={entry} />)}
                                </ol>
                                {result.causes.length > MAX_SHOWN && (
                                    <p className="jsonschema-more">
                                        Showing the first {MAX_SHOWN}. Copy the errors to get all {result.causes.length.toLocaleString()}.
                                    </p>
                                )}
                                {result.summaries.length > 0 && (
                                    <details className="jsonschema-details">
                                        <summary>Show {plural(result.summaries.length, 'summary error')}</summary>
                                        <p className="field-hint" style={{ marginTop: 0, marginBottom: 'var(--space-sm)' }}>
                                            The validator also reports each property and item that contains the errors above.
                                        </p>
                                        <ol className="jsonschema-list" aria-label="Summary errors">
                                            {result.summaries.slice(0, MAX_SHOWN).map((entry, i) => <ErrorItem key={i} entry={entry} summary />)}
                                        </ol>
                                        <div style={{ marginTop: 'var(--space-sm)' }}>
                                            <CopyButton text={JSON.stringify(result.raw, null, 2)} label="Copy raw validator output" />
                                        </div>
                                    </details>
                                )}
                            </>
                        )}
                    </>
                )}
            </section>
        </div>
    )
}
