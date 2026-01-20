import React, { useState } from 'react'
import { faker } from '@faker-js/faker'
import { Copy, RefreshCw, Plus, Trash2 } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const FIELD_TYPES = [
    { label: 'UUID', value: 'uuid', fn: () => faker.string.uuid() },
    { label: 'Full Name', value: 'fullName', fn: () => faker.person.fullName() },
    { label: 'Email', value: 'email', fn: () => faker.internet.email() },
    { label: 'Phone', value: 'phone', fn: () => faker.phone.number() },
    { label: 'Address', value: 'address', fn: () => faker.location.streetAddress() },
    { label: 'Company', value: 'company', fn: () => faker.company.name() },
    { label: 'Job Title', value: 'jobTitle', fn: () => faker.person.jobTitle() },
    { label: 'City', value: 'city', fn: () => faker.location.city() },
    { label: 'Country', value: 'country', fn: () => faker.location.country() },
    { label: 'Date (Past)', value: 'datePast', fn: () => faker.date.past().toISOString() },
    { label: 'Date (Future)', value: 'dateFuture', fn: () => faker.date.future().toISOString() },
    { label: 'Number (0-100)', value: 'number', fn: () => faker.number.int({ min: 0, max: 100 }) },
    { label: 'Boolean', value: 'boolean', fn: () => faker.datatype.boolean() },
    { label: 'Color (Hex)', value: 'color', fn: () => faker.internet.color() },
    { label: 'Avatar URL', value: 'avatar', fn: () => faker.image.avatar() },
    { label: 'Lorum Paragraph', value: 'paragraph', fn: () => faker.lorem.paragraph() },
]

export default function FakerTool() {
    useDocumentTitle('Fake Data Generator')
    const [count, setCount] = useState(10)
    const [format, setFormat] = useState('json') // json, csv, sql
    const [fields, setFields] = useState([
        { id: 1, name: 'id', type: 'uuid' },
        { id: 2, name: 'name', type: 'fullName' },
        { id: 3, name: 'email', type: 'email' }
    ])

    const [data, setData] = useState('')

    const addField = () => {
        setFields([...fields, { id: Date.now(), name: 'field_' + fields.length, type: 'fullName' }])
    }

    const removeField = (id) => {
        setFields(fields.filter(f => f.id !== id))
    }

    const updateField = (id, key, value) => {
        setFields(fields.map(f => f.id === id ? { ...f, [key]: value } : f))
    }

    const generate = () => {
        const items = []
        for (let i = 0; i < count; i++) {
            const item = {}
            fields.forEach(field => {
                const typeDef = FIELD_TYPES.find(t => t.value === field.type)
                if (typeDef) {
                    item[field.name] = typeDef.fn()
                }
            })
            items.push(item)
        }

        if (format === 'json') {
            setData(JSON.stringify(items, null, 2))
        } else if (format === 'csv') {
            if (items.length === 0) return setData('')
            const headers = Object.keys(items[0]).join(',')
            const rows = items.map(item => Object.values(item).map(v => `"${v}"`).join(',')).join('\n')
            setData(`${headers}\n${rows}`)
        } else if (format === 'sql') {
            if (items.length === 0) return setData('')
            const table = 'users'
            const headers = Object.keys(items[0]).join(', ')
            const rows = items.map(item =>
                `INSERT INTO ${table} (${headers}) VALUES (${Object.values(item).map(v =>
                    typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v
                ).join(', ')});`
            ).join('\n')
            setData(rows)
        }
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(350px, 1fr) 2fr', gap: 'var(--space-xl)' }}>
            {/* Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <h2 className="text-gradient">Schema Builder</h2>

                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <div style={{ marginBottom: 'var(--space-md)' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Quantity ({count})</label>
                        <input type="range" min="1" max="1000" value={count} onChange={e => setCount(Number(e.target.value))} style={{ width: '100%' }} />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Format</label>
                        <select value={format} onChange={e => setFormat(e.target.value)} style={{ width: '100%', padding: '8px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 6 }}>
                            <option value="json">JSON</option>
                            <option value="csv">CSV</option>
                            <option value="sql">SQL Insert</option>
                        </select>
                    </div>
                </div>

                <div className="glass-panel" style={{ padding: 'var(--space-md)', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-sm)', fontWeight: 600 }}>Fields</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: '400px', paddingRight: 4 }}>
                        {fields.map((field) => (
                            <div key={field.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={field.name}
                                    onChange={e => updateField(field.id, 'name', e.target.value)}
                                    placeholder="Field Name"
                                    style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-main)' }}
                                />
                                <select
                                    value={field.type}
                                    onChange={e => updateField(field.id, 'type', e.target.value)}
                                    style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-main)' }}
                                >
                                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                                <button
                                    onClick={() => removeField(field.id)}
                                    style={{ color: '#ef4444', padding: 4, background: 'none', border: 'none', cursor: 'pointer' }}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={addField}
                        style={{
                            marginTop: 'var(--space-md)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                            padding: 8,
                            border: '1px dashed var(--border)',
                            borderRadius: 6,
                            color: 'var(--text-muted)',
                            cursor: 'pointer'
                        }}
                    >
                        <Plus size={14} /> Add Field
                    </button>
                </div>

                <button
                    onClick={generate}
                    className="glass-panel"
                    style={{
                        padding: '12px',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 8,
                        background: 'var(--primary)',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: 'pointer'
                    }}
                >
                    <RefreshCw size={16} /> Generate Data
                </button>
            </div>

            {/* Output */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <h2 className="text-gradient">Output</h2>

                <div className="glass-panel" style={{ padding: 'var(--space-md)', flex: 1, position: 'relative' }}>
                    <button
                        onClick={() => navigator.clipboard.writeText(data)}
                        style={{
                            position: 'absolute',
                            top: 10,
                            right: 10,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            color: 'var(--primary)'
                        }}
                    >
                        <Copy size={14} /> Copy
                    </button>
                    <textarea
                        value={data}
                        readOnly
                        style={{
                            width: '100%',
                            height: '100%',
                            minHeight: '600px',
                            background: 'transparent',
                            border: 'none',
                            resize: 'none',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem'
                        }}
                        placeholder="Generated data will appear here..."
                    />
                </div>
            </div>
        </div>
    )
}
