import { describe, expect, it } from 'vitest'
import { KEEPS_NUMBER_TEXT, canonicalJson, lineColumn, prepareJsonSide, scanJson } from './jsonCompare'

const canonical = (text, options) => {
    const side = prepareJsonSide(text, options)
    expect(side.status).toBe('ok')
    return side.text
}

describe('canonical form', () => {
    it('ignores key order and formatting at every level', () => {
        const a = '{"b":1,"a":{"y":[1,{"q":true,"p":null}],"x":"s"}}'
        const b = `{
            "a": { "x": "s",   "y": [ 1, { "p": null, "q": true } ] },
            "b": 1
        }`
        expect(canonical(a)).toBe(canonical(b))
        expect(canonical(a)).toBe([
            '{',
            '  "a": {',
            '    "x": "s",',
            '    "y": [',
            '      1,',
            '      {',
            '        "p": null,',
            '        "q": true',
            '      }',
            '    ]',
            '  },',
            '  "b": 1',
            '}',
        ].join('\n'))
    })

    it('matches JSON.stringify with 2 spaces for already-sorted data', () => {
        const value = { a: [], b: {}, c: [[]], d: 'line\nbreak "quoted" \\ tab\t', e: -1.5, f: false }
        expect(canonical(JSON.stringify(value))).toBe(JSON.stringify(value, null, 2))
    })

    it('keeps array order significant', () => {
        expect(canonical('[1,2,3]')).not.toBe(canonical('[3,2,1]'))
        expect(canonical('{"a":[{"x":1},{"y":2}]}')).not.toBe(canonical('{"a":[{"y":2},{"x":1}]}'))
    })

    it('orders keys the same way whatever the input order, numeric keys included', () => {
        const text = canonical('{"b":1,"10":2,"a":3,"2":4,"B":5}')
        expect(canonical('{"2":4,"a":3,"B":5,"10":2,"b":1}')).toBe(text)
        expect(Object.keys(JSON.parse(text))).toEqual(['2', '10', 'B', 'a', 'b'])
    })

    it('treats different escapes of the same string as equal', () => {
        expect(canonical('{"k":"\\u00e9\\/x"}')).toBe(canonical('{"k":"é/x"}'))
        expect(canonical('{"\\u0061":1}')).toBe(canonical('{"a":1}'))
    })

    it('keeps a "__proto__" key as data, without touching prototypes', () => {
        const text = canonical('{"z":1,"__proto__":{"polluted":true}}')
        expect(text).toBe('{\n  "__proto__": {\n    "polluted": true\n  },\n  "z": 1\n}')
        expect({}.polluted).toBeUndefined()
    })

    it('handles top-level values and empty containers', () => {
        expect(canonical('  42 ')).toBe('42')
        expect(canonical('"x"')).toBe('"x"')
        expect(canonical('null')).toBe('null')
        expect(canonical('[ ]')).toBe('[]')
        expect(canonical('{ }')).toBe('{}')
        expect(canonical('\ufeff{"a":1}')).toBe('{\n  "a": 1\n}')
        expect(canonicalJson({ b: [], a: {} })).toBe('{\n  "a": {},\n  "b": []\n}')
    })
})

describe('numbers', () => {
    it('this runtime keeps number text (Node and current browsers do)', () => {
        expect(KEEPS_NUMBER_TEXT).toBe(true)
    })

    it('keeps numbers exactly as written', () => {
        expect(canonical('{"a":1.0,"b":1e3,"c":-0,"d":1E-7,"e":0.10}')).toBe('{\n  "a": 1.0,\n  "b": 1e3,\n  "c": -0,\n  "d": 1E-7,\n  "e": 0.10\n}')
        expect(canonical('[1.0]')).not.toBe(canonical('[1]'))
    })

    it('tells apart integers above 2^53 that a Number would round to the same value', () => {
        expect(12345678901234567890).toBe(12345678901234567891) // eslint-disable-line no-loss-of-precision
        const a = canonical('{"id":12345678901234567890}')
        const b = canonical('{"id":12345678901234567891}')
        expect(a).toBe('{\n  "id": 12345678901234567890\n}')
        expect(a).not.toBe(b)
    })

    it('falls back to JavaScript numbers when the browser can’t keep the text', () => {
        expect(canonical('[1.0, 1e3]', { keepNumberText: false })).toBe('[\n  1,\n  1000\n]')
        expect(canonical('[1.0]', { keepNumberText: false })).toBe(canonical('[1]', { keepNumberText: false }))
    })
})

describe('invalid JSON', () => {
    const cases = [
        ['{"a": 1,}', /^Trailing comma: remove the “,” before “}”\.$/, 1, 8],
        ['[1, 2,\n]', /^Trailing comma: remove the “,” before “]”\.$/, 1, 6],
        ['{\n  "a": 1\n  "b": 2\n}', /^Expected “,” or “}” but found “"”\.$/, 3, 3],
        ["{'a': 1}", /^Property names must be in double quotes/, 1, 2],
        ["['a']", /^Strings must be in double quotes/, 1, 2],
        ['{a: 1}', /^Expected a property name in double quotes but found “a”\.$/, 1, 2],
        ['[1, 2', /^Unexpected end of the text: “]” is missing\.$/, 1, 6],
        ['{"a": 1', /^Unexpected end of the text: “}” is missing\.$/, 1, 8],
        ['{"a":', /^Unexpected end of the text: a value is missing\.$/, 1, 6],
        ['{"a": "abc', /^This string is never closed/, 1, 7],
        ['{"a": "x\ny"}', /^Line break inside a string/, 1, 9],
        ['"\u0001"', /^The control character U\+0001 can’t appear inside a string/, 1, 2],
        ['{"a": 01}', /^Numbers can’t have leading zeros/, 1, 7],
        ['{"a": 1.}', /^A decimal point must be followed by a digit\.$/, 1, 8],
        ['[1.5.2]', /^Unexpected “\.” in a number\.$/, 1, 5],
        ['[1e]', /^An exponent must be followed by a digit\.$/, 1, 3],
        ['[-]', /^A minus sign must be followed by a digit\.$/, 1, 2],
        ['{"a": .5}', /^Numbers must start with a digit/, 1, 7],
        ['[+1]', /^Numbers can’t start with “\+”\.$/, 1, 2],
        ['{"a": undefined}', /^“undefined” isn’t allowed in JSON/, 1, 7],
        ['[NaN]', /^“NaN” isn’t allowed in JSON/, 1, 2],
        ['{"a": True}', /^“True” isn’t a JSON value\. JSON writes true, false and null in lower case\.$/, 1, 7],
        ['[trueish]', /^Unexpected “trueish”\. Text values must be in double quotes\.$/, 1, 2],
        ['// note\n{}', /^Comments aren’t allowed in JSON\.$/, 1, 1],
        ['{"a": 1 /* x */}', /^Comments aren’t allowed in JSON\.$/, 1, 9],
        ['{} {}', /^Unexpected “{” after the end of the JSON/, 1, 4],
        ['{"a": [1, 2}', /^Expected “]” but found “}”: the brackets don’t match\.$/, 1, 12],
        ['{"a": "\\x"}', /^Invalid escape “\\x” in a string/, 1, 8],
        ['{"a": "\\u12"}', /^Invalid escape in a string: “\\u” must be followed by 4 hexadecimal digits\.$/, 1, 8],
        ['{"a"}', /^Expected “:” after the property name but found “}”\.$/, 1, 5],
        ['[1,,2]', /^Expected a value but found “,”\.$/, 1, 4],
        ['[1 2]', /^Expected “,” or “]” but found “2”\.$/, 1, 4],
        ['\t\r\n  [\n\n  @]', /^Expected a value but found “@”\.$/, 4, 3],
    ]

    for (const [text, message, line, column] of cases) {
        it(`explains ${JSON.stringify(text)}`, () => {
            expect(() => JSON.parse(text)).toThrow()
            const side = prepareJsonSide(text)
            expect(side.status).toBe('invalid')
            expect(side.error.message).toMatch(message)
            expect([side.error.line, side.error.column]).toEqual([line, column])
        })
    }

    it('treats an empty or blank side as empty, not invalid', () => {
        expect(prepareJsonSide('')).toEqual({ status: 'empty' })
        expect(prepareJsonSide(' \n\t ')).toEqual({ status: 'empty' })
        expect(prepareJsonSide(undefined)).toEqual({ status: 'empty' })
        expect(scanJson('  ').error.message).toBe('The text is empty.')
    })

    it('reports JSON nested too deeply to compare instead of crashing', () => {
        const deep = `${'['.repeat(200_000)}${']'.repeat(200_000)}`
        expect(prepareJsonSide(deep)).toEqual({ status: 'invalid', error: { message: 'It’s nested too deeply to compare.' } })
    })
})

describe('scanner agrees with JSON.parse', () => {
    const valid = [
        '0', '-0', '-0.0E+00', '1e-7', '123.456e+789', '"\\u0041\\n\\"\\\\\\/"', '"\u2028\u2029"', '"\ud800"', '"😀"',
        'true', 'false', 'null', '[]', '{}', ' \t\n\r[ ] ', '[[[]]]', '{"":""}', '{"a":{"b":[1,{"c":null}]}}',
        '[1,-2,3.5,true,false,null,"x",{},[]]',
    ]
    const invalid = [
        '', ' ', '[', ']', '{', '}', '[1,]', '{"a":1,}', '01', '1.', '.1', '+1', '1e', '-', '--1', "'a'", '"a', '"\\a"', '"\\u00G0"',
        '"\t"', 'tru', 'nul', 'True', '[1 2]', '{"a" 1}', '{1:1}', '{"a":1 "b":2}', '1 2', '{}x', 'NaN', 'Infinity', '-Infinity',
        '[1}', '{"a":[}', '\u00a0[]', '\ufeff[]',
    ]

    for (const text of valid) {
        it(`accepts ${JSON.stringify(text)}`, () => {
            expect(() => JSON.parse(text)).not.toThrow()
            expect(scanJson(text).error).toBeNull()
        })
    }
    for (const text of invalid) {
        it(`rejects ${JSON.stringify(text)}`, () => {
            expect(() => JSON.parse(text)).toThrow()
            expect(scanJson(text).error).not.toBeNull()
        })
    }
})

describe('duplicate keys', () => {
    it('finds keys repeated in the same object, and only there', () => {
        const text = '{"a":1,"b":{"a":2},\n "a":3}'
        const side = prepareJsonSide(text)
        expect(side.status).toBe('ok')
        expect(side.duplicates).toEqual([{ key: 'a', line: 2, column: 2 }])
        expect(side.duplicateCount).toBe(1)
        // JSON.parse keeps the last value, and so does the comparison
        expect(side.text).toBe('{\n  "a": 3,\n  "b": {\n    "a": 2\n  }\n}')
    })

    it('decodes escapes before comparing keys', () => {
        expect(prepareJsonSide('{"a":1,"\\u0061":2}').duplicates).toEqual([{ key: 'a', line: 1, column: 8 }])
    })

    it('lists at most five but counts them all', () => {
        const text = `{${Array.from({ length: 8 }, (_, i) => `"k":${i}`).join(',')}}`
        const side = prepareJsonSide(text)
        expect(side.duplicates).toHaveLength(5)
        expect(side.duplicateCount).toBe(7)
    })

    it('reports none for clean JSON', () => {
        expect(prepareJsonSide('{"a":1,"b":[{"a":1},{"a":2}]}').duplicates).toEqual([])
    })
})

describe('lineColumn', () => {
    it('counts lines and 1-based columns', () => {
        expect(lineColumn('abc', 0)).toEqual({ line: 1, column: 1 })
        expect(lineColumn('ab\ncd', 3)).toEqual({ line: 2, column: 1 })
        expect(lineColumn('ab\r\ncd', 5)).toEqual({ line: 2, column: 2 })
        expect(lineColumn('ab', 2)).toEqual({ line: 1, column: 3 })
    })
})
