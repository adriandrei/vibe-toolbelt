import { describe, it, expect } from 'vitest'
import {
    HOUR, MAX_ZONES, MINUTE,
    addDays, canonicalZone, daysBetween, defaultZones, formatAmount, formatClock, formatOffset, hourKind, isoOffset,
    listTimeZones, nextTransition, offsetAt, parseDateTimeLocal, parseOffsetQuery, plannerSlots, sanitizeZoneList,
    searchZones, toDateTimeLocal, toIsoInZone, transitionWalls, utcFromFields, wallAt, zoneAbbreviation,
    zoneAbbreviations, zoneCity, zoneRegion, zonedParts, zonedToInstant,
} from './timezones.js'

const at = (iso) => Date.parse(iso)
const wall = (s) => parseDateTimeLocal(s)
const clock = (zone, ms) => {
    const p = zonedParts(zone, ms)
    return toDateTimeLocal(p)
}

describe('offsets', () => {
    it('reads fixed and fractional offsets', () => {
        expect(offsetAt('UTC', at('2026-01-15T12:00:00Z'))).toBe(0)
        expect(offsetAt('Asia/Kolkata', at('2026-01-15T12:00:00Z'))).toBe(5.5 * HOUR)
        expect(offsetAt('Asia/Kathmandu', at('2026-01-15T12:00:00Z'))).toBe(5.75 * HOUR)
        expect(offsetAt('America/St_Johns', at('2026-01-15T12:00:00Z'))).toBe(-3.5 * HOUR)
    })

    it('follows DST in both hemispheres', () => {
        expect(offsetAt('America/New_York', at('2026-01-15T12:00:00Z'))).toBe(-5 * HOUR)
        expect(offsetAt('America/New_York', at('2026-07-15T12:00:00Z'))).toBe(-4 * HOUR)
        expect(offsetAt('Australia/Sydney', at('2026-01-15T12:00:00Z'))).toBe(11 * HOUR)
        expect(offsetAt('Australia/Sydney', at('2026-07-15T12:00:00Z'))).toBe(10 * HOUR)
        expect(offsetAt('Australia/Lord_Howe', at('2026-01-15T12:00:00Z'))).toBe(11 * HOUR)
        expect(offsetAt('Australia/Lord_Howe', at('2026-07-15T12:00:00Z'))).toBe(10.5 * HOUR)
        expect(offsetAt('Pacific/Chatham', at('2026-01-15T12:00:00Z'))).toBe(13.75 * HOUR)
        expect(offsetAt('Pacific/Chatham', at('2026-07-15T12:00:00Z'))).toBe(12.75 * HOUR)
    })

    it('formats offsets', () => {
        expect(formatOffset(0)).toBe('UTC+00:00')
        expect(formatOffset(5.5 * HOUR)).toBe('UTC+05:30')
        expect(formatOffset(5.75 * HOUR)).toBe('UTC+05:45')
        expect(formatOffset(12.75 * HOUR)).toBe('UTC+12:45')
        expect(formatOffset(-4 * HOUR)).toBe('UTC−04:00')
        expect(formatOffset(-4 * HOUR, { ascii: true })).toBe('UTC-04:00')
        expect(isoOffset(-3.5 * HOUR)).toBe('-03:30')
        expect(isoOffset(19 * MINUTE + 32 * 1000)).toBe('+00:19:32')
    })
})

describe('wall time to instant', () => {
    it('America/New_York 2026-03-08 02:30 is in the spring-forward gap', () => {
        const r = zonedToInstant('America/New_York', wall('2026-03-08T02:30'))
        expect(r.status).toBe('gap')
        expect(r.offsetBefore).toBe(-5 * HOUR)
        expect(r.offsetAfter).toBe(-4 * HOUR)
        expect(r.transitionMs).toBe(at('2026-03-08T07:00:00Z'))
        // Read with the offset from before the change: shows as 03:30 EDT
        expect(r.epochMs).toBe(at('2026-03-08T07:30:00Z'))
        expect(clock('America/New_York', r.epochMs)).toBe('2026-03-08T03:30')
        expect(toIsoInZone('America/New_York', r.epochMs)).toBe('2026-03-08T03:30:00-04:00')
    })

    it('times around the New York gap are normal', () => {
        expect(zonedToInstant('America/New_York', wall('2026-03-08T01:59'))).toMatchObject({ status: 'ok', epochMs: at('2026-03-08T06:59:00Z') })
        expect(zonedToInstant('America/New_York', wall('2026-03-08T03:00'))).toMatchObject({ status: 'ok', epochMs: at('2026-03-08T07:00:00Z') })
    })

    it('Europe/London 2026-10-25 01:30 happens twice', () => {
        const r = zonedToInstant('Europe/London', wall('2026-10-25T01:30'))
        expect(r.status).toBe('overlap')
        expect(r.earlier).toBe(at('2026-10-25T00:30:00Z'))
        expect(r.later).toBe(at('2026-10-25T01:30:00Z'))
        expect(r.epochMs).toBe(r.earlier)
        expect(r.offsetBefore).toBe(HOUR)
        expect(r.offsetAfter).toBe(0)
        expect(r.transitionMs).toBe(at('2026-10-25T01:00:00Z'))
        expect(zonedToInstant('Europe/London', wall('2026-10-25T01:30'), 'later').epochMs).toBe(r.later)
        expect(toIsoInZone('Europe/London', r.earlier)).toBe('2026-10-25T01:30:00+01:00')
        expect(toIsoInZone('Europe/London', r.later)).toBe('2026-10-25T01:30:00+00:00')
    })

    it('Asia/Kolkata is UTC+05:30 all year', () => {
        const r = zonedToInstant('Asia/Kolkata', wall('2026-01-15T12:00'))
        expect(r).toMatchObject({ status: 'ok', epochMs: at('2026-01-15T06:30:00Z'), offset: 5.5 * HOUR })
        expect(toIsoInZone('Asia/Kolkata', r.epochMs)).toBe('2026-01-15T12:00:00+05:30')
        expect(nextTransition('Asia/Kolkata', at('2026-01-01T00:00:00Z'))).toBeNull()
    })

    it('Asia/Kathmandu is UTC+05:45', () => {
        const r = zonedToInstant('Asia/Kathmandu', wall('2026-01-15T12:00'))
        expect(r).toMatchObject({ status: 'ok', epochMs: at('2026-01-15T06:15:00Z'), offset: 5.75 * HOUR })
        expect(formatOffset(r.offset)).toBe('UTC+05:45')
    })

    it('Australia/Lord_Howe moves its clocks by 30 minutes', () => {
        const gap = zonedToInstant('Australia/Lord_Howe', wall('2026-10-04T02:15'))
        expect(gap.status).toBe('gap')
        expect(gap.offsetBefore).toBe(10.5 * HOUR)
        expect(gap.offsetAfter).toBe(11 * HOUR)
        expect(gap.transitionMs).toBe(at('2026-10-03T15:30:00Z'))
        expect(clock('Australia/Lord_Howe', gap.epochMs)).toBe('2026-10-04T02:45')

        const overlap = zonedToInstant('Australia/Lord_Howe', wall('2026-04-05T01:45'))
        expect(overlap.status).toBe('overlap')
        expect(overlap.earlier).toBe(at('2026-04-04T14:45:00Z'))
        expect(overlap.later).toBe(at('2026-04-04T15:15:00Z'))
        expect(overlap.later - overlap.earlier).toBe(30 * MINUTE)

        const next = nextTransition('Australia/Lord_Howe', at('2026-01-01T00:00:00Z'))
        expect(next).toEqual({ atMs: at('2026-04-04T15:00:00Z'), offsetBefore: 11 * HOUR, offsetAfter: 10.5 * HOUR })
        expect(formatAmount(next.offsetAfter - next.offsetBefore)).toBe('30 min')
    })

    it('Pacific/Chatham is UTC+12:45, with DST at 02:45 standard time', () => {
        const gap = zonedToInstant('Pacific/Chatham', wall('2026-09-27T03:00'))
        expect(gap.status).toBe('gap')
        expect(gap.transitionMs).toBe(at('2026-09-26T14:00:00Z'))
        expect(clock('Pacific/Chatham', gap.epochMs)).toBe('2026-09-27T04:00')
        expect(toIsoInZone('Pacific/Chatham', gap.epochMs)).toBe('2026-09-27T04:00:00+13:45')

        const overlap = zonedToInstant('Pacific/Chatham', wall('2026-04-05T03:00'))
        expect(overlap.status).toBe('overlap')
        expect(overlap.earlier).toBe(at('2026-04-04T13:15:00Z'))
        expect(overlap.later).toBe(at('2026-04-04T14:15:00Z'))

        expect(zonedToInstant('Pacific/Chatham', wall('2026-07-01T12:00'))).toMatchObject({ status: 'ok', epochMs: at('2026-06-30T23:15:00Z') })
    })

    it('Australia/Sydney (southern hemisphere) falls back in April and springs forward in October', () => {
        const overlap = zonedToInstant('Australia/Sydney', wall('2026-04-05T02:30'))
        expect(overlap.status).toBe('overlap')
        expect(overlap.earlier).toBe(at('2026-04-04T15:30:00Z'))
        expect(overlap.later).toBe(at('2026-04-04T16:30:00Z'))
        expect(overlap.transitionMs).toBe(at('2026-04-04T16:00:00Z'))

        const gap = zonedToInstant('Australia/Sydney', wall('2026-10-04T02:30'))
        expect(gap.status).toBe('gap')
        expect(gap.transitionMs).toBe(at('2026-10-03T16:00:00Z'))
        expect(clock('Australia/Sydney', gap.epochMs)).toBe('2026-10-04T03:30')

        expect(nextTransition('Australia/Sydney', at('2026-01-15T00:00:00Z'))).toEqual({
            atMs: at('2026-04-04T16:00:00Z'), offsetBefore: 11 * HOUR, offsetAfter: 10 * HOUR,
        })
    })

    it('handles a whole skipped day (Samoa, 30 December 2011)', () => {
        const r = zonedToInstant('Pacific/Apia', wall('2011-12-30T12:00'))
        expect(r.status).toBe('gap')
        expect(r.offsetBefore).toBe(-10 * HOUR)
        expect(r.offsetAfter).toBe(14 * HOUR)
        expect(r.transitionMs).toBe(at('2011-12-30T10:00:00Z'))
        expect(clock('Pacific/Apia', r.epochMs)).toBe('2011-12-31T12:00')
    })

    it('handles years before 100', () => {
        const r = zonedToInstant('UTC', wall('0099-06-01T10:00'))
        expect(r.status).toBe('ok')
        expect(new Date(r.epochMs).getUTCFullYear()).toBe(99)
        expect(toIsoInZone('UTC', r.epochMs)).toBe('0099-06-01T10:00:00Z')
    })
})

describe('next clock change', () => {
    it('finds the change to the minute', () => {
        expect(nextTransition('Europe/London', at('2026-01-01T00:00:00Z'))).toEqual({
            atMs: at('2026-03-29T01:00:00Z'), offsetBefore: 0, offsetAfter: HOUR,
        })
        expect(nextTransition('America/New_York', at('2026-01-01T00:00:00Z'))).toEqual({
            atMs: at('2026-03-08T07:00:00Z'), offsetBefore: -5 * HOUR, offsetAfter: -4 * HOUR,
        })
        expect(nextTransition('America/New_York', at('2026-03-08T07:00:00Z'))).toEqual({
            atMs: at('2026-11-01T06:00:00Z'), offsetBefore: -4 * HOUR, offsetAfter: -5 * HOUR,
        })
    })

    it('returns null for zones without changes', () => {
        expect(nextTransition('UTC', at('2026-01-01T00:00:00Z'))).toBeNull()
        expect(nextTransition('America/Sao_Paulo', at('2026-01-01T00:00:00Z'))).toBeNull()
        expect(nextTransition('Asia/Tokyo', at('2026-01-01T00:00:00Z'))).toBeNull()
    })

    it('only looks a year ahead', () => {
        expect(nextTransition('Europe/London', at('2026-01-01T00:00:00Z'), 30 * 24 * HOUR)).toBeNull()
    })
})

describe('names', () => {
    it('uses current IANA names', () => {
        expect(canonicalZone('Asia/Calcutta')).toBe('Asia/Kolkata')
        expect(canonicalZone('asia/kolkata')).toBe('Asia/Kolkata')
        expect(canonicalZone('Europe/Kiev')).toBe('Europe/Kyiv')
        expect(canonicalZone('Etc/UTC')).toBe('UTC')
        expect(canonicalZone('GMT')).toBe('UTC')
        expect(canonicalZone('America/New_York')).toBe('America/New_York')
        expect(canonicalZone('Not/A_Zone')).toBeNull()
        expect(canonicalZone('')).toBeNull()
        expect(canonicalZone(42)).toBeNull()
    })

    it('lists zones with UTC first and no old names', () => {
        const zones = listTimeZones()
        expect(zones[0]).toBe('UTC')
        expect(zones.length).toBeGreaterThan(300)
        expect(zones).toContain('Asia/Kolkata')
        expect(zones).toContain('Europe/Kyiv')
        expect(zones).toContain('America/Argentina/Buenos_Aires')
        expect(zones).not.toContain('Asia/Calcutta')
        expect(new Set(zones).size).toBe(zones.length)
    })

    it('cleans saved zone lists', () => {
        expect(sanitizeZoneList(['Asia/Calcutta', 'asia/kolkata', 'Nope/Nowhere', 42, 'UTC', 'Etc/UTC'])).toEqual(['Asia/Kolkata', 'UTC'])
        expect(sanitizeZoneList([])).toEqual([])
        expect(sanitizeZoneList('UTC')).toBeNull()
        expect(sanitizeZoneList({ 0: 'UTC' })).toBeNull()
        expect(sanitizeZoneList(listTimeZones().slice(0, 50))).toHaveLength(MAX_ZONES)
    })

    it('defaults to UTC, the local zone and three common ones', () => {
        expect(defaultZones('Europe/Paris')).toEqual(['UTC', 'Europe/Paris', 'America/New_York', 'Europe/London', 'Asia/Tokyo'])
        expect(defaultZones('America/New_York')).toEqual(['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Asia/Kolkata'])
        expect(defaultZones('UTC')).toEqual(['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'])
    })

    it('splits city and region', () => {
        expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
        expect(zoneRegion('America/Argentina/Buenos_Aires')).toBe('America/Argentina')
        expect(zoneCity('UTC')).toBe('UTC')
        expect(zoneRegion('UTC')).toBe('')
    })

    it('gives abbreviations where Intl has one', () => {
        expect(zoneAbbreviation('America/New_York', at('2026-01-15T12:00:00Z'))).toBe('EST')
        expect(zoneAbbreviation('America/New_York', at('2026-07-15T12:00:00Z'))).toBe('EDT')
        expect(zoneAbbreviation('Europe/London', at('2026-07-15T12:00:00Z'))).toBe('BST')
        // Older ICU data says "GMT" for London in winter, newer says "GMT+0" (an offset, so none)
        expect(['GMT', null]).toContain(zoneAbbreviation('Europe/London', at('2026-01-15T12:00:00Z')))
        expect(zoneAbbreviation('Asia/Kolkata', at('2026-01-15T12:00:00Z'))).toBe('IST')
        expect(zoneAbbreviation('Asia/Tokyo', at('2026-01-15T12:00:00Z'))).toBeNull()
        expect(zoneAbbreviations('Australia/Sydney', 2026).sort()).toEqual(['AEDT', 'AEST'])
    })
})

describe('search', () => {
    const jan = at('2026-01-15T12:00:00Z')

    it('matches city names', () => {
        expect(searchZones('new york', { atMs: jan })[0]).toBe('America/New_York')
        expect(searchZones('York', { atMs: jan })).toContain('America/New_York')
        expect(searchZones('kolkata', { atMs: jan })[0]).toBe('Asia/Kolkata')
        expect(searchZones('são paulo', { atMs: jan })[0]).toBe('America/Sao_Paulo')
        expect(searchZones('buenos', { atMs: jan })[0]).toBe('America/Argentina/Buenos_Aires')
    })

    it('matches old names and regions', () => {
        expect(searchZones('calcutta', { atMs: jan })).toEqual(['Asia/Kolkata'])
        expect(searchZones('kiev', { atMs: jan })).toEqual(['Europe/Kyiv'])
        expect(searchZones('australia/', { atMs: jan })).toContain('Australia/Lord_Howe')
    })

    it('matches offsets at the given time', () => {
        expect(searchZones('+5:30', { atMs: jan })).toEqual(expect.arrayContaining(['Asia/Kolkata', 'Asia/Colombo']))
        expect(searchZones('+05:45', { atMs: jan })).toEqual(['Asia/Kathmandu'])
        expect(searchZones('UTC-3', { atMs: jan })).toContain('America/Sao_Paulo')
        expect(searchZones('+13:45', { atMs: jan })).toEqual(['Pacific/Chatham'])
        expect(searchZones('+12:45', { atMs: at('2026-07-15T12:00:00Z') })).toEqual(['Pacific/Chatham'])
    })

    it('matches abbreviations from an index', () => {
        const abbreviations = new Map([['America/Los_Angeles', ['PST', 'PDT']], ['Europe/London', ['GMT', 'BST']]])
        expect(searchZones('pst', { atMs: jan, abbreviations })).toEqual(['America/Los_Angeles'])
        expect(searchZones('BST', { atMs: jan, abbreviations })).toEqual(['Europe/London'])
    })

    it('ranks names and abbreviations above matches in the middle of a word', () => {
        const abbreviations = new Map([['Asia/Kolkata', ['IST']], ['Europe/Dublin', ['GMT', 'IST']]])
        const results = searchZones('ist', { atMs: jan, abbreviations })
        // Istanbul's name starts with it; then the zones called IST; then "Boa V-ist-a", "Chr-ist-mas"…
        expect(results.slice(0, 3)).toEqual(['Europe/Istanbul', 'Europe/Dublin', 'Asia/Kolkata'])
        expect(results.indexOf('America/Boa_Vista')).toBeGreaterThan(2)
        // A region name ranks above a match inside a city name
        expect(searchZones('pacific', { atMs: jan })[0]).toMatch(/^Pacific\//)
    })

    it('reads offsets typed in many ways', () => {
        expect(parseOffsetQuery('+5:30')).toBe(330 * MINUTE)
        expect(parseOffsetQuery('UTC-8')).toBe(-480 * MINUTE)
        expect(parseOffsetQuery('gmt+0530')).toBe(330 * MINUTE)
        expect(parseOffsetQuery('5:45')).toBe(345 * MINUTE)
        expect(parseOffsetQuery('−03:00')).toBe(-180 * MINUTE)
        expect(parseOffsetQuery('utc')).toBe(0)
        expect(parseOffsetQuery('+15')).toBeNull()
        expect(parseOffsetQuery('london')).toBeNull()
        expect(parseOffsetQuery('')).toBeNull()
    })
})

describe('dates and formatting', () => {
    it('parses datetime-local values strictly', () => {
        expect(parseDateTimeLocal('2026-03-08T02:30')).toEqual({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 })
        expect(parseDateTimeLocal('2026-03-08T02:30:15')).toEqual({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 15 })
        expect(parseDateTimeLocal('2026-02-30T10:00')).toBeNull()
        expect(parseDateTimeLocal('2026-13-01T10:00')).toBeNull()
        expect(parseDateTimeLocal('2026-01-01T24:00')).toBeNull()
        expect(parseDateTimeLocal('0000-01-01T00:00')).toBeNull()
        expect(parseDateTimeLocal('yesterday')).toBeNull()
        expect(toDateTimeLocal({ year: 99, month: 1, day: 2, hour: 3, minute: 4 })).toBe('0099-01-02T03:04')
    })

    it('gives the clock readings either side of a change', () => {
        const gap = zonedToInstant('America/New_York', wall('2026-03-08T02:30'))
        const walls = transitionWalls(gap)
        expect(toDateTimeLocal(walls.from)).toBe('2026-03-08T02:00')
        expect(toDateTimeLocal(walls.to)).toBe('2026-03-08T03:00')
        const next = nextTransition('Europe/London', at('2026-06-01T00:00:00Z'))
        expect([toDateTimeLocal(transitionWalls(next).from), toDateTimeLocal(transitionWalls(next).to)]).toEqual(['2026-10-25T02:00', '2026-10-25T01:00'])
        expect(wallAt(at('2026-01-01T00:00:00Z'), -HOUR)).toMatchObject({ year: 2025, month: 12, day: 31, hour: 23 })
    })

    it('counts days between wall dates', () => {
        const ny = zonedParts('America/New_York', at('2026-01-16T01:00:00Z')) // 20:00 on the 15th
        const tokyo = zonedParts('Asia/Tokyo', at('2026-01-16T01:00:00Z')) // 10:00 on the 16th
        expect(daysBetween(ny, tokyo)).toBe(1)
        expect(daysBetween(tokyo, ny)).toBe(-1)
        expect(tokyo.weekday).toBe(5) // Friday
        expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 })
        expect(utcFromFields({ year: 2026, month: 3, day: 1 })).toBe(at('2026-03-01T00:00:00Z'))
    })

    it('formats clocks and amounts', () => {
        expect(formatClock(0, 5)).toBe('00:05')
        expect(formatClock(14, 30)).toBe('14:30')
        expect(formatClock(0, 5, 'h12')).toBe('12:05 AM')
        expect(formatClock(12, 0, 'h12')).toBe('12:00 PM')
        expect(formatClock(23, 59, 'h12')).toBe('11:59 PM')
        expect(formatAmount(HOUR)).toBe('1 h')
        expect(formatAmount(-90 * MINUTE)).toBe('1 h 30 min')
        expect(formatAmount(24 * HOUR)).toBe('24 h')
    })
})

describe('meeting planner', () => {
    it('finds hours when everyone is at work', () => {
        const slots = plannerSlots('Europe/London', { year: 2026, month: 1, day: 15 }, ['Europe/London', 'America/New_York'])
        expect(slots).toHaveLength(24)
        expect(slots[0].startMs).toBe(at('2026-01-15T00:00:00Z'))
        const overlap = slots.filter(s => s.allWorking).map(s => s.source.hour)
        expect(overlap).toEqual([14, 15, 16])
        const ny = slots[14].cells[1]
        expect([ny.hour, ny.minute, ny.kind]).toEqual([9, 0, 'work'])
        // 03:00 in London is 22:00 the day before in New York
        expect(slots[3].cells[1]).toMatchObject({ hour: 22, dayDiff: -1, kind: 'night' })
    })

    it('has no overlap when the zones are too far apart', () => {
        const slots = plannerSlots('Europe/London', { year: 2026, month: 1, day: 15 }, ['America/Los_Angeles', 'Asia/Kolkata'])
        expect(slots.some(s => s.allWorking)).toBe(false)
        // Los Angeles and Tokyo share exactly one hour: 16:00 in LA is 09:00 in Tokyo
        const tokyo = plannerSlots('Europe/London', { year: 2026, month: 1, day: 15 }, ['America/Los_Angeles', 'Asia/Tokyo'])
        expect(tokyo.filter(s => s.allWorking).map(s => s.cells.map(c => c.hour))).toEqual([[16, 9]])
    })

    it('has 23 or 25 hours on DST days', () => {
        expect(plannerSlots('America/New_York', { year: 2026, month: 3, day: 8 }, ['UTC'])).toHaveLength(23)
        expect(plannerSlots('Europe/London', { year: 2026, month: 10, day: 25 }, ['UTC'])).toHaveLength(25)
    })

    it('shows :30 and :45 offsets on the same instants', () => {
        const slots = plannerSlots('UTC', { year: 2026, month: 1, day: 15 }, ['Asia/Kolkata', 'Asia/Kathmandu'])
        expect(slots[4].cells.map(c => [c.hour, c.minute])).toEqual([[9, 30], [9, 45]])
        // 09:30–10:30 is inside working hours, 08:30–09:30 is not
        expect(slots[4].cells[0].kind).toBe('work')
        expect(slots[3].cells[0].kind).toBe('off')
    })

    it('classifies hours', () => {
        expect(hourKind(9, 0)).toBe('work')
        expect(hourKind(16, 0)).toBe('work')
        expect(hourKind(16, 30)).toBe('off')
        expect(hourKind(17, 0)).toBe('off')
        expect(hourKind(22, 0)).toBe('night')
        expect(hourKind(6, 59)).toBe('night')
        expect(hourKind(7, 0)).toBe('off')
    })
})
