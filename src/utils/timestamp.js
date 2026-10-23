// Unix timestamp parsing and formatting (used by the Unix Timestamp tool).
//
// Instants are kept as BigInt nanoseconds so 16- and 19-digit timestamps
// (microseconds, nanoseconds) convert without losing precision; a JS Date
// (millisecond precision) is only used for calendar formatting.

export const TIME_UNITS = ['s', 'ms', 'us', 'ns']

export const UNIT_INFO = {
    s: { short: 's', label: 'seconds' },
    ms: { short: 'ms', label: 'milliseconds' },
    us: { short: 'µs', label: 'microseconds' },
    ns: { short: 'ns', label: 'nanoseconds' },
}

const NS_PER = { s: 1_000_000_000n, ms: 1_000_000n, us: 1_000n, ns: 1n }
const FRACTION_DIGITS = { s: 9, ms: 6, us: 3, ns: 0 }

// A JS Date holds at most ±8.64e15 ms (±100,000,000 days) around 1970.
const MAX_DATE_MS = 8_640_000_000_000_000n

const NUMBER_RE = /^([+-])?(\d+)(?:\.(\d*))?$/
const EXPLICIT_ZONE_RE = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:UTC|GMT|[ECMP][SD]T)\b)\s*$/i
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

function floorDiv(a, b) {
    const q = a / b
    return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q
}

function floorMod(a, b) {
    return a - floorDiv(a, b) * b
}

// Unit implied by the number of digits in the integer part:
// up to 10 = seconds, 11–13 = ms, 14–16 = µs, 17+ = ns.
export function detectUnit(intDigits) {
    const n = String(intDigits).replace(/^0+(?=\d)/, '').length
    if (n <= 10) return 's'
    if (n <= 13) return 'ms'
    if (n <= 16) return 'us'
    return 'ns'
}

/**
 * Parses what the user typed: a number (optionally negative or fractional,
 * with `_` or spaces as digit separators) or a date string.
 *
 *   { status: 'empty' }
 *   { status: 'error', message, source?, unit?, autoUnit?, manual?, digits? }
 *   { status: 'ok', source: 'number', ns, ms, date, unit, autoUnit, manual, digits, truncated }
 *   { status: 'ok', source: 'date', ns, ms, date, zone: 'utc-date-only' | 'explicit' | 'local' }
 */
export function parseTimestamp(raw, unitChoice = 'auto') {
    const text = String(raw ?? '').trim()
    if (!text) return { status: 'empty' }

    const compact = text.replace(/[\s_]/g, '')
    const match = NUMBER_RE.exec(compact)
    if (match) {
        const [, sign, intPart, fracPart = ''] = match
        const autoUnit = detectUnit(intPart)
        const manual = TIME_UNITS.includes(unitChoice)
        const unit = manual ? unitChoice : autoUnit
        const fracDigits = FRACTION_DIGITS[unit]
        let ns = BigInt(intPart) * NS_PER[unit]
        if (fracDigits > 0 && fracPart) ns += BigInt(fracPart.slice(0, fracDigits).padEnd(fracDigits, '0'))
        if (sign === '-') ns = -ns
        const truncated = fracPart.replace(/0+$/, '').length > fracDigits
        const msBig = floorDiv(ns, 1_000_000n)
        const base = { source: 'number', unit, autoUnit, manual, digits: intPart.replace(/^0+(?=\d)/, '').length }
        if (msBig > MAX_DATE_MS || msBig < -MAX_DATE_MS) {
            return {
                status: 'error',
                ...base,
                message: `Read as ${UNIT_INFO[unit].label}, this is outside the range a date can represent (about 273,000 years either side of 1970).`,
            }
        }
        const ms = Number(msBig)
        return { status: 'ok', ...base, ns, ms, date: new Date(ms), truncated }
    }

    const parsed = Date.parse(text)
    if (Number.isNaN(parsed)) {
        return {
            status: 'error',
            message: 'This isn’t a number or a date this browser can read. Try 1700000000, 1700000000000 or 2024-05-01T12:00:00Z.',
        }
    }
    const zone = DATE_ONLY_RE.test(text) ? 'utc-date-only' : EXPLICIT_ZONE_RE.test(text) ? 'explicit' : 'local'
    return { status: 'ok', source: 'date', ns: BigInt(parsed) * 1_000_000n, ms: parsed, date: new Date(parsed), zone }
}

export function nsFromMs(ms) {
    return BigInt(Math.trunc(ms)) * 1_000_000n
}

// Exact decimal of `ns` nanoseconds in `unit`: (1500000000n, 's') -> "1.5"
export function formatInUnit(ns, unit) {
    const per = NS_PER[unit]
    const negative = ns < 0n
    const abs = negative ? -ns : ns
    let text = (abs / per).toString()
    const frac = abs % per
    if (frac !== 0n) text += `.${frac.toString().padStart(FRACTION_DIGITS[unit], '0').replace(/0+$/, '')}`
    return negative ? `-${text}` : text
}

// Whole seconds (rounded down), as shown in the big counter.
export function wholeSeconds(ns) {
    return floorDiv(ns, NS_PER.s).toString()
}

// ISO 8601 in UTC, keeping sub-millisecond digits when there are any.
export function toIsoString(date, ns) {
    const iso = date.toISOString()
    if (ns === undefined || floorMod(ns, 1_000_000n) === 0n) return iso
    const fraction = floorMod(ns, NS_PER.s).toString().padStart(9, '0').replace(/0+$/, '')
    return iso.replace(/\.\d{3}Z$/, `.${fraction}Z`)
}

const LOCAL_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' })
const UTC_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long', timeZone: 'UTC' })
// dateStyle can't show the era, so years before 1 AD use explicit fields
const ERA_OPTIONS = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', era: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }
const LOCAL_ERA_FORMAT = new Intl.DateTimeFormat(undefined, ERA_OPTIONS)
const UTC_ERA_FORMAT = new Intl.DateTimeFormat(undefined, { ...ERA_OPTIONS, timeZone: 'UTC' })

export function formatLocal(date) {
    return (date.getFullYear() < 1 ? LOCAL_ERA_FORMAT : LOCAL_FORMAT).format(date)
}

export function formatUtc(date) {
    return (date.getUTCFullYear() < 1 ? UTC_ERA_FORMAT : UTC_FORMAT).format(date)
}

export const LOCAL_TIME_ZONE = (() => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'
    } catch {
        return 'Local time'
    }
})()

// "UTC+3", "UTC+05:30", "UTC−8": the local offset at `date`.
export function formatUtcOffset(date) {
    const minutes = -date.getTimezoneOffset()
    if (!Number.isFinite(minutes)) return ''
    if (minutes === 0) return 'UTC'
    const sign = minutes > 0 ? '+' : '−'
    const abs = Math.abs(minutes)
    const h = Math.floor(abs / 60)
    const m = abs % 60
    return `UTC${sign}${m ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : h}`
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const DAY = 86_400_000
const RELATIVE_STEPS = [
    ['year', 365.2425 * DAY],
    ['month', 30.436875 * DAY],
    ['week', 7 * DAY],
    ['day', DAY],
    ['hour', 3_600_000],
    ['minute', 60_000],
    ['second', 1000],
]

// "in 3 days", "2 years ago", "now"
export function formatRelativeTo(ms, nowMs) {
    const diff = ms - nowMs
    const abs = Math.abs(diff)
    for (const [unit, size] of RELATIVE_STEPS) {
        if (abs >= size || unit === 'second') return RELATIVE.format(Math.round(diff / size), unit)
    }
    return ''
}

// Value for <input type="datetime-local" step="1"> in local time, or '' when
// the picker can't show that year.
export function toDateTimeLocalValue(date) {
    const year = date.getFullYear()
    if (!Number.isFinite(year) || year < 1 || year > 9999) return ''
    const pad = (n, len = 2) => String(n).padStart(len, '0')
    return `${pad(year, 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
