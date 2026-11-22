// HAR Viewer & Sanitizer: parses, indexes and sanitizes HAR files off the
// main thread, so a 200 MB file never freezes the page. The parsed file stays
// here; the page gets compact rows, then asks for one entry at a time and for
// the sanitized copy as a Blob.
import { serveWorker } from './serve.js'
import { HarError, MAX_FILE_BYTES, buildRows, harChunks, namesByCategory, parseHar, sanitizeHar, scanHar, summarizeHar } from '../utils/har.js'
import { formatBytes } from '../utils/download.js'

let current = null // { har, format }

async function readFile(file) {
    if (file.size > MAX_FILE_BYTES) {
        throw new HarError(`This file is ${formatBytes(file.size)}. Files up to ${formatBytes(MAX_FILE_BYTES)} can be opened: export fewer requests (filter the Network panel first) and try again.`)
    }
    const head = new Uint8Array(await file.slice(0, 3).arrayBuffer())
    // UTF-16 exports are read, and written back as UTF-8
    if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) {
        const encoding = head[0] === 0xff ? 'utf-16le' : 'utf-16be'
        return { text: new TextDecoder(encoding).decode(await file.arrayBuffer()), bom: false }
    }
    // Blob.text() drops a UTF-8 byte order mark, so note it to write it back
    return { text: await file.text(), bom: head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf }
}

// Joins the pieces into parts of about 16 MB (one string each: a Blob made of
// thousands of small strings is slow), so the whole text never sits in memory twice
function chunksToBlob(chunks) {
    const parts = []
    let batch = []
    let length = 0
    for (const chunk of chunks) {
        batch.push(chunk)
        length += chunk.length
        if (length >= 16 * 1024 * 1024) {
            parts.push(new Blob([batch.join('')]))
            batch = []
            length = 0
        }
    }
    if (batch.length) parts.push(new Blob([batch.join('')]))
    return new Blob(parts, { type: 'application/json' })
}

function requireFile() {
    if (!current) throw new Error('The file is no longer open. Open it again.')
    return current
}

// The text only lives in this function, so it can be freed once it's parsed
async function readAndParse({ file, text }, progress) {
    const { text: source, bom } = file ? await readFile(file) : { text: String(text ?? ''), bom: false }
    progress({ phase: 'parsing' })
    const parsed = parseHar(source)
    if (bom) parsed.format.bom = true
    return parsed
}

serveWorker({
    async load(payload, { progress }) {
        current = null
        progress({ phase: 'reading' })
        const { har, format, malformed } = await readAndParse(payload, progress)
        progress({ phase: 'indexing' })
        const rows = buildRows(har)
        const summary = summarizeHar(har, rows)
        const { counts, names } = scanHar(har)
        current = { har, format }
        return { rows, summary, secrets: { counts, names: namesByCategory(names) }, malformed }
    },

    entry({ index }) {
        const { har } = requireFile()
        const entry = har.log.entries[index]
        const page = Array.isArray(har.log.pages) && entry && typeof entry === 'object'
            ? har.log.pages.find(p => p && typeof p === 'object' && p.id === entry.pageref)
            : null
        return { index, entry, page: page ? { id: page.id, title: page.title } : null }
    },

    sanitize({ options }, { progress }) {
        const { har, format } = requireFile()
        progress({ phase: 'sanitizing' })
        const { har: clean, before } = sanitizeHar(har, options)
        // Scan the copy again, so the page reports what's really left in it
        const after = scanHar(clean)
        progress({ phase: 'writing' })
        const blob = chunksToBlob(harChunks(clean, format))
        return { blob, size: blob.size, entries: clean.log.entries.length, before: before.counts, after: after.counts }
    },

    unload() {
        current = null
        return true
    },
})
