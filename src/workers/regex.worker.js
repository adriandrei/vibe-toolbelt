// Regex matching and replacing for the Regex Tester, off the main thread.
//
// A pattern with catastrophic backtracking can run for minutes inside a single
// exec() call, which nothing can interrupt. Running it here keeps the page
// responsive, and the page terminates this worker when a job overruns.
//
// In:  { id, pattern, flags, text, mode: 'match' | 'replace', replacement, maxMatches }
// Out: { id, ok: true, matches, total, truncated, countStopped, groupNames, replaced?, segments?, elapsed }
//      { id, ok: false, error }

const LOOP_BUDGET_MS = 250 // stop counting matches after this long and report a partial count
const MAX_VALUE = 2000 // characters of a match / group value sent back for display

function supportsFlag(flag) {
    try {
        new RegExp('', flag)
        return true
    } catch {
        return false
    }
}

const HAS_INDICES = supportsFlag('d')

// After an empty match, move on by one character, or by a whole code point in
// Unicode mode: stepping into the middle of a surrogate pair makes V8 match
// the same empty string again forever.
function advance(text, index, unicode) {
    if (!unicode || index + 1 >= text.length) return index + 1
    const high = text.charCodeAt(index)
    const low = text.charCodeAt(index + 1)
    return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? index + 2 : index + 1
}

// Names of the capture groups in order (null for unnamed ones).
function captureGroupNames(source, unicodeSets) {
    const names = []
    let classDepth = 0
    for (let i = 0; i < source.length; i++) {
        const c = source[i]
        if (c === '\\') {
            i++
            continue
        }
        if (classDepth > 0) {
            if (c === ']') classDepth--
            else if (c === '[' && unicodeSets) classDepth++
            continue
        }
        if (c === '[') {
            classDepth = 1
            continue
        }
        if (c !== '(') continue
        if (source[i + 1] !== '?') {
            names.push(null)
        } else if (source[i + 2] === '<' && source[i + 3] !== '=' && source[i + 3] !== '!') {
            const end = source.indexOf('>', i + 3)
            names.push(end === -1 ? null : source.slice(i + 3, end))
        }
    }
    return names
}

const clip = (value) => (typeof value === 'string' && value.length > MAX_VALUE ? value.slice(0, MAX_VALUE) : value)

function serialize(m, names) {
    const groups = []
    for (let i = 1; i < m.length; i++) {
        const span = m.indices?.[i]
        groups.push({
            n: i,
            name: names[i - 1] ?? null,
            value: m[i] === undefined ? null : clip(m[i]),
            length: m[i] === undefined ? 0 : m[i].length,
            start: span ? span[0] : null,
            end: span ? span[1] : null,
        })
    }
    return { index: m.index, end: m.index + m[0].length, value: clip(m[0]), length: m[0].length, groups }
}

// The replacement text for one match, following String.prototype.replace's
// $-patterns ($$, $&, $`, $', $1..$99, $<name>).
function expandReplacement(template, m, text) {
    const captures = m.length - 1
    const position = m.index
    const matched = m[0]
    let out = ''
    for (let i = 0; i < template.length; i++) {
        const c = template[i]
        if (c !== '$' || i + 1 >= template.length) {
            out += c
            continue
        }
        const next = template[i + 1]
        if (next === '$') {
            out += '$'
            i++
        } else if (next === '&') {
            out += matched
            i++
        } else if (next === '`') {
            out += text.slice(0, position)
            i++
        } else if (next === "'") {
            out += text.slice(position + matched.length)
            i++
        } else if (next >= '0' && next <= '9') {
            const second = template[i + 2]
            if (second >= '0' && second <= '9') {
                const two = Number(next + second)
                if (two >= 1 && two <= captures) {
                    out += m[two] ?? ''
                    i += 2
                    continue
                }
            }
            const one = Number(next)
            if (one >= 1 && one <= captures) {
                out += m[one] ?? ''
                i++
            } else {
                out += '$'
            }
        } else if (next === '<' && m.groups) {
            const close = template.indexOf('>', i + 2)
            if (close === -1) {
                out += '$'
            } else {
                out += m.groups[template.slice(i + 2, close)] ?? ''
                i = close
            }
        } else {
            out += '$'
        }
    }
    return out
}

function run({ pattern, flags, text, mode, replacement = '', maxMatches = 1000 }) {
    const started = performance.now()
    new RegExp(pattern, flags) // report syntax errors with the user's own flags
    // The d flag only adds group positions; it never changes what matches
    const re = new RegExp(pattern, HAS_INDICES && !flags.includes('d') ? `${flags}d` : flags)
    const unicode = re.unicode || re.unicodeSets === true
    const names = captureGroupNames(pattern, re.unicodeSets === true)
    const raw = [] // RegExp match objects, for replacement segments
    const matches = []
    let total = 0
    let truncated = false
    let countStopped = false

    if (re.global) {
        let m
        while ((m = re.exec(text)) !== null) {
            total++
            if (matches.length < maxMatches) {
                matches.push(serialize(m, names))
                if (mode === 'replace') raw.push(m)
            } else {
                truncated = true
            }
            if (m[0] === '') re.lastIndex = advance(text, re.lastIndex, unicode)
            if ((total & 1023) === 0 && performance.now() - started > LOOP_BUDGET_MS) {
                countStopped = true
                break
            }
        }
    } else {
        re.lastIndex = 0
        const m = re.exec(text)
        if (m) {
            total = 1
            matches.push(serialize(m, names))
            raw.push(m)
        }
    }

    const result = { matches, total, truncated, countStopped, groupNames: names }

    if (mode === 'replace') {
        re.lastIndex = 0
        const replaced = text.replace(re, replacement)
        result.replaced = replaced
        // Highlight what was inserted, for as many matches as we have details for
        if (raw.length && !countStopped) {
            const segments = []
            let pos = 0
            let offset = 0
            for (const m of raw) {
                const value = expandReplacement(replacement, m, text)
                if (m.index > pos) segments.push({ text: text.slice(pos, m.index) })
                segments.push({ text: value, replaced: true, empty: value === '' })
                offset += value.length - m[0].length
                pos = m.index + m[0].length
            }
            segments.push({ text: replaced.slice(pos + offset) })
            // Trust the native result: only keep the highlights if they rebuild it exactly
            if (segments.map(s => s.text).join('') === replaced) result.segments = segments
        }
    }

    result.elapsed = performance.now() - started
    return result
}

self.onmessage = (event) => {
    const { id } = event.data
    try {
        self.postMessage({ id, ok: true, ...run(event.data) })
    } catch (err) {
        self.postMessage({ id, ok: false, error: err?.message || String(err) })
    }
}
