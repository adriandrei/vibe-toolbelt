// Exact JSON handling for the Recipes tool.
//
// parseJsonTree() reads JSON into a light tree that keeps everything as it
// was written: key order (JSON.parse moves integer-like keys such as "10" to
// the front), duplicate keys (JSON.parse keeps only the last), the text of
// numbers (12345678901234567890 and 1.0 stay as written) and string escapes.
// So prettify and minify change only whitespace, and sorting changes only the
// key order. Errors say what is wrong and where (line and column).
//
// Tree nodes: { t: 'o', e: [[rawKey, key, node], …] } objects,
//             { t: 'a', e: [node, …] } arrays,
//             { t: 'v', s: 'source text' } strings, numbers, true, false, null.

const MAX_DEPTH = 2000

export class JsonError extends Error {
    constructor(message, position) {
        super(message)
        this.name = 'JsonError'
        this.position = position
    }
}

const TRUE = { t: 'v', s: 'true' }
const FALSE = { t: 'v', s: 'false' }
const NULL = { t: 'v', s: 'null' }

const isDigit = (c) => c >= 48 && c <= 57
const isWordStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36

/** 1-based line and column of a UTF-16 offset. */
export function lineColumn(text, position) {
    let line = 1
    let lineStart = 0
    const end = Math.min(position, text.length)
    for (let i = 0; i < end; i++) {
        if (text.charCodeAt(i) === 10) {
            line++
            lineStart = i + 1
        }
    }
    return { line, column: end - lineStart + 1 }
}

function describeAt(text, i) {
    if (i >= text.length) return 'the end of the input'
    const ch = String.fromCodePoint(text.codePointAt(i))
    if (ch === '\n' || ch === '\r') return 'a line break'
    if (ch === '\t') return 'a tab'
    if (ch === ' ') return 'a space'
    return `“${ch}”`
}

/**
 * Parses JSON text into a tree (see the top of this file).
 * Returns { tree, duplicates } where duplicates lists up to 5 keys that
 * appear more than once in the same object. Throws JsonError.
 */
export function parseJsonTree(text) {
    const n = text.length
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
    const duplicates = []

    const fail = (message, at = i) => {
        throw new JsonError(message, at)
    }

    const skipWhitespace = () => {
        while (i < n) {
            const c = text.charCodeAt(i)
            if (c === 32 || c === 10 || c === 13 || c === 9) i++
            else break
        }
    }

    const word = () => {
        const m = /[A-Za-z_$][\w$]*/y
        m.lastIndex = i
        const found = m.exec(text)
        return found ? found[0] : ''
    }

    const badValue = () => {
        if (i >= n) fail('the input ended where a value was expected')
        const c = text.charCodeAt(i)
        if (c === 39) fail('strings need double quotes ("text"), not single quotes')
        if (c === 47) fail('JSON doesn’t allow comments')
        if (isWordStart(c)) {
            const w = word()
            if (w === 'NaN' || w === 'Infinity' || w === 'undefined') fail(`“${w}” isn’t a JSON value (only numbers, strings, objects, arrays, true, false and null are)`)
            if (/^(True|False|None|TRUE|FALSE|NULL|Null)$/.test(w)) fail(`“${w}” isn’t a JSON value: write ${w.toLowerCase() === 'none' ? 'null' : w.toLowerCase()} in lower case`)
            fail(`expected a value, found “${w}” (strings need double quotes)`)
        }
        fail(`expected a value, found ${describeAt(text, i)}`)
    }

    const parseString = () => {
        const start = i
        i++
        let escaped = false
        for (;;) {
            if (i >= n) fail('a string isn’t closed: the closing " is missing', start)
            const c = text.charCodeAt(i)
            if (c === 34) {
                i++
                return { start, end: i, escaped }
            }
            if (c === 92) {
                escaped = true
                const e = text.charCodeAt(i + 1)
                if (e === 117) {
                    if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('“\\u” must be followed by four hex digits')
                    i += 6
                } else if (e === 34 || e === 92 || e === 47 || e === 98 || e === 102 || e === 110 || e === 114 || e === 116) {
                    i += 2
                } else {
                    fail(i + 1 >= n ? 'a string isn’t closed: the closing " is missing' : `“\\${String.fromCodePoint(text.codePointAt(i + 1))}” isn’t a valid escape (use \\" \\\\ \\/ \\b \\f \\n \\r \\t or \\uXXXX)`)
                }
            } else if (c < 0x20) {
                fail(c === 10 || c === 13 ? 'a string contains a line break: write it as \\n' : 'a string contains a control character: escape it, for example as \\t')
            } else {
                i++
            }
        }
    }

    const parseNumber = () => {
        const start = i
        if (text.charCodeAt(i) === 45) i++
        const first = text.charCodeAt(i)
        if (first === 48) {
            i++
            if (isDigit(text.charCodeAt(i))) fail('numbers can’t have leading zeros')
        } else if (isDigit(first)) {
            while (isDigit(text.charCodeAt(i))) i++
        } else {
            fail('a “-” must be followed by digits')
        }
        if (text.charCodeAt(i) === 46) {
            i++
            if (!isDigit(text.charCodeAt(i))) fail('a number needs digits after its decimal point')
            while (isDigit(text.charCodeAt(i))) i++
        }
        const e = text.charCodeAt(i)
        if (e === 101 || e === 69) {
            i++
            const sign = text.charCodeAt(i)
            if (sign === 43 || sign === 45) i++
            if (!isDigit(text.charCodeAt(i))) fail('a number needs digits in its exponent')
            while (isDigit(text.charCodeAt(i))) i++
        }
        return text.slice(start, i)
    }

    let parseValue = null

    const parseObject = (depth) => {
        if (depth >= MAX_DEPTH) fail(`the JSON is nested more than ${MAX_DEPTH.toLocaleString('en-US')} levels deep`)
        i++
        const entries = []
        const seen = new Set()
        skipWhitespace()
        if (text.charCodeAt(i) === 125) {
            i++
            return { t: 'o', e: entries }
        }
        let comma = -1
        for (;;) {
            skipWhitespace()
            const c = text.charCodeAt(i)
            if (c !== 34) {
                if (i >= n) fail('the input ended inside an object: a “}” is missing')
                if (c === 125 && comma >= 0) fail('trailing commas aren’t allowed: remove the last “,”', comma)
                if (c === 39) fail('keys need double quotes ("key"), not single quotes')
                if (isWordStart(c)) fail(`keys must be in double quotes: write "${word()}"`)
                fail(`expected a key in double quotes, found ${describeAt(text, i)}`)
            }
            const { start, end, escaped } = parseString()
            const raw = text.slice(start, end)
            const key = escaped ? JSON.parse(raw) : raw.slice(1, -1)
            if (seen.has(key)) {
                if (duplicates.length < 5 && !duplicates.includes(key)) duplicates.push(key)
            } else {
                seen.add(key)
            }
            skipWhitespace()
            if (text.charCodeAt(i) !== 58) fail(i >= n ? 'the input ended after a key: a “:” is missing' : `expected “:” after the key, found ${describeAt(text, i)}`)
            i++
            entries.push([raw, key, parseValue(depth + 1)])
            skipWhitespace()
            const d = text.charCodeAt(i)
            if (d === 44) {
                comma = i
                i++
            } else if (d === 125) {
                i++
                return { t: 'o', e: entries }
            } else {
                fail(i >= n ? 'the input ended inside an object: a “}” is missing' : `expected “,” or “}” after a value, found ${describeAt(text, i)}`)
            }
        }
    }

    const parseArray = (depth) => {
        if (depth >= MAX_DEPTH) fail(`the JSON is nested more than ${MAX_DEPTH.toLocaleString('en-US')} levels deep`)
        i++
        const items = []
        skipWhitespace()
        if (text.charCodeAt(i) === 93) {
            i++
            return { t: 'a', e: items }
        }
        let comma = -1
        for (;;) {
            skipWhitespace()
            if (text.charCodeAt(i) === 93 && comma >= 0) fail('trailing commas aren’t allowed: remove the last “,”', comma)
            items.push(parseValue(depth + 1))
            skipWhitespace()
            const d = text.charCodeAt(i)
            if (d === 44) {
                comma = i
                i++
            } else if (d === 93) {
                i++
                return { t: 'a', e: items }
            } else {
                fail(i >= n ? 'the input ended inside an array: a “]” is missing' : `expected “,” or “]” after a value, found ${describeAt(text, i)}`)
            }
        }
    }

    parseValue = (depth) => {
        skipWhitespace()
        const c = text.charCodeAt(i)
        if (c === 123) return parseObject(depth)
        if (c === 91) return parseArray(depth)
        if (c === 34) {
            const { start, end } = parseString()
            return { t: 'v', s: text.slice(start, end) }
        }
        if (c === 45 || isDigit(c)) return { t: 'v', s: parseNumber() }
        if (text.startsWith('true', i)) {
            i += 4
            return TRUE
        }
        if (text.startsWith('false', i)) {
            i += 5
            return FALSE
        }
        if (text.startsWith('null', i)) {
            i += 4
            return NULL
        }
        return badValue()
    }

    skipWhitespace()
    if (i >= n) fail('the input is empty: there’s no JSON to read')
    const tree = parseValue(0)
    skipWhitespace()
    if (i < n) fail(`there’s more after the JSON value (${describeAt(text, i)}). Only one value is allowed; for JSON Lines, split the lines first`)
    return { tree, duplicates }
}

/** JsonError → readable message with the line and column. */
export function describeJsonError(text, error) {
    if (!(error instanceof JsonError)) return error?.message || String(error)
    const { line, column } = lineColumn(text, error.position)
    return `${error.message} (line ${line}, column ${column})`
}

// Unicode code point order, like `jq -S` and Python's sort_keys
function compareCodePoints(a, b) {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) {
        const x = a.codePointAt(i)
        const y = b.codePointAt(i)
        if (x !== y) return x - y
        if (x > 0xffff) i++
    }
    return a.length - b.length
}

/**
 * Prints a tree. indent: '' (minified), '  ', '    ' or '\t'.
 * sortKeys orders object keys by Unicode code point (stable, so duplicate
 * keys keep their order).
 */
export function printJsonTree(tree, { indent = '', sortKeys = false } = {}) {
    const out = []
    const colon = indent ? ': ' : ':'
    const walk = (node, depth) => {
        if (node.t === 'v') {
            out.push(node.s)
            return
        }
        const isObject = node.t === 'o'
        const items = isObject && sortKeys ? [...node.e].sort((a, b) => compareCodePoints(a[1], b[1])) : node.e
        if (!items.length) {
            out.push(isObject ? '{}' : '[]')
            return
        }
        out.push(isObject ? '{' : '[')
        const pad = indent ? `\n${indent.repeat(depth + 1)}` : ''
        for (let k = 0; k < items.length; k++) {
            if (k) out.push(',')
            if (pad) out.push(pad)
            if (isObject) {
                out.push(items[k][0], colon)
                walk(items[k][2], depth + 1)
            } else {
                walk(items[k], depth + 1)
            }
        }
        if (indent) out.push(`\n${indent.repeat(depth)}`)
        out.push(isObject ? '}' : ']')
    }
    walk(tree, 0)
    return out.join('')
}

const INTEGER = /^-?\d+$/

/**
 * Tree → plain JavaScript value. Integers outside the safe range become
 * BigInt so no digits are lost; with duplicate keys the last one wins (as
 * with JSON.parse).
 */
export function treeToValue(node) {
    if (node.t === 'v') {
        const s = node.s
        const c = s.charCodeAt(0)
        if (c === 34) return s.includes('\\') ? JSON.parse(s) : s.slice(1, -1)
        if (s === 'true') return true
        if (s === 'false') return false
        if (s === 'null') return null
        const value = Number(s)
        if (!Number.isSafeInteger(value) && INTEGER.test(s)) return BigInt(s)
        return value
    }
    if (node.t === 'a') return node.e.map(treeToValue)
    const obj = {}
    for (const [, key, child] of node.e) {
        // A "__proto__" key must become an own property, not the prototype
        if (key === '__proto__') Object.defineProperty(obj, key, { value: treeToValue(child), enumerable: true, writable: true, configurable: true })
        else obj[key] = treeToValue(child)
    }
    return obj
}

const ARRAY_INDEX = /^(?:0|[1-9]\d{0,9})$/

/** True when some object lists an integer-like key ("10") after another key: JavaScript objects would move it. */
export function hasMovableKeys(node) {
    if (node.t === 'v') return false
    if (node.t === 'a') return node.e.some(hasMovableKeys)
    let sawOther = false
    let lastIndex = -1
    for (const [, key] of node.e) {
        if (ARRAY_INDEX.test(key) && Number(key) < 4294967295) {
            if (sawOther || Number(key) < lastIndex) return true
            lastIndex = Number(key)
        } else {
            sawOther = true
        }
    }
    return node.e.some(([, , child]) => hasMovableKeys(child))
}
