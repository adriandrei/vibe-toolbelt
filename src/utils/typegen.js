// Type generation from JSON samples: TypeScript, Go structs and JSON Schema.
//
// Every element of every array is inspected and merged into one "shape":
// keys missing from some objects become optional, null makes a type nullable,
// mixed element types become unions, and integers stay apart from floats.

// ---------------------------------------------------------------- parsing

class JsonFloat {
    constructor(value) {
        this.value = value
    }
}

// Browsers with "JSON.parse source text access" tell `1.0` (a float) apart
// from `1`. Elsewhere every whole number is treated as an integer.
const SOURCE_ACCESS = (() => {
    let ok = false
    try {
        JSON.parse('1', (key, value, context) => {
            ok = Boolean(context) && typeof context.source === 'string'
            return value
        })
    } catch {
        ok = false
    }
    return ok
})()

/** JSON.parse that keeps the integer/float distinction for type generation. */
export function parseJsonSample(text) {
    if (!SOURCE_ACCESS) return JSON.parse(text)
    return JSON.parse(text, (key, value, context) => {
        if (typeof value === 'number' && context && /[.eE]/.test(context.source)) return new JsonFloat(value)
        return value
    })
}

// ---------------------------------------------------------------- shapes

const INT32 = 2 ** 31
const INT64_MAX = 2 ** 63
const UINT64_MAX = 2 ** 64

function infer(value) {
    if (value === null || value === undefined) return { kind: 'null' }
    if (value instanceof JsonFloat) return { kind: 'number' }
    switch (typeof value) {
        case 'boolean': return { kind: 'boolean' }
        case 'number': return Number.isInteger(value) ? { kind: 'integer', min: value, max: value } : { kind: 'number' }
        case 'string': return { kind: 'string' }
        default: break
    }
    if (Array.isArray(value)) {
        let items = null
        for (const item of value) items = items ? merge(items, infer(item)) : infer(item)
        return { kind: 'array', items: items ?? { kind: 'unknown' } }
    }
    const fields = new Map()
    for (const key of Object.keys(value)) fields.set(key, { shape: infer(value[key]), count: 1 })
    return { kind: 'object', fields, count: 1 }
}

const isNumeric = (s) => s.kind === 'integer' || s.kind === 'number'

function mergeObjects(a, b) {
    const fields = new Map()
    for (const [key, f] of a.fields) fields.set(key, { shape: f.shape, count: f.count })
    for (const [key, f] of b.fields) {
        const current = fields.get(key)
        fields.set(key, current ? { shape: merge(current.shape, f.shape), count: current.count + f.count } : { shape: f.shape, count: f.count })
    }
    return { kind: 'object', fields, count: a.count + b.count }
}

function makeUnion(shapes) {
    const nullable = shapes.some(s => s.nullable)
    const variants = []
    for (const shape of shapes.flatMap(s => (s.kind === 'union' ? s.variants : [s]))) {
        const plain = { ...shape, nullable: false }
        const i = variants.findIndex(v => v.kind === plain.kind || (isNumeric(v) && isNumeric(plain)))
        if (i >= 0) variants[i] = merge(variants[i], plain)
        else variants.push(plain)
    }
    if (variants.length === 1) return { ...variants[0], nullable }
    return { kind: 'union', variants, nullable }
}

function merge(a, b) {
    if (a.kind === 'unknown') return b.kind === 'null' ? { kind: 'null' } : b
    if (b.kind === 'unknown') return a
    if (a.kind === 'null' && b.kind === 'null') return a
    if (a.kind === 'null') return { ...b, nullable: true }
    if (b.kind === 'null') return { ...a, nullable: true }
    const nullable = Boolean(a.nullable || b.nullable)
    if (a.kind === 'union' || b.kind === 'union') return makeUnion([a, b])
    if (a.kind === b.kind) {
        switch (a.kind) {
            case 'integer': return { kind: 'integer', min: Math.min(a.min, b.min), max: Math.max(a.max, b.max), nullable }
            case 'array': return { kind: 'array', items: merge(a.items, b.items), nullable }
            case 'object': return { ...mergeObjects(a, b), nullable }
            default: return { kind: a.kind, nullable }
        }
    }
    if (isNumeric(a) && isNumeric(b)) return { kind: 'number', nullable }
    return makeUnion([a, b])
}

function signature(s) {
    const n = s.nullable ? '?' : ''
    switch (s.kind) {
        case 'object':
            return `{${[...s.fields].map(([k, f]) => `${JSON.stringify(k)}${f.count < s.count ? '?' : ''}:${signature(f.shape)}`).join(',')}}${n}`
        case 'array':
            return `[${signature(s.items)}]${n}`
        case 'union':
            return `(${s.variants.map(signature).join('|')})${n}`
        default:
            return s.kind + n
    }
}

// ---------------------------------------------------------------- naming

function words(key) {
    return String(key)
        .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
        .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
}

const GO_INITIALISMS = new Set(['acl', 'api', 'ascii', 'cpu', 'css', 'dns', 'eof', 'guid', 'html', 'http', 'https', 'id', 'ip', 'json', 'jwt', 'os', 'qps', 'ram', 'rpc', 'sku', 'sla', 'smtp', 'sql', 'ssh', 'tcp', 'tls', 'ttl', 'udp', 'ui', 'uid', 'uri', 'url', 'utc', 'utf8', 'uuid', 'vm', 'xml', 'xmpp', 'xsrf', 'xss'])

function pascal(key, { initialisms = false } = {}) {
    return words(key).map((w) => {
        if (initialisms && GO_INITIALISMS.has(w.toLowerCase())) return w.toUpperCase()
        return w[0].toUpperCase() + w.slice(1)
    }).join('')
}

const IRREGULAR = { people: 'person', children: 'child', men: 'man', women: 'woman', mice: 'mouse', geese: 'goose', indices: 'index', matrices: 'matrix' }

function singular(word) {
    const w = String(word)
    const lower = w.toLowerCase()
    if (IRREGULAR[lower]) return w.slice(0, 1) + IRREGULAR[lower].slice(1)
    if (/[^aeiou]ies$/i.test(w)) return `${w.slice(0, -3)}y`
    if (/(ss|x|z|ch|sh|us)es$/i.test(w)) return w.slice(0, -2)
    if (/[^su]s$/i.test(w) && !/(is|ss)$/i.test(w)) return w.slice(0, -1)
    return w
}

// Name hint for the elements of an array called `hint`
function itemHint(hint) {
    const s = singular(hint)
    return s !== hint ? s : `${hint}Item`
}

const TS_RESERVED = new Set(['Array', 'ArrayBuffer', 'Boolean', 'Date', 'Error', 'Function', 'Map', 'Number', 'Object', 'Omit', 'Partial', 'Pick', 'Promise', 'Readonly', 'Record', 'RegExp', 'Required', 'Set', 'String', 'Symbol', 'Exclude', 'Extract', 'JSON', 'Math', 'Intl'])

function createNamer(reserved, fallback) {
    const used = new Set(reserved)
    return (hint, parentName) => {
        let base = hint || fallback
        if (!/^\p{Lu}/u.test(base)) base = `${fallback[0]}${base}`
        if (!used.has(base)) {
            used.add(base)
            return base
        }
        if (parentName && !used.has(parentName + base)) {
            used.add(parentName + base)
            return parentName + base
        }
        let i = 2
        while (used.has(`${base}${i}`)) i++
        used.add(`${base}${i}`)
        return `${base}${i}`
    }
}

/** Turns user input into a type name: "my root" → "MyRoot". */
export function normalizeRootName(raw, fallback = 'Root') {
    const name = pascal(raw)
    if (!name) return fallback
    return /^\p{Lu}/u.test(name) ? name : `T${name}`
}

// ---------------------------------------------------------------- TypeScript

const TS_IDENTIFIER = /^[A-Za-z_$][\w$]*$/

function generateTypeScript(root, rootName) {
    const declarations = []
    const bySignature = new Map()
    const nextName = createNamer(TS_RESERVED, 'Type')

    const declare = (shape, hint, parentName) => {
        const sig = signature({ ...shape, nullable: false })
        if (bySignature.has(sig)) return bySignature.get(sig)
        const name = nextName(pascal(hint), parentName)
        bySignature.set(sig, name)
        const slot = declarations.push('') - 1
        const lines = [...shape.fields].map(([key, f]) => {
            const optional = f.count < shape.count ? '?' : ''
            const prop = TS_IDENTIFIER.test(key) ? key : JSON.stringify(key)
            return `  ${prop}${optional}: ${typeOf(f.shape, key, name)};`
        })
        declarations[slot] = `export interface ${name} {\n${lines.join('\n')}\n}`
        return name
    }

    const typeOf = (shape, hint, parentName) => {
        let t
        switch (shape.kind) {
            case 'unknown': return 'unknown'
            case 'null': return 'null'
            case 'boolean': t = 'boolean'; break
            case 'integer':
            case 'number': t = 'number'; break
            case 'string': t = 'string'; break
            case 'array': {
                const inner = typeOf(shape.items, itemHint(hint), parentName)
                t = /[\s|]/.test(inner) ? `(${inner})[]` : `${inner}[]`
                break
            }
            case 'object':
                t = shape.fields.size ? declare(shape, hint, parentName) : 'Record<string, unknown>'
                break
            case 'union':
                t = shape.variants.map(v => {
                    const vt = typeOf(v, hint, parentName)
                    return v.kind === 'array' && /\s/.test(vt) ? `(${vt})` : vt
                }).join(' | ')
                break
            default: t = 'unknown'
        }
        return shape.nullable ? `${t} | null` : t
    }

    if (root.kind === 'object' && root.fields.size) {
        declare(root, rootName)
    } else {
        // Arrays, scalars and unions at the top level become a type alias
        nextName(rootName)
        const slot = declarations.push('') - 1
        const hint = root.kind === 'array' ? itemHint(rootName) : rootName
        const t = root.kind === 'array'
            ? (() => {
                const inner = typeOf(root.items, hint, rootName)
                const arr = /[\s|]/.test(inner) ? `(${inner})[]` : `${inner}[]`
                return root.nullable ? `${arr} | null` : arr
            })()
            : typeOf(root, `${rootName}Data`, rootName)
        declarations[slot] = `export type ${rootName} = ${t};`
    }
    return declarations.join('\n\n')
}

// ---------------------------------------------------------------- Go

// encoding/json only accepts these characters in a tag name
const GO_TAG_OK = /^[\p{L}\p{N}!#$%&()*+\-./:;<=>?@[\]^_{|}~ ]+$/u

function goFieldName(key) {
    const name = pascal(key, { initialisms: true })
    if (!name) return 'Field'
    return /^\p{Lu}/u.test(name) ? name : `X${name}`
}

function goInteger(shape) {
    if (shape.min >= -INT32 && shape.max < INT32) return 'int'
    if (shape.min >= -INT64_MAX && shape.max < INT64_MAX) return 'int64'
    if (shape.min >= 0 && shape.max < UINT64_MAX) return 'uint64'
    return 'float64'
}

function describeGo(shape) {
    switch (shape.kind) {
        case 'integer': return 'int'
        case 'number': return 'float64'
        case 'boolean': return 'bool'
        case 'array': return 'array'
        case 'object': return 'object'
        default: return shape.kind
    }
}

function alignColumns(rows) {
    const widths = []
    for (const row of rows) row.cells.forEach((c, i) => { if (i < row.cells.length - 1) widths[i] = Math.max(widths[i] || 0, c.length) })
    return rows.map(row => `\t${row.cells.map((c, i) => (i < row.cells.length - 1 ? c.padEnd(widths[i]) : c)).join(' ').trimEnd()}${row.comment ? ` // ${row.comment}` : ''}`)
}

function generateGo(root, rootName) {
    const declarations = []
    const bySignature = new Map()
    const nextName = createNamer([], 'Type')

    const declare = (shape, hint, parentName) => {
        const sig = signature({ ...shape, nullable: false })
        if (bySignature.has(sig)) return bySignature.get(sig)
        const name = nextName(goFieldName(hint), parentName)
        bySignature.set(sig, name)
        const slot = declarations.push('') - 1
        const usedFields = new Set()
        const rows = [...shape.fields].map(([key, f]) => {
            let field = goFieldName(key)
            if (usedFields.has(field)) {
                let i = 2
                while (usedFields.has(`${field}${i}`)) i++
                field = `${field}${i}`
            }
            usedFields.add(field)
            const optional = f.count < shape.count
            let type = typeOf(f.shape, key, name)
            // Optional nested objects are pointers, so "missing" differs from "empty"
            if (optional && f.shape.kind === 'object' && f.shape.fields.size && !type.startsWith('*')) type = `*${type}`
            let comment = f.shape.kind === 'union' ? `one of: ${f.shape.variants.map(describeGo).join(', ')}` : ''
            let tag = ''
            if (GO_TAG_OK.test(key) && !key.includes(',')) {
                tag = `\`json:"${key}${optional ? ',omitempty' : ''}"\``
            } else {
                comment = [comment, `JSON key ${JSON.stringify(key)} can’t be expressed as a struct tag`].filter(Boolean).join('; ')
            }
            return { cells: [field, type, tag], comment }
        })
        declarations[slot] = `type ${name} struct {\n${alignColumns(rows).join('\n')}\n}`
        return name
    }

    const typeOf = (shape, hint, parentName) => {
        let t
        switch (shape.kind) {
            case 'unknown':
            case 'null':
            case 'union':
                return 'any'
            case 'boolean': t = 'bool'; break
            case 'integer': t = goInteger(shape); break
            case 'number': t = 'float64'; break
            case 'string': t = 'string'; break
            case 'array': return `[]${typeOf(shape.items, itemHint(hint), parentName)}`
            case 'object':
                if (!shape.fields.size) return 'map[string]any'
                t = declare(shape, hint, parentName)
                break
            default: return 'any'
        }
        return shape.nullable ? `*${t}` : t
    }

    const goRoot = goFieldName(rootName)
    if (root.kind === 'object' && root.fields.size) {
        declare(root, goRoot)
    } else {
        nextName(goRoot)
        const slot = declarations.push('') - 1
        const t = root.kind === 'array'
            ? `[]${typeOf(root.items, itemHint(goRoot), goRoot)}`
            : root.kind === 'object' ? 'map[string]any' : typeOf({ ...root, nullable: false }, `${goRoot}Data`, goRoot)
        declarations[slot] = `type ${goRoot} ${t}`
    }
    return declarations.join('\n\n')
}

// ---------------------------------------------------------------- JSON Schema

function schemaOf(shape) {
    let s
    switch (shape.kind) {
        case 'unknown': return {}
        case 'null': return { type: 'null' }
        case 'boolean': s = { type: 'boolean' }; break
        case 'integer': s = { type: 'integer' }; break
        case 'number': s = { type: 'number' }; break
        case 'string': s = { type: 'string' }; break
        case 'array': s = { type: 'array', items: schemaOf(shape.items) }; break
        case 'object': {
            const properties = Object.create(null)
            const required = []
            for (const [key, f] of shape.fields) {
                properties[key] = schemaOf(f.shape)
                if (f.count === shape.count) required.push(key)
            }
            s = { type: 'object', properties }
            if (required.length) s.required = required
            break
        }
        case 'union': s = { anyOf: shape.variants.map(schemaOf) }; break
        default: return {}
    }
    if (shape.nullable) {
        if (typeof s.type === 'string') s.type = [s.type, 'null']
        else if (s.anyOf) s.anyOf.push({ type: 'null' })
    }
    return s
}

function generateSchema(root, rootName) {
    const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: rootName,
        ...schemaOf(root),
    }
    return JSON.stringify(schema, null, 2)
}

// ---------------------------------------------------------------- API

export const TYPEGEN_TARGETS = ['typescript', 'go', 'schema']

/**
 * Generates type definitions for a parsed JSON value (use parseJsonSample to
 * keep floats apart from integers).
 */
export function generateTypes(value, { target = 'typescript', rootName = 'Root' } = {}) {
    const root = infer(value)
    const name = normalizeRootName(rootName)
    if (target === 'go') return generateGo(root, name)
    if (target === 'schema') return generateSchema(root, name)
    return generateTypeScript(root, name)
}
