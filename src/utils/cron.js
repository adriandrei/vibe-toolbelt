// Cron expression analysis for the Cron Parser tool.
//
// cronstrue writes the English description and croner finds the run times.
// The two libraries read 6-field expressions differently, so the fields are
// split here once (the way cronstrue reads them) and croner always gets an
// explicit 7-field pattern: second minute hour day-of-month month day-of-week year.
import cronstrue from 'cronstrue'
import { Cron } from 'croner'

export const CRON_MACROS = {
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *',
    '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *',
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH_ALIASES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAY_ALIASES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export const CRON_FIELDS = {
    second: { label: 'Second', allowed: '0–59', min: 0, max: 59, unit: 'second' },
    minute: { label: 'Minute', allowed: '0–59', min: 0, max: 59, unit: 'minute' },
    hour: { label: 'Hour', allowed: '0–23', min: 0, max: 23, unit: 'hour' },
    dom: { label: 'Day of month', allowed: '1–31, L, W', min: 1, max: 31, unit: 'day' },
    month: { label: 'Month', allowed: '1–12, JAN–DEC', min: 1, max: 12, unit: 'month' },
    dow: { label: 'Day of week', allowed: '0–7 (0 or 7 = Sun), SUN–SAT, L, #', min: 0, max: 7, unit: 'day' },
    year: { label: 'Year', allowed: 'e.g. 2027, 2027-2030', min: 1, max: 9999, unit: 'year' },
}

export const LAYOUT_NOTES = {
    5: 'Standard cron: minute, hour, day of month, month, day of week.',
    '6-seconds': '6 fields, read with seconds first (as Quartz, Spring and croner do): second, minute, hour, day of month, month, day of week.',
    '6-year': '6 fields, read with the year last because the last field is a 4-digit year or “?” is used: minute, hour, day of month, month, day of week, year.',
    7: '7 fields: second, minute, hour, day of month, month, day of week, year.',
}

function cleanError(error) {
    const text = String(error?.message ?? error ?? 'Invalid expression')
        .replace(/^Error:\s*/i, '')
        .replace(/^CronPattern:\s*/i, '')
        .trim()
    return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Splits an expression into named fields.
 *   { status: 'empty' }
 *   { status: 'error', message }
 *   { status: 'ok', text, macro?, reboot?, layout, fields: [{ name, value }] }
 */
export function splitCron(expression) {
    const text = String(expression ?? '').trim().replace(/\s+/g, ' ')
    if (!text) return { status: 'empty' }

    if (text.startsWith('@')) {
        const key = text.toLowerCase()
        if (key === '@reboot') return { status: 'ok', text, macro: key, reboot: true, layout: null, fields: [] }
        const expansion = CRON_MACROS[key]
        if (!expansion) {
            return { status: 'error', message: `Unknown shortcut “${text}”. Use @yearly, @monthly, @weekly, @daily, @hourly or @reboot.` }
        }
        return { ...splitCron(expansion), text, macro: key, expansion }
    }

    const parts = text.split(' ')
    let names
    let layout
    if (parts.length === 5) {
        names = ['minute', 'hour', 'dom', 'month', 'dow']
        layout = 5
    } else if (parts.length === 6) {
        // Same rule as cronstrue
        const yearLast = /\d{4}$/.test(parts[5]) || parts[4] === '?' || parts[2] === '?'
        names = yearLast ? ['minute', 'hour', 'dom', 'month', 'dow', 'year'] : ['second', 'minute', 'hour', 'dom', 'month', 'dow']
        layout = yearLast ? '6-year' : '6-seconds'
    } else if (parts.length === 7) {
        names = ['second', 'minute', 'hour', 'dom', 'month', 'dow', 'year']
        layout = 7
    } else {
        return {
            status: 'error',
            message: parts.length < 5
                ? `Expression has only ${parts.length} part${parts.length === 1 ? '' : 's'}. At least 5 are required.`
                : `Expression has ${parts.length} parts; at most 7 are allowed.`,
        }
    }
    return { status: 'ok', text, layout, fields: names.map((name, i) => ({ name, value: parts[i] })) }
}

function fieldValue(split, name, fallback) {
    return split.fields.find(f => f.name === name)?.value ?? fallback
}

// croner treats "?" as a full wildcard without the "unrestricted" flag, which
// turns day-of-month/day-of-week into an OR of every day. Pass "*" instead.
function toCronerPattern(split) {
    const get = (name, fallback) => fieldValue(split, name, fallback).replace(/\?/g, '*')
    // A lone "L" in day of week means Saturday (the last day of the week)
    const dow = get('dow', '*').toUpperCase() === 'L' ? '6' : get('dow', '*')
    return [get('second', '0'), get('minute', '0'), get('hour', '0'), get('dom', '*'), get('month', '*'), dow, get('year', '*')].join(' ')
}

const isUnrestricted = (value) => value === '*' || value === '?'

// Expands a simple field (numbers, names, ranges, steps, lists) to a set of
// values; returns null when it uses L, W, # or anything else special.
function expandField(value, min, max, aliases) {
    const set = new Set()
    const toNumber = (token) => {
        const upper = token.toUpperCase()
        const alias = aliases ? aliases.indexOf(upper) : -1
        if (alias >= 0) return alias + (min === 1 ? 1 : 0)
        return /^\d+$/.test(token) ? Number(token) : NaN
    }
    for (const part of value.split(',')) {
        const [range, stepText] = part.split('/')
        const step = stepText === undefined ? 1 : Number(stepText)
        if (!Number.isInteger(step) || step < 1) return null
        let from
        let to
        if (range === '*' || range === '?') {
            from = min
            to = max
        } else if (range.includes('-')) {
            const [a, b] = range.split('-')
            from = toNumber(a)
            to = toNumber(b)
        } else {
            from = toNumber(range)
            to = stepText === undefined ? from : max
        }
        if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return null
        for (let v = from; v <= to; v += step) set.add(v)
    }
    return set
}

const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

// Detects schedules that can never fire, without asking croner (which can
// overflow its stack searching for e.g. "31st of April/June/Sept/Nov").
function impossibleSchedule(split, currentYear) {
    const dom = fieldValue(split, 'dom', '*')
    const month = fieldValue(split, 'month', '*')
    const dow = fieldValue(split, 'dow', '*')
    const year = fieldValue(split, 'year', '*')

    const years = isUnrestricted(year) ? null : expandField(year, 1, 9999, null)
    if (years && years.size && Math.max(...years) < currentYear) return 'past'
    // With a restricted day of week, standard cron fires when either day field matches
    if (!isUnrestricted(dow) || isUnrestricted(dom)) return null
    const days = expandField(dom, 1, 31, null)
    const months = expandField(month, 1, 12, MONTH_ALIASES)
    if (!days || !months || !days.size || !months.size) return null
    const leapPossible = !years || [...years].some(isLeap)
    for (const m of months) {
        const limit = m === 2 && !leapPossible ? 28 : DAYS_IN_MONTH[m - 1]
        for (const d of days) if (d <= limit) return null
    }
    return 'never'
}

function hasZeroStep(split) {
    return split.fields.some(f => /\/0+(?!\d)/.test(f.value))
}

/**
 * Full analysis of an expression.
 *
 *   { status: 'empty' }
 *   { status: 'error', message }
 *   { status: 'ok', split, description, warnings: [{ tone, text }], runs: Date[] | null, runsNote }
 */
export function analyzeCron(expression, { use24Hour = false, timezone = 'local', count = 10, from = new Date() } = {}) {
    const split = splitCron(expression)
    if (split.status !== 'ok') return split

    let description
    try {
        description = cronstrue.toString(split.text, { throwExceptionOnParseError: true, use24HourTimeFormat: use24Hour, verbose: false })
    } catch (error) {
        return { status: 'error', message: cleanError(error) }
    }

    if (hasZeroStep(split)) {
        return { status: 'error', message: 'A step of 0 (as in “*/0”) is invalid: the schedule would never advance. Use a step of 1 or more.' }
    }

    const warnings = []
    if (split.reboot) {
        return {
            status: 'ok',
            split,
            description,
            warnings: [{ tone: 'info', text: '@reboot runs once when the cron daemon starts, so it has no upcoming times.' }],
            runs: null,
        }
    }

    const dom = fieldValue(split, 'dom', '*')
    const dow = fieldValue(split, 'dow', '*')
    if (!isUnrestricted(dom) && !isUnrestricted(dow)) {
        warnings.push({ tone: 'info', text: 'Both day of month and day of week are set, so standard cron runs on days matching either one (not both).' })
    }

    const zone = timezone === 'utc' ? 'Etc/UTC' : undefined
    const currentYear = timezone === 'utc' ? from.getUTCFullYear() : from.getFullYear()
    const impossible = impossibleSchedule(split, currentYear)
    if (impossible === 'past') {
        warnings.push({ tone: 'warning', text: 'This schedule only matches years that have already passed, so it will never run again.' })
        return { status: 'ok', split, description, warnings, runs: [] }
    }
    if (impossible === 'never') {
        warnings.push({ tone: 'warning', text: 'This schedule never fires: the chosen months never have that day (like February 30, April 31, or February 29 outside leap years).' })
        return { status: 'ok', split, description, warnings, runs: [] }
    }

    let runs = null
    let runsNote
    try {
        const job = new Cron(toCronerPattern(split), { timezone: zone, sloppyRanges: true })
        runs = job.nextRuns(count, from)
        if (runs.length === 0) {
            warnings.push({ tone: 'warning', text: 'This schedule has no upcoming runs: no future date matches it.' })
        }
    } catch (error) {
        runs = null
        runsNote = error instanceof RangeError
            ? 'Upcoming runs couldn’t be calculated for this expression.'
            : `Upcoming runs couldn’t be calculated: ${cleanError(error)}`
    }
    return { status: 'ok', split, description, warnings, runs, runsNote }
}

// ---------- Field-by-field explanation ----------

const ordinal = (n) => {
    const v = n % 100
    const suffix = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
    return `${n}${suffix}`
}

function joinList(items) {
    if (items.length <= 1) return items.join('')
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function valueName(name, token, use24Hour) {
    const upper = token.toUpperCase()
    if (name === 'month') {
        const alias = MONTH_ALIASES.indexOf(upper)
        const n = alias >= 0 ? alias + 1 : Number(token)
        return MONTH_NAMES[n - 1] ?? token
    }
    if (name === 'dow') {
        const alias = DAY_ALIASES.indexOf(upper)
        const n = alias >= 0 ? alias : Number(token)
        return DAY_NAMES[n] ?? token
    }
    if (name === 'hour' && /^\d+$/.test(token)) {
        const h = Number(token)
        if (use24Hour || h > 23) return String(h).padStart(2, '0')
        return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
    }
    return token
}

function describePart(name, part, use24Hour) {
    const def = CRON_FIELDS[name]
    const upper = part.toUpperCase()
    const label = (token) => valueName(name, token, use24Hour)

    if (part === '*') return null
    if (part === '?') return 'any (no specific value)'
    if (name === 'dom') {
        if (upper === 'L') return 'the last day of the month'
        if (upper === 'LW') return 'the last weekday of the month'
        let m = /^L-(\d+)$/.exec(upper)
        if (m) return `${m[1]} day${m[1] === '1' ? '' : 's'} before the last day of the month`
        m = /^(\d+)W$/.exec(upper)
        if (m) return `the weekday nearest day ${m[1]}`
    }
    if (name === 'dow') {
        if (upper === 'L') return 'Saturday (the last day of the week)'
        let m = /^(\w+)L$/.exec(upper)
        if (m) return `the last ${label(m[1])} of the month`
        m = /^(\w+)#(\d)$/.exec(upper)
        if (m) return `the ${ordinal(Number(m[2]))} ${label(m[1])} of the month`
    }
    const [range, step] = part.split('/')
    if (step !== undefined) {
        const every = Number(step) === 1 ? `every ${def.unit}` : `every ${ordinal(Number(step))} ${def.unit}`
        if (range === '*' || range === '?') return every
        if (range.includes('-')) {
            const [a, b] = range.split('-')
            return `${every} from ${label(a)} through ${label(b)}`
        }
        return `${every} starting at ${label(range)}`
    }
    if (range.includes('-')) {
        const [a, b] = range.split('-')
        return `${label(a)} through ${label(b)}`
    }
    return label(range)
}

const EVERY = { second: 'Every second', minute: 'Every minute', hour: 'Every hour', dom: 'Every day', month: 'Every month', dow: 'Any day of the week', year: 'Every year' }
const PREFIX = { second: 'At second', minute: 'At minute', hour: 'During hour', dom: 'On day', month: 'In', dow: 'On', year: 'In' }

// One-line meaning of a single field, e.g. ('dow', '1-5') -> "Monday through Friday"
export function describeField(name, value, { use24Hour = false } = {}) {
    if (value === '*') return EVERY[name]
    const parts = value.split(',').map(part => describePart(name, part, use24Hour)).filter(Boolean)
    if (!parts.length) return EVERY[name]
    const simple = value.split(',').every(p => /^[\w]+(-[\w]+)?$/.test(p) && !/^(L|LW|\d+W|\w+L|\w+#\d)$/i.test(p))
    const text = joinList(parts)
    if (simple && PREFIX[name]) {
        if (name === 'hour') return `${PREFIX[name]}${parts.length > 1 || /through/.test(text) ? 's' : ''} ${text}`
        if (name === 'dom') return `On day${parts.length > 1 || /through/.test(text) ? 's' : ''} ${text}`
        if (name === 'second' || name === 'minute') return `${PREFIX[name]}${parts.length > 1 || /through/.test(text) ? 's' : ''} ${text}`
        return `${PREFIX[name]} ${text}`
    }
    return text.charAt(0).toUpperCase() + text.slice(1)
}
