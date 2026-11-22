import { describe, expect, it } from 'vitest'
import {
    READING_WPM, analyzeText, charFrequency, codePointLabel, countCodePoints, countGraphemes, countLines, countParagraphs, describeChar,
    formatDuration, getSentences, getWords, shannonEntropy, utf8ByteLength, wordFrequency,
} from './textMetrics'

describe('counting', () => {
    it('countCodePoints counts astral characters once', () => {
        expect(countCodePoints('')).toBe(0)
        expect(countCodePoints('abc')).toBe(3)
        expect(countCodePoints('😀')).toBe(1)
        expect(countCodePoints('a😀b😀')).toBe(4)
        expect(countCodePoints('\ud83d')).toBe(1) // lone surrogate
        expect(countCodePoints('\ud83dx')).toBe(2)
    })
    it('utf8ByteLength matches TextEncoder', () => {
        for (const s of ['', 'abc', 'é', '€', '😀', 'a\ud800b', '日本語', '\u0000', 'x😀y']) {
            expect(utf8ByteLength(s), JSON.stringify(s)).toBe(new TextEncoder().encode(s).length)
        }
    })
    it('countGraphemes counts user-perceived characters', () => {
        expect(countGraphemes('')).toBe(0)
        expect(countGraphemes('é')).toBe(1)
        expect(countGraphemes('👨‍👩‍👧')).toBe(1)
        expect(countGraphemes('🇩🇪🇫🇷')).toBe(2)
        expect(countGraphemes('ab')).toBe(2)
        expect(countGraphemes('\r\n')).toBe(1)
    })
    it('countLines treats \\n, \\r\\n and \\r as breaks', () => {
        expect(countLines('')).toBe(0)
        expect(countLines('a')).toBe(1)
        expect(countLines('a\nb\r\nc\rd')).toBe(4)
        expect(countLines('a\n')).toBe(2)
    })
    it('countParagraphs splits on blank lines, including whitespace-only ones', () => {
        expect(countParagraphs('')).toBe(0)
        expect(countParagraphs('one\ntwo')).toBe(1)
        expect(countParagraphs('one\n\ntwo\n  \nthree')).toBe(3)
        expect(countParagraphs('one\r\n\r\ntwo')).toBe(2)
        expect(countParagraphs('\n\n\n')).toBe(0)
    })
})

describe('getWords', () => {
    it('splits plain text and skips punctuation and emoji', () => {
        expect(getWords("Hello, world! It's 5 o'clock 😀")).toEqual(['Hello', 'world', "It's", '5', "o'clock"])
        expect(getWords('')).toEqual([])
        expect(getWords('... --- !!!')).toEqual([])
    })
    it('keeps hyphenated words and abbreviations together, drops trailing joiners', () => {
        expect(getWords('an e-mail to example.com about e.g something')).toEqual(['an', 'e-mail', 'to', 'example.com', 'about', 'e.g', 'something'])
        expect(getWords('well- done. and end-')).toEqual(['well', 'done', 'and', 'end'])
    })
    it('handles accents and non-Latin scripts', () => {
        expect(getWords('café naïve')).toEqual(['café', 'naïve'])
        expect(getWords('Привет мир')).toEqual(['Привет', 'мир'])
        expect(getWords('日本語のテキスト').length).toBeGreaterThan(1) // dictionary segmentation
    })
})

describe('getSentences', () => {
    it('splits on . ! ?', () => {
        expect(getSentences('One. Two! Three? Four')).toEqual(['One. ', 'Two! ', 'Three? ', 'Four'])
    })
    it('does not split after abbreviations, initials or decimals', () => {
        expect(getSentences('Dr. Smith met Mr. Jones. They talked.')).toHaveLength(2)
        expect(getSentences('J. K. Rowling wrote it. Fine.')).toHaveLength(2)
        expect(getSentences('Pi is 3.14 roughly. Next.')).toHaveLength(2)
        expect(getSentences('Use tools, e.g. a hammer. Then rest.')).toHaveLength(2)
    })
    it('ignores text with no letters or digits', () => {
        expect(getSentences('')).toEqual([])
        expect(getSentences('... !!! ???')).toEqual([])
    })
    it('treats ?! and ellipsis runs as one ending', () => {
        expect(getSentences('Really?! Yes... Okay.')).toHaveLength(3)
    })
})

describe('describeChar / charFrequency', () => {
    it('formats code points', () => {
        expect(codePointLabel(0x41)).toBe('U+0041')
        expect(codePointLabel(0x1f600)).toBe('U+1F600')
    })
    it('names invisible characters', () => {
        expect(describeChar('\n')).toEqual({ label: '↵', name: 'Line feed (LF) · U+000A', invisible: true })
        expect(describeChar('​')).toMatchObject({ label: 'ZWSP', invisible: true })
        expect(describeChar(' ')).toMatchObject({ label: 'NBSP' })
        expect(describeChar('\u0007')).toEqual({ label: 'U+0007', name: 'U+0007', invisible: true })
        expect(describeChar(' ')).toMatchObject({ label: 'U+2003', invisible: true }) // em space has no special name
    })
    it('shows visible characters and combining marks', () => {
        expect(describeChar('a')).toEqual({ label: 'a', name: 'U+0061', invisible: false })
        expect(describeChar('́')).toMatchObject({ label: '◌́', invisible: false })
    })
    it('ranks characters with percentages', () => {
        const r = charFrequency('aabbbc', { limit: 2 })
        expect(r.map(x => [x.char, x.count])).toEqual([['b', 3], ['a', 2]])
        expect(r[0].percent).toBeCloseTo(50, 10)
    })
    it('can skip whitespace', () => {
        const r = charFrequency('a  a b', { skipWhitespace: true })
        expect(r.map(x => x.char)).toEqual(['a', 'b'])
        expect(r[0].percent).toBeCloseTo(66.666, 2)
        expect(charFrequency('')).toEqual([])
    })
})

describe('wordFrequency', () => {
    it('is case-insensitive, skips stop words and bare numbers, sorts ties alphabetically', () => {
        const words = ['The', 'cat', 'and', 'the', 'Dog', 'dog', 'cat', 'bird', '42', '42']
        expect(wordFrequency(words)).toEqual([{ word: 'cat', count: 2 }, { word: 'dog', count: 2 }, { word: 'bird', count: 1 }])
        expect(wordFrequency(words, { hideCommon: false })).toContainEqual({ word: 'the', count: 2 })
        expect(wordFrequency(words, { limit: 1 })).toHaveLength(1)
    })
})

describe('shannonEntropy', () => {
    it('is zero for empty and repeated text', () => {
        expect(shannonEntropy('')).toMatchObject({ bits: 0, level: 'low', total: 0, alphabet: null })
        expect(shannonEntropy('aaaaaaaa')).toMatchObject({ bits: 0, level: 'low', distinct: 1 })
    })
    it('computes per-symbol Shannon entropy exactly', () => {
        expect(shannonEntropy('abab').bits).toBeCloseTo(1, 12)
        expect(shannonEntropy('abcd').bits).toBeCloseTo(2, 12)
        // p = 3/4, 1/4 -> 0.8112781244591328
        expect(shannonEntropy('aaab').bits).toBeCloseTo(0.8112781244591328, 12)
    })
    it('identifies the alphabet', () => {
        expect(shannonEntropy('12345678').alphabet).toMatchObject({ name: 'digits', size: 10 })
        expect(shannonEntropy('deadbeef12').alphabet).toMatchObject({ name: 'hex digits', size: 16 })
        expect(shannonEntropy('AbCd12+/').alphabet).toMatchObject({ name: 'Base64 characters', size: 64 })
        expect(shannonEntropy('hello world!').alphabet).toMatchObject({ name: 'printable ASCII', size: 95 })
        expect(shannonEntropy('日本語').alphabet.name).toBe('Unicode text')
    })
    it('rates random-looking keys high, prose and short strings lower', () => {
        expect(shannonEntropy('9f86d081884c7d659a2feaa0c55ad015').level).toBe('high') // md5-like hex, 32 symbols
        expect(shannonEntropy('aB3dE5gH7jK9mN1pQ3sT5vW7yZ').level).toBe('high')
        expect(shannonEntropy('the quick brown fox jumps').level).not.toBe('high') // contains whitespace
        expect(shannonEntropy('aB3dE5gH').level).not.toBe('high') // under 16 symbols
        expect(shannonEntropy('abababababababab').level).toBe('low')
    })
    it('never reports a ratio above 1', () => {
        expect(shannonEntropy('abcdefghijklmnopqrstuvwxyz0123456789').ratio).toBeLessThanOrEqual(1)
    })
})

describe('formatDuration', () => {
    it.each([
        [0, '0 sec'], [0.4, '0 sec'], [45, '45 sec'], [60, '1 min'], [200, '3 min 20 sec'], [599, '9 min 59 sec'], [600, '10 min'], [1800, '30 min'],
        [3600, '1 h'], [3900, '1 h 5 min'], [7200 + 29, '2 h'],
    ])('%s s -> %s', (s, text) => expect(formatDuration(s)).toBe(text))
})

describe('analyzeText', () => {
    const text = 'Hello world. Hello again, wörld!\n\nA new paragraph 😀.'
    const r = analyzeText(text)
    it('counts', () => {
        expect(r.words).toBe(8) // Hello world Hello again wörld A new paragraph
        expect(r.uniqueWords).toBe(7) // hello x2
        expect(r.sentences).toBe(3)
        expect(r.paragraphs).toBe(2)
        expect(r.lines).toBe(3)
        expect(r.codePoints).toBe([...text].length)
        expect(r.utf16Units).toBe(text.length)
        expect(r.bytes).toBe(new TextEncoder().encode(text).length)
        expect(r.characters).toBe(r.charactersNoSpaces + r.whitespace)
        expect(r.longestWord).toBe('paragraph')
        expect(r.topWords[0]).toEqual({ word: 'hello', count: 2 })
    })
    it('derives averages and reading times from the word count', () => {
        expect(r.avgSentenceWords).toBeCloseTo(8 / 3, 10)
        expect(r.avgWordLength).toBeCloseTo((5 + 5 + 5 + 5 + 5 + 1 + 3 + 9) / 8, 10)
        expect(r.readingSeconds).toBeCloseTo((8 / READING_WPM) * 60, 10)
    })
    it('handles empty text', () => {
        expect(analyzeText('')).toMatchObject({ words: 0, sentences: 0, lines: 0, paragraphs: 0, avgWordLength: 0, avgSentenceWords: 0, longestWord: '', topWords: [], topChars: [], characters: 0 })
    })
})
