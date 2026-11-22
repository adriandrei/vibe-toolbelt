import { describe, expect, it } from 'vitest'
import {
    BACKUP_APP,
    BACKUP_VERSION,
    BackupError,
    DATA_NOTICE_KEY,
    MAX_BACKUP_CHARS,
    MAX_BACKUP_ENTRIES,
    MAX_BACKUP_FILE_BYTES,
    SENSITIVE_KEYS,
    applyRestore,
    backupFileName,
    buildBackup,
    describeDataNotice,
    entriesSize,
    groupKeys,
    groupOf,
    isAppKey,
    isModelCache,
    labelOf,
    parseBackup,
    planRestore,
    readEntries,
    serializeBackup,
    takeDataNotice,
} from './backup'

// A Storage stand-in. `failAt` makes the n-th setItem call (0-based) throw `error` once.
class MemoryStorage {
    constructor(entries = {}, { failAt = -1, error = new Error('boom') } = {}) {
        this.map = new Map(Object.entries(entries))
        this.writes = 0
        this.failAt = failAt
        this.error = error
    }

    get length() {
        return this.map.size
    }

    key(i) {
        return [...this.map.keys()][i] ?? null
    }

    getItem(key) {
        return this.map.has(key) ? this.map.get(key) : null
    }

    setItem(key, value) {
        const n = this.writes++
        if (n === this.failAt) throw this.error
        this.map.set(key, String(value))
    }

    removeItem(key) {
        this.map.delete(key)
    }

    toObject() {
        return Object.fromEntries(this.map)
    }
}

// What the app keeps today (raw strings, exactly as stored)
const SAMPLE = {
    'pt-theme': 'dark',
    'pt-hue': '145',
    'pt-sidebar-collapsed': '["security"]',
    'vibe-tools-favorites': '["/uuid","/regex"]',
    'vibe-tools-recents': '["/cron","/regex"]',
    'api-history': '[{"id":"h-1","request":{"auth":{"token":"secret-token"}}}]',
    'api-collections': '[{"id":"c-1","name":"Me","request":{"auth":{"token":"saved-token"}}}]',
    'api-envs': '[{"id":"default","name":"Default","vars":[{"key":"token","value":"env-token"}]}]',
    'api-active-env': '"default"',
    'api-history-secrets': 'false',
    'vt-formatters-prefs': '{"indent":"4"}',
    ai_model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
}

function backupText(overrides = {}, entries = { 'pt-theme': 'dark' }) {
    return JSON.stringify({ app: BACKUP_APP, version: 1, exportedAt: '2026-11-21T10:00:00.000Z', entries, ...overrides })
}

describe('keys', () => {
    it('accepts the app’s key style and rejects anything else', () => {
        for (const key of ['pt-theme', 'ai_model', 'vt-formatters-prefs', 'jwt-builder-alg', 'tz-zones', 'a', 'camelCaseKey', 'x.y']) {
            expect(isAppKey(key)).toBe(true)
        }
        for (const key of ['', ' pt-theme', 'with space', 'redux-persist:root', '1abc', '-x', '__proto__', 'a/b', 'é-key', 'x'.repeat(101), 42, null, undefined]) {
            expect(isAppKey(key)).toBe(false)
        }
    })

    it('groups known keys, keys of new tools by prefix, and unknown keys under Other', () => {
        expect(groupOf('pt-theme')).toBe('appearance')
        expect(groupOf('pt-pinned-tool')).toBe('appearance')
        expect(groupOf('vibe-tools-favorites')).toBe('favourites')
        expect(groupOf('vibe-tools-recents')).toBe('favourites')
        expect(groupOf('api-history')).toBe('api')
        expect(groupOf('api-protocol')).toBe('api')
        expect(groupOf('vt-formatters-prefs')).toBe('formatters')
        expect(groupOf('ai_model')).toBe('ai')
        expect(groupOf('curl-target')).toBe('tools')
        expect(groupOf('pwgen-options')).toBe('tools')
        expect(groupOf('jwt-builder-alg')).toBe('tools')
        expect(groupOf('tz-zones')).toBe('tools')
        expect(groupOf('recipes-saved')).toBe('tools')
        expect(groupOf('pt-something-new')).toBe('other')
        expect(groupOf('loglevel')).toBe('other')
    })

    it('labels known keys and falls back to the key', () => {
        expect(labelOf('pt-hue')).toBe('Accent colour')
        expect(labelOf('api-collections')).toBe('Saved requests')
        expect(labelOf('mystery-key')).toBe('mystery-key')
        expect(labelOf('toString')).toBe('toString')
    })

    it('lists groups in display order with sorted keys, leaving out empty groups', () => {
        const groups = groupKeys(['zzz', 'api-envs', 'pt-theme', 'api-history', 'vibe-tools-recents'])
        expect(groups.map(g => g.label)).toEqual(['Appearance', 'Favourites & recents', 'API Tester', 'Other'])
        expect(groups.find(g => g.id === 'api').keys).toEqual(['api-envs', 'api-history'])
    })

    it('recognises WebLLM’s model caches and nothing else', () => {
        expect(isModelCache('webllm/model')).toBe(true)
        expect(isModelCache('webllm/config')).toBe(true)
        expect(isModelCache('webllm/wasm')).toBe(true)
        for (const name of ['app-assets', 'ffmpeg-core', 'workbox-precache-v2-http://localhost/', 'tvmjs', 'webllm', undefined]) {
            expect(isModelCache(name)).toBe(false)
        }
    })
})

describe('reading storage', () => {
    it('reads every key with its raw value', () => {
        const storage = new MemoryStorage(SAMPLE)
        expect(readEntries(storage)).toEqual(SAMPLE)
        expect(readEntries(null)).toEqual({})
    })

    it('keeps a "__proto__" key as plain data', () => {
        const entries = readEntries(new MemoryStorage({ ['__proto__']: 'x', a: '1' }))
        expect(Object.keys(entries)).toEqual(['__proto__', 'a'])
        expect(Object.getPrototypeOf(entries)).toBeNull()
        expect({}.polluted).toBeUndefined()
    })

    it('measures the UTF-8 size of keys and values', () => {
        expect(entriesSize({ ab: 'cd' })).toBe(4)
        expect(entriesSize({ k: 'é😀' })).toBe(1 + 2 + 4)
        expect(entriesSize({ a: 'x', b: 'yy' }, ['b'])).toBe(3)
    })
})

describe('export', () => {
    const date = new Date('2026-11-21T09:30:00.000Z')

    it('leaves out API Tester history, saved requests and environments by default', () => {
        const { backup, omitted, skipped } = buildBackup(SAMPLE, { date })
        expect(backup.app).toBe('vibe-toolbelt')
        expect(backup.version).toBe(1)
        expect(backup.exportedAt).toBe('2026-11-21T09:30:00.000Z')
        expect(omitted).toEqual(['api-collections', 'api-envs', 'api-history'])
        expect(skipped).toEqual([])
        for (const key of SENSITIVE_KEYS) expect(backup.entries).not.toHaveProperty(key)
        // Everything else, as the exact stored strings
        expect(backup.entries['pt-theme']).toBe('dark')
        expect(backup.entries['api-active-env']).toBe('"default"')
        expect(backup.entries['api-history-secrets']).toBe('false')
        expect(Object.keys(backup.entries)).toHaveLength(Object.keys(SAMPLE).length - 3)
    })

    it('includes them when asked to', () => {
        const { backup, omitted } = buildBackup(SAMPLE, { includeSensitive: true, date })
        expect(omitted).toEqual([])
        expect(backup.entries).toEqual(SAMPLE)
    })

    it('backs up keys it has never heard of, but skips keys that aren’t the app’s', () => {
        const { backup, skipped } = buildBackup({ 'pwgen-options': '{"length":20}', 'redux-persist:root': '{}', 'pt-new-thing': '1' }, { date })
        expect(Object.keys(backup.entries)).toEqual(['pt-new-thing', 'pwgen-options'])
        expect(skipped).toEqual(['redux-persist:root'])
    })

    it('sorts keys and round-trips through the file format', () => {
        const { backup } = buildBackup(SAMPLE, { includeSensitive: true, date })
        expect(Object.keys(backup.entries)).toEqual(Object.keys(SAMPLE).sort())
        const text = serializeBackup(backup)
        expect(text.endsWith('}\n')).toBe(true)
        const parsed = parseBackup(text)
        expect(parsed.ok).toBe(true)
        expect(parsed.backup.entries).toEqual(SAMPLE)
        expect(parsed.backup.exportedAt).toBe(backup.exportedAt)
    })

    it('names the file after the local date', () => {
        expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('vibe-toolbelt-backup-2026-01-05.json')
        expect(backupFileName(new Date(2026, 10, 21, 0, 1))).toBe('vibe-toolbelt-backup-2026-11-21.json')
    })
})

describe('import validation', () => {
    const rejects = (text, pattern) => {
        const result = parseBackup(text)
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(pattern)
    }

    it('accepts a valid backup, with or without a byte order mark', () => {
        expect(parseBackup(backupText()).ok).toBe(true)
        expect(parseBackup(`\ufeff${backupText()}`).ok).toBe(true)
        // Fields this version doesn't know are ignored
        expect(parseBackup(backupText({ note: 'hi' })).ok).toBe(true)
        // An empty backup is valid (it just changes nothing when merged)
        expect(parseBackup(backupText({}, {})).backup.entries).toEqual({})
    })

    it('rejects files that aren’t JSON or aren’t backups', () => {
        rejects(undefined, /couldn’t be read/)
        rejects('', /empty/)
        rejects('   \n', /empty/)
        rejects('not json {', /isn’t valid JSON/)
        rejects('[1,2]', /isn’t a Vibe Toolbelt backup/)
        rejects('null', /isn’t a Vibe Toolbelt backup/)
        rejects('"vibe-toolbelt"', /isn’t a Vibe Toolbelt backup/)
        rejects(backupText({ app: 'other-app' }), /isn’t a Vibe Toolbelt backup/)
        rejects(backupText({ app: undefined }), /isn’t a Vibe Toolbelt backup/)
    })

    it('rejects missing, invalid and future versions', () => {
        rejects(backupText({ version: undefined }), /format version is missing or invalid/)
        rejects(backupText({ version: '1' }), /format version is missing or invalid/)
        rejects(backupText({ version: 0 }), /format version is missing or invalid/)
        rejects(backupText({ version: 1.5 }), /format version is missing or invalid/)
        rejects(backupText({ version: BACKUP_VERSION + 1 }), /newer version of the app \(format 2; this one reads format 1\)/)
    })

    it('rejects a missing or invalid date', () => {
        rejects(backupText({ exportedAt: undefined }), /date \(exportedAt\)/)
        rejects(backupText({ exportedAt: 'yesterday' }), /date \(exportedAt\)/)
        rejects(backupText({ exportedAt: 1700000000000 }), /date \(exportedAt\)/)
    })

    it('rejects entries that aren’t an object of strings', () => {
        rejects(backupText({ entries: undefined }), /no entries object/)
        rejects(backupText({ entries: null }), /no entries object/)
        rejects(backupText({ entries: ['pt-theme'] }), /no entries object/)
        rejects(backupText({}, { 'pt-theme': 'dark', 'pt-hue': 145 }), /Every value in a backup is text, but “pt-hue” isn’t/)
        rejects(backupText({}, { a: null, b: { x: 1 }, c: true, d: [] }), /“a”, “b”, “c” and 1 more aren’t/)
    })

    it('rejects keys that don’t look like the app’s', () => {
        rejects(backupText({}, { 'pt-theme': 'dark', 'redux-persist:root': '{}' }), /keys that this app doesn’t use: “redux-persist:root”/)
        rejects(backupText({}, { 'has space': 'x' }), /“has space”/)
        rejects('{"app":"vibe-toolbelt","version":1,"exportedAt":"2026-11-21T10:00:00Z","entries":{"__proto__":"x"}}', /“__proto__”/)
        expect({}.x).toBeUndefined()
    })

    it('rejects oversized files and contents', () => {
        rejects('x'.repeat(MAX_BACKUP_FILE_BYTES + 1), /too large to be a backup/)
        const many = Object.fromEntries(Array.from({ length: MAX_BACKUP_ENTRIES + 1 }, (_, i) => [`k${i}`, '']))
        rejects(backupText({}, many), /has 1,001 items/)
        const big = { a: 'x'.repeat(MAX_BACKUP_CHARS / 2), b: 'y'.repeat(MAX_BACKUP_CHARS / 2) }
        rejects(backupText({}, big), /more than a browser stores/)
    })

    it('returns entries as plain data without a prototype', () => {
        const { backup } = parseBackup(backupText({}, { 'pt-theme': 'light', constructor: 'x' }))
        expect(Object.getPrototypeOf(backup.entries)).toBeNull()
        expect(backup.entries.constructor).toBe('x')
    })
})

describe('restore', () => {
    const current = { 'pt-theme': 'light', 'pt-hue': '145', 'api-history': '[]', 'loglevel:webpack': 'warn' }
    const incoming = { 'pt-theme': 'dark', 'pt-hue': '145', 'vibe-tools-favorites': '["/uuid"]' }

    it('merge adds and replaces, and keeps everything else', () => {
        const plan = planRestore(current, incoming, 'merge')
        expect(plan).toMatchObject({
            mode: 'merge',
            added: ['vibe-tools-favorites'],
            replaced: ['pt-theme'],
            unchanged: ['pt-hue'],
            removed: [],
            changes: 2,
        })
        const storage = new MemoryStorage(current)
        expect(applyRestore(storage, incoming, plan)).toEqual({ added: 1, replaced: 1, removed: 0 })
        expect(storage.toObject()).toEqual({ ...current, ...incoming })
    })

    it('replace also removes the app’s keys that aren’t in the backup, but never other keys', () => {
        const plan = planRestore(current, incoming, 'replace')
        expect(plan.removed).toEqual(['api-history'])
        expect(plan.changes).toBe(3)
        const storage = new MemoryStorage(current)
        expect(applyRestore(storage, incoming, plan)).toEqual({ added: 1, replaced: 1, removed: 1 })
        expect(storage.toObject()).toEqual({ ...incoming, 'loglevel:webpack': 'warn' })
    })

    it('reports no changes when the data is already the same', () => {
        expect(planRestore(incoming, incoming, 'merge').changes).toBe(0)
        expect(planRestore(incoming, incoming, 'replace').changes).toBe(0)
    })

    it('puts everything back when the browser runs out of space', () => {
        const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        // By the time the second write fails, api-history was removed and pt-zzz written
        const bigger = { ...incoming, 'pt-zzz': 'big' }
        const storage = new MemoryStorage(current, { failAt: 1, error: quota })
        const plan = planRestore(current, bigger, 'replace')
        expect(plan.removed).toEqual(['api-history'])
        expect(plan.added[0]).toBe('pt-zzz')
        expect(() => applyRestore(storage, bigger, plan)).toThrow(BackupError)
        expect(storage.toObject()).toEqual(current)

        const again = new MemoryStorage(current, { failAt: 0, error: quota })
        expect(() => applyRestore(again, incoming, planRestore(current, incoming))).toThrow(/enough storage space.*Nothing was changed/)
        expect(again.toObject()).toEqual(current)
    })

    it('rolls back other write errors too, saying what went wrong', () => {
        const storage = new MemoryStorage(current, { failAt: 0, error: new Error('SecurityError') })
        expect(() => applyRestore(storage, incoming, planRestore(current, incoming))).toThrow(/couldn’t be restored \(SecurityError\)\. Nothing was changed/)
        expect(storage.toObject()).toEqual(current)
    })
})

describe('notice after reload', () => {
    it('is read once, then removed', () => {
        const storage = new MemoryStorage({ [DATA_NOTICE_KEY]: JSON.stringify({ type: 'restored', added: 2, replaced: 1, removed: 0 }) })
        expect(takeDataNotice(storage)).toEqual({ type: 'restored', added: 2, replaced: 1, removed: 0 })
        expect(storage.getItem(DATA_NOTICE_KEY)).toBeNull()
        expect(takeDataNotice(storage)).toBeNull()
    })

    it('ignores and removes a damaged notice', () => {
        const storage = new MemoryStorage({ [DATA_NOTICE_KEY]: '{oops' })
        expect(takeDataNotice(storage)).toBeNull()
        expect(storage.getItem(DATA_NOTICE_KEY)).toBeNull()
        expect(takeDataNotice(new MemoryStorage({ [DATA_NOTICE_KEY]: '{"type":"other"}' }))).toBeNull()
        expect(takeDataNotice(null)).toBeNull()
    })

    it('describes a restore', () => {
        expect(describeDataNotice({ type: 'restored', added: 3, replaced: 2, removed: 0 }).message).toBe('Backup restored: 3 items added, 2 replaced.')
        expect(describeDataNotice({ type: 'restored', added: 0, replaced: 1, removed: 4 }).message).toBe('Backup restored: 1 item replaced, 4 removed.')
        expect(describeDataNotice({ type: 'restored', added: 0, replaced: 0, removed: 0 }).message).toBe('Backup restored.')
        expect(describeDataNotice({ type: 'restored', added: '9', replaced: -1, removed: 1.5 }).message).toBe('Backup restored.')
        expect(describeDataNotice({ type: 'restored', added: 1 }).tone).toBe('success')
    })

    it('describes clearing, with or without the AI models', () => {
        expect(describeDataNotice({ type: 'cleared', models: null })).toEqual({ tone: 'success', message: 'All data was cleared from this browser.' })
        expect(describeDataNotice({ type: 'cleared', models: { status: 'deleted' } }).message).toMatch(/including the downloaded AI models/)
        const failed = describeDataNotice({ type: 'cleared', models: { status: 'failed', message: 'Blocked' } })
        expect(failed.tone).toBe('warning')
        expect(failed.message).toMatch(/couldn’t be deleted \(Blocked\)/)
    })
})
