import { describe, expect, it } from 'vitest'
import { CRON_MACROS, analyzeCron, describeField, splitCron } from './cron'

const FROM = new Date('2026-03-10T12:00:00Z') // a Tuesday
const iso = (runs) => runs.map(d => d.toISOString())
const analyze = (expr, opts = {}) => analyzeCron(expr, { timezone: 'utc', from: FROM, ...opts })

describe('splitCron', () => {
    it('reports empty input', () => {
        expect(splitCron('')).toEqual({ status: 'empty' })
        expect(splitCron('   ')).toEqual({ status: 'empty' })
        expect(splitCron(null)).toEqual({ status: 'empty' })
    })

    it('splits 5 fields and collapses whitespace', () => {
        const r = splitCron('  */5   0 1  JAN mon ')
        expect(r.status).toBe('ok')
        expect(r.layout).toBe(5)
        expect(r.fields).toEqual([
            { name: 'minute', value: '*/5' }, { name: 'hour', value: '0' }, { name: 'dom', value: '1' }, { name: 'month', value: 'JAN' }, { name: 'dow', value: 'mon' },
        ])
    })

    it('reads 6 fields with seconds first, or year last when the last field is a year or ? is used', () => {
        expect(splitCron('0 30 9 * * 1').fields.map(f => f.name)).toEqual(['second', 'minute', 'hour', 'dom', 'month', 'dow'])
        expect(splitCron('30 9 * * 1 2030')).toMatchObject({ layout: '6-year' })
        expect(splitCron('30 9 ? * 1 *').layout).toBe('6-year')
        expect(splitCron('30 9 ? * * *').layout).toBe('6-year')
    })

    it('reads 7 fields', () => {
        const r = splitCron('0 0 12 1 1 * 2030')
        expect(r.layout).toBe(7)
        expect(r.fields.map(f => f.name)).toEqual(['second', 'minute', 'hour', 'dom', 'month', 'dow', 'year'])
    })

    it('errors on wrong field counts', () => {
        expect(splitCron('* * *')).toEqual({ status: 'error', message: 'Expression has only 3 parts. At least 5 are required.' })
        expect(splitCron('*')).toMatchObject({ message: 'Expression has only 1 part. At least 5 are required.' })
        expect(splitCron('* * * * * * * *').message).toBe('Expression has 8 parts; at most 7 are allowed.')
    })

    it('expands macros, case-insensitively', () => {
        for (const [macro, expansion] of Object.entries(CRON_MACROS)) {
            const r = splitCron(macro.toUpperCase())
            expect(r).toMatchObject({ status: 'ok', macro, expansion })
        }
        expect(splitCron('@daily').fields.map(f => f.value)).toEqual(['0', '0', '*', '*', '*'])
        expect(splitCron('@reboot')).toMatchObject({ status: 'ok', reboot: true, fields: [] })
        expect(splitCron('@sometimes').message).toMatch(/Unknown shortcut “@sometimes”/)
    })
})

describe('analyzeCron', () => {
    it('describes and schedules every 15 minutes', () => {
        const r = analyze('*/15 * * * *', { count: 4 })
        expect(r.status).toBe('ok')
        expect(r.description).toBe('Every 15 minutes')
        expect(iso(r.runs)).toEqual(['2026-03-10T12:15:00.000Z', '2026-03-10T12:30:00.000Z', '2026-03-10T12:45:00.000Z', '2026-03-10T13:00:00.000Z'])
        expect(r.warnings).toEqual([])
    })

    it('honours the 24-hour option in the description', () => {
        expect(analyze('30 14 * * *').description).toBe('At 02:30 PM')
        expect(analyze('30 14 * * *', { use24Hour: true }).description).toBe('At 14:30')
    })

    it('computes weekday schedules (Mon-Fri at 09:00)', () => {
        const r = analyze('0 9 * * 1-5', { count: 5 })
        // from Tue 2026-03-10 12:00 -> next is Wed 11th
        expect(iso(r.runs)).toEqual([
            '2026-03-11T09:00:00.000Z', '2026-03-12T09:00:00.000Z', '2026-03-13T09:00:00.000Z', '2026-03-16T09:00:00.000Z', '2026-03-17T09:00:00.000Z',
        ])
    })

    it('treats 0 and 7 as Sunday and accepts names', () => {
        const a = analyze('0 0 * * 0', { count: 2 })
        const b = analyze('0 0 * * 7', { count: 2 })
        const c = analyze('0 0 * * SUN', { count: 2 })
        expect(iso(a.runs)).toEqual(['2026-03-15T00:00:00.000Z', '2026-03-22T00:00:00.000Z'])
        expect(iso(b.runs)).toEqual(iso(a.runs))
        expect(iso(c.runs)).toEqual(iso(a.runs))
    })

    it('supports 6-field expressions with seconds and Quartz-style ?', () => {
        const r = analyze('*/20 * * * * *', { count: 3 })
        expect(iso(r.runs)).toEqual(['2026-03-10T12:00:20.000Z', '2026-03-10T12:00:40.000Z', '2026-03-10T12:01:00.000Z'])
        const q = analyze('0 0 12 ? * MON', { count: 1 })
        expect(iso(q.runs)).toEqual(['2026-03-16T12:00:00.000Z'])
    })

    it('supports L (last day of month) and nth weekday', () => {
        expect(iso(analyze('0 0 L * *', { count: 3 }).runs)).toEqual(['2026-03-31T00:00:00.000Z', '2026-04-30T00:00:00.000Z', '2026-05-31T00:00:00.000Z'])
        // third Friday of the month
        expect(iso(analyze('0 0 * * 5#3', { count: 2 }).runs)).toEqual(['2026-03-20T00:00:00.000Z', '2026-04-17T00:00:00.000Z'])
    })

    it('uses the timezone option (UTC vs local use the same instants for UTC-only inputs)', () => {
        const r = analyze('0 0 1 1 *', { count: 2 })
        expect(iso(r.runs)).toEqual(['2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'])
    })

    it('adds an info warning when both day fields are restricted', () => {
        const r = analyze('0 0 13 * 5', { count: 1 })
        expect(r.warnings).toEqual([{ tone: 'info', text: expect.stringMatching(/either one \(not both\)/) }])
        // Friday 13th is not required: the next match is Fri 13 Mar 2026 (both) -> Fri March 13
        expect(iso(r.runs)).toEqual(['2026-03-13T00:00:00.000Z'])
    })

    it('has no upcoming runs for @reboot', () => {
        const r = analyze('@reboot')
        expect(r.status).toBe('ok')
        expect(r.runs).toBeNull()
        expect(r.warnings[0].tone).toBe('info')
    })

    it('expands macros', () => {
        expect(iso(analyze('@hourly', { count: 2 }).runs)).toEqual(['2026-03-10T13:00:00.000Z', '2026-03-10T14:00:00.000Z'])
        expect(iso(analyze('@monthly', { count: 1 }).runs)).toEqual(['2026-04-01T00:00:00.000Z'])
    })

    it('warns about schedules that can never fire', () => {
        for (const expr of ['0 0 31 4 *', '0 0 30 2 *', '0 0 31 FEB,APR,JUN,SEP,NOV *']) {
            const r = analyze(expr)
            expect(r.runs, expr).toEqual([])
            expect(r.warnings[0]).toMatchObject({ tone: 'warning' })
            expect(r.warnings[0].text).toMatch(/never fires/)
        }
    })

    it('allows February 29 only in leap years', () => {
        const r = analyze('0 0 29 2 *', { count: 2 })
        expect(r.warnings).toEqual([])
        expect(iso(r.runs)).toEqual(['2028-02-29T00:00:00.000Z', '2032-02-29T00:00:00.000Z'])
        const never = analyze('0 0 0 29 2 * 2027')
        expect(never.runs).toEqual([])
        expect(never.warnings[0].text).toMatch(/never fires/)
    })

    it('warns when the only year is in the past', () => {
        const r = analyze('0 0 0 1 1 * 2020')
        expect(r.runs).toEqual([])
        expect(r.warnings[0].text).toMatch(/already passed/)
    })

    it('rejects a zero step', () => {
        // cronstrue rejects it before cron.js's own "step of 0" message (hasZeroStep) can be reached
        const r = analyze('*/0 * * * *')
        expect(r.status).toBe('error')
        expect(r.message).toMatch(/Step value must be greater than 0/)
    })

    it('returns readable errors for invalid fields', () => {
        const r = analyze('99 * * * *')
        expect(r.status).toBe('error')
        expect(r.message).toMatch(/\S/)
        expect(r.message[0]).toBe(r.message[0].toUpperCase())
        expect(analyze('* * * *').status).toBe('error')
        expect(analyze('').status).toBe('empty')
    })

    it('passes through the split result', () => {
        expect(analyze('5 4 * * *').split).toMatchObject({ layout: 5, status: 'ok' })
    })
})

describe('describeField', () => {
    it.each([
        ['minute', '*', 'Every minute'],
        ['minute', '*/15', 'Every 15th minute'],
        ['minute', '5', 'At minute 5'],
        ['minute', '5,10', 'At minutes 5 and 10'],
        ['minute', '10-20', 'At minutes 10 through 20'],
        ['minute', '5/10', 'Every 10th minute starting at 5'],
        ['hour', '9', 'During hour 9 AM'],
        ['hour', '0', 'During hour 12 AM'],
        ['hour', '9-17', 'During hours 9 AM through 5 PM'],
        ['dom', '*', 'Every day'],
        ['dom', '1,15', 'On days 1 and 15'],
        ['dom', 'L', 'The last day of the month'],
        ['dom', '15W', 'The weekday nearest day 15'],
        ['dom', 'LW', 'The last weekday of the month'],
        ['month', '1', 'In January'],
        ['month', 'JAN-MAR', 'In January through March'],
        ['dow', '1-5', 'On Monday through Friday'],
        ['dow', '0', 'On Sunday'],
        ['dow', '7', 'On Sunday'],
        ['dow', '5#3', 'The 3rd Friday of the month'],
        ['dow', '5L', 'The last Friday of the month'],
        ['dow', 'L', 'Saturday (the last day of the week)'],
        ['dow', '*', 'Any day of the week'],
        ['dow', '?', 'Any (no specific value)'],
        ['second', '*/30', 'Every 30th second'],
        ['year', '2030', 'In 2030'],
    ])('%s %s -> %s', (name, value, expected) => {
        expect(describeField(name, value)).toBe(expected)
    })

    // "L-2" looks like a plain range (L to 2) but is an offset from the last day
    it('describes L-2 without the "On day" prefix', () => {
        expect(describeField('dom', 'L-2')).toBe('2 days before the last day of the month')
    })

    it('formats hours in 24-hour mode', () => {
        expect(describeField('hour', '9', { use24Hour: true })).toBe('During hour 09')
        expect(describeField('hour', '17', { use24Hour: true })).toBe('During hour 17')
    })
})
