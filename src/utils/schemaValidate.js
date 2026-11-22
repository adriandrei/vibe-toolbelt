// JSON Schema validation helpers for the JSON Schema Validator page.
//
// Validation itself is done by @cfworker/json-schema (no eval, so it works
// under the app's CSP), loaded on first use with loadValidator(). This module
// reads the inputs (JSON or YAML), picks the draft, checks the schema for
// mistakes the validator would silently accept or crash on, and turns the
// validator's flat error list into readable causes.
import * as yaml from 'js-yaml'

// ---------------------------------------------------------------- drafts

export const DRAFTS = [
    { value: 'auto', label: 'Auto (from $schema)' },
    { value: '2020-12', label: '2020-12' },
    { value: '2019-09', label: '2019-09' },
    { value: '7', label: 'Draft-07' },
    { value: '4', label: 'Draft-04' },
]
export const DRAFT_VALUES = DRAFTS.map(d => d.value)
export const DRAFT_LABELS = { '2020-12': '2020-12', '2019-09': '2019-09', 7: 'draft-07', 4: 'draft-04' }

/**
 * The draft named by the schema's $schema:
 *   { draft: '2020-12' | '2019-09' | '7' | '4', source: 'schema' | 'default', note? }
 * Without $schema (or with one this validator doesn't know) 2020-12 is used.
 */
export function detectDraft(schema) {
    const uri = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema.$schema : undefined
    if (uri === undefined) return { draft: '2020-12', source: 'default' }
    if (typeof uri !== 'string') return { draft: '2020-12', source: 'default', note: '"$schema" should be a URI string, so 2020-12 rules were used.' }
    if (/draft\/2020-12\b/.test(uri)) return { draft: '2020-12', source: 'schema' }
    if (/draft\/2019-09\b/.test(uri)) return { draft: '2019-09', source: 'schema' }
    if (/draft-0?7\b/.test(uri)) return { draft: '7', source: 'schema' }
    if (/draft-0?6\b/.test(uri)) return { draft: '7', source: 'schema', note: 'Draft-06 is checked with the draft-07 rules (draft-07 only adds if/then/else).' }
    if (/draft-0?4\b/.test(uri)) return { draft: '4', source: 'schema' }
    if (/draft-0?3\b/.test(uri)) return { draft: '4', source: 'schema', note: 'Draft-03 isn’t supported, so draft-04 rules were used. They differ: for example "required" is a list of names, not true/false.' }
    return { draft: '2020-12', source: 'default', note: `Unknown "$schema" (${uri.length > 80 ? `${uri.slice(0, 80)}…` : uri}), so 2020-12 rules were used.` }
}

export async function loadValidator() {
    const { Validator } = await import('@cfworker/json-schema')
    return Validator
}

// ---------------------------------------------------------------- parsing

// YAML 1.2 core schema (dates stay strings) plus merge keys (<<: *base)
const YAML_SCHEMA = yaml.CORE_SCHEMA.withTags(yaml.mergeTag)

function lineColumn(text, position) {
    const before = text.slice(0, position)
    return { line: before.split('\n').length, column: position - before.lastIndexOf('\n') }
}

function jsonErrorMessage(text, error) {
    const message = String(error?.message || error)
    if (/line \d+ column \d+/.test(message)) return message
    const pos = message.match(/at position (\d+)/)
    if (!pos) return message
    const { line, column } = lineColumn(text, Number(pos[1]))
    return `${message} (line ${line}, column ${column})`
}

// Infinity, NaN and recursive aliases can come from YAML but not from JSON
function findNonJson(value, seen = new Set()) {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'YAML .inf and .nan have no JSON equivalent.'
    if (value && typeof value === 'object') {
        if (seen.has(value)) return 'A YAML alias refers to the value that contains it, which JSON can’t represent.'
        seen.add(value)
        for (const v of Array.isArray(value) ? value : Object.values(value)) {
            const problem = findNonJson(v, seen)
            if (problem) return problem
        }
        seen.delete(value)
    }
    return null
}

/**
 * Reads JSON, or YAML when the text isn't JSON.
 *   { status: 'empty' }
 *   { status: 'ok', value, format: 'json' | 'yaml' }
 *   { status: 'error', format: 'json' | 'yaml', message }
 * Text that starts with { or [ is only read as JSON: YAML would quietly
 * accept JSON mistakes ({"a": } is valid YAML).
 */
// A byte order mark (U+FEFF) at the start isn't part of the document
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

export function parseDocument(raw) {
    const text = stripBom(String(raw ?? ''))
    if (!text.trim()) return { status: 'empty' }
    try {
        return { status: 'ok', value: JSON.parse(text), format: 'json' }
    } catch (error) {
        if (/^\s*[[{]/.test(text)) return { status: 'error', format: 'json', message: jsonErrorMessage(text, error) }
    }
    let value
    try {
        value = yaml.load(text, { schema: YAML_SCHEMA })
    } catch (error) {
        if (error?.name === 'YAMLException') {
            const mark = error.mark
            const where = mark && Number.isInteger(mark.line) ? ` (line ${mark.line + 1}, column ${mark.column + 1})` : ''
            const reason = /input is empty/.test(error.reason ?? '') ? 'There’s no value here, only comments.' : `${error.reason}${where}`
            return { status: 'error', format: 'yaml', message: `Not valid JSON or YAML: ${reason}` }
        }
        return { status: 'error', format: 'yaml', message: `Not valid JSON or YAML: ${error?.message || error}` }
    }
    const problem = findNonJson(value)
    if (problem) return { status: 'error', format: 'yaml', message: problem }
    return { status: 'ok', value, format: 'yaml' }
}

/**
 * Pretty-prints valid JSON text without re-parsing values, so numbers like
 * 1.0 or 12345678901234567890 and string escapes stay exactly as written.
 */
export function formatJson(text, indent = 2) {
    const s = stripBom(String(text))
    let out = ''
    let depth = 0
    const newline = () => `\n${' '.repeat(depth * indent)}`
    for (let i = 0; i < s.length;) {
        const ch = s[i]
        if (ch === '"') {
            let j = i + 1
            while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1
            out += s.slice(i, j + 1)
            i = j + 1
        } else if (ch === '{' || ch === '[') {
            let k = i + 1
            while (k < s.length && /\s/.test(s[k])) k++
            if (s[k] === (ch === '{' ? '}' : ']')) {
                out += ch + s[k]
                i = k + 1
            } else {
                depth++
                out += ch + newline()
                i++
            }
        } else if (ch === '}' || ch === ']') {
            depth--
            out += newline() + ch
            i++
        } else if (ch === ',') {
            out += `,${newline()}`
            i++
        } else if (ch === ':') {
            out += ': '
            i++
        } else if (/\s/.test(ch)) {
            i++
        } else {
            let j = i
            while (j < s.length && !/[\s,:{}[\]"]/.test(s[j])) j++
            out += s.slice(i, j)
            i = j
        }
    }
    return out
}

// ---------------------------------------------------------------- pointers

/** "#/items/2/c%20d" → ['items', '2', 'c d'] (decoded, unescaped) */
export function locationSegments(location) {
    const body = String(location ?? '').replace(/^#/, '')
    if (!body) return []
    return body.slice(1).split('/').map((seg) => {
        let decoded = seg
        try {
            decoded = decodeURIComponent(seg)
        } catch {
            // keep it as written
        }
        return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
    })
}

const escapeSegment = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')

/** RFC 6901 JSON Pointer ("" for the root). */
export function toJsonPointer(segments) {
    return segments.map(s => `/${escapeSegment(s)}`).join('')
}

/** "#/properties/unit price/type": a schema location that's easy to read. */
export function readableLocation(location) {
    return `#${toJsonPointer(locationSegments(location))}`
}

/** "$.items[2].price", using the data to tell array indexes from keys. */
export function friendlyPath(segments, data) {
    let out = '$'
    let current = data
    for (const seg of segments) {
        if (Array.isArray(current) && /^(0|[1-9]\d*)$/.test(seg)) {
            out += `[${seg}]`
            current = current[Number(seg)]
        } else {
            out += /^[A-Za-z_$][\w$]*$/.test(seg) ? `.${seg}` : `[${JSON.stringify(seg)}]`
            current = current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, seg) ? current[seg] : undefined
        }
    }
    return out
}

function valueAt(data, segments) {
    let current = data
    for (const seg of segments) {
        if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, Array.isArray(current) ? Number(seg) : seg)) return { found: false }
        current = Array.isArray(current) ? current[Number(seg)] : current[seg]
    }
    return { found: true, value: current }
}

// Follows a keyword location through the schema, including local "$ref"s
// ("#/…" pointers), to read a keyword's value. Undefined when it can't.
function resolveKeyword(schema, location) {
    let node = schema
    for (const seg of locationSegments(location)) {
        if (seg === '$ref' && node && typeof node.$ref === 'string') {
            if (!node.$ref.startsWith('#')) return undefined
            node = resolvePointer(schema, node.$ref)
            continue
        }
        if (node === null || typeof node !== 'object' || !(seg in node)) return undefined
        node = node[seg]
    }
    return node
}

function resolvePointer(schema, ref) {
    let node = schema
    for (const seg of locationSegments(ref)) {
        if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, seg)) return undefined
        node = node[seg]
    }
    return node
}

// ---------------------------------------------------------------- schema checks

const TYPES = ['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']
const TYPE_HINTS = {
    int: 'integer', long: 'integer', float: 'number', double: 'number', decimal: 'number', bool: 'boolean',
    str: 'string', text: 'string', date: 'string', datetime: 'string', dict: 'object', map: 'object',
    list: 'array', tuple: 'array', none: 'null', nil: 'null',
}
const SINGLE_SCHEMA = ['additionalItems', 'additionalProperties', 'contains', 'contentSchema', 'else', 'if', 'not', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties']
const SCHEMA_ARRAYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
const SCHEMA_MAPS = ['$defs', 'definitions', 'dependentSchemas', 'patternProperties', 'properties']
const COUNTS = ['maxContains', 'maxItems', 'maxLength', 'maxProperties', 'minContains', 'minItems', 'minLength', 'minProperties']
// Formats @cfworker/json-schema checks
export const CHECKED_FORMATS = ['date', 'date-time', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'json-pointer', 'json-pointer-uri-fragment', 'regex', 'relative-json-pointer', 'time', 'uri', 'uri-reference', 'uri-template', 'url', 'uuid']
const KNOWN_KEYWORDS = new Set([
    ...SINGLE_SCHEMA, ...SCHEMA_ARRAYS, ...SCHEMA_MAPS, ...COUNTS,
    'type', 'enum', 'const', 'required', 'dependentRequired', 'dependencies', 'items', 'uniqueItems', 'pattern', 'format',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    '$id', 'id', '$schema', '$ref', '$anchor', '$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor',
    '$vocabulary', '$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
    'contentMediaType', 'contentEncoding',
    // OpenAPI keywords people mix in (reported separately where they matter)
    'nullable', 'discriminator', 'example', 'xml', 'externalDocs',
])
const KEYWORD_LIST = [...KNOWN_KEYWORDS]

function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0]
        prev[0] = i
        for (let j = 1; j <= b.length; j++) {
            const tmp = prev[j]
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
            diag = tmp
        }
    }
    return prev[b.length]
}

function suggestKeyword(key) {
    const lower = key.toLowerCase()
    const exact = KEYWORD_LIST.find(k => k.toLowerCase() === lower)
    if (exact) return exact
    if (key.length < 4) return null
    const limit = key.length > 6 ? 2 : 1
    let best = null
    let bestDistance = limit + 1
    for (const k of KEYWORD_LIST) {
        const d = editDistance(lower, k.toLowerCase())
        if (d < bestDistance) {
            best = k
            bestDistance = d
        }
    }
    return best
}

const isSchema = (v) => typeof v === 'boolean' || (v !== null && typeof v === 'object' && !Array.isArray(v))
const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : `a ${typeof v}`)

function regexProblem(pattern) {
    try {
        new RegExp(pattern, 'u')
        return null
    } catch (error) {
        return String(error.message).replace(/^Invalid regular expression: /, '')
    }
}

/**
 * Checks a parsed schema for mistakes: keyword values of the wrong type,
 * invalid regular expressions, unknown type names, draft-specific syntax used
 * with the wrong draft, local $refs that point nowhere, and likely typos.
 *   { errors: [{ pointer, message }], warnings: [{ pointer, message }] }
 * Pointers are RFC 6901 JSON Pointers into the schema document.
 */
export function lintSchema(schema, draft = '2020-12') {
    const errors = []
    const warnings = []
    const MAX_ISSUES = 100
    let visited = 0
    const seen = new Set()
    const error = (path, message) => { if (errors.length < MAX_ISSUES) errors.push({ pointer: toJsonPointer(path), message }) }
    const warn = (path, message) => { if (warnings.length < MAX_ISSUES) warnings.push({ pointer: toJsonPointer(path), message }) }

    if (!isSchema(schema)) {
        error([], `A schema must be a JSON object or a boolean (true or false), but this is ${kind(schema)}.`)
        return { errors, warnings }
    }

    const visit = (node, path, hasBase) => {
        if (typeof node === 'boolean') return
        if (!isSchema(node)) {
            error(path, `This should be a schema (an object, or true/false), but it’s ${kind(node)}.`)
            return
        }
        if (seen.has(node) || ++visited > 20000) return
        seen.add(node)
        const scoped = hasBase || (path.length > 0 && (typeof node.$id === 'string' || (draft === '4' && typeof node.id === 'string')))

        for (const [key, value] of Object.entries(node)) {
            const at = [...path, key]
            if (!KNOWN_KEYWORDS.has(key) && !key.startsWith('x-')) {
                const suggestion = suggestKeyword(key)
                if (suggestion) warn(at, `Unknown keyword "${key}" is ignored. Did you mean "${suggestion}"?`)
                continue
            }
            switch (key) {
                case 'type': {
                    const list = Array.isArray(value) ? value : [value]
                    if (!list.length || list.some(t => typeof t !== 'string')) {
                        error(at, '"type" must be a type name or a list of them.')
                        break
                    }
                    for (const t of list) {
                        if (TYPES.includes(t)) continue
                        const hint = TYPE_HINTS[t.toLowerCase()] ?? TYPES.find(x => x === t.toLowerCase())
                        error(at, `"${t}" isn’t a JSON Schema type${hint ? `. Did you mean "${hint}"?` : '.'} Types are ${TYPES.join(', ')}.`)
                    }
                    if (new Set(list).size !== list.length) warn(at, '"type" lists the same type twice.')
                    break
                }
                case 'required':
                    if (typeof value === 'boolean') {
                        error(at, `"required": ${value} is draft-03 style. List the required property names in the parent object’s "required" array instead.`)
                    } else if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
                        error(at, '"required" must be an array of property names.')
                    }
                    break
                case 'enum':
                    if (!Array.isArray(value)) error(at, '"enum" must be an array of allowed values.')
                    else if (!value.length) warn(at, 'An empty "enum" allows nothing, so no value can be valid.')
                    break
                case 'items':
                    if (Array.isArray(value)) {
                        if (draft === '2020-12') warn(at, 'In 2020-12, "items" takes one schema. Use "prefixItems" for a list of schemas (it’s checked as a tuple here).')
                        value.forEach((v, i) => visit(v, [...at, String(i)], scoped))
                    } else if (isSchema(value)) {
                        visit(value, at, scoped)
                    } else {
                        error(at, `"items" must be a schema${draft === '2020-12' ? '' : ' or an array of schemas'}, not ${kind(value)}.`)
                    }
                    break
                case 'pattern':
                    if (typeof value !== 'string') error(at, '"pattern" must be a regular expression string.')
                    else {
                        const problem = regexProblem(value)
                        if (problem) error(at, `Invalid regular expression: ${problem}.`)
                    }
                    break
                case 'format':
                    if (typeof value !== 'string') error(at, '"format" must be a string.')
                    else if (!CHECKED_FORMATS.includes(value)) warn(at, `The format "${value}" isn’t checked by this validator, so any string passes.`)
                    break
                case 'minimum':
                case 'maximum':
                    if (typeof value !== 'number') error(at, `"${key}" must be a number, not ${kind(value)}.`)
                    break
                case 'exclusiveMinimum':
                case 'exclusiveMaximum': {
                    const base = key === 'exclusiveMinimum' ? 'minimum' : 'maximum'
                    if (draft === '4') {
                        if (typeof value !== 'boolean') error(at, `In draft-04, "${key}" is true or false and changes "${base}". From draft-06 on it’s the limit itself: choose that draft or use "${base}".`)
                        else if (node[base] === undefined) warn(at, `"${key}" does nothing without "${base}".`)
                    } else if (typeof value === 'boolean') {
                        error(at, `"${key}": ${value} is draft-04 style. From draft-06 on, "${key}" is the limit itself, for example "${key}": 0.`)
                    } else if (typeof value !== 'number') {
                        error(at, `"${key}" must be a number, not ${kind(value)}.`)
                    }
                    break
                }
                case 'multipleOf':
                    if (typeof value !== 'number' || !(value > 0)) error(at, '"multipleOf" must be a number greater than 0.')
                    break
                case 'uniqueItems':
                    if (typeof value !== 'boolean') error(at, '"uniqueItems" must be true or false.')
                    break
                case 'dependentRequired':
                    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => !Array.isArray(v) || v.some(n => typeof n !== 'string'))) {
                        error(at, '"dependentRequired" must map property names to arrays of property names.')
                    }
                    break
                case 'dependencies':
                    if (!value || typeof value !== 'object' || Array.isArray(value)) {
                        error(at, '"dependencies" must be an object.')
                        break
                    }
                    for (const [name, dep] of Object.entries(value)) {
                        if (Array.isArray(dep)) {
                            if (dep.some(n => typeof n !== 'string')) error([...at, name], 'A dependency list must contain property names.')
                        } else {
                            visit(dep, [...at, name], scoped)
                        }
                    }
                    break
                case '$ref':
                    if (typeof value !== 'string') {
                        error(at, '"$ref" must be a URI reference string.')
                    } else if (value.startsWith('#/') || value === '#') {
                        if (!scoped && resolvePointer(schema, value) === undefined) error(at, `"$ref" points to ${value}, which doesn’t exist in this schema.`)
                    } else if (!value.startsWith('#')) {
                        warn(at, `"$ref" to ${value}: other documents aren’t downloaded, so this only works if an "$id" in this schema matches it.`)
                    }
                    break
                case '$dynamicRef':
                case '$dynamicAnchor':
                    warn(at, `"${key}" isn’t supported by this validator and is ignored.`)
                    break
                case '$id':
                case '$anchor':
                case '$schema':
                    if (typeof value !== 'string') error(at, `"${key}" must be a string.`)
                    break
                case 'nullable':
                    warn(at, `"nullable" is an OpenAPI 3.0 keyword; JSON Schema ignores it. Add "null" to "type" instead, for example "type": ["string", "null"].`)
                    break
                default:
                    if (SINGLE_SCHEMA.includes(key)) visit(value, at, scoped)
                    else if (SCHEMA_ARRAYS.includes(key)) {
                        if (!Array.isArray(value) || !value.length) error(at, `"${key}" must be a non-empty array of schemas.`)
                        else value.forEach((v, i) => visit(v, [...at, String(i)], scoped))
                    } else if (SCHEMA_MAPS.includes(key)) {
                        if (!value || typeof value !== 'object' || Array.isArray(value)) {
                            error(at, `"${key}" must be an object${key === 'patternProperties' ? ' of regular expressions to schemas' : ' of schemas'}.`)
                            break
                        }
                        for (const [name, sub] of Object.entries(value)) {
                            if (key === 'patternProperties') {
                                const problem = regexProblem(name)
                                if (problem) error([...at, name], `Invalid regular expression: ${problem}.`)
                            }
                            visit(sub, [...at, name], scoped)
                        }
                    } else if (COUNTS.includes(key)) {
                        if (!Number.isInteger(value) || value < 0) error(at, `"${key}" must be a whole number, 0 or more.`)
                    }
            }
        }
        if (Array.isArray(node.required) && node.properties && typeof node.properties === 'object' && node.additionalProperties === false && !node.patternProperties) {
            for (const name of node.required) {
                if (typeof name === 'string' && !Object.prototype.hasOwnProperty.call(node.properties, name)) {
                    warn([...path, 'required'], `"${name}" is required but not listed in "properties", and "additionalProperties" is false, so no object can be valid.`)
                }
            }
        }
    }

    visit(schema, [], false)
    return { errors, warnings }
}

// ---------------------------------------------------------------- validation

// Wrapper errors that only say "something inside failed"; their children
// are the real causes.
const PASS_THROUGH = new Set([
    'properties', 'patternProperties', 'additionalProperties', 'unevaluatedProperties', 'propertyNames',
    'items', 'prefixItems', 'additionalItems', 'unevaluatedItems', '$ref', '$recursiveRef', 'allOf', 'if', 'dependentSchemas',
])
// Wrappers that move into a property or item of the instance
const DESCENDS = new Set(['properties', 'patternProperties', 'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'items', 'prefixItems', 'additionalItems', 'unevaluatedItems'])
const PROPERTY_WRAPPERS = new Set(['properties', 'patternProperties', 'additionalProperties', 'unevaluatedProperties', 'propertyNames'])

const isSchemaDependency = (u) => u.keyword === 'dependencies' && /dependant schema/.test(u.error)
const isPassThrough = (u) => PASS_THROUGH.has(u.keyword) || isSchemaDependency(u)
const isWrapper = (u) => isPassThrough(u) || u.keyword === 'anyOf' || u.keyword === 'oneOf'

const quoted = (message, pattern) => message.match(pattern)?.[1]
const propertyKey = (u) => quoted(u.error, /^Property(?: name)? "(.*)" (?:does not match|matches pattern)/s)

function childPrefixes(u) {
    if (u.keyword === 'if') {
        const base = u.keywordLocation.replace(/\/if$/, '')
        return [`${base}/then`, `${base}/else`]
    }
    return [u.keywordLocation]
}

const isDirectChild = (child, parent) => child.startsWith(`${parent}/`) && !child.slice(parent.length + 1).includes('/')

// A false schema's error names its instance location as its keyword location,
// so it's matched to its wrapper by instance location instead.
function acceptsFalse(wrapper, unit) {
    if (DESCENDS.has(wrapper.keyword)) {
        if (!isDirectChild(unit.instanceLocation, wrapper.instanceLocation)) return false
        if (!PROPERTY_WRAPPERS.has(wrapper.keyword)) return true
        const last = locationSegments(unit.instanceLocation).pop()
        return propertyKey(wrapper) === last
    }
    return unit.instanceLocation === wrapper.instanceLocation
}

// Rebuilds the nesting that @cfworker/json-schema flattens: a wrapper error
// comes right before the errors of the subschema it reports on.
function buildTree(units) {
    const roots = []
    const stack = []
    for (const unit of units) {
        const node = { unit, children: [] }
        if (unit.keyword === 'false') {
            while (stack.length && !acceptsFalse(stack[stack.length - 1].unit, unit)) stack.pop()
        } else {
            while (stack.length && !childPrefixes(stack[stack.length - 1].unit).some(p => unit.keywordLocation.startsWith(`${p}/`))) stack.pop()
        }
        const parent = stack[stack.length - 1]
        node.parent = parent ?? null
        ;(parent ? parent.children : roots).push(node)
        if (isWrapper(unit)) stack.push(node)
    }
    regroupContains(roots)
    return roots
}

// With minContains, the failing items' errors are listed before the
// minContains error, at the same level: move them under it.
function regroupContains(nodes) {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        regroupContains(node.children)
        if (node.unit.keyword !== 'minContains') continue
        const base = `${node.unit.keywordLocation.replace(/\/minContains$/, '')}/contains`
        let start = i
        while (start > 0) {
            const prev = nodes[start - 1].unit
            const fromContains = prev.keywordLocation === base || prev.keywordLocation.startsWith(`${base}/`)
            if (!fromContains || !prev.instanceLocation.startsWith(`${node.unit.instanceLocation}/`)) break
            start--
        }
        if (start < i) {
            const moved = nodes.splice(start, i - start)
            moved.forEach((m) => { m.parent = node })
            node.children.unshift(...moved)
            i = start
        }
    }
}

const FORMAT_TEXT = {
    date: 'a valid date (YYYY-MM-DD)',
    'date-time': 'a valid date-time (RFC 3339, like 2024-05-01T12:00:00Z)',
    time: 'a valid time with a time zone (like 12:00:00Z)',
    duration: 'a valid ISO 8601 duration (like P1DT2H)',
    email: 'a valid email address',
    hostname: 'a valid hostname',
    ipv4: 'a valid IPv4 address',
    ipv6: 'a valid IPv6 address',
    uri: 'a valid absolute URI',
    'uri-reference': 'a valid URI reference',
    'uri-template': 'a valid URI template',
    url: 'a valid URL',
    uuid: 'a valid UUID',
    regex: 'a valid regular expression',
    'json-pointer': 'a valid JSON Pointer',
    'relative-json-pointer': 'a valid relative JSON Pointer',
    'json-pointer-uri-fragment': 'a valid JSON Pointer URI fragment',
}

function showValue(v) {
    if (typeof v === 'string') return `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (Array.isArray(v)) return `an array (${v.length} item${v.length === 1 ? '' : 's'})`
    return 'an object'
}

function describeValue(v) {
    if (typeof v === 'string') return `the string ${showValue(v)}`
    if (typeof v === 'number') return `the number ${v}`
    if (typeof v === 'boolean') return String(v)
    if (v === null) return 'null'
    return Array.isArray(v) ? 'an array' : 'an object'
}

const article = (t) => (/^[aeiou]/.test(t) ? `an ${t}` : t === 'null' ? 'null' : `a ${t}`)
const joinOr = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`)
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

function falseMessage(node, segments) {
    const parent = node.parent?.unit
    const last = segments[segments.length - 1]
    if (!parent) return 'The schema is false, so no value is valid.'
    switch (parent.keyword) {
        case 'properties': return `Property "${last}" isn’t allowed (its schema is false).`
        case 'additionalProperties': return `Property "${last}" isn’t allowed: the schema doesn’t allow additional properties.`
        case 'unevaluatedProperties': return `Property "${last}" isn’t allowed: the schema doesn’t allow properties it doesn’t define.`
        case 'patternProperties': return `Property "${last}" isn’t allowed (it matches a pattern whose schema is false).`
        case 'propertyNames': return `Property "${last}" isn’t allowed: the object must be empty.`
        case 'items':
        case 'prefixItems': return `Item ${last} isn’t allowed: the array can’t have an item there.`
        case 'additionalItems': return `Item ${last} isn’t allowed: the schema allows no additional items.`
        case 'unevaluatedItems': return `Item ${last} isn’t allowed: the schema allows no items it doesn’t define.`
        case 'if': return /"then"/.test(parent.error)
            ? 'Values that match "if" aren’t allowed ("then" is false).'
            : 'Values that don’t match "if" aren’t allowed ("else" is false).'
        case '$ref':
        case '$recursiveRef': return 'The referenced schema is false, so no value matches it.'
        default: return 'Not allowed: the schema here is false.'
    }
}

function falseLocation(node, segments, schema) {
    const parent = node.parent?.unit
    if (!parent) return '#'
    const last = segments[segments.length - 1]
    const enc = (s) => encodeURIComponent(escapeSegment(s))
    switch (parent.keyword) {
        case 'properties': return `${parent.keywordLocation}/${enc(last)}`
        case 'patternProperties': {
            const pattern = quoted(parent.error, /matches pattern "(.*)" but/s)
            return pattern === undefined ? parent.keywordLocation : `${parent.keywordLocation}/${enc(pattern)}`
        }
        case 'items': return Array.isArray(resolveKeyword(schema, parent.keywordLocation)) ? `${parent.keywordLocation}/${last}` : parent.keywordLocation
        case 'prefixItems': return `${parent.keywordLocation}/${last}`
        case 'if': return parent.keywordLocation.replace(/\/if$/, /"then"/.test(parent.error) ? '/then' : '/else')
        case 'dependentSchemas':
        case 'dependencies': {
            const key = quoted(parent.error, /^Instance has "(.*)" but/s)
            return key === undefined ? parent.keywordLocation : `${parent.keywordLocation}/${enc(key)}`
        }
        default: return parent.keywordLocation
    }
}

function describe(node, ctx) {
    const u = node.unit
    const e = u.error
    const got = ctx.hasValue ? ` (got ${showValue(ctx.value)})` : ''
    const v = ctx.value
    let m
    switch (u.keyword) {
        case 'false': return falseMessage(node, ctx.segments)
        case 'type':
            if ((m = e.match(/^Instance type "(\w+)" is invalid\. Expected "(.*)"\.$/s))) {
                return `Expected ${joinOr(m[2].split('", "').map(article))}, got ${ctx.hasValue ? describeValue(v) : article(m[1])}.`
            }
            break
        case 'required':
            if ((m = e.match(/required property "(.*)"\.$/s))) return `Missing required property "${m[1]}".`
            break
        case 'const':
            if ((m = e.match(/^Instance does not match (.*)\.$/s))) return `Must be ${m[1]}${got}.`
            break
        case 'enum':
            if ((m = e.match(/^Instance does not match any of (.*)\.$/s))) {
                let allowed
                try {
                    const list = JSON.parse(m[1])
                    const shown = list.slice(0, 8).map(x => JSON.stringify(x))
                    allowed = joinOr(list.length > 8 ? [...shown, `${list.length - 8} more`] : shown)
                } catch {
                    allowed = m[1]
                }
                return `Must be one of ${allowed}${got}.`
            }
            break
        case 'not': return 'Matches the "not" schema, so it isn’t allowed.'
        case 'anyOf': return 'Doesn’t match any of the allowed options (anyOf).'
        case 'oneOf':
            if ((m = e.match(/\((\d+) matches\)/))) {
                const n = Number(m[1])
                return n === 0 ? 'Doesn’t match any of the options (oneOf needs exactly one).' : `Matches ${n} options, but oneOf allows exactly one.`
            }
            break
        case 'minimum':
            if ((m = e.match(/is less than (or equal to)?\s*(\S+)\.$/))) return `Must be ${m[1] ? 'greater than' : 'at least'} ${m[2]}${got}.`
            break
        case 'maximum':
            if ((m = e.match(/is greater than (or equal to)?\s*(\S+)\.$/))) return `Must be ${m[1] ? 'less than' : 'at most'} ${m[2]}${got}.`
            break
        case 'exclusiveMinimum':
            if ((m = e.match(/is less than (\S+)\.$/))) return `Must be greater than ${m[1]}${got}.`
            break
        case 'exclusiveMaximum':
            if ((m = e.match(/or equal to (\S+)\.$/))) return `Must be less than ${m[1]}${got}.`
            break
        case 'multipleOf':
            if ((m = e.match(/not a multiple of (\S+)\.$/))) return `Must be a multiple of ${m[1]}${got}.`
            break
        case 'minLength':
            if ((m = e.match(/\((\d+) < (\d+)\)/))) return `Must be at least ${plural(Number(m[2]), 'character')} long (it has ${m[1]}).`
            break
        case 'maxLength':
            if ((m = e.match(/\((\d+) > (\d+)\)/))) return `Must be at most ${plural(Number(m[2]), 'character')} long (it has ${m[1]}).`
            break
        case 'pattern': {
            const pattern = resolveKeyword(ctx.schema, u.keywordLocation)
            return typeof pattern === 'string' ? `Doesn’t match the pattern ${pattern}${got}.` : `Doesn’t match the required pattern${got}.`
        }
        case 'format':
            if ((m = e.match(/format "(.*)"\.$/s))) return FORMAT_TEXT[m[1]] ? `Isn’t ${FORMAT_TEXT[m[1]]}${got}.` : `Doesn’t match the format "${m[1]}"${got}.`
            break
        case 'minItems':
            if ((m = e.match(/\((\d+) < (\d+)\)/))) return `Must have at least ${plural(Number(m[2]), 'item')} (it has ${m[1]}).`
            break
        case 'maxItems':
            if ((m = e.match(/\((\d+) > (\d+)\)/))) return `Must have at most ${plural(Number(m[2]), 'item')} (it has ${m[1]}).`
            break
        case 'uniqueItems':
            if ((m = e.match(/indexes (\d+) and (\d+)/))) return `Items ${m[1]} and ${m[2]} are the same, but items must be unique.`
            break
        case 'contains':
            return /empty/.test(e) ? 'Is empty, but must contain an item that matches "contains".' : 'Has no item that matches the "contains" schema.'
        case 'minContains':
            if ((m = e.match(/has less items \((\d+)\) than minContains \((\d+)\)/))) return `Has ${plural(Number(m[1]), 'item')}, but at least ${m[2]} must match "contains".`
            if ((m = e.match(/at least (\d+) items matching schema\. Only (\d+)/))) return `Only ${plural(Number(m[2]), 'item')} ${m[2] === '1' ? 'matches' : 'match'} "contains"; at least ${m[1]} must.`
            break
        case 'maxContains':
            if ((m = e.match(/at most (\d+) items matching schema\. (\d+) items/))) return `${plural(Number(m[2]), 'item')} match "contains"; at most ${m[1]} may.`
            break
        case 'minProperties':
        case 'maxProperties':
            if ((m = e.match(/(\d+) properties/))) {
                const count = v && typeof v === 'object' && !Array.isArray(v) ? ` (it has ${Object.keys(v).length})` : ''
                return `Must have at ${u.keyword === 'minProperties' ? 'least' : 'most'} ${plural(Number(m[1]), 'property', 'properties')}${count}.`
            }
            break
        case 'dependentRequired':
        case 'dependencies':
            if ((m = e.match(/^Instance has "(.*)" but does not have "(.*)"\.$/s))) return `Has "${m[1]}", so it must also have "${m[2]}".`
            if ((m = e.match(/^Instance has "(.*)" but does not match/s))) return `Has "${m[1]}", so it must match the schema that depends on it.`
            break
        case 'dependentSchemas':
            if ((m = e.match(/^Instance has "(.*)" but/s))) return `Has "${m[1]}", so it must match the schema that depends on it.`
            break
        case 'properties':
        case 'patternProperties':
            if ((m = e.match(/^Property "(.*)" (?:does not match|matches pattern)/s))) return `Property "${m[1]}" has errors.`
            break
        case 'additionalProperties':
            if ((m = e.match(/^Property "(.*)" does not match/s))) return `Additional property "${m[1]}" has errors.`
            break
        case 'unevaluatedProperties':
            if ((m = e.match(/^Property "(.*)" does not match/s))) return `Unevaluated property "${m[1]}" has errors.`
            break
        case 'propertyNames':
            if ((m = e.match(/^Property name "(.*)" does not match/s))) return `The property name "${m[1]}" isn’t allowed.`
            break
        case 'items':
        case 'prefixItems':
        case 'additionalItems':
        case 'unevaluatedItems': {
            const child = node.children[0]?.unit.instanceLocation
            const index = child ? locationSegments(child)[ctx.segments.length] : undefined
            return index !== undefined ? `Item ${index} has errors.` : 'An item has errors.'
        }
        case '$ref':
        case '$recursiveRef': {
            const ref = resolveKeyword(ctx.schema, u.keywordLocation.replace(/\/\$(?:recursive)?[rR]ef$/, ''))
            const target = ref && typeof ref === 'object' && typeof ref[u.keyword] === 'string' ? ref[u.keyword] : null
            return `Doesn’t match the referenced schema${target ? ` (${target})` : ''}.`
        }
        case 'allOf': return 'Doesn’t match every schema in allOf.'
        case 'if': return /"then"/.test(e) ? 'Matches "if", but not "then".' : 'Doesn’t match "if", and doesn’t match "else".'
        default:
    }
    return e
}

function entryFor(node, ctx) {
    const u = node.unit
    const segments = locationSegments(u.instanceLocation)
    // Under propertyNames the instance is the key itself, not its value
    const found = ctx.inPropertyNames && segments.length
        ? { found: true, value: segments[segments.length - 1] }
        : valueAt(ctx.data, segments)
    const hasValue = found.found
    const value = found.value
    const isFalse = u.keyword === 'false'
    const parentKeyword = node.parent?.unit.keyword
    const keyword = isFalse
        ? (parentKeyword === 'if' ? (/"then"/.test(node.parent.unit.error) ? 'then' : 'else') : DESCENDS.has(parentKeyword) || parentKeyword === '$ref' ? parentKeyword : 'false')
        : u.keyword
    const location = isFalse ? falseLocation(node, segments, ctx.schema) : u.keyword === 'dependentRequired' ? u.keywordLocation.replace(/\/dependantRequired$/, '/dependentRequired') : u.keywordLocation
    return {
        keyword,
        pointer: toJsonPointer(segments),
        path: friendlyPath(segments, ctx.data),
        schemaPointer: readableLocation(location),
        message: describe(node, { ...ctx, segments, hasValue, value }),
        raw: u.error,
    }
}

function collect(nodes, ctx, causes, summaries) {
    for (const node of nodes) {
        if (isPassThrough(node.unit) && node.children.length) {
            summaries.push(entryFor(node, ctx))
            collect(node.children, { ...ctx, inPropertyNames: ctx.inPropertyNames || node.unit.keyword === 'propertyNames' }, causes, summaries)
            continue
        }
        const entry = entryFor(node, ctx)
        if (node.children.length) entry.details = detailsFor(node, ctx, summaries)
        causes.push(entry)
    }
}

// The errors under an anyOf/oneOf, grouped by option, or the failing items
// under minContains.
function detailsFor(node, ctx, summaries) {
    const groups = new Map()
    const optionBase = node.unit.keyword === 'anyOf' || node.unit.keyword === 'oneOf' ? `${node.unit.keywordLocation}/` : null
    for (const child of node.children) {
        let label = null
        if (optionBase && child.unit.keywordLocation.startsWith(optionBase)) {
            label = `Option ${Number(child.unit.keywordLocation.slice(optionBase.length).split('/')[0]) + 1}`
        } else if (optionBase) {
            label = 'Another option'
        }
        if (!groups.has(label)) groups.set(label, [])
        const causes = []
        collect([child], ctx, causes, summaries)
        groups.get(label).push(...causes)
    }
    return [...groups].map(([label, causes]) => ({ label, causes }))
}

/**
 * Turns @cfworker/json-schema's flat error list into
 *   { causes: [...], summaries: [...] }
 * `causes` are the errors to fix (wrapper errors like "Property "items" does
 * not match schema" are left out), each
 *   { keyword, pointer, path, schemaPointer, message, raw, details? }
 * with `details` for anyOf/oneOf (why each option failed) and minContains.
 * `summaries` are the wrapper errors, in the validator's order.
 */
export function explainErrors(units, { schema, data } = {}) {
    const tree = buildTree(units)
    const causes = []
    const summaries = []
    collect(tree, { schema, data, inPropertyNames: false }, causes, summaries)
    return { causes, summaries }
}

function describeThrown(error) {
    const message = String(error?.message || error)
    let m
    if ((m = message.match(/^Unresolved \$ref "(.*?)"\./s))) {
        return `Can’t resolve "$ref": "${m[1]}". Only references inside this schema can be followed (like #/$defs/name, or an "$id" or "$anchor" defined in it); other documents aren’t downloaded.`
    }
    if ((m = message.match(/^Duplicate schema URI "(.*)"\./s))) return `Two subschemas have the same URI (${m[1]}). Each "$id" must be unique.`
    if (error instanceof RangeError) return 'Validation went too deep. The schema may refer to itself in a loop (a "$ref" that leads back to itself without checking anything), or the data is nested too deeply.'
    if (error instanceof SyntaxError && /regular expression/i.test(message)) return `The schema has an invalid regular expression: ${message}`
    if (/Invalid URL/i.test(message)) return 'An "$id" or "$ref" in the schema isn’t a valid URI.'
    return `The validator couldn’t use this schema: ${message}`
}

/**
 * Validates `data` against `schema` with the `Validator` class from
 * @cfworker/json-schema, collecting every error (not just the first).
 *   { status: 'valid' }
 *   { status: 'invalid', causes, summaries, raw }
 *   { status: 'schema-error', message }   the validator couldn't use the schema
 */
export function validateData(Validator, schema, data, draft) {
    let result
    try {
        result = new Validator(schema, draft, false).validate(data)
    } catch (error) {
        return { status: 'schema-error', message: describeThrown(error) }
    }
    if (result.valid) return { status: 'valid' }
    return { status: 'invalid', ...explainErrors(result.errors, { schema, data }), raw: result.errors }
}

// ---------------------------------------------------------------- example

export const EXAMPLE_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Order",
  "type": "object",
  "required": ["id", "customer", "items"],
  "properties": {
    "id": { "type": "string", "pattern": "^ORD-[0-9]{4}$" },
    "customer": {
      "type": "object",
      "required": ["name", "email"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "email": { "type": "string", "format": "email" }
      }
    },
    "items": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["sku", "quantity", "price"],
        "properties": {
          "sku": { "type": "string" },
          "quantity": { "type": "integer", "minimum": 1 },
          "price": { "type": "number", "exclusiveMinimum": 0 }
        },
        "additionalProperties": false
      }
    },
    "status": { "enum": ["pending", "paid", "shipped"] }
  }
}`

export const EXAMPLE_DATA = `{
  "id": "ORD-1042",
  "customer": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "items": [
    { "sku": "KB-01", "quantity": 1, "price": 49.5 },
    { "sku": "MS-02", "quantity": 0, "price": 19.99 },
    { "sku": "CB-03", "quantity": 2, "price": "4.99" }
  ],
  "status": "refunded"
}`
