// Parses a cURL command line into a request description. Shared by the cURL
// Converter (/curl) and the API Tester's "Import cURL".
//
//   const req = parseCurl(`curl 'https://api.example.com/items' -H 'Accept: application/json'`)
//   req → {
//     method: 'GET', url: 'https://api.example.com/items',
//     headers: [{ key: 'Accept', value: 'application/json' }],
//     body: '',                    // request body text ('' when none)
//     form: [],                    // -F multipart fields: { key, value } or { key, file, filename?, contentType? }
//     auth: null,                  // -u → { username, password }
//     implicitContentType: null,   // Content-Type curl adds itself (-d without -H 'Content-Type: …')
//     removeHeaders: [],           // -H 'Name:' removes one of curl's default headers
//     options: { compressed, insecure, location, maxTime },
//     warnings: [],                // everything that was ignored or can't be reproduced
//     dialect: 'posix' | 'cmd',
//   }
//
// Throws CurlParseError with a readable message when the input isn't a usable
// cURL command. Nothing is executed and no files are read.

import { ShellSyntaxError, splitShellWords } from './shell.js'

export class CurlParseError extends Error {
    constructor(message) {
        super(message)
        this.name = 'CurlParseError'
    }
}

const KNOWN_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT']

// Short options that take a value (curl 8). Everything else is a flag.
const SHORT_WITH_VALUE = new Set('AbcCdDeEFHKmoPQrtTuUwxXyYz'.split(''))
const SHORT_NAMES = {
    X: 'request', H: 'header', d: 'data', F: 'form', u: 'user', A: 'user-agent', b: 'cookie',
    e: 'referer', G: 'get', I: 'head', k: 'insecure', L: 'location', m: 'max-time', r: 'range',
    T: 'upload-file', x: 'proxy', E: 'cert', K: 'config', ':': 'next', U: 'proxy-user', c: 'cookie-jar',
    o: 'output', D: 'dump-header', w: 'write-out', C: 'continue-at', P: 'ftp-port', Q: 'quote',
    t: 'telnet-option', y: 'speed-time', Y: 'speed-limit', z: 'time-cond',
}

// Options that change the request and are understood here
const HANDLED_WITH_VALUE = new Set([
    'request', 'header', 'data', 'data-ascii', 'data-raw', 'data-binary', 'data-urlencode', 'json',
    'form', 'form-string', 'user', 'user-agent', 'cookie', 'referer', 'url', 'oauth2-bearer',
    'max-time', 'range',
])
const HANDLED_FLAGS = new Set(['get', 'head', 'compressed', 'insecure', 'location', 'location-trusted'])

// Options with a value that don't affect what is sent (output, retries, timing, TLS tuning…)
const IGNORED_WITH_VALUE = new Set([
    'output', 'dump-header', 'cookie-jar', 'write-out', 'connect-timeout', 'retry', 'retry-delay',
    'retry-max-time', 'max-redirs', 'limit-rate', 'speed-limit', 'speed-time', 'local-port',
    'keepalive-time', 'expect100-timeout', 'interface', 'dns-servers', 'dns-interface', 'dns-ipv4-addr',
    'dns-ipv6-addr', 'happy-eyeballs-timeout-ms', 'trace', 'trace-ascii', 'trace-config', 'stderr',
    'max-filesize', 'proto', 'proto-redir', 'proto-default', 'continue-at', 'time-cond', 'ciphers',
    'tls13-ciphers', 'curves', 'tls-max', 'cert-type', 'key-type', 'pass', 'engine', 'random-file',
    'egd-file', 'capath', 'crlfile', 'pinnedpubkey', 'hostpubmd5', 'hostpubsha256', 'noproxy',
    'preproxy', 'ftp-port', 'quote', 'telnet-option', 'mail-from', 'mail-rcpt', 'mail-auth',
    'login-options', 'sasl-authzid', 'service-name', 'delegation', 'krb', 'alt-svc', 'hsts',
    'etag-save', 'etag-compare', 'output-dir', 'parallel-max', 'rate', 'proxy-header', 'socks4',
    'socks4a', 'socks5', 'socks5-hostname', 'proxy-cacert', 'proxy-capath', 'proxy-cert',
    'proxy-cert-type', 'proxy-key', 'proxy-key-type', 'proxy-pass', 'proxy-ciphers', 'proxy-tlsuser',
    'proxy-tlspassword', 'proxy-tlsauthtype', 'proxy-service-name', 'tlsuser', 'tlspassword',
    'tlsauthtype', 'ftp-account', 'ftp-alternative-to-user', 'ftp-method', 'ftp-ssl-ccc-mode', 'krb4',
    'socks5-gssapi-service', 'ip-tos', 'vlan-priority', 'max-redirs', 'ech', 'ipfs-gateway',
])
const IGNORED_FLAGS = new Set([
    'silent', 'show-error', 'verbose', 'include', 'fail', 'fail-with-body', 'fail-early',
    'progress-bar', 'no-progress-meter', 'globoff', 'path-as-is', 'http1.0', 'http1.1', 'http2',
    'http2-prior-knowledge', 'http3', 'http3-only', 'http0.9', 'no-buffer', 'no-keepalive',
    'tcp-nodelay', 'tcp-fastopen', 'ipv4', 'ipv6', 'remote-name', 'remote-header-name',
    'remote-name-all', 'remote-time', 'create-dirs', 'basic', 'raw', 'tr-encoding', 'styled-output',
    'ssl', 'ssl-reqd', 'ssl-allow-beast', 'ssl-no-revoke', 'ssl-revoke-best-effort', 'tlsv1',
    'tlsv1.0', 'tlsv1.1', 'tlsv1.2', 'tlsv1.3', 'sslv2', 'sslv3', 'netrc', 'netrc-optional',
    'disable', 'no-sessionid', 'no-alpn', 'no-npn', 'compressed-ssh', 'post301', 'post302', 'post303',
    'junk-session-cookies', 'ignore-content-length', 'parallel', 'parallel-immediate', 'list-only',
    'crlf', 'append', 'disallow-username-in-url', 'false-start', 'suppress-connect-headers',
    'trace-time', 'ca-native', 'proxy-ca-native', 'doh-insecure', 'proxy-insecure', 'retry-connrefused',
    'retry-all-errors', 'xattr', 'mail-rcpt-allowfails', 'sasl-ir', 'no-clobber', 'remove-on-error',
    'skip-existing', 'proxytunnel', 'socks5-gssapi-nec', 'manual', 'help', 'version', 'use-ascii',
    'cert-status', 'proxy-ssl-allow-beast', 'haproxy-protocol', 'proxy-http2', 'mptcp', 'insecure-tls',
    'clobber', 'buffer', 'keepalive', 'progress-meter', 'sessionid', 'alpn', 'npn',
])
const IGNORED_SHORT_FLAGS = new Set('0123456#aBfgijJlMnNOpqRsSvVZh'.split(''))

// Options that would change the request but can't be reproduced here
const UNSUPPORTED = {
    'upload-file': 'uploads a file (-T), which can\'t be read here',
    cert: 'uses a client certificate',
    key: 'uses a client certificate key',
    cacert: 'uses a custom CA certificate',
    proxy: 'goes through a proxy',
    'proxy-user': 'authenticates to a proxy',
    digest: 'uses Digest authentication (only Basic is supported)',
    ntlm: 'uses NTLM authentication (only Basic is supported)',
    negotiate: 'uses Negotiate authentication (only Basic is supported)',
    anyauth: 'lets curl pick an authentication method (only Basic is supported)',
    'aws-sigv4': 'signs the request with AWS SigV4',
    config: 'reads more options from a config file (-K)',
    'unix-socket': 'connects through a Unix socket',
    'abstract-unix-socket': 'connects through a Unix socket',
    resolve: 'overrides DNS resolution (--resolve)',
    'connect-to': 'overrides the connection target (--connect-to)',
    'url-query': 'adds query parameters with --url-query',
    variable: 'uses --variable',
}
const UNSUPPORTED_WITH_VALUE = new Set(['upload-file', 'cert', 'key', 'cacert', 'proxy', 'proxy-user', 'aws-sigv4', 'config', 'unix-socket', 'abstract-unix-socket', 'resolve', 'connect-to', 'url-query', 'variable'])

const takesValue = (name) =>
    HANDLED_WITH_VALUE.has(name) || IGNORED_WITH_VALUE.has(name) || UNSUPPORTED_WITH_VALUE.has(name) || name.startsWith('expand-')

// curl --data-urlencode uses RFC 3986 unreserved characters only
export function curlUrlEncode(text) {
    return encodeURIComponent(text).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

function headerIndex(headers, name) {
    const lower = name.toLowerCase()
    return headers.findIndex(h => h.key.toLowerCase() === lower)
}

// Splits a -F value into its content and ;type=…/;filename=… parameters.
// A value in double quotes may contain ; (with \" and \\ escapes), as in curl.
function splitFormSpec(content) {
    let value = ''
    let i = 0
    if (content.startsWith('"')) {
        i = 1
        while (i < content.length && content[i] !== '"') {
            if (content[i] === '\\' && (content[i + 1] === '"' || content[i + 1] === '\\')) {
                value += content[i + 1]
                i += 2
                continue
            }
            value += content[i]
            i += 1
        }
        i += 1
    } else {
        const semi = content.indexOf(';')
        i = semi === -1 ? content.length : semi
        value = content.slice(0, i)
    }
    const params = {}
    for (const part of content.slice(i).split(';').slice(1)) {
        const eq = part.indexOf('=')
        const name = (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase()
        if (name) params[name] = eq === -1 ? '' : part.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1')
    }
    return { value, params }
}

const preview = (text, max = 40) => (text.length > max ? text.slice(0, max - 1) + '…' : text)

/**
 * Parses a cURL command. See the top of this file for the result shape.
 */
export function parseCurl(input) {
    const text = String(input ?? '').trim()
    if (!text) throw new CurlParseError('Paste a cURL command to convert.')

    let split
    try {
        split = splitShellWords(text)
    } catch (error) {
        if (error instanceof ShellSyntaxError) throw new CurlParseError(`${error.message}. Check that every quote is closed.`)
        throw error
    }

    const warnings = []
    const words = [...split.words]
    // A copied prompt ("$ curl …" or "> curl …")
    if (words[0] === '$' || words[0] === '>' || words[0] === '%') words.shift()
    if (!words.length) throw new CurlParseError('Paste a cURL command to convert.')
    if (!/^(.*[\\/])?curl(\.exe)?$/i.test(words[0])) {
        throw new CurlParseError(`This doesn't look like a cURL command: it should start with “curl”, not “${preview(words[0], 24)}”.`)
    }

    let method = null
    const headers = []
    const removeHeaders = []
    const dataParts = []
    const form = []
    const urls = []
    let auth = null
    let forceGet = false
    let head = false
    let sawJson = false
    const options = { compressed: false, insecure: false, location: false, maxTime: null }
    const unknown = []
    const unsupported = []
    let stoppedAt = null

    const addHeader = (key, value) => headers.push({ key, value })

    const handle = (name, value) => {
        switch (name) {
            case 'request': {
                const upper = value.toUpperCase()
                method = KNOWN_METHODS.includes(upper) ? upper : value
                break
            }
            case 'header': {
                if (value.startsWith('@')) {
                    warnings.push(`Headers read from a file (-H ${preview(value)}) were skipped: files can't be read here.`)
                    break
                }
                const colon = value.indexOf(':')
                const semi = value.indexOf(';')
                if (colon > 0) {
                    const key = value.slice(0, colon).trim()
                    const val = value.slice(colon + 1).trim()
                    if (val === '') removeHeaders.push(key)
                    else addHeader(key, val)
                } else if (semi > 0 && value.slice(semi + 1).trim() === '') {
                    // "Name;" sends the header with an empty value
                    addHeader(value.slice(0, semi).trim(), '')
                } else {
                    warnings.push(`Skipped the header “${preview(value)}”: it needs a colon, as in “Name: value”.`)
                }
                break
            }
            case 'data':
            case 'data-ascii':
            case 'data-binary':
                if (value.startsWith('@')) {
                    warnings.push(`The body read from a file (${preview(value)}) was skipped: files can't be read here.`)
                    break
                }
                dataParts.push({ text: value })
                break
            case 'data-raw':
                dataParts.push({ text: value })
                break
            case 'json':
                sawJson = true
                if (value.startsWith('@')) {
                    warnings.push(`The JSON body read from a file (${preview(value)}) was skipped: files can't be read here.`)
                } else {
                    dataParts.push({ text: value, json: true })
                }
                break
            case 'data-urlencode': {
                const eq = value.indexOf('=')
                if (eq === -1 && value.includes('@')) {
                    warnings.push(`--data-urlencode ${preview(value)} reads a file, which can't be done here; it was skipped.`)
                } else if (eq === -1) {
                    dataParts.push({ text: curlUrlEncode(value) })
                } else {
                    const name = value.slice(0, eq)
                    const content = value.slice(eq + 1)
                    dataParts.push({ text: name ? `${name}=${curlUrlEncode(content)}` : curlUrlEncode(content) })
                }
                break
            }
            case 'form':
            case 'form-string': {
                const eq = value.indexOf('=')
                if (eq <= 0) {
                    warnings.push(`Skipped the form field “${preview(value)}”: it should look like name=value.`)
                    break
                }
                const key = value.slice(0, eq)
                const content = value.slice(eq + 1)
                if (name === 'form-string') {
                    form.push({ key, value: content })
                    break
                }
                if (content.startsWith('<')) {
                    warnings.push(`The form field “${key}” reads its value from a file (${preview(content)}), which can't be done here; it was skipped.`)
                    break
                }
                const isFile = content.startsWith('@')
                const spec = splitFormSpec(isFile ? content.slice(1) : content)
                const field = isFile ? { key, file: spec.value } : { key, value: spec.value }
                for (const [param, paramValue] of Object.entries(spec.params)) {
                    if (param === 'type') field.contentType = paramValue
                    else if (param === 'filename') field.filename = paramValue
                    else warnings.push(`Ignored “;${param}” in the form field “${key}”.`)
                }
                form.push(field)
                break
            }
            case 'user': {
                const colon = value.indexOf(':')
                if (colon === -1) {
                    auth = { username: value, password: '' }
                    warnings.push('-u has no password, so curl would ask for one; an empty password is used here.')
                } else {
                    auth = { username: value.slice(0, colon), password: value.slice(colon + 1) }
                }
                break
            }
            case 'user-agent':
                addHeader('User-Agent', value)
                break
            case 'referer':
                addHeader('Referer', value.replace(/;auto$/, ''))
                break
            case 'cookie': {
                if (!value.includes('=')) {
                    warnings.push(`-b ${preview(value)} reads cookies from a file, which can't be done here; it was skipped.`)
                    break
                }
                const existing = headerIndex(headers, 'cookie')
                if (existing === -1) addHeader('Cookie', value)
                else headers[existing] = { ...headers[existing], value: `${headers[existing].value}; ${value}` }
                break
            }
            case 'oauth2-bearer':
                addHeader('Authorization', `Bearer ${value}`)
                break
            case 'range':
                addHeader('Range', `bytes=${value}`)
                break
            case 'url':
                urls.push(value)
                break
            case 'max-time': {
                const seconds = Number(value)
                if (Number.isFinite(seconds) && seconds > 0) options.maxTime = seconds
                break
            }
            case 'get':
                forceGet = true
                break
            case 'head':
                head = true
                break
            case 'compressed':
                options.compressed = true
                break
            case 'insecure':
                options.insecure = true
                break
            case 'location':
            case 'location-trusted':
                options.location = true
                break
            default:
                break
        }
    }

    const consider = (name, value) => {
        if (HANDLED_WITH_VALUE.has(name) || HANDLED_FLAGS.has(name)) handle(name, value)
        else if (name in UNSUPPORTED) unsupported.push(name)
        else if (name === 'next') stoppedAt = stoppedAt ?? '--next'
    }

    for (let i = 1; i < words.length; i++) {
        if (stoppedAt) break
        const word = words[i]

        if (word === '--') {
            urls.push(...words.slice(i + 1))
            break
        }

        if (word.startsWith('--') && word.length > 2) {
            let name = word.slice(2)
            let value
            const eq = name.indexOf('=')
            if (eq !== -1 && takesValue(name.slice(0, eq))) {
                value = name.slice(eq + 1)
                name = name.slice(0, eq)
            }
            if (name.startsWith('no-') && (HANDLED_FLAGS.has(name.slice(3)) || IGNORED_FLAGS.has(name.slice(3)))) continue
            if (takesValue(name)) {
                if (value === undefined) {
                    if (i + 1 >= words.length) {
                        warnings.push(`--${name} is missing its value.`)
                        break
                    }
                    value = words[++i]
                }
                consider(name, value)
            } else if (HANDLED_FLAGS.has(name) || name in UNSUPPORTED || name === 'next') {
                consider(name)
            } else if (!IGNORED_FLAGS.has(name)) {
                unknown.push(`--${name}`)
            }
            continue
        }

        if (word.startsWith('-') && word.length > 1) {
            // Bundled short options: -sSL, -XPOST, -H'Accept: x'
            for (let j = 1; j < word.length; j++) {
                const letter = word[j]
                if (SHORT_WITH_VALUE.has(letter)) {
                    let value = word.slice(j + 1)
                    if (!value) {
                        if (i + 1 >= words.length) {
                            warnings.push(`-${letter} is missing its value.`)
                            break
                        }
                        value = words[++i]
                    }
                    consider(SHORT_NAMES[letter] ?? letter, value)
                    break
                }
                const name = SHORT_NAMES[letter]
                if (name) consider(name)
                else if (!IGNORED_SHORT_FLAGS.has(letter)) unknown.push(`-${letter}`)
            }
            continue
        }

        // A second "curl" means a second command was pasted
        if (/^(.*[\\/])?curl(\.exe)?$/i.test(word) && urls.length) {
            stoppedAt = 'curl'
            break
        }
        urls.push(word)
    }

    if (!urls.length) throw new CurlParseError('No URL found in the cURL command.')
    let url = urls[0]
    if (urls.length > 1) warnings.push(`Only the first URL is used; ${urls.length - 1} more ${urls.length > 2 ? 'were' : 'was'} ignored.`)
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
        warnings.push(`The URL has no scheme, so curl would use http://${preview(url, 30)}.`)
        url = `http://${url}`
    }

    // --json adds these unless the command sets them itself
    if (sawJson) {
        if (headerIndex(headers, 'content-type') === -1) addHeader('Content-Type', 'application/json')
        if (headerIndex(headers, 'accept') === -1) addHeader('Accept', 'application/json')
    }

    // Body: -d pieces are joined with &, --json pieces are concatenated
    let hasData = dataParts.length > 0
    let body = ''
    if (hasData) body = dataParts.every(p => p.json) ? dataParts.map(p => p.text).join('') : dataParts.map(p => p.text).join('&')

    if (form.length && hasData) {
        warnings.push('curl refuses to combine -F (multipart) with -d (body data); the -d data was ignored.')
        body = ''
        hasData = false
    }

    let implicitContentType = null
    if (forceGet && hasData) {
        if (body) url += (url.includes('?') ? '&' : '?') + body
        body = ''
        hasData = false
    } else if (hasData && headerIndex(headers, 'content-type') === -1 && !removeHeaders.some(h => h.toLowerCase() === 'content-type')) {
        implicitContentType = 'application/x-www-form-urlencoded'
    }
    if (head && (hasData || form.length)) {
        warnings.push('curl refuses to combine -I (HEAD) with a body; the body was ignored.')
        body = ''
        hasData = false
        form.length = 0
        implicitContentType = null
    }

    if (!method) method = head ? 'HEAD' : hasData || form.length ? 'POST' : 'GET'

    if (stoppedAt === 'curl') warnings.push('Only the first of several curl commands was converted.')
    else if (stoppedAt === '--next') warnings.push('Only the request before --next was converted.')
    if (split.operator) warnings.push(`Everything after “${split.operator}” was ignored: it isn't part of the curl command.`)
    if (split.notes.includes('unquoted-ampersand')) warnings.push('An unquoted & would split this command in a shell; it was kept as part of the text. Quote URLs that contain &.')
    if (split.notes.includes('stray-backslash-space')) warnings.push('A backslash followed by spaces at the end of a line was treated as a line continuation.')
    const expansions = [...new Set(split.expansions)]
    if (expansions.length) {
        warnings.push(`Shell expressions were kept as literal text, since nothing is run here: ${expansions.slice(0, 4).map(e => preview(e, 24)).join(', ')}${expansions.length > 4 ? '…' : ''}.`)
    }
    if (unknown.length) warnings.push(`Ignored unknown option${unknown.length > 1 ? 's' : ''}: ${[...new Set(unknown)].join(', ')}.`)
    for (const name of new Set(unsupported)) warnings.push(`The command ${UNSUPPORTED[name]}, which isn't supported; --${name} was ignored.`)

    return {
        method,
        url,
        headers,
        body,
        form,
        auth,
        implicitContentType,
        removeHeaders,
        options,
        warnings,
        dialect: split.dialect,
    }
}
