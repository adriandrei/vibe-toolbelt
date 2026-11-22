import { describe, expect, it } from 'vitest'
import { TYPEGEN_TARGETS, generateTypes, normalizeRootName, parseJsonSample } from './typegen'

const gen = (json, options) => generateTypes(parseJsonSample(json), options)

const SAMPLE = '{"id":1,"name":"Ada","score":1.5,"tags":["a","b"],"owner":{"login":"x","site":null},"items":[{"a":1},{"a":2,"b":"x"}],"user-name":"u","ok":true,"mixed":[1,"a"]}'

describe('normalizeRootName', () => {
    it.each([
        ['my root', 'MyRoot'], ['user_profile', 'UserProfile'], ['', 'Root'], ['   ', 'Root'], ['!!!', 'Root'], ['123abc', 'T123abc'], ['already', 'Already'],
    ])('%j -> %s', (raw, expected) => expect(normalizeRootName(raw)).toBe(expected))
    it('uses the given fallback', () => {
        expect(normalizeRootName('', 'Thing')).toBe('Thing')
    })
})

describe('TypeScript', () => {
    it('generates interfaces with optional, nullable, union and quoted members', () => {
        expect(gen(SAMPLE, { rootName: 'my root' })).toBe([
            'export interface MyRoot {', '  id: number;', '  name: string;', '  score: number;', '  tags: string[];', '  owner: Owner;', '  items: Item[];',
            '  "user-name": string;', '  ok: boolean;', '  mixed: (number | string)[];', '}', '',
            'export interface Owner {', '  login: string;', '  site: null;', '}', '',
            'export interface Item {', '  a: number;', '  b?: string;', '}',
        ].join('\n'))
    })

    it('is the default target', () => {
        expect(gen('{"a":1}')).toBe(gen('{"a":1}', { target: 'typescript' }))
        expect(TYPEGEN_TARGETS).toEqual(['typescript', 'go', 'schema'])
    })

    it('makes fields nullable when some elements have null, and optional when missing', () => {
        expect(gen('[{"a":1,"b":"x"},{"a":null}]')).toBe('export type Root = RootItem[];\n\nexport interface RootItem {\n  a: number | null;\n  b?: string;\n}')
    })

    it('handles top-level scalars, arrays and empty containers', () => {
        expect(gen('[1,2,3]')).toBe('export type Root = number[];')
        expect(gen('"x"')).toBe('export type Root = string;')
        expect(gen('null')).toBe('export type Root = null;')
        expect(gen('[]')).toBe('export type Root = unknown[];')
        expect(gen('{}')).toBe('export type Root = Record<string, unknown>;')
        expect(gen('{"a":{}}')).toBe('export interface Root {\n  a: Record<string, unknown>;\n}')
    })

    it('reuses one interface for identical shapes', () => {
        const out = gen('{"a":{"x":1},"b":{"x":2}}')
        expect(out.match(/export interface/g)).toHaveLength(2)
        expect(out).toContain('a: A;')
        expect(out).toContain('b: A;')
    })

    it('avoids clashing names', () => {
        const out = gen('{"item":{"a":1},"items":[{"b":2}],"x":{"item":{"c":3}}}')
        const names = [...out.matchAll(/export interface (\w+)/g)].map(m => m[1])
        expect(new Set(names).size).toBe(names.length)
    })

    it('treats 1.0 as a number in either case (and large integers as number)', () => {
        expect(gen('{"f":2.0,"big":9007199254740993}')).toBe('export interface Root {\n  f: number;\n  big: number;\n}')
    })
})

describe('Go', () => {
    it('generates structs with JSON tags, exported names and omitempty', () => {
        expect(gen(SAMPLE, { target: 'go', rootName: 'my root' })).toBe([
            'type MyRoot struct {',
            '\tID       int      `json:"id"`', '\tName     string   `json:"name"`', '\tScore    float64  `json:"score"`', '\tTags     []string `json:"tags"`',
            '\tOwner    Owner    `json:"owner"`', '\tItems    []Item   `json:"items"`', '\tUserName string   `json:"user-name"`', '\tOk       bool     `json:"ok"`',
            '\tMixed    []any    `json:"mixed"`', '}', '',
            'type Owner struct {', '\tLogin string `json:"login"`', '\tSite  any    `json:"site"`', '}', '',
            'type Item struct {', '\tA int    `json:"a"`', '\tB string `json:"b,omitempty"`', '}',
        ].join('\n'))
    })

    it('uses pointers for nullable values and slices for top-level arrays', () => {
        expect(gen('[{"a":1},{"a":null}]', { target: 'go' })).toBe('type Root []RootItem\n\ntype RootItem struct {\n\tA *int `json:"a"`\n}')
    })

    it('chooses int64 for integers beyond 32 bits and float64 for floats', () => {
        expect(gen('{"big":9007199254740993,"n":3000000000,"f":2.0,"small":5}', { target: 'go' })).toBe(
            'type Root struct {\n\tBig   int64   `json:"big"`\n\tN     int64   `json:"n"`\n\tF     float64 `json:"f"`\n\tSmall int     `json:"small"`\n}')
    })
})

describe('JSON Schema', () => {
    const schema = (json, options) => JSON.parse(gen(json, { target: 'schema', ...options }))

    it('produces draft-07 schemas with required, nested objects, arrays and unions', () => {
        const s = schema(SAMPLE, { rootName: 'my root' })
        expect(s.$schema).toBe('http://json-schema.org/draft-07/schema#')
        expect(s.title).toBe('MyRoot')
        expect(s.type).toBe('object')
        expect(s.required).toEqual(['id', 'name', 'score', 'tags', 'owner', 'items', 'user-name', 'ok', 'mixed'])
        expect(s.properties.id).toEqual({ type: 'integer' })
        expect(s.properties.score).toEqual({ type: 'number' })
        expect(s.properties.owner.properties.site).toEqual({ type: 'null' })
        expect(s.properties.items.items.required).toEqual(['a'])
        expect(s.properties.items.items.properties.b).toEqual({ type: 'string' })
        expect(s.properties.mixed.items).toEqual({ anyOf: [{ type: 'integer' }, { type: 'string' }] })
    })

    it('describes scalars at the top level', () => {
        expect(schema('"x"')).toEqual({ $schema: 'http://json-schema.org/draft-07/schema#', title: 'Root', type: 'string' })
    })

    it('validates the sample it was generated from (spot check by structure)', () => {
        const s = schema('{"a":[1,2],"b":{"c":true}}')
        expect(s.properties.a).toEqual({ type: 'array', items: { type: 'integer' } })
        expect(s.properties.b.properties.c).toEqual({ type: 'boolean' })
    })

    it('output is valid, 2-space indented JSON', () => {
        const text = gen('{"a":1}', { target: 'schema' })
        expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2))
    })
})

describe('parseJsonSample', () => {
    it('parses like JSON.parse and throws on invalid JSON', () => {
        expect(parseJsonSample('{"a":[1,2]}')).toEqual({ a: [1, 2] })
        expect(() => parseJsonSample('{a:1}')).toThrow(SyntaxError)
    })
})
