// Removes secrets from an API Tester request before it is written to history in
// localStorage: the bearer token and Basic password, sensitive headers, URL
// passwords, and query, form and JSON fields whose names look secret. Values
// that are only a {{variable}} reference are kept: they don't hold the secret.
//
//   const { request, redacted } = redactRequest(stored)

// Header, parameter and field names that usually carry credentials.
export const SENSITIVE_NAME = /pass(word|wd|phrase)?|pwd|secret|token|api[-_]?key|apikey|access[-_]?key|private[-_]?key|session|cookie|credential|signature|authorization|^auth$|^key$|^sig$|^code$|^jwt$/i

const VARIABLE_ONLY = /^\s*\{\{\s*[\w.-]+\s*\}\}\s*$/

function decodeName(raw) {
    try {
        return decodeURIComponent(raw.replace(/\+/g, ' '))
    } catch {
        return raw
    }
}

// name=value&name=value (a URL query or an x-www-form-urlencoded body)
function redactPairs(text, scrub) {
    return text.split('&').map(part => {
        const eq = part.indexOf('=')
        if (eq === -1 || !SENSITIVE_NAME.test(decodeName(part.slice(0, eq)))) return part
        return `${part.slice(0, eq)}=${scrub(part.slice(eq + 1))}`
    }).join('&')
}

export function redactUrl(url, scrub) {
    if (typeof url !== 'string') return url
    // scheme://user:password@host
    const withoutPassword = url.replace(/^([a-z][\w+.-]*:\/\/)([^/?#@]*)@/i, (match, scheme, userinfo) => {
        const colon = userinfo.indexOf(':')
        if (colon === -1) return match
        const password = scrub(userinfo.slice(colon + 1))
        return `${scheme}${userinfo.slice(0, colon)}${password ? `:${password}` : ''}@`
    })
    const hashAt = withoutPassword.indexOf('#')
    const base = hashAt === -1 ? withoutPassword : withoutPassword.slice(0, hashAt)
    const hash = hashAt === -1 ? '' : withoutPassword.slice(hashAt)
    const q = base.indexOf('?')
    if (q === -1) return withoutPassword
    return `${base.slice(0, q + 1)}${redactPairs(base.slice(q + 1), scrub)}${hash}`
}

// "name": "value" pairs in JSON text, keeping the rest of the text (and any
// {{variables}} that make it invalid JSON) exactly as written.
function redactJsonText(text, scrub) {
    return text.replace(/("((?:[^"\\]|\\.)*)"\s*:\s*)"((?:[^"\\]|\\.)*)"/g, (match, prefix, name, value) =>
        SENSITIVE_NAME.test(name) ? `${prefix}"${scrub(value)}"` : match
    )
}

export function redactRequest(stored) {
    let redacted = false
    const scrub = (value) => {
        if (typeof value !== 'string' || value === '' || VARIABLE_ONLY.test(value)) return value
        redacted = true
        return ''
    }
    const byName = (rows) => (Array.isArray(rows) ? rows.map(row => (SENSITIVE_NAME.test(row.key) ? { ...row, value: scrub(row.value) } : row)) : rows)

    const auth = { ...stored.auth }
    if (auth.token) auth.token = scrub(auth.token)
    if (auth.password) auth.password = scrub(auth.password)

    let body = stored.body
    if (typeof body === 'string' && body) {
        if (stored.bodyType === 'json') body = redactJsonText(body, scrub)
        else if (stored.bodyType === 'form') body = redactPairs(body, scrub)
    }

    const request = {
        ...stored,
        url: redactUrl(stored.url, scrub),
        headers: byName(stored.headers),
        form: byName(stored.form),
        auth,
        body,
    }
    return { request, redacted }
}
