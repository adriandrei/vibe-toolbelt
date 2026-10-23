import { useId, useState } from 'react'
import { AlignJustify, ArrowLeftRight, Download, Columns2, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import SegmentedControl from '../components/ui/SegmentedControl'
import { DiffViewer } from '../components/DiffViewer'
import { PipelineRead } from '../components/PipelineFeature'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { createDiffPatch, useLineDiff } from '../hooks/useLineDiff'
import { downloadText } from '../utils/download'
import { getTool } from '../config/tools'

const TOOL_NAME = getTool('/diff')?.title ?? 'Text Diff'
const AI_PATCH_LIMIT = 6000

const VIEWS = [
    { value: 'unified', label: 'Unified', icon: AlignJustify },
    { value: 'split', label: 'Side by side', icon: Columns2 },
]

function Option({ id, checked, onChange, children, hint }) {
    return (
        <label htmlFor={id} title={hint} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            {children}
        </label>
    )
}

export default function Diff() {
    const id = useId()
    const [oldText, setOldText] = useState('')
    const [newText, setNewText] = useState('')
    const [viewMode, setViewMode] = useState('unified')
    const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
    const [stripTrailingCr, setStripTrailingCr] = useState(true)
    const [ignoreNewlineAtEof, setIgnoreNewlineAtEof] = useState(true)

    const options = { ignoreWhitespace, stripTrailingCr, ignoreNewlineAtEof }
    // One diff for the counts, the viewer and the AI context
    const diff = useLineDiff(oldText, newText, options)
    const hasInput = Boolean(oldText || newText)
    const hasChanges = hasInput && !diff.timedOut && !diff.identical

    const buildPatch = () => createDiffPatch(oldText, newText, options)

    useRegisterAIContext({
        tool: TOOL_NAME,
        getContext: () => {
            if (!hasInput) return { input: 'Both texts are empty.', output: '' }
            const summary = `Comparing an original text (${diff.stats.removed + diff.stats.unchanged} lines) with a changed text (${diff.stats.added + diff.stats.unchanged} lines).`
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
                        <DiffViewer diff={diff} viewMode={viewMode} options={options} showHeader={false} title="Differences" />
                    </>
                ) : (
                    <EmptyState title="Nothing to compare yet">Paste two versions of a text above to see what changed, line by line.</EmptyState>
                )}
            </section>
        </div>
    )
}
