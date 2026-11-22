import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { format as formatSql } from 'sql-formatter'
import jmespath from 'jmespath'
import { AlignLeft, Download, FileCode, FileOutput, Loader2, Minimize2, Sparkles, Trash2, Wand2 } from 'lucide-react'
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
import {
    LANGUAGE_OPTIONS,
    MINIFIABLE_LANGUAGES,
    PRETTIER_DEFAULTS,
    PRINT_WIDTHS,
    formatCode,
    isFormatterLoaded,
    isPrettierLanguage,
    readPrettierOptions,
} from '../utils/prettierFormat'

// Languages, grouped in the picker. JSON, SQL and XML have their own
// formatters; the rest use Prettier (utils/prettierFormat.js), loaded on
// first use. `liveLimit`: live formatting pauses above this many characters
// (the Format button still works), sized so a run stays around 200 ms.
const MODES = [
    { value: 'json', label: 'JSON', group: 'Data', ext: 'json', mime: 'application/json', liveLimit: 2_000_000 },
    { value: 'yaml', label: 'YAML', group: 'Data', ext: 'yaml', mime: 'application/yaml', liveLimit: 100_000 },
    { value: 'xml', label: 'XML', group: 'Markup', ext: 'xml', mime: 'application/xml', liveLimit: 1_000_000 },
    { value: 'html', label: 'HTML', group: 'Markup', ext: 'html', mime: 'text/html', liveLimit: 100_000 },
    { value: 'markdown', label: 'Markdown', group: 'Markup', ext: 'md', mime: 'text/markdown', liveLimit: 50_000 },
    { value: 'css', label: 'CSS', group: 'Styles', ext: 'css', mime: 'text/css', liveLimit: 60_000 },
    { value: 'scss', label: 'SCSS', group: 'Styles', ext: 'scss', mime: 'text/plain', liveLimit: 60_000 },
    { value: 'less', label: 'Less', group: 'Styles', ext: 'less', mime: 'text/plain', liveLimit: 60_000 },
    { value: 'javascript', label: 'JavaScript', option: 'JavaScript / JSX', group: 'Scripts', ext: 'js', mime: 'text/javascript', liveLimit: 150_000 },
    { value: 'typescript', label: 'TypeScript', option: 'TypeScript / TSX', group: 'Scripts', ext: 'ts', mime: 'text/plain', liveLimit: 150_000 },
    { value: 'sql', label: 'SQL', group: 'Queries', ext: 'sql', mime: 'application/sql', liveLimit: 150_000 },
    { value: 'graphql', label: 'GraphQL', group: 'Queries', ext: 'graphql', mime: 'text/plain', liveLimit: 100_000 },
]
const MODE_INFO = Object.fromEntries(MODES.map(m => [m.value, m]))
const MODE_GROUPS = [...new Set(MODES.map(m => m.group))].map(group => ({ group, modes: MODES.filter(m => m.group === group) }))
const modeLabel = (mode) => MODE_INFO[mode]?.label ?? mode.toUpperCase()

// Other names a mode may arrive as (smart input, pipeline)
const MODE_ALIASES = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', yml: 'yaml', md: 'markdown', gql: 'graphql', htm: 'html' }
function normalizeMode(value) {
    if (typeof value !== 'string') return null
    const key = value.trim().toLowerCase()
    if (Object.hasOwn(MODE_INFO, key)) return key
    return Object.hasOwn(MODE_ALIASES, key) ? MODE_ALIASES[key] : null
}

const canMinify = (mode) => mode === 'json' || mode === 'xml' || MINIFIABLE_LANGUAGES.includes(mode)

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
    html: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Vibe Toolbelt</title><style>body{font-family:system-ui;margin:0}.card{padding:16px;border-radius:8px}</style></head><body><main class="card"><h1>Hello</h1><p>Formatted with <a href="https://prettier.io">Prettier</a>.</p><ul><li>One</li><li>Two</li></ul></main><script>document.querySelector(\'h1\').addEventListener(\'click\',()=>{console.log("hi")})</script></body></html>',
    css: ':root{--accent:#6d5efc;--radius:8px}body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#222}.btn,.btn:hover{display:inline-flex;align-items:center;padding:.5rem 1rem;border-radius:var(--radius);background:var(--accent);color:#fff}@media (max-width:600px){.btn{width:100%}}',
    scss: '$accent:#6d5efc;$radius:8px;@mixin card($pad:16px){padding:$pad;border-radius:$radius}.card{@include card(24px);background:lighten($accent,40%);&:hover{box-shadow:0 2px 8px rgba(0,0,0,.2)}.title{font-weight:600;color:$accent}}',
    less: '@accent:#6d5efc;@radius:8px;.rounded(@r:@radius){border-radius:@r}.card{.rounded(12px);background:lighten(@accent,40%);&:hover{color:darken(@accent,10%)}.title{font-weight:600}}',
    javascript: "import {useState} from 'react'\nexport default function Counter({initial=0,step=1}){const [count,setCount]=useState(initial);const label=count===1?\"1 click\":`${count} clicks`\nreturn <div className=\"counter\"><button onClick={()=>setCount(c=>c+step)}>Add {step}</button><span>{label}</span></div>}",
    typescript: "interface User{id:number;name:string;email?:string;roles:Array<'admin'|'editor'|'viewer'>}\ntype Result<T>={ok:true;value:T}|{ok:false;error:string}\nexport async function fetchUser(id:number):Promise<Result<User>>{const res=await fetch(`/api/users/${id}`);if(!res.ok){return {ok:false,error:res.statusText}}return {ok:true,value:await res.json() as User}}",
    yaml: 'name:   vibe-toolbelt\non: {push: {branches: [main]}, pull_request: {}}\njobs:\n  build:\n      runs-on: ubuntu-latest\n      steps:\n          - uses: actions/checkout@v4\n          - name:   Install\n            run: npm ci\n          - run: npm test\n',
    graphql: 'query GetUser($id:ID!,$withPosts:Boolean=false){user(id:$id){id name email posts(first:10)@include(if:$withPosts){edges{node{id title}}}}}',
    markdown: 'Vibe Toolbelt\n===\nA set of *developer tools* that run in your browser.\n* Formatters\n* Encoders\n\n1) Paste some code\n2) Pick a language\n```js\nconst greeting = {text:"hello"}\n```\n',
}

const DIFF_LIMIT = 400_000

const DEFAULT_PREFS = { indent: '2', dialect: 'sql', keywordCase: 'upper', live: true, ...PRETTIER_DEFAULTS }

// How each Prettier option is shown. LANGUAGE_OPTIONS (utils/prettierFormat.js)
// decides which ones a language gets; Print width sits next to Indent.
const EMBEDDED_HINTS = {
    html: 'Also format the CSS and JavaScript in <style>, <script> and style attributes',
    markdown: 'Also format fenced code blocks (JavaScript, TypeScript, JSON, CSS, YAML, GraphQL, HTML) and YAML front matter',
}
const PRETTIER_CONTROLS = {
    semi: { label: 'Semicolons' },
    singleQuote: { label: 'Single quotes' },
    jsxSingleQuote: { label: 'Single quotes in JSX' },
    bracketSpacing: { label: 'Spaces inside braces', title: '{ a: 1 } instead of {a: 1}' },
    bracketSameLine: { label: 'Bracket on same line', title: 'Put the > of a multi-line tag at the end of its last line' },
    singleAttributePerLine: { label: 'One attribute per line' },
    embeddedLanguageFormatting: { label: 'Format embedded code', on: 'auto', off: 'off' },
    trailingComma: { label: 'Trailing commas', choices: [['all', 'All'], ['es5', 'ES5'], ['none', 'None']] },
    quoteProps: { label: 'Quote keys', choices: [['as-needed', 'When needed'], ['consistent', 'Consistently'], ['preserve', 'As written']] },
    arrowParens: { label: 'Arrow parens', title: 'Parentheses around a single arrow function parameter: (x) => x', choices: [['always', 'Always'], ['avoid', 'When needed']] },
    htmlWhitespaceSensitivity: { label: 'Whitespace', title: 'How whitespace between inline elements is treated', choices: [['css', 'Follow CSS display'], ['strict', 'Strict'], ['ignore', 'Ignore']] },
    proseWrap: { label: 'Wrap prose', choices: [['preserve', 'As written'], ['always', 'At print width'], ['never', 'Never']] },
}

const PROMPTS = {
    json: ['Explain the structure of this JSON', 'Write a JMESPath query to extract the ids', 'Are there any issues with this data?'],
    sql: ['What does this SQL query do?', 'How can I optimize this query?', 'Are there any bugs in this query?'],
    xml: ['Summarize what this XML represents', 'Is this XML well-formed?', 'Write an XPath to select the items'],
    html: ['Is this HTML accessible?', 'Explain the structure of this page', 'Are there any invalid or deprecated tags?'],
    css: ['Explain what these styles do', 'Are any of these rules redundant?', 'How can I make this layout responsive?'],
    scss: ['Explain these variables and mixins', 'Convert this SCSS to plain CSS', 'Are any of these rules redundant?'],
    less: ['Explain these variables and mixins', 'Convert this Less to plain CSS', 'Are any of these rules redundant?'],
    javascript: ['Explain what this code does', 'Are there any bugs in this code?', 'How can I simplify this?'],
    typescript: ['Explain what this code does', 'Are there any type or logic errors?', 'How can I make these types stricter?'],
    yaml: ['Explain this configuration', 'Are there any mistakes in this YAML?', 'Convert this YAML to JSON'],
    graphql: ['What data does this query fetch?', 'Are there any problems with this query?', 'Write a TypeScript type for the result'],
    markdown: ['Summarize this document', 'Suggest a clearer structure', 'Fix spelling and grammar'],
}

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

function jsonNotices(text, { numbersKept = false } = {}) {
    const { lossy, rewritten, duplicates, reordered } = inspectJsonText(text)
    const notices = []
    if (lossy.length && !numbersKept) {
        notices.push({
            tone: 'warning',
            title: `${lossy.length} number${lossy.length > 1 ? 's' : ''} can't be represented exactly`,
            body: `JavaScript numbers are 64-bit floats, so these values change: ${describeNumberChanges(lossy)}. Keep them as strings if precision matters.`,
        })
    }
    if (rewritten.length && !numbersKept) {
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

// Only unambiguous starts: the guess can switch the language (pipeline, smart
// input without a mode) and suggests "Format as …" on errors.
const HTML_START = /^<(?:!doctype\s+html|html|head|body|div|span|p|ul|ol|table|section|article|header|footer|main|nav|aside|form|button|img|script|style|meta|h[1-6]|template|iframe|br|hr)\b/i
const GRAPHQL_START = /^(?:(?:query|mutation|subscription)\b[^{}]*\{|fragment\s+[_A-Za-z]\w*\s+on\s+[_A-Za-z])/

function guessMode(text) {
    const t = text.trimStart()
    if (/^[[{]/.test(t)) return 'json'
    if (t.startsWith('<')) return HTML_START.test(t) ? 'html' : 'xml'
    if (/^(select|insert|update|delete|with|create|alter|drop|merge|explain)\b/i.test(t)) return 'sql'
    if (GRAPHQL_START.test(t)) return 'graphql'
    return null
}

// Hints for a failed parse: syntax that belongs to a sibling language.
const TYPESCRIPT_SYNTAX = /\binterface\s+[A-Za-z_$][\w$]*\s*(?:<[^>]*>\s*)?(?:extends\s[^{]+)?\{|\btype\s+[A-Za-z_$][\w$]*\s*(?:<[^>]*>\s*)?=|\benum\s+[A-Za-z_$][\w$]*\s*\{|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$]|\)\s*:\s*(?:string|number|boolean|void|any|unknown|never|Promise\b)|\bas\s+(?:const|string|number|unknown|any)\b|\b(?:private|public|protected|readonly)\s+[A-Za-z_$][\w$]*\s*[:;=(]/
const LESS_SYNTAX = /^\s*@[\w-]+\s*:|^\s*\.[\w-]+\([^)]*\)\s*;/m

function siblingSuggestion(text, mode) {
    if (mode === 'javascript' && TYPESCRIPT_SYNTAX.test(text)) return 'typescript'
    if ((mode === 'css' || mode === 'scss') && LESS_SYNTAX.test(text)) return 'less'
    const guessed = guessMode(text)
    return guessed && guessed !== mode ? guessed : null
}

// Error details for a Prettier failure (see describePrettierError).
function prettierError(text, mode, error) {
    const label = modeLabel(mode)
    if (error.kind === 'load') {
        return {
            title: `Couldn’t load the ${label} formatter`,
            message: 'It’s downloaded the first time you format this language. Check your connection and try again.',
            plain: true,
            action: { label: 'Try again', retry: true },
        }
    }
    const location = error.line
        ? { line: error.line, column: error.column, endLine: error.endLine, endColumn: error.endColumn }
        : null
    const suggestion = siblingSuggestion(text, mode)
    return {
        title: `Invalid ${label}`,
        message: location ? `${error.message} (line ${location.line}, column ${location.column})` : error.message,
        location,
        hint: suggestion ? `This looks like ${modeLabel(suggestion)}.` : null,
        action: suggestion ? { label: `Format as ${modeLabel(suggestion)}`, mode: suggestion } : null,
    }
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
        hint = `This looks like ${modeLabel(guessed)}.`
        action = { label: `Format as ${modeLabel(guessed)}`, mode: guessed }
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

// Without a JMESPath query, numbers keep the exact text they were written with
// (integers above 2^53, 1.0, 1e3) in browsers that have JSON.rawJSON and give
// JSON.parse revivers the source text. Queries need real numbers to compare.
const CAN_KEEP_NUMBER_TEXT = typeof JSON.rawJSON === 'function'

function parseJsonKeepingNumbers(text) {
    return JSON.parse(text, (key, value, context) =>
        typeof value === 'number' && typeof context?.source === 'string' ? JSON.rawJSON(context.source) : value
    )
}

function formatJsonText(source, { action, indent, query }) {
    const text = source.replace(/^\uFEFF/, '')
    const q = query.trim()
    const keepNumbers = CAN_KEEP_NUMBER_TEXT && !q
    let data
    try {
        data = keepNumbers ? parseJsonKeepingNumbers(text) : JSON.parse(text)
    } catch (e) {
        return { ...EMPTY_RESULT, error: jsonError(text, e) }
    }
    const notices = jsonNotices(text, { numbersKept: keepNumbers })
    let value = data
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
                hint: guessed && guessed !== 'xml' ? `This looks like ${modeLabel(guessed)}.` : 'Check that every tag is closed and attribute values are quoted.',
                action: guessed && guessed !== 'xml' ? { label: `Format as ${modeLabel(guessed)}`, mode: guessed } : null,
            },
        }
    }
}

// JSON, SQL and XML (synchronous). `source` records the text a result is for.
function runFormat(source, settings) {
    if (!source || !source.trim()) return EMPTY_RESULT
    if (settings.mode === 'sql') return { ...formatSqlText(source, settings), source }
    if (settings.mode === 'xml') return { ...formatXmlText(source, settings), source }
    return { ...formatJsonText(source, settings), source }
}

// Lets the browser paint the "Formatting…" status before a long synchronous
// Prettier run starts (with a fallback for background tabs, which skip frames).
const nextPaint = () => new Promise((resolve) => {
    const fallback = setTimeout(resolve, 100)
    requestAnimationFrame(() => setTimeout(() => {
        clearTimeout(fallback)
        resolve()
    }, 0))
})

// The other languages (asynchronous: Prettier is downloaded on first use).
async function runPrettier({ source, mode, action, indent, options }) {
    if (source.length > 20_000) await nextPaint()
    const { output, error } = await formatCode(source, mode, { ...options, indent, minify: action === 'minify' })
    return error
        ? { ...EMPTY_RESULT, source, error: prettierError(source, mode, error) }
        : { ...EMPTY_RESULT, source, output }
}

// Prettier ends its output with a newline, which isn't a line of its own
const countLines = (text) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0)

const INLINE_LABEL = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }
const SELECT_STYLE = { width: 'auto', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }
const OPTIONS_ROW = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-md)' }
const OPTIONS_BOX = { marginTop: 'var(--space-sm)', paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--border)' }

// A compact labelled select. The label is associated with htmlFor rather than
// wrapped around the select, so the accessible name is just the label.
function InlineSelect({ label, value, onChange, title, children }) {
    const id = useId()
    return (
        <span style={INLINE_LABEL} title={title}>
            <label htmlFor={id}>{label}</label>
            <select id={id} value={value} onChange={e => onChange(e.target.value)} style={SELECT_STYLE}>
                {children}
            </select>
        </span>
    )
}

// One Prettier option: a checkbox, or a select for choices
function PrettierOption({ name, mode, value, onChange }) {
    const control = PRETTIER_CONTROLS[name]
    if (control.choices) {
        return (
            <InlineSelect label={control.label} title={control.title} value={value} onChange={next => onChange(name, next)}>
                {control.choices.map(([choice, label]) => <option key={choice} value={choice}>{label}</option>)}
            </InlineSelect>
        )
    }
    const checked = control.on ? value === control.on : value
    const toValue = (on) => (control.on ? (on ? control.on : control.off) : on)
    return (
        <label style={INLINE_LABEL} title={name === 'embeddedLanguageFormatting' ? EMBEDDED_HINTS[mode] : control.title}>
            <input type="checkbox" checked={checked} onChange={e => onChange(name, toValue(e.target.checked))} />
            {control.label}
        </label>
    )
}

// ---------------------------------------------------------------- page

export default function Formatters() {
    const pane = usePane()
    const queryId = useId()
    const [prefs, setPrefs] = useLocalStorage('vt-formatters-prefs', DEFAULT_PREFS)
    const settingsPrefs = { ...DEFAULT_PREFS, ...(prefs && typeof prefs === 'object' ? prefs : null) }
    // Stored values are validated so a stale preference can't break formatting
    const live = typeof settingsPrefs.live === 'boolean' ? settingsPrefs.live : DEFAULT_PREFS.live
    const indent = INDENTS.some(o => o.value === settingsPrefs.indent) ? settingsPrefs.indent : DEFAULT_PREFS.indent
    const dialect = SQL_DIALECTS.some(d => d.value === settingsPrefs.dialect) ? settingsPrefs.dialect : DEFAULT_PREFS.dialect
    const keywordCase = KEYWORD_CASES.some(k => k.value === settingsPrefs.keywordCase) ? settingsPrefs.keywordCase : DEFAULT_PREFS.keywordCase
    const prettierOptions = readPrettierOptions(settingsPrefs)
    // A string, so the Prettier request below only changes when an option does
    const prettierKey = JSON.stringify(prettierOptions)
    const setPref = (key, value) => setPrefs(prev => ({ ...DEFAULT_PREFS, ...(prev && typeof prev === 'object' ? prev : null), [key]: value }))

    const [mode, setModeState] = useState('json')
    const [action, setAction] = useState('pretty')
    const [query, setQuery] = useState('')
    const [input, setInput] = useState('')
    // The text the current output was produced from. Live mode follows the
    // input (debounced); Format, paste, injection and option changes set it now.
    const [source, setSource] = useState('')
    const [view, setView] = useState('code')
    // Bumped by "Try again" after Prettier failed to download
    const [attempt, setAttempt] = useState(0)
    // The latest finished Prettier run: { request, result }
    const [prettierRun, setPrettierRun] = useState({ request: null, result: EMPTY_RESULT })

    const info = MODE_INFO[mode]
    const usesPrettier = isPrettierLanguage(mode)
    const effectiveAction = canMinify(mode) ? action : 'pretty'
    const liveLimit = info.liveLimit

    const debouncedQuery = useDebouncedValue(query, 300)
    const inputRef = useRef(input)
    const liveRef = useRef(live)
    const liveLimitRef = useRef(liveLimit)
    const timerRef = useRef(null)
    const editorRef = useRef(null)
    const monacoRef = useRef(null)

    useEffect(() => {
        inputRef.current = input
        liveRef.current = live
        liveLimitRef.current = liveLimit
    })
    useEffect(() => () => clearTimeout(timerRef.current), [])

    const syncResult = useMemo(
        () => (usesPrettier ? null : runFormat(source, { mode, action: effectiveAction, indent, dialect, keywordCase, query: debouncedQuery })),
        [usesPrettier, source, mode, effectiveAction, indent, dialect, keywordCase, debouncedQuery]
    )

    // Prettier runs asynchronously; a run whose request is no longer current
    // is ignored when it finishes.
    const prettierRequest = useMemo(
        () => (usesPrettier && source.trim()
            ? { source, mode, action: effectiveAction, indent, options: JSON.parse(prettierKey), attempt }
            : null),
        [usesPrettier, source, mode, effectiveAction, indent, prettierKey, attempt]
    )
    useEffect(() => {
        if (!prettierRequest) return undefined
        let current = true
        runPrettier(prettierRequest).then((result) => {
            if (current) setPrettierRun({ request: prettierRequest, result })
        })
        return () => {
            current = false
        }
    }, [prettierRequest])

    const prettierDone = prettierRun.request === prettierRequest
    const formatting = Boolean(prettierRequest) && !prettierDone
    const loadingFormatter = formatting && !isFormatterLoaded(mode)
    // While a run is in progress the previous output for the same language
    // stays (no flicker while typing); another language's output doesn't.
    const result = !usesPrettier
        ? syncResult
        : !prettierRequest
            ? EMPTY_RESULT
            : prettierDone || prettierRun.request?.mode === mode
                ? prettierRun.result
                : EMPTY_RESULT
    const { output, error, queryError, notices } = result
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
        const known = normalizeMode(nextMode)
        if (known) setModeState(known)
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
                const known = normalizeMode(value)
                if (known) setModeState(known)
            },
        },
        {
            onInject: (values) => {
                if (typeof values.input !== 'string') return
                const known = normalizeMode(values.mode)
                loadText(values.input, known ?? guessMode(values.input))
            },
        }
    )

    useRegisterAIContext({
        tool: 'Code Formatters',
        getContext: () => ({ input, output }),
        suggestedPrompts: PROMPTS[mode],
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
        if (act?.retry) setAttempt(n => n + 1)
    }

    // Error position markers in the input editor (Monaco validates JSON itself)
    const resultSource = result.source
    useEffect(() => {
        const editor = editorRef.current
        const m = monacoRef.current
        const model = editor?.getModel?.()
        if (!model || !m) return
        const loc = error?.location
        const markers = loc && mode !== 'json' && resultSource === model.getValue()
            ? [{
                startLineNumber: loc.line,
                startColumn: Math.max(1, loc.column),
                endLineNumber: loc.endLine ?? loc.line,
                endColumn: loc.endLine ? loc.endColumn : Math.max(2, loc.column + 1),
                message: error.message,
                severity: m.MarkerSeverity.Error,
            }]
            : []
        m.editor.setModelMarkers(model, 'formatter', markers)
    }, [error, mode, resultSource])

    // Puts the cursor on the error and scrolls to it
    const goToError = (loc) => {
        const editor = editorRef.current
        if (!editor) return
        const position = { lineNumber: loc.line, column: Math.max(1, loc.column) }
        editor.setPosition(position)
        editor.revealPositionInCenterIfOutsideViewport(position)
        editor.focus()
    }

    const handleEditorMount = (editor, m) => {
        editorRef.current = editor
        monacoRef.current = m
        editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => commitRef.current(editor.getValue()))
        editor.onDidPaste(() => {
            const value = editor.getValue()
            if (liveRef.current && value.length <= liveLimitRef.current) commitRef.current(value)
        })
    }

    const clearAll = () => {
        clearTimeout(timerRef.current)
        setInput('')
        inputRef.current = ''
        setSource('')
    }

    const download = () => {
        downloadText(output, `formatted.${info.ext}`, info.mime)
    }

    const diffSource = useMemo(() => (view === 'diff' ? source.replace(/\r\n?/g, '\n') : ''), [view, source])
    const diffTooBig = diffSource.length + output.length > DIFF_LIMIT
    const outputLines = useMemo(() => countLines(output), [output])
    const outputBytes = useMemo(() => new Blob([output]).size, [output])
    const shortcut = isMacPlatform ? '⌘↵' : 'Ctrl+Enter'

    // YAML can't be indented with tabs, so it offers (and gets) spaces only
    const indentChoices = mode === 'yaml' ? INDENTS.filter(o => o.value !== 'tab') : INDENTS
    const indentValue = mode === 'yaml' && indent === 'tab' ? '2' : indent
    const showPrettierOptions = usesPrettier && effectiveAction === 'pretty'
    const optionNames = showPrettierOptions ? LANGUAGE_OPTIONS[mode].filter(name => name !== 'printWidth') : []
    const changedOptions = optionNames.filter(name => prettierOptions[name] !== PRETTIER_DEFAULTS[name]).length
    const optionControls = optionNames.map(name => (
        <PrettierOption key={name} name={name} mode={mode} value={prettierOptions[name]} onChange={changePref} />
    ))
    const progress = loadingFormatter ? `Loading the ${info.label} formatter…` : 'Formatting…'

    return (
        <div className="page page-wide page-formatters">
            <ToolHeader />

            <section className="card card-compact" aria-label="Formatting options">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-md)' }}>
                    <InlineSelect label="Language" value={mode} onChange={changeMode}>
                        {MODE_GROUPS.map(g => (
                            <optgroup key={g.group} label={g.group}>
                                {g.modes.map(m => <option key={m.value} value={m.value}>{m.option ?? m.label}</option>)}
                            </optgroup>
                        ))}
                    </InlineSelect>
                    {canMinify(mode) && (
                        <SegmentedControl ariaLabel="Output style" options={ACTIONS} value={action} onChange={changeAction} />
                    )}
                    {(mode === 'sql' || effectiveAction === 'pretty') && (
                        <InlineSelect label="Indent" value={indentValue} onChange={value => changePref('indent', value)}>
                            {indentChoices.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </InlineSelect>
                    )}
                    {showPrettierOptions && (
                        <InlineSelect
                            label="Print width"
                            title="Prettier wraps lines that are longer than this"
                            value={prettierOptions.printWidth}
                            onChange={value => changePref('printWidth', Number(value))}
                        >
                            {PRINT_WIDTHS.map(width => <option key={width} value={width}>{width}</option>)}
                        </InlineSelect>
                    )}
                    {mode === 'sql' && (
                        <>
                            <InlineSelect label="Dialect" value={dialect} onChange={value => changePref('dialect', value)}>
                                {SQL_DIALECTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                            </InlineSelect>
                            <InlineSelect label="Keywords" value={keywordCase} onChange={value => changePref('keywordCase', value)}>
                                {KEYWORD_CASES.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                            </InlineSelect>
                        </>
                    )}
                    <label style={{ ...INLINE_LABEL, marginLeft: 'auto' }} title="Format as you type or paste">
                        <input type="checkbox" checked={live} onChange={e => changePref('live', e.target.checked)} />
                        Live format
                    </label>
                </div>

                {optionNames.length > 0 && (pane.size === 'sm' ? (
                    // On a phone-width pane the style options fold away
                    <details style={OPTIONS_BOX}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Style options ({changedOptions ? `${changedOptions} changed` : 'defaults'})
                        </summary>
                        <div role="group" aria-label={`${info.label} style`} style={{ ...OPTIONS_ROW, marginTop: 'var(--space-sm)' }}>
                            {optionControls}
                        </div>
                    </details>
                ) : (
                    <div role="group" aria-label={`${info.label} style`} style={{ ...OPTIONS_ROW, ...OPTIONS_BOX }}>
                        {optionControls}
                    </div>
                ))}

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
                        ariaLabel={`${info.label} input`}
                        placeholder={`Paste or type ${info.label} here…`}
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
                            {error.plain ? error.message : <span className="mono" style={{ fontSize: '0.82rem' }}>{error.message}</span>}
                            {error.hint && <div style={{ marginTop: 4 }}>{error.hint}</div>}
                            {error.location && (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ marginTop: 'var(--space-xs)' }}
                                    onClick={() => goToError(error.location)}
                                >
                                    Go to line {error.location.line}
                                </button>
                            )}
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
                            ariaLabel={`Formatted ${info.label} output`}
                            placeholder={error ? '' : formatting ? progress : 'Formatted output appears here'}
                            options={{ tabSize: indent === '4' ? 4 : 2 }}
                        />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <span className="field-hint" style={{ marginTop: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {formatting ? (
                                <><Loader2 size={12} className="spin" aria-hidden="true" /> {progress}</>
                            ) : output && !error ? (
                                `${outputLines.toLocaleString()} line${outputLines === 1 ? '' : 's'} · ${formatBytes(outputBytes)}`
                            ) : ''}
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
