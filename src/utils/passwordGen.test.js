import { describe, it, expect } from 'vitest'
import { long as EFF_LONG } from '@wordlist/english-eff/long'
import {
    DEFAULT_OPTIONS,
    DEFAULT_SYMBOLS,
    DIGITS,
    EFF_LIST_SIZE,
    GeneratorError,
    LOOKALIKES,
    LOWERCASE,
    UPPERCASE,
    characterSets,
    cryptoRandom,
    entropyOf,
    generatePassphrase,
    generatePassword,
    generatePin,
    generateValues,
    normalizeOptions,
    parseSymbolSet,
    randomIndex,
    rejectionLimit,
    shuffle,
    strengthOf,
} from './passwordGen.js'

const RANGE = 2 ** 32

// Returns the given 32-bit values in order and fails the test if more are read.
function sequence(values) {
    let i = 0
    const next = () => {
        if (i >= values.length) throw new Error(`The test source ran out after ${values.length} values`)
        return values[i++]
    }
    next.used = () => i
    return next
}

// Deterministic 32-bit stream (mulberry32) for repeatable tests.
function seeded(seed) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return (t ^ (t >>> 14)) >>> 0
    }
}

const opts = (patch = {}) => ({ ...DEFAULT_OPTIONS, ...patch })
const PUNCTUATION = /^[!-/:-@[-`{-~]$/

describe('randomIndex (unbiased)', () => {
    it('accepts only values below the largest multiple of max, so every result has the same number of preimages', () => {
        for (const max of [2, 3, 5, 7, 10, 26, 62, 90, 1000, 7776, 2 ** 31 + 1, 2 ** 32 - 1, 2 ** 32]) {
            const limit = rejectionLimit(max)
            expect(limit % max).toBe(0)
            expect(limit).toBeLessThanOrEqual(RANGE)
            expect(RANGE - limit).toBeLessThan(max)
        }
    })

    it('redraws when the value falls in the biased tail', () => {
        // 2^32 mod 3 = 1, so 2^32 - 1 is the single rejected value for max = 3
        expect(rejectionLimit(3)).toBe(RANGE - 1)
        const source = sequence([RANGE - 1, RANGE - 1, RANGE - 2])
        expect(randomIndex(3, source)).toBe((RANGE - 2) % 3)
        expect(source.used()).toBe(3)
    })

    it('uses the first value below the limit, reduced modulo max', () => {
        const limit = rejectionLimit(10) // 4294967290
        expect(randomIndex(10, sequence([limit - 1]))).toBe(9)
        expect(randomIndex(10, sequence([limit, limit + 5, 123]))).toBe(3)
    })

    it('never rejects for powers of two', () => {
        const source = sequence([RANGE - 1])
        expect(randomIndex(8, source)).toBe(7)
        expect(source.used()).toBe(1)
    })

    it('returns 0 for max = 1 without consuming randomness', () => {
        const source = sequence([])
        expect(randomIndex(1, source)).toBe(0)
    })

    it('rejects invalid ranges and broken sources', () => {
        for (const bad of [0, -1, 1.5, NaN, RANGE + 1, '3']) {
            expect(() => randomIndex(bad, sequence([1]))).toThrow(RangeError)
        }
        expect(() => randomIndex(3, sequence([-1]))).toThrow(RangeError)
        expect(() => randomIndex(3, sequence([RANGE]))).toThrow(RangeError)
        expect(() => randomIndex(3, sequence([0.5]))).toThrow(RangeError)
    })

    it('is uniform with the real crypto source', () => {
        const random = cryptoRandom()
        const counts = new Array(7).fill(0)
        for (let i = 0; i < 70000; i++) counts[randomIndex(7, random)]++
        // expected 10,000 each, σ ≈ 93: ±600 is a 6.5σ band
        for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(600)
    })
})

describe('shuffle (Fisher–Yates)', () => {
    it('maps every sequence of swap choices to a different order, so all n! orders are equally likely', () => {
        const seen = new Map()
        // i = 3 draws from 4 positions, i = 2 from 3, i = 1 from 2: 24 choice sequences
        for (let a = 0; a < 4; a++) {
            for (let b = 0; b < 3; b++) {
                for (let c = 0; c < 2; c++) {
                    const order = shuffle(['A', 'B', 'C', 'D'], sequence([a, b, c])).join('')
                    seen.set(order, (seen.get(order) || 0) + 1)
                }
            }
        }
        expect(seen.size).toBe(24)
        expect([...seen.values()].every(n => n === 1)).toBe(true)
    })

    it('returns a new array with the same items and leaves the input alone', () => {
        const input = [1, 2, 3, 4, 5, 6]
        const out = shuffle(input, seeded(7))
        expect(input).toEqual([1, 2, 3, 4, 5, 6])
        expect([...out].sort()).toEqual(input)
        expect(shuffle([], seeded(1))).toEqual([])
        expect(shuffle(['x'], sequence([]))).toEqual(['x'])
    })

    it('is uniform with the real crypto source', () => {
        const random = cryptoRandom()
        const counts = new Map()
        for (let i = 0; i < 60000; i++) {
            const key = shuffle([0, 1, 2], random).join('')
            counts.set(key, (counts.get(key) || 0) + 1)
        }
        expect(counts.size).toBe(6)
        for (const c of counts.values()) expect(Math.abs(c - 10000)).toBeLessThan(600)
    })
})

describe('symbol set and character sets', () => {
    it('keeps ASCII punctuation once each and reports what it ignored', () => {
        expect(parseSymbolSet('!!@a 1#é@')).toEqual({ chars: ['!', '@', '#'], ignored: ['a', ' ', '1', 'é'], repeated: true })
        expect(parseSymbolSet(DEFAULT_SYMBOLS)).toEqual({ chars: Array.from(DEFAULT_SYMBOLS), ignored: [], repeated: false })
        expect(parseSymbolSet(undefined).chars).toEqual([])
    })

    it('the default symbols are 28 ASCII punctuation characters without quotes, backslash or backtick', () => {
        expect(DEFAULT_SYMBOLS).toHaveLength(28)
        expect(new Set(DEFAULT_SYMBOLS).size).toBe(28)
        for (const ch of DEFAULT_SYMBOLS) expect(ch).toMatch(PUNCTUATION)
        for (const ch of '"\'\\`') expect(DEFAULT_SYMBOLS).not.toContain(ch)
    })

    it('builds a pool of 90 characters by default', () => {
        const { sets, pool } = characterSets(opts())
        expect(sets.map(s => [s.id, s.chars.length])).toEqual([['lower', 26], ['upper', 26], ['digits', 10], ['symbols', 28]])
        expect(pool).toHaveLength(90)
        expect(new Set(pool).size).toBe(90)
    })

    it('removes look-alike characters from every set', () => {
        const { sets, pool } = characterSets(opts({ avoidLookalikes: true }))
        expect(sets.map(s => s.chars.length)).toEqual([24, 24, 8, 27])
        for (const ch of LOOKALIKES) expect(pool).not.toContain(ch)
        expect(pool).toHaveLength(83)
    })

    it('explains impossible selections instead of producing output', () => {
        const none = { lower: false, upper: false, digits: false, symbols: false }
        expect(characterSets(opts(none)).error).toMatch(/at least one character set/)
        expect(characterSets(opts({ symbols: true, symbolSet: '' })).error).toMatch(/Add at least one symbol/)
        expect(characterSets(opts({ symbols: true, symbolSet: 'abc 123' })).error).toMatch(/Add at least one symbol/)
        expect(characterSets(opts({ symbolSet: '|', avoidLookalikes: true })).error).toMatch(/look-alikes/)
        expect(() => generatePassword(opts(none))).toThrow(GeneratorError)
        expect(() => generatePassword(opts(none))).toThrow(/at least one character set/)
        expect(() => generateValues(opts({ ...none, count: 3 }))).toThrow(/at least one character set/)
    })
})

describe('generatePassword', () => {
    it('has exactly the requested length', () => {
        for (const length of [8, 9, 20, 64, 127, 128]) {
            expect(generatePassword(opts({ length }))).toHaveLength(length)
        }
    })

    it('only uses characters from the enabled sets', () => {
        const random = cryptoRandom()
        const digitsOnly = opts({ lower: false, upper: false, symbols: false, length: 40, requireEach: false })
        for (let i = 0; i < 200; i++) expect(generatePassword(digitsOnly, random)).toMatch(/^[0-9]{40}$/)
        const lowerSymbols = opts({ upper: false, digits: false, symbolSet: '*-', length: 30 })
        for (let i = 0; i < 200; i++) expect(generatePassword(lowerSymbols, random)).toMatch(/^[a-z*-]{30}$/)
    })

    it('with “at least one from each set”, every password covers every set, even a one-symbol set', () => {
        const random = cryptoRandom()
        const options = opts({ length: 8, symbolSet: '!', requireEach: true })
        for (let i = 0; i < 2000; i++) {
            const pw = generatePassword(options, random)
            expect(pw).toMatch(/[a-z]/)
            expect(pw).toMatch(/[A-Z]/)
            expect(pw).toMatch(/[0-9]/)
            expect(pw).toContain('!')
        }
    })

    it('without the guarantee, short passwords often miss a small set', () => {
        const random = cryptoRandom()
        const options = opts({ length: 8, symbolSet: '!', requireEach: false })
        let missing = 0
        for (let i = 0; i < 2000; i++) if (!generatePassword(options, random).includes('!')) missing++
        // P(no "!" in 8 draws from 63) ≈ 0.88
        expect(missing).toBeGreaterThan(1500)
    })

    it('never contains look-alikes when they are avoided', () => {
        const random = cryptoRandom()
        const options = opts({ length: 64, avoidLookalikes: true, symbolSet: `${DEFAULT_SYMBOLS}|` })
        for (let i = 0; i < 1000; i++) {
            const pw = generatePassword(options, random)
            for (const ch of LOOKALIKES) expect(pw).not.toContain(ch)
        }
    })

    it('draws every pool character equally often when nothing is forced', () => {
        const random = cryptoRandom()
        const options = opts({ length: 32, requireEach: false })
        const counts = new Map()
        for (let i = 0; i < 2000; i++) for (const ch of generatePassword(options, random)) counts.set(ch, (counts.get(ch) || 0) + 1)
        expect(counts.size).toBe(90)
        // 64,000 draws over 90 characters: expected ≈ 711, σ ≈ 26.5
        for (const c of counts.values()) expect(Math.abs(c - 64000 / 90)).toBeLessThan(200)
    })

    it('places one character from each set, fills from the pool, then shuffles', () => {
        // Digits + uppercase, length 8: two forced picks, six pool picks, seven shuffle swaps
        const options = opts({ lower: false, symbols: false, length: 8 })
        const forced = [3, 2] // 'D' (uppercase index 3), '2' (digit index 2)
        const fill = [0, 1, 2, 3, 26, 35] // pool = A–Z then 0–9: A B C D 0 9
        const swaps = [0, 0, 0, 0, 0, 0, 0] // i = 7…1 each swaps with position 0
        const pw = generatePassword(options, sequence([...forced, ...fill, ...swaps]))
        // before shuffle: D 2 A B C D 0 9; swapping position i with 0 for i = 7…1 moves the first character to the end
        expect(pw).toBe('2ABCD09D')
        expect(pw).toHaveLength(8)
    })

    it('rejects lengths outside 8–128', () => {
        expect(() => generatePassword(opts({ length: 7 }))).toThrow(/Length must be a whole number from 8 to 128/)
        expect(() => generatePassword(opts({ length: 129 }))).toThrow(GeneratorError)
        expect(() => generatePassword(opts({ length: 12.5 }))).toThrow(GeneratorError)
    })
})

describe('generatePassphrase', () => {
    const LIST = ['alpha', 'bravo', 'charlie', 'delta']

    it('uses the EFF long list: 7,776 unique lowercase words, none the start of another', () => {
        expect(EFF_LONG).toHaveLength(EFF_LIST_SIZE)
        expect(new Set(EFF_LONG).size).toBe(EFF_LIST_SIZE)
        for (const word of EFF_LONG) expect(word).toMatch(/^[a-z][a-z-]*$/)
        // Prefix-free: words can't run together ambiguously, even without a separator
        const sorted = [...EFF_LONG].sort()
        for (let i = 0; i + 1 < sorted.length; i++) expect(sorted[i + 1].startsWith(sorted[i])).toBe(false)
    })

    it('has the requested number of words, all from the list', () => {
        const random = cryptoRandom()
        const words = new Set(EFF_LONG)
        for (const n of [3, 6, 12]) {
            for (let i = 0; i < 50; i++) {
                const parts = generatePassphrase(opts({ words: n, separator: 'space' }), EFF_LONG, random).split(' ')
                expect(parts).toHaveLength(n)
                for (const part of parts) expect(words.has(part)).toBe(true)
            }
        }
    })

    it('joins words with the chosen separator', () => {
        const pick = [0, 1, 2, 3] // alpha bravo charlie delta
        expect(generatePassphrase(opts({ words: 4, separator: 'space' }), LIST, sequence(pick))).toBe('alpha bravo charlie delta')
        expect(generatePassphrase(opts({ words: 4, separator: 'hyphen' }), LIST, sequence(pick))).toBe('alpha-bravo-charlie-delta')
        expect(generatePassphrase(opts({ words: 4, separator: 'period' }), LIST, sequence(pick))).toBe('alpha.bravo.charlie.delta')
        expect(generatePassphrase(opts({ words: 4, separator: 'underscore' }), LIST, sequence(pick))).toBe('alpha_bravo_charlie_delta')
        expect(generatePassphrase(opts({ words: 4, separator: 'none' }), LIST, sequence(pick))).toBe('alphabravocharliedelta')
    })

    it('capitalises each word', () => {
        expect(generatePassphrase(opts({ words: 3, separator: 'space', capitalize: true }), [...LIST, 't-shirt'], sequence([4, 0, 3]))).toBe('T-shirt Alpha Delta')
    })

    it('adds a digit and a symbol to the end of randomly chosen words', () => {
        // words 3,2,1; digit after word index 1 is 7; symbol after word index 2 is "#"
        const source = sequence([3, 2, 1, 1, 7, 2, 1])
        const out = generatePassphrase(opts({ words: 3, separator: 'hyphen', addNumber: true, addSymbol: true, symbolSet: '!#' }), LIST, source)
        expect(out).toBe('delta-charlie7-bravo#')

        const random = cryptoRandom()
        for (let i = 0; i < 300; i++) {
            const phrase = generatePassphrase(opts({ words: 5, separator: 'space', addNumber: true, addSymbol: true }), EFF_LONG, random)
            expect(phrase.match(/[0-9]/g)).toHaveLength(1)
            const symbols = [...phrase].filter(ch => DEFAULT_SYMBOLS.includes(ch) && ch !== '-')
            expect(symbols.length).toBeLessThanOrEqual(1) // "-" also appears inside words like "t-shirt"
            expect(phrase.split(' ')).toHaveLength(5)
            for (const word of phrase.split(' ')) expect(word).toMatch(/^[a-z-]+[0-9]?[!-/:-@[-`{-~]?$/)
        }
    })

    it('explains missing inputs', () => {
        expect(() => generatePassphrase(opts(), null)).toThrow(/word list/)
        expect(() => generatePassphrase(opts({ words: 2 }), LIST)).toThrow(/from 3 to 12/)
        expect(() => generatePassphrase(opts({ words: 13 }), LIST)).toThrow(GeneratorError)
        expect(() => generatePassphrase(opts({ separator: 'comma' }), LIST)).toThrow(/separator/)
        expect(() => generatePassphrase(opts({ addSymbol: true, symbolSet: 'abc' }), LIST)).toThrow(/Add at least one symbol/)
    })
})

describe('generatePin', () => {
    it('is the requested number of digits', () => {
        for (const n of [4, 6, 12]) expect(generatePin(n)).toMatch(new RegExp(`^[0-9]{${n}}$`))
        expect(generatePin(6, sequence([0, 0, 7, 0, 0, 1]))).toBe('007001')
        expect(() => generatePin(3)).toThrow(/from 4 to 12/)
        expect(() => generatePin(13)).toThrow(GeneratorError)
    })
})

describe('generateValues', () => {
    it('makes the requested number of values for each mode', () => {
        expect(generateValues(opts({ count: 5 }))).toHaveLength(5)
        expect(generateValues(opts({ mode: 'pin', count: 50 }))).toHaveLength(50)
        const phrases = generateValues(opts({ mode: 'passphrase', count: 3, separator: 'space' }), { wordList: EFF_LONG })
        expect(phrases).toHaveLength(3)
        for (const p of phrases) expect(p.split(' ')).toHaveLength(6)
        expect(() => generateValues(opts({ count: 0 }))).toThrow(/How many/)
        expect(() => generateValues(opts({ count: 51 }))).toThrow(GeneratorError)
        expect(() => generateValues(opts({ mode: 'passphrase' }))).toThrow(/word list/)
    })
})

describe('entropy', () => {
    it('is length × log2(pool) for passwords', () => {
        const e = entropyOf(opts())
        expect(e.bits).toBeCloseTo(20 * Math.log2(90), 10)
        expect(e.bits).toBeCloseTo(129.84, 2)
        expect(e.upperBound).toBe(true)
        expect(e.formula).toBe('20 characters × log₂ 90 = 129.8 bits')

        const lower = entropyOf(opts({ upper: false, digits: false, symbols: false, length: 16 }))
        expect(lower.bits).toBeCloseTo(16 * Math.log2(26), 10)
        expect(lower.upperBound).toBe(false) // one set: the guarantee changes nothing

        expect(entropyOf(opts({ requireEach: false })).upperBound).toBe(false)
        expect(entropyOf(opts({ avoidLookalikes: true, length: 10 })).bits).toBeCloseTo(10 * Math.log2(83), 10)
        expect(entropyOf(opts({ symbolSet: '!!!' })).bits).toBeCloseTo(20 * Math.log2(63), 10)
        expect(entropyOf(opts({ lower: false, upper: false, digits: false, symbols: false })).error).toMatch(/character set/)
    })

    it('is words × log2(7776) plus the extras for passphrases', () => {
        const base = entropyOf(opts({ mode: 'passphrase' }))
        expect(base.bits).toBeCloseTo(6 * Math.log2(7776), 10)
        expect(base.bits).toBeCloseTo(77.55, 2)
        expect(base.formula).toBe('6 words × log₂ 7,776 = 77.5 bits')
        expect(base.upperBound).toBe(false)

        const digit = entropyOf(opts({ mode: 'passphrase', addNumber: true }))
        expect(digit.bits - base.bits).toBeCloseTo(Math.log2(10) + Math.log2(6), 10)

        const both = entropyOf(opts({ mode: 'passphrase', words: 4, addNumber: true, addSymbol: true }))
        expect(both.bits).toBeCloseTo(4 * Math.log2(7776) + Math.log2(10) + Math.log2(4) + Math.log2(28) + Math.log2(4), 10)
        expect(both.formula).toBe('4 words × log₂ 7,776 + digit (log₂ 10 + log₂ 4 places) + symbol (log₂ 28 + log₂ 4 places) = 63.8 bits')

        expect(entropyOf(opts({ mode: 'passphrase', addSymbol: true, symbolSet: '' })).error).toBeTruthy()
    })

    it('is digits × log2(10) for PINs', () => {
        expect(entropyOf(opts({ mode: 'pin' })).bits).toBeCloseTo(6 * Math.log2(10), 10)
        expect(entropyOf(opts({ mode: 'pin', pinLength: 4 })).formula).toBe('4 digits × log₂ 10 = 13.3 bits')
    })

    it('maps bits to the five strength labels', () => {
        expect(strengthOf(0)).toEqual({ level: 0, label: 'Very weak' })
        expect(strengthOf(39.99).level).toBe(0)
        expect(strengthOf(40)).toEqual({ level: 1, label: 'Weak' })
        expect(strengthOf(59.9).level).toBe(1)
        expect(strengthOf(60)).toEqual({ level: 2, label: 'Fair' })
        expect(strengthOf(77.5)).toEqual({ level: 3, label: 'Strong' })
        expect(strengthOf(99.99).level).toBe(3)
        expect(strengthOf(100)).toEqual({ level: 4, label: 'Very strong' })
        expect(strengthOf(entropyOf(opts()).bits).label).toBe('Very strong')
        expect(strengthOf(entropyOf(opts({ mode: 'pin' })).bits).label).toBe('Very weak')
    })
})

describe('normalizeOptions', () => {
    it('falls back to the defaults for anything that isn’t an options object', () => {
        for (const raw of [null, undefined, 'x', 42, [], [1, 2], true]) expect(normalizeOptions(raw)).toEqual({ ...DEFAULT_OPTIONS })
    })

    it('keeps valid values and drops unknown keys', () => {
        const valid = { ...DEFAULT_OPTIONS, mode: 'passphrase', count: 7, length: 64, lower: false, words: 9, separator: 'none', capitalize: true, pinLength: 12, extra: 'dropped' }
        const out = normalizeOptions(valid)
        expect(out).toEqual({ ...DEFAULT_OPTIONS, mode: 'passphrase', count: 7, length: 64, lower: false, words: 9, separator: 'none', capitalize: true, pinLength: 12 })
        expect(out).not.toHaveProperty('extra')
    })

    it('rounds and clamps numbers and rejects wrong types', () => {
        const out = normalizeOptions({ count: 500, length: 3, words: 6.6, pinLength: -4, upper: 'yes', mode: 'pass', separator: '__proto__', symbolSet: 5 })
        expect(out.count).toBe(50)
        expect(out.length).toBe(8)
        expect(out.words).toBe(7)
        expect(out.pinLength).toBe(4)
        expect(out.upper).toBe(true)
        expect(out.mode).toBe('password')
        expect(out.separator).toBe('hyphen')
        expect(out.symbolSet).toBe(DEFAULT_SYMBOLS)
        expect(normalizeOptions({ length: NaN, count: Infinity, words: '8' })).toMatchObject({ length: 20, count: 1, words: 6 })
        expect(normalizeOptions({ symbolSet: '!'.repeat(1000) }).symbolSet).toHaveLength(200)
    })

    it('is not fooled by a "__proto__" key in stored JSON', () => {
        const out = normalizeOptions(JSON.parse('{"__proto__": {"mode": "pin", "length": 30}}'))
        expect(out.mode).toBe('password')
        expect(out.length).toBe(20)
    })
})

describe('character constants', () => {
    it('are the expected alphabets', () => {
        expect(LOWERCASE).toHaveLength(26)
        expect(UPPERCASE).toBe(LOWERCASE.toUpperCase())
        expect(DIGITS).toBe('0123456789')
    })
})
