import { useMemo, useState } from 'react'
import { ChevronsUpDown, FileDiff, Loader2 } from 'lucide-react'
import StatusBanner from './ui/StatusBanner'
import { usePane } from '../contexts/pane'
import { DEFAULT_DIFF_OPTIONS, DIFF_TIMEOUT_MS, buildDiffRows, useLineDiff } from '../hooks/useLineDiff'

const RENDER_STEP = 1500
const NO_KEYS = []

const SIGN = { add: '+', del: '−', same: ' ' }
const SPOKEN = { add: 'Added: ', del: 'Removed: ', same: '' }
const ROW_BG = { add: 'var(--success-bg)', del: 'var(--danger-bg)', same: 'transparent' }
const MARK_BG = {
    add: 'color-mix(in srgb, var(--success) 30%, transparent)',
    del: 'color-mix(in srgb, var(--danger) 30%, transparent)',
}

const codeStyle = {
    margin: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: '0.82rem',
    lineHeight: 1.55,
    tabSize: 4,
    MozTabSize: 4,
    fontVariantLigatures: 'none', // show "=>" and "!=" exactly as typed
    color: 'var(--text-code)',
    background: 'transparent',
    minWidth: 0,
}
const gutterStyle = {
    color: 'var(--text-dim)',
    textAlign: 'right',
    paddingRight: '0.6ch',
    userSelect: 'none',
    fontVariantNumeric: 'tabular-nums',
}
const contentStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0, paddingRight: '0.75ch' }
const markerStyle = { color: 'var(--text-dim)', fontStyle: 'italic', userSelect: 'none' }

function signStyle(type) {
    return { color: type === 'add' ? 'var(--success)' : type === 'del' ? 'var(--danger)' : 'transparent', userSelect: 'none', fontWeight: 700, textAlign: 'center' }
}

function LineContent({ type, line, segments }) {
    return (
        <span style={contentStyle}>
            {type !== 'same' && <span className="sr-only">{SPOKEN[type]}</span>}
            {segments
                ? segments.map((s, i) => (s.changed
                    ? <mark key={i} style={{ background: MARK_BG[type], color: 'inherit', borderRadius: 2 }}>{s.text}</mark>
                    : <span key={i}>{s.text}</span>))
                : line.text}
            {line.crlf && <span style={markerStyle} title="Windows line ending (CRLF)"> ␍ CRLF</span>}
            {line.noEol && <span style={markerStyle} title="The text ends here without a line break"> ⏎ no newline at end</span>}
        </span>
    )
}

function UnifiedLine({ row, gutter }) {
    return (
        <span style={{ display: 'grid', gridTemplateColumns: `${gutter} ${gutter} 1.8ch minmax(0, 1fr)`, background: ROW_BG[row.type] }}>
            <span style={gutterStyle}>{row.oldNo ?? ''}</span>
            <span style={gutterStyle}>{row.newNo ?? ''}</span>
            <span style={signStyle(row.type)} aria-hidden="true">{SIGN[row.type]}</span>
            <LineContent type={row.type} line={row.line} segments={row.segments} />
        </span>
    )
}

function Cell({ cell, gutter, divider }) {
    const border = divider ? { borderRight: '1px solid var(--border)' } : null
    if (!cell) return <span aria-hidden="true" style={{ background: 'var(--bg-subtle)', minHeight: '1.55em', ...border }} />
    return (
        <span style={{ display: 'grid', gridTemplateColumns: `${gutter} 1.8ch minmax(0, 1fr)`, background: ROW_BG[cell.type], minWidth: 0, ...border }}>
            <span style={gutterStyle}>{cell.no}</span>
            <span style={signStyle(cell.type)} aria-hidden="true">{SIGN[cell.type]}</span>
            <LineContent type={cell.type} line={cell.line} segments={cell.segments} />
        </span>
    )
}

function FoldRow({ row, onExpand }) {
    return (
        <button
            type="button"
            onClick={() => onExpand(row.key)}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                padding: '0.2rem 0.75rem',
                background: 'var(--bg-subtle)',
                borderTop: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-family)',
                fontSize: '0.78rem',
                textAlign: 'left',
            }}
        >
            <ChevronsUpDown size={13} aria-hidden="true" />
            Show {row.count.toLocaleString()} unchanged {row.count === 1 ? 'line' : 'lines'}
            <span style={{ color: 'var(--text-dim)' }}>({row.oldStart === row.newStart ? `line ${row.oldStart}` : `lines ${row.oldStart} / ${row.newStart}`}…)</span>
        </button>
    )
}

/**
 * Line-by-line comparison of two texts.
 *
 *   <DiffViewer oldText={a} newText={b} viewMode="split" />
 *   <DiffViewer diff={useLineDiff(a, b, options)} viewMode="unified" showHeader={false} />
 *
 * viewMode: 'unified' | 'split'. In a narrow pane the split view stacks each
 * removed line above its replacement. Pass a `diff` from useLineDiff to reuse
 * a diff the page already computed; otherwise it's computed here with
 * `options` (default: ignore CRLF/LF and a missing final newline).
 */
export function DiffViewer({
    oldText = '',
    newText = '',
    viewMode = 'unified',
    diff,
    options,
    oldLabel = 'Original',
    newLabel = 'Changed',
    title = 'Comparison result',
    showHeader = true,
    maxHeight,
    contextLines = 3,
    fold = true,
    className = '',
    style,
}) {
    const { size } = usePane()
    const opts = { ...DEFAULT_DIFF_OPTIONS, ...options }
    const own = useLineDiff(oldText, newText, { ...opts, enabled: !diff })
    const result = diff ?? own
    const layout = viewMode === 'split' ? (size === 'sm' ? 'stacked' : 'columns') : 'unified'

    // Expanded folds and the render limit reset whenever the diff changes
    const [expanded, setExpanded] = useState({ lines: null, keys: NO_KEYS })
    const [shown, setShown] = useState({ lines: null, count: RENDER_STEP })
    const keys = expanded.lines === result.lines ? expanded.keys : NO_KEYS
    const limit = shown.lines === result.lines ? shown.count : RENDER_STEP

    const rows = useMemo(
        () => buildDiffRows(result.lines, layout, { context: contextLines, fold, expanded: keys }),
        [result.lines, layout, contextLines, fold, keys]
    )

    if (result.empty) return null

    const { added, removed, unchanged } = result.stats
    const digits = String(Math.max(removed + unchanged, added + unchanged, 1)).length
    const gutter = `${digits + 1}ch`
    const visible = rows.length > limit ? rows.slice(0, limit) : rows
    const expand = (key) => setExpanded({ lines: result.lines, keys: [...keys, key] })

    let body
    if (layout === 'columns') {
        body = (
            <div style={codeStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-family)', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    <span style={{ padding: '0.35rem 0.75rem', borderRight: '1px solid var(--border)' }}>{oldLabel}</span>
                    <span style={{ padding: '0.35rem 0.75rem' }}>{newLabel}</span>
                </div>
                {visible.map(row => (row.kind === 'fold'
                    ? <FoldRow key={row.key} row={row} onExpand={expand} />
                    : (
                        <div key={row.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                            <Cell cell={row.left} gutter={gutter} divider />
                            <Cell cell={row.right} gutter={gutter} />
                        </div>
                    )))}
            </div>
        )
    } else {
        body = (
            <pre style={codeStyle}>
                {visible.map(row => (row.kind === 'fold'
                    ? <FoldRow key={row.key} row={row} onExpand={expand} />
                    : <UnifiedLine key={row.key} row={row} gutter={gutter} />))}
            </pre>
        )
    }

    const optionNotes = [
        opts.ignoreWhitespace && 'whitespace at line ends',
        opts.stripTrailingCr && 'CRLF vs LF',
        opts.ignoreNewlineAtEof && 'a missing final newline',
    ].filter(Boolean)

    return (
        <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0, maxHeight: maxHeight ?? '100%', ...style }}>
            {showHeader && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <span className="section-title"><FileDiff size={18} aria-hidden="true" style={{ color: 'var(--primary-text)' }} /> {title}</span>
                    {!result.timedOut && !result.identical && (
                        <span style={{ display: 'inline-flex', gap: 'var(--space-xs)' }}>
                            <span className="badge badge-success">+{added.toLocaleString()}</span>
                            <span className="badge badge-danger">−{removed.toLocaleString()}</span>
                        </span>
                    )}
                    {result.pending && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                            <Loader2 size={12} className="spin" aria-hidden="true" /> Updating…
                        </span>
                    )}
                </div>
            )}

            {result.timedOut ? (
                <StatusBanner tone="warning" title="Too large to compare quickly">
                    The comparison was stopped after {DIFF_TIMEOUT_MS / 1000} seconds. Try smaller inputs, or texts that are more alike.
                </StatusBanner>
            ) : result.identical ? (
                <StatusBanner tone="success" title="No differences">
                    {result.exact
                        ? 'The two texts are identical.'
                        : `The texts only differ in ignored details (${optionNotes.join(', ') || 'line endings'}).`}
                </StatusBanner>
            ) : null}

            {!result.timedOut && rows.length > 0 && (
                <div
                    role="region"
                    aria-label={`${title}: ${added} lines added, ${removed} removed`}
                    tabIndex={0}
                    style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-inset)' }}
                >
                    {body}
                    {rows.length > limit && (
                        <div style={{ padding: 'var(--space-sm)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShown({ lines: result.lines, count: limit + RENDER_STEP })}>
                                Show {Math.min(RENDER_STEP, rows.length - limit).toLocaleString()} more of {(rows.length - limit).toLocaleString()} remaining rows
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default DiffViewer
