// Schema checks and output formats for the Fake Data Generator.
//
// A schema is a tree of fields: { id, name, type, fields? }, where type is a
// generator id, 'object' (nested object) or 'array' (array of objects).

export const MAX_DEPTH = 4
export const MAX_VALUES = 100_000
export const MAX_BYTES = 8_000_000

export const SQL_DIALECTS = [
    { id: 'postgres', label: 'PostgreSQL' },
    { id: 'mysql', label: 'MySQL / MariaDB' },
    { id: 'sqlite', label: 'SQLite' },
    { id: 'sqlserver', label: 'SQL Server' },
]

const DIALECT_RULES = {
    postgres: {
        id: (n) => `"${n.replaceAll('"', '""')}"`,
        bool: (b) => (b ? 'TRUE' : 'FALSE'),
        str: (s) => `'${s.replaceAll("'", "''")}'`,
    },
    mysql: {
        id: (n) => `\`${n.replaceAll('`', '``')}\``,
        bool: (b) => (b ? 'TRUE' : 'FALSE'),
        // Backslash is an escape character in MySQL string literals by default
        str: (s) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`,
    },
    sqlite: {
        id: (n) => `"${n.replaceAll('"', '""')}"`,
        bool: (b) => (b ? '1' : '0'),
        str: (s) => `'${s.replaceAll("'", "''")}'`,
    },
    sqlserver: {
        id: (n) => `[${n.replaceAll(']', ']]')}]`,
        bool: (b) => (b ? '1' : '0'),
        str: (s) => `N'${s.replaceAll("'", "''")}'`,
    },
}

export const fieldKey = (field) => String(field.name ?? '').trim()
export const isContainer = (field) => field.type === 'object' || field.type === 'array'

// "field_1", "field_2"… the first one not used by a sibling.
export function uniqueName(siblings, base = 'field') {
    const taken = new Set(siblings.map(fieldKey))
    for (let n = 1; ; n++) {
        const candidate = `${base}_${n}`
        if (!taken.has(candidate)) return candidate
    }
}

/**
 * Checks names (required, unique among siblings) and nesting depth.
 * Returns { [fieldId]: message } for every invalid field.
 */
export function validateSchema(fields, depth = 0, errors = {}) {
    const seen = new Map()
    for (const field of fields) {
        const key = fieldKey(field)
        if (!key) errors[field.id] = 'Enter a field name'
        else if (seen.has(key)) {
            errors[field.id] = `Another field here is already called “${key}”`
            if (!errors[seen.get(key)]) errors[seen.get(key)] = `Another field here is already called “${key}”`
        } else seen.set(key, field.id)
        if (isContainer(field)) {
            if (depth + 1 > MAX_DEPTH) errors[field.id] = `Nesting is limited to ${MAX_DEPTH} levels`
            else validateSchema(field.fields || [], depth + 1, errors)
        }
    }
    return errors
}

// Typical output size of each generator, for the size estimate
const AVERAGE_BYTES = { paragraph: 160, sentence: 50, avatar: 70, uuid: 38, url: 32, email: 28, address: 22, jobTitle: 28, company: 22, country: 14, phone: 20, datePast: 26, dateFuture: 26, dateRecent: 26 }
const ARRAY_MAX = 3

// Values and approximate JSON bytes produced per row (worst case for arrays).
export function estimateRow(fields) {
    let values = 0
    let bytes = 2
    for (const field of fields) {
        const keyBytes = fieldKey(field).length + 10
        if (field.type === 'object' || field.type === 'array') {
            const inner = estimateRow(field.fields || [])
            const times = field.type === 'array' ? ARRAY_MAX : 1
            values += inner.values * times
            bytes += keyBytes + inner.bytes * times + 4
        } else {
            values += 1
            bytes += keyBytes + (AVERAGE_BYTES[field.type] ?? 16)
        }
    }
    return { values, bytes }
}

// ---------- SQL ----------

export function quoteIdentifier(name, dialect) {
    return (DIALECT_RULES[dialect] ?? DIALECT_RULES.postgres).id(name)
}

// "public.users" -> "public"."users". Returns null for an empty or malformed name.
export function quoteTableName(table, dialect) {
    const parts = String(table ?? '').split('.').map(p => p.trim())
    if (!parts.length || parts.some(p => !p)) return null
    return parts.map(p => quoteIdentifier(p, dialect)).join('.')
}

export function sqlLiteral(value, dialect) {
    const rules = DIALECT_RULES[dialect] ?? DIALECT_RULES.postgres
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'boolean') return rules.bool(value)
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Date) return rules.str(value.toISOString())
    if (typeof value === 'object') return rules.str(JSON.stringify(value))
    return rules.str(String(value))
}

// One INSERT per row. Nested objects and arrays are inserted as JSON text.
export function toSql(items, fields, { dialect = 'postgres', table = 'users' } = {}) {
    const tableName = quoteTableName(table, dialect)
    if (!tableName) throw new Error('Enter a table name (for example users or public.users).')
    const keys = fields.map(fieldKey)
    const columns = keys.map(k => quoteIdentifier(k, dialect)).join(', ')
    return items
        .map(item => `INSERT INTO ${tableName} (${columns}) VALUES (${keys.map(k => sqlLiteral(item[k], dialect)).join(', ')});`)
        .join('\n')
}

// ---------- CSV ----------

// RFC 4180: quote cells containing a comma, quote or line break, doubling quotes.
export function csvCell(value) {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

// Nested objects become dotted columns (user.address.city); arrays stay JSON.
export function csvColumns(fields, prefix = []) {
    const columns = []
    for (const field of fields) {
        const path = [...prefix, fieldKey(field)]
        if (field.type === 'object' && field.fields?.length) columns.push(...csvColumns(field.fields, path))
        else columns.push({ header: path.join('.'), path })
    }
    return columns
}

export function toCsv(items, fields) {
    const columns = csvColumns(fields)
    const seen = new Set()
    for (const { header } of columns) {
        if (seen.has(header)) throw new Error(`Two columns would both be called “${header}”. Rename one of the fields.`)
        seen.add(header)
    }
    const valueAt = (item, path) => path.reduce((obj, key) => (obj && typeof obj === 'object' ? obj[key] : undefined), item)
    const lines = [columns.map(c => csvCell(c.header)).join(',')]
    for (const item of items) lines.push(columns.map(c => csvCell(valueAt(item, c.path))).join(','))
    return lines.join('\n')
}
