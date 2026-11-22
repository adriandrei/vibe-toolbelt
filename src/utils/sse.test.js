import { describe, expect, it } from 'vitest'
import { createEventStreamParser, isEventStream, lastEventIdHeader } from './sse'

// Parses a whole stream, given as one chunk or a list of chunks (text or
// bytes), and returns everything the parser reported
function parse(chunks, options = {}) {
    const events = []
    const retries = []
    const comments = []
    const parser = createEventStreamParser({
        ...options,
        onEvent: (event) => events.push(event),
        onRetry: (ms) => retries.push(ms),
        onComment: (text) => comments.push(text),
    })
    for (const chunk of Array.isArray(chunks) ? chunks : [chunks]) parser.feed(chunk)
    const { discarded } = parser.end()
    return { events, retries, comments, discarded, lastEventId: parser.lastEventId }
}

const message = (data, lastEventId = '', type = 'message') => ({ type, data, lastEventId })
const utf8 = (text) => new TextEncoder().encode(text)

describe('WHATWG examples (HTML standard, server-sent events)', () => {
    it('9.2.1: three messages, the second with two data lines', () => {
        const stream = 'data: This is the first message.\n\ndata: This is the second message, it\ndata: has two lines.\n\ndata: This is the third message.\n'
        // Followed by a blank line, all three fire...
        expect(parse(`${stream}\n`).events).toEqual([
            message('This is the first message.'),
            message('This is the second message, it\nhas two lines.'),
            message('This is the third message.'),
        ])
        // ...without it, the end of the stream isn't enough for the last one
        const unfinished = parse(stream)
        expect(unfinished.events).toHaveLength(2)
        expect(unfinished.discarded).toBe(true)
    })

    it('9.2.1: named events (event: add / remove)', () => {
        const stream = 'event: add\ndata: 73857293\n\nevent: remove\ndata: 2153\n\nevent: add\ndata: 113411\n\n'
        expect(parse(stream).events).toEqual([
            message('73857293', '', 'add'),
            message('2153', '', 'remove'),
            message('113411', '', 'add'),
        ])
    })

    it('9.2.6: YHOO, +2, 10 is one event with three data lines', () => {
        expect(parse('data: YHOO\ndata: +2\ndata: 10\n\n').events).toEqual([message('YHOO\n+2\n10')])
    })

    it('9.2.6: the "test stream" (comment, id, empty id, leading space)', () => {
        const stream = ': test stream\n\ndata: first event\nid: 1\n\ndata:second event\nid\n\ndata:  third event\n'
        const result = parse(`${stream}\n`)
        // The comment block fires nothing; "id" with no value resets the last event ID
        expect(result.events).toEqual([
            message('first event', '1'),
            message('second event', ''),
            message(' third event', ''),
        ])
        expect(result.comments).toEqual([' test stream'])
        // "the last still has to end with a blank line"
        expect(parse(stream).events.map(e => e.data)).toEqual(['first event', 'second event'])
    })

    it('9.2.6: "data" alone is an empty data line, and the unfinished last block is discarded', () => {
        const result = parse('data\n\ndata\ndata\n\ndata:')
        expect(result.events).toEqual([message(''), message('\n')])
        expect(result.discarded).toBe(true)
    })

    it('9.2.6: "data:test" and "data: test" fire identical events', () => {
        expect(parse('data:test\n\ndata: test\n\n').events).toEqual([message('test'), message('test')])
    })
})

describe('line endings', () => {
    it('accepts CRLF, CR and LF, mixed', () => {
        expect(parse('data: a\r\n\r\ndata: b\r\rdata: c\n\ndata: d\r\n\n').events.map(e => e.data)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('treats a CR at the end of a chunk and an LF at the start of the next as one line break', () => {
        // One event "a\nb": counting CR and LF separately would end it after "a"
        expect(parse(['data: a\r', '\ndata: b\r', '\n\r', '\n']).events).toEqual([message('a\nb')])
    })

    it('keeps waiting for that LF across empty chunks', () => {
        expect(parse(['data: a\r', '', '\n', '\n']).events).toEqual([message('a')])
    })

    it('ends a line at a lone CR right away', () => {
        expect(parse(['data: a\r', '\r']).events).toEqual([message('a')])
        expect(parse('data: a\rdata: b\r\r').events).toEqual([message('a\nb')])
    })
})

describe('fields', () => {
    it('reads a line without a colon as a field with an empty value', () => {
        expect(parse('data\n\n').events).toEqual([message('')])
        expect(parse('event\ndata: x\n\n').events).toEqual([message('x')])
    })

    it('removes only one space after the colon, and no other whitespace', () => {
        expect(parse('data:  two\n\ndata:\ttab\n\n').events.map(e => e.data)).toEqual([' two', '\ttab'])
    })

    it('keeps colons in the value', () => {
        expect(parse('data: a:b: c\n\n').events).toEqual([message('a:b: c')])
    })

    it('compares field names exactly (no case folding) and ignores unknown fields', () => {
        expect(parse('Data: x\n\nDATA: y\n\n').events).toEqual([])
        expect(parse('foo: bar\ndata: x\n\n').events).toEqual([message('x')])
    })

    it('uses the event type for one event only', () => {
        expect(parse('event: a\ndata: 1\n\ndata: 2\n\n').events).toEqual([message('1', '', 'a'), message('2')])
    })

    it('drops an event without data and resets its type', () => {
        const result = parse('event: a\n\ndata: 2\n\n')
        expect(result.events).toEqual([message('2')])
        expect(result.discarded).toBe(false)
    })

    it('keeps the last event ID for later events until the server changes it', () => {
        expect(parse('id: 7\ndata: a\n\ndata: b\n\nid\ndata: c\n\n').events).toEqual([
            message('a', '7'),
            message('b', '7'),
            message('c', ''),
        ])
    })

    it('ignores an id that contains NULL', () => {
        expect(parse('id: 1\ndata: a\n\nid: 2\u00003\ndata: b\n\n').events).toEqual([message('a', '1'), message('b', '1')])
    })

    it('applies an id given after the data in the same block', () => {
        expect(parse('data: a\nid: 3\n\n').events).toEqual([message('a', '3')])
    })

    it('commits the id on a blank line even without data, and not before', () => {
        expect(parse('id: 5\n\n')).toMatchObject({ events: [], lastEventId: '5', discarded: false })
        expect(parse('id: 1\ndata: a\n\nid: 2\n')).toMatchObject({ lastEventId: '1', discarded: true })
    })

    it('starts from a given last event ID (a reconnection)', () => {
        expect(parse('data: a\n\n', { lastEventId: '9' }).events).toEqual([message('a', '9')])
    })

    it('accepts retry with ASCII digits only, straight away and without an event', () => {
        const result = parse('retry: 1500\nretry: 0042\nretry: 1.5\nretry: -1\nretry: 15a\nretry:\nretry:  20\nretry\nretry: ٣\n')
        expect(result.retries).toEqual([1500, 42])
        expect(result.events).toEqual([])
        expect(result.discarded).toBe(false)
    })

    it('reports comments without their colon, and they do not interrupt an event', () => {
        const result = parse(': hello\n:\n:: x\ndata: a\n: note\ndata: b\n\n')
        expect(result.comments).toEqual([' hello', '', ': x', ' note'])
        expect(result.events).toEqual([message('a\nb')])
    })
})

describe('byte order mark', () => {
    it('ignores one leading BOM, in text or in bytes', () => {
        expect(parse('\uFEFFdata: a\n\n').events).toEqual([message('a')])
        expect(parse(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('data: a\n\n')])).events).toEqual([message('a')])
    })

    it('ignores only one: a second BOM makes the field name unknown', () => {
        expect(parse('\uFEFF\uFEFFdata: a\n\n').events).toEqual([])
    })

    it('has no special meaning later in the stream', () => {
        expect(parse('data: a\n\n\uFEFFdata: b\n\n').events).toEqual([message('a')])
    })

    it('is recognised when split across chunks, or after an empty chunk', () => {
        expect(parse([new Uint8Array([0xef]), new Uint8Array([0xbb, 0xbf, ...utf8('data: a\n\n')])]).events).toEqual([message('a')])
        expect(parse(['', '\uFEFFdata: a\n\n']).events).toEqual([message('a')])
    })
})

describe('UTF-8 decoding', () => {
    it('decodes characters split across chunks', () => {
        const bytes = utf8('data: é€😀\n\n')
        for (let i = 0; i <= bytes.length; i++) {
            expect(parse([bytes.slice(0, i), bytes.slice(i)]).events).toEqual([message('é€😀')])
        }
    })

    it('replaces invalid bytes with U+FFFD', () => {
        expect(parse(new Uint8Array([...utf8('data: '), 0xff, 0x0a, 0x0a])).events).toEqual([message('\uFFFD')])
    })

    it('replaces a sequence cut off by the end of the stream', () => {
        const result = parse([utf8('data: a\n\n'), new Uint8Array([0xe2, 0x82])])
        expect(result.events).toEqual([message('a')])
        expect(result.discarded).toBe(true)
    })

    it('accepts ArrayBuffer chunks', () => {
        expect(parse(utf8('data: a\n\n').buffer).events).toEqual([message('a')])
    })
})

describe('chunk boundaries', () => {
    // BOM, comments, retry, CRLF / CR / LF, multi-byte characters, a named
    // event, an id that is kept and then reset, and an unfinished last event
    const SAMPLE = '\uFEFF: hello\r\nretry: 2500\r\nevent: update\r\nid: 42\r\ndata: {"price":"€1.5","emoji":"😀"}\r\n\r\n'
        + 'data: line one\rdata: line two\r\rid\ndata: Ünïcödé\n\n: tail\ndata: unfinished'
    const EXPECTED = {
        events: [
            message('{"price":"€1.5","emoji":"😀"}', '42', 'update'),
            message('line one\nline two', '42'),
            message('Ünïcödé', ''),
        ],
        retries: [2500],
        comments: [' hello', ' tail'],
        discarded: true,
        lastEventId: '',
    }
    const bytes = utf8(SAMPLE)

    it('parses the sample in one chunk', () => {
        expect(parse(bytes)).toEqual(EXPECTED)
        expect(parse(SAMPLE)).toEqual(EXPECTED)
    })

    it('gives the same result split into two chunks at every byte position', () => {
        for (let i = 0; i <= bytes.length; i++) {
            expect(parse([bytes.slice(0, i), bytes.slice(i)]), `split at byte ${i}`).toEqual(EXPECTED)
        }
    })

    it('gives the same result split at every pair of byte positions', () => {
        for (let i = 0; i <= bytes.length; i++) {
            for (let j = i; j <= bytes.length; j += 7) {
                expect(parse([bytes.slice(0, i), bytes.slice(i, j), bytes.slice(j)]), `split at bytes ${i} and ${j}`).toEqual(EXPECTED)
            }
        }
    })

    it('gives the same result one byte at a time, and one character at a time', () => {
        expect(parse([...bytes].map(b => new Uint8Array([b])))).toEqual(EXPECTED)
        expect(parse([...SAMPLE])).toEqual(EXPECTED)
    })
})

describe('end of stream', () => {
    it('discards an unterminated line', () => {
        expect(parse('data: a\n\ndata: b')).toMatchObject({ events: [message('a')], discarded: true })
    })

    it('reports nothing discarded after a complete event or a trailing comment', () => {
        expect(parse('data: a\n\n').discarded).toBe(false)
        expect(parse('data: a\n\n: bye').discarded).toBe(false)
    })

    it('ignores input after end()', () => {
        const events = []
        const parser = createEventStreamParser({ onEvent: (e) => events.push(e) })
        parser.feed('data: a\n\n')
        parser.end()
        parser.feed('data: b\n\n')
        expect(parser.end()).toEqual({ discarded: false })
        expect(events).toEqual([message('a')])
    })
})

describe('isEventStream', () => {
    it.each(['text/event-stream', 'text/event-stream; charset=utf-8', ' TEXT/Event-Stream ;x=1'])('accepts %j', (type) => {
        expect(isEventStream(type)).toBe(true)
    })
    it.each(['', null, undefined, 'text/plain', 'application/json', 'text/event-streams', 'text/event'])('rejects %j', (type) => {
        expect(isEventStream(type)).toBe(false)
    })
})

describe('lastEventIdHeader', () => {
    it('passes ASCII through and sends other characters as UTF-8 bytes', () => {
        expect(lastEventIdHeader('abc-123')).toBe('abc-123')
        expect(lastEventIdHeader('é')).toBe('\u00c3\u00a9')
        expect(lastEventIdHeader('')).toBe('')
    })
})
