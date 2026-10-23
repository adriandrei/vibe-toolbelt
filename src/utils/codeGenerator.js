// Turns a request description into cURL, JavaScript fetch() or Python
// requests code. The input has the shape parseCurl() returns (see
// curlParser.js); only `url` is required:
//
//   generateCode({ method: 'POST', url, headers: [{ key, value }], body }, 'fetch')
//
// Every value is escaped for its target: single-quoted shell words, JS and
// Python string literals. Nothing from the request is ever pasted raw.

import { quotePosix } from './shell.js'

export const CODE_TARGETS = [
    { value: 'fetch', label: 'JavaScript', title: 'JavaScript (fetch)', language: 'javascript' },
    { value: 'python', label: 'Python', title: 'Python (requests)', language: 'python' },
    { value: 'curl', label: 'cURL', title: 'cURL (bash, zsh)', language: 'bash' },
]

export const targetLanguage = (target) => CODE_TARGETS.find(t => t.value === target)?.language ?? 'text'

// Request headers a web page isn't allowed to set; fetch() silently drops them
const FORBIDDEN_HEADERS = new Set([
    'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
    'access-control-request-private-network', 'connection', 'content-length', 'cookie', 'cookie2', 'date',
    'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'set-cookie', 'te', 'trailer',
    'transfer-encoding', 'upgrade', 'via',
])

export function isForbiddenHeader(name) {
    const lower = String(name).trim().toLowerCase()
    return FORBIDDEN_HEADERS.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')
}

/** Base64 of the UTF-8 bytes of `text` (btoa alone fails outside Latin-1). */
export function base64Utf8(text) {
    const bytes = new TextEncoder().encode(String(text))
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

const hex = (code, width) => code.toString(16).padStart(width, '0')

function isAscii(text) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false
    return true
}

function isPrintableAscii(text) {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        if (code < 0x20 || code > 0x7e) return false
    }
    return true
}

/** Single-quoted JavaScript string literal. */
export function jsString(value) {
    let out = "'"
    for (const ch of String(value)) {
        const code = ch.codePointAt(0)
        if (ch === '\\') out += '\\\\'
        else if (ch === "'") out += "\\'"
        else if (ch === '\n') out += '\\n'
        else if (ch === '\r') out += '\\r'
        else if (ch === '\t') out += '\\t'
        else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) out += '\\x' + hex(code, 2)
        else if (code === 0x2028 || code === 0x2029 || (code >= 0xd800 && code <= 0xdfff)) out += '\\u' + hex(code, 4)
        else out += ch
    }
    return out + "'"
}

/** Template literal, for readable multi-line bodies. */
function jsTemplate(value) {
    let out = '`'
    const s = String(value)
    for (let i = 0; i < s.length;) {
        const code = s.codePointAt(i)
        const ch = String.fromCodePoint(code)
        i += ch.length
        if (ch === '\\') out += '\\\\'
        else if (ch === '`') out += '\\`'
        else if (ch === '$' && s[i] === '{') out += '\\$'
        else if (ch === '\n' || ch === '\t') out += ch
        else if (ch === '\r') out += '\\r'
        else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) out += '\\x' + hex(code, 2)
        else if (code === 0x2028 || code === 0x2029 || (code >= 0xd800 && code <= 0xdfff)) out += '\\u' + hex(code, 4)
        else out += ch
    }
    return out + '`'
}

/** Single-quoted Python 3 string literal. */
export function pyString(value) {
    let out = "'"
    for (const ch of String(value)) {
        const code = ch.codePointAt(0)
        if (ch === '\\') out += '\\\\'
        else if (ch === "'") out += "\\'"
        else if (ch === '\n') out += '\\n'
        else if (ch === '\r') out += '\\r'
        else if (ch === '\t') out += '\\t'
        else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) out += '\\x' + hex(code, 2)
        else if (code >= 0xd800 && code <= 0xdfff) out += '\\u' + hex(code, 4)
        else out += ch
    }
    return out + "'"
}

const KNOWN_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT']

function normalizeRequest(request = {}) {
    const rawMethod = String(request.method ?? 'GET').trim() || 'GET'
    const method = KNOWN_METHODS.includes(rawMethod.toUpperCase()) ? rawMethod.toUpperCase() : rawMethod
    const headers = (Array.isArray(request.headers) ? request.headers : [])
        .filter(h => h && String(h.key ?? '').trim() !== '')
        .map(h => ({ key: String(h.key).trim(), value: String(h.value ?? '') }))
    const form = (Array.isArray(request.form) ? request.form : []).filter(f => f && String(f.key ?? '') !== '')
    const auth = request.auth && (request.auth.username || request.auth.password)
        ? { username: String(request.auth.username ?? ''), password: String(request.auth.password ?? '') }
        : null
    return {
        method,
        url: String(request.url ?? ''),
        headers,
        body: form.length ? '' : String(request.body ?? ''),
        form,
        auth,
        implicitContentType: request.implicitContentType || null,
        removeHeaders: Array.isArray(request.removeHeaders) ? request.removeHeaders : [],
        options: request.options || {},
    }
}

const hasHeader = (headers, name) => headers.some(h => h.key.toLowerCase() === name)
const headerValue = (headers, name) => headers.find(h => h.key.toLowerCase() === name)?.value ?? ''
const isMultipartType = (value) => /^\s*multipart\/form-data/i.test(value)

// Headers the target program has to send itself to match what curl sends
function programHeaders(r) {
    let headers = [...r.headers]
    if (r.body !== '' && r.implicitContentType && !hasHeader(headers, 'content-type')) {
        headers = [...headers, { key: 'Content-Type', value: r.implicitContentType }]
    }
    // A hand-written multipart Content-Type lacks the boundary the library adds
    let droppedMultipart = false
    if (r.form.length) {
        const before = headers.length
        headers = headers.filter(h => !(h.key.toLowerCase() === 'content-type' && isMultipartType(h.value)))
        droppedMultipart = headers.length !== before
    }
    return { headers, droppedMultipart }
}

// ------------------------------------------------------------------ curl ---

function curlFormArg(field) {
    if (field.file !== undefined) {
        let spec = `${field.key}=@${field.file}`
        if (field.contentType) spec += `;type=${field.contentType}`
        if (field.filename) spec += `;filename=${field.filename}`
        return `-F ${quotePosix(spec, { always: true })}`
    }
    const value = String(field.value ?? '')
    const type = field.contentType ? `;type=${field.contentType}` : ''
    // -F gives ; " @ and < a meaning; quote the value, or use --form-string
    const plain = !/[;"]/.test(value) && !/^[@<]/.test(value)
    if (plain) return `-F ${quotePosix(`${field.key}=${value}${type}`, { always: true })}`
    if (type) return `-F ${quotePosix(`${field.key}="${value.replace(/[\\"]/g, '\\$&')}"${type}`, { always: true })}`
    return `--form-string ${quotePosix(`${field.key}=${value}`, { always: true })}`
}

function toCurl(r) {
    const args = [quotePosix(r.url, { always: true })]
    const isHead = r.method === 'HEAD'
    const sendsBody = !isHead && (r.body !== '' || r.form.length > 0)
    if (isHead) args.push('--head')
    else if (r.method !== (sendsBody ? 'POST' : 'GET')) args.push(`-X ${quotePosix(r.method)}`)
    for (const h of r.headers) {
        // "Name;" is curl's syntax for a header with an empty value
        args.push(`-H ${quotePosix(h.value === '' ? `${h.key};` : `${h.key}: ${h.value}`, { always: true })}`)
    }
    for (const name of r.removeHeaders) args.push(`-H ${quotePosix(`${name}:`, { always: true })}`)
    if (r.auth) args.push(`-u ${quotePosix(`${r.auth.username}:${r.auth.password}`, { always: true })}`)
    if (!isHead) {
        if (r.form.length) r.form.forEach(f => args.push(curlFormArg(f)))
        else if (r.body !== '') args.push(`--data-raw ${quotePosix(r.body, { always: true })}`)
    }
    if (r.options.compressed) args.push('--compressed')
    if (r.options.insecure) args.push('--insecure')
    if (r.options.location) args.push('--location')
    if (r.options.maxTime) args.push(`--max-time ${quotePosix(String(r.options.maxTime))}`)
    return `curl ${args.join(' \\\n  ')}`
}

// ----------------------------------------------------------------- fetch ---

function toFetch(r) {
    const notes = []
    const pre = []
    const { headers, droppedMultipart } = programHeaders(r)
    const entries = headers.map(h => [jsString(h.key), jsString(h.value)])

    if (r.auth && !hasHeader(headers, 'authorization')) {
        const pair = `${r.auth.username}:${r.auth.password}`
        // btoa() only takes Latin-1, so non-ASCII credentials are pre-encoded
        const value = isPrintableAscii(pair) ? `'Basic ' + btoa(${jsString(pair)})` : jsString(`Basic ${base64Utf8(pair)}`)
        entries.push([jsString('Authorization'), value])
    }

    const noBodyMethod = r.method === 'GET' || r.method === 'HEAD'
    let bodyExpr = null
    if (r.form.length) {
        if (noBodyMethod) {
            notes.push(`fetch() can't send a body with ${r.method}, so the form fields were left out.`)
        } else {
            pre.push('const formData = new FormData();')
            for (const f of r.form) {
                if (f.file !== undefined) {
                    const name = f.filename || String(f.file).split(/[\\/]/).pop() || 'file'
                    const opts = f.contentType ? `, { type: ${jsString(f.contentType)} }` : ''
                    pre.push(`formData.append(${jsString(f.key)}, new File([/* contents of ${String(f.file).replace(/\*\//g, '* /')} */], ${jsString(name)}${opts}));`)
                } else if (f.contentType) {
                    pre.push(`formData.append(${jsString(f.key)}, new Blob([${jsString(f.value ?? '')}], { type: ${jsString(f.contentType)} }));`)
                } else {
                    pre.push(`formData.append(${jsString(f.key)}, ${jsString(f.value ?? '')});`)
                }
            }
            bodyExpr = 'formData'
            if (droppedMultipart) notes.push('The multipart Content-Type header was left out so that fetch() can add the boundary.')
        }
    } else if (r.body !== '') {
        if (noBodyMethod) notes.push(`fetch() can't send a body with ${r.method}, so the body was left out.`)
        else bodyExpr = r.body.includes('\n') ? jsTemplate(r.body) : jsString(r.body)
    }

    const forbidden = headers.filter(h => isForbiddenHeader(h.key)).map(h => h.key)
    if (forbidden.length) notes.push(`Browsers don't let pages set ${[...new Set(forbidden)].join(', ')}; fetch() drops ${forbidden.length > 1 ? 'them' : 'it'} there (Node.js sends ${forbidden.length > 1 ? 'them' : 'it'}).`)
    if (r.options.insecure) notes.push("fetch() can't skip TLS certificate checks (curl --insecure).")

    const opts = [`method: ${jsString(r.method)}`]
    if (entries.length) {
        const lower = headers.map(h => h.key.toLowerCase())
        const duplicates = new Set(lower).size !== lower.length
        opts.push(duplicates
            ? `headers: [\n${entries.map(([k, v]) => `    [${k}, ${v}]`).join(',\n')}\n  ]`
            : `headers: {\n${entries.map(([k, v]) => `    ${k}: ${v}`).join(',\n')}\n  }`)
    }
    if (bodyExpr) opts.push(`body: ${bodyExpr}`)
    if (r.options.credentials === 'include') opts.push("credentials: 'include'")
    if (r.options.maxTime) opts.push(`signal: AbortSignal.timeout(${Math.round(Number(r.options.maxTime) * 1000)})`)

    const wantsJson = /json/i.test(headerValue(headers, 'accept')) || /json/i.test(headerValue(headers, 'content-type'))
    const reader = r.method === 'HEAD' ? 'response.status' : wantsJson ? 'response.json()' : 'response.text()'
    const lines = [
        ...notes.map(n => `// Note: ${n}`),
        ...pre,
        ...(pre.length ? [''] : []),
        `fetch(${jsString(r.url)}, {`,
        `  ${opts.join(',\n  ')}`,
        '})',
        `  .then((response) => ${reader})`,
        '  .then((data) => console.log(data))',
        '  .catch((error) => console.error(error));',
    ]
    return lines.join('\n')
}

// ---------------------------------------------------------------- python ---

const PY_METHODS = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', HEAD: 'head', OPTIONS: 'options' }

function pyMultiline(name, value) {
    if (!value.includes('\n') || value.length > 20000) return `${name} = ${pyString(value)}`
    const pieces = value.split(/(?<=\n)/)
    return `${name} = (\n${pieces.map(p => `    ${pyString(p)}`).join('\n')}\n)`
}

function toPython(r) {
    const notes = []
    const { headers, droppedMultipart } = programHeaders(r)
    const lines = ['import requests', '']
    lines.push(`url = ${pyString(r.url)}`)

    // A dict can't repeat a key: repeated headers are combined
    const merged = []
    for (const h of headers) {
        const existing = merged.find(m => m.key.toLowerCase() === h.key.toLowerCase())
        if (existing) existing.value += (h.key.toLowerCase() === 'cookie' ? '; ' : ', ') + h.value
        else merged.push({ ...h })
    }
    if (merged.length !== headers.length) notes.push('Repeated headers were combined into one, since a dict holds each name once.')
    if (droppedMultipart) notes.push('The multipart Content-Type header was left out so that requests can add the boundary.')

    const args = ['url']
    if (merged.length) {
        lines.push('', 'headers = {', ...merged.map(h => `    ${pyString(h.key)}: ${pyString(h.value)},`), '}')
        args.push('headers=headers')
    }
    if (r.form.length) {
        const rows = r.form.map(f => {
            if (f.file !== undefined) {
                const name = f.filename || String(f.file).split(/[\\/]/).pop() || 'file'
                const parts = [pyString(name), `open(${pyString(f.file)}, 'rb')`]
                if (f.contentType) parts.push(pyString(f.contentType))
                return `    (${pyString(f.key)}, (${parts.join(', ')})),`
            }
            const parts = ['None', pyString(f.value ?? '')]
            if (f.contentType) parts.push(pyString(f.contentType))
            return `    (${pyString(f.key)}, (${parts.join(', ')})),`
        })
        lines.push('', 'files = [', ...rows, ']')
        args.push('files=files')
    } else if (r.body !== '' && r.method !== 'HEAD') {
        lines.push('', pyMultiline('data', r.body))
        // requests sends str bodies as Latin-1; encode to send UTF-8 like curl
        args.push(isAscii(r.body) ? 'data=data' : "data=data.encode('utf-8')")
    }
    if (r.auth && !hasHeader(merged, 'authorization')) args.push(`auth=(${pyString(r.auth.username)}, ${pyString(r.auth.password)})`)
    if (r.options.insecure) args.push('verify=False')
    if (r.options.maxTime) args.push(`timeout=${Number(r.options.maxTime)}`)

    const fn = PY_METHODS[r.method]
    const call = fn ? `requests.${fn}(${args.join(', ')})` : `requests.request(${[pyString(r.method), ...args].join(', ')})`
    lines.push('', `response = ${call}`, 'print(response.status_code)')
    if (r.method !== 'HEAD') lines.push('print(response.text)')
    return [...notes.map(n => `# Note: ${n}`), ...lines].join('\n')
}

/**
 * Generates code for `target` ('curl' | 'fetch' | 'python').
 */
export function generateCode(request, target = 'curl') {
    const r = normalizeRequest(request)
    if (target === 'fetch') return toFetch(r)
    if (target === 'python') return toPython(r)
    return toCurl(r)
}
