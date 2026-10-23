// Shell word splitting and quoting, used to import and export cURL commands.
//
// splitShellWords(text) turns a command line into the argument list the
// program would receive, the way bash (POSIX) or cmd.exe (Windows, as in
// Chrome's "Copy as cURL (cmd)") would. Nothing is executed or expanded:
// $VAR, $(…) and `…` are kept as literal text and reported in `expansions`.
//
// quotePosix(value) quotes a value so that bash, zsh and sh pass it through
// unchanged (single quotes, with ' written as '\'').

export class ShellSyntaxError extends Error {
    constructor(message, index) {
        super(message)
        this.name = 'ShellSyntaxError'
        this.index = index
    }
}

const isBlank = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === ' '

// Line and column (1-based) of a character index, for error messages
export function positionOf(text, index) {
    const before = text.slice(0, Math.max(0, index))
    const line = before.split('\n').length
    const column = index - before.lastIndexOf('\n')
    return { line, column }
}

function where(text, index) {
    const { line, column } = positionOf(text, index)
    return `line ${line}, column ${column}`
}

// ---------------------------------------------------------------- POSIX ----

// Decodes bytes produced by \xHH and octal escapes inside $'…' as UTF-8
function flushBytes(bytes) {
    if (!bytes.length) return ''
    const text = new TextDecoder('utf-8').decode(new Uint8Array(bytes))
    bytes.length = 0
    return text
}

const ANSI_C_ESCAPES = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' }

function readAnsiC(input, i, open) {
    let value = ''
    const bytes = []
    const n = input.length
    while (i < n) {
        const c = input[i]
        if (c === "'") return { value: value + flushBytes(bytes), end: i + 1 }
        if (c !== '\\') {
            value += flushBytes(bytes) + c
            i += 1
            continue
        }
        const e = input[i + 1]
        if (e === undefined) break
        i += 2
        if (Object.hasOwn(ANSI_C_ESCAPES, e)) {
            value += flushBytes(bytes) + ANSI_C_ESCAPES[e]
        } else if (e === 'x') {
            const m = /^[0-9a-fA-F]{1,2}/.exec(input.slice(i, i + 2))
            if (m) {
                bytes.push(parseInt(m[0], 16))
                i += m[0].length
            } else {
                value += flushBytes(bytes) + '\\x'
            }
        } else if (e >= '0' && e <= '7') {
            const m = /^[0-7]{0,2}/.exec(input.slice(i, i + 2))
            bytes.push(parseInt(e + m[0], 8) & 0xff)
            i += m[0].length
        } else if (e === 'u' || e === 'U') {
            const m = (e === 'u' ? /^[0-9a-fA-F]{1,4}/ : /^[0-9a-fA-F]{1,8}/).exec(input.slice(i, i + (e === 'u' ? 4 : 8)))
            if (!m) {
                value += flushBytes(bytes) + '\\' + e
                continue
            }
            i += m[0].length
            let code = parseInt(m[0], 16)
            // Join a 😀 surrogate pair into one character
            if (code >= 0xd800 && code <= 0xdbff) {
                const low = /^\\u(d[c-f][0-9a-f]{2})/i.exec(input.slice(i, i + 6))
                if (low) {
                    code = 0x10000 + ((code - 0xd800) << 10) + (parseInt(low[1], 16) - 0xdc00)
                    i += 6
                }
            }
            value += flushBytes(bytes) + (code > 0x10ffff ? '�' : String.fromCodePoint(code))
        } else if (e === 'c') {
            const ctl = input[i]
            if (ctl === undefined) break
            value += flushBytes(bytes) + String.fromCharCode(ctl.toUpperCase().charCodeAt(0) & 0x1f)
            i += 1
        } else {
            // Unknown escapes are kept as written
            value += flushBytes(bytes) + '\\' + e
        }
    }
    throw new ShellSyntaxError(`Unterminated $'…' string that starts at ${where(input, open)}`, open)
}

// $VAR, ${…}, $(…), $((…)) and special parameters. Returns null for a lone $.
function readDollar(input, i) {
    const next = input[i + 1]
    if (next === '{') {
        const end = input.indexOf('}', i + 2)
        if (end === -1) throw new ShellSyntaxError(`Unterminated \${…} at ${where(input, i)}`, i)
        return { text: input.slice(i, end + 1), end: end + 1 }
    }
    if (next === '(') {
        let depth = 0
        let quote = null
        for (let j = i + 1; j < input.length; j++) {
            const c = input[j]
            if (quote) {
                if (c === '\\' && quote === '"') j += 1
                else if (c === quote) quote = null
                continue
            }
            if (c === '\\') { j += 1; continue }
            if (c === "'" || c === '"') { quote = c; continue }
            if (c === '(') depth += 1
            else if (c === ')') {
                depth -= 1
                if (depth === 0) return { text: input.slice(i, j + 1), end: j + 1 }
            }
        }
        throw new ShellSyntaxError(`Unterminated $(…) at ${where(input, i)}`, i)
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i + 1))
    if (name) return { text: '$' + name[0], end: i + 1 + name[0].length }
    if (next !== undefined && /[0-9@*#?$!-]/.test(next)) return { text: '$' + next, end: i + 2 }
    return null
}

function readBacktick(input, i) {
    for (let j = i + 1; j < input.length; j++) {
        if (input[j] === '\\') { j += 1; continue }
        if (input[j] === '`') return { text: input.slice(i, j + 1), end: j + 1 }
    }
    throw new ShellSyntaxError(`Unterminated \`…\` at ${where(input, i)}`, i)
}

function readDouble(input, i, open, expansions) {
    let value = ''
    const n = input.length
    while (i < n) {
        const c = input[i]
        if (c === '"') return { value, end: i + 1 }
        if (c === '\\') {
            const next = input[i + 1]
            if (next === '\n') { i += 2; continue }
            if (next === '\r' && input[i + 2] === '\n') { i += 3; continue }
            if (next === '$' || next === '`' || next === '"' || next === '\\') {
                value += next
                i += 2
                continue
            }
            value += '\\'
            i += 1
            continue
        }
        if (c === '$') {
            const r = readDollar(input, i)
            if (r) {
                value += r.text
                expansions.push(r.text)
                i = r.end
                continue
            }
        }
        if (c === '`') {
            const r = readBacktick(input, i)
            value += r.text
            expansions.push(r.text)
            i = r.end
            continue
        }
        value += c
        i += 1
    }
    throw new ShellSyntaxError(`Unterminated double quote that starts at ${where(input, open)}`, open)
}

/**
 * Splits a POSIX (bash/zsh/sh) command line into words.
 * Stops at the first control operator (| ; & && || > <) and reports it.
 */
export function splitPosix(input) {
    const words = []
    const expansions = []
    const notes = []
    const n = input.length
    let word = null
    let i = 0
    const append = (text) => { word = (word ?? '') + text }
    const finish = () => {
        if (word !== null) words.push(word)
        word = null
    }

    while (i < n) {
        const ch = input[i]
        if (isBlank(ch)) {
            finish()
            i += 1
            continue
        }
        if (ch === '#' && word === null) {
            while (i < n && input[i] !== '\n') i += 1
            continue
        }
        if (ch === '\\') {
            if (input[i + 1] === '\n') { i += 2; continue }
            if (input[i + 1] === '\r' && input[i + 2] === '\n') { i += 3; continue }
            // "\ " followed by a line break is almost always a mistyped continuation
            const stray = /^\\[ \t]+\r?\n/.exec(input.slice(i, i + 40))
            if (stray) {
                notes.push('stray-backslash-space')
                i += stray[0].length
                continue
            }
            if (i + 1 < n) append(input[i + 1])
            i += 2
            continue
        }
        if (ch === "'") {
            const end = input.indexOf("'", i + 1)
            if (end === -1) throw new ShellSyntaxError(`Unterminated single quote that starts at ${where(input, i)}`, i)
            append(input.slice(i + 1, end))
            i = end + 1
            continue
        }
        if (ch === '$' && input[i + 1] === "'") {
            const r = readAnsiC(input, i + 2, i)
            append(r.value)
            i = r.end
            continue
        }
        if (ch === '$' && input[i + 1] === '"') {
            // $"…" (locale translation) behaves like "…"
            i += 1
            continue
        }
        if (ch === '"') {
            const r = readDouble(input, i + 1, i, expansions)
            append(r.value)
            i = r.end
            continue
        }
        if (ch === '`') {
            const r = readBacktick(input, i)
            append(r.text)
            expansions.push(r.text)
            i = r.end
            continue
        }
        if (ch === '$') {
            const r = readDollar(input, i)
            if (r) {
                append(r.text)
                expansions.push(r.text)
                i = r.end
                continue
            }
        }
        // A lone & inside a word (an unquoted URL like ?a=1&b=2) would end the
        // command in a real shell. Keep it, since that's clearly what was meant.
        if (ch === '&' && word !== null && input[i + 1] !== undefined && !isBlank(input[i + 1]) && !'&|;<>'.includes(input[i + 1])) {
            notes.push('unquoted-ampersand')
            append(ch)
            i += 1
            continue
        }
        if ('|&;<>'.includes(ch)) {
            // `2>` and `1>` redirect a file descriptor: the digits aren't an argument
            if ((ch === '>' || ch === '<') && word !== null && /^\d+$/.test(word)) word = null
            finish()
            const operator = /^(\|\||&&|;;|>>|<<|&>|>&|[|&;<>])/.exec(input.slice(i))[0]
            return { words, expansions, notes, operator, rest: input.slice(i) }
        }
        append(ch)
        i += 1
    }
    finish()
    return { words, expansions, notes, operator: null, rest: '' }
}

// ------------------------------------------------------------------ cmd ----

/**
 * Splits a Windows command line as cmd.exe and then the C runtime would:
 * ^ escapes the next character (^ at the end of a line continues it) outside
 * "…", and the program's argument parser splits on spaces, honouring "…",
 * \" and "" inside quotes.
 */
export function splitCmd(input) {
    const notes = []
    let line = ''
    let inQuote = false
    let operator = null
    const n = input.length
    for (let i = 0; i < n; i++) {
        const c = input[i]
        if (c === '"') {
            inQuote = !inQuote
            line += c
            continue
        }
        if (!inQuote && c === '^') {
            let j = i + 1
            if (input[j] === '\r' && input[j + 1] === '\n') j += 2
            else if (input[j] === '\n') j += 1
            else {
                if (j < n) line += input[j]
                i = j
                continue
            }
            // Line continuation: the first character of the next line is literal
            if (j < n) line += input[j]
            i = j
            continue
        }
        if (!inQuote && '&|<>'.includes(c)) {
            const prev = line[line.length - 1]
            const next = input[i + 1]
            if (c === '&' && prev && !isBlank(prev) && next && !isBlank(next) && !'&|<>'.includes(next)) {
                notes.push('unquoted-ampersand')
                line += c
                continue
            }
            operator = /^(\|\||&&|>>|<<|[&|<>])/.exec(input.slice(i))[0]
            break
        }
        line += c
    }

    const words = []
    let word = null
    let quoted = false
    const m = line.length
    for (let i = 0; i < m;) {
        const c = line[i]
        if (!quoted && isBlank(c)) {
            if (word !== null) words.push(word)
            word = null
            i += 1
            continue
        }
        if (c === '\\') {
            let j = i
            while (line[j] === '\\') j += 1
            const count = j - i
            if (line[j] === '"') {
                word = (word ?? '') + '\\'.repeat(Math.floor(count / 2))
                if (count % 2 === 1) {
                    word += '"'
                    i = j + 1
                } else {
                    i = j
                }
                continue
            }
            word = (word ?? '') + '\\'.repeat(count)
            i = j
            continue
        }
        if (c === '"') {
            if (quoted && line[i + 1] === '"') {
                word = (word ?? '') + '"'
                i += 2
                continue
            }
            quoted = !quoted
            word = word ?? ''
            i += 1
            continue
        }
        word = (word ?? '') + c
        i += 1
    }
    if (word !== null) words.push(word)
    return { words, expansions: [], notes, operator, rest: '' }
}

/**
 * Splits a command line into words, detecting Windows cmd syntax (^"…^" and
 * ^ line continuations, as in Chrome's "Copy as cURL (cmd)").
 *
 *   splitShellWords("curl -H 'A: b' https://x") → { words: ['curl', '-H', 'A: b', 'https://x'], dialect: 'posix', … }
 */
export function splitShellWords(input) {
    const text = String(input ?? '')
    let posix = null
    let posixError = null
    try {
        posix = splitPosix(text)
    } catch (error) {
        posixError = error
    }
    // Read as POSIX, cmd's ^"…^" quoting leaves words that start with ^
    const looksLikeCmd = posix
        ? posix.words.some(w => w.startsWith('^'))
        : /\^\r?\n|(^|\s)\^"/.test(text)
    if (looksLikeCmd) {
        try {
            return { ...splitCmd(text), dialect: 'cmd' }
        } catch {
            // fall back to the POSIX result below
        }
    }
    if (posixError) throw posixError
    return { ...posix, dialect: 'posix' }
}

// -------------------------------------------------------------- quoting ----

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/

/**
 * Quotes a value for bash/zsh/sh. Plain words (letters, digits, _@%+=:,./-)
 * are left bare unless `always` is set.
 *
 *   quotePosix("it's")  → 'it'\''s'
 */
export function quotePosix(value, { always = false } = {}) {
    const s = String(value ?? '')
    if (!always && SAFE_WORD.test(s)) return s
    return "'" + s.replace(/'/g, "'\\''") + "'"
}
