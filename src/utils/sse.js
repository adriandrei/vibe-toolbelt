// Server-sent events: an incremental parser for the text/event-stream format,
// following the WHATWG HTML standard ("Parsing an event stream" and
// "Interpreting an event stream",
// https://html.spec.whatwg.org/multipage/server-sent-events.html):
//
// - UTF-8, decoded across chunk boundaries; one leading BOM is ignored
// - lines end with CRLF, LF or CR (a CR at the end of one chunk and an LF at the
//   start of the next are one line break)
// - "field: value" (one space after the colon is dropped), a field name alone
//   (empty value), ":comment" lines, and a blank line to dispatch the event
// - event, data (multi-line, joined with LF), id (kept for later events; a
//   value with NULL is ignored) and retry (ASCII digits only); other fields are
//   ignored, and field names are case-sensitive
// - an event without data isn't dispatched, and an unfinished event at the end
//   of the stream is discarded
//
//   const parser = createEventStreamParser({ onEvent, onRetry, onComment })
//   parser.feed(chunk)          // Uint8Array, ArrayBuffer or string
//   const { discarded } = parser.end()

const LF = 0x0a
const CR = 0x0d
const COLON = 0x3a
const SPACE = 0x20
const BOM = 0xfeff

/**
 * @param {object} handlers
 * @param {(event: { type: string, data: string, lastEventId: string }) => void} [handlers.onEvent]
 * @param {(ms: number) => void} [handlers.onRetry] a valid retry field (the new reconnection time)
 * @param {(text: string) => void} [handlers.onComment] a comment line, without its leading colon
 * @param {string} [handlers.lastEventId] the last event ID so far (when reconnecting)
 */
export function createEventStreamParser({ onEvent, onRetry, onComment, lastEventId: initialId = '' } = {}) {
    let decoder = null
    let started = false // a BOM is only ignored at the very start of the stream
    let afterCR = false // the last chunk ended with CR: an LF next completes that line break
    let line = '' // the start of a line whose end hasn't arrived yet
    let inEvent = false // event, data or id fields were read since the last blank line
    let data = '' // the data buffer
    let eventType = '' // the event type buffer
    let idBuffer = String(initialId) // the last event ID buffer
    let lastEventId = String(initialId) // the last event ID string, set when an event is dispatched
    let ended = false

    const dispatch = () => {
        inEvent = false
        lastEventId = idBuffer
        if (data === '') {
            eventType = ''
            return
        }
        const event = {
            type: eventType || 'message',
            data: data.charCodeAt(data.length - 1) === LF ? data.slice(0, -1) : data,
            lastEventId,
        }
        data = ''
        eventType = ''
        onEvent?.(event)
    }

    const processLine = (text) => {
        if (text === '') {
            dispatch()
            return
        }
        if (text.charCodeAt(0) === COLON) {
            onComment?.(text.slice(1))
            return
        }
        const colon = text.indexOf(':')
        const field = colon === -1 ? text : text.slice(0, colon)
        let value = colon === -1 ? '' : text.slice(colon + 1)
        if (value.charCodeAt(0) === SPACE) value = value.slice(1)
        switch (field) {
            case 'event':
                eventType = value
                inEvent = true
                break
            case 'data':
                data += `${value}\n`
                inEvent = true
                break
            case 'id':
                if (!value.includes('\0')) {
                    idBuffer = value
                    inEvent = true
                }
                break
            case 'retry':
                // Applies straight away, outside any event
                if (/^[0-9]+$/.test(value)) onRetry?.(Number.parseInt(value, 10))
                break
            default:
                // Unknown fields are ignored
                break
        }
    }

    const feedText = (text) => {
        const length = text.length
        let i = 0
        if (!started && length > 0) {
            started = true
            if (text.charCodeAt(0) === BOM) i = 1
        }
        if (afterCR && i < length) {
            afterCR = false
            if (text.charCodeAt(i) === LF) i++
        }
        let start = i
        for (; i < length; i++) {
            const c = text.charCodeAt(i)
            if (c !== LF && c !== CR) continue
            const complete = line + text.slice(start, i)
            line = ''
            if (c === CR) {
                if (i + 1 === length) afterCR = true
                else if (text.charCodeAt(i + 1) === LF) i++
            }
            start = i + 1
            processLine(complete)
        }
        if (start < length) line += text.slice(start)
    }

    return {
        /** Adds the next chunk: bytes (decoded as UTF-8) or already decoded text. */
        feed(chunk) {
            if (ended) return
            if (typeof chunk === 'string') {
                feedText(chunk)
                return
            }
            // ignoreBOM keeps a BOM in the text, so that exactly one is skipped above
            decoder ??= new TextDecoder('utf-8', { ignoreBOM: true })
            feedText(decoder.decode(chunk, { stream: true }))
        },
        /**
         * The stream has ended: an incomplete last line or event is discarded.
         * `discarded` tells whether there was one (other than a comment).
         */
        end() {
            if (ended) return { discarded: false }
            if (decoder) feedText(decoder.decode())
            ended = true
            const discarded = inEvent || (line !== '' && line.charCodeAt(0) !== COLON)
            line = ''
            data = ''
            eventType = ''
            inEvent = false
            return { discarded }
        },
        /** The last event ID string (what a reconnection sends as Last-Event-ID). */
        get lastEventId() {
            return lastEventId
        },
    }
}

/** Whether a Content-Type header value is text/event-stream (parameters allowed). */
export function isEventStream(contentType) {
    return String(contentType ?? '').split(';')[0].trim().toLowerCase() === 'text/event-stream'
}

/**
 * A Last-Event-ID header value as fetch() needs it: the UTF-8 bytes of the ID
 * as a "byte string" (one character per byte), since Headers only accepts
 * Latin-1 text. Line breaks can't occur (they end the line the ID was read
 * from) and NUL makes the parser ignore the ID.
 */
export function lastEventIdHeader(id) {
    const bytes = new TextEncoder().encode(String(id ?? ''))
    let out = ''
    for (const byte of bytes) out += String.fromCharCode(byte)
    return out
}
