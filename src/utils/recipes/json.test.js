import { describe, expect, it } from 'vitest'
import { JsonError, describeJsonError, hasMovableKeys, lineColumn, parseJsonTree, printJsonTree, treeToValue } from './json.js'

const format = (text, options) => printJsonTree(parseJsonTree(text).tree, options)

describe('JSON tree parser and printer', () => {
    const canonical = '{"name":"Vibe","version":2,"tags":["dev","tools"],"owner":{"name":"Ada","active":true,"x":null},"items":[{"id":1,"price":9.5},[],{}],"e":""}'

    it('prints canonical JSON exactly like JSON.stringify', () => {
        const value = JSON.parse(canonical)
        expect(format(canonical, { indent: '  ' })).toBe(JSON.stringify(value, null, 2))
        expect(format(canonical, { indent: '    ' })).toBe(JSON.stringify(value, null, 4))
        expect(format(canonical, { indent: '\t' })).toBe(JSON.stringify(value, null, '\t'))
        expect(format(JSON.stringify(value, null, 2))).toBe(JSON.stringify(value))
    })

    it('keeps numbers, key order, escapes and duplicates as written', () => {
        const source = '{ "b": 1, "10": 12345678901234567890, "a": 1.0, "e": 1E+3, "s": "caf\\u00e9 \\/ \\"x\\"", "b": -0 }'
        expect(format(source)).toBe('{"b":1,"10":12345678901234567890,"a":1.0,"e":1E+3,"s":"caf\\u00e9 \\/ \\"x\\"","b":-0}')
        expect(parseJsonTree(source).duplicates).toEqual(['b'])
    })

    it('sorts keys by code point at every level, keeping arrays in order', () => {
        const source = '{"b":{"z":1,"y":[{"d":1,"c":2}]},"a":0,"é":1,"Z":2,"😀":3,"10":4,"9":5}'
        expect(format(source, { sortKeys: true })).toBe('{"10":4,"9":5,"Z":2,"a":0,"b":{"y":[{"c":2,"d":1}],"z":1},"é":1,"😀":3}')
    })

    it('accepts a byte order mark and surrounding whitespace', () => {
        expect(format('﻿ \n [1, 2]\n')).toBe('[1,2]')
    })

    it('rejects invalid JSON with a precise message and position', () => {
        const cases = [
            ['{"a":1,}', 'trailing commas aren’t allowed: remove the last “,” (line 1, column 7)'],
            ['[1,2,]', 'trailing commas aren’t allowed: remove the last “,” (line 1, column 5)'],
            ["{'a':1}", 'keys need double quotes ("key"), not single quotes (line 1, column 2)'],
            ['{a:1}', 'keys must be in double quotes: write "a" (line 1, column 2)'],
            ['{"a":1}\n x', 'there’s more after the JSON value (“x”). Only one value is allowed; for JSON Lines, split the lines first (line 2, column 2)'],
            ['{"a":01}', 'numbers can’t have leading zeros (line 1, column 7)'],
            ['{"a":1.}', 'a number needs digits after its decimal point (line 1, column 8)'],
            ['[NaN]', '“NaN” isn’t a JSON value (only numbers, strings, objects, arrays, true, false and null are) (line 1, column 2)'],
            ['[True]', '“True” isn’t a JSON value: write true in lower case (line 1, column 2)'],
            ['{"a":1 // c\n}', 'expected “,” or “}” after a value, found “/” (line 1, column 8)'],
            ['["a\nb"]', 'a string contains a line break: write it as \\n (line 1, column 4)'],
            ['["\\x"]', '“\\x” isn’t a valid escape (use \\" \\\\ \\/ \\b \\f \\n \\r \\t or \\uXXXX) (line 1, column 3)'],
            ['["\\u12"]', '“\\u” must be followed by four hex digits (line 1, column 3)'],
            ['{"a" 1}', 'expected “:” after the key, found “1” (line 1, column 6)'],
            ['{"a":1', 'the input ended inside an object: a “}” is missing (line 1, column 7)'],
            ['["abc', 'a string isn’t closed: the closing " is missing (line 1, column 2)'],
            ['', 'the input is empty: there’s no JSON to read (line 1, column 1)'],
        ]
        for (const [source, message] of cases) {
            let error = null
            try {
                parseJsonTree(source)
            } catch (e) {
                error = e
            }
            expect(error, source).toBeInstanceOf(JsonError)
            expect(describeJsonError(source, error), source).toBe(message)
            // Native JSON.parse agrees that it's invalid
            expect(() => JSON.parse(source), source).toThrow()
        }
    })

    it('limits nesting instead of overflowing the stack', () => {
        expect(() => parseJsonTree('['.repeat(5000) + ']'.repeat(5000))).toThrow(/nested more than 2,000 levels/)
        expect(format('['.repeat(1500) + ']'.repeat(1500))).toBe('['.repeat(1500) + ']'.repeat(1500))
    })

    it('converts to plain values with exact big integers and own __proto__ keys', () => {
        const value = treeToValue(parseJsonTree('{"big":12345678901234567890,"n":-5,"f":0.5,"s":"\\u00e9","__proto__":{"x":1},"a":[true,null]}').tree)
        expect(value.big).toBe(12345678901234567890n)
        expect(value).toMatchObject({ n: -5, f: 0.5, s: 'é', a: [true, null] })
        expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
        expect(Object.keys(value)).toContain('__proto__')
        expect(value.__proto__).toEqual({ x: 1 })
    })

    it('detects integer-like keys that JavaScript would move', () => {
        expect(hasMovableKeys(parseJsonTree('{"a":1,"10":2}').tree)).toBe(true)
        expect(hasMovableKeys(parseJsonTree('{"2":1,"1":2}').tree)).toBe(true)
        expect(hasMovableKeys(parseJsonTree('{"1":1,"2":2,"a":3,"b":{"x":[{"1":0}]}}').tree)).toBe(false)
        expect(hasMovableKeys(parseJsonTree('[{"b":1,"7":2}]').tree)).toBe(true)
    })

    it('computes 1-based line and column', () => {
        expect(lineColumn('ab\ncd\nef', 7)).toEqual({ line: 3, column: 2 })
        expect(lineColumn('abc', 0)).toEqual({ line: 1, column: 1 })
    })
})
