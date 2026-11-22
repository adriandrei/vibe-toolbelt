import { describe, expect, it } from 'vitest'
import {
    detectUnit, formatInUnit, formatRelativeTo, formatUtcOffset, nsFromMs, parseTimestamp, toDateTimeLocalValue, toIsoString, wholeSeconds,
} from './timestamp'

describe('detectUnit', () => {
    it.each([
        ['0', 's'], ['1700000000', 's'], ['9999999999', 's'], ['10000000000', 'ms'], ['1700000000000', 'ms'], ['9999999999999', 'ms'],
        ['1700000000000000', 'us'], ['9999999999999999', 'us'], ['1700000000000000000', 'ns'], ['0000000000001', 's'],
    ])('%s -> %s', (digits, unit) => expect(detectUnit(digits)).toBe(unit))
})

describe('parseTimestamp: numbers', () => {
    it('returns empty for blank input', () => {
        expect(parseTimestamp('')).toEqual({ status: 'empty' })
        expect(parseTimestamp('  ')).toEqual({ status: 'empty' })
        expect(parseTimestamp(null)).toEqual({ status: 'empty' })
    })

    it('reads seconds, milliseconds, microseconds and nanoseconds automatically', () => {
        const iso = (raw) => parseTimestamp(raw).date.toISOString()
        expect(iso('1700000000')).toBe('2023-11-14T22:13:20.000Z')
        expect(iso('1700000000000')).toBe('2023-11-14T22:13:20.000Z')
        expect(iso('1700000000000000')).toBe('2023-11-14T22:13:20.000Z')
        expect(iso('1700000000000000000')).toBe('2023-11-14T22:13:20.000Z')
        expect(parseTimestamp('1700000000')).toMatchObject({ status: 'ok', source: 'number', unit: 's', autoUnit: 's', manual: false, ns: 1_700_000_000_000_000_000n, ms: 1_700_000_000_000 })
    })

    it('keeps full nanosecond precision with BigInt', () => {
        expect(parseTimestamp('1700000000123456789').ns).toBe(1_700_000_000_123_456_789n)
    })

    it('handles fractions, truncating beyond the unit precision', () => {
        expect(parseTimestamp('1700000000.5')).toMatchObject({ ns: 1_700_000_000_500_000_000n, truncated: false })
        expect(parseTimestamp('1700000000.1234567891')).toMatchObject({ ns: 1_700_000_000_123_456_789n, truncated: true })
        expect(parseTimestamp('1700000000.1234567890')).toMatchObject({ truncated: false })
        expect(parseTimestamp('1700000000000.5')).toMatchObject({ unit: 'ms', ns: 1_700_000_000_000_500_000n })
        expect(parseTimestamp('1700000000000000000.5').truncated).toBe(true) // ns have no fraction
        expect(parseTimestamp('5.')).toMatchObject({ status: 'ok', ns: 5_000_000_000n })
    })

    it('accepts separators and a sign', () => {
        expect(parseTimestamp('1_700_000_000').ns).toBe(1_700_000_000_000_000_000n)
        expect(parseTimestamp('1 700 000 000').ns).toBe(1_700_000_000_000_000_000n)
        expect(parseTimestamp('+5').ns).toBe(5_000_000_000n)
        const neg = parseTimestamp('-86400')
        expect(neg.date.toISOString()).toBe('1969-12-31T00:00:00.000Z')
        expect(neg.ns).toBe(-86_400_000_000_000n)
    })

    it('floors negative sub-millisecond values toward the past', () => {
        expect(parseTimestamp('-1', 'ns').ms).toBe(-1)
        expect(parseTimestamp('-1.5').ms).toBe(-1500)
    })

    it('honours a manual unit', () => {
        const r = parseTimestamp('1700000000', 'ms')
        expect(r).toMatchObject({ unit: 'ms', autoUnit: 's', manual: true, ms: 1_700_000_000 })
        expect(r.date.toISOString()).toBe('1970-01-20T16:13:20.000Z')
        expect(parseTimestamp('5', 'bogus').manual).toBe(false)
    })

    it('reports the digit count without leading zeros', () => {
        expect(parseTimestamp('0001700000000').digits).toBe(10)
        expect(parseTimestamp('0').digits).toBe(1)
    })

    it('rejects values outside the Date range with the unit in the message', () => {
        const r = parseTimestamp('9'.repeat(30), 'ns')
        expect(r.status).toBe('error')
        expect(r.message).toMatch(/Read as nanoseconds, this is outside the range/)
        expect(parseTimestamp('8640000000000', 's').status).toBe('ok') // exactly 8.64e15 ms, the Date limit
        expect(parseTimestamp('8640000000001', 's').status).toBe('error')
    })
})

describe('parseTimestamp: dates', () => {
    it('reads ISO dates with a zone', () => {
        const r = parseTimestamp('2024-05-01T12:00:00Z')
        expect(r).toMatchObject({ status: 'ok', source: 'date', zone: 'explicit', ms: 1_714_564_800_000, ns: 1_714_564_800_000_000_000n })
        expect(parseTimestamp('2024-05-01T12:00:00+02:00')).toMatchObject({ zone: 'explicit', ms: 1_714_564_800_000 - 7_200_000 })
        expect(parseTimestamp('Wed, 01 May 2024 12:00:00 GMT')).toMatchObject({ zone: 'explicit', ms: 1_714_564_800_000 })
    })
    it('reads date-only values as UTC', () => {
        expect(parseTimestamp('2024-05-01')).toMatchObject({ zone: 'utc-date-only', ms: Date.UTC(2024, 4, 1) })
    })
    it('marks zone-less date-times as local', () => {
        const r = parseTimestamp('2024-05-01T12:00:00')
        expect(r.zone).toBe('local')
        expect(r.ms).toBe(new Date(2024, 4, 1, 12, 0, 0).getTime())
    })
    it('rejects text that is neither', () => {
        const r = parseTimestamp('not a date')
        expect(r.status).toBe('error')
        expect(r.message).toMatch(/isn’t a number or a date/)
        expect(parseTimestamp('12abc').status).toBe('error')
    })
})

describe('formatting helpers', () => {
    it('nsFromMs truncates toward zero', () => {
        expect(nsFromMs(1500.9)).toBe(1_500_000_000n)
        expect(nsFromMs(-1500.9)).toBe(-1_500_000_000n)
    })

    it('formatInUnit gives exact decimals', () => {
        expect(formatInUnit(1_500_000_000n, 's')).toBe('1.5')
        expect(formatInUnit(1_700_000_000_123_456_789n, 's')).toBe('1700000000.123456789')
        expect(formatInUnit(1_700_000_000_123_456_789n, 'ms')).toBe('1700000000123.456789')
        expect(formatInUnit(1_700_000_000_123_456_789n, 'us')).toBe('1700000000123456.789')
        expect(formatInUnit(1_700_000_000_123_456_789n, 'ns')).toBe('1700000000123456789')
        expect(formatInUnit(-1_500_000_000n, 's')).toBe('-1.5')
        expect(formatInUnit(1_000_000_005n, 's')).toBe('1.000000005')
        expect(formatInUnit(2_000_000_000n, 's')).toBe('2')
        expect(formatInUnit(0n, 'ms')).toBe('0')
    })

    it('wholeSeconds rounds down, including negatives', () => {
        expect(wholeSeconds(1_999_999_999n)).toBe('1')
        expect(wholeSeconds(-1n)).toBe('-1')
        expect(wholeSeconds(-1_000_000_000n)).toBe('-1')
        expect(wholeSeconds(0n)).toBe('0')
    })

    it('toIsoString keeps sub-millisecond digits only when present', () => {
        const ns = 1_700_000_000_123_456_789n
        expect(toIsoString(new Date(1_700_000_000_123), ns)).toBe('2023-11-14T22:13:20.123456789Z')
        expect(toIsoString(new Date(1_700_000_000_123), 1_700_000_000_123_000_000n)).toBe('2023-11-14T22:13:20.123Z')
        expect(toIsoString(new Date(1_700_000_000_123))).toBe('2023-11-14T22:13:20.123Z')
        expect(toIsoString(new Date(1_700_000_000_100), 1_700_000_000_100_500_000n)).toBe('2023-11-14T22:13:20.1005Z')
        // before 1970 the fractional second is still counted forwards: -0.5 ms is 23:59:59.9995
        expect(toIsoString(new Date(-1), -500_000n)).toBe('1969-12-31T23:59:59.9995Z')
    })

    it('formatUtcOffset formats the local offset (getTimezoneOffset is minutes behind UTC)', () => {
        const at = (minutes) => formatUtcOffset({ getTimezoneOffset: () => minutes })
        expect(at(0)).toBe('UTC')
        expect(at(-180)).toBe('UTC+3')
        expect(at(-330)).toBe('UTC+05:30')
        expect(at(480)).toBe('UTC−8')
        expect(at(210)).toBe('UTC−03:30')
        expect(at(NaN)).toBe('')
    })

    it('formatRelativeTo picks the largest sensible unit', () => {
        const now = Date.UTC(2026, 0, 1)
        const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
        expect(formatRelativeTo(now + 3 * 86_400_000, now)).toBe(fmt.format(3, 'day'))
        expect(formatRelativeTo(now - 2 * 365.2425 * 86_400_000, now)).toBe(fmt.format(-2, 'year'))
        expect(formatRelativeTo(now - 100 * 60_000, now)).toBe(fmt.format(-2, 'hour')) // 1.67 h rounds to 2
        expect(formatRelativeTo(now + 45_000, now)).toBe(fmt.format(45, 'second'))
        expect(formatRelativeTo(now, now)).toBe(fmt.format(0, 'second'))
        expect(formatRelativeTo(now + 7 * 86_400_000, now)).toBe(fmt.format(1, 'week'))
    })

    it('toDateTimeLocalValue formats local time and blanks unsupported years', () => {
        expect(toDateTimeLocalValue(new Date(2024, 4, 1, 9, 5, 7))).toBe('2024-05-01T09:05:07')
        expect(toDateTimeLocalValue(new Date(2024, 11, 31, 23, 59, 59))).toBe('2024-12-31T23:59:59')
        expect(toDateTimeLocalValue(new Date(NaN))).toBe('')
        const bc = new Date(0)
        bc.setFullYear(-5)
        expect(toDateTimeLocalValue(bc)).toBe('')
        const far = new Date(0)
        far.setFullYear(10000)
        expect(toDateTimeLocalValue(far)).toBe('')
    })
})
