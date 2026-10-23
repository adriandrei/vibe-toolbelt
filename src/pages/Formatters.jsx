import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { format as formatSql } from 'sql-formatter'
import jmespath from 'jmespath'
import { AlignLeft, Braces, Code, Database, Download, FileCode, FileOutput, Minimize2, Sparkles, Trash2, Wand2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import CopyButton from '../components/ui/CopyButton'
import StatusBanner from '../components/ui/StatusBanner'
import Field from '../components/ui/Field'
import CodeEditor, { CodeDiffEditor } from '../components/CodeEditor'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { usePane } from '../contexts/pane'
import { formatXml, minifyXml } from '../utils/xml'
import { downloadText, formatBytes } from '../utils/download'
import { isMacPlatform } from '../utils/palette'

const MODES = [
    { value: 'json', label: 'JSON', icon: Braces },
    { value: 'sql', label: 'SQL', icon: Database },
    { value: 'xml', label: 'XML', icon: Code },
]
const MODE_IDS = MODES.map(m => m.value)

const ACTIONS = [
    { value: 'pretty', label: 'Prettify', icon: AlignLeft, title: 'Prettify (indented)' },
    { value: 'minify', label: 'Minify', icon: Minimize2, title: 'Minify (0 spaces)' },
]

const INDENTS = [
    { value: '2', label: '2 spaces' },
    { value: '4', label: '4 spaces' },
    { value: 'tab', label: 'Tabs' },
]

const SQL_DIALECTS = [
    { value: 'sql', label: 'Standard SQL' },
    { value: 'postgresql', label: 'PostgreSQL' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'mariadb', label: 'MariaDB' },
    { value: 'sqlite', label: 'SQLite' },
    { value: 'transactsql', label: 'SQL Server (T-SQL)' },
    { value: 'plsql', label: 'Oracle PL/SQL' },
    { value: 'bigquery', label: 'BigQuery' },
    { value: 'snowflake', label: 'Snowflake' },
    { value: 'redshift', label: 'Redshift' },
    { value: 'duckdb', label: 'DuckDB' },
    { value: 'clickhouse', label: 'ClickHouse' },
    { value: 'trino', label: 'Trino / Presto' },
    { value: 'spark', label: 'Spark SQL' },
    { value: 'hive', label: 'Hive' },
    { value: 'db2', label: 'Db2' },
    { value: 'singlestoredb', label: 'SingleStore' },
    { value: 'tidb', label: 'TiDB' },
]
const dialectLabel = (value) => SQL_DIALECTS.find(d => d.value === value)?.label ?? value

const KEYWORD_CASES = [
    { value: 'upper', label: 'UPPER' },
    { value: 'lower', label: 'lower' },
    { value: 'preserve', label: 'As written' },
]

const SAMPLES = {
    json: '{"name":"Vibe Toolbelt","version":2,"tags":["dev","tools"],"owner":{"name":"Ada","active":true},"items":[{"id":1,"price":9.5},{"id":2,"price":12}]}',
    sql: "select u.id, u.name, count(o.id) as orders from users u left join orders o on o.user_id = u.id where u.active = true and u.created_at > '2024-01-01' group by u.id, u.name having count(o.id) > 3 order by orders desc limit 10;",
    xml: '<?xml version="1.0" encoding="UTF-8"?><catalog><book id="bk101"><author>Gambardella, Matthew</author><title>XML Developer\'s Guide</title><price currency="USD">44.95</price></book><book id="bk102"><author>Ralls, Kim</author><title>Midnight Rain</title><price currency="USD">5.95</price></book></catalog>',
}

const FILE_TYPES = {
    json: { ext: 'json', mime: 'application/json' },
    sql: { ext: 'sql', mime: 'application/sql' },
    xml: { ext: 'xml', mime: 'application/xml' },
}

// Live formatting is paused above these sizes; the Format button still works.
const LIVE_LIMIT = { json: 2_000_000, xml: 1_000_000, sql: 150_000 }
const DIFF_LIMIT = 400_000

const DEFAULT_PREFS = { indent: '2', dialect: 'sql', keywordCase: 'upper', live: true }

// ---------------------------------------------------------------- helpers

function lineColumn(text, position) {
    let line = 1
    let last = -1
    for (let i = 0; i < position && i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
            line++
            last = i
        }
    }
    return { line, column: position - last }
}

const indentString = (indent) => (indent === 'tab' ? '\t' : ' '.repeat(Number(indent) || 2))

// Normalises a decimal literal to "<sign><significant digits>e<exponent>".
function decimalKey(literal) {
    let s = literal.toLowerCase()
    let sign = ''
    if (s[0] === '-') {
        sign = '-'
        s = s.slice(1)
    }
    const [mantissa, exp = '0'] = s.split('e')
    const [int, frac = ''] = mantissa.split('.')
    const all = int + frac
    const stripped = all.replace(/^0+/, '')
    const digits = stripped.replace(/0+$/, '')
    if (!digits) return `${sign}0`
    return `${sign}${digits}e${Number(exp) + int.length - (all.length - stripped.length)}`
}

const ARRAY_INDEX = /^(0|[1-9]\d{0,9})$/

/**
 * Scans valid JSON text for things JavaScript silently changes on a round trip:
 * numbers that lose precision (or are just rewritten, like 1.0 → 1), duplicate
 * keys (the last one wins) and integer-like keys (moved to the front).
 */
function inspectJsonText(text) {
    const lossy = []
    const rewritten = []
    const duplicates = []
    let reordered = false
    const stack = []
    const re = /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\]]/g
    let m
    while ((m = re.exec(text))) {
        const tok = m[0]
        const c = tok[0]
        if (c === '{') {
            stack.push({ keys: new Set(), order: [] })
        } else if (c === '[') {
            stack.push(null)
        } else if (c === '}' || c === ']') {
            const frame = stack.pop()
            if (frame && !reordered && frame.order.some(k => ARRAY_INDEX.test(k) && Number(k) < 4294967295)) {
                const actual = Object.keys(Object.fromEntries(frame.order.map(k => [k, 0])))
                reordered = actual.some((k, i) => k !== frame.order[i])
            }
        } else if (c === '"') {
            const frame = stack[stack.length - 1]
            if (!frame) continue
            let j = re.lastIndex
            while (j < text.length && /\s/.test(text[j])) j++
            if (text[j] !== ':') continue
            let key
            try {
                key = JSON.parse(tok)
            } catch {
                continue
            }
            if (frame.keys.has(key)) {
                if (duplicates.length < 5 && !duplicates.includes(key)) duplicates.push(key)
            } else {
                frame.keys.add(key)
                frame.order.push(key)
            }
        } else {
            const value = Number(tok)
            const result = Number.isFinite(value) ? JSON.stringify(value) : 'null'
            if (result === tok) continue
            const entry = { source: tok, result }
            if (result === 'null' || decimalKey(tok) !== decimalKey(result)) lossy.push(entry)
            else rewritten.push(entry)
        }
    }
    return { lossy, rewritten, duplicates, reordered }
}

function describeNumberChanges(list) {
    const shown = list.slice(0, 3).map(n => `${n.source} → ${n.result}`).join(', ')
    return list.length > 3 ? `${shown} and ${list.length - 3} more` : shown
}

function jsonNotices(text) {
    const { lossy, rewritten, duplicates, reordered } = inspectJsonText(text)
    const notices = []
    if (lossy.length) {
        notices.push({
            tone: 'warning',
            title: `${lossy.length} number${lossy.length > 1 ? 's' : ''} can't be represented exactly`,
            body: `JavaScript numbers are 64-bit floats, so these values change: ${describeNumberChanges(lossy)}. Keep them as strings if precision matters.`,
        })
    }
    if (rewritten.length) {
        notices.push({
            tone: 'info',
            title: `${rewritten.length} number${rewritten.length > 1 ? 's are' : ' is'} written differently`,
            body: `Same value, normalised form: ${describeNumberChanges(rewritten)}.`,
        })
    }
    if (duplicates.length) {
        notices.push({
            tone: 'warning',
            title: 'Duplicate keys',
            body: `Only the last value is kept for: ${duplicates.map(k => JSON.stringify(k)).join(', ')}.`,
        })
    }
    if (reordered) {
        notices.push({
            tone: 'info',
            title: 'Key order changed',
            body: 'Integer-like keys (such as "1" or "42") always come first in JavaScript objects, so they were moved ahead of the other keys.',
        })
    }
    return notices
}

function guessMode(text) {
    const t = text.trimStart()
    if (/^[[{]/.test(t)) return 'json'
    if (t.startsWith('<')) return 'xml'
    if (/^(select|insert|update|delete|with|create|alter|drop|merge|explain)\b/i.test(t)) return 'sql'
    return null
}

function jsonError(text, error) {
    let message = String(error.message || error)
    let location = null
    const lc = message.match(/line (\d+) column (\d+)/)
    if (lc) {
        location = { line: Number(lc[1]), column: Number(lc[2]) }
    } else {
        const pos = message.match(/at position (\d+)/)
        if (pos) {
            location = lineColumn(text, Number(pos[1]))
            message += ` (line ${location.line}, column ${location.column})`
        }
    }
    let hint = null
    let action = null
    const guessed = guessMode(text)
    if (guessed && guessed !== 'json') {
        hint = `This looks like ${guessed.toUpperCase()}.`
        action = { label: `Format as ${guessed.toUpperCase()}`, mode: guessed }
    } else if (/^\s*\/\/|\/\*[\s\S]*?\*\//m.test(text)) {
        hint = 'JSON doesn’t allow comments. Remove the // or /* */ comments.'
    } else if (/,\s*[}\]]/.test(text)) {
        hint = 'JSON doesn’t allow trailing commas after the last item.'
    } else if (/[{,]\s*'[^']*'\s*:|:\s*'[^']*'/.test(text)) {
        hint = 'JSON strings and keys need double quotes, not single quotes.'
    } else if (/[{,]\s*[A-Za-z_$][\w$]*\s*:/.test(text)) {
        hint = 'Object keys must be in double quotes, e.g. {"key": 1}.'
    }
    return { title: 'Invalid JSON', message, location, hint, action }
}

const JMESPATH_FUNCTIONS = 'abs, avg, ceil, contains, ends_with, floor, join, keys, length, map, max, max_by, merge, min, min_by, not_null, reverse, sort, sort_by, starts_with, sum, to_array, to_number, to_string, type, values'

function jmespathError(query, error) {
    const raw = String(error?.message || error)
    let hint = 'See jmespath.org for the syntax. Quote keys with special characters ("first-name") and wrap literals in backticks (`20`).'
    if (/^\s*\./.test(query)) {
        hint = 'JMESPath paths don’t start with "." (that’s jq syntax). Write foo.bar, or @ for the whole document.'
    } else if (/(^|[.[\s|,(])[A-Za-z_]\w*-[\w-]/.test(query.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""'))) {
        hint = 'Keys with dashes, spaces or other special characters must be double-quoted, e.g. "first-name" or people[*]."last name".'
    } else if (/Number/.test(raw)) {
        hint = 'Number literals need backticks: [?age > `20`]. Array indexes are fine as is: items[0].'
    } else if (/Unknown function/.test(raw)) {
        hint = `Available functions: ${JMESPATH_FUNCTIONS}.`
    } else if (/EOF/.test(raw)) {
        hint = 'The expression looks incomplete — check for an unclosed bracket, quote or filter.'
    }
    return { title: 'Invalid JMESPath query', message: raw, hint }
}

const SQL_HINTS = [
    { value: 'postgresql', test: /->>?|#>>?|::\s*[a-z]|\$\d+\b|\bilike\b|\breturning\b|\bjsonb\b/i },
    { value: 'mysql', test: /`[^`\n]+`/ },
    { value: 'transactsql', test: /\[[A-Za-z_][\w ]*\]|\btop\s*\(?\s*\d+|^\s*go\s*$/im },
]

function detectSqlDialect(text) {
    for (const hint of SQL_HINTS) {
        const m = text.match(hint.test)
        if (m) return { value: hint.value, label: dialectLabel(hint.value), sample: m[0].trim() }
    }
    return null
}

function sqlError(text, error, dialect) {
    const raw = String(error?.message || error)
    const first = raw.split('\n')[0].replace(/\s+/g, ' ').trim()
    const message = first.length > 300 ? `${first.slice(0, 300)}…` : first
    const lc = raw.match(/line (\d+) column (\d+)/)
    const location = lc ? { line: Number(lc[1]), column: Number(lc[2]) } : null
    const suggestion = detectSqlDialect(text)
    if (dialect === 'sql') {
        return {
            title: 'Could not parse the SQL',
            message,
            location,
            hint: suggestion
                ? `This looks like ${suggestion.label} (it uses ${suggestion.sample}), which Standard SQL doesn’t understand.`
                : 'Standard SQL doesn’t understand vendor-specific syntax. Pick your database’s dialect.',
            action: suggestion ? { label: `Use ${suggestion.label}`, dialect: suggestion.value } : null,
        }
    }
    return {
        title: 'Could not parse the SQL',
        message,
        location,
        hint: suggestion && suggestion.value !== dialect
            ? `Check the syntax near the position above. It may be ${suggestion.label} syntax (${suggestion.sample}).`
            : `Check the syntax near the position above, or try another dialect than ${dialectLabel(dialect)}.`,
        action: suggestion && suggestion.value !== dialect ? { label: `Use ${suggestion.label}`, dialect: suggestion.value } : null,
    }
}

const EMPTY_RESULT = { output: '', error: null, queryError: null, notices: [] }

function formatJsonText(source, { action, indent, query }) {
    const text = source.replace(/^\uFEFF/, '')
    let data
    try {
        data = JSON.parse(text)
    } catch (e) {
        return { ...EMPTY_RESULT, error: jsonError(text, e) }
    }
    const notices = jsonNotices(text)
    let value = data
    const q = query.trim()
    if (q) {
        try {
            value = jmespath.search(data, q)
        } catch (e) {
            const queryError = jmespathError(q, e)
            return { ...EMPTY_RESULT, notices, queryError, error: { title: 'No output', message: 'Fix the JMESPath query to see the result.' } }
        }
        if (value === null) notices.push({ tone: 'info', title: 'The query matched nothing', body: 'JMESPath returns null when a path or filter finds no data.' })
    }
    const output = action === 'minify'
        ? JSON.stringify(value)
        : JSON.stringify(value, null, indent === 'tab' ? '\t' : Number(indent) || 2)
    return { ...EMPTY_RESULT, output, notices }
}

function formatSqlText(source, { indent, dialect, keywordCase }) {
    try {
        const output = formatSql(source, {
            language: dialect,
            tabWidth: indent === 'tab' ? 4 : Number(indent) || 2,
            useTabs: indent === 'tab',
            keywordCase,
            linesBetweenQueries: 1,
        })
        const notices = []
        const suggestion = dialect === 'sql' ? detectSqlDialect(source) : null
        if (suggestion) {
            notices.push({
                tone: 'warning',
                title: `This looks like ${suggestion.label}`,
                body: `Standard SQL doesn’t know syntax like ${suggestion.sample} and may break it apart. Formatting with the right dialect is safer.`,
                action: { label: `Use ${suggestion.label}`, dialect: suggestion.value },
            })
        }
        return { ...EMPTY_RESULT, output, notices }
    } catch (e) {
        return { ...EMPTY_RESULT, error: sqlError(source, e, dialect) }
    }
}

function formatXmlText(source, { action, indent }) {
    try {
        const output = action === 'minify' ? minifyXml(source) : formatXml(source, { indent: indentString(indent) })
        return { ...EMPTY_RESULT, output }
    } catch (e) {
        const message = String(e?.message || e)
        const lc = message.match(/line (\d+) at column (\d+)/)
        const guessed = guessMode(source)
        return {
            ...EMPTY_RESULT,
            error: {
                title: 'Invalid XML',
                message,
                location: lc ? { line: Number(lc[1]), column: Number(lc[2]) } : null,
                hint: guessed && guessed !== 'xml' ? `This looks like ${guessed.toUpperCase()}.` : 'Check that every tag is closed and attribute values are quoted.',
                action: guessed && guessed !== 'xml' ? { label: `Format as ${guessed.toUpperCase()}`, mode: guessed } : null,
            },
        }
    }
}

function runFormat(source, settings) {
    if (!source || !source.trim()) return EMPTY_RESULT
    if (settings.mode === 'sql') return formatSqlText(source, settings)
    if (settings.mode === 'xml') return formatXmlText(source, settings)
    return formatJsonText(source, settings)
}

const countLines = (text) => (text ? text.split('\n').length : 0)

// ---------------------------------------------------------------- page

export default function Formatters() {
    const pane = usePane()
    const queryId = useId()
    const [prefs, setPrefs] = useLocalStorage('vt-formatters-prefs', DEFAULT_PREFS)
    const settingsPrefs = { ...DEFAULT_PREFS, ...(prefs && typeof prefs === 'object' ? prefs : null) }
    const { live } = settingsPrefs
    // Stored values are validated so a stale preference can't break formatting
    const indent = INDENTS.some(o => o.value === settingsPrefs.indent) ? settingsPrefs.indent : DEFAULT_PREFS.indent
    const dialect = SQL_DIALECTS.some(d => d.value === settingsPrefs.dialect) ? settingsPrefs.dialect : DEFAULT_PREFS.dialect
    const keywordCase = KEYWORD_CASES.some(k => k.value === settingsPrefs.keywordCase) ? settingsPrefs.keywordCase : DEFAULT_PREFS.keywordCase
    const setPref = (key, value) => setPrefs(prev => ({ ...DEFAULT_PREFS, ...(prev && typeof prev === 'object' ? prev : null), [key]: value }))

    const [mode, setModeState] = useState('json')
    const [action, setAction] = useState('pretty')
    const [query, setQuery] = useState('')
    const [input, setInput] = useState('')
    // The text the current output was produced from. Live mode follows the
    // input (debounced); Format, paste, injection and option changes set it now.
    const [source, setSource] = useState('')
    const [view, setView] = useState('code')

    const debouncedQuery = useDebouncedValue(query, 300)
    const inputRef = useRef(input)
    const liveRef = useRef(live)
    const timerRef = useRef(null)
    const editorRef = useRef(null)
    const monacoRef = useRef(null)

    useEffect(() => {
        inputRef.current = input
        liveRef.current = live
    })
    useEffect(() => () => clearTimeout(timerRef.current), [])

    const result = useMemo(
        () => runFormat(source, { mode, action, indent, dialect, keywordCase, query: debouncedQuery }),
        [source, mode, action, indent, dialect, keywordCase, debouncedQuery]
    )
    const { output, error, queryError, notices } = result
    const liveLimit = LIVE_LIMIT[mode]
    const tooBigForLive = input.length > liveLimit
    const stale = source !== input && (!live || tooBigForLive) && Boolean(source || output)

    // Formats `value` (default: the current input) right away.
    const commit = (value = inputRef.current) => {
        clearTimeout(timerRef.current)
        setSource(value)
    }
    const commitRef = useRef(commit)
    useEffect(() => {
        commitRef.current = commit
    })

    const handleInputChange = (value) => {
        setInput(value)
        inputRef.current = value
        clearTimeout(timerRef.current)
        if (!live || value.length > liveLimit) return
        if (!value.trim()) {
            setSource('')
            return
        }
        const delay = value.length < 20_000 ? 400 : value.length < 200_000 ? 800 : 1200
        timerRef.current = setTimeout(() => setSource(value), delay)
    }

    const loadText = (text, nextMode) => {
        if (nextMode && MODE_IDS.includes(nextMode)) setModeState(nextMode)
        setInput(text)
        inputRef.current = text
        commit(text)
    }

    useSmartInput(
        {
            input: (value) => {
                if (typeof value === 'string') setInput(value)
            },
            mode: (value) => {
                if (MODE_IDS.includes(value)) setModeState(value)
            },
        },
        {
            onInject: (values) => {
                if (typeof values.input !== 'string') return
                const guessed = values.mode ? null : guessMode(values.input)
                loadText(values.input, values.mode ?? guessed)
            },
        }
    )

    useRegisterAIContext({
        tool: 'Code Formatters',
        getContext: () => ({ input, output }),
        suggestedPrompts: mode === 'sql'
            ? ['What does this SQL query do?', 'How can I optimize this query?', 'Are there any bugs in this query?']
            : mode === 'xml'
                ? ['Summarize what this XML represents', 'Is this XML well-formed?', 'Write an XPath to select the items']
                : ['Explain the structure of this JSON', 'Write a JMESPath query to extract the ids', 'Are there any issues with this data?'],
    })

    // Option changes re-run on the latest input
    const changeMode = (next) => {
        setModeState(next)
        commit()
    }
    const changeAction = (next) => {
        setAction(next)
        commit()
    }
    const changePref = (key, value) => {
        setPref(key, value)
        if (key === 'live' && value) commit()
        else if (key !== 'live') commit()
    }
    const applyAction = (act) => {
        if (act?.mode) changeMode(act.mode)
        if (act?.dialect) changePref('dialect', act.dialect)
    }

    // Error position markers in the input editor (Monaco validates JSON itself)
    useEffect(() => {
        const editor = editorRef.current
        const m = monacoRef.current
        const model = editor?.getModel?.()
        if (!model || !m) return
        const loc = error?.location
        const markers = loc && mode !== 'json' && source === model.getValue()
            ? [{
                startLineNumber: loc.line,
                startColumn: Math.max(1, loc.column),
                endLineNumber: loc.line,
                endColumn: Math.max(2, loc.column + 1),
                message: error.message,
                severity: m.MarkerSeverity.Error,
            }]
            : []
        m.editor.setModelMarkers(model, 'formatter', markers)
    }, [error, mode, source])

    const handleEditorMount = (editor, m) => {
        editorRef.current = editor
        monacoRef.current = m
        editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => commitRef.current(editor.getValue()))
        editor.onDidPaste(() => {
            if (liveRef.current) commitRef.current(editor.getValue())
        })
    }

    const clearAll = () => {
        clearTimeout(timerRef.current)
        setInput('')
        inputRef.current = ''
        setSource('')
    }

    const download = () => {
        const { ext, mime } = FILE_TYPES[mode]
        downloadText(output, `formatted.${ext}`, mime)
    }

    const diffSource = useMemo(() => (view === 'diff' ? source.replace(/\r\n?/g, '\n') : ''), [view, source])
    const diffTooBig = diffSource.length + output.length > DIFF_LIMIT
    const outputLines = useMemo(() => countLines(output), [output])
    const outputBytes = useMemo(() => new Blob([output]).size, [output])
    const shortcut = isMacPlatform ? '⌘↵' : 'Ctrl+Enter'

    const selectStyle = { width: 'auto', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }

    return (
        <div className="page page-wide page-formatters">
            <ToolHeader />

            <section className="card card-compact" aria-label="Formatting options">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-md)' }}>
                    <SegmentedControl ariaLabel="Language" options={MODES} value={mode} onChange={changeMode} />
                    {mode !== 'sql' && (
                        <SegmentedControl ariaLabel="Output style" options={ACTIONS} value={action} onChange={changeAction} />
                    )}
                    {(mode === 'sql' || action === 'pretty') && (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Indent
                            <select value={indent} onChange={e => changePref('indent', e.target.value)} style={selectStyle}>
                                {INDENTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </label>
                    )}
                    {mode === 'sql' && (
                        <>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Dialect
                                <select value={dialect} onChange={e => changePref('dialect', e.target.value)} style={selectStyle}>
                                    {SQL_DIALECTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                                </select>
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Keywords
                                <select value={keywordCase} onChange={e => changePref('keywordCase', e.target.value)} style={selectStyle}>
                                    {KEYWORD_CASES.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                                </select>
                            </label>
                        </>
                    )}
                    <label
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: 'auto' }}
                        title="Format as you type or paste"
                    >
                        <input type="checkbox" checked={live} onChange={e => changePref('live', e.target.checked)} />
                        Live format
                    </label>
                </div>

                {mode === 'json' && (
                    <Field
                        label="JMESPath query (optional)"
                        error={queryError ? `${queryError.message}. ${queryError.hint}` : null}
                        hint={queryError ? null : 'Filter or reshape the JSON, e.g. items[*].id or people[?age > `20`].name'}
                        style={{ marginTop: 'var(--space-md)' }}
                    >
                        <input
                            id={queryId}
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="JMESPath filter (e.g. [*].id or people[?age > `20`])"
                            spellCheck={false}
                            autoComplete="off"
                            autoCapitalize="off"
                            className={queryError ? 'field-invalid' : ''}
                            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', padding: '0.55rem 0.75rem' }}
                        />
                    </Field>
                )}
            </section>

            <div className="split-pane">
                <div className="card card-compact" role="region" aria-label="Input" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <div className="section-title" role="heading" aria-level={2}><FileCode size={16} aria-hidden="true" /> Input</div>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineRead onRead={(text) => loadText(text, guessMode(text))} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadText(SAMPLES[mode])}>
                                <Sparkles size={14} aria-hidden="true" /> Sample
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll} disabled={!input}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    </div>
                    <CodeEditor
                        value={input}
                        onChange={handleInputChange}
                        language={mode}
                        ariaLabel={`${mode.toUpperCase()} input`}
                        placeholder={`Paste or type ${mode.toUpperCase()} here…`}
                        onMount={handleEditorMount}
                        options={{ tabSize: indent === '4' ? 4 : 2 }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-primary" onClick={() => commit()} disabled={!input.trim()}>
                            <Wand2 size={16} aria-hidden="true" /> Format
                        </button>
                        <span className="field-hint" style={{ marginTop: 0 }}>
                            <span className="kbd">{shortcut}</span>
                            {live && tooBigForLive ? ' · Large input: live formatting is paused' : live ? ' · Formats as you type and paste' : ''}
                        </span>
                    </div>
                </div>

                <div className="card card-compact" role="region" aria-label="Output" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            <div className="section-title" role="heading" aria-level={2}><FileOutput size={16} aria-hidden="true" /> Output</div>
                            <SegmentedControl
                                size="sm"
                                ariaLabel="Output view"
                                options={[{ value: 'code', label: 'Code' }, { value: 'diff', label: 'Diff', title: 'Compare input and output' }]}
                                value={view}
                                onChange={setView}
                            />
                        </div>
                        <CopyButton text={output} disabled={!output || !!error} />
                    </div>

                    {error && (
                        <StatusBanner
                            tone="danger"
                            title={error.title}
                            action={error.action ? (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyAction(error.action)}>{error.action.label}</button>
                            ) : null}
                        >
                            <span className="mono" style={{ fontSize: '0.82rem' }}>{error.message}</span>
                            {error.hint && <div style={{ marginTop: 4 }}>{error.hint}</div>}
                        </StatusBanner>
                    )}
                    {notices.map((n) => (
                        <StatusBanner
                            key={n.title}
                            tone={n.tone}
                            title={n.title}
                            action={n.action ? (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyAction(n.action)}>{n.action.label}</button>
                            ) : null}
                        >
                            {n.body}
                        </StatusBanner>
                    ))}
                    {stale && !error && (
                        <StatusBanner tone="info" title="The input changed">
                            Press Format ({shortcut}) to update the output.
                        </StatusBanner>
                    )}

                    {view === 'diff' && output && !error ? (
                        diffTooBig ? (
                            <StatusBanner tone="info" title="Diff is off for large documents">
                                Comparing more than {formatBytes(DIFF_LIMIT)} of text would be slow. Use the Code view or the Text Diff tool.
                            </StatusBanner>
                        ) : (
                            <CodeDiffEditor
                                original={diffSource}
                                modified={output}
                                language={mode}
                                inline={pane.size !== 'lg'}
                                ariaLabel="Differences between input and output"
                            />
                        )
                    ) : (
                        <CodeEditor
                            value={output}
                            language={mode}
                            readOnly
                            ariaLabel={`Formatted ${mode.toUpperCase()} output`}
                            placeholder={error ? '' : 'Formatted output appears here'}
                            options={{ tabSize: indent === '4' ? 4 : 2 }}
                        />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <span className="field-hint" style={{ marginTop: 0 }}>
                            {output && !error ? `${outputLines.toLocaleString()} line${outputLines === 1 ? '' : 's'} · ${formatBytes(outputBytes)}` : ''}
                        </span>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineSend dataToSend={output} disabled={!!error} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={download} disabled={!output || !!error}>
                                <Download size={14} aria-hidden="true" /> Download
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
