import { useId, useState } from 'react'
import Papa from 'papaparse'
import { ArrowDown, ArrowRight, Braces, Download, FileSpreadsheet, FileUp, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import StatusBanner from '../components/ui/StatusBanner'
import FileDropZone from '../components/ui/FileDropZone'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useToast } from '../components/ToastProvider'
import { usePane } from '../contexts/pane'
import { downloadText, splitFilename } from '../utils/download'

const DELIMITERS = [
    { value: 'auto', label: 'Auto-detect' },
    { value: ',', label: 'Comma (,)' },
    { value: ';', label: 'Semicolon (;)' },
    { value: '\t', label: 'Tab' },
    { value: '|', label: 'Pipe (|)' },
]
const delimiterName = (d) => DELIMITERS.find(x => x.value === d)?.label.replace(/ \(.\)$/, '').toLowerCase() ?? JSON.stringify(d)

const SAMPLE_CSV = 'id,name,role,active,joined\n1,Alice,Admin,true,2023-04-01\n2,"Bob, Jr.",User,false,2024-01-15\n3,"Carol ""CJ"" Jones",User,true,\n'

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/
// Only canonical values are converted, so "007", "1.50" and long IDs stay text
function inferValue(text) {
    if (text === 'true') return true
    if (text === 'false') return false
    if (text === 'null') return null
    if (NUMBER.test(text)) {
        const n = Number(text)
        if (Number.isFinite(n) && String(n) === text) return n
    }
    return text
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function describe(v) {
    if (v === null) return 'null'
    if (Array.isArray(v)) return 'an array'
    return typeof v === 'object' ? 'an object' : `a ${typeof v}`
}

function csvToJson(text, { delimiter, header, infer, trim }) {
    const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), {
        delimiter: delimiter === 'auto' ? '' : delimiter,
        skipEmptyLines: 'greedy',
    })
    const quoteError = parsed.errors.find(e => e.type === 'Quotes')
    if (quoteError) {
        throw new Error(`${quoteError.message} (row ${quoteError.row + 1}). A field that starts with " must end with " — double any quotes inside it ("").`)
    }
    const clean = (s) => (trim ? s.trim() : s)
    const cell = (s) => (infer ? inferValue(clean(s)) : clean(s))
    const rows = parsed.data
    const notices = []
    if (delimiter === 'auto' && rows.length && rows[0].length > 1) notices.push({ warn: false, text: `Detected delimiter: ${delimiterName(parsed.meta.delimiter)}.` })

    if (!header) {
        return { json: rows.map(r => r.map(cell)), rows: rows.length, columns: Math.max(0, ...rows.map(r => r.length)), notices }
    }
    if (!rows.length) return { json: [], rows: 0, columns: 0, notices }

    // Unique, non-empty keys
    const seen = new Map()
    const renamed = []
    const headers = rows[0].map((raw, i) => {
        let name = raw.trim() || `column_${i + 1}`
        if (seen.has(name)) {
            const n = seen.get(name) + 1
            seen.set(name, n)
            renamed.push(`${name} → ${name}_${n}`)
            name = `${name}_${n}`
        }
        seen.set(name, seen.get(name) ?? 1)
        return name
    })
    if (renamed.length) notices.push({ warn: true, text: `Duplicate column names were renamed: ${renamed.slice(0, 4).join(', ')}${renamed.length > 4 ? ', …' : ''}.` })

    let extra = 0
    let short = 0
    const json = rows.slice(1).map((row) => {
        const obj = Object.create(null)
        headers.forEach((h, i) => {
            obj[h] = cell(row[i] ?? '')
        })
        if (row.length < headers.length) short++
        for (let i = headers.length; i < row.length; i++) {
            obj[`column_${i + 1}`] = cell(row[i])
            extra++
        }
        return obj
    })
    if (short) notices.push({ warn: true, text: `${short} row${short > 1 ? 's have' : ' has'} fewer fields than the header; missing values are empty.` })
    if (extra) notices.push({ warn: true, text: 'Some rows have more fields than the header; the extras are named column_N.' })
    return { json, rows: json.length, columns: headers.length, notices }
}

function cellText(v) {
    if (v === null || v === undefined) return ''
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
}

function jsonToCsv(text, { delimiter }) {
    let data
    try {
        data = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch (e) {
        throw new Error(`Invalid JSON: ${e.message}`)
    }
    const notices = []
    if (isRecord(data)) {
        data = [data]
        notices.push({ warn: false, text: 'A single object was converted as one row.' })
    }
    if (!Array.isArray(data)) throw new Error(`Expected an array of objects, but the JSON is ${describe(data)}.`)
    const sep = delimiter === 'auto' ? ',' : delimiter
    if (!data.length) return { csv: '', rows: 0, columns: 0, notices: [{ warn: false, text: 'The array is empty.' }] }

    const allObjects = data.every(isRecord)
    const allArrays = data.every(Array.isArray)
    if (!allObjects && !allArrays) {
        const first = data.findIndex(d => (isRecord(data[0]) ? !isRecord(d) : !Array.isArray(d)))
        const i = first >= 0 ? first : 0
        throw new Error(`Every item must be an object (or every item an array), but item ${i} is ${describe(data[i])}.`)
    }
    if (allArrays) {
        const rows = data.map(r => r.map(cellText))
        return { csv: Papa.unparse(rows, { delimiter: sep, newline: '\n' }), rows: rows.length, columns: Math.max(0, ...rows.map(r => r.length)), notices }
    }
    // Columns: every key of every object, in order of first appearance
    const fields = []
    const known = new Set()
    for (const obj of data) {
        for (const key of Object.keys(obj)) {
            if (!known.has(key)) {
                known.add(key)
                fields.push(key)
            }
        }
    }
    const nested = data.some(obj => Object.values(obj).some(v => v !== null && typeof v === 'object'))
    if (nested) notices.push({ warn: false, text: 'Nested objects and arrays were written as JSON text.' })
    const rows = data.map(obj => fields.map(f => cellText(obj[f])))
    return { csv: Papa.unparse({ fields, data: rows }, { delimiter: sep, newline: '\n' }), rows: rows.length, columns: fields.length, notices }
}

const looksLikeJson = (text) => /^\s*[[{]/.test(text)

export default function CsvJson() {
    const pane = usePane()
    const toast = useToast()
    const csvId = useId()
    const jsonId = useId()
    const delimiterId = useId()
    const [csv, setCsv] = useState('')
    const [json, setJson] = useState('')
    const [delimiter, setDelimiter] = useState('auto')
    const [header, setHeader] = useState(true)
    const [infer, setInfer] = useState(true)
    const [trim, setTrim] = useState(true)
    const [fileBase, setFileBase] = useState('data')
    // Result of the last conversion: { direction, error?, summary?, notices }
    const [result, setResult] = useState(null)

    const toJson = (text = csv) => {
        try {
            const r = csvToJson(text, { delimiter, header, infer, trim })
            setJson(JSON.stringify(r.json, null, 2))
            setResult({ direction: 'csv', summary: `Converted ${r.rows} row${r.rows === 1 ? '' : 's'} × ${r.columns} column${r.columns === 1 ? '' : 's'} to JSON.`, notices: r.notices })
        } catch (e) {
            setJson('')
            setResult({ direction: 'csv', error: e.message, notices: [] })
        }
    }

    const toCsv = (text = json) => {
        try {
            const r = jsonToCsv(text, { delimiter })
            setCsv(r.csv)
            setResult({ direction: 'json', summary: `Converted ${r.rows} row${r.rows === 1 ? '' : 's'} × ${r.columns} column${r.columns === 1 ? '' : 's'} to CSV.`, notices: r.notices })
        } catch (e) {
            setCsv('')
            setResult({ direction: 'json', error: e.message, notices: [] })
        }
    }

    const loadText = (text) => {
        if (looksLikeJson(text)) {
            setJson(text)
            toCsv(text)
        } else {
            setCsv(text)
            toJson(text)
        }
    }

    const openFile = async ([file]) => {
        if (!file) return
        try {
            const text = await file.text()
            setFileBase(splitFilename(file.name).base || 'data')
            if (/\.json$/i.test(file.name) || (!/\.(csv|tsv|txt)$/i.test(file.name) && looksLikeJson(text))) {
                setJson(text)
                toCsv(text)
            } else {
                if (/\.tsv$/i.test(file.name)) setDelimiter('\t')
                setCsv(text)
                toJson(text)
            }
        } catch {
            toast.error(`Couldn’t read ${file.name}`)
        }
    }

    useSmartInput({ input: () => {} }, { onInject: (values) => typeof values.input === 'string' && loadText(values.input) })

    useRegisterAIContext({
        tool: 'CSV ↔ JSON',
        getContext: () => ({ input: csv, output: json }),
        suggestedPrompts: ['Summarize this data', 'Which columns look like IDs or dates?', 'Spot rows with suspicious values'],
    })

    const optionLabel = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }
    const stacked = pane.size === 'sm'
    const csvError = result?.direction === 'csv' && result.error
    const jsonError = result?.direction === 'json' && result.error

    return (
        <div className="page page-wide page-csv-json">
            <ToolHeader />

            <section className="card card-compact" aria-label="Options" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-lg)' }}>
                <label htmlFor={delimiterId} style={optionLabel}>
                    Delimiter
                    <select id={delimiterId} value={delimiter} onChange={e => setDelimiter(e.target.value)} style={{ width: 'auto', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}>
                        {DELIMITERS.map(d => <option key={d.label} value={d.value}>{d.label}</option>)}
                    </select>
                </label>
                <label style={optionLabel}>
                    <input type="checkbox" checked={header} onChange={e => setHeader(e.target.checked)} />
                    First row is a header
                </label>
                <label style={optionLabel} title="Turn 42, 3.5, true, false and null into JSON values (values like 007 stay text)">
                    <input type="checkbox" checked={infer} onChange={e => setInfer(e.target.checked)} />
                    Detect numbers and booleans
                </label>
                <label style={optionLabel}>
                    <input type="checkbox" checked={trim} onChange={e => setTrim(e.target.checked)} />
                    Trim spaces
                </label>
                <FileDropZone
                    compact
                    accept=".csv,.tsv,.txt,.json,text/csv,text/plain,application/json"
                    onFiles={openFile}
                    icon={FileUp}
                    label="Open a CSV or JSON file"
                    ariaLabel="Open a CSV or JSON file"
                    maxSizeMB={50}
                    style={{ padding: '0.5rem 0.9rem', marginLeft: stacked ? 0 : 'auto', fontSize: '0.85rem' }}
                />
            </section>

            {result && (result.error ? (
                <StatusBanner tone="danger" title={result.direction === 'csv' ? 'Couldn’t convert the CSV' : 'Couldn’t convert the JSON'}>
                    {result.error}
                </StatusBanner>
            ) : (
                <StatusBanner tone={result.notices.some(n => n.warn) ? 'warning' : 'success'} title={result.summary}>
                    {result.notices.length ? result.notices.map(n => n.text).join(' ') : null}
                </StatusBanner>
            ))}

            <div className="split-pane">
                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <label htmlFor={csvId} className="section-title"><FileSpreadsheet size={16} aria-hidden="true" /> CSV</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                            <PipelineRead onRead={(text) => { setCsv(text); toJson(text) }} />
                            <button type="button" className="icon-btn" onClick={() => downloadText(csv, `${fileBase}.csv`, 'text/csv;charset=utf-8')} disabled={!csv} aria-label="Download CSV" title="Download CSV">
                                <Download size={14} aria-hidden="true" />
                            </button>
                            <CopyButton text={csv} iconOnly size="md" label="Copy CSV" />
                            <button type="button" className="icon-btn" onClick={() => { setCsv(''); setResult(null) }} disabled={!csv} aria-label="Clear CSV" title="Clear CSV">
                                <Trash2 size={14} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                    <textarea
                        id={csvId}
                        value={csv}
                        onChange={e => setCsv(e.target.value)}
                        placeholder={'id,name,role\n1,Alice,Admin\n2,Bob,User'}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoComplete="off"
                        aria-invalid={csvError ? true : undefined}
                        className={csvError ? 'field-invalid' : ''}
                        style={{ minHeight: 'clamp(240px, 45vh, 560px)', fontSize: '0.85rem', lineHeight: 1.5, padding: '0.75rem', whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-primary" onClick={() => toJson()} disabled={!csv.trim()}>
                            CSV to JSON {stacked ? <ArrowDown size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCsv(SAMPLE_CSV); toJson(SAMPLE_CSV) }}>
                            Load sample
                        </button>
                        <PipelineSend dataToSend={csv} style={{ marginLeft: 'auto' }} />
                    </div>
                </div>

                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <label htmlFor={jsonId} className="section-title"><Braces size={16} aria-hidden="true" /> JSON</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                            <PipelineRead onRead={(text) => { setJson(text); toCsv(text) }} />
                            <button type="button" className="icon-btn" onClick={() => downloadText(json, `${fileBase}.json`, 'application/json')} disabled={!json} aria-label="Download JSON" title="Download JSON">
                                <Download size={14} aria-hidden="true" />
                            </button>
                            <CopyButton text={json} iconOnly size="md" label="Copy JSON" />
                            <button type="button" className="icon-btn" onClick={() => { setJson(''); setResult(null) }} disabled={!json} aria-label="Clear JSON" title="Clear JSON">
                                <Trash2 size={14} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                    <textarea
                        id={jsonId}
                        value={json}
                        onChange={e => setJson(e.target.value)}
                        placeholder={'[\n  { "id": 1, "name": "Alice" }\n]'}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoComplete="off"
                        aria-invalid={jsonError ? true : undefined}
                        className={jsonError ? 'field-invalid' : ''}
                        style={{ minHeight: 'clamp(240px, 45vh, 560px)', fontSize: '0.85rem', lineHeight: 1.5, padding: '0.75rem' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-primary" onClick={() => toCsv()} disabled={!json.trim()}>
                            {stacked ? <ArrowDown size={16} aria-hidden="true" style={{ transform: 'rotate(180deg)' }} /> : <ArrowRight size={16} aria-hidden="true" style={{ transform: 'rotate(180deg)' }} />} JSON to CSV
                        </button>
                        <PipelineSend dataToSend={json} style={{ marginLeft: 'auto' }} />
                    </div>
                </div>
            </div>
        </div>
    )
}
