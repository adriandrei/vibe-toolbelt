// PDF work for the PDF Tools page, off the main thread (pdf-lib parses and
// writes whole documents, which can take seconds for big files).
//
// Messages in:  { id, type: 'inspect' | 'merge' | 'extract', payload }
// Messages out: { id, progress: { done, total } }   (zero or more)
//               { id, result }                       (bytes transferred)
//               { id, error: { message, kind, fileName } }
import { PDFDocument, degrees } from 'pdf-lib'
import JSZip from 'jszip'

const normalizeAngle = (deg) => ((deg % 360) + 360) % 360

async function open(file) {
    try {
        const bytes = await file.arrayBuffer()
        return await PDFDocument.load(bytes, { updateMetadata: false })
    } catch (err) {
        const message = err?.message || String(err)
        const error = new Error(message)
        error.fileName = file.name
        error.kind = /encrypt/i.test(message) ? 'encrypted' : /no pdf header/i.test(message) ? 'not-pdf' : 'corrupt'
        throw error
    }
}

function rotatePage(page, rotation) {
    if (rotation) page.setRotation(degrees(normalizeAngle(page.getRotation().angle + rotation)))
}

const handlers = {
    async inspect({ file }) {
        const doc = await open(file)
        return { pages: doc.getPageCount() }
    },

    async merge({ files }, progress) {
        const out = await PDFDocument.create()
        for (let i = 0; i < files.length; i++) {
            const doc = await open(files[i])
            const pages = await out.copyPages(doc, doc.getPageIndices())
            pages.forEach(page => out.addPage(page))
            progress(i + 1, files.length)
        }
        return { bytes: await out.save(), pages: out.getPageCount() }
    },

    // pages: 1-based page numbers in output order (repeats allowed)
    async extract({ file, pages, rotation, split, baseName }, progress) {
        const src = await open(file)
        const count = src.getPageCount()
        if (!pages.length || pages.some(n => !Number.isInteger(n) || n < 1 || n > count)) {
            throw new Error(`The page selection doesn’t match this ${count}-page PDF`)
        }

        if (!split) {
            // Every page in its original order: rotate in place, which keeps
            // bookmarks, links and form fields
            if (pages.length === count && pages.every((n, i) => n === i + 1)) {
                src.getPages().forEach(page => rotatePage(page, rotation))
                return { bytes: await src.save(), pages: count }
            }
            const out = await PDFDocument.create()
            const copied = await out.copyPages(src, pages.map(n => n - 1))
            copied.forEach((page) => {
                rotatePage(page, rotation)
                out.addPage(page)
            })
            return { bytes: await out.save(), pages: copied.length }
        }

        const zip = new JSZip()
        const digits = String(count).length
        const used = new Map()
        for (let i = 0; i < pages.length; i++) {
            const out = await PDFDocument.create()
            const [page] = await out.copyPages(src, [pages[i] - 1])
            rotatePage(page, rotation)
            out.addPage(page)
            const stem = `${baseName}-page-${String(pages[i]).padStart(digits, '0')}`
            const n = (used.get(stem) || 0) + 1
            used.set(stem, n)
            zip.file(`${stem}${n > 1 ? `-${n}` : ''}.pdf`, await out.save())
            progress(i + 1, pages.length)
        }
        return { bytes: await zip.generateAsync({ type: 'uint8array' }), pages: pages.length }
    },
}

self.onmessage = async (event) => {
    const { id, type, payload } = event.data
    const progress = (done, total) => self.postMessage({ id, progress: { done, total } })
    try {
        const handler = handlers[type]
        if (!handler) throw new Error(`Unknown task: ${type}`)
        const result = await handler(payload, progress)
        self.postMessage({ id, result }, result.bytes ? [result.bytes.buffer] : [])
    } catch (err) {
        self.postMessage({ id, error: { message: err?.message || String(err), kind: err?.kind || 'error', fileName: err?.fileName } })
    }
}
