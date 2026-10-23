import { useMemo } from 'react'
import { createTwoFilesPatch, diffLines, diffWordsWithSpace } from 'diff'
import { useDebouncedValue } from './useDebouncedValue'

/**
 * Line diff shared by the Text Diff page and <DiffViewer>.
 *
 *   const result = useLineDiff(oldText, newText, { ignoreWhitespace, ignoreNewlineAtEof, stripTrailingCr })
 *   <DiffViewer diff={result} viewMode="split" />
 *
 * Runs diffLines once per input change (debounced for large inputs, stopped
 * after `timeout` ms) and returns:
 *   lines     one entry per line: { type: 'same' | 'add' | 'del', oldNo, newNo, oldLine, newLine }
 *             where oldLine/newLine are { text, eol, noEol?, crlf? }; noEol/crlf
 *             flag a changed line whose only difference is its line ending
 *   stats     { added, removed, unchanged } in lines
 *   identical no differences under the current options
 *   timedOut  the diff took too long and was abandoned (lines is empty)
 *   pending   the inputs changed and the debounced diff hasn't caught up yet
 */

export const DEFAULT_DIFF_OPTIONS = { ignoreWhitespace: false, ignoreNewlineAtEof: true, stripTrailingCr: true }
export const DIFF_TIMEOUT_MS = 2000

const EMPTY_STATS = { added: 0, removed: 0, unchanged: 0 }

// Same line splitting as diff's tokenizer: \n and \r\n end a line, and a
// final line break doesn't start another line.
function splitLines(text) {
    if (!text) return []
    const out = []
    const re = /\r?\n/g
    let start = 0
    let m
    while ((m = re.exec(text)) !== null) {
        out.push({ text: text.slice(start, m.index), eol: m[0] })
        start = m.index + m[0].length
    }
    if (start < text.length) out.push({ text: text.slice(start), eol: '' })
    return out
}

export function computeLineDiff(oldText = '', newText = '', options = {}) {
    const { ignoreWhitespace = false, ignoreNewlineAtEof = false, stripTrailingCr = false, timeout = DIFF_TIMEOUT_MS } = options
    const base = { lines: [], stats: EMPTY_STATS, identical: true, exact: oldText === newText, empty: !oldText && !newText, timedOut: false }
    if (base.empty) return base

    const parts = diffLines(oldText, newText, { ignoreWhitespace, ignoreNewlineAtEof, stripTrailingCr, timeout })
    if (!parts) return { ...base, identical: false, timedOut: true }

    const oldLines = splitLines(oldText)
    const newLines = splitLines(newText)

    const lines = []
    const stats = { added: 0, removed: 0, unchanged: 0 }
    let o = 0
    let n = 0
    for (const part of parts) {
        const count = part.count ?? splitLines(part.value).length
        for (let i = 0; i < count; i++) {
            if (part.added) {
                lines.push({ type: 'add', newNo: n + 1, newLine: newLines[n++] ?? { text: '', eol: '' } })
            } else if (part.removed) {
                lines.push({ type: 'del', oldNo: o + 1, oldLine: oldLines[o++] ?? { text: '', eol: '' } })
            } else {
                lines.push({
                    type: 'same',
                    oldNo: o + 1,
                    newNo: n + 1,
                    oldLine: oldLines[o++] ?? { text: '', eol: '' },
                    newLine: newLines[n++] ?? { text: '', eol: '' },
                })
            }
        }
        if (part.added) stats.added += count
        else if (part.removed) stats.removed += count
        else stats.unchanged += count
    }

    markLineEndings(lines)
    return { ...base, lines, stats, identical: stats.added === 0 && stats.removed === 0 }
}

// A removed and an added line with the same text differ only in their line
// ending (CRLF vs LF, or a missing newline at the end of the text). Flag
// them, or the two rows would look identical.
function markLineEndings(lines) {
    let i = 0
    while (i < lines.length) {
        if (lines[i].type === 'same') {
            i++
            continue
        }
        const dels = new Map()
        const adds = []
        for (; i < lines.length && lines[i].type !== 'same'; i++) {
            if (lines[i].type === 'del') dels.set(lines[i].oldLine.text, lines[i])
            else adds.push(lines[i])
        }
        for (const add of adds) {
            const del = dels.get(add.newLine.text)
            if (!del || del.oldLine.eol === add.newLine.eol) continue
            const flag = (line, other) => ({ ...line, noEol: line.eol === '' && other.eol !== '', crlf: line.eol === '\r\n' && other.eol === '\n' })
            del.oldLine = flag(del.oldLine, add.newLine)
            add.newLine = flag(add.newLine, del.oldLine)
        }
    }
}

function debounceFor(size) {
    if (size > 400_000) return 400
    if (size > 40_000) return 150
    return 0
}

export function useLineDiff(oldText = '', newText = '', options = {}) {
    const { ignoreWhitespace = false, ignoreNewlineAtEof = false, stripTrailingCr = false, timeout = DIFF_TIMEOUT_MS, enabled = true } = options
    const pair = useMemo(() => ({ oldText: oldText ?? '', newText: newText ?? '' }), [oldText, newText])
    const delay = enabled ? debounceFor(pair.oldText.length + pair.newText.length) : 0
    const debounced = useDebouncedValue(pair, delay)
    const source = delay === 0 ? pair : debounced

    const result = useMemo(() => {
        if (!enabled) return computeLineDiff('', '')
        return computeLineDiff(source.oldText, source.newText, { ignoreWhitespace, ignoreNewlineAtEof, stripTrailingCr, timeout })
    }, [enabled, source, ignoreWhitespace, ignoreNewlineAtEof, stripTrailingCr, timeout])

    return useMemo(() => ({ ...result, source, pending: source !== pair }), [result, source, pair])
}

/** A unified patch (`git apply`-style headers) of the same comparison. */
export function createDiffPatch(oldText, newText, options = {}, { oldName = 'a/original', newName = 'b/modified', context = 3 } = {}) {
    const { ignoreWhitespace = false, ignoreNewlineAtEof = false, stripTrailingCr = false } = options
    return createTwoFilesPatch(oldName, newName, oldText ?? '', newText ?? '', undefined, undefined, {
        context,
        ignoreWhitespace,
        ignoreNewlineAtEof,
        stripTrailingCr,
        timeout: DIFF_TIMEOUT_MS * 2,
    }) ?? ''
}

// ---------- Display rows ----------

const INLINE_MAX_LINE = 400
const INLINE_MAX_PAIRS = 800

// Word-level highlights for a modified line pair, or null when the lines
// share too little for highlighting to help.
function inlineDiff(oldText, newText) {
    if (oldText.length > INLINE_MAX_LINE || newText.length > INLINE_MAX_LINE) return null
    const parts = diffWordsWithSpace(oldText, newText)
    let common = 0
    for (const p of parts) if (!p.added && !p.removed) common += p.value.length
    if (common < Math.max(oldText.length, newText.length) * 0.3) return null
    return {
        old: parts.filter(p => !p.added).map(p => ({ text: p.value, changed: !!p.removed })),
        new: parts.filter(p => !p.removed).map(p => ({ text: p.value, changed: !!p.added })),
    }
}

/**
 * Turns the line list into rows for one layout:
 *   unified  removed lines, then added lines, per change
 *   columns  side by side, the n-th removed line paired with the n-th added one
 *   stacked  like columns but one column: each removed line right above its replacement
 * Long runs of unchanged lines fold into { kind: 'fold' } rows unless their
 * key is in `expanded`.
 */
export function buildDiffRows(lines, layout, { context = 3, fold = true, expanded = [] } = {}) {
    const rows = []
    let pairs = 0

    const sameRow = (op) => (layout === 'columns'
        ? { kind: 'pair', key: `s${op.oldNo}-${op.newNo}`, left: { type: 'same', no: op.oldNo, line: op.oldLine }, right: { type: 'same', no: op.newNo, line: op.newLine } }
        : { kind: 'line', key: `s${op.oldNo}-${op.newNo}`, type: 'same', oldNo: op.oldNo, newNo: op.newNo, line: op.newLine })

    const pushContext = (block, isFirst, isLast) => {
        const head = isFirst ? 0 : context
        const tail = isLast ? 0 : context
        const key = `f${block[0].oldNo}-${block[0].newNo}`
        const hidden = block.length - head - tail
        if (!fold || hidden < 4 || expanded.includes(key)) {
            for (const op of block) rows.push(sameRow(op))
            return
        }
        for (const op of block.slice(0, head)) rows.push(sameRow(op))
        const first = block[head]
        rows.push({ kind: 'fold', key, count: hidden, oldStart: first.oldNo, newStart: first.newNo })
        for (const op of block.slice(block.length - tail)) rows.push(sameRow(op))
    }

    const pushChange = (dels, adds) => {
        const count = Math.max(dels.length, adds.length)
        const inline = []
        for (let i = 0; i < Math.min(dels.length, adds.length); i++) {
            inline[i] = pairs++ < INLINE_MAX_PAIRS ? inlineDiff(dels[i].oldLine.text, adds[i].newLine.text) : null
        }
        const del = (op, i) => ({ kind: 'line', key: `d${op.oldNo}`, type: 'del', oldNo: op.oldNo, line: op.oldLine, segments: inline[i]?.old })
        const add = (op, i) => ({ kind: 'line', key: `a${op.newNo}`, type: 'add', newNo: op.newNo, line: op.newLine, segments: inline[i]?.new })
        if (layout === 'unified') {
            dels.forEach((op, i) => rows.push(del(op, i)))
            adds.forEach((op, i) => rows.push(add(op, i)))
        } else if (layout === 'stacked') {
            for (let i = 0; i < count; i++) {
                if (dels[i]) rows.push(del(dels[i], i))
                if (adds[i]) rows.push(add(adds[i], i))
            }
        } else {
            for (let i = 0; i < count; i++) {
                const d = dels[i]
                const a = adds[i]
                rows.push({
                    kind: 'pair',
                    key: `p${d ? d.oldNo : ''}-${a ? a.newNo : ''}`,
                    left: d ? { type: 'del', no: d.oldNo, line: d.oldLine, segments: inline[i]?.old } : null,
                    right: a ? { type: 'add', no: a.newNo, line: a.newLine, segments: inline[i]?.new } : null,
                })
            }
        }
    }

    let i = 0
    while (i < lines.length) {
        if (lines[i].type === 'same') {
            const start = i
            while (i < lines.length && lines[i].type === 'same') i++
            pushContext(lines.slice(start, i), start === 0, i === lines.length)
        } else {
            const dels = []
            const adds = []
            while (i < lines.length && lines[i].type !== 'same') {
                if (lines[i].type === 'del') dels.push(lines[i])
                else adds.push(lines[i])
                i++
            }
            pushChange(dels, adds)
        }
    }
    return rows
}
