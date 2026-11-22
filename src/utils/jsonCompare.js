// "Compare as JSON" for the Text Diff: each side is parsed and written out the
// same way (object keys sorted at every level, 2-space indent), so key order and
// formatting stop showing up as differences. Array order still matters.
//
// Numbers keep the exact text they were written with (JSON.parse source text
// access + JSON.rawJSON), so 1.0 vs 1 and integers above 2^53 still differ.
// Browsers without it parse numbers as JavaScript numbers.
//
// When a side isn't valid JSON, scanJson() says where and why with the same
// wording in every browser (engines word their errors differently, and some
// give no position at all).

// Browsers with "JSON.parse source text access" pass revivers the source text
const SOURCE_ACCESS = (() => {
    let ok = false
    try {
        JSON.parse('1', (key, value, context) => {
            ok = typeof context?.source === 'string'
            return value
        })
    } catch {
        ok = false
    }
    return ok
})()

export const KEEPS_NUMBER_TEXT = SOURCE_ACCESS && typeof JSON.rawJSON === 'function' && typeof JSON.isRawJSON === 'function'

// Duplicate keys are looked for in texts up to this size (it costs a second pass)
const DUPLICATE_SCAN_LIMIT = 2_000_000
const MAX_DUPLICATES = 5

/** 1-based line and column (in UTF-16 code units) of `offset` in `text`. */
export function lineColumn(text, offset) {
    let line = 1
    let lineStart = 0
    const end = Math.min(offset, text.length)
    for (let k = 0; k < end; k++) {
        if (text.charCodeAt(k) === 10) {
            line++
            lineStart = k + 1
        }
    }
    return { line, column: offset - lineStart + 1 }
}

// ---------------------------------------------------------------- scanner

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const WORD = /[A-Za-z_$][\w$]*/y
const HEX4 = /^[0-9A-Fa-f]{4}$/
const isSpace = (c) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d
const hex = (code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`

/**
 * Checks `text` against the JSON grammar (RFC 8259, exactly what JSON.parse
 * accepts) without building values. Returns { error, duplicates, duplicateCount }:
 *   error       null, or { message, offset } for the first problem
 *   duplicates  with { duplicates: true }: up to 5 repeated keys in one object,
 *               as { key, offset } (JSON.parse keeps only the last value)
 */
export function scanJson(text, { duplicates: collect = false } = {}) {
    const n = text.length
    let i = 0
    const stack = [] // open objects and arrays: { close, keys }
    const duplicates = []
    let duplicateCount = 0

    const done = (error) => ({ error, duplicates, duplicateCount })
    const fail = (message, offset = i) => done({ message, offset })
    const skip = () => {
        while (i < n && isSpace(text.charCodeAt(i))) i++
    }
    const isComment = (at) => text[at] === '/' && (text[at + 1] === '/' || text[at + 1] === '*')
    const found = (at) => {
        if (at >= n) return 'the end of the text'
        const code = text.codePointAt(at)
        if (code === 10 || code === 13) return 'a line break'
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return `the control character ${hex(code)}`
        return `“${String.fromCodePoint(code)}”`
    }

    // At an opening quote: moves past the closing quote, or returns an error
    const string = () => {
        const start = i
        i++
        while (i < n) {
            const c = text.charCodeAt(i)
            if (c === 0x22) {
                i++
                return null
            }
            if (c === 0x5c) {
                const escape = text[i + 1]
                if (escape === undefined) break
                if (escape === 'u') {
                    if (!HEX4.test(text.slice(i + 2, i + 6))) return fail('Invalid escape in a string: “\\u” must be followed by 4 hexadecimal digits.')
                    i += 6
                } else if ('"\\/bfnrt'.includes(escape)) {
                    i += 2
                } else {
                    return fail(`Invalid escape “\\${escape}” in a string. A backslash is written as \\\\.`)
                }
                continue
            }
            if (c === 0x0a || c === 0x0d) return fail('Line break inside a string. Close the string with “"” first, or write the line break as \\n.')
            if (c < 0x20) return fail(`The control character ${hex(c)} can’t appear inside a string. Write it as an escape such as \\t.`)
            i++
        }
        return fail('This string is never closed: a “"” is missing.', start)
    }

    // At "-" or a digit: moves past the number, or returns an error
    const number = () => {
        const start = i
        NUMBER.lastIndex = i
        const match = NUMBER.exec(text)
        if (!match) return fail('A minus sign must be followed by a digit.')
        i += match[0].length
        const next = text[i]
        if (next >= '0' && next <= '9') return fail('Numbers can’t have leading zeros (write 7, not 07).', start)
        if (next === '.') return fail(/[.eE]/.test(match[0]) ? 'Unexpected “.” in a number.' : 'A decimal point must be followed by a digit.')
        if (next === 'e' || next === 'E') return fail(/[eE]/.test(match[0]) ? `Unexpected “${next}” in a number.` : 'An exponent must be followed by a digit.')
        return null
    }

    const unexpectedValue = () => {
        WORD.lastIndex = i
        const word = WORD.exec(text)?.[0]
        if (word) {
            if (/^(?:True|False|TRUE|FALSE|Null|NULL|None|nil)$/.test(word)) return `“${word}” isn’t a JSON value. JSON writes true, false and null in lower case.`
            if (word === 'undefined' || word === 'NaN' || word === 'Infinity') return `“${word}” isn’t allowed in JSON. Use null or a number.`
            return `Unexpected “${word}”. Text values must be in double quotes.`
        }
        const ch = text[i]
        if (ch === "'") return 'Strings must be in double quotes, not single quotes.'
        if (isComment(i)) return 'Comments aren’t allowed in JSON.'
        if (ch === '.') return 'Numbers must start with a digit (write 0.5, not .5).'
        if (ch === '+') return 'Numbers can’t start with “+”.'
        return `Expected a value but found ${found(i)}.`
    }

    skip()
    if (i >= n) return fail('The text is empty.')
    let mode = 'value' // 'value' | 'key' | 'after'
    for (;;) {
        if (mode === 'value') {
            skip()
            if (i >= n) return fail('Unexpected end of the text: a value is missing.')
            const ch = text[i]
            if (ch === '{' || ch === '[') {
                const close = ch === '{' ? '}' : ']'
                i++
                skip()
                if (text[i] === close) {
                    i++
                    mode = 'after'
                    continue
                }
                stack.push({ close, keys: ch === '{' && collect ? new Set() : null })
                mode = ch === '{' ? 'key' : 'value'
                continue
            }
            let error = null
            if (ch === '"') {
                error = string()
            } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
                error = number()
            } else {
                WORD.lastIndex = i
                const word = WORD.exec(text)?.[0]
                if (word !== 'true' && word !== 'false' && word !== 'null') return fail(unexpectedValue())
                i += word.length
            }
            if (error) return error
            mode = 'after'
            continue
        }

        if (mode === 'key') {
            skip()
            if (i >= n) return fail('Unexpected end of the text: “}” is missing.')
            if (text[i] !== '"') {
                if (text[i] === "'") return fail('Property names must be in double quotes, not single quotes.')
                if (isComment(i)) return fail('Comments aren’t allowed in JSON.')
                return fail(`Expected a property name in double quotes but found ${found(i)}.`)
            }
            const start = i
            const error = string()
            if (error) return error
            const { keys } = stack[stack.length - 1]
            if (keys) {
                const key = JSON.parse(text.slice(start, i))
                if (keys.has(key)) {
                    duplicateCount++
                    if (duplicates.length < MAX_DUPLICATES) duplicates.push({ key, offset: start })
                } else {
                    keys.add(key)
                }
            }
            skip()
            if (text[i] !== ':') return fail(`Expected “:” after the property name but found ${found(i)}.`)
            i++
            mode = 'value'
            continue
        }

        // After a complete value
        skip()
        const top = stack[stack.length - 1]
        if (!top) {
            if (i >= n) return done(null)
            if (isComment(i)) return fail('Comments aren’t allowed in JSON.')
            return fail(`Unexpected ${found(i)} after the end of the JSON. A JSON text holds a single value (wrap several in [ ]).`)
        }
        if (i >= n) return fail(`Unexpected end of the text: “${top.close}” is missing.`)
        const ch = text[i]
        if (ch === ',') {
            const comma = i
            i++
            skip()
            if (text[i] === top.close) return fail(`Trailing comma: remove the “,” before “${top.close}”.`, comma)
            mode = top.close === '}' ? 'key' : 'value'
            continue
        }
        if (ch === top.close) {
            i++
            stack.pop()
            continue
        }
        if (isComment(i)) return fail('Comments aren’t allowed in JSON.')
        if (ch === '}' || ch === ']') return fail(`Expected “${top.close}” but found “${ch}”: the brackets don’t match.`)
        return fail(`Expected “,” or “${top.close}” but found ${found(i)}.`)
    }
}

// ---------------------------------------------------------------- canonical form

const reviveNumberText = (key, value, context) =>
    typeof value === 'number' && typeof context?.source === 'string' ? JSON.rawJSON(context.source) : value

const isRawJson = (value) => typeof JSON.isRawJSON === 'function' && JSON.isRawJSON(value)

// Rebuilt with keys in sorted order. JavaScript always lists integer-like keys
// ("2", "10") first, in numeric order, then the rest in the order given: the
// result is the same for any input order, which is what the comparison needs.
function sortKeys(value) {
    if (value === null || typeof value !== 'object' || isRawJson(value)) return value
    if (Array.isArray(value)) return value.map(sortKeys)
    const sorted = Object.create(null) // a "__proto__" key stays plain data
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key])
    return sorted
}

/** The canonical text of a parsed value: sorted keys, 2-space indent. */
export function canonicalJson(value) {
    return JSON.stringify(sortKeys(value), null, 2) ?? ''
}

// Last resort when the scanner and the engine disagree: the engine's own words
function engineError(error, source) {
    const message = String(error?.message || 'Invalid JSON')
    const lc = message.match(/line (\d+) column (\d+)/)
    if (lc) return { message, line: Number(lc[1]), column: Number(lc[2]) }
    const position = message.match(/position (\d+)/)
    return position ? { message, ...lineColumn(source, Number(position[1])) } : { message }
}

const TOO_DEEP = { message: 'It’s nested too deeply to compare.' }

/**
 * One side of a JSON comparison:
 *   { status: 'empty' }                          nothing but whitespace
 *   { status: 'invalid', error }                 error: { message, line?, column? }
 *   { status: 'ok', text, duplicates, duplicateCount }
 * `text` is the canonical form; duplicates: [{ key, line, column }].
 */
export function prepareJsonSide(input, { keepNumberText = KEEPS_NUMBER_TEXT } = {}) {
    const source = String(input ?? '').replace(/^\ufeff/, '')
    if (!source.trim()) return { status: 'empty' }

    let value
    try {
        value = keepNumberText ? JSON.parse(source, reviveNumberText) : JSON.parse(source)
    } catch (error) {
        if (error instanceof RangeError) return { status: 'invalid', error: TOO_DEEP }
        const problem = scanJson(source).error
        if (!problem) return { status: 'invalid', error: engineError(error, source) }
        return { status: 'invalid', error: { message: problem.message, ...lineColumn(source, problem.offset) } }
    }

    let text
    try {
        text = canonicalJson(value)
    } catch {
        return { status: 'invalid', error: TOO_DEEP }
    }

    const scan = source.length <= DUPLICATE_SCAN_LIMIT ? scanJson(source, { duplicates: true }) : null
    const ok = scan && !scan.error
    return {
        status: 'ok',
        text,
        duplicates: ok ? scan.duplicates.map(d => ({ key: d.key, ...lineColumn(source, d.offset) })) : [],
        duplicateCount: ok ? scan.duplicateCount : 0,
    }
}
