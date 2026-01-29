import React, { useState, useEffect } from 'react'
import yaml from 'js-yaml'
import toml from 'toml'
import { ArrowRight, Copy, Trash2, ArrowRightLeft } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// XML Helpers
const jsonToXml = (obj) => {
    const toXml = (o, name) => {
        if (typeof o !== 'object' || o === null) return `<${name}>${o}</${name}>`
        if (Array.isArray(o)) return o.map(val => toXml(val, name)).join('')

        let xml = ''
        Object.entries(o).forEach(([key, val]) => {
            xml += toXml(val, key)
        })
        return name ? `<${name}>${xml}</${name}>` : xml
    }
    return toXml(obj, 'root') // Wrap in root by default
}

const xmlToJson = (xmlStr) => {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlStr, "text/xml")

    const toJson = (node) => {
        if (node.nodeType === 3) return node.nodeValue.trim() // Text

        // Children
        const obj = {}
        if (node.childNodes.length === 1 && node.childNodes[0].nodeType === 3) {
            return node.childNodes[0].nodeValue
        }

        node.childNodes.forEach(child => {
            if (child.nodeType === 1) { // Element
                const name = child.nodeName
                const val = toJson(child)
                if (obj[name]) {
                    if (!Array.isArray(obj[name])) obj[name] = [obj[name]]
                    obj[name].push(val)
                } else {
                    obj[name] = val
                }
            }
        })
        return obj
    }

    return toJson(xmlDoc.documentElement)
}

export default function Converter() {
    useDocumentTitle('Universal Converter')
    const [left, setLeft] = useState('')
    const [right, setRight] = useState('')
    const [error, setError] = useState(null)
    const [fromFormat, setFromFormat] = useState('json')
    const [toFormat, setToFormat] = useState('yaml')

    useEffect(() => {
        if (!left.trim()) {
            setRight('')
            setError(null)
            return
        }

        try {
            setError(null)
            let jsonObj = null

            // 1. Parse Input to JSON Object
            switch (fromFormat) {
                case 'json': jsonObj = JSON.parse(left); break;
                case 'yaml': jsonObj = yaml.load(left); break;
                case 'toml': jsonObj = toml.parse(left); break;
                case 'xml': jsonObj = xmlToJson(left); break;
                default: throw new Error('Unknown input format');
            }

            // 2. Stringify JSON Object to Output
            let result = ''
            switch (toFormat) {
                case 'json': result = JSON.stringify(jsonObj, null, 2); break;
                case 'yaml': result = yaml.dump(jsonObj); break;
                case 'xml': result = jsonToXml(jsonObj); break;
                case 'toml': result = "TOML Export not supported in this version (Parser only)"; break;
                default: throw new Error('Unknown output format');
            }

            setRight(result)
        } catch (e) {
            setError(e.message)
        }
    }, [left, fromFormat, toFormat])

    const swap = () => {
        setLeft(right)
        setRight(left)
        setFromFormat(toFormat)
        setToFormat(fromFormat)
    }

    const FORMATS = [
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
        { value: 'toml', label: 'TOML' },
        { value: 'xml', label: 'XML' },
    ]

    return (
        <div style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
                <h2 className="text-gradient">Universal Converter</h2>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-md)', alignItems: 'center', marginTop: 'var(--space-md)' }}>
                    <select
                        value={fromFormat}
                        onChange={e => setFromFormat(e.target.value)}
                        style={{ padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-main)' }}
                    >
                        {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>

                    <button onClick={swap} className="glass-panel" style={{ padding: 8, cursor: 'pointer', color: 'var(--primary)' }}>
                        <ArrowRightLeft size={16} />
                    </button>

                    <select
                        value={toFormat}
                        onChange={e => setToFormat(e.target.value)}
                        style={{ padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-main)' }}
                    >
                        {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                </div>
            </div>

            <div className="split-pane">
                {/* Input */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)' }}>Input</label>
                        <button onClick={() => setLeft('')} style={{ color: 'var(--text-muted)' }}><Trash2 size={14} /></button>
                    </div>
                    <textarea
                        value={left}
                        onChange={e => setLeft(e.target.value)}
                        style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.85rem', background: 'rgba(0,0,0,0.2)', resize: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text-main)' }}
                        placeholder={`Paste ${fromFormat.toUpperCase()} here...`}
                    />
                </div>

                {/* Output */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)' }}>Output</label>
                        <button
                            onClick={() => navigator.clipboard.writeText(right)}
                            style={{ color: 'var(--primary)', display: 'flex', gap: 4, alignItems: 'center' }}
                        >
                            <Copy size={14} /> Copy
                        </button>
                    </div>
                    <textarea
                        readOnly
                        value={right}
                        style={{
                            flex: 1,
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            resize: 'none',
                            background: 'rgba(0,0,0,0.2)',
                            border: error ? '1px solid #ef4444' : '1px solid var(--border)',
                            borderRadius: 6,
                            padding: 8,
                            color: 'var(--text-main)'
                        }}
                    />
                    {error && (
                        <div style={{
                            position: 'absolute',
                            bottom: 'var(--space-md)',
                            left: 'var(--space-md)',
                            right: 'var(--space-md)',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid #ef4444',
                            color: '#ef4444',
                            padding: '8px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.8rem'
                        }}>
                            {error}
                        </div>
                    )}
                </div>
            </div>
        </div >
    )
}
