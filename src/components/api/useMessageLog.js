import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatBytes } from '../../utils/download'
import { isJsonContainer, previewText, toHex, utf8Length } from '../../utils/realtime'

// The message log of a WebSocket or event stream connection. Entries live in
// memory only (they can hold tokens and personal data) and are:
// - rendered in batches, at most once per FLUSH_MS however fast they arrive
// - capped: the oldest are dropped beyond LOG_LIMIT entries or LOG_BYTES of data
// - summarised for screen readers at most once per ANNOUNCE_MS, so a busy
//   stream doesn't flood them (the first message is announced straight away)

export const LOG_LIMIT = 1000
export const LOG_BYTES = 50 * 1024 * 1024
const FLUSH_MS = 50
const ANNOUNCE_MS = 3000
const SEARCH_LIMIT = 100_000
const NBSP = String.fromCharCode(0xa0)

function createLogStore() {
    const listeners = new Set()
    let snapshot = { entries: [], dropped: 0, announcement: '' }
    let queue = []
    let bytes = 0
    let nextId = 0
    let flushTimer = null
    let announceTimer = null
    let unannounced = 0
    let latest = ''

    const emit = () => listeners.forEach(listener => listener())

    const announce = () => {
        if (!unannounced) {
            announceTimer = null
            return
        }
        const text = unannounced === 1 ? latest : `${unannounced} new messages. ${latest}`
        unannounced = 0
        // The same text again wouldn't be read out, so make it differ
        snapshot = { ...snapshot, announcement: snapshot.announcement === text ? `${text}${NBSP}` : text }
        emit()
        announceTimer = setTimeout(announce, ANNOUNCE_MS)
    }

    const flush = () => {
        flushTimer = null
        if (!queue.length) return
        let entries = snapshot.entries.concat(queue)
        for (const entry of queue) {
            bytes += entry.size
            if (entry.announce) {
                unannounced++
                latest = entry.announce
            }
        }
        queue = []
        let drop = 0
        while (entries.length - drop > LOG_LIMIT || (bytes > LOG_BYTES && entries.length - drop > 1)) {
            bytes -= entries[drop].size
            drop++
        }
        if (drop) entries = entries.slice(drop)
        snapshot = { ...snapshot, entries, dropped: snapshot.dropped + drop }
        emit()
        if (unannounced && !announceTimer) announce()
    }

    return {
        subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        getSnapshot: () => snapshot,
        push(entry) {
            queue.push({ size: 0, ...entry, id: ++nextId, at: Date.now() })
            flushTimer ??= setTimeout(flush, FLUSH_MS)
        },
        clear() {
            queue = []
            bytes = 0
            unannounced = 0
            snapshot = { ...snapshot, entries: [], dropped: 0 }
            emit()
        },
        stop() {
            clearTimeout(flushTimer)
            clearTimeout(announceTimer)
            flushTimer = null
            announceTimer = null
        },
    }
}

/** { entries, dropped, announcement, push(entry), clear() } */
export function useMessageLog() {
    const [store] = useState(createLogStore)
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
    useEffect(() => () => store.stop(), [store])
    return { ...snapshot, push: store.push, clear: store.clear }
}

// ------------------------------------------------------------- entries ---
// dir: 'in' | 'out' | 'system'
// kind: 'text' | 'binary' | 'event' | 'comment' | 'system'

const searchText = (...parts) => parts.filter(Boolean).join('\n').slice(0, SEARCH_LIMIT).toLowerCase()

export function textEntry(dir, text) {
    const preview = previewText(text)
    return {
        dir,
        kind: 'text',
        text,
        size: utf8Length(text),
        json: isJsonContainer(text),
        preview,
        search: searchText(text),
        announce: dir === 'in' ? `Received: ${previewText(text, 100) || 'an empty message'}` : undefined,
    }
}

export function binaryEntry(dir, data) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const hex = toHex(bytes, 2048)
    return {
        dir,
        kind: 'binary',
        bytes,
        size: bytes.length,
        json: false,
        preview: toHex(bytes, 24),
        search: searchText(hex, hex.replace(/ /g, '')),
        announce: dir === 'in' ? `Received a binary message, ${formatBytes(bytes.length)}` : undefined,
    }
}

export function eventEntry({ type, data, lastEventId }) {
    return {
        dir: 'in',
        kind: 'event',
        type,
        lastEventId,
        text: data,
        size: utf8Length(data),
        json: isJsonContainer(data),
        preview: previewText(data),
        search: searchText(type, lastEventId, data),
        announce: `${type === 'message' ? 'Message' : `${type} event`}: ${previewText(data, 100) || 'no data'}`,
    }
}

export function commentEntry(raw) {
    // ": keep-alive" arrives as " keep-alive"
    const text = raw.startsWith(' ') ? raw.slice(1) : raw
    return { dir: 'in', kind: 'comment', text, size: utf8Length(raw) + 1, json: false, preview: previewText(text), search: searchText(text) }
}

/** tone: info | success | warning | danger */
export function systemEntry(text, tone = 'info') {
    return { dir: 'system', kind: 'system', text, tone, size: 0, search: searchText(text) }
}
