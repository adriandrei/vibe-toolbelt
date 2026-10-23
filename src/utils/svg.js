// DOM-based SVG optimizer used by the SVG Optimizer page.
//
// The markup is parsed with DOMParser, cleaned on the DOM tree and serialised
// again with XMLSerializer, so the output is always well-formed XML (it's
// re-parsed as a final check). Only safe optimisations are applied:
//
// - Comments (except "<!--! … -->" licence comments), <metadata>, the DOCTYPE
//   and editor data (Inkscape, Sodipodi, Illustrator, Sketch, Figma… elements
//   and attributes in their namespaces, plus their now-unused xmlns:*
//   declarations) are removed.
// - Whitespace-only text between structural elements (<svg>, <g>, <defs>,
//   shapes…) is dropped: it's never rendered, whatever xml:space says.
//   Whitespace inside geometry attributes (d, points, transform, viewBox…) and
//   style="" is collapsed, and numbers lose redundant zeros ("0.500" -> ".5").
//   Character data inside text content elements (<text>, <tspan>, <textPath>,
//   <title>, <desc>), <style>, <script> and <foreignObject>, including any
//   xml:space="preserve" text, is never touched.
// - viewBox is always kept, and so is every id that's referenced (url(#…),
//   href="#…", CSS selectors, aria-*, SMIL timing). Removing unreferenced ids
//   is opt-in.
// - Numbers can optionally be rounded to a given number of decimals.

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const COMMENT_NODE = 8
const DOCUMENT_TYPE_NODE = 10

// Namespaces used by drawing apps for their own editing data (same list as SVGO)
const EDITOR_NAMESPACES = new Set([
    'http://creativecommons.org/ns#',
    'http://inkscape.sourceforge.net/DTD/sodipodi-0.dtd',
    'http://ns.adobe.com/AdobeIllustrator/10.0/',
    'http://ns.adobe.com/AdobeSVGViewerExtensions/3.0/',
    'http://ns.adobe.com/Extensibility/1.0/',
    'http://ns.adobe.com/Flows/1.0/',
    'http://ns.adobe.com/GenericCustomNamespace/1.0/',
    'http://ns.adobe.com/Graphs/1.0/',
    'http://ns.adobe.com/ImageReplacement/1.0/',
    'http://ns.adobe.com/SaveForWeb/1.0/',
    'http://ns.adobe.com/Variables/1.0/',
    'http://ns.adobe.com/XPath/1.0/',
    'http://purl.org/dc/elements/1.1/',
    'http://schemas.microsoft.com/visio/2003/SVGExtensions/',
    'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
    'http://taptrix.com/vectorillustrator/svg_extensions',
    'http://www.bohemiancoding.com/sketch/ns',
    'http://www.figma.com/figma/ns',
    'http://www.inkscape.org/namespaces/inkscape',
    'http://www.serif.com/',
    'http://www.vector.evaxdesign.sk',
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'https://boxy-svg.com',
])

// Elements whose character data is content: their text nodes are kept as-is
const CHARACTER_DATA_ELEMENTS = new Set([
    'text', 'tspan', 'textPath', 'tref', 'altGlyph', 'title', 'desc', 'style', 'script', 'foreignObject', 'metadata',
])

// Attributes whose value is a whitespace-insensitive list of numbers/keywords
const LIST_ATTRS = new Set([
    'viewBox', 'class', 'preserveAspectRatio', 'stroke-dasharray', 'values', 'keyTimes', 'keySplines', 'keyPoints',
    'kernelMatrix', 'tableValues', 'rotate', 'x', 'y', 'dx', 'dy', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'fx', 'fy', 'width', 'height', 'offset', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity',
    'flood-opacity', 'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'font-size', 'stdDeviation',
    'baseFrequency', 'radius', 'enable-background',
])
const TRANSFORM_ATTRS = new Set(['transform', 'gradientTransform', 'patternTransform'])

// Attributes whose numbers may be rounded (viewBox is deliberately left alone)
const ROUND_ATTRS = new Set([
    'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'width', 'height',
    'dx', 'dy', 'stroke-width', 'stroke-dashoffset', 'stroke-dasharray', 'font-size', 'stdDeviation', 'refX', 'refY',
    'markerWidth', 'markerHeight', 'startOffset', 'textLength',
])
// Need at least two decimals, or translucency and stops change visibly
const OPACITY_ATTRS = new Set(['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'flood-opacity', 'offset'])

// Attributes holding space-separated id references
const ID_LIST_ATTRS = new Set([
    'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-flowto',
    'aria-activedescendant', 'aria-details', 'aria-errormessage',
])

export const DEFAULT_SVG_OPTIONS = Object.freeze({
    removeComments: true,
    removeMetadata: true,
    collapseWhitespace: true,
    roundNumbers: false,
    precision: 3,
    removeUnusedIds: false,
})

/** UTF-8 size of a string in bytes. */
export function byteSize(text) {
    return new TextEncoder().encode(text).length
}

/** data: URL for showing SVG markup in an <img> (scripts never run there). */
export function svgDataUrl(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// ---------------------------------------------------------------- parsing

// Index just past the start tag beginning at `start` (quotes respected), or -1.
function endOfTag(text, start) {
    let quote = null
    for (let i = start; i < text.length; i++) {
        const ch = text[i]
        if (quote) {
            if (ch === quote) quote = null
        } else if (ch === '"' || ch === "'") {
            quote = ch
        } else if (ch === '>') {
            return i + 1
        }
    }
    return -1
}

// Index of the root element's "<", skipping the XML declaration, comments,
// processing instructions and the DOCTYPE (with an internal subset).
function rootStart(text) {
    let i = 0
    while (i < text.length) {
        while (i < text.length && /\s/.test(text[i])) i++
        if (text.startsWith('<?', i)) {
            const end = text.indexOf('?>', i)
            if (end < 0) return -1
            i = end + 2
        } else if (text.startsWith('<!--', i)) {
            const end = text.indexOf('-->', i)
            if (end < 0) return -1
            i = end + 3
        } else if (/^<!DOCTYPE/i.test(text.slice(i, i + 9))) {
            const bracket = text.indexOf('[', i)
            const close = text.indexOf('>', i)
            if (bracket >= 0 && bracket < close) {
                const end = text.indexOf(']', bracket)
                if (end < 0) return -1
                i = text.indexOf('>', end) + 1
                if (i === 0) return -1
            } else {
                if (close < 0) return -1
                i = close + 1
            }
        } else {
            return i
        }
    }
    return -1
}

function parserErrorMessage(doc) {
    const err = doc.getElementsByTagName('parsererror')[0]
    if (!err) return null
    const raw = err.textContent || ''
    // Firefox: "XML Parsing Error: msg\nLocation: …\nLine Number 1, Column 49:\n<source line>\n---^"
    const gecko = raw.match(/XML Parsing Error:\s*([^\n]*)[\s\S]*?Line Number (\d+), Column (\d+)/i)
    if (gecko) return `Line ${gecko[2]}, column ${gecko[3]}: ${gecko[1].trim()}`
    // Chromium/WebKit: "This page contains the following errors:error on line 1 at column 52: msg Below is a rendering…"
    const text = raw
        .replace(/\s+/g, ' ')
        .replace(/^.*?This page contains the following errors:\s*/i, '')
        .replace(/Below is a rendering of the page up to the first error\.?\s*$/i, '')
        .replace(/\{[^}\s]+\}/g, '')
        .trim()
    const blink = text.match(/^error on line (\d+) at column (\d+):\s*(.*)$/i)
    if (blink) return `Line ${blink[1]}, column ${blink[2]}: ${blink[3]}`
    return text || 'The markup is not well-formed XML'
}

/**
 * Parses SVG markup. Returns { doc, fixes, text } or { error }; `text` is the
 * markup with the fixes applied.
 * Inline SVG copied from HTML usually lacks the xmlns declarations a
 * standalone .svg file needs; they're added (and listed in `fixes`).
 */
export function parseSvg(source) {
    let text = String(source ?? '').replace(/^\uFEFF/, '').trim()
    if (!text) return { error: 'Nothing to optimize yet.' }
    const fixes = []

    const start = rootStart(text)
    if (start < 0 || !/^<svg[\s>/]/.test(text.slice(start, start + 5))) {
        const tag = start >= 0 ? text.slice(start).match(/^<([^\s>/]+)/)?.[1] : null
        return { error: tag ? `The root element is <${tag}>, not <svg>.` : 'This doesn’t look like SVG markup: it should start with <svg>.' }
    }
    const tagEnd = endOfTag(text, start)
    if (tagEnd < 0) return { error: 'The <svg> start tag is never closed.' }
    const startTag = text.slice(start, tagEnd)
    let insert = ''
    if (!/\sxmlns\s*=/.test(startTag)) {
        insert += ` xmlns="${SVG_NS}"`
        fixes.push('Added the missing xmlns="http://www.w3.org/2000/svg" (needed by .svg files and <img>).')
    }
    if (/\sxlink:[a-zA-Z]/.test(text) && !/xmlns:xlink\s*=/.test(text)) {
        insert += ` xmlns:xlink="${XLINK_NS}"`
        fixes.push('Declared the xlink namespace used by xlink:href.')
    }
    if (insert) text = text.slice(0, start + 4) + insert + text.slice(start + 4)

    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const error = parserErrorMessage(doc)
    if (error) return { error }
    const root = doc.documentElement
    if (!root || root.namespaceURI !== SVG_NS || root.localName !== 'svg') {
        return { error: 'The root element must be an SVG <svg> element.' }
    }
    return { doc, fixes, text }
}

// ------------------------------------------------------- value minifiers

const collapse = (value) => value.replace(/\s+/g, ' ').trim()

// Drops the leading zero of decimals: "0.5" -> ".5", "-0.5" -> "-.5"
const dropLeadingZeros = (value) => value.replace(/(^|[^\d.eE])0+(\.\d)/g, '$1$2')

function compactPath(d) {
    return dropLeadingZeros(
        collapse(d)
            .replace(/\s*,\s*/g, ',')
            .replace(/\s*([MmZzLlHhVvCcSsQqTtAa])\s*/g, '$1')
            // "10 -5" -> "10-5": a minus sign always starts a new number
            .replace(/([\d.])\s+(?=-)/g, '$1')
    )
}

function compactPoints(points) {
    return dropLeadingZeros(collapse(points).replace(/\s*,\s*/g, ','))
}

function compactTransform(value) {
    return collapse(value)
        .replace(/\s*\(\s*/g, '(')
        .replace(/\s*\)\s*/g, ') ')
        .replace(/\s*,\s*/g, ',')
        .trim()
}

// Splits on `separator` outside quotes and parentheses.
function splitOutside(text, separator) {
    const parts = []
    let buf = ''
    let quote = null
    let depth = 0
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (quote) {
            buf += ch
            if (ch === '\\' && i + 1 < text.length) buf += text[++i]
            else if (ch === quote) quote = null
            continue
        }
        if (ch === '"' || ch === "'") quote = ch
        else if (ch === '(') depth++
        else if (ch === ')') depth = Math.max(0, depth - 1)
        if (ch === separator && depth === 0) {
            parts.push(buf)
            buf = ''
            continue
        }
        buf += ch
    }
    parts.push(buf)
    return parts
}

// Collapses whitespace runs outside quoted strings.
function collapseOutsideQuotes(text) {
    let out = ''
    let quote = null
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (quote) {
            out += ch
            if (ch === '\\' && i + 1 < text.length) out += text[++i]
            else if (ch === quote) quote = null
        } else if (ch === '"' || ch === "'") {
            quote = ch
            out += ch
        } else if (/\s/.test(ch)) {
            if (!out.endsWith(' ')) out += ' '
        } else {
            out += ch
        }
    }
    return out.trim()
}

// style="fill: red ;  stroke : blue;" -> "fill:red;stroke:blue"
function minifyStyle(style) {
    return splitOutside(style, ';')
        .map((decl) => {
            const [prop, ...rest] = splitOutside(decl, ':')
            const name = prop.trim()
            const value = collapseOutsideQuotes(rest.join(':'))
            return name && value ? `${name}:${value}` : ''
        })
        .filter(Boolean)
        .join(';')
}

// precision null: no rounding, only redundant zeros dropped
function formatNumber(n, precision) {
    let rounded = precision == null ? n : Number(n.toFixed(precision))
    if (Object.is(rounded, -0)) rounded = 0
    const s = String(rounded)
    if (s.startsWith('0.')) return s.slice(1)
    if (s.startsWith('-0.')) return `-${s.slice(2)}`
    return s
}

// Rounds every decimal number in a value (or, with precision null, only drops
// redundant zeros). Integers are left alone, so arc flags written as "011"
// can't be misread, and a space is inserted wherever two numbers would
// otherwise run together ("1.0.5" -> "1 .5").
const DECIMAL = /[-+]?(?:\d*\.\d+|\d+\.)(?:[eE][-+]?\d+)?/g
function roundNumbers(value, precision) {
    let out = ''
    let last = 0
    for (const match of value.matchAll(DECIMAL)) {
        out += value.slice(last, match.index)
        let s = formatNumber(Number(match[0]), precision)
        if (/[\d.]$/.test(out) && /^[\d.]/.test(s)) s = ` ${s}`
        out += s
        last = match.index + match[0].length
    }
    return out + value.slice(last)
}

// ------------------------------------------------------- id references

function decodeFragment(value) {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

function collectReferences(doc) {
    const ids = new Set()
    let scripted = false
    const fromUrls = (text) => {
        for (const m of text.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) ids.add(decodeFragment(m[1]))
    }
    for (const el of doc.getElementsByTagName('*')) {
        if (el.localName === 'script') scripted = true
        if (el.localName === 'style') {
            const css = el.textContent || ''
            fromUrls(css)
            // Any "#name" in a stylesheet (selectors; colours like #fff only keep an id that happens to match)
            for (const m of css.matchAll(/#(-?[_a-zA-Z\u00a0-\uffff][-_a-zA-Z0-9\u00a0-\uffff]*)/g)) ids.add(m[1])
        }
        for (const attr of el.attributes) {
            const name = attr.localName
            const value = attr.value
            if (name.startsWith('on')) scripted = true
            if (name === 'href' && value.startsWith('#')) ids.add(decodeFragment(value.slice(1)))
            if (value.includes('url(')) fromUrls(value)
            if (ID_LIST_ATTRS.has(name)) value.split(/\s+/).filter(Boolean).forEach((id) => ids.add(id))
            if (name === 'begin' || name === 'end') {
                for (const m of value.matchAll(/(?:^|;)\s*([^\s.;+-][^\s.;]*)\.[a-zA-Z]/g)) ids.add(m[1])
            }
        }
    }
    return { ids, scripted }
}

// ------------------------------------------------------------ optimiser

/**
 * Optimises SVG markup.
 *
 * Returns { output, source, before, after, removed, fixes } on success, or
 * { error } when the input isn't valid SVG. `source` is the input with any
 * fixes applied (renderable as an image); `removed` counts what was taken out.
 */
export function optimizeSvg(source, options = {}) {
    const opts = { ...DEFAULT_SVG_OPTIONS, ...options }
    const parsed = parseSvg(source)
    if (parsed.error) return { error: parsed.error }
    const { doc, fixes } = parsed
    const root = doc.documentElement

    const removed = { comments: 0, metadata: 0, editorData: 0, whitespace: 0, emptyGroups: 0, ids: 0 }
    const precision = Math.min(6, Math.max(0, Math.round(Number(opts.precision) || 0)))

    const isEditorNode = (node) => node.namespaceURI && EDITOR_NAMESPACES.has(node.namespaceURI)

    const cleanAttributes = (el) => {
        for (const attr of [...el.attributes]) {
            if (opts.removeMetadata) {
                if (isEditorNode(attr) || (attr.namespaceURI === XMLNS_NS && EDITOR_NAMESPACES.has(attr.value))) {
                    el.removeAttributeNode(attr)
                    removed.editorData++
                    continue
                }
            }
            if (attr.namespaceURI !== null) continue
            const name = attr.localName
            let value = attr.value
            if (opts.collapseWhitespace) {
                if (name === 'style') value = minifyStyle(value)
                else if (name === 'd') value = compactPath(value)
                else if (name === 'points') value = compactPoints(value)
                else if (TRANSFORM_ATTRS.has(name)) value = compactTransform(value)
                else if (LIST_ATTRS.has(name)) value = collapse(value)
            }
            const numeric = ROUND_ATTRS.has(name) || OPACITY_ATTRS.has(name) || TRANSFORM_ATTRS.has(name)
            if (opts.roundNumbers && numeric) {
                const digits = OPACITY_ATTRS.has(name) ? Math.max(precision, 2) : TRANSFORM_ATTRS.has(name) ? Math.max(precision, 3) : precision
                value = roundNumbers(value, digits)
            } else if (opts.collapseWhitespace && (numeric || name === 'viewBox')) {
                value = roundNumbers(value, null)
            }
            if (value === attr.value) continue
            if (value === '' && (name === 'style' || name === 'class')) el.removeAttribute(name)
            else attr.value = value
        }
    }

    const walk = (el, preserveText) => {
        cleanAttributes(el)
        // Text inside character-data elements is content (xml:space only
        // matters there); between structural elements whitespace never renders
        const keepText = preserveText
            || el.namespaceURI !== SVG_NS
            || CHARACTER_DATA_ELEMENTS.has(el.localName)

        for (const child of [...el.childNodes]) {
            if (child.nodeType === COMMENT_NODE) {
                if (opts.removeComments && !child.data.startsWith('!')) {
                    child.remove()
                    removed.comments++
                }
            } else if (child.nodeType === TEXT_NODE) {
                // Whitespace between elements is never rendered; text content is
                if (!keepText && opts.collapseWhitespace && !child.data.trim()) {
                    child.remove()
                    removed.whitespace++
                }
            } else if (child.nodeType === ELEMENT_NODE) {
                if (opts.removeMetadata && isEditorNode(child)) {
                    child.remove()
                    removed.editorData++
                } else if (opts.removeMetadata && child.namespaceURI === SVG_NS && child.localName === 'metadata') {
                    child.remove()
                    removed.metadata++
                } else {
                    walk(child, keepText)
                    const emptyContainer = child.namespaceURI === SVG_NS
                        && (child.localName === 'g' || child.localName === 'defs')
                        && !child.hasChildNodes()
                        && !child.hasAttribute('id')
                    if (opts.collapseWhitespace && emptyContainer) {
                        child.remove()
                        removed.emptyGroups++
                    }
                }
            }
        }
    }

    // Top level: DOCTYPE and comments outside the root
    for (const node of [...doc.childNodes]) {
        if (node.nodeType === DOCUMENT_TYPE_NODE && opts.removeMetadata) {
            node.remove()
            removed.metadata++
        } else if (node.nodeType === COMMENT_NODE && opts.removeComments && !node.data.startsWith('!')) {
            node.remove()
            removed.comments++
        }
    }

    walk(root, false)

    if (opts.removeMetadata) {
        // Ignored by browsers on the root element
        if (root.hasAttribute('version')) {
            root.removeAttribute('version')
            removed.editorData++
        }
        for (const name of ['x', 'y']) {
            if (/^\s*0(\.0*)?(px)?\s*$/.test(root.getAttribute(name) ?? 'none')) root.removeAttribute(name)
        }
        // xmlns:prefix declarations no element or attribute uses any more
        // (e.g. xmlns:svg next to the default namespace)
        const elements = [root, ...root.getElementsByTagName('*')]
        const usedPrefixes = new Set()
        for (const el of elements) {
            if (el.prefix) usedPrefixes.add(el.prefix)
            for (const attr of el.attributes) {
                if (attr.prefix && attr.prefix !== 'xmlns') usedPrefixes.add(attr.prefix)
            }
        }
        for (const el of elements) {
            for (const attr of [...el.attributes]) {
                if (attr.namespaceURI === XMLNS_NS && attr.prefix === 'xmlns' && !usedPrefixes.has(attr.localName)) {
                    el.removeAttributeNode(attr)
                }
            }
        }
    }

    if (opts.removeUnusedIds) {
        const { ids, scripted } = collectReferences(doc)
        if (!scripted) {
            for (const el of root.querySelectorAll('[id]')) {
                // Sprite symbols and views are referenced from other files
                if (el.localName === 'symbol' || el.localName === 'view') continue
                if (!ids.has(el.getAttribute('id'))) {
                    el.removeAttribute('id')
                    removed.ids++
                }
            }
        }
    }

    const serializer = new XMLSerializer()
    const output = [...doc.childNodes].map((node) => serializer.serializeToString(node)).join(opts.collapseWhitespace ? '' : '\n')

    // Safety net: the result must parse again
    const check = new DOMParser().parseFromString(output, 'image/svg+xml')
    if (parserErrorMessage(check)) {
        return { error: 'The optimized markup failed validation, so it was discarded. Try turning options off.' }
    }

    return { output, source: parsed.text, before: byteSize(String(source)), after: byteSize(output), removed, fixes }
}
