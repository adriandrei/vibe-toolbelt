import { useMemo, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import CopyButton from '../components/ui/CopyButton'
import SegmentedControl from '../components/ui/SegmentedControl'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { countCodePoints } from '../utils/textMetrics'

const SORT_TYPES = [
    { value: 'alpha', label: 'Text' },
    { value: 'numeric', label: 'Number' },
    { value: 'length', label: 'Length' },
]

const DIRECTION_LABELS = {
    alpha: { asc: 'A → Z', desc: 'Z → A' },
    numeric: { asc: '0 → 9', desc: '9 → 0' },
    length: { asc: 'Short → long', desc: 'Long → short' },
}

// First number in a line: "$1,299.99" -> 1299.99, "v3" -> 3, "item-5" -> 5,
// "-4 °C" -> -4. Lines without a number sort last.
const NUMBER_RE = /(?:(?<![\p{L}\p{N}.])[-+−])?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/u

function parseNumber(line) {
    const match = line.match(NUMBER_RE)
    if (!match) return NaN
    return Number(match[0].replace(/,/g, '').replace('−', '-'))
}

function processList(text, { trim, removeEmpty, dedupe, ignoreCase, natural, sortType, sortDir }) {
    const stats = { input: 0, blank: 0, duplicates: 0, noNumber: 0, result: 0 }
    if (!text) return { lines: [], stats }

    let lines = text.split(/\r\n|\r|\n/)
    // A trailing line break doesn't start another item
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    stats.input = lines.length

    if (trim) lines = lines.map(l => l.trim())
    if (removeEmpty) {
        const before = lines.length
        lines = lines.filter(l => l.trim() !== '')
        stats.blank = before - lines.length
    }

    // Duplicates use the same comparison as dedupe, so the count always
    // matches what "Remove duplicates" would remove
    const keyOf = ignoreCase ? (l) => l.toLocaleLowerCase() : (l) => l
    const seen = new Set()
    const kept = []
    for (const line of lines) {
        const key = keyOf(line)
        if (seen.has(key)) {
            stats.duplicates++
            if (!dedupe) kept.push(line)
        } else {
            seen.add(key)
            kept.push(line)
        }
    }
    lines = kept

    if (sortDir !== 'none') {
        const collator = new Intl.Collator(undefined, {
            numeric: natural,
            sensitivity: ignoreCase ? 'accent' : 'variant',
            caseFirst: ignoreCase ? 'false' : 'upper',
        })
        const dir = sortDir === 'desc' ? -1 : 1
        if (sortType === 'numeric') {
            const decorated = lines.map(line => ({ line, n: parseNumber(line) }))
            decorated.sort((a, b) => {
                const aNaN = Number.isNaN(a.n)
                const bNaN = Number.isNaN(b.n)
                // Lines without a number always go last, in A → Z order
                if (aNaN || bNaN) return aNaN && bNaN ? collator.compare(a.line, b.line) : aNaN ? 1 : -1
                return (a.n - b.n) * dir || collator.compare(a.line, b.line) * dir
            })
            stats.noNumber = decorated.filter(d => Number.isNaN(d.n)).length
            lines = decorated.map(d => d.line)
        } else if (sortType === 'length') {
            const decorated = lines.map(line => ({ line, len: countCodePoints(line) }))
            decorated.sort((a, b) => (a.len - b.len) * dir || collator.compare(a.line, b.line))
            lines = decorated.map(d => d.line)
        } else {
            lines = [...lines].sort((a, b) => collator.compare(a, b) * dir)
        }
    }

    stats.result = lines.length
    return { lines, stats }
}

function ToggleChip({ pressed, onChange, children, title }) {
    return (
        <button type="button" className={`chip ${pressed ? 'is-active' : ''}`} aria-pressed={pressed} onClick={() => onChange(!pressed)} title={title}>
            {pressed && <Check size={12} aria-hidden="true" />}
            {children}
        </button>
    )
}

function Stat({ label, value, tone }) {
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: tone ? `var(--${tone})` : 'var(--text-main)' }}>{value.toLocaleString()}</div>
        </div>
    )
}

export default function ListSorter() {
    const [input, setInput] = useState('')
    const [sortType, setSortType] = useState('alpha')
    const [sortDir, setSortDir] = useState('asc')
    const [trim, setTrim] = useState(true)
    const [removeEmpty, setRemoveEmpty] = useState(true)
    const [dedupe, setDedupe] = useState(false)
    const [ignoreCase, setIgnoreCase] = useState(false)
    const [natural, setNatural] = useState(true)

    const source = useDebouncedValue(input, input.length > 200000 ? 250 : 0)
    const { lines, stats } = useMemo(
        () => processList(source, { trim, removeEmpty, dedupe, ignoreCase, natural, sortType, sortDir }),
        [source, trim, removeEmpty, dedupe, ignoreCase, natural, sortType, sortDir]
    )
    const output = useMemo(() => lines.join('\n'), [lines])

    const labels = DIRECTION_LABELS[sortType]
    const directions = [
        { value: 'asc', label: labels.asc },
        { value: 'desc', label: labels.desc },
        { value: 'none', label: 'Original order' },
    ]

    return (
        <div className="page page-wide">
            <ToolHeader />

            <section className="card" aria-label="Options" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                    <div style={{ minWidth: 0 }}>
                        <span className="field-label" aria-hidden="true">Sort by</span>
                        <SegmentedControl ariaLabel="Sort by" options={SORT_TYPES} value={sortType} onChange={setSortType} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <span className="field-label" aria-hidden="true">Order</span>
                        <SegmentedControl ariaLabel="Order" options={directions} value={sortDir} onChange={setSortDir} />
                    </div>
                </div>
                <div role="group" aria-label="Clean-up options" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                    <ToggleChip pressed={trim} onChange={setTrim} title="Remove spaces at the start and end of each line">Trim whitespace</ToggleChip>
                    <ToggleChip pressed={removeEmpty} onChange={setRemoveEmpty} title="Drop lines that are empty or only whitespace">Remove blank lines</ToggleChip>
                    <ToggleChip pressed={dedupe} onChange={setDedupe} title="Keep only the first of identical lines">Remove duplicates</ToggleChip>
                    <ToggleChip pressed={ignoreCase} onChange={setIgnoreCase} title="Treat “Apple” and “apple” as the same when sorting and removing duplicates">Ignore case</ToggleChip>
                    {sortType === 'alpha' && (
                        <ToggleChip pressed={natural} onChange={setNatural} title="Compare numbers inside text by value: item2 before item10">Natural numbers</ToggleChip>
                    )}
                </div>
                {sortType === 'numeric' && (
                    <p className="field-hint" style={{ margin: 0 }}>
                        Sorts by the first number in each line ($1,299.99 → 1299.99). Lines without a number go last.
                    </p>
                )}
            </section>

            <div className="split-pane">
                <section className="card">
                    <Field
                        label="List"
                        hint="One item per line."
                        labelAction={
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <PipelineRead onRead={setInput} />
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input}>
                                    <Trash2 size={14} aria-hidden="true" /> Clear
                                </button>
                            </div>
                        }
                    >
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={'banana\nApple\ncherry\napple\nitem10\nitem2'}
                            spellCheck={false}
                            style={{ minHeight: 340 }}
                        />
                    </Field>
                </section>

                <section className="card">
                    <Field
                        label="Result"
                        hint={stats.result ? `${stats.result.toLocaleString()} ${stats.result === 1 ? 'line' : 'lines'}` : 'The sorted list appears here.'}
                        labelAction={
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <PipelineSend dataToSend={output} />
                                <CopyButton text={output} variant="secondary" />
                            </div>
                        }
                    >
                        <textarea
                            readOnly
                            value={output}
                            spellCheck={false}
                            style={{ minHeight: 340, background: 'var(--bg-inset)', color: 'var(--text-code)' }}
                        />
                    </Field>
                </section>
            </div>

            {stats.input > 0 && (
                <section className="card card-compact" aria-label="Summary" aria-live="polite">
                    <div style={{ display: 'flex', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
                        <Stat label="Input lines" value={stats.input} />
                        {removeEmpty && <Stat label="Blank removed" value={stats.blank} />}
                        <Stat label={dedupe ? 'Duplicates removed' : 'Duplicates found'} value={stats.duplicates} tone={stats.duplicates ? 'warning' : null} />
                        {sortType === 'numeric' && sortDir !== 'none' && <Stat label="Without a number" value={stats.noNumber} />}
                        <Stat label="Result lines" value={stats.result} tone="primary-text" />
                    </div>
                </section>
            )}
        </div>
    )
}
