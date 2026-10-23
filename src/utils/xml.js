// XML helpers built on the browser's DOMParser, shared by the Formatters,
// the Data Converter and the Universal Inspector.

const ELEMENT = 1
const TEXT = 3
const CDATA = 4
const PI = 7
const COMMENT = 8
const DOCTYPE = 10

/** Parses XML. Returns { doc } or { error } with the parser's message. */
export function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    const err = doc.getElementsByTagName('parsererror')[0]
    if (err) {
        const message = (err.textContent || 'Invalid XML').replace(/\s+/g, ' ').trim()
        return { error: message.replace(/^This page contains the following errors:\s*/i, '').replace(/Below is a rendering.*$/i, '').trim() }
    }
    return { doc }
}

function escapeText(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function openTag(el, selfClose) {
    let s = `<${el.nodeName}`
    for (const attr of el.attributes) s += ` ${attr.name}="${escapeAttr(attr.value)}"`
    return s + (selfClose ? '/>' : '>')
}

function serializeInline(node) {
    switch (node.nodeType) {
        case TEXT: return escapeText(node.nodeValue)
        case CDATA: return `<![CDATA[${node.nodeValue}]]>`
        case COMMENT: return `<!--${node.nodeValue}-->`
        case PI: return `<?${node.target} ${node.data}?>`
        case ELEMENT: {
            if (!node.childNodes.length) return openTag(node, true)
            return openTag(node, false) + [...node.childNodes].map(serializeInline).join('') + `</${node.nodeName}>`
        }
        default: return ''
    }
}

function hasMixedContent(el) {
    return [...el.childNodes].some(n => (n.nodeType === TEXT && n.nodeValue.trim()) || n.nodeType === CDATA)
}

function serializePretty(node, depth, indent, out) {
    const pad = indent.repeat(depth)
    switch (node.nodeType) {
        case ELEMENT: {
            const children = [...node.childNodes].filter(n => !(n.nodeType === TEXT && !n.nodeValue.trim()))
            if (!children.length) {
                out.push(pad + openTag(node, true))
            } else if (hasMixedContent(node)) {
                // Text matters here: keep the element's content exactly as written
                out.push(pad + serializeInline(node))
            } else {
                out.push(pad + openTag(node, false))
                for (const child of children) serializePretty(child, depth + 1, indent, out)
                out.push(`${pad}</${node.nodeName}>`)
            }
            break
        }
        case COMMENT: out.push(`${pad}<!--${node.nodeValue}-->`); break
        case PI: out.push(`${pad}<?${node.target} ${node.data}?>`); break
        case CDATA: out.push(`${pad}<![CDATA[${node.nodeValue}]]>`); break
        case TEXT: out.push(pad + escapeText(node.nodeValue.trim())); break
        default: break
    }
}

function declarationOf(text) {
    const m = text.match(/^\s*(<\?xml[^?]*\?>)/)
    return m ? m[1] : null
}

function doctypeOf(doc) {
    const dt = [...doc.childNodes].find(n => n.nodeType === DOCTYPE)
    if (!dt) return null
    let s = `<!DOCTYPE ${dt.name}`
    if (dt.publicId) s += ` PUBLIC "${dt.publicId}"`
    if (dt.systemId) s += `${dt.publicId ? '' : ' SYSTEM'} "${dt.systemId}"`
    return s + '>'
}

/** Pretty-prints XML. Throws an Error with the parser message on invalid input. */
export function formatXml(text, { indent = '  ' } = {}) {
    const { doc, error } = parseXml(text)
    if (error) throw new Error(error)
    const out = []
    const decl = declarationOf(text)
    if (decl) out.push(decl)
    const doctype = doctypeOf(doc)
    if (doctype) out.push(doctype)
    for (const node of doc.childNodes) {
        if (node.nodeType !== DOCTYPE) serializePretty(node, 0, indent, out)
    }
    return out.join('\n')
}

/** Removes formatting whitespace between elements, keeping text content intact. */
export function minifyXml(text) {
    const { doc, error } = parseXml(text)
    if (error) throw new Error(error)
    const strip = (node) => {
        for (const child of [...node.childNodes]) {
            if (child.nodeType === TEXT && !child.nodeValue.trim() && !hasMixedContent(node)) child.remove()
            else if (child.nodeType === ELEMENT) strip(child)
        }
    }
    strip(doc)
    const decl = declarationOf(text)
    const doctype = doctypeOf(doc)
    const body = [...doc.childNodes].filter(n => n.nodeType !== DOCTYPE).map(serializeInline).join('')
    return `${decl || ''}${doctype || ''}${body}`
}
