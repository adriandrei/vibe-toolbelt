// Checking the data of a shared link (utils/share.js, useSharedState) before a
// tool applies it. Links can be edited by hand, so every field is validated
// and invalid ones are skipped, keeping what the tool already shows.
//
//   useSharedState((data) => {
//       const { values, ignored } = readSharedFields(data, {
//           pattern: field.string(),
//           mode: field.oneOf(['match', 'replace']),
//       })
//       if ('pattern' in values) setPattern(values.pattern)
//       …
//   })
import { ShareError } from './share'

// Upper bound for text fields: far above anything a real link carries (links
// are capped at 32k characters of compressed data), but it stops absurd
// hand-made ones from freezing the page.
export const MAX_SHARED_TEXT = 5_000_000

const INVALID = Symbol('invalid')

export const field = {
    /** A string of at most `max` characters, optionally matching `pattern`. */
    string: ({ max = MAX_SHARED_TEXT, pattern } = {}) => (value) =>
        (typeof value === 'string' && value.length <= max && (!pattern || pattern.test(value)) ? value : INVALID),
    boolean: () => (value) => (typeof value === 'boolean' ? value : INVALID),
    /** One of the listed values (compared with ===). */
    oneOf: (allowed) => (value) => (allowed.includes(value) ? value : INVALID),
}

/**
 * The fields of `data` that `spec` (name → check from `field`) accepts.
 * Returns { values, ignored }: `ignored` names the fields that were present
 * but invalid. Unknown fields are skipped silently (a newer version may add
 * some). Throws a ShareError when nothing usable is left, so the link is
 * reported as unusable instead of "opened" with nothing changed.
 */
export function readSharedFields(data, spec) {
    const values = {}
    const ignored = []
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
        for (const [name, check] of Object.entries(spec)) {
            if (!Object.hasOwn(data, name)) continue
            const value = check(data[name])
            if (value === INVALID) ignored.push(name)
            else values[name] = value
        }
    }
    if (Object.keys(values).length === 0) throw new ShareError('It doesn’t contain anything this tool can use.')
    return { values, ignored }
}

/** Toast text for fields that were skipped. */
export function ignoredFieldsMessage(ignored) {
    return `Some values in the link weren’t valid, so they were left as they were: ${ignored.join(', ')}.`
}
