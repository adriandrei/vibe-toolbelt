// Time zone maths for the Time Zone Converter, built on Intl only (no tz
// database is shipped): offsets, wall-clock ↔ instant conversion with DST
// gaps and overlaps, the next clock change, zone search and the meeting
// planner grid.
//
// "Wall time" is a { year, month, day, hour, minute, second } object read on a
// clock in a zone; an "instant" is epoch milliseconds.

export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

// Working hours and night for the meeting planner (minutes after midnight)
export const WORK_START = 9 * 60
export const WORK_END = 17 * 60
export const NIGHT_START = 22 * 60
export const NIGHT_END = 7 * 60

// ICU (Chrome, Node) still lists some zones under their old CLDR names.
// Show the current IANA names instead; Intl accepts both.
export const LEGACY_ZONES = {
    'Africa/Asmera': 'Africa/Asmara',
    'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
    'America/Catamarca': 'America/Argentina/Catamarca',
    'America/Coral_Harbour': 'America/Atikokan',
    'America/Cordoba': 'America/Argentina/Cordoba',
    'America/Godthab': 'America/Nuuk',
    'America/Indianapolis': 'America/Indiana/Indianapolis',
    'America/Jujuy': 'America/Argentina/Jujuy',
    'America/Louisville': 'America/Kentucky/Louisville',
    'America/Mendoza': 'America/Argentina/Mendoza',
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Rangoon': 'Asia/Yangon',
    'Asia/Saigon': 'Asia/Ho_Chi_Minh',
    'Atlantic/Faeroe': 'Atlantic/Faroe',
    'Europe/Kiev': 'Europe/Kyiv',
    'Pacific/Enderbury': 'Pacific/Kanton',
    'Pacific/Ponape': 'Pacific/Pohnpei',
    'Pacific/Truk': 'Pacific/Chuuk',
}
const OLD_NAMES = Object.fromEntries(Object.entries(LEGACY_ZONES).map(([oldName, current]) => [current, oldName]))

// Used when the browser can't list its zones (Intl.supportedValuesOf)
const FALLBACK_ZONES = [
    'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'America/Anchorage',
    'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Chicago', 'America/Denver', 'America/Halifax',
    'America/Los_Angeles', 'America/Mexico_City', 'America/New_York', 'America/Phoenix', 'America/Santiago',
    'America/Sao_Paulo', 'America/St_Johns', 'America/Toronto', 'America/Vancouver', 'Asia/Bangkok', 'Asia/Dhaka',
    'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Jerusalem', 'Asia/Karachi', 'Asia/Kathmandu',
    'Asia/Kolkata', 'Asia/Manila', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tehran', 'Asia/Tokyo',
    'Atlantic/Reykjavik', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Lord_Howe', 'Australia/Perth',
    'Australia/Sydney', 'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Istanbul', 'Europe/Kyiv',
    'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow', 'Europe/Paris', 'Europe/Rome',
    'Europe/Stockholm', 'Europe/Zurich', 'Pacific/Auckland', 'Pacific/Chatham', 'Pacific/Honolulu',
]

const pad = (n, len = 2) => String(n).padStart(len, '0')

// ---------------------------------------------------------------- names

const canonicalCache = new Map()
const UTC_ALIASES = /^(?:Etc\/)?(?:UTC|UCT|GMT|GMT[+-]?0|Greenwich|Universal|Zulu)$/i

/**
 * The zone's current IANA name ("asia/calcutta" → "Asia/Kolkata",
 * "Etc/UTC" → "UTC"), or null when the browser doesn't know the zone.
 */
export function canonicalZone(id) {
    if (typeof id !== 'string') return null
    const key = id.trim()
    if (!key || key.length > 64) return null
    if (canonicalCache.has(key)) return canonicalCache.get(key)
    let result
    try {
        const resolved = new Intl.DateTimeFormat('en-US', { timeZone: key }).resolvedOptions().timeZone
        result = UTC_ALIASES.test(resolved) ? 'UTC' : (LEGACY_ZONES[resolved] ?? resolved)
    } catch {
        result = null
    }
    canonicalCache.set(key, result)
    return result
}

/** The browser's own zone, by its current IANA name. */
export function localZone() {
    try {
        return canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC'
    } catch {
        return 'UTC'
    }
}

let zoneList = null

/** Every zone the browser knows, current IANA names, UTC first. */
export function listTimeZones() {
    if (zoneList) return zoneList
    let ids
    try {
        ids = Intl.supportedValuesOf('timeZone')
    } catch {
        ids = FALLBACK_ZONES
    }
    const names = new Set()
    for (const id of ids) {
        const name = LEGACY_ZONES[id] ?? id
        if (!UTC_ALIASES.test(name)) names.add(name)
    }
    zoneList = ['UTC', ...[...names].sort()]
    return zoneList
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires" */
export function zoneCity(id) {
    if (id === 'UTC') return 'UTC'
    return id.split('/').pop().replace(/_/g, ' ')
}

/** "America/Argentina/Buenos_Aires" → "America/Argentina" */
export function zoneRegion(id) {
    const parts = id.split('/')
    return parts.length > 1 ? parts.slice(0, -1).join('/').replace(/_/g, ' ') : ''
}

/** Earlier IANA name of a renamed zone ("Asia/Kolkata" → "Asia/Calcutta"), if any. */
export function oldZoneName(id) {
    return OLD_NAMES[id] ?? null
}

export const MAX_ZONES = 20

/**
 * Cleans a saved or shared zone list: current names, no unknown zones, no
 * duplicates, at most MAX_ZONES. Null when it isn't a list at all.
 */
export function sanitizeZoneList(value) {
    if (!Array.isArray(value)) return null
    const out = []
    for (const item of value) {
        const zone = canonicalZone(item)
        if (zone && !out.includes(zone)) out.push(zone)
        if (out.length >= MAX_ZONES) break
    }
    return out
}

const COMMON_ZONES = ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Asia/Kolkata']

/** UTC, the local zone and three common ones. */
export function defaultZones(local) {
    const list = ['UTC']
    if (local && local !== 'UTC') list.push(local)
    let added = 0
    for (const zone of COMMON_ZONES) {
        if (added === 3) break
        if (!list.includes(zone)) {
            list.push(zone)
            added++
        }
    }
    return list
}

// ---------------------------------------------------------------- wall time

const partsCache = new Map()
function partsFormatter(zone) {
    let f = partsCache.get(zone)
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: zone,
            hourCycle: 'h23',
            era: 'short',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        })
        partsCache.set(zone, f)
    }
    return f
}

/** Epoch ms of a wall time read as UTC (years 0–99 included). */
export function utcFromFields({ year, month, day, hour = 0, minute = 0, second = 0 }) {
    const d = new Date(0)
    d.setUTCFullYear(year, month - 1, day)
    d.setUTCHours(hour, minute, second, 0)
    return d.getTime()
}

function readWall(zone, ms) {
    const fields = {}
    for (const p of partsFormatter(zone).formatToParts(ms)) fields[p.type] = p.value
    let year = Number(fields.year)
    if (fields.era && /^B/i.test(fields.era)) year = 1 - year
    return { year, month: Number(fields.month), day: Number(fields.day), hour: Number(fields.hour) % 24, minute: Number(fields.minute), second: Number(fields.second) }
}

/** The wall time in `zone` at instant `ms`, with the weekday (0 = Sunday). */
export function zonedParts(zone, ms) {
    const wall = readWall(zone, ms)
    wall.weekday = new Date(utcFromFields({ year: wall.year, month: wall.month, day: wall.day })).getUTCDay()
    return wall
}

/** UTC offset of `zone` at instant `ms`, in milliseconds (local − UTC). */
export function offsetAt(zone, ms) {
    const floored = Math.floor(ms / 1000) * 1000
    return utcFromFields(readWall(zone, floored)) - floored
}

// First minute at which the offset is no longer `offsetLo`, between lo and hi
function bisectChange(zone, lo, hi, offsetLo) {
    let a = Math.floor(lo / MINUTE)
    let b = Math.ceil(hi / MINUTE)
    while (b - a > 1) {
        const mid = Math.floor((a + b) / 2)
        if (offsetAt(zone, mid * MINUTE) === offsetLo) a = mid
        else b = mid
    }
    return b * MINUTE
}

/**
 * The instant at which the wall time `wall` is read in `zone`.
 *
 *   { status: 'ok', epochMs, offset }
 *   { status: 'gap', epochMs, offsetBefore, offsetAfter, transitionMs }
 *       The time doesn't exist (clocks went forward over it). epochMs is
 *       the same time read with the offset from before the change, which
 *       shows as the time shifted forward by the gap (02:30 → 03:30).
 *   { status: 'overlap', epochMs, earlier, later, offsetBefore, offsetAfter, transitionMs }
 *       The time happens twice (clocks went back). `prefer` picks which:
 *       'earlier' (default) or 'later'.
 */
export function zonedToInstant(zone, wall, prefer = 'earlier') {
    const local = utcFromFields(wall)
    // The offsets in use around this wall time
    const offsets = new Set()
    for (const delta of [-DAY, -HOUR * 12, 0, HOUR * 12, DAY]) offsets.add(offsetAt(zone, local + delta))
    const candidates = []
    for (const offset of offsets) {
        const t = local - offset
        if (offsetAt(zone, t) === offset && !candidates.includes(t)) candidates.push(t)
    }
    candidates.sort((a, b) => a - b)

    if (candidates.length === 1) return { status: 'ok', epochMs: candidates[0], offset: offsetAt(zone, candidates[0]) }

    if (candidates.length > 1) {
        const earlier = candidates[0]
        const later = candidates[candidates.length - 1]
        const offsetBefore = offsetAt(zone, earlier)
        return {
            status: 'overlap',
            epochMs: prefer === 'later' ? later : earlier,
            earlier,
            later,
            offsetBefore,
            offsetAfter: offsetAt(zone, later),
            transitionMs: bisectChange(zone, earlier, later, offsetBefore),
        }
    }

    // A gap: the clocks jumped over this time
    const offsetBefore = offsetAt(zone, local - DAY)
    const offsetAfter = offsetAt(zone, local + DAY)
    const transitionMs = offsetBefore !== offsetAfter ? bisectChange(zone, local - DAY, local + DAY, offsetBefore) : null
    return {
        status: 'gap',
        epochMs: local - offsetBefore,
        offsetBefore,
        offsetAfter: transitionMs === null ? offsetBefore : offsetAt(zone, transitionMs),
        transitionMs,
    }
}

/**
 * The next time the offset of `zone` changes after `fromMs`, within
 * `horizonMs` (a year by default), to the minute:
 *   { atMs, offsetBefore, offsetAfter } or null.
 * Offsets are scanned a day at a time, then the change is bisected.
 */
export function nextTransition(zone, fromMs, horizonMs = 366 * DAY) {
    let prev = fromMs
    let prevOffset = offsetAt(zone, fromMs)
    for (let t = fromMs + DAY; t <= fromMs + horizonMs; t += DAY) {
        const offset = offsetAt(zone, t)
        if (offset !== prevOffset) {
            const atMs = bisectChange(zone, prev, t, prevOffset)
            return { atMs, offsetBefore: prevOffset, offsetAfter: offsetAt(zone, atMs) }
        }
        prev = t
    }
    return null
}

/** The wall time a clock at `offsetMs` shows at instant `ms`. */
export function wallAt(ms, offsetMs) {
    const d = new Date(ms + offsetMs)
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() }
}

/** What the clocks read just before and just after a change: 02:00 → 03:00. */
export function transitionWalls({ transitionMs, atMs, offsetBefore, offsetAfter }) {
    const t = transitionMs ?? atMs
    return { from: wallAt(t, offsetBefore), to: wallAt(t, offsetAfter) }
}

/** Whole days between two wall dates (b − a). */
export function daysBetween(a, b) {
    return Math.round((utcFromFields({ year: b.year, month: b.month, day: b.day }) - utcFromFields({ year: a.year, month: a.month, day: a.day })) / DAY)
}

export function addDays(date, days) {
    const d = new Date(utcFromFields({ year: date.year, month: date.month, day: date.day }) + days * DAY)
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

// ---------------------------------------------------------------- formatting

/** "UTC+05:30", "UTC−08:00", "UTC+00:00" (seconds only for historic offsets). */
export function formatOffset(offsetMs, { ascii = false } = {}) {
    return `UTC${isoOffset(offsetMs, { ascii })}`
}

/** "+05:30" / "-08:00" (ASCII minus unless `ascii` is false). */
export function isoOffset(offsetMs, { ascii = true } = {}) {
    const total = Math.round(offsetMs / 1000)
    const sign = total < 0 ? (ascii ? '-' : '−') : '+'
    const abs = Math.abs(total)
    const s = abs % 60
    return `${sign}${pad(Math.floor(abs / 3600))}:${pad(Math.floor((abs % 3600) / 60))}${s ? `:${pad(s)}` : ''}`
}

/** ISO 8601 with the zone's offset: "2026-03-08T03:30:00-04:00" ("Z" for UTC). */
export function toIsoInZone(zone, ms) {
    const p = zonedParts(zone, ms)
    const year = p.year < 0 ? `-${pad(-p.year, 6)}` : p.year > 9999 ? `+${pad(p.year, 6)}` : pad(p.year, 4)
    const date = `${year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
    return zone === 'UTC' ? `${date}Z` : `${date}${isoOffset(offsetAt(zone, ms))}`
}

/** "14:05" (h23) or "2:05 PM" (h12) */
export function formatClock(hour, minute, cycle = 'h23') {
    if (cycle === 'h12') return `${hour % 12 || 12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`
    return `${pad(hour)}:${pad(minute)}`
}

/** "1 h", "30 min", "1 h 30 min" */
export function formatAmount(ms) {
    const minutes = Math.round(Math.abs(ms) / MINUTE)
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h && m) return `${h} h ${m} min`
    return h ? `${h} h` : `${m} min`
}

/** Value for <input type="datetime-local"> ("2026-03-08T02:30"). */
export function toDateTimeLocal(wall) {
    return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`
}

/** Parses "YYYY-MM-DDTHH:mm[:ss]" (years 1–9999) into a wall time, or null. */
export function parseDateTimeLocal(value) {
    const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/)
    if (!m) return null
    const [year, month, day, hour, minute, second = 0] = m.slice(1).map(v => Number(v ?? 0))
    if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null
    const check = new Date(utcFromFields({ year, month, day }))
    if (check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null
    return { year, month, day, hour, minute, second }
}

// Short names ("EST", "BST", "IST"): each English locale only knows the
// abbreviations used in its region, so several are asked in turn.
const ABBR_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-IN', 'en-NZ', 'en-IE']
const GMT_STYLE = /^(?:GMT|UTC)[+\-−]/
const abbrFormatters = new Map()

function shortName(locale, zone, ms, cache = true) {
    const key = `${locale}|${zone}`
    let f = cache ? abbrFormatters.get(key) : null
    if (!f) {
        f = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
        if (cache) abbrFormatters.set(key, f)
    }
    return f.formatToParts(ms).find(p => p.type === 'timeZoneName')?.value ?? ''
}

/** The zone's abbreviation at `ms` ("EDT", "BST", "IST"), or null when Intl has none. */
export function zoneAbbreviation(zone, ms) {
    for (const locale of ABBR_LOCALES) {
        const name = shortName(locale, zone, ms)
        if (name && !GMT_STYLE.test(name)) return name
    }
    return null
}

/**
 * Every abbreviation the zone uses in January and July of `year`, for the
 * search index. Formatters aren't cached here (one per zone and locale would
 * add up), so call it once per zone.
 */
export function zoneAbbreviations(zone, year) {
    const out = new Set()
    const samples = [utcFromFields({ year, month: 1, day: 15, hour: 12 }), utcFromFields({ year, month: 7, day: 15, hour: 12 })]
    for (const locale of ABBR_LOCALES) {
        const f = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
        for (const ms of samples) {
            const name = f.formatToParts(ms).find(p => p.type === 'timeZoneName')?.value ?? ''
            if (name && !GMT_STYLE.test(name)) out.add(name)
        }
    }
    return [...out]
}

// ---------------------------------------------------------------- search

/**
 * Reads an offset typed in the search box: "+5:30", "-08", "UTC+1",
 * "GMT-3:00", "+0530", "5:45". Returns milliseconds, or null.
 */
export function parseOffsetQuery(query) {
    const q = String(query ?? '').trim().replace(/−/g, '-')
    if (/^(?:utc|gmt|z)$/i.test(q)) return 0
    let m = q.match(/^(?:(?:utc|gmt)\s*)?([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i)
    if (!m) {
        const bare = q.match(/^(\d{1,2}):(\d{2})$/)
        if (!bare) return null
        m = [q, '+', bare[1], bare[2]]
    }
    const hours = Number(m[2])
    const minutes = Number(m[3] ?? 0)
    if (hours > 14 || minutes > 59) return null
    return (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes) * MINUTE
}

const fold = (s) => s.toLowerCase().replace(/_/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/**
 * Zones matching `query`: city or region names, old names ("Calcutta"),
 * abbreviations (when `abbreviations` maps zone → names) and UTC offsets at
 * `atMs`. Best matches first.
 */
export function searchZones(query, { zones = listTimeZones(), atMs = Date.now(), abbreviations = null, limit = 60 } = {}) {
    const q = fold(String(query ?? '').replace(/\s+/g, ' '))
    if (!q) return zones.slice(0, limit)
    const offset = parseOffsetQuery(query)
    const scored = []
    // Best first: the city's name, an exact abbreviation, the start of a
    // word in the zone ID, an old name, anywhere in the ID, then the offset
    for (const id of zones) {
        const city = fold(zoneCity(id))
        const full = fold(id)
        const old = oldZoneName(id)
        let score = null
        if (city === q) score = 0
        else if (city.startsWith(q)) score = 1
        else if (city.split(/[\s-]+/).some(w => w.startsWith(q))) score = 2
        else if (abbreviations?.get(id)?.some(a => a.toLowerCase() === q)) score = 3
        else if (full.startsWith(q) || full.split(/[\s/-]+/).some(w => w.startsWith(q))) score = 4
        else if (old && fold(old).includes(q)) score = 5
        else if (full.includes(q)) score = 6
        else if (offset !== null && offsetAt(id, atMs) === offset) score = 7
        if (score !== null) scored.push({ id, score, city })
    }
    scored.sort((a, b) => a.score - b.score || a.city.localeCompare(b.city) || a.id.localeCompare(b.id))
    return scored.slice(0, limit).map(s => s.id)
}

// ---------------------------------------------------------------- planner

export function hourKind(hour, minute) {
    const start = hour * 60 + minute
    if (start >= WORK_START && start + 60 <= WORK_END) return 'work'
    if (start < NIGHT_END || start >= NIGHT_START) return 'night'
    return 'off'
}

/**
 * One column per hour of `date` in `sourceZone` (23–25 of them on DST days),
 * each with the wall time in every zone of `zones`.
 *   [{ startMs, source: wall, cells: [{ zone, ...wall, kind, dayDiff, dayStart }], allWorking }]
 */
export function plannerSlots(sourceZone, date, zones) {
    const start = zonedToInstant(sourceZone, { ...date, hour: 0, minute: 0, second: 0 }).epochMs
    const end = zonedToInstant(sourceZone, { ...addDays(date, 1), hour: 0, minute: 0, second: 0 }).epochMs
    const slots = []
    for (let t = start; t < end && slots.length < 26; t += HOUR) {
        const cells = zones.map((zone) => {
            const wall = zonedParts(zone, t)
            return {
                zone,
                ...wall,
                kind: hourKind(wall.hour, wall.minute),
                dayDiff: daysBetween(date, wall),
                dayStart: wall.hour === 0,
            }
        })
        slots.push({
            startMs: t,
            source: zonedParts(sourceZone, t),
            cells,
            allWorking: cells.length > 0 && cells.every(c => c.kind === 'work'),
        })
    }
    return slots
}
