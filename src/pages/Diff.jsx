import { useId, useMemo, useState } from 'react'
import { AlignJustify, ArrowLeftRight, Download, Columns2, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import SegmentedControl from '../components/ui/SegmentedControl'
import ShareButton from '../components/ui/ShareButton'
import StatusBanner from '../components/ui/StatusBanner'
import { DiffViewer } from '../components/DiffViewer'
import { PipelineRead } from '../components/PipelineFeature'
import { useToast } from '../components/ToastProvider'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useSharedState } from '../hooks/useSharedState'
import { createDiffPatch, useLineDiff } from '../hooks/useLineDiff'
import { downloadText } from '../utils/download'
import { KEEPS_NUMBER_TEXT, prepareJsonSide } from '../utils/jsonCompare'
import { field, ignoredFieldsMessage, readSharedFields } from '../utils/shareFields'
import { getTool } from '../config/tools'

const TOOL_NAME = getTool('/diff')?.title ?? 'Text Diff'
const AI_PATCH_LIMIT = 6000
// Above this size, a side is parsed as JSON once typing pauses
const JSON_DEBOUNCE_FROM = 200_000

const VIEWS = [
    { value: 'unified', label: 'Unified', icon: AlignJustify },
    { value: 'split', label: 'Side by side', icon: Columns2 },
]

const SHARE_FIELDS = {
    oldText: field.string(),
    newText: field.string(),
    viewMode: field.oneOf(VIEWS.map(v => v.value)),
    ignoreWhitespace: field.boolean(),
    stripTrailingCr: field.boolean(),
    ignoreNewlineAtEof: field.boolean(),
    compareJson: field.boolean(),
}

const SIDE_NAMES = { old: 'Original', new: 'Changed' }

function Option({ id, checked, onChange, children, hint }) {
    return (
        <label htmlFor={id} title={hint} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            {children}
        </label>
    )
}

// One side parsed for "Compare as JSON" (null while the option is off)
function useJsonSide(text, enabled) {
    const delay = enabled && text.length > JSON_DEBOUNCE_FROM ? 300 : 0
    const debounced = useDebouncedValue(enabled ? text : '', delay)
    const source = delay === 0 ? text : debounced
    return useMemo(() => (enabled ? prepareJsonSide(source) : null), [enabled, source])
}

const at = (error) => (error.line ? `, line ${error.line}, column ${error.column}` : '')

// What the JSON comparison did, or why it couldn't run
function JsonStatus({ sides, ready, same, exact }) {
    if (ready) {
        const duplicated = Object.entries(sides).filter(([, side]) => side.duplicateCount > 0)
        return (
            <>
                {same ? (
                    <StatusBanner tone="success" title="No differences">
                        {exact ? 'The two texts are identical.' : 'Both sides hold the same JSON once key order and formatting are ignored.'}
                    </StatusBanner>
                ) : (
                    <p className="field-hint" style={{ margin: 0 }}>
                        Compared as JSON, with object keys sorted and both sides indented the same way. Line numbers refer to this formatted JSON.
                    </p>
                )}
                {!KEEPS_NUMBER_TEXT && (
                    <StatusBanner tone="info" title="Numbers are compared by value">
                        This browser can’t keep numbers exactly as written, so 1.0 and 1 count as equal and integers above 2⁵³ may be rounded.
                    </StatusBanner>
                )}
                {duplicated.length > 0 && (
                    <StatusBanner tone="warning" title="Repeated keys">
                        {duplicated.map(([name, side]) => (
                            <div key={name}>
                                {SIDE_NAMES[name]}: {side.duplicates.map(d => `“${d.key}” (line ${d.line}, column ${d.column})`).join(', ')}
                                {side.duplicateCount > side.duplicates.length ? ` and ${side.duplicateCount - side.duplicates.length} more` : ''}.
                            </div>
                        ))}
                        <div>JSON keeps only the last value of a repeated key, so the earlier ones aren’t compared.</div>
                    </StatusBanner>
                )}
            </>
        )
    }
    const invalid = Object.entries(sides).filter(([, side]) => side?.status === 'invalid')
    if (invalid.length) {
        return (
            <StatusBanner tone="warning" title={invalid.length === 2 ? 'Neither side is valid JSON' : `The ${SIDE_NAMES[invalid[0][0]].toLowerCase()} text isn’t valid JSON`}>
                {invalid.map(([name, side]) => (
                    <div key={name}>
                        <strong>{SIDE_NAMES[name]}</strong>{at(side.error)}: {side.error.message}
                    </div>
                ))}
                <div>Showing a plain text comparison instead.</div>
            </StatusBanner>
        )
    }
    return <p className="field-hint" style={{ margin: 0 }}>Paste JSON into both sides to compare it as JSON.</p>
}

export default function Diff() {
    const id = useId()
    const toast = useToast()
    const [oldText, setOldText] = useState('')
    const [newText, setNewText] = useState('')
    const [viewMode, setViewMode] = useState('unified')
    const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
    const [stripTrailingCr, setStripTrailingCr] = useState(true)
    const [ignoreNewlineAtEof, setIgnoreNewlineAtEof] = useState(true)
    const [compareJson, setCompareJson] = useState(false)

    useSharedState((data) => {
        const { values, ignored } = readSharedFields(data, SHARE_FIELDS)
        if ('oldText' in values) setOldText(values.oldText)
        if ('newText' in values) setNewText(values.newText)
        if ('viewMode' in values) setViewMode(values.viewMode)
        if ('ignoreWhitespace' in values) setIgnoreWhitespace(values.ignoreWhitespace)
        if ('stripTrailingCr' in values) setStripTrailingCr(values.stripTrailingCr)
        if ('ignoreNewlineAtEof' in values) setIgnoreNewlineAtEof(values.ignoreNewlineAtEof)
        if ('compareJson' in values) setCompareJson(values.compareJson)
        if (ignored.length) toast.warning(ignoredFieldsMessage(ignored), 6000)
    })

    const oldJson = useJsonSide(oldText, compareJson)
    const newJson = useJsonSide(newText, compareJson)
    const jsonReady = compareJson && oldJson?.status === 'ok' && newJson?.status === 'ok'
    // With "Compare as JSON", the formatted JSON is what gets compared
    const left = jsonReady ? oldJson.text : oldText
    const right = jsonReady ? newJson.text : newText

    const options = { ignoreWhitespace, stripTrailingCr, ignoreNewlineAtEof }
    // One diff for the counts, the viewer and the AI context
    const diff = useLineDiff(left, right, options)
    const hasInput = Boolean(oldText || newText)
    const hasChanges = hasInput && !diff.timedOut && !diff.identical
    const jsonSame = jsonReady && !diff.timedOut && diff.identical

    const buildPatch = () => createDiffPatch(left, right, options)

    useRegisterAIContext({
        tool: TOOL_NAME,
        getContext: () => {
            if (!hasInput) return { input: 'Both texts are empty.', output: '' }
            const what = jsonReady ? 'Comparing two JSON documents (keys sorted and re-indented, so key order and formatting are ignored):' : 'Comparing'
            const summary = `${what} an original text (${diff.stats.removed + diff.stats.unchanged} lines) with a changed text (${diff.stats.added + diff.stats.unchanged} lines).`
            if (diff.timedOut) return { input: summary, output: 'The texts were too large to compare.' }
            if (diff.identical) return { input: summary, output: 'No differences.' }
            const patch = buildPatch()
            return {
                input: `${summary} ${diff.stats.added} lines added, ${diff.stats.removed} removed.`,
                output: patch.length > AI_PATCH_LIMIT ? `${patch.slice(0, AI_PATCH_LIMIT)}\n… (patch truncated)` : patch,
            }
        },
        suggestedPrompts: [
            'Summarize the changes between these two versions',
            'Are there any breaking changes here?',
            'Check for potential bugs in the added code',
            'Write a commit message for this diff',
        ],
    })

    const swap = () => {
        setOldText(newText)
        setNewText(oldText)
    }

    const clearButton = (value, setter, label) => (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setter('')} disabled={!value} aria-label={`Clear ${label}`}>
            <Trash2 size={14} aria-hidden="true" /> Clear
        </button>
    )

    return (
        <div className="page page-wide">
            <ToolHeader />

            <section className="card card-compact" aria-label="Options" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-lg)' }}>
                <SegmentedControl ariaLabel="View" options={VIEWS} value={viewMode} onChange={setViewMode} />
                <div role="group" aria-label="Ignore" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs) var(--space-md)' }}>
                    <Option id={`${id}-ws`} checked={ignoreWhitespace} onChange={setIgnoreWhitespace} hint="Treat lines that only differ in leading or trailing whitespace as equal">
                        Ignore whitespace
                    </Option>
                    <Option id={`${id}-cr`} checked={stripTrailingCr} onChange={setStripTrailingCr} hint="Treat Windows (CRLF) and Unix (LF) line endings as equal">
                        Ignore line endings
                    </Option>
                    <Option id={`${id}-eof`} checked={ignoreNewlineAtEof} onChange={setIgnoreNewlineAtEof} hint="Don't flag a missing line break at the very end">
                        Ignore final newline
                    </Option>
                </div>
                <Option id={`${id}-json`} checked={compareJson} onChange={setCompareJson} hint="Parse both sides as JSON and compare them with object keys sorted and the same indentation. Array order still counts.">
                    Compare as JSON (ignore key order and formatting)
                </Option>
                <div style={{ display: 'flex', gap: 'var(--space-xs)', marginLeft: 'auto', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={swap} disabled={!hasInput}>
                        <ArrowLeftRight size={14} aria-hidden="true" /> Swap
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                            setOldText('')
                            setNewText('')
                        }}
                        disabled={!hasInput}
                    >
                        <Trash2 size={14} aria-hidden="true" /> Clear both
                    </button>
                    <ShareButton
                        className="btn btn-ghost btn-sm"
                        disabled={!hasInput}
                        getState={() => ({ oldText, newText, viewMode, ignoreWhitespace, stripTrailingCr, ignoreNewlineAtEof, compareJson })}
                    />
                </div>
            </section>

            <div className="split-pane">
                <div className="card card-compact">
                    <Field
                        label="Original"
                        labelAction={<div style={{ display: 'flex', gap: 'var(--space-xs)' }}><PipelineRead onRead={setOldText} />{clearButton(oldText, setOldText, 'original')}</div>}
                    >
                        <textarea
                            value={oldText}
                            onChange={(e) => setOldText(e.target.value)}
                            placeholder="Paste the original text or code…"
                            spellCheck={false}
                            wrap="off"
                            style={{ minHeight: 220, fontSize: '0.85rem', tabSize: 4 }}
                        />
                    </Field>
                </div>
                <div className="card card-compact">
                    <Field
                        label="Changed"
                        labelAction={<div style={{ display: 'flex', gap: 'var(--space-xs)' }}><PipelineRead onRead={setNewText} />{clearButton(newText, setNewText, 'changed text')}</div>}
                    >
                        <textarea
                            value={newText}
                            onChange={(e) => setNewText(e.target.value)}
                            placeholder="Paste the changed version…"
                            spellCheck={false}
                            wrap="off"
                            style={{ minHeight: 220, fontSize: '0.85rem', tabSize: 4 }}
                        />
                    </Field>
                </div>
            </div>

            <section className="card" aria-label="Result" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                {hasInput ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }} aria-live="polite">
                                <h2 className="section-title">Differences</h2>
                                {hasChanges && (
                                    <>
                                        <span className="badge badge-success">+{diff.stats.added.toLocaleString()} added</span>
                                        <span className="badge badge-danger">−{diff.stats.removed.toLocaleString()} removed</span>
                                    </>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                <button type="button" className="btn btn-ghost btn-sm" disabled={!hasChanges} onClick={() => downloadText(buildPatch(), 'changes.patch', 'text/x-diff;charset=utf-8')}>
                                    <Download size={14} aria-hidden="true" /> Download .patch
                                </button>
                                <CopyButton text={buildPatch} label="Copy patch" variant="secondary" disabled={!hasChanges} />
                            </div>
                        </div>
                        {compareJson && (
                            <JsonStatus sides={{ old: oldJson, new: newJson }} ready={jsonReady} same={jsonSame} exact={oldText === newText} />
                        )}
                        {!jsonSame && <DiffViewer diff={diff} viewMode={viewMode} options={options} showHeader={false} title="Differences" />}
                    </>
                ) : (
                    <EmptyState title="Nothing to compare yet">Paste two versions of a text above to see what changed, line by line.</EmptyState>
                )}
            </section>
        </div>
    )
}
