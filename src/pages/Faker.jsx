import React, { useState } from 'react'
import { fakerEN_US as faker } from '@faker-js/faker'
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

const FieldNode = ({ field, updateField, removeField, addNestedField, path = [] }) => {
    const isParent = field.type === 'object' || field.type === 'array'

    return (
        <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                    type="text"
                    value={field.name}
                    onChange={e => updateField(path, 'name', e.target.value)}
                    placeholder="Field Name"
                    style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-main)' }}
                />
                <select
                    value={field.type}
                    onChange={e => updateField(path, 'type', e.target.value)}
                    style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-main)' }}
                >
                    <optgroup label="Structure">
                        <option value="object">Nested Object</option>
                        <option value="array">Array of Objects</option>
                    </optgroup>
                    <optgroup label="Data Types">
                        {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </optgroup>
                </select>
                <button
                    onClick={() => removeField(path)}
                    style={{ color: '#ef4444', padding: 4, background: 'none', border: 'none', cursor: 'pointer' }}
                >
                    <Trash2 size={16} />
                </button>
            </div>
            {isParent && (
                <div style={{ marginLeft: 8, paddingLeft: 12, marginTop: 8, borderLeft: '2px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(field.fields || []).map((child, idx) => (
                        <FieldNode 
                            key={child.id} 
                            field={child} 
                            updateField={updateField} 
                            removeField={removeField} 
                            addNestedField={addNestedField} 
                            path={[...path, idx]} 
                        />
                    ))}
                    <button
                        onClick={() => addNestedField(path)}
                        style={{ alignSelf: 'flex-start', marginTop: 4, padding: '4px 8px', fontSize: '0.8rem', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                        <Plus size={12} /> Add Field to {field.name || 'Object'}
                    </button>
                </div>
            )}
        </div>
    )
}

export default function FakerTool() {
    useDocumentTitle('Fake Data Generator')
    const [count, setCount] = useState(10)
    const [format, setFormat] = useState('json') // json, csv, sql
    const [fields, setFields] = useState([
        { id: 1, name: 'id', type: 'uuid' },
        { 
            id: 2, 
            name: 'user', 
            type: 'object',
            fields: [
                { id: 21, name: 'name', type: 'fullName' },
                { id: 22, name: 'email', type: 'email' },
                { 
                    id: 23, 
                    name: 'address', 
                    type: 'object',
                    fields: [
                        { id: 231, name: 'street', type: 'address' },
                        { id: 232, name: 'city', type: 'city' }
                    ]
                }
            ]
        }
    ])

    const [data, setData] = useState('')

    const updateTree = (tree, path, callback) => {
        const newTree = [...tree];
        let currentLevel = newTree;
        for (let i = 0; i < path.length - 1; i++) {
            currentLevel[path[i]] = { ...currentLevel[path[i]], fields: [...(currentLevel[path[i]].fields || [])] };
            currentLevel = currentLevel[path[i]].fields;
        }
        const targetIdx = path[path.length - 1];
        currentLevel[targetIdx] = callback(currentLevel[targetIdx]);
        return newTree;
    }

    const removeFieldFromTree = (tree, path) => {
        const newTree = [...tree];
        let currentLevel = newTree;
        for (let i = 0; i < path.length - 1; i++) {
            currentLevel[path[i]] = { ...currentLevel[path[i]], fields: [...(currentLevel[path[i]].fields || [])] };
            currentLevel = currentLevel[path[i]].fields;
        }
        currentLevel.splice(path[path.length - 1], 1);
        return newTree;
    }

    const addField = () => {
        setFields(prev => [...prev, { id: Date.now(), name: 'field_' + prev.length, type: 'fullName' }])
    }

    const addNestedField = (path) => {
        setFields(prev => updateTree(prev, path, node => ({
            ...node,
            fields: [...(node.fields || []), { id: Date.now(), name: 'newField', type: 'fullName' }]
        })))
    }

    const removeField = (path) => {
        setFields(prev => removeFieldFromTree(prev, path))
    }

    const updateField = (path, key, value) => {
        setFields(prev => updateTree(prev, path, node => ({ ...node, [key]: value })))
    }

    const generateItem = (fieldsDef) => {
        const item = {};
        fieldsDef.forEach(field => {
            if (field.type === 'object') {
                item[field.name] = generateItem(field.fields || []);
            } else if (field.type === 'array') {
                const len = Math.floor(Math.random() * 3) + 1; // Generate 1-3 items
                item[field.name] = Array.from({ length: len }).map(() => generateItem(field.fields || []));
            } else {
                const typeDef = FIELD_TYPES.find(t => t.value === field.type);
                if (typeDef) {
                    item[field.name] = typeDef.fn();
                }
            }
        });
        return item;
    };

    const generate = () => {
        const items = []
        for (let i = 0; i < count; i++) {
            items.push(generateItem(fields))
        }

        if (format === 'json') {
            setData(JSON.stringify(items, null, 2))
        } else if (format === 'csv') {
            if (items.length === 0) return setData('')
            const headers = fields.map(f => f.name).join(',')
            const rows = items.map(item => fields.map(f => {
                const val = item[f.name];
                return `"${typeof val === 'object' ? JSON.stringify(val).replace(/"/g, '""') : val}"`;
            }).join(',')).join('\n')
            setData(`${headers}\n${rows}`)
        } else if (format === 'sql') {
            if (items.length === 0) return setData('')
            const table = 'users'
            const headers = fields.map(f => f.name).join(', ')
            const rows = items.map(item =>
                `INSERT INTO ${table} (${headers}) VALUES (${fields.map(f => {
                    const val = item[f.name];
                    return typeof val === 'object' 
                        ? `'${JSON.stringify(val).replace(/'/g, "''")}'`
                        : typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : val;
                }).join(', ')});`
            ).join('\n')
            setData(rows)
        }
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div className="split-pane">
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

                    <div className="glass-panel" style={{ padding: 'var(--space-md)', flex: 1, display: 'flex', flexDirection: 'column', maxHeight: '500px' }}>
                        <label style={{ display: 'block', marginBottom: 'var(--space-sm)', fontWeight: 600 }}>Fields</label>
                        <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingRight: 4, flex: 1 }}>
                            {fields.map((field, idx) => (
                                <FieldNode 
                                    key={field.id} 
                                    field={field} 
                                    updateField={updateField} 
                                    removeField={removeField} 
                                    addNestedField={addNestedField} 
                                    path={[idx]} 
                                />
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
                            <Plus size={14} /> Add Root Field
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
        </div>
    )
}
