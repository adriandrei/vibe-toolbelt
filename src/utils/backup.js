// Backup, restore and clear for everything the app keeps in localStorage.
//
// A backup is a JSON file:
//   { app: 'vibe-toolbelt', version: 1, exportedAt: ISO date, entries: { key: rawStringValue } }
// Values are the exact strings found in storage (some keys hold JSON, others
// plain text such as pt-theme = "dark"), so restoring writes them back as is.
//
// Every key of the site is backed up, not a fixed list, so data added by new
// tools is included without changes here. The groups below only decide how
// keys are labelled on screen; unknown keys show up under "Other".

export const BACKUP_APP = 'vibe-toolbelt'
export const BACKUP_VERSION = 1

// Browsers give a site about 5 million characters of localStorage, so a real
// backup is far below these limits.
export const MAX_BACKUP_FILE_BYTES = 20 * 1024 * 1024
export const MAX_BACKUP_ENTRIES = 1000
export const MAX_BACKUP_CHARS = 10_000_000

// API Tester data that can hold tokens, passwords and API keys. History drops
// them unless "Keep secrets in history" is on; saved requests and environments
// always keep what was entered. Left out of backups unless asked for.
export const SENSITIVE_KEYS = ['api-history', 'api-collections', 'api-envs']

// WebLLM keeps downloaded model files in Cache Storage under "webllm/model",
// "webllm/config" and "webllm/wasm" (@mlc-ai/web-llm with its default
// cacheBackend "cache"). The app's own offline caches have other names.
export const MODEL_CACHE_PREFIX = 'webllm/'

export function isModelCache(name) {
    return typeof name === 'string' && name.startsWith(MODEL_CACHE_PREFIX)
}

// sessionStorage: what to announce after the page reloads (restore or clear)
export const DATA_NOTICE_KEY = 'pt-data-notice'

// The app names its keys with letters, digits, "-", "_" and "." (pt-theme,
// ai_model, vt-formatters-prefs…). Anything else isn't the app's.
const APP_KEY = /^[A-Za-z][A-Za-z0-9._-]{0,99}$/

export function isAppKey(key) {
    return typeof key === 'string' && APP_KEY.test(key)
}

export class BackupError extends Error {}

// ---------------------------------------------------------------- groups

export const STORAGE_GROUPS = [
    { id: 'appearance', label: 'Appearance', keys: ['pt-theme', 'pt-hue', 'pt-sidebar-collapsed', 'pt-pinned-tool'] },
    { id: 'favourites', label: 'Favourites & recents', prefixes: ['vibe-tools-'] },
    { id: 'api', label: 'API Tester', prefixes: ['api-'] },
    { id: 'formatters', label: 'Formatters', prefixes: ['vt-formatters-'] },
    { id: 'ai', label: 'AI assistant', keys: ['ai_model'], prefixes: ['ai-', 'ai_'] },
    { id: 'tools', label: 'Other tools', prefixes: ['curl-', 'pwgen-', 'jwt-builder-', 'tz-', 'recipes-'] },
    { id: 'other', label: 'Other' },
]

const KEY_LABELS = {
    'pt-theme': 'Theme',
    'pt-hue': 'Accent colour',
    'pt-sidebar-collapsed': 'Collapsed sidebar groups',
    'pt-pinned-tool': 'Tool pinned in split view',
    'vibe-tools-favorites': 'Favourite tools',
    'vibe-tools-recents': 'Recently used tools',
    'api-history': 'History',
    'api-history-secrets': '“Keep secrets in history” setting',
    'api-collections': 'Saved requests',
    'api-envs': 'Environments',
    'api-active-env': 'Selected environment',
    'api-code-target': 'Language for generated code',
    'api-protocol': 'Protocol (HTTP, WebSocket or SSE)',
    'api-ws-url': 'Last WebSocket URL',
    'api-sse-url': 'Last event stream URL',
    'vt-formatters-prefs': 'Formatting options',
    ai_model: 'Chosen model',
    'curl-target': 'cURL Converter language',
    'pwgen-options': 'Password Generator options',
    'jwt-builder-alg': 'JWT Builder algorithm',
    'tz-zones': 'Time Zones list',
    'tz-hour-cycle': 'Time Zones 12- or 24-hour clock',
    'recipes-saved': 'Saved recipes',
    'recipes-current': 'Current recipe',
}

/** The id of the display group a key belongs to. */
export function groupOf(key) {
    const group = STORAGE_GROUPS.find(g => g.keys?.includes(key))
        ?? STORAGE_GROUPS.find(g => g.prefixes?.some(prefix => key.startsWith(prefix)))
    return group ? group.id : 'other'
}

/** A readable name for a key (the key itself when it isn't a known one). */
export function labelOf(key) {
    return Object.hasOwn(KEY_LABELS, key) ? KEY_LABELS[key] : key
}

/** Keys sorted into display groups, in group order; empty groups are left out. */
export function groupKeys(keys) {
    const groups = STORAGE_GROUPS.map(g => ({ id: g.id, label: g.label, keys: [] }))
    for (const key of keys) groups.find(g => g.id === groupOf(key)).keys.push(key)
    for (const group of groups) group.keys.sort()
    return groups.filter(g => g.keys.length > 0)
}

// ---------------------------------------------------------------- reading

/** Every key and value of a Storage (localStorage, sessionStorage or a stand-in). */
export function readEntries(storage) {
    const entries = Object.create(null)
    if (!storage) return entries
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key === null) continue
        const value = storage.getItem(key)
        if (value !== null) entries[key] = value
    }
    return entries
}

/** UTF-8 size of keys and values, about what they take in a backup file. */
export function entriesSize(entries, keys = Object.keys(entries)) {
    const encoder = new TextEncoder()
    let bytes = 0
    for (const key of keys) bytes += encoder.encode(key).length + encoder.encode(entries[key] ?? '').length
    return bytes
}

// ---------------------------------------------------------------- export

/**
 * The backup of `entries`. Sensitive API Tester keys are left out unless
 * `includeSensitive`; keys that don't look like the app's are skipped.
 * Returns { backup, omitted, skipped } (omitted/skipped: the keys left out).
 */
export function buildBackup(entries, { includeSensitive = false, date = new Date() } = {}) {
    const kept = Object.create(null)
    const omitted = []
    const skipped = []
    for (const key of Object.keys(entries).sort()) {
        const value = entries[key]
        if (typeof value !== 'string') continue
        if (!isAppKey(key)) skipped.push(key)
        else if (!includeSensitive && SENSITIVE_KEYS.includes(key)) omitted.push(key)
        else kept[key] = value
    }
    return {
        backup: { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: date.toISOString(), entries: kept },
        omitted,
        skipped,
    }
}

export function serializeBackup(backup) {
    return `${JSON.stringify(backup, null, 2)}\n`
}

const pad = (n) => String(n).padStart(2, '0')

/** vibe-toolbelt-backup-YYYY-MM-DD.json, with the local date. */
export function backupFileName(date = new Date()) {
    return `${BACKUP_APP}-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

// ---------------------------------------------------------------- import

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function listKeys(keys) {
    const shown = keys.slice(0, 3).map(k => `“${k.length > 40 ? `${k.slice(0, 40)}…` : k}”`).join(', ')
    return keys.length > 3 ? `${shown} and ${keys.length - 3} more` : shown
}

/**
 * Reads a backup file's text, strictly. Returns { ok: true, backup } with
 * backup.entries as a key → string map, or { ok: false, error } with a message
 * that says what is wrong.
 */
export function parseBackup(text) {
    const fail = (error) => ({ ok: false, error })
    if (typeof text !== 'string') return fail('The file couldn’t be read as text.')
    if (text.length > MAX_BACKUP_FILE_BYTES) return fail('The file is too large to be a backup (over 20 MB).')
    const source = text.replace(/^\ufeff/, '')
    if (!source.trim()) return fail('The file is empty.')

    let data
    try {
        data = JSON.parse(source)
    } catch {
        return fail('The file isn’t valid JSON, so it isn’t a backup made by this app.')
    }
    if (!isRecord(data) || data.app !== BACKUP_APP) {
        return fail('This isn’t a Vibe Toolbelt backup: it doesn’t say app: "vibe-toolbelt".')
    }
    if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
        return fail('The backup’s format version is missing or invalid.')
    }
    if (data.version > BACKUP_VERSION) {
        return fail(`The backup was made by a newer version of the app (format ${data.version}; this one reads format ${BACKUP_VERSION}). Reload the app to update it, then try again.`)
    }
    if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) {
        return fail('The backup’s date (exportedAt) is missing or invalid.')
    }
    if (!isRecord(data.entries)) return fail('The backup has no entries object.')

    const keys = Object.keys(data.entries)
    if (keys.length > MAX_BACKUP_ENTRIES) {
        return fail(`The backup has ${keys.length.toLocaleString('en-US')} items; a backup of this app has at most ${MAX_BACKUP_ENTRIES.toLocaleString('en-US')}.`)
    }
    const foreign = keys.filter(k => !isAppKey(k))
    if (foreign.length) return fail(`The backup has keys that this app doesn’t use: ${listKeys(foreign)}.`)
    const notText = keys.filter(k => typeof data.entries[k] !== 'string')
    if (notText.length) {
        return fail(`Every value in a backup is text, but ${listKeys(notText)} ${notText.length === 1 ? 'isn’t' : 'aren’t'}.`)
    }
    let total = 0
    for (const key of keys) total += key.length + data.entries[key].length
    if (total > MAX_BACKUP_CHARS) {
        return fail(`The backup holds ${total.toLocaleString('en-US')} characters, more than a browser stores for one site.`)
    }

    const entries = Object.create(null)
    for (const key of keys) entries[key] = data.entries[key]
    return { ok: true, backup: { app: BACKUP_APP, version: data.version, exportedAt: data.exportedAt, entries } }
}

// ---------------------------------------------------------------- restore

/**
 * What restoring `incoming` over `current` does (both key → string maps).
 *   merge    adds and updates the backup's keys and keeps everything else
 *   replace  also removes the app's keys that aren't in the backup
 * Returns { mode, added, replaced, unchanged, removed, changes } (key lists).
 */
export function planRestore(current, incoming, mode = 'merge') {
    const added = []
    const replaced = []
    const unchanged = []
    const removed = []
    for (const key of Object.keys(incoming).sort()) {
        if (!Object.hasOwn(current, key)) added.push(key)
        else if (current[key] === incoming[key]) unchanged.push(key)
        else replaced.push(key)
    }
    if (mode === 'replace') {
        for (const key of Object.keys(current).sort()) {
            if (isAppKey(key) && !Object.hasOwn(incoming, key)) removed.push(key)
        }
    }
    return { mode, added, replaced, unchanged, removed, changes: added.length + replaced.length + removed.length }
}

function isQuotaError(error) {
    return error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014
}

/**
 * Applies a plan from planRestore to `storage`. All or nothing: when a write
 * fails (storage full), everything is put back as it was and a BackupError is
 * thrown. Returns { added, replaced, removed } counts.
 */
export function applyRestore(storage, incoming, plan) {
    const before = readEntries(storage)
    try {
        // Removing first frees space for the writes
        for (const key of plan.removed) storage.removeItem(key)
        for (const key of [...plan.added, ...plan.replaced]) storage.setItem(key, incoming[key])
    } catch (error) {
        try {
            for (const key of Object.keys(readEntries(storage))) {
                if (!Object.hasOwn(before, key)) storage.removeItem(key)
            }
            for (const key of Object.keys(before)) storage.setItem(key, before[key])
        } catch {
            // best effort: the original error is what matters
        }
        throw new BackupError(isQuotaError(error)
            ? 'There isn’t enough storage space in this browser for this backup. Nothing was changed.'
            : `The backup couldn’t be restored (${error?.message || 'unknown error'}). Nothing was changed.`)
    }
    return { added: plan.added.length, replaced: plan.replaced.length, removed: plan.removed.length }
}

// ---------------------------------------------------------------- after reload

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Reads and removes the notice left before a reload; null when there's none. */
export function takeDataNotice(storage) {
    try {
        const raw = storage?.getItem(DATA_NOTICE_KEY)
        if (raw === null || raw === undefined) return null
        storage.removeItem(DATA_NOTICE_KEY)
        const notice = JSON.parse(raw)
        return isRecord(notice) && (notice.type === 'restored' || notice.type === 'cleared') ? notice : null
    } catch {
        return null
    }
}

const count = (value) => (Number.isInteger(value) && value > 0 ? value : 0)

/** The toast for a notice: { tone, message }. */
export function describeDataNotice(notice) {
    if (notice.type === 'restored') {
        // "3 items added, 2 replaced": the first count names what is counted
        const parts = [['added', count(notice.added)], ['replaced', count(notice.replaced)], ['removed', count(notice.removed)]]
            .filter(([, n]) => n > 0)
            .map(([what, n], i) => `${i === 0 ? plural(n, 'item') : n} ${what}`)
        return { tone: 'success', message: `Backup restored${parts.length ? `: ${parts.join(', ')}` : ''}.` }
    }
    const models = notice.models
    if (models?.status === 'failed') {
        return { tone: 'warning', message: `Your data was cleared, but the downloaded AI models couldn’t be deleted (${models.message || 'unknown error'}). Delete them from the On-device AI section.` }
    }
    return {
        tone: 'success',
        message: models?.status === 'deleted'
            ? 'All data was cleared from this browser, including the downloaded AI models.'
            : 'All data was cleared from this browser.',
    }
}
