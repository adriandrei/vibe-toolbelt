import { describe, expect, it, vi } from 'vitest'
import {
    ALPHABET_PRESETS, CROCKFORD, NANOID_ALPHABET, decodeUlid, idsForCollisionProbability, nanoid, parseUuid, randomInt, ulid, validateAlphabet,
} from './ids'

describe('randomInt', () => {
    it('stays in range and covers it', () => {
        const seen = new Set()
        for (let i = 0; i < 2000; i++) {
            const n = randomInt(6)
            expect(Number.isInteger(n) && n >= 0 && n < 6).toBe(true)
            seen.add(n)
        }
        expect(seen.size).toBe(6)
        expect(randomInt(1)).toBe(0)
    })
    it('is roughly uniform', () => {
        const counts = new Array(3).fill(0)
        for (let i = 0; i < 9000; i++) counts[randomInt(3)]++
        for (const c of counts) expect(c).toBeGreaterThan(2700) // expected 3000, sigma ~ 45
    })
    it('accepts 2^32 and rejects invalid maxima', () => {
        expect(randomInt(2 ** 32)).toBeLessThan(2 ** 32)
        for (const bad of [0, -1, 1.5, 2 ** 32 + 1, NaN, '5']) expect(() => randomInt(bad)).toThrow(RangeError)
    })
})

describe('validateAlphabet', () => {
    it('accepts a normal alphabet', () => {
        expect(validateAlphabet('abc')).toEqual({ symbols: ['a', 'b', 'c'], warning: undefined })
    })
    it('requires 2+ symbols', () => {
        expect(validateAlphabet('a').error).toBe('Use at least 2 different characters.')
        expect(validateAlphabet('').error).toBeDefined()
        expect(validateAlphabet(undefined).symbols).toEqual([])
    })
    it('rejects repeats, naming them', () => {
        expect(validateAlphabet('abca').error).toMatch(/repeated: “a”/)
    })
    it('limits to 256 code points and counts astral characters once', () => {
        expect(validateAlphabet(Array.from({ length: 257 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('')).error).toMatch(/At most 256/)
        expect(validateAlphabet('😀😁').symbols).toHaveLength(2)
    })
    it('warns about whitespace and non-ASCII', () => {
        expect(validateAlphabet('a b').warning).toMatch(/whitespace/)
        expect(validateAlphabet('aé').warning).toMatch(/Non-ASCII/)
    })
    it('has valid presets', () => {
        for (const p of ALPHABET_PRESETS) expect(validateAlphabet(p.value).error, p.id).toBeUndefined()
        expect(NANOID_ALPHABET).toHaveLength(64)
    })
})

describe('nanoid', () => {
    it('makes 21 URL-safe characters by default', () => {
        const id = nanoid()
        expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/)
        expect(nanoid()).not.toBe(id)
    })
    it('respects size and alphabet (including non-power-of-two alphabets)', () => {
        expect(nanoid(40, Array.from('0123456789'))).toMatch(/^\d{40}$/)
        expect(nanoid(1000, Array.from('abc'))).toMatch(/^[abc]{1000}$/)
        expect(nanoid(5, ['😀', '😁'])).toMatch(/^[😀😁]{5}$/u)
    })
    it('returns an empty string for size 0 and rejects sizes that could never be reached', () => {
        expect(nanoid(0)).toBe('')
        expect(() => nanoid(-1)).toThrow(RangeError)
        expect(() => nanoid(2.5)).toThrow(RangeError)
        expect(() => nanoid(Number.NaN)).toThrow(RangeError)
    })

    it('uses every symbol evenly (no modulo bias)', () => {
        const symbols = Array.from('abcde') // 5 symbols: mask 7, rejection sampling
        const counts = Object.fromEntries(symbols.map(s => [s, 0]))
        for (const ch of nanoid(20000, symbols)) counts[ch]++
        for (const c of Object.values(counts)) expect(c).toBeGreaterThan(3700) // expected 4000, sigma ~ 57
    })
    it('rejects alphabets of the wrong size', () => {
        expect(() => nanoid(5, ['a'])).toThrow(RangeError)
        expect(() => nanoid(5, Array.from({ length: 257 }, (_, i) => String(i)))).toThrow(RangeError)
    })
})

describe('ULID', () => {
    it('encodes the timestamp as the spec example: 01ARZ3NDEK... for 1469922850259', () => {
        // https://github.com/ulid/spec: 01ARZ3NDEKTSV4RRFFQ69G5FAV, time 1469922850259
        expect(ulid(1469922850259).slice(0, 10)).toBe('01ARZ3NDEK')
        expect(decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toEqual({ ms: 1469922850259, normalized: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })
    })
    it('has 26 Crockford characters', () => {
        expect(ulid(Date.now())).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
        expect(CROCKFORD).toHaveLength(32)
    })
    it('encodes the minimum and maximum timestamps (fresh module: ULID state is monotonic per module)', async () => {
        vi.resetModules()
        const fresh = await import('./ids')
        expect(fresh.ulid(0).slice(0, 10)).toBe('0000000000')
        vi.resetModules()
        const fresh2 = await import('./ids')
        expect(fresh2.ulid(2 ** 48 - 1).slice(0, 10)).toBe('7ZZZZZZZZZ')
    })
    it('sorts in creation order, within one millisecond and across a clock going backwards', () => {
        const t = 1_800_000_000_000
        const ids = [ulid(t), ulid(t), ulid(t), ulid(t - 5000), ulid(t + 1)]
        expect([...ids].sort()).toEqual(ids)
        expect(new Set(ids).size).toBe(5)
        // within the same ms the random part increments by exactly one
        const a = ulid(t + 10)
        const b = ulid(t + 10)
        expect(b.slice(0, 10)).toBe(a.slice(0, 10))
        expect(CROCKFORD.indexOf(b[25]) - CROCKFORD.indexOf(a[25])).toBeOneOf([1, -31])
    })
    it('rejects out-of-range timestamps', () => {
        for (const bad of [-1, 2 ** 48, NaN, Infinity]) expect(() => ulid(bad)).toThrow(RangeError)
    })
})

describe('decodeUlid', () => {
    it('is case-insensitive and maps look-alikes (I, L -> 1, O -> 0)', () => {
        expect(decodeUlid('01arz3ndektsv4rrffq69g5fav').ms).toBe(1469922850259)
        const odd = decodeUlid('OIARZ3NDEKTSV4RRFFQ69G5FAL')
        expect(odd.normalized).toBe('01ARZ3NDEKTSV4RRFFQ69G5FA1')
        expect(odd.ms).toBe(1469922850259)
    })
    it('explains errors', () => {
        expect(decodeUlid('')).toEqual({ error: 'Empty' })
        expect(decodeUlid('ABC').error).toBe('A ULID has 26 characters (this has 3).')
        expect(decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAU').error).toMatch(/“U” isn't a Crockford/)
        expect(decodeUlid('8ZZZZZZZZZZZZZZZZZZZZZZZZZ').error).toMatch(/too large/)
        expect(decodeUlid(null).error).toBe('Empty')
    })
})

describe('idsForCollisionProbability', () => {
    it('follows the birthday bound', () => {
        // 1% collision for a 64-bit ID needs ~ sqrt(2 * 2^64 * -ln(0.99)) = 6.1e8 IDs
        expect(idsForCollisionProbability(64)).toBeCloseTo(Math.sqrt(2 * 2 ** 64 * -Math.log(0.99)), -2)
        expect(idsForCollisionProbability(64) / 1e8).toBeCloseTo(6.09, 1)
        // 50% for 23 people in 365 days is the classic; use bits = log2(365)
        expect(idsForCollisionProbability(Math.log2(365), 0.5)).toBeCloseTo(22.5, 0)
    })
})

describe('parseUuid', () => {
    it('parses the RFC 9562 version 1 example', () => {
        const r = parseUuid('C232AB00-9414-11EC-B3C8-9F6BDECED846')
        expect(r).toMatchObject({ canonical: 'c232ab00-9414-11ec-b3c8-9f6bdeced846', version: 1, standard: true, variant: 'RFC 9562 (standard)', clockSeq: 0x33c8, node: '9f:6b:de:ce:d8:46', randomNode: true })
        expect(new Date(r.timestamp).toISOString()).toBe('2022-02-22T19:22:22.000Z')
        expect(r.versionName).toMatch(/time-based/)
    })
    it('parses the RFC 9562 version 6 example (same instant)', () => {
        const r = parseUuid('1EC9414C-232A-6B00-B3C8-9F6BDECED846')
        expect(r.version).toBe(6)
        expect(new Date(r.timestamp).toISOString()).toBe('2022-02-22T19:22:22.000Z')
        expect(r.node).toBe('9f:6b:de:ce:d8:46')
    })
    it('parses the RFC 9562 version 7 example', () => {
        const r = parseUuid('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')
        expect(r.version).toBe(7)
        expect(r.timestamp).toBe(1645557742000)
        expect(new Date(r.timestamp).toISOString()).toBe('2022-02-22T19:22:22.000Z')
    })
    it('reads versions 3, 4 and 5 without timestamps', () => {
        expect(parseUuid('5df41881-3aed-3515-88a7-2f4a814cf09e')).toMatchObject({ version: 3, versionName: 'name-based (MD5)' })
        expect(parseUuid('919108f7-52d1-4320-9bac-f847db4148a8')).toMatchObject({ version: 4, versionName: 'random' })
        expect(parseUuid('2ed6657d-e927-568b-95e1-2665a8aea6a2')).toMatchObject({ version: 5, versionName: 'name-based (SHA-1)' })
        expect(parseUuid('919108f7-52d1-4320-9bac-f847db4148a8').timestamp).toBeUndefined()
    })
    it('accepts braces, urn:uuid:, no hyphens and upper case', () => {
        const canonical = '919108f7-52d1-4320-9bac-f847db4148a8'
        for (const form of [`{${canonical}}`, `urn:uuid:${canonical}`, canonical.replace(/-/g, ''), canonical.toUpperCase(), `  ${canonical}  `]) {
            expect(parseUuid(form).canonical, form).toBe(canonical)
        }
    })
    it('recognises nil and max UUIDs', () => {
        expect(parseUuid('00000000-0000-0000-0000-000000000000').special).toMatch(/Nil/)
        expect(parseUuid('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF').special).toMatch(/Max/)
    })
    it('names non-standard variants and skips version details', () => {
        const ms = parseUuid('12345678-1234-1234-c234-123456789abc')
        expect(ms.variant).toMatch(/Microsoft/)
        expect(ms.versionName).toBeNull()
        expect(ms.standard).toBe(false)
        expect(parseUuid('12345678-1234-1234-0234-123456789abc').variant).toMatch(/NCS/)
        expect(parseUuid('12345678-1234-1234-f234-123456789abc').variant).toMatch(/future/)
    })
    it('flags version numbers outside 1-8', () => {
        expect(parseUuid('12345678-1234-0234-8234-123456789abc').versionName).toBe('unknown version')
        expect(parseUuid('12345678-1234-8234-8234-123456789abc').versionName).toMatch(/custom/)
    })
    it('explains invalid input', () => {
        expect(parseUuid('zzzz').error).toBe('“z” isn’t a hex digit.')
        expect(parseUuid('1234').error).toBe('A UUID has 32 hex digits; this has 4.')
        expect(parseUuid('1234567-81234-1234-8234-123456789abc').error).toMatch(/hyphens are in the wrong places/)
        expect(parseUuid('').error).toMatch(/32 hex digits; this has 0/)
        expect(parseUuid(undefined).error).toBeDefined()
    })
})
