// Random passwords, EFF diceware passphrases and PINs for the Password
// Generator, and the entropy of each setting.
//
// All randomness comes from crypto.getRandomValues. Indexes are drawn with
// rejection sampling, so every character, word and position is equally likely
// (no modulo bias), and the "one from each set" characters are mixed in with
// an unbiased Fisher–Yates shuffle. Nothing here stores what it generates.

export const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
export const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const DIGITS = '0123456789'
// Printable ASCII punctuation minus " ' \ and `, which often break shells,
// JSON, YAML and .env files.
export const DEFAULT_SYMBOLS = '!#$%&()*+,-./:;<=>?@[]^_{|}~'
// Characters that are easy to confuse in many fonts
export const LOOKALIKES = 'Il1|O0o'
// Size of the EFF long word list (6^5 = 7,776 words, five dice rolls each)
export const EFF_LIST_SIZE = 7776

export const MODES = ['password', 'passphrase', 'pin']
export const SEPARATORS = { space: ' ', hyphen: '-', period: '.', underscore: '_', none: '' }

export const LIMITS = {
    length: { min: 8, max: 128 },
    count: { min: 1, max: 50 },
    words: { min: 3, max: 12 },
    pinLength: { min: 4, max: 12 },
    symbolSet: { max: 200 },
}

export const DEFAULT_OPTIONS = Object.freeze({
    mode: 'password',
    count: 1,
    // password
    length: 20,
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
    symbolSet: DEFAULT_SYMBOLS,
    avoidLookalikes: false,
    requireEach: true,
    // passphrase (the symbol set above is shared)
    words: 6,
    separator: 'hyphen',
    capitalize: false,
    addNumber: false,
    addSymbol: false,
    // PIN
    pinLength: 6,
})

/** Invalid settings; the message can be shown to the user as-is. */
export class GeneratorError extends Error {
    constructor(message) {
        super(message)
        this.name = 'GeneratorError'
    }
}

// ---- randomness ----
const RANGE = 2 ** 32

/**
 * A source of uniformly random unsigned 32-bit integers backed by
 * crypto.getRandomValues, read in batches. Create one per generation so the
 * buffer is dropped with it.
 * @returns {() => number}
 */
export function cryptoRandom(batch = 64) {
    const buffer = new Uint32Array(batch)
    let next = batch
    return () => {
        if (next === batch) {
            crypto.getRandomValues(buffer)
            next = 0
        }
        return buffer[next++]
    }
}

/** Accepted 32-bit values are those below this limit: the largest multiple of `max` ≤ 2^32. */
export function rejectionLimit(max) {
    return RANGE - (RANGE % max)
}

/**
 * Uniform integer in [0, max) without modulo bias: values at or above the
 * largest multiple of `max` that fits in 32 bits are discarded and redrawn,
 * so each result has exactly the same number of accepted 32-bit values.
 * @param {number} max  1 … 2^32
 * @param {() => number} random  source of uniform 32-bit unsigned integers
 */
export function randomIndex(max, random) {
    if (!Number.isInteger(max) || max < 1 || max > RANGE) throw new RangeError('max must be an integer from 1 to 2^32')
    if (max === 1) return 0
    const limit = rejectionLimit(max)
    for (;;) {
        const value = random()
        if (!Number.isInteger(value) || value < 0 || value >= RANGE) throw new RangeError('The random source must return 32-bit unsigned integers')
        if (value < limit) return value % max
    }
}

/**
 * Unbiased Fisher–Yates (Durstenfeld) shuffle. Returns a new array; each of
 * the n! orders is equally likely because every swap index is drawn uniformly
 * from the not-yet-placed positions.
 */
export function shuffle(items, random) {
    const out = Array.from(items)
    for (let i = out.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1, random)
        const tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
    }
    return out
}

// ---- character sets ----
const isAsciiPunctuation = (ch) => /^[!-/:-@[-`{-~]$/.test(ch)

/**
 * Reads the editable symbol set: printable ASCII punctuation only, each
 * character once (repeats would make it more likely than the others).
 * @returns {{ chars: string[], ignored: string[], repeated: boolean }}
 */
export function parseSymbolSet(text) {
    const chars = []
    const ignored = []
    let repeated = false
    for (const ch of Array.from(String(text ?? ''))) {
        if (!isAsciiPunctuation(ch)) {
            if (!ignored.includes(ch)) ignored.push(ch)
        } else if (chars.includes(ch)) {
            repeated = true
        } else {
            chars.push(ch)
        }
    }
    return { chars, ignored, repeated }
}

const SET_DEFS = [
    { id: 'lower', label: 'Lowercase', chars: LOWERCASE },
    { id: 'upper', label: 'Uppercase', chars: UPPERCASE },
    { id: 'digits', label: 'Digits', chars: DIGITS },
]

/**
 * The enabled character sets after look-alikes are removed, and their union.
 * The sets never overlap, so the pool has no duplicates.
 * @returns {{ sets: { id: string, label: string, chars: string[] }[], pool: string[], error?: string }}
 */
export function characterSets(options) {
    const avoid = (chars) => (options.avoidLookalikes ? chars.filter(ch => !LOOKALIKES.includes(ch)) : chars)
    const sets = SET_DEFS.filter(def => options[def.id]).map(def => ({ id: def.id, label: def.label, chars: avoid(Array.from(def.chars)) }))
    let error
    if (options.symbols) {
        const parsed = parseSymbolSet(options.symbolSet)
        const chars = avoid(parsed.chars)
        if (!parsed.chars.length) error = 'Add at least one symbol (ASCII punctuation such as ! # % *), or turn symbols off.'
        else if (!chars.length) error = 'All of your symbols are look-alikes. Add other symbols, or allow look-alike characters.'
        else sets.push({ id: 'symbols', label: 'Symbols', chars })
    }
    if (!options.lower && !options.upper && !options.digits && !options.symbols) {
        error = 'Choose at least one character set: lowercase, uppercase, digits or symbols.'
    }
    if (error) return { sets: [], pool: [], error }
    return { sets, pool: sets.flatMap(set => set.chars) }
}

function checkInt(value, { min, max }, what) {
    if (!Number.isInteger(value) || value < min || value > max) throw new GeneratorError(`${what} must be a whole number from ${min} to ${max}.`)
}

/**
 * A random password. With `requireEach`, one character is drawn from every
 * enabled set, the rest from the whole pool, and the result is shuffled.
 */
export function generatePassword(options, random = cryptoRandom()) {
    checkInt(options.length, LIMITS.length, 'Length')
    const { sets, pool, error } = characterSets(options)
    if (error) throw new GeneratorError(error)
    const chars = []
    if (options.requireEach) {
        if (sets.length > options.length) throw new GeneratorError(`A ${options.length}-character password can’t include all ${sets.length} character sets.`)
        for (const set of sets) chars.push(set.chars[randomIndex(set.chars.length, random)])
    }
    while (chars.length < options.length) chars.push(pool[randomIndex(pool.length, random)])
    return (options.requireEach ? shuffle(chars, random) : chars).join('')
}

const capitalizeWord = (word) => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * A diceware passphrase: `words` words drawn uniformly (with repetition) from
 * `wordList`, joined by the separator. A digit and/or a symbol can be added
 * to the end of a randomly chosen word.
 */
export function generatePassphrase(options, wordList, random = cryptoRandom()) {
    checkInt(options.words, LIMITS.words, 'The number of words')
    if (!Array.isArray(wordList) || wordList.length < 2) throw new GeneratorError('The word list isn’t loaded.')
    if (!Object.hasOwn(SEPARATORS, options.separator)) throw new GeneratorError('Choose a separator.')
    const symbols = options.addSymbol ? parseSymbolSet(options.symbolSet).chars : []
    if (options.addSymbol && !symbols.length) throw new GeneratorError('Add at least one symbol (ASCII punctuation such as ! # % *) to the symbol set, or turn off “Add a symbol”.')

    const n = options.words
    const words = []
    for (let i = 0; i < n; i++) {
        const word = wordList[randomIndex(wordList.length, random)]
        words.push(options.capitalize ? capitalizeWord(word) : word)
    }
    if (options.addNumber) words[randomIndex(n, random)] += DIGITS[randomIndex(10, random)]
    if (options.addSymbol) words[randomIndex(n, random)] += symbols[randomIndex(symbols.length, random)]
    return words.join(SEPARATORS[options.separator])
}

/** A uniformly random PIN of `length` digits (leading zeros included). */
export function generatePin(length, random = cryptoRandom()) {
    checkInt(length, LIMITS.pinLength, 'The number of digits')
    let pin = ''
    for (let i = 0; i < length; i++) pin += DIGITS[randomIndex(10, random)]
    return pin
}

/**
 * `options.count` values for the current mode. Passphrases need the word
 * list. Throws GeneratorError for impossible settings.
 */
export function generateValues(options, { wordList, random = cryptoRandom() } = {}) {
    checkInt(options.count, LIMITS.count, 'How many')
    const one = options.mode === 'passphrase'
        ? () => generatePassphrase(options, wordList, random)
        : options.mode === 'pin'
            ? () => generatePin(options.pinLength, random)
            : () => generatePassword(options, random)
    return Array.from({ length: options.count }, one)
}

// ---- entropy ----
const log2 = Math.log2

/**
 * Entropy of one value with these settings, in bits:
 * - password: length × log2(pool size). With "at least one from each set"
 *   (and more than one set) it's a slight upper bound (`upperBound: true`).
 * - passphrase: words × log2(list size), plus log2(10) + log2(words) for a
 *   digit after a random word and log2(symbols) + log2(words) for a symbol.
 *   The EFF long list is prefix-free, so the words can't run together
 *   ambiguously even without a separator: the figure is exact.
 * - PIN: digits × log2(10).
 * @returns {{ bits: number, formula: string, upperBound: boolean, error?: string }}
 */
export function entropyOf(options, listSize = EFF_LIST_SIZE) {
    if (options.mode === 'pin') {
        const n = options.pinLength
        const bits = n * log2(10)
        return { bits, upperBound: false, formula: `${n} digits × log₂ 10 = ${formatBits(bits)} bits` }
    }
    if (options.mode === 'passphrase') {
        const n = options.words
        let bits = n * log2(listSize)
        const terms = [`${n} words × log₂ ${listSize.toLocaleString('en-US')}`]
        if (options.addNumber) {
            bits += log2(10) + log2(n)
            terms.push(`digit (log₂ 10 + log₂ ${n} places)`)
        }
        if (options.addSymbol) {
            const count = parseSymbolSet(options.symbolSet).chars.length
            if (!count) return { bits: 0, upperBound: false, formula: '', error: 'No symbols to add.' }
            bits += log2(count) + log2(n)
            terms.push(`symbol (log₂ ${count} + log₂ ${n} places)`)
        }
        return { bits, upperBound: false, formula: `${terms.join(' + ')} = ${formatBits(bits)} bits` }
    }
    const { sets, pool, error } = characterSets(options)
    if (error) return { bits: 0, upperBound: false, formula: '', error }
    const bits = options.length * log2(pool.length)
    return {
        bits,
        upperBound: !!options.requireEach && sets.length > 1,
        formula: `${options.length} characters × log₂ ${pool.length} = ${formatBits(bits)} bits`,
    }
}

export function formatBits(bits) {
    return (Math.round(bits * 10) / 10).toFixed(1)
}

// Labels for the 5-step meter. Each extra bit doubles the guesses an attacker
// needs: under 40 bits falls quickly to offline guessing, 75+ resists even
// fast-hash cracking rigs for millennia, 100+ is beyond any brute force.
export const STRENGTH_LEVELS = [
    { min: 0, label: 'Very weak' },
    { min: 40, label: 'Weak' },
    { min: 60, label: 'Fair' },
    { min: 75, label: 'Strong' },
    { min: 100, label: 'Very strong' },
]

/** { level: 0–4, label } for an entropy in bits. */
export function strengthOf(bits) {
    let level = 0
    STRENGTH_LEVELS.forEach((step, i) => {
        if (bits >= step.min) level = i
    })
    return { level, label: STRENGTH_LEVELS[level].label }
}

// ---- stored options ----
function readInt(value, { min, max }, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, Math.round(value)))
}

const readBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)

/**
 * Validates options read from localStorage (or anywhere else): unknown or
 * malformed fields fall back to the defaults, numbers are rounded and
 * clamped, and only known keys are kept.
 */
export function normalizeOptions(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const d = DEFAULT_OPTIONS
    return {
        mode: MODES.includes(src.mode) ? src.mode : d.mode,
        count: readInt(src.count, LIMITS.count, d.count),
        length: readInt(src.length, LIMITS.length, d.length),
        lower: readBool(src.lower, d.lower),
        upper: readBool(src.upper, d.upper),
        digits: readBool(src.digits, d.digits),
        symbols: readBool(src.symbols, d.symbols),
        symbolSet: typeof src.symbolSet === 'string' ? src.symbolSet.slice(0, LIMITS.symbolSet.max) : d.symbolSet,
        avoidLookalikes: readBool(src.avoidLookalikes, d.avoidLookalikes),
        requireEach: readBool(src.requireEach, d.requireEach),
        words: readInt(src.words, LIMITS.words, d.words),
        separator: typeof src.separator === 'string' && Object.hasOwn(SEPARATORS, src.separator) ? src.separator : d.separator,
        capitalize: readBool(src.capitalize, d.capitalize),
        addNumber: readBool(src.addNumber, d.addNumber),
        addSymbol: readBool(src.addSymbol, d.addSymbol),
        pinLength: readInt(src.pinLength, LIMITS.pinLength, d.pinLength),
    }
}
