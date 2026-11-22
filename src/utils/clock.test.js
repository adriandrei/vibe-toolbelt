// Only the pure formatting helpers; useNow() needs React and a DOM.
import { describe, expect, it } from 'vitest'
import { formatDuration, formatRelative } from './clock'

describe('formatDuration', () => {
    it.each([
        [0, '0 s'], [45.9, '45 s'], [59, '59 s'], [60, '1 min'], [90, '2 min'], [3599, '59 min'], [3600, '1 h'], [5400, '1 h 30 min'],
        [3600 * 5, '5 h'], [3600 * 10 + 60, '10 h'], [86400 * 2 - 1, '48 h'], [86400 * 2, '2 days'], [86400 * 3, '3 days'], [86400 * 364, '364 days'],
        [86400 * 365.25, '1.0 years'], [86400 * 365.25 * 2.44, '2.4 years'], [86400 * 365.25 * 12, '12 years'],
    ])('%s s -> %s', (s, text) => expect(formatDuration(s)).toBe(text))

    it('uses the magnitude of negative values', () => {
        expect(formatDuration(-90)).toBe('2 min')
    })
})

describe('formatRelative', () => {
    it('says now within a second, in/ago otherwise', () => {
        expect(formatRelative(0)).toBe('now')
        expect(formatRelative(0.5)).toBe('now')
        expect(formatRelative(-0.99)).toBe('now')
        expect(formatRelative(300)).toBe('in 5 min')
        expect(formatRelative(-86400 * 3)).toBe('3 days ago')
        expect(formatRelative(1)).toBe('in 1 s')
    })
})
