// Case conversion with Unicode-aware word splitting.
//
// Words are found by case and character class rather than ASCII ranges:
//   XMLHttpRequest      -> XML · Http · Request
//   getHTTPResponseCode -> get · HTTP · Response · Code
//   user_id2Name        -> user · id2 · Name
//   ärgerÜber           -> ärger · Über
// Punctuation and symbols separate words and are dropped from identifiers.
// Identifier styles convert each line on its own, so a list of names stays a list.

const U = '\\p{Lu}\\p{Lt}'
const L = '\\p{Ll}'
const M = '\\p{M}'
const N = '\\p{N}'

const WORD_RE = new RegExp([
    `[${U}][${U}${M}]*(?=[${U}][${L}${M}])`, // acronym before a capitalised word: "XML" in XMLHttp
    `[${U}]?[${L}${M}]+[${N}]*`, // word, Word, word2
    `[${U}][${U}${M}]*[${N}]*`, // ACRONYM, HTTP2
    `[\\p{Lo}\\p{Lm}${M}]+[${N}]*`, // letters without case (CJK, Arabic, Hebrew…)
    `[${N}]+[${L}${M}]*`, // 42, 2nd
].join('|'), 'gu')

/** Splits text into words for identifier-style cases. */
export function splitWords(text) {
    if (!text) return []
    // "don't" -> "dont": an apostrophe inside a word isn't a word boundary
    const cleaned = text.normalize('NFC').replace(/(\p{L})['’](?=\p{L})/gu, '$1')
    return cleaned.match(WORD_RE) || []
}

const lower = (w) => w.toLocaleLowerCase()
const upper = (w) => w.toLocaleUpperCase()
const capitalize = (w) => {
    const [first = '', ...rest] = Array.from(w)
    return first.toLocaleUpperCase() + rest.join('').toLocaleLowerCase()
}

// Applies an identifier conversion to every line, keeping the line breaks.
function perLine(text, convert) {
    return text
        .split(/(\r\n|\r|\n)/)
        .map((part, i) => (i % 2 ? part : convert(splitWords(part))))
        .join('')
}

const hasLowercase = (text) => /\p{Ll}/u.test(text)
const isMixedCase = (word) => /\p{Ll}/u.test(word) && /\p{Lu}/u.test(Array.from(word).slice(1).join(''))
const isAllCaps = (word) => /\p{Lu}/u.test(word) && !/\p{Ll}/u.test(word)

/**
 * Title Case: capitalises each word but keeps words that are already
 * deliberately cased ("iPhone", "NASA", "McDonald"). If the whole text is in
 * capitals it's treated as shouting and every word is recased.
 */
export function toTitleCase(text) {
    const shouting = !hasLowercase(text)
    return text.replace(/[\p{L}\p{M}\p{N}'’]+/gu, (word) => {
        if (!shouting && (isMixedCase(word) || (isAllCaps(word) && Array.from(word).length > 1))) return word
        return capitalize(word)
    })
}

// Words that end with a period without ending the sentence ("e.g. coffee")
const ABBREVIATION_END = /(?:^|[^\p{L}])(?:e\.g|i\.e|cf|vs|mr|mrs|ms|dr|prof|sr|jr|st|approx|fig)$/iu
const SENTENCE_END = /[.!?…]["'”’)\]]*\s/u

/**
 * Sentence case: lower-case, then capitalise the first letter of the text,
 * of each line and after . ! ? or …. Acronyms and mixed-case words ("NASA",
 * "iPhone") are kept unless the whole text is in capitals; "i" becomes "I".
 */
export function toSentenceCase(text) {
    const shouting = !hasLowercase(text)
    const parts = text.split(/([\p{L}\p{M}\p{N}'’]+)/u)
    let atStart = true
    let tail = '' // the last few characters, for the abbreviation check
    return parts.map((part, i) => {
        if (i % 2 === 0) {
            // Separator: does it end a sentence?
            if (part.includes('\n') || (SENTENCE_END.test(part) && !ABBREVIATION_END.test(tail))) atStart = true
            tail = (tail + part).slice(-32)
            return part
        }
        const keep = !shouting && (isMixedCase(part) || (isAllCaps(part) && Array.from(part).length > 1))
        let word = keep ? part : lower(part)
        if (!keep && (word === 'i' || /^i['’]/.test(word))) word = 'I' + word.slice(1)
        if (atStart && !keep) {
            const [first = '', ...rest] = Array.from(word)
            word = first.toLocaleUpperCase() + rest.join('')
        }
        atStart = false
        tail = (tail + part).slice(-32)
        return word
    }).join('')
}

/** aLtErNaTiNg: alternates across letters only, so spaces and digits don't break the rhythm. */
export function toAlternatingCase(text) {
    let i = 0
    return Array.from(text, (ch) => {
        if (!/\p{L}/u.test(ch)) return ch
        return i++ % 2 === 0 ? lower(ch) : upper(ch)
    }).join('')
}

export function toInverseCase(text) {
    return Array.from(text, (ch) => {
        const up = upper(ch)
        return ch === up ? lower(ch) : up
    }).join('')
}

export const CASES = [
    { id: 'lower', label: 'lowercase', convert: (t) => lower(t) },
    { id: 'upper', label: 'UPPERCASE', convert: (t) => upper(t) },
    { id: 'title', label: 'Title Case', convert: toTitleCase },
    { id: 'sentence', label: 'Sentence case', convert: toSentenceCase },
    { id: 'camel', label: 'camelCase', identifier: true, convert: (t) => perLine(t, (w) => w.map((x, i) => (i === 0 ? lower(x) : capitalize(x))).join('')) },
    { id: 'pascal', label: 'PascalCase', identifier: true, convert: (t) => perLine(t, (w) => w.map(capitalize).join('')) },
    { id: 'snake', label: 'snake_case', identifier: true, convert: (t) => perLine(t, (w) => w.map(lower).join('_')) },
    { id: 'constant', label: 'CONSTANT_CASE', identifier: true, convert: (t) => perLine(t, (w) => w.map(upper).join('_')) },
    { id: 'kebab', label: 'kebab-case', identifier: true, convert: (t) => perLine(t, (w) => w.map(lower).join('-')) },
    { id: 'train', label: 'Train-Case', identifier: true, convert: (t) => perLine(t, (w) => w.map(capitalize).join('-')) },
    { id: 'dot', label: 'dot.case', identifier: true, convert: (t) => perLine(t, (w) => w.map(lower).join('.')) },
    { id: 'path', label: 'path/case', identifier: true, convert: (t) => perLine(t, (w) => w.map(lower).join('/')) },
    { id: 'alternating', label: 'aLtErNaTiNg cAsE', convert: toAlternatingCase },
    { id: 'inverse', label: 'iNVERSE cASE', convert: toInverseCase },
]
