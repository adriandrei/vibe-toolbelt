import { describe, expect, it } from 'vitest'
import { CASES, splitWords, toAlternatingCase, toInverseCase, toSentenceCase, toTitleCase } from './caseConvert'

const convert = (id, text) => CASES.find(c => c.id === id).convert(text)

describe('splitWords', () => {
    it.each([
        ['XMLHttpRequest', ['XML', 'Http', 'Request']],
        ['getHTTPResponseCode', ['get', 'HTTP', 'Response', 'Code']],
        ['user_id2Name', ['user', 'id2', 'Name']],
        ['ärgerÜber', ['ärger', 'Über']],
        ['hello-world foo.bar/baz', ['hello', 'world', 'foo', 'bar', 'baz']],
        ["don't stop", ['dont', 'stop']],
        ['日本語テキスト', ['日本語テキスト']],
        ['version 2 of 42nd', ['version', '2', 'of', '42nd']],
        ['  --  ', []],
    ])('splits %j', (input, expected) => {
        expect(splitWords(input)).toEqual(expected)
    })

    it('handles empty input', () => {
        expect(splitWords('')).toEqual([])
        expect(splitWords(undefined)).toEqual([])
    })

    it('normalises decomposed characters', () => {
        expect(splitWords('café au lait')).toEqual(['café', 'au', 'lait'])
    })
})

describe('identifier cases', () => {
    const input = 'XMLHttpRequest is Cool_thing'
    it.each([
        ['camel', 'xmlHttpRequestIsCoolThing'],
        ['pascal', 'XmlHttpRequestIsCoolThing'],
        ['snake', 'xml_http_request_is_cool_thing'],
        ['constant', 'XML_HTTP_REQUEST_IS_COOL_THING'],
        ['kebab', 'xml-http-request-is-cool-thing'],
        ['train', 'Xml-Http-Request-Is-Cool-Thing'],
        ['dot', 'xml.http.request.is.cool.thing'],
        ['path', 'xml/http/request/is/cool/thing'],
    ])('%s', (id, expected) => {
        expect(convert(id, input)).toBe(expected)
    })

    it('converts each line separately and keeps line endings', () => {
        expect(convert('snake', 'fooBar\r\nbaz qux\nZed')).toBe('foo_bar\r\nbaz_qux\nzed')
        expect(convert('camel', 'a b\n\nc d')).toBe('aB\n\ncD')
    })

    it('drops punctuation', () => {
        expect(convert('kebab', 'Hello, World! (v2)')).toBe('hello-world-v2')
    })

    it('flags the identifier styles', () => {
        expect(CASES.filter(c => c.identifier).map(c => c.id)).toEqual(['camel', 'pascal', 'snake', 'constant', 'kebab', 'train', 'dot', 'path'])
    })
})

describe('simple cases', () => {
    it('lower and upper use full Unicode mapping', () => {
        expect(convert('lower', 'ÄÖÜ')).toBe('äöü')
        expect(convert('upper', 'straße')).toBe('STRASSE')
        expect(convert('lower', 'HELLO')).toBe('hello')
    })
    it('alternating skips non-letters when counting', () => {
        expect(toAlternatingCase('hello world 1 ab')).toBe('hElLo WoRlD 1 aB')
    })
    it('inverse swaps case', () => {
        expect(toInverseCase('Hello World 42')).toBe('hELLO wORLD 42')
        expect(toInverseCase('')).toBe('')
    })
})

describe('toTitleCase', () => {
    it('capitalises words and keeps deliberate casing', () => {
        expect(toTitleCase('the quick brown fox')).toBe('The Quick Brown Fox')
        expect(toTitleCase('i bought an iPhone from NASA, said McDonald')).toBe('I Bought An iPhone From NASA, Said McDonald')
    })
    it('recases shouting', () => {
        expect(toTitleCase('HELLO THERE WORLD')).toBe('Hello There World')
    })
    it('keeps apostrophes inside words and handles Unicode', () => {
        expect(toTitleCase("don't über straße")).toBe("Don't Über Straße")
    })
    it('keeps single capital letters and punctuation', () => {
        expect(toTitleCase('a-b c.d')).toBe('A-B C.D')
    })
})

describe('toSentenceCase', () => {
    it('capitalises the start and after sentence ends', () => {
        expect(toSentenceCase('hello world. this is a test! is it? yes')).toBe('Hello world. This is a test! Is it? Yes')
    })
    it('capitalises each line', () => {
        expect(toSentenceCase('first line\nsecond line')).toBe('First line\nSecond line')
    })
    it('does not start a new sentence after an abbreviation', () => {
        expect(toSentenceCase('use tools, e.g. a hammer. then rest')).toBe('Use tools, e.g. a hammer. Then rest')
        expect(toSentenceCase('ask dr. smith today')).toBe('Ask dr. smith today')
    })
    it('capitalises the pronoun I and contractions', () => {
        expect(toSentenceCase('yes i think i\'m right')).toBe("Yes I think I'm right")
    })
    it('keeps acronyms and mixed case unless the text is all caps', () => {
        expect(toSentenceCase('the NASA iPhone')).toBe('The NASA iPhone')
        expect(toSentenceCase('THE NASA SHOUT. ANOTHER ONE')).toBe('The nasa shout. Another one')
    })
    it('handles closing quotes before the next sentence', () => {
        expect(toSentenceCase('he said "go." then left')).toBe('He said "go." Then left')
    })
    it('returns empty text unchanged', () => {
        expect(toSentenceCase('')).toBe('')
    })
})
