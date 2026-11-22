// Runs recipes and validates them when they come from storage or a link.
//
// A recipe is a list of steps { op, options, enabled }. Each step's input is
// converted to what its operation takes (text ↔ UTF-8 bytes); the first
// failing step stops the chain, and the error names the step:
// "Step 3 · Gunzip: the input isn’t gzip data …".
import { RecipeError, changedOptions, getOperation, normalizeOptions } from './operations.js'
import { coerce, describeOutput, describeValue } from './values.js'

export const MAX_STEPS = 100
export const MAX_SAVED = 200
export const MAX_NAME_LENGTH = 80

// Step and recipe ids
const ID = /^[\w-]{1,48}$/

const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

function errorMessage(error) {
    if (error instanceof RecipeError) return error.message
    if (error instanceof RangeError) {
        return /call stack/i.test(error.message)
            ? 'the data is nested too deeply to process'
            : 'the result is too large to hold in memory'
    }
    const message = error?.message || String(error || '')
    return message ? lowerFirst(message.replace(/\.$/, '')) : 'the operation failed'
}

/**
 * Runs `steps` on `input` (a string or a Uint8Array).
 *
 * Returns { value, trail, error }:
 *   value  the final value, or null when a step failed
 *   trail  one entry per step:
 *          { status: 'ok', ms, notes, kind, …size } after it ran,
 *          { status: 'skipped' } when disabled, { status: 'error', ms, notes },
 *          { status: 'not-run' } after an error
 *   error  { index, op, name, message, text } for the failing step, or null
 *
 * onStep(index) is called before each step runs; now() is the clock JWT
 * expiry checks use.
 */
export async function runRecipe(input, steps, { onStep, now = () => Date.now() } = {}) {
    let value = input
    const trail = []
    let error = null
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        if (error) {
            trail.push({ status: 'not-run' })
            continue
        }
        if (!step.enabled) {
            trail.push({ status: 'skipped' })
            continue
        }
        const op = getOperation(step.op)
        const notes = []
        const ctx = {
            info: (text) => notes.push({ tone: 'info', text: String(text) }),
            warn: (text) => notes.push({ tone: 'warning', text: String(text) }),
            now,
        }
        onStep?.(i)
        const started = performance.now()
        try {
            if (!op) throw new RecipeError(`“${step.op}” isn’t a known operation`)
            const out = await op.run(coerce(value, op.input), step.options, ctx)
            if (typeof out !== 'string' && !(out instanceof Uint8Array)) throw new Error('The operation returned nothing')
            value = out
            trail.push({ status: 'ok', ms: performance.now() - started, notes, ...describeValue(value) })
        } catch (caught) {
            const name = op?.name ?? step.op
            const message = errorMessage(caught)
            error = { index: i, op: step.op, name, message, text: `Step ${i + 1} · ${name}: ${message}` }
            trail.push({ status: 'error', ms: performance.now() - started, notes })
        }
    }
    return { value: error ? null : value, trail, error }
}

/**
 * Runs a recipe request from the page: { input: { kind: 'text', text } |
 * { kind: 'file', file } | { kind: 'bytes', bytes }, steps }. Returns what the
 * page shows: { input: { kind, chars, bytes }, trail, error, output } (see
 * describeOutput). Used by the worker and, if workers fail, on the page.
 */
export async function executeRecipe({ input, steps }, { onStep } = {}) {
    let value = typeof input?.text === 'string' ? input.text : ''
    if (input?.kind === 'file') value = new Uint8Array(await input.file.arrayBuffer())
    else if (input?.kind === 'bytes') value = input.bytes
    const { kind, chars, bytes } = describeValue(value)
    const run = await runRecipe(value, steps, { onStep })
    return { input: { kind, chars, bytes }, trail: run.trail, error: run.error, output: run.error ? null : describeOutput(run.value) }
}

/**
 * Checks steps read from storage or a shared link. Steps with unknown
 * operations are skipped (and listed in `unknown`), invalid options are reset
 * to their defaults (counted in `reset`), malformed entries are dropped
 * (counted in `invalid`).
 */
export function parseSteps(raw, { max = MAX_STEPS, keepUid = false } = {}) {
    const result = { steps: [], unknown: [], reset: 0, invalid: 0, truncated: false }
    if (raw === undefined || raw === null) return result
    if (!Array.isArray(raw)) {
        result.invalid = 1
        return result
    }
    if (raw.length > max) result.truncated = true
    for (const item of raw.slice(0, max)) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.op !== 'string') {
            result.invalid++
            continue
        }
        const op = getOperation(item.op)
        if (!op) {
            const id = item.op.slice(0, 40)
            if (!result.unknown.includes(id)) result.unknown.push(id)
            continue
        }
        const { options, invalid } = normalizeOptions(op, item.options)
        let enabled = true
        if (item.enabled !== undefined) {
            if (typeof item.enabled === 'boolean') enabled = item.enabled
            else result.reset++
        }
        if (item.options !== undefined && (typeof item.options !== 'object' || item.options === null || Array.isArray(item.options))) result.reset++
        result.reset += invalid.length
        const step = { op: op.id, options, enabled }
        if (keepUid && typeof item.uid === 'string' && ID.test(item.uid)) step.uid = item.uid
        result.steps.push(step)
    }
    return result
}

/** Compact form for storage and links: default options and `enabled: true` are left out. */
export function serializeSteps(steps) {
    return steps.map((step) => {
        const op = getOperation(step.op)
        const out = { op: step.op }
        const options = op ? changedOptions(op, step.options) : {}
        if (Object.keys(options).length) out.options = options
        if (!step.enabled) out.enabled = false
        return out
    })
}

/** A sentence about what parseSteps had to drop or fix, or null when nothing. */
export function describeParseProblems({ unknown, reset, invalid, truncated }) {
    const parts = []
    if (unknown.length) {
        parts.push(`Skipped ${unknown.length === 1 ? 'a step' : `${unknown.length} steps`} with an unknown operation (${unknown.map((id) => `“${id}”`).join(', ')})`)
    }
    if (invalid) parts.push(`skipped ${invalid === 1 ? 'a malformed step' : `${invalid} malformed steps`}`)
    if (reset) parts.push(`reset ${reset === 1 ? 'an invalid option' : `${reset} invalid options`} to the default`)
    if (truncated) parts.push(`kept only the first ${MAX_STEPS} steps`)
    if (!parts.length) return null
    const text = parts.join('; ')
    return `${text[0].toUpperCase()}${text.slice(1)}.`
}

export const newRecipeId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** Cleans up a recipe name: one line, trimmed, at most MAX_NAME_LENGTH characters. */
export const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)

/**
 * Validates the saved-recipes list from localStorage. Entries without a name
 * or without any usable step are dropped; missing or repeated ids are
 * replaced (deterministically, so parsing twice gives the same ids).
 * Returns [{ id, name, steps, savedAt, unknown }].
 */
export function parseSavedRecipes(raw) {
    if (!Array.isArray(raw)) return []
    const out = []
    const ids = new Set()
    raw.slice(0, MAX_SAVED).forEach((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return
        const name = cleanName(typeof item.name === 'string' ? item.name : '')
        if (!name) return
        const parsed = parseSteps(item.steps)
        if (!parsed.steps.length) return
        let id = typeof item.id === 'string' && ID.test(item.id) ? item.id : `saved-${index}`
        while (ids.has(id)) id = `${id}-${index}`
        ids.add(id)
        const savedAt = typeof item.savedAt === 'number' && Number.isFinite(item.savedAt) ? item.savedAt : 0
        out.push({ id, name, steps: parsed.steps, savedAt, unknown: parsed.unknown })
    })
    return out
}

/** The stored form of a saved recipe. */
export const serializeSaved = (recipe) => ({ id: recipe.id, name: recipe.name, steps: serializeSteps(recipe.steps), savedAt: recipe.savedAt })

export const MAX_SHARED_INPUT = 1_000_000

/**
 * Validates the state of a shared link: { steps, input? }.
 * Returns { steps, input (string or null), problems (sentence or null) } or
 * throws when it isn't a recipe at all.
 */
export function parseSharedState(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.steps)) {
        throw new RecipeError('This link doesn’t contain a recipe.')
    }
    const parsed = parseSteps(data.steps)
    let input = null
    const extra = []
    if (data.input !== undefined) {
        if (typeof data.input === 'string' && data.input.length <= MAX_SHARED_INPUT) input = data.input
        else extra.push('the input in the link was invalid and was left out')
    }
    let problems = describeParseProblems(parsed)
    if (extra.length) problems = problems ? `${problems.replace(/\.$/, '')}; ${extra.join('; ')}.` : `${extra[0][0].toUpperCase()}${extra[0].slice(1)}.`
    return { steps: parsed.steps, input, problems, name: cleanName(typeof data.name === 'string' ? data.name : '') }
}
