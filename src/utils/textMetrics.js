// Unicode-aware text metrics shared by Text Statistics and the Universal
// Inspector. Everything here counts code points or user-perceived characters
// (grapheme clusters), never UTF-16 units, so emoji and accents count once.

const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
const segmenters = {}

function segmenter(granularity) {
    if (!hasSegmenter) return null
    if (!segmenters[granularity]) {
        try {
            segmenters[granularity] = new Intl.Segmenter(undefined, { granularity })
        } catch {
            return null
        }
    }
    return segmenters[granularity]
}

/** Number of Unicode code points (an emoji counts once, unlike `.length`). */
export function countCodePoints(text) {
    if (!text) return 0
    let n = text.length
    for (let i = 0; i < text.length - 1; i++) {
        const c = text.charCodeAt(i)
        if (c >= 0xd800 && c <= 0xdbff) {
            const next = text.charCodeAt(i + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                n--
                i++
            }
        }
    }
    return n
}

/** Size of the text encoded as UTF-8, without allocating the encoded bytes. */
export function utf8ByteLength(text) {
    if (!text) return 0
    let bytes = 0
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (c < 0x80) bytes += 1
        else if (c < 0x800) bytes += 2
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
            bytes += 4
            i++
        } else bytes += 3 // rest of the BMP; a lone surrogate is encoded as U+FFFD
    }
    return bytes
}

/** User-perceived characters (grapheme clusters): "👨‍👩‍👧" and "é" count as one. */
export function countGraphemes(text) {
    if (!text) return 0
    const seg = segmenter('grapheme')
    if (!seg) return countCodePoints(text)
    let n = 0
    for (const _ of seg.segment(text)) n++
    return n
}

/** Lines, counting \n, \r\n and lone \r as line breaks. Empty text has 0 lines. */
export function countLines(text) {
    if (!text) return 0
    return text.split(/\r\n|\r|\n/).length
}

/** Blocks of text separated by blank lines. */
export function countParagraphs(text) {
    if (!text) return 0
    return text
        .replace(/\r\n?/g, '\n')
        .split(/\n[^\S\n]*\n/)
        .filter(block => /\S/.test(block)).length
}

// Joiners between two words with no space around them: "e-mail", "e.g",
// "example.com" (newer ICU versions split words at the period)
const JOINERS = new Set(['-', '‐', '‑', '.'])
const WORD_FALLBACK = /[\p{L}\p{M}\p{N}]+(?:['’.‐‑-][\p{L}\p{M}\p{N}]+)*/gu

/**
 * Words in any script. Uses Intl.Segmenter (dictionary-based for CJK/Thai),
 * keeps hyphenated words and abbreviations ("e-mail", "e.g") together and
 * skips punctuation and emoji.
 */
export function getWords(text) {
    if (!text) return []
    const seg = segmenter('word')
    if (!seg) return text.match(WORD_FALLBACK) || []
    const words = []
    let joinNext = false
    let prevWasWord = false
    for (const { segment, isWordLike } of seg.segment(text)) {
        if (isWordLike) {
            if (joinNext && words.length) words[words.length - 1] += segment
            else words.push(segment)
            joinNext = false
            prevWasWord = true
        } else if (prevWasWord && JOINERS.has(segment)) {
            // Glue the parts back together, but only if a word follows
            joinNext = true
            words[words.length - 1] += segment
            prevWasWord = false
        } else {
            if (joinNext && words.length) words[words.length - 1] = words[words.length - 1].slice(0, -1)
            joinNext = false
            prevWasWord = false
        }
    }
    if (joinNext && words.length) words[words.length - 1] = words[words.length - 1].slice(0, -1)
    return words
}

// Abbreviations that end with a period but rarely end a sentence
const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'e.g', 'i.e', 'cf', 'inc', 'ltd', 'co', 'corp',
    'fig', 'figs', 'approx', 'mt', 'dept', 'gen', 'lt', 'col', 'sgt', 'capt', 'rev', 'hon', 'esp', 'ca', 'al',
])

function endsWithAbbreviation(sentence) {
    const m = sentence.trimEnd().match(/(?:^|[\s(])((?:\p{L}\.)*\p{L}+)\.$/u)
    if (!m) return false
    const word = m[1].toLowerCase()
    // Single initials ("J. K. Rowling") or a known abbreviation
    return ABBREVIATIONS.has(word) || /^\p{Lu}$/u.test(m[1])
}

/** Sentences, skipping abbreviations ("Dr.", "e.g."), decimals and "?!" / "..." runs. */
export function getSentences(text) {
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return []
    const seg = segmenter('sentence')
    const raw = seg
        ? Array.from(seg.segment(text), s => s.segment)
        : text.split(/(?<=[.!?…]["'”’)\]]*)\s+(?=["'“‘([]?[\p{Lu}\p{N}])/u)
    const merged = []
    for (const piece of raw) {
        if (merged.length && endsWithAbbreviation(merged[merged.length - 1])) merged[merged.length - 1] += piece
        else merged.push(piece)
    }
    return merged.filter(s => /[\p{L}\p{N}]/u.test(s))
}

const NAMED_CHARS = {
    '\n': { label: '↵', name: 'Line feed (LF)' },
    '\r': { label: 'CR', name: 'Carriage return (CR)' },
    '\t': { label: '⇥', name: 'Tab' },
    ' ': { label: '␣', name: 'Space' },
    ' ': { label: 'NBSP', name: 'No-break space' },
    '​': { label: 'ZWSP', name: 'Zero-width space' },
    '‌': { label: 'ZWNJ', name: 'Zero-width non-joiner' },
    '‍': { label: 'ZWJ', name: 'Zero-width joiner' },
    '⁠': { label: 'WJ', name: 'Word joiner' },
    '﻿': { label: 'BOM', name: 'Byte order mark' },
}

export function codePointLabel(cp) {
    return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * How to display a single code point: visible characters as themselves,
 * whitespace and invisible/control characters by name.
 */
export function describeChar(ch) {
    const cp = ch.codePointAt(0)
    const code = codePointLabel(cp)
    const named = NAMED_CHARS[ch]
    if (named) return { label: named.label, name: `${named.name} · ${code}`, invisible: true }
    if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u.test(ch) || /\s/.test(ch)) {
        return { label: code, name: code, invisible: true }
    }
    if (/\p{M}/u.test(ch)) return { label: `◌${ch}`, name: `Combining mark · ${code}`, invisible: false }
    return { label: ch, name: code, invisible: false }
}

/** Most frequent code points, with display labels for invisible ones. */
export function charFrequency(text, { limit = 10, skipWhitespace = false } = {}) {
    if (!text) return []
    const counts = new Map()
    let total = 0
    for (const ch of text) {
        if (skipWhitespace && /\s/.test(ch)) continue
        counts.set(ch, (counts.get(ch) || 0) + 1)
        total++
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([char, count]) => ({ char, count, percent: (count / total) * 100, ...describeChar(char) }))
}

const STOP_WORDS = new Set(('a an and are as at be been but by for from had has have he her his i if in into is it its ' +
    'me my no not of on or our she so than that the their them then there these they this to too up us was we were ' +
    'what when which who will with would you your').split(' '))

/** Most frequent words, case-insensitive. `hideCommon` skips English stop words. */
export function wordFrequency(words, { limit = 10, hideCommon = true } = {}) {
    const counts = new Map()
    for (const w of words) {
        const key = w.toLocaleLowerCase()
        if (hideCommon && STOP_WORDS.has(key)) continue
        if (!/\p{L}/u.test(key)) continue // skip bare numbers
        counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([word, count]) => ({ word, count }))
}

function alphabetOf(text) {
    if (/^\d+$/.test(text)) return { name: 'digits', size: 10 }
    if (/^[0-9a-fA-F]+$/.test(text) && /\d/.test(text) && /[a-f]/i.test(text)) return { name: 'hex digits', size: 16 }
    if (/^[A-Za-z0-9+/=_-]+$/.test(text) && [/[a-z]/, /[A-Z]/, /\d/].filter(re => re.test(text)).length >= 2) {
        return { name: 'Base64 characters', size: 64 }
    }
    if (/^[\x20-\x7e\t\r\n]+$/.test(text)) return { name: 'printable ASCII', size: 95 }
    return { name: 'Unicode text', size: 0 }
}

// Expected entropy of a uniformly random string of n symbols from an alphabet
// of k (Miller–Madow approximation; within ~0.1 bit of simulation).
function randomEntropy(n, k) {
    if (n < 2 || k < 2) return 0
    if (n >= k) return Math.log2(k) - (k - 1) / (2 * n * Math.LN2)
    return Math.log2(n) - (n - 1) / (2 * k * Math.LN2)
}

/**
 * Shannon entropy per code point.
 *
 * `ratio` compares it with what random data of the same length and alphabet
 * would score (hex tops out at 4 bits, Base64 at 6, and short strings score
 * less), so a random hex key reads as "high" although 3.7 bits looks low in
 * absolute terms.
 */
export function shannonEntropy(text) {
    const empty = { bits: 0, maxBits: 0, ratio: 0, level: 'low', total: 0, distinct: 0, alphabet: null }
    if (!text) return empty
    const counts = new Map()
    let total = 0
    for (const ch of text) {
        counts.set(ch, (counts.get(ch) || 0) + 1)
        total++
    }
    let bits = 0
    for (const count of counts.values()) {
        const p = count / total
        bits -= p * Math.log2(p)
    }
    bits = Math.abs(bits) // avoid -0
    const alphabet = alphabetOf(text)
    const alphabetSize = alphabet.size || Math.max(95, counts.size)
    const maxBits = randomEntropy(total, alphabetSize)
    const ratio = maxBits > 0 ? Math.min(1, bits / maxBits) : 0
    let level = ratio >= 0.9 ? 'high' : ratio >= 0.6 ? 'medium' : 'low'
    // Too short to call it random, or prose (keys and ciphertext have no spaces)
    if (level === 'high' && (total < 16 || /\s/.test(text))) level = 'medium'
    return { bits, maxBits, ratio, level, total, distinct: counts.size, alphabet: { ...alphabet, size: alphabetSize } }
}

/** "45 sec", "3 min 20 sec", "1 h 5 min". */
export function formatDuration(seconds) {
    const s = Math.round(seconds)
    if (s < 1) return '0 sec'
    if (s < 60) return `${s} sec`
    const minutes = Math.floor(s / 60)
    const rest = s % 60
    if (minutes < 10) return rest ? `${minutes} min ${rest} sec` : `${minutes} min`
    if (minutes < 60) return `${Math.round(s / 60)} min`
    const hours = Math.floor(minutes / 60)
    const mins = Math.round((s - hours * 3600) / 60)
    return mins ? `${hours} h ${mins} min` : `${hours} h`
}

export const READING_WPM = 238
export const SPEAKING_WPM = 140

/** Every metric Text Statistics shows. */
export function analyzeText(text, { topLimit = 10, hideCommonWords = true } = {}) {
    const words = getWords(text)
    const sentences = getSentences(text)
    const graphemes = countGraphemes(text)
    const whitespace = (text.match(/\s/g) || []).length
    // Most words are ASCII, where length is the character count; segment the rest
    const lengths = words.map(w => (/^[\x20-\x7e]*$/.test(w) ? w.length : countGraphemes(w)))
    const longestIndex = lengths.reduce((best, len, i) => (len > lengths[best] ? i : best), 0)
    const uniqueWords = new Set(words.map(w => w.toLocaleLowerCase())).size
    return {
        characters: graphemes,
        charactersNoSpaces: graphemes - whitespace,
        codePoints: countCodePoints(text),
        utf16Units: text.length,
        bytes: utf8ByteLength(text),
        words: words.length,
        uniqueWords,
        sentences: sentences.length,
        paragraphs: countParagraphs(text),
        lines: countLines(text),
        whitespace,
        avgWordLength: words.length ? lengths.reduce((a, b) => a + b, 0) / words.length : 0,
        avgSentenceWords: sentences.length ? words.length / sentences.length : 0,
        longestWord: words.length ? words[longestIndex] : '',
        readingSeconds: (words.length / READING_WPM) * 60,
        speakingSeconds: (words.length / SPEAKING_WPM) * 60,
        topWords: wordFrequency(words, { limit: topLimit, hideCommon: hideCommonWords }),
        topChars: charFrequency(text, { limit: topLimit, skipWhitespace: true }),
    }
}
