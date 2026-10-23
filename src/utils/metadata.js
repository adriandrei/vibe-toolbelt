// Reading and removing file metadata, shared by the EXIF Viewer and the
// Privacy Scanner.
//
//   readImageMetadata(file)  -> EXIF/IPTC/XMP/ICC… as strings, plus signed GPS
//   readPdfMetadata(file)    -> document info (pdf-lib getters, file untouched)
//   findImageRisks(meta) / findPdfRisks(meta) -> what could identify someone
//   createCleanCopy(file)    -> the image without metadata (lossless when possible)

import ExifReader from 'exifreader'
import { formatBytes, splitFilename } from './download'
import {
    ImageError, canvasAsImage, encodeCanvas, extensionForType, getEncoderSupport,
    loadImage, renderImage, sniffImageType, typeLabel,
} from './image'

export class MetadataError extends Error {
    constructor(message, { code, cause } = {}) {
        super(message)
        this.name = 'MetadataError'
        this.code = code
        if (cause) this.cause = cause
    }
}

const MAX_VALUE_LENGTH = 2000

function cleanString(s) {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\u0000+$/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
}

/**
 * Turns any ExifReader tag (or nested value) into display text. Numbers,
 * arrays (repeated IPTC fields), XMP structures, binary data and thumbnail
 * objects are all handled; this never throws.
 */
export function tagToString(tag, depth = 0) {
    try {
        if (tag === null || tag === undefined || depth > 5) return ''
        if (typeof tag === 'string') return cleanString(tag)
        if (typeof tag === 'number') return Number.isFinite(tag) ? String(tag) : ''
        if (typeof tag === 'bigint' || typeof tag === 'boolean') return String(tag)
        if (tag instanceof Date) return Number.isNaN(tag.getTime()) ? '' : tag.toLocaleString()
        if (tag instanceof ArrayBuffer || ArrayBuffer.isView(tag)) return `[binary data, ${formatBytes(tag.byteLength)}]`
        if (Array.isArray(tag)) {
            if (tag.length > 0 && tag.every(v => typeof v === 'number')) {
                return tag.length > 64 ? `[${tag.length} values]` : tag.join(', ')
            }
            return tag.map(v => tagToString(v, depth + 1)).filter(Boolean).join(', ')
        }
        if (typeof tag === 'object') {
            const d = tag.description
            if (d !== undefined && d !== null && d !== '') {
                return typeof d === 'object' ? tagToString(d, depth + 1) : cleanString(String(d))
            }
            if ('value' in tag) return tagToString(tag.value, depth + 1)
            return Object.entries(tag)
                .filter(([k]) => !k.startsWith('_') && k !== 'image' && k !== 'base64' && k !== 'attributes')
                .map(([k, v]) => {
                    const text = tagToString(v, depth + 1)
                    return text ? `${k}: ${text}` : ''
                })
                .filter(Boolean)
                .join('; ')
        }
        return String(tag)
    } catch {
        return ''
    }
}

function truncate(text) {
    return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}… (${text.length.toLocaleString()} characters)` : text
}

// ---------------------------------------------------------------------------
// GPS

/** 33.8568, 'lat' -> 33°51′24.5″N */
export function formatDms(value, axis) {
    const hemi = axis === 'lat' ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E')
    const abs = Math.abs(value)
    let d = Math.floor(abs)
    let m = Math.floor((abs - d) * 60)
    let s = Math.round(((abs - d) * 60 - m) * 600) / 10
    if (s >= 60) { s = 0; m += 1 }
    if (m >= 60) { m = 0; d += 1 }
    return `${d}°${m}′${s.toFixed(1)}″${hemi}`
}

// 6 decimals is about 10 cm: more than any phone GPS really delivers
export function formatLatLon(lat, lon, digits = 6) {
    return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`
}

function rationalToNumber(v) {
    if (Array.isArray(v)) return v[1] ? v[0] / v[1] : NaN
    return Number(v)
}

function dmsToDecimal(value) {
    if (!Array.isArray(value) || !value.length) return NaN
    const [d, m = 0, s = 0] = value.map(rationalToNumber)
    return d + m / 60 + s / 3600
}

// XMP stores GPS as "33,51.4S" or "33,51,24.5S"
function parseXmpCoordinate(text) {
    const m = /^\s*(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?(?:,(\d+(?:\.\d+)?))?\s*([NSEW])\s*$/i.exec(text || '')
    if (!m) return NaN
    const value = Number(m[1]) + (Number(m[2]) || 0) / 60 + (Number(m[3]) || 0) / 3600
    return /[SW]/i.test(m[4]) ? -value : value
}

function extractGps(tags) {
    const exif = tags.exif || {}
    const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)
    let lat = tags.gps?.Latitude
    let lon = tags.gps?.Longitude
    let refMissing = false
    if (!valid(lat, lon) && exif.GPSLatitude && exif.GPSLongitude) {
        // ExifReader only signs coordinates when the N/S, E/W references exist
        lat = dmsToDecimal(exif.GPSLatitude.value)
        lon = dmsToDecimal(exif.GPSLongitude.value)
        const latRef = tagToString(exif.GPSLatitudeRef)
        const lonRef = tagToString(exif.GPSLongitudeRef)
        if (/^s/i.test(latRef)) lat = -lat
        if (/^w/i.test(lonRef)) lon = -lon
        refMissing = !latRef || !lonRef
    }
    if (!valid(lat, lon) && tags.xmp?.GPSLatitude && tags.xmp?.GPSLongitude) {
        lat = parseXmpCoordinate(tagToString(tags.xmp.GPSLatitude))
        lon = parseXmpCoordinate(tagToString(tags.xmp.GPSLongitude))
    }
    if (!valid(lat, lon)) return null
    const altitude = tags.gps?.Altitude
    const dateParts = [tagToString(exif.GPSDateStamp), tagToString(exif.GPSTimeStamp)].filter(Boolean)
    return {
        latitude: lat,
        longitude: lon,
        altitude: Number.isFinite(altitude) ? altitude : null,
        timestamp: dateParts.join(' ') || null,
        refMissing,
    }
}

// ---------------------------------------------------------------------------
// Image metadata

const GROUPS = [
    ['exif', 'EXIF'],
    ['gps', 'GPS'],
    ['iptc', 'IPTC'],
    ['xmp', 'XMP'],
    ['makerNotes', 'Maker notes'],
    ['photoshop', 'Photoshop'],
    ['icc', 'Colour profile (ICC)'],
    ['mpf', 'Multi-picture (MPF)'],
    ['composite', 'Computed'],
    ['Thumbnail', 'Embedded thumbnail'],
    ['thumbnail', 'Embedded thumbnail'],
    ['png', 'PNG'],
    ['riff', 'WebP'],
    ['gif', 'GIF'],
    ['jfif', 'JFIF'],
    ['file', 'File'],
]
const SKIP_GROUPS = new Set(['pngText', 'pngFile', 'gps'])
// Groups (and PNG header fields) that only describe how the image is stored
const TECHNICAL_GROUPS = new Set(['file', 'jfif', 'icc', 'composite', 'gif', 'riff', 'mpf'])
const PNG_TECHNICAL = new Set(['Image Width', 'Image Height', 'Bit Depth', 'Color Type', 'Compression', 'Filter', 'Interlace', 'Pixels Per Unit X', 'Pixels Per Unit Y', 'Pixel Units', 'FileType'])
const SKIP_TAGS = new Set(['MakerNote', '_raw'])

/**
 * Reads every metadata block ExifReader understands.
 * Resolves to { groups: [{ id, label, rows: [{ key, value }] }], gps, thumbnail, count, tags }
 * where `tags` maps tag name -> first string value found (for lookups).
 * A file with no metadata resolves with count 0; unreadable files reject
 * with a MetadataError.
 */
export async function readImageMetadata(file) {
    let tags
    try {
        const buffer = await file.arrayBuffer()
        tags = await ExifReader.load(buffer, { expanded: true, async: true })
    } catch (err) {
        if (err?.name === 'MetadataMissingError') {
            return { groups: [], gps: null, thumbnail: null, count: 0, descriptive: 0, tags: {} }
        }
        if (/invalid image format|unknown file format|not a valid/i.test(String(err?.message))) {
            throw new MetadataError('This file format isn’t supported for metadata. Use JPEG, PNG, WebP, HEIC, AVIF, TIFF or GIF.', { code: 'unsupported', cause: err })
        }
        throw new MetadataError(`The metadata couldn’t be read${err?.message ? `: ${err.message}` : '.'}`, { code: 'corrupt', cause: err })
    }

    const groups = []
    const lookup = {}
    const order = [...GROUPS.map(([id]) => id), ...Object.keys(tags).filter(id => !GROUPS.some(([g]) => g === id))]
    for (const id of order) {
        const group = tags[id]
        if (!group || typeof group !== 'object' || SKIP_GROUPS.has(id)) continue
        const label = GROUPS.find(([g]) => g === id)?.[1] ?? id
        const rows = []
        for (const [key, raw] of Object.entries(group)) {
            if (SKIP_TAGS.has(key) || key.startsWith('_') || key === 'image' || key === 'base64') continue
            if (/^thumbnail$/i.test(id) && key === 'type') continue
            if (/IFD Pointer$/.test(key)) continue // file offsets, meaningless to people
            let value = tagToString(raw)
            if (id === 'exif' && (key === 'GPSLatitude' || key === 'GPSLongitude') && typeof raw?.description === 'number') {
                // ExifReader describes these unsigned with 15 decimals; show 6 and the hemisphere
                const ref = tagToString(group[`${key}Ref`]).charAt(0).toUpperCase()
                value = `${raw.description.toFixed(6)}°${ref ? ` ${ref}` : ''}`
            }
            if (!value) continue
            rows.push({ key, value: truncate(value) })
            if (!(key in lookup)) lookup[key] = value
        }
        if (/^thumbnail$/i.test(id) && group.image) {
            rows.unshift({ key: 'Preview image', value: `${typeLabel(group.type || 'image/jpeg')}, ${formatBytes(group.image.byteLength ?? 0)}` })
        }
        if (rows.length) groups.push({ id, label, rows })
    }

    const gps = extractGps(tags)
    const thumbTags = tags.Thumbnail || tags.thumbnail
    const thumbnail = thumbTags?.image ? { type: thumbTags.type || 'image/jpeg', size: thumbTags.image.byteLength ?? 0 } : null
    const count = groups.reduce((n, g) => n + g.rows.length, 0)
    // Tags that say something about the photo, its author or device (not just its encoding)
    const descriptive = groups.reduce((n, g) => {
        if (TECHNICAL_GROUPS.has(g.id)) return n
        if (g.id === 'png') return n + g.rows.filter(r => !PNG_TECHNICAL.has(r.key)).length
        return n + g.rows.length
    }, 0)
    return { groups, gps, thumbnail, count, descriptive, tags: lookup }
}

/** First non-empty value among `keys` (tag names) in readImageMetadata().tags */
export function pickTag(meta, ...keys) {
    for (const key of keys) {
        const v = meta?.tags?.[key]
        if (v) return v
    }
    return null
}

const IMAGE_RISKS = [
    {
        id: 'serial', severity: 'high', title: 'Device serial number',
        why: 'Links every photo taken with this camera or lens.',
        tags: ['BodySerialNumber', 'SerialNumber', 'CameraSerialNumber', 'InternalSerialNumber', 'LensSerialNumber'],
    },
    {
        id: 'owner', severity: 'high', title: 'Owner or author name',
        why: 'Names the person who took or owns the photo.',
        tags: ['CameraOwnerName', 'OwnerName', 'Artist', 'XPAuthor', 'By-line', 'creator', 'Creator', 'Contact', 'Writer/Editor'],
    },
    {
        id: 'people', severity: 'medium', title: 'Tagged people or face regions',
        why: 'Names or marks the people in the picture.',
        tags: ['PersonInImage', 'Regions', 'RegionList', 'RegionInfo'],
    },
    {
        id: 'place', severity: 'medium', title: 'Place names',
        why: 'Written location, even without GPS.',
        tags: ['City', 'Sub-location', 'Province/State', 'Country/Primary Location Name', 'Content Location Name', 'Location', 'State', 'Country', 'LocationShown', 'LocationCreated'],
    },
    {
        id: 'device', severity: 'medium', title: 'Camera or phone model',
        why: 'Narrows down who could have taken the photo.',
        tags: ['Make', 'Model', 'LensMake', 'LensModel', 'Lens', 'HostComputer'],
    },
    {
        id: 'text', severity: 'medium', title: 'Descriptions, comments or keywords',
        why: 'Free text often contains names and notes.',
        tags: ['ImageDescription', 'UserComment', 'XPComment', 'XPSubject', 'XPKeywords', 'XPTitle', 'Caption/Abstract', 'Headline', 'Keywords', 'Object Name', 'Special Instructions', 'description', 'title', 'subject', 'Rights', 'Copyright', 'Copyright Notice', 'Credit', 'Source'],
    },
    {
        id: 'dates', severity: 'low', title: 'Date and time taken',
        why: 'Shows when (and with the time zone, roughly where) the photo was taken.',
        tags: ['DateTimeOriginal', 'DateTimeDigitized', 'CreateDate', 'DateCreated', 'Date Created', 'DateTime', 'ModifyDate', 'OffsetTimeOriginal', 'OffsetTime', 'Digital Creation Date'],
    },
    {
        id: 'software', severity: 'low', title: 'Software used',
        why: 'Reveals the apps and versions on your device.',
        tags: ['Software', 'CreatorTool', 'ProcessingSoftware', 'Originating Program'],
    },
    {
        id: 'ids', severity: 'low', title: 'Unique image IDs',
        why: 'Can link edited copies back to the original file.',
        tags: ['ImageUniqueID', 'DocumentID', 'InstanceID', 'OriginalDocumentID', 'Unique Document ID'],
    },
]

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

/** Things in the image metadata that could identify a person, place or device. */
export function findImageRisks(meta) {
    const risks = []
    if (meta.gps) {
        const { latitude, longitude, altitude } = meta.gps
        risks.push({
            id: 'gps', severity: 'high', title: 'GPS location',
            why: 'Pinpoints where the photo was taken, often to within a few metres.',
            items: [{ key: 'Coordinates', value: `${formatLatLon(latitude, longitude)}${altitude !== null ? ` · ${Math.round(altitude)} m altitude` : ''}` }],
        })
    }
    for (const risk of IMAGE_RISKS) {
        const seen = new Set()
        const items = []
        for (const key of risk.tags) {
            const value = meta.tags?.[key]
            if (!value || seen.has(value)) continue
            seen.add(value)
            items.push({ key, value: value.length > 200 ? `${value.slice(0, 200)}…` : value })
        }
        if (items.length) risks.push({ id: risk.id, severity: risk.severity, title: risk.title, why: risk.why, items })
    }
    if (meta.thumbnail) {
        risks.push({
            id: 'thumbnail', severity: 'low', title: 'Embedded thumbnail',
            why: 'A small preview that may still show the original, uncropped picture.',
            items: [{ key: 'Thumbnail', value: `${typeLabel(meta.thumbnail.type)}, ${formatBytes(meta.thumbnail.size)}` }],
        })
    }
    return risks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

// ---------------------------------------------------------------------------
// PDF metadata

function pdfText(obj, { PDFString, PDFHexString }) {
    try {
        if (obj instanceof PDFString || obj instanceof PDFHexString) return cleanString(obj.decodeText())
    } catch {
        // undecodable string
    }
    return ''
}

function xmpValues(doc, ns, name) {
    const out = []
    for (const el of doc.getElementsByTagNameNS(ns, name)) {
        const items = el.getElementsByTagNameNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'li')
        if (items.length) for (const li of items) out.push(li.textContent.trim())
        else out.push(el.textContent.trim())
    }
    for (const el of doc.getElementsByTagNameNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'Description')) {
        const attr = el.getAttributeNS(ns, name)
        if (attr) out.push(attr.trim())
    }
    return [...new Set(out.filter(Boolean))].join(', ')
}

function parseXmpPacket(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) return null
    const DC = 'http://purl.org/dc/elements/1.1/'
    const XMP = 'http://ns.adobe.com/xap/1.0/'
    const PDF = 'http://ns.adobe.com/pdf/1.3/'
    const MM = 'http://ns.adobe.com/xap/1.0/mm/'
    const fields = {
        creator: xmpValues(doc, DC, 'creator'),
        title: xmpValues(doc, DC, 'title'),
        description: xmpValues(doc, DC, 'description'),
        subject: xmpValues(doc, DC, 'subject'),
        rights: xmpValues(doc, DC, 'rights'),
        creatorTool: xmpValues(doc, XMP, 'CreatorTool'),
        producer: xmpValues(doc, PDF, 'Producer'),
        keywords: xmpValues(doc, PDF, 'Keywords'),
        createDate: xmpValues(doc, XMP, 'CreateDate'),
        modifyDate: xmpValues(doc, XMP, 'ModifyDate'),
        documentId: xmpValues(doc, MM, 'DocumentID'),
        instanceId: xmpValues(doc, MM, 'InstanceID'),
    }
    return Object.values(fields).some(Boolean) ? fields : null
}

function formatDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : ''
}

/**
 * Reads a PDF's document information without modifying it
 * (updateMetadata: false keeps pdf-lib from rewriting Producer and ModDate).
 * Resolves to { encrypted, pageCount, info, xmp, commentAuthors, attachments, rows }.
 */
export async function readPdfMetadata(file) {
    let lib
    try {
        lib = await import('pdf-lib')
    } catch (err) {
        throw new MetadataError('Couldn’t load the PDF reader. Check your connection and try again.', { code: 'load-failed', cause: err })
    }
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } = lib
    let doc
    try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false })
    } catch (err) {
        throw new MetadataError(`This PDF couldn’t be opened${err?.message ? `: ${err.message}` : '.'}`, { code: 'corrupt', cause: err })
    }

    const get = (fn) => {
        try {
            return fn() ?? ''
        } catch {
            return ''
        }
    }
    const encrypted = !!doc.isEncrypted
    const info = {
        title: get(() => doc.getTitle()),
        author: get(() => doc.getAuthor()),
        subject: get(() => doc.getSubject()),
        keywords: get(() => doc.getKeywords()),
        creator: get(() => doc.getCreator()),
        producer: get(() => doc.getProducer()),
        creationDate: formatDate(get(() => doc.getCreationDate())),
        modificationDate: formatDate(get(() => doc.getModificationDate())),
    }
    const pageCount = get(() => doc.getPageCount()) || 0
    if (!pageCount && !encrypted) {
        throw new MetadataError('This PDF appears to be damaged: no pages could be read.', { code: 'corrupt' })
    }

    // XMP metadata stream (often repeats or extends the info dictionary)
    let xmp = null
    try {
        const stream = doc.catalog.lookup(PDFName.of('Metadata'))
        if (stream instanceof PDFRawStream) {
            const xml = new TextDecoder().decode(decodePDFRawStream(stream).decode())
            xmp = parseXmpPacket(xml)
        }
    } catch {
        // missing or compressed with an unsupported filter
    }

    // Names of people who left comments or annotations
    const commentAuthors = new Set()
    let annotationCount = 0
    try {
        const pages = doc.getPages().slice(0, 1000)
        for (const page of pages) {
            const annots = page.node.lookup(PDFName.of('Annots'))
            if (!(annots instanceof PDFArray)) continue
            for (let i = 0; i < annots.size(); i++) {
                const annot = annots.lookup(i)
                if (!(annot instanceof PDFDict)) continue
                const subtype = annot.lookup(PDFName.of('Subtype'))?.toString()
                if (subtype === '/Link' || subtype === '/Widget' || subtype === '/Popup') continue
                annotationCount++
                const author = pdfText(annot.lookup(PDFName.of('T')), lib)
                if (author) commentAuthors.add(author)
            }
        }
    } catch {
        // unusual page tree
    }

    // Embedded (attached) files
    let attachments = 0
    try {
        const names = doc.catalog.lookup(PDFName.of('Names'))
        const embedded = names instanceof PDFDict ? names.lookup(PDFName.of('EmbeddedFiles')) : null
        if (embedded instanceof PDFDict) {
            const count = (node, depth = 0) => {
                if (!(node instanceof PDFDict) || depth > 10) return 0
                const leaf = node.lookup(PDFName.of('Names'))
                let n = leaf instanceof PDFArray ? Math.floor(leaf.size() / 2) : 0
                const kids = node.lookup(PDFName.of('Kids'))
                if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) n += count(kids.lookup(i), depth + 1)
                return n
            }
            attachments = count(embedded)
        }
    } catch {
        // malformed name tree
    }

    const rows = [
        ['Title', info.title], ['Author', info.author], ['Subject', info.subject], ['Keywords', info.keywords],
        ['Creator (app)', info.creator], ['Producer', info.producer],
        ['Created', info.creationDate], ['Modified', info.modificationDate],
        ['Pages', pageCount ? String(pageCount) : ''],
        ['XMP creator', xmp?.creator], ['XMP title', xmp?.title], ['XMP description', xmp?.description],
        ['XMP subject', xmp?.subject], ['XMP rights', xmp?.rights], ['XMP creator tool', xmp?.creatorTool],
        ['XMP producer', xmp?.producer], ['XMP keywords', xmp?.keywords], ['XMP created', xmp?.createDate],
        ['XMP modified', xmp?.modifyDate], ['Document ID', xmp?.documentId], ['Instance ID', xmp?.instanceId],
        ['Annotations', annotationCount ? String(annotationCount) : ''],
        ['Comment authors', [...commentAuthors].join(', ')],
        ['Attached files', attachments ? String(attachments) : ''],
    ].filter(([, v]) => v).map(([key, value]) => ({ key, value: truncate(String(value)) }))

    return { encrypted, pageCount, info, xmp, commentAuthors: [...commentAuthors], attachments, rows }
}

/** Things in the PDF metadata that could identify a person or organisation. */
export function findPdfRisks(meta) {
    const { info, xmp } = meta
    const risks = []
    const add = (id, severity, title, why, pairs) => {
        const seen = new Set()
        const items = []
        for (const [key, value] of pairs) {
            if (!value || seen.has(value)) continue
            seen.add(value)
            items.push({ key, value: value.length > 200 ? `${value.slice(0, 200)}…` : value })
        }
        if (items.length) risks.push({ id, severity, title, why, items })
    }
    add('author', 'high', 'Author name', 'Names the person (or account) that created the document.', [['Author', info.author], ['XMP creator', xmp?.creator]])
    add('comments', 'high', 'Comment authors', 'Reviewers’ names are stored with every comment.', meta.commentAuthors.map(name => ['Comment author', name]))
    add('attachments', 'medium', 'Attached files', 'Embedded files travel with the PDF and may contain more personal data.', meta.attachments ? [['Attachments', `${meta.attachments} file${meta.attachments === 1 ? '' : 's'}`]] : [])
    add('text', 'medium', 'Title, subject and keywords', 'Often reveal internal project or file names.', [['Title', info.title], ['Subject', info.subject], ['Keywords', info.keywords], ['XMP title', xmp?.title], ['XMP description', xmp?.description], ['XMP keywords', xmp?.keywords], ['XMP rights', xmp?.rights]])
    add('software', 'low', 'Software used', 'Reveals the apps and versions used to make the file.', [['Creator', info.creator], ['Producer', info.producer], ['XMP creator tool', xmp?.creatorTool], ['XMP producer', xmp?.producer]])
    add('dates', 'low', 'Creation and modification dates', 'Shows when the document was written and edited.', [['Created', info.creationDate], ['Modified', info.modificationDate], ['XMP created', xmp?.createDate], ['XMP modified', xmp?.modifyDate]])
    add('ids', 'low', 'Unique document IDs', 'Can link versions of the document together.', [['Document ID', xmp?.documentId], ['Instance ID', xmp?.instanceId]])
    return risks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

// ---------------------------------------------------------------------------
// Office documents (docx/xlsx/pptx and OpenDocument)

const OFFICE_TYPES = {
    docx: 'Word document', docm: 'Word document', dotx: 'Word template',
    xlsx: 'Excel workbook', xlsm: 'Excel workbook', xltx: 'Excel template',
    pptx: 'PowerPoint presentation', pptm: 'PowerPoint presentation', potx: 'PowerPoint template',
    odt: 'OpenDocument text', ods: 'OpenDocument spreadsheet', odp: 'OpenDocument presentation', odg: 'OpenDocument drawing',
}

export function isOfficeFile(file) {
    const ext = splitFilename(file?.name || '').ext.toLowerCase()
    return ext in OFFICE_TYPES
}

function xmlText(doc, ns, name) {
    const values = [...doc.getElementsByTagNameNS(ns, name)].map(el => el.textContent.trim()).filter(Boolean)
    return [...new Set(values)].join(', ')
}

function parseXml(text) {
    if (!text) return null
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    return doc.getElementsByTagName('parsererror').length ? null : doc
}

/**
 * Document properties of Office Open XML and OpenDocument files: author,
 * last editor, company, template, dates, plus names on comments and
 * tracked changes. Resolves to { kind, fields, commentAuthors, revisionAuthors, rows }.
 */
export async function readOfficeMetadata(file) {
    const ext = splitFilename(file.name || '').ext.toLowerCase()
    let zip
    try {
        const JSZip = (await import('jszip')).default
        zip = await JSZip.loadAsync(file)
    } catch (err) {
        throw new MetadataError('This document couldn’t be opened. It may be damaged, password-protected or not really an Office file.', { code: 'corrupt', cause: err })
    }
    const read = async (path) => {
        try {
            return (await zip.file(path)?.async('string')) ?? null
        } catch {
            return null
        }
    }
    const DC = 'http://purl.org/dc/elements/1.1/'
    const fields = {}
    const commentAuthors = new Set()
    const revisionAuthors = new Set()

    const odfMeta = parseXml(await read('meta.xml'))
    if (odfMeta) {
        const META = 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0'
        Object.assign(fields, {
            author: xmlText(odfMeta, META, 'initial-creator'),
            lastModifiedBy: xmlText(odfMeta, DC, 'creator'),
            title: xmlText(odfMeta, DC, 'title'),
            subject: xmlText(odfMeta, DC, 'subject'),
            keywords: xmlText(odfMeta, META, 'keyword'),
            description: xmlText(odfMeta, DC, 'description'),
            created: xmlText(odfMeta, META, 'creation-date'),
            modified: xmlText(odfMeta, DC, 'date'),
            printed: xmlText(odfMeta, META, 'print-date'),
            application: xmlText(odfMeta, META, 'generator'),
        })
    }

    const core = parseXml(await read('docProps/core.xml'))
    if (core) {
        const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
        const TERMS = 'http://purl.org/dc/terms/'
        Object.assign(fields, {
            author: xmlText(core, DC, 'creator'),
            lastModifiedBy: xmlText(core, CP, 'lastModifiedBy'),
            title: xmlText(core, DC, 'title'),
            subject: xmlText(core, DC, 'subject'),
            keywords: xmlText(core, CP, 'keywords'),
            description: xmlText(core, DC, 'description'),
            category: xmlText(core, CP, 'category'),
            created: xmlText(core, TERMS, 'created'),
            modified: xmlText(core, TERMS, 'modified'),
            printed: xmlText(core, CP, 'lastPrinted'),
            revision: xmlText(core, CP, 'revision'),
        })
    }
    const app = parseXml(await read('docProps/app.xml'))
    if (app) {
        const EP = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'
        const version = xmlText(app, EP, 'AppVersion')
        Object.assign(fields, {
            application: [xmlText(app, EP, 'Application'), version].filter(Boolean).join(' '),
            company: xmlText(app, EP, 'Company'),
            manager: xmlText(app, EP, 'Manager'),
            template: xmlText(app, EP, 'Template'),
            editingMinutes: xmlText(app, EP, 'TotalTime'),
        })
    }
    if (!odfMeta && !core && !app && !zip.file('[Content_Types].xml')) {
        throw new MetadataError('This doesn’t look like an Office or OpenDocument file.', { code: 'unsupported' })
    }

    // Names on comments and tracked changes
    const attrNames = (text, re, set) => {
        if (!text) return
        for (const m of text.matchAll(re)) {
            const name = m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
            if (name) set.add(name)
            if (set.size > 50) break
        }
    }
    attrNames(await read('word/comments.xml'), /w:author="([^"]+)"/g, commentAuthors)
    attrNames(await read('word/people.xml'), /w15:author="([^"]+)"/g, commentAuthors)
    attrNames(await read('ppt/commentAuthors.xml'), /\bname="([^"]+)"/g, commentAuthors)
    for (const path of Object.keys(zip.files).filter(p => /^xl\/comments\d*\.xml$/.test(p)).slice(0, 20)) {
        attrNames(await read(path), /<author>([^<]+)<\/author>/g, commentAuthors)
    }
    const documentXml = await read('word/document.xml')
    if (documentXml && documentXml.length < 20_000_000) attrNames(documentXml, /<w:(?:ins|del)\b[^>]*\bw:author="([^"]+)"/g, revisionAuthors)
    if (odfMeta) attrNames(await read('content.xml'), /<dc:creator>([^<]+)<\/dc:creator>/g, commentAuthors)

    const rows = [
        ['Author', fields.author], ['Last modified by', fields.lastModifiedBy], ['Company', fields.company],
        ['Manager', fields.manager], ['Title', fields.title], ['Subject', fields.subject], ['Keywords', fields.keywords],
        ['Description', fields.description], ['Category', fields.category], ['Template', fields.template],
        ['Application', fields.application], ['Created', fields.created], ['Modified', fields.modified],
        ['Last printed', fields.printed], ['Revision', fields.revision],
        ['Editing time (minutes)', fields.editingMinutes],
        ['Comment authors', [...commentAuthors].join(', ')],
        ['Tracked-change authors', [...revisionAuthors].join(', ')],
    ].filter(([, v]) => v).map(([key, value]) => ({ key, value: truncate(String(value)) }))

    return {
        kind: OFFICE_TYPES[ext] ?? 'Office document',
        fields,
        commentAuthors: [...commentAuthors],
        revisionAuthors: [...revisionAuthors],
        rows,
    }
}

/** Things in Office document properties that could identify people or an organisation. */
export function findOfficeRisks(meta) {
    const f = meta.fields
    const risks = []
    const add = (id, severity, title, why, pairs) => {
        const seen = new Set()
        const items = []
        for (const [key, value] of pairs) {
            if (!value || seen.has(value)) continue
            seen.add(value)
            items.push({ key, value: value.length > 200 ? `${value.slice(0, 200)}…` : value })
        }
        if (items.length) risks.push({ id, severity, title, why, items })
    }
    add('author', 'high', 'Author and last editor', 'Names the people (or accounts) that wrote and last saved the file.', [['Author', f.author], ['Last modified by', f.lastModifiedBy]])
    add('comments', 'high', 'Comment and tracked-change authors', 'Reviewers’ names stay in the file even after comments are hidden.', [...meta.commentAuthors.map(n => ['Comment author', n]), ...meta.revisionAuthors.map(n => ['Tracked change by', n])])
    add('org', 'medium', 'Company and manager', 'Identifies your organisation.', [['Company', f.company], ['Manager', f.manager]])
    add('text', 'medium', 'Title, subject and keywords', 'Often reveal internal project or file names.', [['Title', f.title], ['Subject', f.subject], ['Keywords', f.keywords], ['Description', f.description], ['Category', f.category]])
    add('template', 'low', 'Template path', 'Template names can include user or server paths.', [['Template', f.template]])
    add('software', 'low', 'Software used', 'Reveals the apps and versions used to make the file.', [['Application', f.application]])
    add('dates', 'low', 'Dates and editing time', 'Show when and how long the document was worked on.', [['Created', f.created], ['Modified', f.modified], ['Last printed', f.printed], ['Editing time (minutes)', f.editingMinutes]])
    return risks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

// ---------------------------------------------------------------------------
// Removing metadata

function concat(chunks) {
    const total = chunks.reduce((n, c) => n + c.byteLength, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) {
        out.set(c, offset)
        offset += c.byteLength
    }
    return out
}

function segmentStartsWith(bytes, start, text) {
    for (let i = 0; i < text.length; i++) if (bytes[start + i] !== text.charCodeAt(i)) return false
    return true
}

// Orientation from the JPEG's EXIF block (1 when absent)
function readJpegOrientation(bytes) {
    let i = 2
    while (i + 4 < bytes.length && bytes[i] === 0xff) {
        const marker = bytes[i + 1]
        if (marker === 0xda || marker === 0xd9) break
        const len = (bytes[i + 2] << 8) | bytes[i + 3]
        if (marker === 0xe1 && segmentStartsWith(bytes, i + 4, 'Exif\0\0')) {
            const t = i + 10
            const little = bytes[t] === 0x49
            const u16 = (p) => (little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1])
            const u32 = (p) => (little ? (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0 : ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0)
            const ifd = t + u32(t + 4)
            const count = u16(ifd)
            for (let n = 0; n < count && ifd + 2 + n * 12 + 12 <= i + 2 + len; n++) {
                const entry = ifd + 2 + n * 12
                if (u16(entry) === 0x0112) {
                    const value = u16(entry + 8)
                    return value >= 1 && value <= 8 ? value : 1
                }
            }
            return 1
        }
        i += 2 + len
    }
    return 1
}

// A minimal EXIF block holding only the Orientation tag, so stripped photos
// still display the right way up.
function orientationSegment(orientation) {
    return new Uint8Array([
        0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1, length 34, "Exif\0\0"
        0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header, IFD0 at 8
        0x00, 0x01, // one entry
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation SHORT
        0x00, 0x00, 0x00, 0x00, // no next IFD
    ])
}

/**
 * Removes EXIF, XMP, IPTC, comments and appended images (MPF) from a JPEG
 * without re-encoding it. Keeps JFIF, the ICC colour profile, the Adobe
 * colour-transform marker and the orientation. Returns null if the file
 * doesn't parse.
 */
export function stripJpeg(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
    const orientation = readJpegOrientation(bytes)
    const out = [bytes.subarray(0, 2)]
    let insertedOrientation = orientation === 1
    let i = 2
    let sawImage = false
    while (i < bytes.length) {
        if (bytes[i] !== 0xff) return null
        const marker = bytes[i + 1]
        if (marker === 0xff) { i++; continue } // fill byte
        if (marker === 0xd9) { out.push(bytes.subarray(i, i + 2)); break } // EOI: drop anything after it
        if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(bytes.subarray(i, i + 2)); i += 2; continue }
        if (i + 4 > bytes.length) return null
        const len = (bytes[i + 2] << 8) | bytes[i + 3]
        if (len < 2 || i + 2 + len > bytes.length) return null
        const end = i + 2 + len
        // The orientation block goes first (after JFIF's APP0, if there is one)
        if (!insertedOrientation && marker !== 0xe0) { out.push(orientationSegment(orientation)); insertedOrientation = true }
        if (marker === 0xda) {
            // Start of scan: copy the entropy-coded data up to the next real marker
            let j = end
            while (j < bytes.length) {
                if (bytes[j] === 0xff) {
                    const next = bytes[j + 1]
                    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { j += 2; continue }
                    if (next === 0xff) { j += 1; continue }
                    break
                }
                j++
            }
            out.push(bytes.subarray(i, j))
            sawImage = true
            i = j
            continue
        }
        let keep = true
        if (marker === 0xe1 || marker === 0xed || marker === 0xfe || marker === 0xef) keep = false // EXIF/XMP, IPTC, comment, APP15
        else if (marker === 0xe2) keep = segmentStartsWith(bytes, i + 4, 'ICC_PROFILE\0') // drop MPF / FlashPix
        else if (marker >= 0xe3 && marker <= 0xec) keep = false // APP3–APP12 (Ducky, Meta, …)
        if (keep) out.push(bytes.subarray(i, end))
        if (marker === 0xe0 && !insertedOrientation) { out.push(orientationSegment(orientation)); insertedOrientation = true }
        i = end
    }
    return sawImage ? concat(out) : null
}

const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCv', 'cLLi', 'bKGD', 'hIST', 'pHYs', 'sPLT', 'acTL', 'fcTL', 'fdAT'])

/** Drops text, EXIF and timestamp chunks from a PNG (lossless, keeps APNG frames). */
export function stripPng(bytes) {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (!sig.every((b, i) => bytes[i] === b)) return null
    const out = [bytes.subarray(0, 8)]
    let i = 8
    let sawEnd = false
    while (i + 12 <= bytes.length) {
        const len = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
        const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
        const end = i + 12 + len
        if (end > bytes.length) return null
        const critical = type.charCodeAt(0) < 0x61 // uppercase first letter
        if (PNG_KEEP.has(type) || (critical && type !== 'eXIf')) out.push(bytes.subarray(i, end))
        i = end
        if (type === 'IEND') { sawEnd = true; break }
    }
    return sawEnd ? concat(out) : null
}

/** Drops EXIF and XMP chunks from a WebP (lossless). */
export function stripWebp(bytes) {
    const tag = (p) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3])
    if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null
    const out = []
    let i = 12
    while (i + 8 <= bytes.length) {
        const type = tag(i)
        const size = (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0
        const end = Math.min(bytes.length, i + 8 + size + (size & 1))
        if (type !== 'EXIF' && type !== 'XMP ') {
            const chunk = bytes.slice(i, end)
            if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04) // clear EXIF and XMP flags
            out.push(chunk)
        }
        i = end
    }
    const body = concat(out)
    const result = new Uint8Array(12 + body.length)
    result.set(bytes.subarray(0, 12))
    result.set(body, 12)
    new DataView(result.buffer).setUint32(4, result.length - 8, true)
    return result
}

/**
 * Makes a copy of an image without its metadata.
 * JPEG, PNG and WebP are cleaned losslessly; other formats are redrawn and
 * re-encoded (see `note`). Resolves to { blob, name, lossless, note }.
 */
export async function createCleanCopy(file) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const type = sniffImageType(bytes.subarray(0, 4096)) || file.type
    const base = splitFilename(file.name || 'image').base || 'image'
    const strippers = { 'image/jpeg': stripJpeg, 'image/png': stripPng, 'image/webp': stripWebp }
    if (strippers[type]) {
        try {
            const out = strippers[type](bytes)
            if (out) {
                return {
                    blob: new Blob([out], { type }),
                    name: `${base}-clean.${extensionForType(type)}`,
                    lossless: true,
                    note: type === 'image/jpeg'
                        ? 'Pixels untouched. Only the orientation and colour profile were kept.'
                        : 'Pixels untouched. Only the colour information was kept.',
                }
            }
        } catch {
            // fall back to re-encoding
        }
    }

    let loaded
    try {
        loaded = await loadImage(file)
    } catch (err) {
        const message = err instanceof ImageError && err.code !== 'undecodable'
            ? err.message
            : type && type.startsWith('image/')
                ? `This browser can’t open ${typeLabel(type)} images, so it can’t make a clean copy here.`
                : 'This file isn’t an image the browser can open, so no clean copy can be made.'
        throw new MetadataError(message, { code: 'undecodable', cause: err })
    }
    try {
        const canvas = renderImage(loaded)
        const support = await getEncoderSupport()
        let outType = 'image/png'
        let note = `Redrawn and saved as PNG. Colour profiles${type === 'image/gif' ? ' and animation frames' : ''} aren’t kept.`
        if (type === 'image/jpeg' || type === 'image/heic') {
            outType = 'image/jpeg'
            note = `Redrawn and saved as JPEG at 95% quality${type === 'image/heic' ? ' (browsers can’t write HEIC)' : ''}. Colour profiles aren’t kept.`
        } else if (type === 'image/webp' && support['image/webp']) {
            outType = 'image/webp'
            note = 'Redrawn and saved as WebP at 95% quality. Colour profiles aren’t kept.'
        } else if (type === 'image/avif' && support['image/avif']) {
            outType = 'image/avif'
            note = 'Redrawn and saved as AVIF at 95% quality. Colour profiles aren’t kept.'
        }
        let blob
        try {
            blob = await encodeCanvas(canvas, { type: outType, quality: 0.95 })
        } finally {
            canvasAsImage(canvas).close()
        }
        return { blob, name: `${base}-clean.${extensionForType(blob.type)}`, lossless: false, note }
    } finally {
        loaded.close()
    }
}
