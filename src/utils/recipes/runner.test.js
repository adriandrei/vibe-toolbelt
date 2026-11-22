import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { getOperation, defaultOptions } from './operations.js'
import {
    MAX_STEPS, cleanName, describeParseProblems, executeRecipe, parseSavedRecipes, parseSharedState, parseSteps,
    runRecipe, serializeSaved, serializeSteps,
} from './runner.js'
import { EXAMPLES } from './examples.js'
import { coerce, describeOutput, describeValue } from './values.js'

const step = (op, options = {}, enabled = true) => ({ op, options: { ...defaultOptions(getOperation(op)), ...options }, enabled })
const utf8 = (b) => new TextDecoder().decode(b)

describe('runRecipe: kinds and conversions', () => {
    it('turns text into UTF-8 bytes for byte operations', async () => {
        const { value, trail } = await runRecipe('é€', [step('hex-encode')])
        expect(value).toBe('c3a9e282ac')
        expect(trail[0]).toMatchObject({ status: 'ok', kind: 'text', chars: 10, bytes: 10 })
    })

    it('turns UTF-8 bytes back into text for text operations', async () => {
        const encoded = Buffer.from('héllo wörld').toString('base64')
        const { value, trail } = await runRecipe(encoded, [step('base64-decode'), step('upper-case')])
        expect(value).toBe('HÉLLO WÖRLD')
        expect(trail[0]).toMatchObject({ status: 'ok', kind: 'bytes', bytes: 13, utf8: true, preview: 'héllo wörld' })
        expect(trail[1]).toMatchObject({ status: 'ok', kind: 'text', chars: 11, bytes: 13 })
    })

    it('refuses to treat binary data as text', async () => {
        const { value, error, trail } = await runRecipe('/w==', [step('base64-decode'), step('trim'), step('hex-encode')])
        expect(value).toBeNull()
        expect(error).toMatchObject({ index: 1, op: 'trim', name: 'Trim' })
        expect(error.text).toBe('Step 2 · Trim: this step works on text, but its input is binary data that isn’t valid UTF-8. Add Hex encode or Base64 encode before it to turn the bytes into text')
        expect(trail.map((t) => t.status)).toEqual(['ok', 'error', 'not-run'])
        expect(trail[0]).toMatchObject({ kind: 'bytes', bytes: 1, utf8: false, preview: 'ff' })
    })

    it('passes the value unchanged to operations that take anything', async () => {
        const { value } = await runRecipe(new Uint8Array([0xff, 0xfe]), [step('count')])
        expect(value).toBe('Bytes: 2')
    })

    it('returns the input unchanged when there are no steps', async () => {
        expect((await runRecipe('as is', [])).value).toBe('as is')
        const bytes = new Uint8Array([1, 2, 3])
        expect((await runRecipe(bytes, [])).value).toBe(bytes)
    })

    it('coerce() follows the same rules', () => {
        expect(coerce('A', 'bytes')).toEqual(new Uint8Array([65]))
        expect(coerce(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), 'text')).toBe('A')
        expect(() => coerce(new Uint8Array([0xc3]), 'text')).toThrow(/isn’t valid UTF-8/)
        const raw = new Uint8Array([0xc3])
        expect(coerce(raw, 'any')).toBe(raw)
    })
})

describe('runRecipe: steps, errors and the trail', () => {
    it('skips disabled steps and keeps going with the previous value', async () => {
        const steps = [step('upper-case'), step('reverse', {}, false), step('base64-encode')]
        const { value, trail } = await runRecipe('abc', steps)
        expect(value).toBe(Buffer.from('ABC').toString('base64'))
        expect(trail.map((t) => t.status)).toEqual(['ok', 'skipped', 'ok'])
    })

    it('stops at the first failing step and names it by position', async () => {
        const steps = [step('url-decode'), step('base64-decode', {}, false), step('gunzip'), step('json-prettify')]
        const { value, error, trail } = await runRecipe('hello%20world', steps)
        expect(value).toBeNull()
        expect(error.index).toBe(2)
        expect(error.name).toBe('Gunzip')
        expect(error.text).toBe('Step 3 · Gunzip: the input isn’t gzip data: gzip starts with the bytes 1f 8b, this starts with 68 65.')
        expect(trail.map((t) => t.status)).toEqual(['ok', 'skipped', 'error', 'not-run'])
    })

    it('reports each step’s kind, size, time, notes and a preview', async () => {
        const { trail } = await runRecipe('a\nb\na\n', [step('unique-lines'), step('gzip')])
        expect(trail[0]).toMatchObject({ status: 'ok', kind: 'text', chars: 4, bytes: 4, preview: 'a ↵ b ↵ ' })
        expect(trail[0].notes).toEqual([{ tone: 'info', text: 'Removed 1 duplicate line' }])
        expect(trail[0].ms).toBeGreaterThanOrEqual(0)
        expect(trail[1]).toMatchObject({ status: 'ok', kind: 'bytes', utf8: false })
        expect(trail[1].preview).toMatch(/^1f 8b 08/)
    })

    it('calls onStep before each step that runs', async () => {
        const seen = []
        await runRecipe('x', [step('upper-case'), step('lower-case', {}, false), step('reverse')], { onStep: (i) => seen.push(i) })
        expect(seen).toEqual([0, 2])
    })

    it('fails cleanly on an operation it doesn’t know', async () => {
        const { error } = await runRecipe('x', [{ op: 'nope', options: {}, enabled: true }])
        expect(error.text).toBe('Step 1 · nope: “nope” isn’t a known operation')
    })

    it('runs examples from the registry list on real data', async () => {
        const json = { user: 'ada', id: 12, tags: ['a', 'b'] }
        const encoded = zlib.gzipSync(JSON.stringify(json)).toString('base64')
        const { value } = await runRecipe(encoded, [step('base64-decode'), step('gunzip'), step('json-sort-keys', { indent: 'none' })])
        expect(value).toBe('{"id":12,"tags":["a","b"],"user":"ada"}')
    })
})

describe('executeRecipe (what the worker returns)', () => {
    it('describes text output', async () => {
        const result = await executeRecipe({ input: { kind: 'text', text: 'hi' }, steps: [step('upper-case')] })
        expect(result).toMatchObject({ input: { kind: 'text', chars: 2, bytes: 2 }, error: null, output: { kind: 'text', text: 'HI', chars: 2, bytes: 2 } })
    })

    it('reads files as exact bytes and recognises binary output', async () => {
        const file = new File([Uint8Array.from([0xef, 0xbb, 0xbf, 0x68, 0x69])], 'bom.txt')
        const hashed = await executeRecipe({ input: { kind: 'file', file }, steps: [step('sha256')] })
        expect(hashed.input).toMatchObject({ kind: 'bytes', bytes: 5 })
        // The byte order mark is part of the file, so it's part of the hash
        expect(hashed.output.text).toBe(crypto.createHash('sha256').update(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69])).digest('hex'))
        const gz = await executeRecipe({ input: { kind: 'text', text: 'hello' }, steps: [step('gzip')] })
        expect(gz.output).toMatchObject({ kind: 'bytes', text: null, sniff: { ext: 'gz' } })
        expect(zlib.gunzipSync(gz.output.bytes).toString()).toBe('hello')
    })

    it('shows bytes that are UTF-8 text as text', () => {
        expect(describeOutput(new TextEncoder().encode('{"a":1}'))).toMatchObject({ kind: 'bytes', text: '{"a":1}', size: 7, sniff: null })
        expect(describeOutput(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]))).toMatchObject({ text: null })
        expect(describeValue('😀')).toMatchObject({ kind: 'text', chars: 1, bytes: 4 })
    })

    it('returns errors instead of output', async () => {
        const result = await executeRecipe({ input: { kind: 'text', text: '{' }, steps: [step('json-prettify')] })
        expect(result.output).toBeNull()
        expect(result.error.text).toMatch(/^Step 1 · JSON prettify: the input isn’t valid JSON: /)
    })
})

describe('Validating stored and shared recipes', () => {
    it('parseSteps keeps known steps, skips unknown ones and resets invalid options', () => {
        const parsed = parseSteps([
            { op: 'base64-decode' },
            { op: 'future-op', options: { x: 1 } },
            { op: 'json-prettify', options: { indent: '7', extra: true } },
            { op: 'find-replace', options: { find: 'a', regex: 'yes' }, enabled: false },
            { op: 'upper-case', enabled: 'no' },
            'junk',
            null,
            { op: 42 },
            { op: 'future-op' },
        ])
        expect(parsed.steps).toEqual([
            { op: 'base64-decode', options: {}, enabled: true },
            { op: 'json-prettify', options: { indent: '2' }, enabled: true },
            { op: 'find-replace', options: { find: 'a', replace: '', regex: false, flags: 'g' }, enabled: false },
            { op: 'upper-case', options: {}, enabled: true },
        ])
        expect(parsed.unknown).toEqual(['future-op'])
        expect(parsed.reset).toBe(3)
        expect(parsed.invalid).toBe(3)
        expect(describeParseProblems(parsed)).toBe('Skipped a step with an unknown operation (“future-op”); skipped 3 malformed steps; reset 3 invalid options to the default.')
    })

    it('parseSteps limits the number of steps and keeps ids only when asked', () => {
        const many = Array.from({ length: MAX_STEPS + 5 }, () => ({ op: 'trim', uid: 'abc' }))
        const parsed = parseSteps(many)
        expect(parsed.steps).toHaveLength(MAX_STEPS)
        expect(parsed.truncated).toBe(true)
        expect(parsed.steps[0].uid).toBeUndefined()
        expect(parseSteps([{ op: 'trim', uid: 'abc' }, { op: 'trim', uid: 'bad id!' }], { keepUid: true }).steps.map((s) => s.uid)).toEqual(['abc', undefined])
        expect(parseSteps('nope')).toMatchObject({ steps: [], invalid: 1 })
        expect(describeParseProblems(parseSteps([{ op: 'trim' }]))).toBeNull()
    })

    it('serializeSteps stores only what differs from the defaults, and round-trips', () => {
        const steps = [step('json-prettify', { indent: '4' }), step('gunzip', {}, false), step('find-replace', { find: 'x' })]
        const stored = serializeSteps(steps)
        expect(stored).toEqual([
            { op: 'json-prettify', options: { indent: '4' } },
            { op: 'gunzip', enabled: false },
            { op: 'find-replace', options: { find: 'x' } },
        ])
        expect(parseSteps(JSON.parse(JSON.stringify(stored))).steps).toEqual(steps)
    })

    it('parseSavedRecipes drops broken entries and repairs ids deterministically', () => {
        const raw = [
            { id: 'r1', name: '  My   recipe ', steps: [{ op: 'gunzip' }], savedAt: 5 },
            { id: 'r1', name: 'Duplicate id', steps: [{ op: 'trim' }] },
            { name: 'No id', steps: [{ op: 'trim' }, { op: 'gone' }], savedAt: 'x' },
            { id: 'r4', name: '', steps: [{ op: 'trim' }] },
            { id: 'r5', name: 'Only unknown steps', steps: [{ op: 'gone' }] },
            { id: 'r6', name: 'No steps', steps: [] },
            'junk',
        ]
        const parsed = parseSavedRecipes(raw)
        expect(parsed.map((r) => [r.id, r.name, r.steps.length, r.savedAt, r.unknown])).toEqual([
            ['r1', 'My recipe', 1, 5, []],
            ['r1-1', 'Duplicate id', 1, 0, []],
            ['saved-2', 'No id', 1, 0, ['gone']],
        ])
        expect(parseSavedRecipes(raw)).toEqual(parsed)
        expect(parseSavedRecipes({ not: 'an array' })).toEqual([])
        expect(serializeSaved(parsed[0])).toEqual({ id: 'r1', name: 'My recipe', steps: [{ op: 'gunzip' }], savedAt: 5 })
    })

    it('parseSharedState validates the recipe and the optional input', () => {
        const state = parseSharedState({ steps: [{ op: 'url-decode' }, { op: 'nope' }], input: 'a%20b', name: 'From a friend' })
        expect(state.steps).toEqual([{ op: 'url-decode', options: { mode: 'component' }, enabled: true }])
        expect(state.input).toBe('a%20b')
        expect(state.name).toBe('From a friend')
        expect(state.problems).toBe('Skipped a step with an unknown operation (“nope”).')
        expect(parseSharedState({ steps: [], input: 42 }).problems).toBe('The input in the link was invalid and was left out.')
        expect(parseSharedState({ steps: [{ op: 'trim' }] })).toMatchObject({ input: null, problems: null, name: '' })
        expect(() => parseSharedState({ pattern: 'x' })).toThrow('This link doesn’t contain a recipe.')
        expect(() => parseSharedState(null)).toThrow()
    })

    it('cleanName makes a single trimmed line', () => {
        expect(cleanName('  a \n b\t ')).toBe('a b')
        expect(cleanName('x'.repeat(200))).toHaveLength(80)
        expect(cleanName(undefined)).toBe('')
    })
})

describe('Built-in examples', () => {
    const byId = Object.fromEntries(EXAMPLES.map((e) => [e.id, e]))

    it('are all valid recipes', () => {
        for (const example of EXAMPLES) {
            expect(example.steps.length, example.id).toBeGreaterThan(0)
            expect(parseSteps(serializeSteps(example.steps)).steps, example.id).toEqual(example.steps)
        }
        expect(EXAMPLES.map((e) => e.name)).toEqual(['Decode a JWT', 'Base64 → gunzip → pretty JSON', 'URL-decode → pretty JSON', 'Hash a file (SHA-256)'])
    })

    it('Decode a JWT: header and payload of the sample token', async () => {
        const { input, steps } = byId.jwt
        const [header, payload] = input.split('.').slice(0, 2).map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()))
        const { value } = await runRecipe(input, steps)
        expect(value).toBe(JSON.stringify({ header, payload }, null, 2))
    })

    it('Base64 → gunzip → pretty JSON on its sample', async () => {
        const { input, steps } = byId['base64-gunzip-json']
        const expected = JSON.stringify(JSON.parse(zlib.gunzipSync(Buffer.from(input, 'base64')).toString()), null, 2)
        expect((await runRecipe(input, steps)).value).toBe(expected)
    })

    it('URL-decode → pretty JSON on its sample', async () => {
        const { input, steps } = byId['url-json']
        const expected = JSON.stringify(JSON.parse(decodeURIComponent(input)), null, 2)
        expect((await runRecipe(input, steps)).value).toBe(expected)
    })

    it('Hash a file (SHA-256) matches sha256sum on binary data', async () => {
        const { input, steps } = byId['sha256-file']
        expect(input).toBeNull()
        const data = crypto.randomBytes(100_000)
        expect((await runRecipe(new Uint8Array(data), steps)).value).toBe(crypto.createHash('sha256').update(data).digest('hex'))
        expect(utf8(new TextEncoder().encode('ok'))).toBe('ok')
    })
})
