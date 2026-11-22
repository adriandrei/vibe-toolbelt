import { describe, expect, it } from 'vitest'
import { ShareError } from './share'
import { MAX_SHARED_TEXT, field, ignoredFieldsMessage, readSharedFields } from './shareFields'

const SPEC = {
    pattern: field.string({ max: 10 }),
    flags: field.string({ max: 8, pattern: /^[^\s/]*$/ }),
    mode: field.oneOf(['match', 'replace']),
    count: field.oneOf([5, 10, 25]),
    on: field.boolean(),
}

describe('readSharedFields', () => {
    it('keeps valid fields exactly, including empty strings and false', () => {
        const data = { pattern: '', flags: 'gi', mode: 'replace', count: 25, on: false }
        expect(readSharedFields(data, SPEC)).toEqual({ values: data, ignored: [] })
    })

    it('skips invalid fields and names them, and ignores unknown ones', () => {
        const { values, ignored } = readSharedFields(
            { pattern: 'abc', flags: 'g i', mode: 'bogus', count: '25', on: 'true', extra: 1, constructor: 'x' },
            SPEC,
        )
        expect(values).toEqual({ pattern: 'abc' })
        expect(ignored).toEqual(['flags', 'mode', 'count', 'on'])
    })

    it('rejects values of the wrong type or size', () => {
        expect(readSharedFields({ pattern: 'x'.repeat(11), mode: 'match' }, SPEC).ignored).toEqual(['pattern'])
        expect(readSharedFields({ pattern: ['a'], mode: 'match' }, SPEC).ignored).toEqual(['pattern'])
        expect(readSharedFields({ pattern: null, mode: 'match' }, SPEC).ignored).toEqual(['pattern'])
        expect(readSharedFields({ pattern: 1, mode: 'match' }, SPEC).ignored).toEqual(['pattern'])
        expect(readSharedFields({ count: 5.0, mode: 'match' }, SPEC).values.count).toBe(5)
    })

    it('throws a ShareError when nothing usable is left', () => {
        for (const data of [null, undefined, 'text', 42, [1, 2], {}, { unknown: 1 }, { mode: 'nope', on: 1 }]) {
            expect(() => readSharedFields(data, SPEC)).toThrow(ShareError)
        }
        expect(() => readSharedFields({}, SPEC)).toThrow('It doesn’t contain anything this tool can use.')
    })

    it('ignores inherited properties', () => {
        const data = Object.create({ pattern: 'inherited' })
        data.mode = 'match'
        expect(readSharedFields(data, SPEC).values).toEqual({ mode: 'match' })
    })

    it('has a generous default size limit', () => {
        const check = field.string()
        expect(check('x'.repeat(1000))).toBe('x'.repeat(1000))
        expect(MAX_SHARED_TEXT).toBeGreaterThanOrEqual(1_000_000)
    })

    it('words the warning for skipped fields', () => {
        expect(ignoredFieldsMessage(['flags', 'mode'])).toBe('Some values in the link weren’t valid, so they were left as they were: flags, mode.')
    })
})
