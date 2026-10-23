import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Faker, base, en, en_US } from '@faker-js/faker'
import { Download, Plus, RefreshCw, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineSend } from '../components/PipelineFeature'
import { downloadText, formatBytes } from '../utils/download'
import {
    MAX_BYTES, MAX_DEPTH, MAX_VALUES, SQL_DIALECTS,
    estimateRow, fieldKey, isContainer, toCsv, toSql, uniqueName, validateSchema,
} from '../utils/fakeData'

// A private instance, so seeding here never affects anything else
const faker = new Faker({ locale: [en_US, en, base] })

// With a seed, dates are relative to this fixed day so the output repeats exactly
const SEEDED_REFERENCE_DATE = '2026-01-01T00:00:00.000Z'

const GENERATORS = [
    {
        group: 'Person',
        items: [
            { value: 'uuid', label: 'UUID', fn: () => faker.string.uuid() },
            { value: 'fullName', label: 'Full name', fn: () => faker.person.fullName() },
            { value: 'firstName', label: 'First name', fn: () => faker.person.firstName() },
            { value: 'lastName', label: 'Last name', fn: () => faker.person.lastName() },
            { value: 'username', label: 'Username', fn: () => faker.internet.username() },
            { value: 'email', label: 'Email', fn: () => faker.internet.email() },
            { value: 'phone', label: 'Phone number', fn: () => faker.phone.number() },
            { value: 'jobTitle', label: 'Job title', fn: () => faker.person.jobTitle() },
            { value: 'avatar', label: 'Avatar URL', fn: () => faker.image.avatar() },
        ],
    },
    {
        group: 'Location',
        items: [
            { value: 'address', label: 'Street address', fn: () => faker.location.streetAddress() },
            { value: 'city', label: 'City', fn: () => faker.location.city() },
            { value: 'state', label: 'State', fn: () => faker.location.state() },
            { value: 'zipCode', label: 'ZIP code', fn: () => faker.location.zipCode() },
            { value: 'country', label: 'Country', fn: () => faker.location.country() },
        ],
    },
    {
        group: 'Internet & business',
        items: [
            { value: 'url', label: 'URL', fn: () => faker.internet.url() },
            { value: 'ipv4', label: 'IPv4 address', fn: () => faker.internet.ipv4() },
            { value: 'company', label: 'Company', fn: () => faker.company.name() },
            { value: 'color', label: 'Color (hex)', fn: () => faker.color.rgb() },
        ],
    },
    {
        group: 'Text',
        items: [
            { value: 'word', label: 'Word', fn: () => faker.lorem.word() },
            { value: 'sentence', label: 'Lorem sentence', fn: () => faker.lorem.sentence() },
            { value: 'paragraph', label: 'Lorem paragraph', fn: () => faker.lorem.paragraph() },
        ],
    },
    {
        group: 'Numbers & dates',
        items: [
            { value: 'number', label: 'Integer (0–100)', fn: () => faker.number.int({ min: 0, max: 100 }) },
            { value: 'price', label: 'Price (1.00–1000.00)', fn: () => faker.number.float({ min: 1, max: 1000, fractionDigits: 2 }) },
            { value: 'boolean', label: 'Boolean', fn: () => faker.datatype.boolean() },
            { value: 'datePast', label: 'Date in the past year', fn: () => faker.date.past().toISOString() },
            { value: 'dateRecent', label: 'Date in the last day', fn: () => faker.date.recent().toISOString() },
            { value: 'dateFuture', label: 'Date in the next year', fn: () => faker.date.future().toISOString() },
        ],
    },
]

const MAX_ROWS = 1000

const GENERATOR_BY_ID = new Map(GENERATORS.flatMap(g => g.items).map(item => [item.value, item]))

const FORMATS = {
    json: { label: 'JSON', ext: 'json', mime: 'application/json', hint: 'An array of objects.' },
    csv: { label: 'CSV', ext: 'csv', mime: 'text/csv;charset=utf-8', hint: 'Nested objects become dotted columns (user.address.city); arrays are written as JSON.' },
    sql: { label: 'SQL INSERT statements', ext: 'sql', mime: 'application/sql', hint: 'One INSERT per row. Nested objects and arrays are inserted as JSON text.' },
}

const DEFAULT_FIELDS = [
    { id: 'f1', name: 'id', type: 'uuid' },
    {
        id: 'f2',
        name: 'user',
        type: 'object',
        fields: [
            { id: 'f3', name: 'name', type: 'fullName' },
            { id: 'f4', name: 'email', type: 'email' },
            {
                id: 'f5',
                name: 'address',
                type: 'object',
                fields: [
                    { id: 'f6', name: 'street', type: 'address' },
                    { id: 'f7', name: 'city', type: 'city' },
                ],
            },
        ],
    },
    { id: 'f8', name: 'active', type: 'boolean' },
    { id: 'f9', name: 'createdAt', type: 'datePast' },
]

let lastFieldId = 100
const newFieldId = () => `f${++lastFieldId}`

// ---------- Schema tree helpers (path = list of indexes) ----------

function updateAt(tree, path, update) {
    const [index, ...rest] = path
    return tree.map((node, i) => {
        if (i !== index) return node
        if (!rest.length) return update(node)
        return { ...node, fields: updateAt(node.fields || [], rest, update) }
    })
}

function removeAt(tree, path) {
    const [index, ...rest] = path
    if (!rest.length) return tree.filter((_, i) => i !== index)
    return tree.map((node, i) => (i === index ? { ...node, fields: removeAt(node.fields || [], rest) } : node))
}

// ---------- Generation ----------

function makeObject(fields) {
    const item = {}
    for (const field of fields) item[fieldKey(field)] = makeValue(field)
    return item
}

function makeValue(field) {
    if (field.type === 'object') return makeObject(field.fields || [])
    if (field.type === 'array') {
        const length = faker.number.int({ min: 1, max: 3 })
        return Array.from({ length }, () => makeObject(field.fields || []))
    }
    const generator = GENERATOR_BY_ID.get(field.type)
    return generator ? generator.fn() : null
}

// Generates `count` rows, or explains why it can't.
function buildData(fields, count, seed) {
    if (!fields.length) return { items: null, fields, error: 'Add at least one field to generate data.' }
    if (Object.keys(validateSchema(fields)).length) {
        return { items: null, fields, error: 'Fix the highlighted fields to generate data.' }
    }
    const perRow = estimateRow(fields)
    if (perRow.values * count > MAX_VALUES || perRow.bytes * count > MAX_BYTES) {
        return {
            items: null,
            fields,
            error: `That would be up to ${formatBytes(perRow.bytes * count)} of data, more than this page can show. Use fewer rows, nested arrays or paragraph fields.`,
        }
    }
    const seedNumber = seed === '' ? null : Number(seed)
    if (seedNumber !== null && Number.isFinite(seedNumber)) {
        faker.seed(seedNumber)
        faker.setDefaultRefDate(SEEDED_REFERENCE_DATE)
    } else {
        faker.seed()
        faker.setDefaultRefDate()
    }
    return { items: Array.from({ length: count }, () => makeObject(fields)), fields, error: null }
}

// ---------- Schema editor ----------

const compactControl = { padding: '0.45rem 0.6rem', fontSize: '0.875rem', minWidth: 0 }

function FieldRow({ field, path, depth, errors, onChange, onRemove, onAdd }) {
    const id = useId()
    const error = errors[field.id]
    const container = isContainer(field)
    const canNest = depth < MAX_DEPTH
    const displayName = fieldKey(field) || 'unnamed field'
    const children = field.fields || []

    return (
        <li style={{ listStyle: 'none' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.25fr) auto', gap: 'var(--space-xs)', alignItems: 'center' }}>
                <input
                    id={id}
                    type="text"
                    value={field.name}
                    onChange={(e) => onChange(path, { name: e.target.value })}
                    aria-label="Field name"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    className={error ? 'field-invalid' : undefined}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="name"
                    style={{ ...compactControl, fontFamily: 'var(--font-mono)' }}
                />
                <select
                    value={field.type}
                    onChange={(e) => onChange(path, { type: e.target.value })}
                    aria-label={`Type of ${displayName}`}
                    style={compactControl}
                >
                    <optgroup label="Structure">
                        <option value="object" disabled={!canNest}>Nested object</option>
                        <option value="array" disabled={!canNest}>Array of objects (1–3)</option>
                    </optgroup>
                    {GENERATORS.map(group => (
                        <optgroup key={group.group} label={group.group}>
                            {group.items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </optgroup>
                    ))}
                </select>
                <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onRemove(path)}
                    aria-label={`Remove ${displayName}`}
                    title="Remove field"
                >
                    <Trash2 size={16} aria-hidden="true" />
                </button>
            </div>
            {error && <div id={`${id}-error`} className="field-error">{error}</div>}

            {container && (
                <div style={{ marginTop: 'var(--space-xs)', marginLeft: 6, paddingLeft: 'var(--space-sm)', borderLeft: '2px solid var(--border-hover)' }}>
                    {children.length > 0 ? (
                        <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', padding: 'var(--space-xs) 0' }}>
                            {children.map((child, index) => (
                                <FieldRow
                                    key={child.id}
                                    field={child}
                                    path={[...path, index]}
                                    depth={depth + 1}
                                    errors={errors}
                                    onChange={onChange}
                                    onRemove={onRemove}
                                    onAdd={onAdd}
                                />
                            ))}
                        </ul>
                    ) : (
                        <p className="field-hint" style={{ margin: 'var(--space-xs) 0' }}>No fields yet: this will be an empty {field.type === 'array' ? 'array item' : 'object'}.</p>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAdd(path)}>
                        <Plus size={14} aria-hidden="true" /> Add field to {displayName}
                    </button>
                </div>
            )}
        </li>
    )
}

// ---------- Page ----------

export default function FakerTool() {
    const [fields, setFields] = useState(DEFAULT_FIELDS)
    const rowsId = useId()
    const [count, setCount] = useState(10)
    const [countText, setCountText] = useState('10')
    const [seed, setSeed] = useState('')
    const [format, setFormat] = useState('json')
    const [dialect, setDialect] = useState('postgres')
    const [table, setTable] = useState('users')
    const [data, setData] = useState(() => buildData(DEFAULT_FIELDS, 10, ''))
    const timer = useRef(null)

    useEffect(() => () => clearTimeout(timer.current), [])

    // Rebuilds the data now (Generate button) or after a pause in typing/dragging
    const regenerate = (next = {}, delay = 0) => {
        const nextFields = next.fields ?? fields
        const nextCount = next.count ?? count
        const nextSeed = next.seed ?? seed
        clearTimeout(timer.current)
        const run = () => setData(buildData(nextFields, nextCount, nextSeed))
        if (delay) timer.current = setTimeout(run, delay)
        else run()
    }

    const changeCount = (value, delay) => {
        setCount(value)
        setCountText(String(value))
        regenerate({ count: value }, delay)
    }

    const editFields = (nextFields) => {
        setFields(nextFields)
        regenerate({ fields: nextFields }, 300)
    }

    const changeField = (path, patch) => editFields(updateAt(fields, path, (node) => {
        const next = { ...node, ...patch }
        // A new container starts with one field so it isn't empty
        if (patch.type && isContainer(next) && !(next.fields || []).length) {
            next.fields = [{ id: newFieldId(), name: 'field_1', type: 'fullName' }]
        }
        return next
    }))

    const addChild = (path) => editFields(updateAt(fields, path, (node) => ({
        ...node,
        fields: [...(node.fields || []), { id: newFieldId(), name: uniqueName(node.fields || []), type: 'fullName' }],
    })))

    const addRootField = () => editFields([...fields, { id: newFieldId(), name: uniqueName(fields), type: 'fullName' }])
    const removeField = (path) => editFields(removeAt(fields, path))

    const fieldErrors = useMemo(() => validateSchema(fields), [fields])

    // Format, dialect and table only change how the same rows are written
    const output = useMemo(() => {
        if (!data.items) return { text: '', bytes: 0, error: data.error }
        try {
            let text
            if (format === 'csv') text = toCsv(data.items, data.fields)
            else if (format === 'sql') text = toSql(data.items, data.fields, { dialect, table })
            else text = JSON.stringify(data.items, null, 2)
            return { text, bytes: new Blob([text]).size, error: null }
        } catch (error) {
            return { text: '', bytes: 0, error: error.message }
        }
    }, [data, format, dialect, table])

    const formatInfo = FORMATS[format]
    const rowCount = data.items?.length ?? 0

    return (
        <div className="page page-wide page-faker">
            <ToolHeader />

            <div className="split-pane" style={{ alignItems: 'start' }}>
                {/* Controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <section className="card card-compact" aria-label="Output options" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                        <Field label="Format" hint={formatInfo.hint}>
                            <select value={format} onChange={(e) => setFormat(e.target.value)}>
                                {Object.entries(FORMATS).map(([value, info]) => <option key={value} value={value}>{info.label}</option>)}
                            </select>
                        </Field>

                        {format === 'sql' && (
                            <div className="auto-grid" style={{ '--auto-grid-min': '11rem' }}>
                                <Field label="SQL dialect" hint="Sets identifier quoting, booleans and strings.">
                                    <select value={dialect} onChange={(e) => setDialect(e.target.value)}>
                                        {SQL_DIALECTS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                                    </select>
                                </Field>
                                <Field label="Table name" hint="Use schema.table to qualify it." error={table.trim() ? undefined : 'Enter a table name'}>
                                    <input type="text" value={table} onChange={(e) => setTable(e.target.value)} spellCheck={false} autoComplete="off" style={{ fontFamily: 'var(--font-mono)' }} />
                                </Field>
                            </div>
                        )}

                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                                <label className="field-label" htmlFor={rowsId} style={{ marginBottom: 0 }}>Rows</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={MAX_ROWS}
                                    step={1}
                                    value={countText}
                                    aria-label="Number of rows"
                                    onChange={(e) => {
                                        setCountText(e.target.value)
                                        const n = e.target.valueAsNumber
                                        if (Number.isInteger(n) && n >= 1 && n <= MAX_ROWS) changeCount(n, 300)
                                    }}
                                    onBlur={() => setCountText(String(count))}
                                    style={{ width: '6.5rem', padding: '0.3rem 0.5rem', fontSize: '0.875rem', textAlign: 'right' }}
                                />
                            </div>
                            <input
                                id={rowsId}
                                type="range"
                                min={1}
                                max={MAX_ROWS}
                                step={1}
                                value={count}
                                aria-valuetext={`${count} rows`}
                                onChange={(e) => changeCount(Number(e.target.value), 200)}
                            />
                        </div>

                        <Field label="Seed (optional)" hint="The same seed and schema always give the same data (dates are then relative to 1 January 2026).">
                            <input
                                type="number"
                                inputMode="numeric"
                                step="1"
                                value={seed}
                                placeholder="Random"
                                onChange={(e) => {
                                    setSeed(e.target.value)
                                    regenerate({ seed: e.target.value }, 300)
                                }}
                            />
                        </Field>
                    </section>

                    <section className="card card-compact" aria-labelledby="faker-fields-title" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        <h2 id="faker-fields-title" className="section-title">Fields</h2>
                        {fields.length > 0 ? (
                            <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                                {fields.map((field, index) => (
                                    <FieldRow
                                        key={field.id}
                                        field={field}
                                        path={[index]}
                                        depth={0}
                                        errors={fieldErrors}
                                        onChange={changeField}
                                        onRemove={removeField}
                                        onAdd={addChild}
                                    />
                                ))}
                            </ul>
                        ) : (
                            <p className="field-hint">No fields yet. Add one to start.</p>
                        )}
                        <button type="button" className="btn btn-secondary btn-sm" onClick={addRootField} style={{ alignSelf: 'flex-start' }}>
                            <Plus size={14} aria-hidden="true" /> Add field
                        </button>
                    </section>

                    <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => regenerate()}>
                        <RefreshCw size={16} aria-hidden="true" /> Generate data
                    </button>
                </div>

                {/* Output */}
                <div style={{ minWidth: 0 }}>
                    <section className="card card-compact" aria-labelledby="faker-output-title" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                                <h2 id="faker-output-title" className="section-title">Output</h2>
                                {output.text && (
                                    <span className="field-hint" style={{ marginTop: 0 }}>
                                        {rowCount.toLocaleString()} row{rowCount === 1 ? '' : 's'} · {formatInfo.label.split(' ')[0]} · {formatBytes(output.bytes)}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                <CopyButton text={output.text} />
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={!output.text}
                                    onClick={() => downloadText(output.text, `fake-data.${formatInfo.ext}`, formatInfo.mime)}
                                >
                                    <Download size={14} aria-hidden="true" /> Download .{formatInfo.ext}
                                </button>
                                <PipelineSend dataToSend={output.text} disabled={!output.text} />
                            </div>
                        </div>

                        {output.error && <StatusBanner tone="danger">{output.error}</StatusBanner>}

                        <textarea
                            readOnly
                            value={output.text}
                            aria-label="Generated data"
                            placeholder="Generated data will appear here..."
                            spellCheck={false}
                            wrap="off"
                            style={{
                                minHeight: 320,
                                height: '62vh',
                                maxHeight: 760,
                                background: 'var(--bg-inset)',
                                color: 'var(--text-code)',
                                fontSize: '0.8rem',
                                lineHeight: 1.5,
                                whiteSpace: 'pre',
                                overflow: 'auto',
                            }}
                        />
                    </section>
                </div>
            </div>
        </div>
    )
}
