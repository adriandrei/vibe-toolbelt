// Turns hex text back into bytes: hex dumps from `xxd` and `hexdump -C`, and
// plain hex bytes written with separators ("48 65 6c", "48:65:6c",
// "0x48, 0x65", or one unbroken run like "48656c").
//
// Returns { bytes, format } or null when the text isn't hex.

const XXD_LINE = /^([0-9a-f]{4,16}):((?:\s[0-9a-f]{2,4})+)(?:\s{2,}.*)?$/i
const HEXDUMP_C_LINE = /^([0-9a-f]{4,16})((?:\s{1,2}[0-9a-f]{2}){1,16})(?:\s+\|.*\|)?\s*$/i
const OFFSET_ONLY = /^[0-9a-f]{4,16}$/i

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    return bytes
}

function parseDumpLines(lines, pattern) {
    let hex = ''
    let previousOffset = -1
    for (const [index, line] of lines.entries()) {
        const match = pattern.exec(line)
        if (!match) {
            // hexdump -C ends with a line holding only the total length
            if (index === lines.length - 1 && OFFSET_ONLY.test(line)) break
            return null
        }
        const offset = parseInt(match[1], 16)
        if (offset <= previousOffset || offset !== hex.length / 2) return null
        previousOffset = offset
        const groups = match[2].trim().split(/\s+/)
        if (groups.some(g => g.length % 2 !== 0)) return null
        hex += groups.join('')
    }
    return hex.length ? hexToBytes(hex) : null
}

export function parseHexText(text) {
    if (typeof text !== 'string') return null
    const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim())
    if (!lines.length) return null

    if (lines.every((l, i) => XXD_LINE.test(l) || (i === lines.length - 1 && OFFSET_ONLY.test(l)))) {
        const bytes = parseDumpLines(lines, XXD_LINE)
        if (bytes) return { bytes, format: 'xxd' }
    }
    if (lines.every((l, i) => HEXDUMP_C_LINE.test(l) || (i === lines.length - 1 && OFFSET_ONLY.test(l)))) {
        const bytes = parseDumpLines(lines, HEXDUMP_C_LINE)
        if (bytes) return { bytes, format: 'hexdump' }
    }

    // Plain hex bytes: pairs separated by spaces, colons, commas or dashes,
    // optionally 0x-prefixed, or one unbroken even-length run
    const trimmed = text.trim()
    const tokens = trimmed.split(/[\s,:;-]+/).filter(Boolean).map(t => t.replace(/^0x/i, ''))
    if (tokens.length > 1 && tokens.every(t => /^[0-9a-f]{2}$/i.test(t))) {
        return { bytes: hexToBytes(tokens.join('')), format: 'bytes' }
    }
    if (tokens.length === 1 && /^(0x)?[0-9a-f]+$/i.test(trimmed) && tokens[0].length % 2 === 0 && tokens[0].length >= 2) {
        return { bytes: hexToBytes(tokens[0]), format: 'run' }
    }
    return null
}
