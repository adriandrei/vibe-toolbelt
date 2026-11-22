import { describe, it, expect } from 'vitest'
import { Validator } from '@cfworker/json-schema'
import {
    EXAMPLE_DATA, EXAMPLE_SCHEMA,
    detectDraft, formatJson, friendlyPath, lintSchema, loadValidator, locationSegments, parseDocument,
    readableLocation, toJsonPointer, validateData,
} from './schemaValidate.js'

const run = (schema, data, draft = '2020-12') => validateData(Validator, schema, data, draft)
const brief = (causes) => causes.map(c => [c.path, c.keyword, c.message])

describe('reading input', () => {
    it('reads JSON', () => {
        expect(parseDocument('{"a": [1, 2]}')).toEqual({ status: 'ok', value: { a: [1, 2] }, format: 'json' })
        expect(parseDocument('"text"')).toEqual({ status: 'ok', value: 'text', format: 'json' })
        expect(parseDocument(`${String.fromCharCode(0xfeff)}{"a": 1}`).value).toEqual({ a: 1 })
        expect(formatJson(`${String.fromCharCode(0xfeff)}{"a":1}`)).toBe('{\n  "a": 1\n}')
        expect(parseDocument('   ')).toEqual({ status: 'empty' })
    })

    it('reads YAML when the text is not JSON', () => {
        const r = parseDocument('type: object\nrequired: [name]\nproperties:\n  name: { type: string }\n')
        expect(r.status).toBe('ok')
        expect(r.format).toBe('yaml')
        expect(r.value).toEqual({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } })
        // dates stay strings (YAML 1.2 core schema)
        expect(parseDocument('released: 2024-05-01').value).toEqual({ released: '2024-05-01' })
    })

    it('does not read broken JSON as YAML', () => {
        const r = parseDocument('{"a": }')
        expect(r.status).toBe('error')
        expect(r.format).toBe('json')
        const trailing = parseDocument('{\n  "a": 1\n  "b": 2\n}')
        expect(trailing.message).toMatch(/line 3/)
    })

    it('reports YAML errors with their position', () => {
        const r = parseDocument('key: value\n  bad indent: 1')
        expect(r.status).toBe('error')
        expect(r.message).toMatch(/line 2, column 13/)
        expect(parseDocument('a: 1\na: 2').message).toMatch(/duplicated mapping key/)
        expect(parseDocument('# only a comment').message).toMatch(/only comments/)
    })

    it('rejects values JSON cannot hold', () => {
        expect(parseDocument('x: .inf').status).toBe('error')
        expect(parseDocument('x: .nan').message).toMatch(/no JSON equivalent/)
    })
})

describe('formatJson', () => {
    it('pretty-prints without changing numbers or strings', () => {
        const text = '{"big":12345678901234567890,"f":1.0,"s":"a\\"b,c:{d}","e":[],"o":{},"n":[1,[2,{"x":null}]]}'
        expect(formatJson(text)).toBe(`{
  "big": 12345678901234567890,
  "f": 1.0,
  "s": "a\\"b,c:{d}",
  "e": [],
  "o": {},
  "n": [
    1,
    [
      2,
      {
        "x": null
      }
    ]
  ]
}`)
        expect(JSON.parse(formatJson(text, 4))).toEqual(JSON.parse(text))
    })
})

describe('drafts', () => {
    it('reads the draft from $schema', () => {
        expect(detectDraft({ $schema: 'https://json-schema.org/draft/2020-12/schema' })).toEqual({ draft: '2020-12', source: 'schema' })
        expect(detectDraft({ $schema: 'https://json-schema.org/draft/2019-09/schema' }).draft).toBe('2019-09')
        expect(detectDraft({ $schema: 'http://json-schema.org/draft-07/schema#' }).draft).toBe('7')
        expect(detectDraft({ $schema: 'http://json-schema.org/draft-04/schema#' }).draft).toBe('4')
        expect(detectDraft({ $schema: 'http://json-schema.org/draft-06/schema#' })).toMatchObject({ draft: '7', note: expect.stringMatching(/draft-07/) })
        expect(detectDraft({ $schema: 'http://json-schema.org/draft-03/schema#' })).toMatchObject({ draft: '4', note: expect.stringMatching(/isn’t supported/) })
    })

    it('defaults to 2020-12', () => {
        expect(detectDraft({ type: 'string' })).toEqual({ draft: '2020-12', source: 'default' })
        expect(detectDraft(true)).toEqual({ draft: '2020-12', source: 'default' })
        expect(detectDraft({ $schema: 'https://example.com/custom' })).toMatchObject({ draft: '2020-12', source: 'default', note: expect.stringMatching(/Unknown/) })
    })
})

describe('pointers and paths', () => {
    it('decodes locations', () => {
        expect(locationSegments('#')).toEqual([])
        expect(locationSegments('#/items/2/price')).toEqual(['items', '2', 'price'])
        expect(locationSegments('#/a~1b/c%20d/%C3%A9/~0x')).toEqual(['a/b', 'c d', 'é', '~x'])
        expect(toJsonPointer(['a/b', 'c d', '~x'])).toBe('/a~1b/c d/~0x')
        expect(toJsonPointer([])).toBe('')
        expect(readableLocation('#/properties/c%20d/type')).toBe('#/properties/c d/type')
    })

    it('builds friendly paths from the data', () => {
        const data = { items: [{ price: 1 }], 'unit price': 2, '0': { a: 1 } }
        expect(friendlyPath(['items', '0', 'price'], data)).toBe('$.items[0].price')
        expect(friendlyPath(['unit price'], data)).toBe('$["unit price"]')
        expect(friendlyPath(['0', 'a'], data)).toBe('$["0"].a')
        expect(friendlyPath([], data)).toBe('$')
    })
})

describe('validation', () => {
    it('loads the validator on demand', async () => {
        expect(await loadValidator()).toBe(Validator)
    })

    it('explains the example: real causes first, wrappers kept as summaries', () => {
        const schema = JSON.parse(EXAMPLE_SCHEMA)
        const data = JSON.parse(EXAMPLE_DATA)
        expect(lintSchema(schema, '2020-12')).toEqual({ errors: [], warnings: [] })
        const r = run(schema, data)
        expect(r.status).toBe('invalid')
        expect(brief(r.causes)).toEqual([
            ['$.items[1].quantity', 'minimum', 'Must be at least 1 (got 0).'],
            ['$.items[2].price', 'type', 'Expected a number, got the string "4.99".'],
            ['$.status', 'enum', 'Must be one of "pending", "paid" or "shipped" (got "refunded").'],
        ])
        expect(r.causes[1]).toMatchObject({ pointer: '/items/2/price', schemaPointer: '#/properties/items/items/properties/price/type' })
        expect(r.summaries.map(s => [s.keyword, s.message])).toEqual([
            ['properties', 'Property "items" has errors.'],
            ['items', 'Item 1 has errors.'],
            ['properties', 'Property "quantity" has errors.'],
            ['items', 'Item 2 has errors.'],
            ['properties', 'Property "price" has errors.'],
            ['properties', 'Property "status" has errors.'],
        ])
        expect(r.raw).toHaveLength(9)
    })

    it('reports valid data', () => {
        expect(run({ type: 'object' }, {})).toEqual({ status: 'valid' })
        expect(run(true, 42)).toEqual({ status: 'valid' })
    })

    it('turns false schemas into readable causes with the right schema location', () => {
        const r = run({ properties: { a: { type: 'string' } }, additionalProperties: false }, { a: 'x', extra: 1 })
        expect(brief(r.causes)).toEqual([['$.extra', 'additionalProperties', 'Property "extra" isn’t allowed: the schema doesn’t allow additional properties.']])
        expect(r.causes[0].schemaPointer).toBe('#/additionalProperties')

        const forbidden = run({ properties: { secret: false } }, { secret: 1 })
        expect(forbidden.causes[0]).toMatchObject({ keyword: 'properties', schemaPointer: '#/properties/secret', path: '$.secret' })

        const root = run(false, 1)
        expect(brief(root.causes)).toEqual([['$', 'false', 'The schema is false, so no value is valid.']])

        const tuple = run({ prefixItems: [{ type: 'string' }], items: false }, ['a', 2])
        expect(tuple.causes[0]).toMatchObject({ path: '$[1]', keyword: 'items', schemaPointer: '#/items' })

        const old = run({ items: [{ type: 'string' }, false], additionalItems: false }, ['a', 2, 3], '7')
        expect(old.causes.map(c => [c.path, c.keyword, c.schemaPointer])).toEqual([
            ['$[1]', 'items', '#/items/1'],
            ['$[2]', 'additionalItems', '#/additionalItems'],
        ])

        const elseFalse = run({ if: { properties: { t: { const: 'a' } } }, then: { required: ['x'] }, else: false }, { t: 'b' })
        expect(elseFalse.causes[0]).toMatchObject({ keyword: 'else', schemaPointer: '#/else' })
    })

    it('keeps anyOf as one cause with the options as details', () => {
        const r = run({ anyOf: [{ type: 'string' }, { type: 'number', minimum: 5 }] }, 3)
        expect(brief(r.causes)).toEqual([['$', 'anyOf', 'Doesn’t match any of the allowed options (anyOf).']])
        expect(r.causes[0].details.map(d => [d.label, d.causes.map(c => c.message)])).toEqual([
            ['Option 1', ['Expected a string, got the number 3.']],
            ['Option 2', ['Must be at least 5 (got 3).']],
        ])

        const nested = run({ anyOf: [{ properties: { a: { type: 'string' } } }, false] }, { a: 1 })
        expect(nested.causes).toHaveLength(1)
        expect(nested.causes[0].details.map(d => d.label)).toEqual(['Option 1', 'Another option'])

        const many = run({ oneOf: [{ type: 'number' }, { minimum: 1 }] }, 3)
        expect(brief(many.causes)).toEqual([['$', 'oneOf', 'Matches 2 options, but oneOf allows exactly one.']])
    })

    it('follows $ref and shows where it went', () => {
        const r = run({ $defs: { pos: { type: 'integer', minimum: 0 } }, properties: { n: { $ref: '#/$defs/pos' } } }, { n: -1 })
        expect(brief(r.causes)).toEqual([['$.n', 'minimum', 'Must be at least 0 (got -1).']])
        expect(r.causes[0].schemaPointer).toBe('#/properties/n/$ref/minimum')
        expect(r.summaries.map(s => s.message)).toEqual(['Property "n" has errors.', 'Doesn’t match the referenced schema (#/$defs/pos).'])
    })

    it('groups minContains failures', () => {
        const r = run({ contains: { type: 'string' }, minContains: 2 }, [1, 'a', 2])
        expect(brief(r.causes)).toEqual([['$', 'minContains', 'Only 1 item matches "contains"; at least 2 must.']])
        expect(r.causes[0].details[0].causes.map(c => c.path)).toEqual(['$[0]', '$[2]'])
    })

    it('explains other keywords plainly', () => {
        const cases = [
            [{ required: ['name'] }, {}, 'Missing required property "name".'],
            [{ type: ['string', 'null'] }, 5, 'Expected a string or null, got the number 5.'],
            [{ type: 'integer' }, 2.5, 'Expected an integer, got the number 2.5.'],
            [{ const: 'a' }, 'b', 'Must be "a" (got "b").'],
            [{ maximum: 10 }, 11, 'Must be at most 10 (got 11).'],
            [{ exclusiveMinimum: 0 }, 0, 'Must be greater than 0 (got 0).'],
            [{ exclusiveMaximum: 5 }, 5, 'Must be less than 5 (got 5).'],
            [{ multipleOf: 0.5 }, 0.3, 'Must be a multiple of 0.5 (got 0.3).'],
            [{ minLength: 3 }, 'ab', 'Must be at least 3 characters long (it has 2).'],
            [{ maxLength: 1 }, 'ab', 'Must be at most 1 character long (it has 2).'],
            [{ pattern: '^[a-z]+$' }, 'A1', 'Doesn’t match the pattern ^[a-z]+$ (got "A1").'],
            [{ format: 'email' }, 'nope', 'Isn’t a valid email address (got "nope").'],
            [{ format: 'date' }, '2024-02-30', 'Isn’t a valid date (YYYY-MM-DD) (got "2024-02-30").'],
            [{ minItems: 2 }, [1], 'Must have at least 2 items (it has 1).'],
            [{ maxItems: 1 }, [1, 2], 'Must have at most 1 item (it has 2).'],
            [{ uniqueItems: true }, [1, 2, 1], 'Items 0 and 2 are the same, but items must be unique.'],
            [{ contains: { type: 'string' } }, [1], 'Has no item that matches the "contains" schema.'],
            [{ contains: { type: 'string' } }, [], 'Is empty, but must contain an item that matches "contains".'],
            [{ minProperties: 3 }, { a: 1 }, 'Must have at least 3 properties (it has 1).'],
            [{ maxProperties: 1 }, { a: 1, b: 2 }, 'Must have at most 1 property (it has 2).'],
            [{ not: { type: 'string' } }, 'x', 'Matches the "not" schema, so it isn’t allowed.'],
            [{ dependentRequired: { a: ['b'] } }, { a: 1 }, 'Has "a", so it must also have "b".'],
        ]
        for (const [schema, data, message] of cases) {
            const r = run(schema, data)
            expect(r.causes.map(c => c.message), JSON.stringify(schema)).toEqual([message])
        }
        expect(run({ dependentRequired: { a: ['b'] } }, { a: 1 }).causes[0].schemaPointer).toBe('#/dependentRequired')
        expect(run({ minimum: 5, exclusiveMinimum: true }, 5, '4').causes[0].message).toBe('Must be greater than 5 (got 5).')
    })

    it('checks property names against the key itself', () => {
        const r = run({ propertyNames: { pattern: '^[a-z]+$' } }, { Abc: 1, ok: 2 })
        expect(brief(r.causes)).toEqual([['$.Abc', 'pattern', 'Doesn’t match the pattern ^[a-z]+$ (got "Abc").']])
        expect(r.summaries[0].message).toBe('The property name "Abc" isn’t allowed.')
    })

    it('handles keys that need escaping', () => {
        const r = run({ properties: { 'a/b': { type: 'string' }, 'c d': { type: 'string' } } }, { 'a/b': 1, 'c d': 2 })
        expect(r.causes.map(c => [c.pointer, c.path, c.schemaPointer])).toEqual([
            ['/a~1b', '$["a/b"]', '#/properties/a~1b/type'],
            ['/c d', '$["c d"]', '#/properties/c d/type'],
        ])
    })

    it('reports schemas the validator cannot use, separately from data errors', () => {
        const unresolved = run({ properties: { n: { $ref: '#/$defs/nope' } } }, { n: 1 })
        expect(unresolved.status).toBe('schema-error')
        expect(unresolved.message).toMatch(/Can’t resolve "\$ref": "#\/\$defs\/nope"/)
        expect(run({ pattern: '[' }, 'x')).toMatchObject({ status: 'schema-error', message: expect.stringMatching(/invalid regular expression/) })
        expect(run({ $defs: { a: { $id: 'http://x/a' }, b: { $id: 'http://x/a' } } }, 1)).toMatchObject({ status: 'schema-error', message: expect.stringMatching(/same URI/) })
        expect(run({ $ref: '#' }, 1).message).toMatch(/too deep/)
    })
})

describe('schema checks', () => {
    const lint = (schema, draft) => lintSchema(schema, draft)

    it('requires an object or a boolean', () => {
        expect(lint([1, 2]).errors[0].message).toMatch(/must be a JSON object or a boolean.*an array/)
        expect(lint('string').errors).toHaveLength(1)
        expect(lint(null).errors).toHaveLength(1)
        expect(lint(true)).toEqual({ errors: [], warnings: [] })
    })

    it('catches keyword values of the wrong type', () => {
        const { errors } = lint({
            type: 'int',
            required: 'name',
            enum: 'abc',
            properties: { a: { type: 'string', required: true }, b: 5 },
            minLength: -1,
            pattern: '[',
            allOf: [],
            multipleOf: 0,
        })
        expect(errors.map(e => [e.pointer, e.message])).toEqual([
            ['/type', '"int" isn’t a JSON Schema type. Did you mean "integer"? Types are array, boolean, integer, null, number, object, string.'],
            ['/required', '"required" must be an array of property names.'],
            ['/enum', '"enum" must be an array of allowed values.'],
            ['/properties/a/required', '"required": true is draft-03 style. List the required property names in the parent object’s "required" array instead.'],
            ['/properties/b', 'This should be a schema (an object, or true/false), but it’s a number.'],
            ['/minLength', '"minLength" must be a whole number, 0 or more.'],
            ['/pattern', expect.stringMatching(/^Invalid regular expression: /)],
            ['/allOf', '"allOf" must be a non-empty array of schemas.'],
            ['/multipleOf', '"multipleOf" must be a number greater than 0.'],
        ])
    })

    it('catches draft-specific syntax used with the wrong draft', () => {
        expect(lint({ minimum: 0, exclusiveMinimum: true }, '2020-12').errors[0].message).toMatch(/draft-04 style/)
        expect(lint({ minimum: 0, exclusiveMinimum: true }, '4').errors).toEqual([])
        expect(lint({ exclusiveMinimum: 0 }, '4').errors[0].message).toMatch(/In draft-04/)
        expect(lint({ items: [{ type: 'string' }] }, '2020-12').warnings[0].message).toMatch(/prefixItems/)
        expect(lint({ items: [{ type: 'string' }] }, '7').warnings).toEqual([])
    })

    it('checks local $refs', () => {
        expect(lint({ $ref: '#/$defs/missing' }).errors[0]).toEqual({ pointer: '/$ref', message: '"$ref" points to #/$defs/missing, which doesn’t exist in this schema.' })
        expect(lint({ $defs: { a: { type: 'string' } }, $ref: '#/$defs/a' }).errors).toEqual([])
        // Inside a subschema with its own $id, "#/…" is relative to that $id: not checked here
        expect(lint({ $defs: { a: { $id: 'http://x/a', $ref: '#/nope' } } }).errors).toEqual([])
        expect(lint({ $ref: 'https://example.com/other.json' }).warnings[0].message).toMatch(/aren’t downloaded/)
    })

    it('warns about likely typos and ignored keywords', () => {
        const { warnings } = lint({
            type: 'object',
            propertys: {},
            properties: { name: { type: 'string', maxlength: 5, nullable: true, format: 'phone', 'x-custom': 1, myAnnotation: 'fine' } },
            $dynamicRef: '#meta',
        })
        expect(warnings.map(w => [w.pointer, w.message])).toEqual([
            ['/propertys', 'Unknown keyword "propertys" is ignored. Did you mean "properties"?'],
            ['/properties/name/maxlength', 'Unknown keyword "maxlength" is ignored. Did you mean "maxLength"?'],
            ['/properties/name/nullable', expect.stringMatching(/OpenAPI 3\.0 keyword/)],
            ['/properties/name/format', 'The format "phone" isn’t checked by this validator, so any string passes.'],
            ['/$dynamicRef', '"$dynamicRef" isn’t supported by this validator and is ignored.'],
        ])
    })

    it('warns when required properties can never be valid', () => {
        const { warnings } = lint({ required: ['sku'], properties: { id: {} }, additionalProperties: false })
        expect(warnings[0].message).toMatch(/"sku" is required but not listed in "properties"/)
    })
})
