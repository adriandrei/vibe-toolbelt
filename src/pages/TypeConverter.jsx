import React, { useState, useMemo } from 'react'
import { Copy, Check, FileCode, ArrowRightLeft, Braces, Sparkles } from 'lucide-react'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// Recursive Type Generation Engine
function jsonToTypeScript(val, name = 'RootObject') {
    const subInterfaces = []
    
    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1)
    }

    function buildInterface(obj, interfaceName) {
        if (obj === null || typeof obj !== 'object') return
        
        let str = `export interface ${interfaceName} {\n`
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const value = obj[key]
                const type = typeof value
                
                if (value === null) {
                    str += `    ${key}: any;\n`
                } else if (Array.isArray(value)) {
                    if (value.length === 0) {
                        str += `    ${key}: any[];\n`
                    } else {
                        const firstElem = value[0]
                        const firstType = typeof firstElem
                        if (firstElem === null) {
                            str += `    ${key}: any[];\n`
                        } else if (firstType === 'object') {
                            const childName = capitalize(key) + 'Item'
                            str += `    ${key}: ${childName}[];\n`
                            buildInterface(firstElem, childName)
                        } else {
                            str += `    ${key}: ${firstType}[];\n`
                        }
                    }
                } else if (type === 'object') {
                    const childName = capitalize(key)
                    str += `    ${key}: ${childName};\n`
                    buildInterface(value, childName)
                } else {
                    str += `    ${key}: ${type};\n`
                }
            }
        }
        str += `}`
        subInterfaces.push(str)
    }

    buildInterface(val, name)
    return subInterfaces.reverse().join('\n\n')
}

function jsonToGo(val, name = 'RootObject') {
    const subStructs = []
    
    function capitalize(str) {
        return str.replace(/(^\w|_\w|-\w)/g, (match) => match.replace(/[-_]/g, '').toUpperCase())
    }

    function buildStruct(obj, structName) {
        if (obj === null || typeof obj !== 'object') return
        
        let str = `type ${structName} struct {\n`
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const value = obj[key]
                const type = typeof value
                const goName = capitalize(key)
                
                if (value === null) {
                    str += `    ${goName} interface{} \`json:"${key}"\`\n`
                } else if (Array.isArray(value)) {
                    if (value.length === 0) {
                        str += `    ${goName} []interface{} \`json:"${key}"\`\n`
                    } else {
                        const firstElem = value[0]
                        const firstType = typeof firstElem
                        if (firstElem === null) {
                            str += `    ${goName} []interface{} \`json:"${key}"\`\n`
                        } else if (firstType === 'object') {
                            const childName = capitalize(key) + 'Item'
                            str += `    ${goName} []${childName} \`json:"${key}"\`\n`
                            buildStruct(firstElem, childName)
                        } else {
                            let goType = firstType === 'number' ? 'float64' : firstType
                            str += `    ${goName} []${goType} \`json:"${key}"\`\n`
                        }
                    }
                } else if (type === 'object') {
                    const childName = capitalize(key)
                    str += `    ${goName} ${childName} \`json:"${key}"\`\n`
                    buildStruct(value, childName)
                } else {
                    let goType = type === 'number' ? 'float64' : type === 'boolean' ? 'bool' : type
                    str += `    ${goName} ${goType} \`json:"${key}"\`\n`
                }
            }
        }
        str += `}`
        subStructs.push(str)
    }

    buildStruct(val, name)
    return subStructs.reverse().join('\n\n')
}

function jsonToJsonSchema(val) {
    function buildSchema(obj) {
        if (obj === null) return { type: "null" }
        
        const type = typeof obj
        if (Array.isArray(obj)) {
            if (obj.length === 0) {
                return { type: "array", items: {} }
            }
            return { type: "array", items: buildSchema(obj[0]) }
        } else if (type === 'object') {
            const properties = {}
            const required = []
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    properties[key] = buildSchema(obj[key])
                    required.push(key)
                }
            }
            return {
                type: "object",
                properties,
                required
            }
        } else {
            let schemaType = type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'string'
            return { type: schemaType }
        }
    }
    
    const schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "GeneratedSchema",
        ...buildSchema(val)
    }
    return JSON.stringify(schema, null, 2)
}

export default function TypeConverter() {
    useDocumentTitle('Type Converter')
    const [jsonInput, setJsonInput] = useState('{\n  "id": 101,\n  "name": "Vibe Workstation",\n  "active": true,\n  "tags": ["frontend", "offline"],\n  "owner": {\n    "name": "Jane",\n    "role": "Lead Developer"\n  }\n}')
    const [targetType, setTargetType] = useState('typescript') // 'typescript' | 'go' | 'schema'
    const [copied, setCopied] = useState(false)

    // Parsing & validation
    const parsedData = useMemo(() => {
        if (!jsonInput.trim()) return { error: 'Please enter JSON code' }
        try {
            const data = JSON.parse(jsonInput.trim())
            return { data }
        } catch (err) {
            return { error: 'Invalid JSON: ' + err.message }
        }
    }, [jsonInput])

    // Target structural output
    const conversionResult = useMemo(() => {
        if (parsedData.error) return ''
        const val = parsedData.data

        if (targetType === 'typescript') {
            return jsonToTypeScript(val)
        } else if (targetType === 'go') {
            return jsonToGo(val)
        } else if (targetType === 'schema') {
            return jsonToJsonSchema(val)
        }
        return ''
    }, [parsedData, targetType])

    // AI context hook registration
    useRegisterAIContext({
        tool: 'JSON to Type Converter',
        getContext: () => ({
            input: jsonInput,
            output: conversionResult
        }),
        suggestedPrompts: [
            'Make this TypeScript definition support optional fields',
            'Convert these structs into Go and add XML tags too',
            'Explain the JSON schema constraints shown here',
            'Add custom regex patterns to the JSON Schema fields'
        ]
    }, [jsonInput, conversionResult])

    const handleCopy = () => {
        if (!conversionResult) return
        navigator.clipboard.writeText(conversionResult)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>JSON to Type Converter</h2>
                <p style={{ color: 'var(--text-muted)' }}>Paste raw JSON and convert it client-side into TypeScript, Go Structs, or JSON Schema.</p>
            </div>

            <div className="split-pane">
                {/* JSON Input Area */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Braces size={16} /> Raw JSON Input
                        </span>
                        {parsedData.error ? (
                            <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>✕ Invalid JSON</span>
                        ) : (
                            <span style={{ fontSize: '0.8rem', color: '#22c55e' }}>✓ Valid JSON</span>
                        )}
                    </div>
                    <textarea
                        value={jsonInput}
                        onChange={(e) => setJsonInput(e.target.value)}
                        placeholder="Paste your JSON here..."
                        style={{
                            width: '100%',
                            flex: 1,
                            minHeight: '400px',
                            background: 'var(--bg-app)',
                            border: `1px solid ${parsedData.error ? 'rgba(239, 68, 68, 0.4)' : 'var(--border)'}`,
                            borderRadius: 'var(--radius-md)',
                            padding: '12px',
                            color: 'var(--text-main)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.875rem',
                            resize: 'vertical',
                            lineHeight: 1.5
                        }}
                    />
                    {parsedData.error && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
                            {parsedData.error}
                        </div>
                    )}
                </div>

                {/* Target Type Conversion Results */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)', flexWrap: 'wrap', gap: 8 }}>
                        {/* Selector Tabs */}
                        <div style={{ display: 'flex', gap: 4 }}>
                            {['typescript', 'go', 'schema'].map(type => (
                                <button
                                    key={type}
                                    onClick={() => setTargetType(type)}
                                    style={{
                                        padding: '6px 12px',
                                        borderRadius: 'var(--radius-sm)',
                                        background: targetType === type ? 'var(--primary)' : 'rgba(255,255,255,0.02)',
                                        color: targetType === type ? '#fff' : 'var(--text-muted)',
                                        border: `1px solid ${targetType === type ? 'var(--primary)' : 'var(--border)'}`,
                                        fontSize: '0.8rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        textTransform: 'uppercase',
                                        transition: 'all 0.15s'
                                    }}
                                >
                                    {type === 'schema' ? 'JSON Schema' : type}
                                </button>
                            ))}
                        </div>

                        {/* Copy Button */}
                        {conversionResult && (
                            <button
                                onClick={handleCopy}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 12px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: 'transparent',
                                    border: '1px solid var(--border)',
                                    color: copied ? '#22c55e' : 'var(--text-muted)',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s'
                                }}
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                {copied ? 'Copied!' : 'Copy Schema'}
                            </button>
                        )}
                    </div>

                    {/* Result block */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '400px' }}>
                        <textarea
                            readOnly
                            value={conversionResult}
                            placeholder="Result will appear here..."
                            style={{
                                width: '100%',
                                flex: 1,
                                background: 'rgba(0,0,0,0.2)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-md)',
                                padding: '12px',
                                color: '#a5b4fc',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.875rem',
                                resize: 'none',
                                lineHeight: 1.5,
                                outline: 'none'
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
