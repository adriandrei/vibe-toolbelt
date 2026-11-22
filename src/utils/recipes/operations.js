// The Recipes operation registry. Each operation declares:
//   id, name, group, description, keywords (for search),
//   input:  'text' | 'bytes' | 'any'   (what run() receives; the runner converts)
//   output: 'text' | 'bytes'           (what run() returns)
//   options: [{ id, label, type: 'select' | 'boolean' | 'text' | 'number', default, … }]
//   run(value, options, ctx) → value or Promise<value>
//     ctx.info(message) / ctx.warn(message) attach notes to the step.
//   ext (optional): file extension for downloads of the output.
//
// Errors are thrown as RecipeError with a message that reads well after
// "Step 3 · Gunzip: ". Big libraries (YAML, TOML, JWT, hashing, the HTML
// entity table) are imported on first use.
import { Base64Error, base64ToBytes, bytesToBase64, normalizeBase64 } from '../base64.js'
import { CASES } from '../caseConvert.js'
import { encodeBytes } from '../encoding.js'
import { countGraphemes, countLines, getWords, utf8ByteLength } from '../textMetrics.js'
import { LOCAL_TIME_ZONE, UNIT_INFO, formatInUnit, parseTimestamp, toIsoString } from '../timestamp.js'
import {
    RecipeError, base32Decode, base32Encode, binaryDecode, binaryEncode, fromCharCodes, hexDecode, hexEncode,
    htmlDecode, htmlEncode, rotate, toCharCodes, urlDecode, urlEncode,
} from './codecs.js'
import { JsonError, describeJsonError, hasMovableKeys, parseJsonTree, printJsonTree, treeToValue } from './json.js'
import { BYTES, TEXT, decodeUtf8 } from './values.js'

export { RecipeError }

export const GROUPS = [
    { id: 'encoding', label: 'Encoding' },
    { id: 'compression', label: 'Compression' },
    { id: 'data', label: 'Data formats' },
    { id: 'hashing', label: 'Hashing' },
    { id: 'datetime', label: 'Date & time' },
    { id: 'text', label: 'Text' },
]

// ---------------------------------------------------------------- option builders

const select = (id, label, choices, def, extra = {}) => ({
    id, label, type: 'select', default: def, choices: choices.map(([value, text]) => ({ value, label: text })), ...extra,
})
const toggle = (id, label, def, extra = {}) => ({ id, label, type: 'boolean', default: def, ...extra })
const textField = (id, label, def = '', extra = {}) => ({ id, label, type: 'text', default: def, maxLength: 2000, ...extra })
const numberField = (id, label, def, { min, max, step = 1, ...extra }) => ({ id, label, type: 'number', default: def, min, max, step, ...extra })

const INDENT_CHOICES = [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'Tab']]
const indentString = (value) => (value === 'tab' ? '\t' : value === '4' ? '    ' : value === 'none' ? '' : '  ')

// ---------------------------------------------------------------- helpers

// "The length is wrong" → "the length is wrong", but keep "Base64…", "JSON…"
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

function describeType(value) {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'an array'
    if (typeof value === 'bigint') return 'a number'
    return typeof value === 'object' ? 'an object' : `a ${typeof value}`
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

// Lines with their line-ending style, so line operations keep CRLF files CRLF
// and a final line break stays a final line break
function splitLines(text) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const lines = text.split(/\r\n|\r|\n/)
    const trailing = lines.length > 1 && lines[lines.length - 1] === ''
    if (trailing) lines.pop()
    return { lines, eol, trailing }
}

const joinLines = ({ eol, trailing }, lines) => lines.join(eol) + (trailing && lines.length ? eol : '')

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

let graphemes = null
function splitGraphemes(text) {
    if (graphemes === null) {
        try {
            graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        } catch {
            graphemes = false
        }
    }
    return graphemes ? Array.from(graphemes.segment(text), (s) => s.segment) : Array.from(text)
}

// ----- regular expressions

const FLAG_HELP = 'use g, i, m, s, u, v, y or d'

function checkFlags(flags) {
    const value = String(flags ?? '').trim()
    for (const ch of value) {
        if (!'dgimsuvy'.includes(ch)) throw new RecipeError(`“${ch}” isn’t a regular expression flag (${FLAG_HELP})`)
    }
    const repeated = [...value].find((ch, i) => value.indexOf(ch) !== i)
    if (repeated) throw new RecipeError(`the flag “${repeated}” is listed twice`)
    if (value.includes('u') && value.includes('v')) throw new RecipeError('the flags u and v can’t be combined; use one of them')
    return value
}

function compileRegex(pattern, flags) {
    try {
        return new RegExp(pattern, flags)
    } catch (error) {
        const reason = String(error?.message || error).replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, '')
        throw new RecipeError(`the pattern isn’t a valid regular expression: ${reason}`)
    }
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// \n, \r and \t in the find and replace fields stand for a line break,
// carriage return and tab; \\ is a backslash
const ESCAPES = { n: '\n', r: '\r', t: '\t', '\\': '\\' }
const unescapeField = (text) => String(text).replace(/\\([nrt\\])/g, (_, c) => ESCAPES[c])

// ----- compression

async function pipeBytes(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream)
    return new Uint8Array(await new Response(out).arrayBuffer())
}

function makeStream(Kind, format) {
    if (typeof Kind !== 'function') {
        throw new RecipeError('this browser can’t (de)compress data: it has no Compression Streams API')
    }
    try {
        return new Kind(format)
    } catch {
        throw new RecipeError(`this browser doesn’t support the “${format}” format`)
    }
}

const isGzip = (bytes) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
// zlib header: compression method 8 (deflate), window ≤ 32 KB, check bits
const isZlib = (bytes) => bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && bytes[0] >> 4 <= 7 && ((bytes[0] << 8) | bytes[1]) % 31 === 0

// Compressed data pasted as Base64 or hex text: decodes the start of the text
// and reports the encoding only when the decoded bytes really are gzip/zlib.
function encodedCompression(bytes) {
    const head = String.fromCharCode(...bytes.subarray(0, 64)).replace(/[\r\n\t]/g, '')
    const hexHead = head.replace(/^0x/i, '').replace(/[ :]/g, '')
    if (/^[0-9a-fA-F]{8,}/.test(hexHead)) {
        const decoded = Uint8Array.from(hexHead.slice(0, 8).match(/../g), (pair) => parseInt(pair, 16))
        if (isGzip(decoded) || isZlib(decoded)) return 'hex'
    }
    const base64 = head.match(/^[A-Za-z0-9+/_-]{8,}/)
    if (base64) {
        try {
            const decoded = base64ToBytes(normalizeBase64(base64[0].slice(0, 8)).base64)
            if (isGzip(decoded) || isZlib(decoded)) return 'base64'
        } catch {
            // not Base64 after all
        }
    }
    return null
}

const startHex = (bytes) => Array.from(bytes.subarray(0, 2), (b) => b.toString(16).padStart(2, '0')).join(' ')

function inputHint(bytes, expected) {
    if (expected !== 'gzip' && isGzip(bytes)) return ' This is gzip data: use Gunzip instead.'
    if (expected === 'gzip' && isZlib(bytes)) return ' It looks like zlib data: use Inflate instead.'
    if (expected === 'raw' && isZlib(bytes)) return ' It starts with a zlib header: use the zlib format (or Detect).'
    const encoded = encodedCompression(bytes)
    if (encoded === 'hex') return ' It’s compressed data written as hex: add Hex decode before this step.'
    if (encoded === 'base64') return ' It’s compressed data written as Base64: add Base64 decode before this step.'
    return ''
}

const detail = (error) => (error?.message ? ` (${error.message.replace(/\.$/, '')})` : '')

async function decompress(bytes, format) {
    return pipeBytes(bytes, makeStream(globalThis.DecompressionStream, format))
}

// ----- JSON and friends

function readJsonTree(text, ctx) {
    if (!text.trim()) throw new RecipeError('the input is empty: there’s no JSON to read')
    let parsed
    try {
        parsed = parseJsonTree(text)
    } catch (error) {
        if (error instanceof JsonError) throw new RecipeError(`the input isn’t valid JSON: ${describeJsonError(text, error)}`)
        if (error instanceof RangeError) throw new RecipeError('the JSON is nested too deeply to read')
        throw error
    }
    if (parsed.duplicates.length) {
        ctx.warn(`Duplicate keys (kept as written): ${parsed.duplicates.map((k) => JSON.stringify(k)).join(', ')}`)
    }
    return parsed.tree
}

// JSON text of a value from YAML or TOML: BigInts keep their digits, and
// values JSON can't hold are reported rather than silently changed
function toJsonText(value, indent, ctx) {
    let nonFinite = 0
    let bigQuoted = 0
    const canRaw = typeof JSON.rawJSON === 'function'
    const text = JSON.stringify(value, (key, v) => {
        if (typeof v === 'bigint') {
            if (canRaw) return JSON.rawJSON(v.toString())
            bigQuoted++
            return v.toString()
        }
        if (typeof v === 'number' && !Number.isFinite(v)) {
            nonFinite++
            return null
        }
        return v
    }, indent || undefined)
    if (nonFinite) ctx.warn(`${plural(nonFinite, 'value')} (.inf or .nan) became null: JSON has no infinity or NaN`)
    if (bigQuoted) ctx.warn(`${plural(bigQuoted, 'large integer')} written as strings: this browser can’t write numbers above 2⁵³ exactly`)
    return text ?? 'null'
}

let yamlModule = null
async function loadYaml() {
    if (yamlModule) return yamlModule
    const yaml = await import('js-yaml')
    // YAML 1.2 core schema with merge keys (<<: *defaults); integers above
    // 2^53 keep their digits as BigInt
    const INT = yaml.intCoreTag
    const bigInt = yaml.defineScalarTag(INT.tagName, {
        implicit: INT.implicit,
        implicitFirstChars: INT.implicitFirstChars,
        matchByTagPrefix: INT.matchByTagPrefix,
        resolve: (source, isExplicit) => {
            const value = INT.resolve(source, isExplicit)
            if (value === yaml.NOT_RESOLVED || typeof value !== 'number' || Number.isSafeInteger(value)) return value
            const digits = source.replace(/_/g, '')
            if (/^[-+]?\d+$/.test(digits)) return BigInt(digits.replace(/^\+/, ''))
            if (/^0x[0-9a-fA-F]+$/.test(digits) || /^0o[0-7]+$/.test(digits)) return BigInt(digits)
            return value
        },
        identify: INT.identify,
        represent: INT.represent,
    })
    // BigInts are written as plain integers by the dump schema's own int tag
    const DUMP_INT = yaml.DUMP_SCHEMA.tags.find((tag) => tag.tagName === INT.tagName)
    const dumpInt = yaml.defineScalarTag(DUMP_INT.tagName, {
        implicit: DUMP_INT.implicit,
        implicitFirstChars: DUMP_INT.implicitFirstChars,
        matchByTagPrefix: DUMP_INT.matchByTagPrefix,
        resolve: DUMP_INT.resolve,
        identify: (v) => typeof v === 'bigint' || DUMP_INT.identify(v),
        represent: (v) => (typeof v === 'bigint' ? v.toString() : DUMP_INT.represent(v)),
    })
    yamlModule = {
        yaml,
        loadSchema: yaml.CORE_SCHEMA.withTags(yaml.mergeTag, bigInt),
        dumpSchema: yaml.DUMP_SCHEMA.withTags(dumpInt),
    }
    return yamlModule
}

// ----- hashing

function hashOperation(id, algorithm, description) {
    return {
        id,
        name: algorithm,
        group: 'hashing',
        description,
        keywords: `hash digest checksum ${algorithm.replace('-', '')} ${algorithm.toLowerCase()}`,
        input: BYTES,
        output: TEXT,
        options: [select('format', 'Output', [['hex', 'hex'], ['HEX', 'HEX'], ['base64', 'Base64']], 'hex')],
        async run(bytes, o) {
            const { digest } = await import('../digest.js')
            return encodeBytes(await digest(algorithm, bytes), o.format)
        },
    }
}

// ----- timestamps

const TIME_UNIT_CHOICES = [['s', 'Seconds'], ['ms', 'Milliseconds'], ['us', 'Microseconds'], ['ns', 'Nanoseconds']]

// ---------------------------------------------------------------- operations

export const OPERATIONS = [
    // ----- Encoding
    {
        id: 'base64-encode',
        name: 'Base64 encode',
        group: 'encoding',
        description: 'Encodes bytes as Base64. Text is encoded as UTF-8 first.',
        keywords: 'to base64 b64 btoa encode',
        input: BYTES,
        output: TEXT,
        options: [
            select('alphabet', 'Alphabet', [['standard', 'Standard (+ /)'], ['url', 'URL-safe (- _)']], 'standard'),
            toggle('padding', 'Padding (=)', true),
        ],
        run: (bytes, o) => bytesToBase64(bytes, { urlSafe: o.alphabet === 'url', pad: o.padding }),
    },
    {
        id: 'base64-decode',
        name: 'Base64 decode',
        group: 'encoding',
        description: 'Decodes standard or URL-safe Base64, with or without padding. Line breaks and a data: prefix are ignored.',
        keywords: 'from base64 b64 atob decode data uri',
        input: TEXT,
        output: BYTES,
        options: [],
        run(text) {
            if (!text.trim()) return new Uint8Array(0)
            try {
                return base64ToBytes(normalizeBase64(text).base64)
            } catch (error) {
                if (error instanceof Base64Error) throw new RecipeError(lowerFirst(error.message.replace(/\.$/, '')))
                throw error
            }
        },
    },
    {
        id: 'base32-encode',
        name: 'Base32 encode',
        group: 'encoding',
        description: 'Encodes bytes as Base32 (RFC 4648), as used by TOTP secrets. Text is encoded as UTF-8 first.',
        keywords: 'to base32 b32 rfc4648 totp',
        input: BYTES,
        output: TEXT,
        options: [
            select('alphabet', 'Alphabet', [['standard', 'Standard (A–Z 2–7)'], ['hex', 'Base32hex (0–9 A–V)']], 'standard'),
            toggle('padding', 'Padding (=)', true),
        ],
        run: (bytes, o) => base32Encode(bytes, o),
    },
    {
        id: 'base32-decode',
        name: 'Base32 decode',
        group: 'encoding',
        description: 'Decodes Base32 (RFC 4648). Lower case, spaces and missing padding are accepted.',
        keywords: 'from base32 b32 rfc4648 totp',
        input: TEXT,
        output: BYTES,
        options: [select('alphabet', 'Alphabet', [['standard', 'Standard (A–Z 2–7)'], ['hex', 'Base32hex (0–9 A–V)']], 'standard')],
        run: (text, o) => base32Decode(text, o),
    },
    {
        id: 'hex-encode',
        name: 'Hex encode',
        group: 'encoding',
        description: 'Writes each byte as two hex digits. Text is encoded as UTF-8 first.',
        keywords: 'to hex base16 hexadecimal bytes',
        input: BYTES,
        output: TEXT,
        options: [
            select('format', 'Format', [['plain', 'None (4865)'], ['space', 'Spaces (48 65)'], ['colon', 'Colons (48:65)'], ['escaped', 'Escaped (\\x48\\x65)'], ['c', 'C array (0x48, 0x65)']], 'plain'),
            toggle('upper', 'Upper case', false),
        ],
        run: (bytes, o) => hexEncode(bytes, o),
    },
    {
        id: 'hex-decode',
        name: 'Hex decode',
        group: 'encoding',
        description: 'Reads hex such as 48656c, 48 65 6c, 48:65:6c, \\x48\\x65 or 0x48, 0x65.',
        keywords: 'from hex base16 hexadecimal bytes unhex',
        input: TEXT,
        output: BYTES,
        options: [],
        run: (text) => hexDecode(text),
    },
    {
        id: 'url-encode',
        name: 'URL encode',
        group: 'encoding',
        description: 'Percent-encodes text for URLs.',
        keywords: 'percent encode uri encodeuricomponent query escape',
        input: TEXT,
        output: TEXT,
        options: [select('mode', 'Mode', [['component', 'Component (query value)'], ['full', 'Full URL'], ['form', 'Form (+ for spaces)']], 'component')],
        run: (text, o) => urlEncode(text, o),
    },
    {
        id: 'url-decode',
        name: 'URL decode',
        group: 'encoding',
        description: 'Decodes percent-encoded text (%20, %C3%A9).',
        keywords: 'percent decode uri decodeuricomponent query unescape',
        input: TEXT,
        output: TEXT,
        options: [select('mode', 'Mode', [['component', 'Component (all escapes)'], ['full', 'Full URL (keeps %2F, %3F…)'], ['form', 'Form (+ is a space)']], 'component')],
        run: (text, o) => urlDecode(text, o),
    },
    {
        id: 'html-encode',
        name: 'HTML entity encode',
        group: 'encoding',
        description: 'Escapes & < > " \' as HTML entities, and optionally every non-ASCII character.',
        keywords: 'html entities escape amp lt gt xml',
        input: TEXT,
        output: TEXT,
        options: [
            select('scope', 'Encode', [['special', 'HTML characters only'], ['all', 'Also non-ASCII']], 'special'),
            select('format', 'Entities', [['named', 'Named (&copy;)'], ['decimal', 'Decimal (&#169;)'], ['hex', 'Hex (&#xA9;)']], 'named', { when: (o) => o.scope === 'all' }),
        ],
        run: (text, o) => htmlEncode(text, o),
    },
    {
        id: 'html-decode',
        name: 'HTML entity decode',
        group: 'encoding',
        description: 'Decodes named (&amp; &copy;), decimal (&#169;) and hex (&#xA9;) references as browsers do.',
        keywords: 'html entities unescape amp lt gt xml',
        input: TEXT,
        output: TEXT,
        options: [],
        async run(text, o, ctx) {
            const tables = await import('./htmlEntities.js')
            const { text: out, unknown } = htmlDecode(text, tables)
            if (unknown.length) ctx.warn(`Unknown references left as they are: ${unknown.join(' ')}`)
            return out
        },
    },
    {
        id: 'to-binary',
        name: 'To binary',
        group: 'encoding',
        description: 'Writes each byte as 8 bits (01001000). Text is encoded as UTF-8 first.',
        keywords: 'binary bits base2',
        input: BYTES,
        output: TEXT,
        options: [select('separator', 'Separator', [['space', 'Space'], ['none', 'None'], ['newline', 'Line break']], 'space')],
        run: (bytes, o) => binaryEncode(bytes, o),
    },
    {
        id: 'from-binary',
        name: 'From binary',
        group: 'encoding',
        description: 'Reads bits back into bytes: 8 per byte, or groups separated by spaces.',
        keywords: 'binary bits base2',
        input: TEXT,
        output: BYTES,
        options: [],
        run: (text) => binaryDecode(text),
    },
    {
        id: 'to-charcodes',
        name: 'To char codes',
        group: 'encoding',
        description: 'Writes the Unicode code point of each character (H → 72).',
        keywords: 'charcode code point unicode ascii ord',
        input: TEXT,
        output: TEXT,
        options: [
            select('base', 'Base', [['dec', 'Decimal'], ['hex', 'Hex'], ['unicode', 'U+ notation']], 'dec'),
            select('separator', 'Separator', [['space', 'Space'], ['comma', 'Comma'], ['newline', 'Line break']], 'space'),
        ],
        run: (text, o) => toCharCodes(text, o),
    },
    {
        id: 'from-charcodes',
        name: 'From char codes',
        group: 'encoding',
        description: 'Turns code points (72 101, 0x48, U+0048) back into text.',
        keywords: 'charcode code point unicode ascii chr',
        input: TEXT,
        output: TEXT,
        options: [select('base', 'Base', [['dec', 'Decimal'], ['hex', 'Hex']], 'dec')],
        run: (text, o) => fromCharCodes(text, o),
    },
    {
        id: 'rot13',
        name: 'ROT13',
        group: 'encoding',
        description: 'Shifts each letter A–Z by 13 places (or another amount, as a Caesar cipher).',
        keywords: 'rot13 caesar cipher rotate shift',
        input: TEXT,
        output: TEXT,
        options: [numberField('amount', 'Shift', 13, { min: 1, max: 25 })],
        run: (text, o) => rotate(text, o.amount),
    },

    // ----- Compression
    {
        id: 'gzip',
        name: 'Gzip',
        group: 'compression',
        description: 'Compresses bytes with gzip. Text is encoded as UTF-8 first.',
        keywords: 'gzip compress gz',
        input: BYTES,
        output: BYTES,
        options: [],
        ext: 'gz',
        run: (bytes) => pipeBytes(bytes, makeStream(globalThis.CompressionStream, 'gzip')),
    },
    {
        id: 'gunzip',
        name: 'Gunzip',
        group: 'compression',
        description: 'Decompresses gzip data.',
        keywords: 'gunzip gzip decompress inflate gz',
        input: BYTES,
        output: BYTES,
        options: [],
        async run(bytes) {
            if (!bytes.length) throw new RecipeError('the input is empty, so there’s nothing to decompress')
            if (!isGzip(bytes)) {
                throw new RecipeError(`the input isn’t gzip data: gzip starts with the bytes 1f 8b, this starts with ${startHex(bytes)}.${inputHint(bytes, 'gzip')}`)
            }
            try {
                return await decompress(bytes, 'gzip')
            } catch (error) {
                if (error instanceof RecipeError) throw error
                throw new RecipeError(`the gzip data is damaged or incomplete${detail(error)}`)
            }
        },
    },
    {
        id: 'deflate',
        name: 'Deflate',
        group: 'compression',
        description: 'Compresses bytes with deflate, as zlib (with a header and checksum) or raw. Text is encoded as UTF-8 first.',
        keywords: 'deflate zlib compress raw',
        input: BYTES,
        output: BYTES,
        options: [select('format', 'Format', [['zlib', 'zlib'], ['raw', 'Raw deflate']], 'zlib')],
        run: (bytes, o) => pipeBytes(bytes, makeStream(globalThis.CompressionStream, o.format === 'raw' ? 'deflate-raw' : 'deflate')),
    },
    {
        id: 'inflate',
        name: 'Inflate',
        group: 'compression',
        description: 'Decompresses deflate data, as zlib or raw (detected automatically by default).',
        keywords: 'inflate zlib deflate decompress raw',
        input: BYTES,
        output: BYTES,
        options: [select('format', 'Format', [['auto', 'Detect'], ['zlib', 'zlib'], ['raw', 'Raw deflate']], 'auto')],
        async run(bytes, o, ctx) {
            if (!bytes.length) throw new RecipeError('the input is empty, so there’s nothing to decompress')
            const zlib = isZlib(bytes)
            if (isGzip(bytes)) throw new RecipeError('this is gzip data, not zlib or raw deflate: use Gunzip instead')
            const attempt = async (format) => {
                try {
                    return await decompress(bytes, format)
                } catch (error) {
                    if (error instanceof RecipeError) throw error
                    return { failed: error }
                }
            }
            if (o.format === 'zlib' && !zlib) {
                throw new RecipeError(`the input isn’t zlib data: it doesn’t start with a zlib header (such as 78 9c), it starts with ${startHex(bytes)}.${inputHint(bytes, 'zlib') || ' Try the Raw deflate format.'}`)
            }
            const order = o.format === 'raw' ? ['deflate-raw'] : o.format === 'zlib' ? ['deflate'] : zlib ? ['deflate', 'deflate-raw'] : ['deflate-raw']
            let lastError = null
            for (const format of order) {
                const result = await attempt(format)
                if (result instanceof Uint8Array) {
                    if (o.format === 'auto') ctx.info(format === 'deflate' ? 'Read as zlib data' : 'Read as raw deflate data')
                    return result
                }
                lastError = result.failed
            }
            const what = o.format === 'zlib' ? 'zlib' : o.format === 'raw' ? 'raw deflate' : 'deflate (zlib or raw)'
            throw new RecipeError(`the input isn’t valid ${what} data, or it’s damaged or incomplete${detail(lastError)}.${inputHint(bytes, o.format === 'raw' ? 'raw' : 'deflate')}`)
        },
    },

    // ----- Data formats
    {
        id: 'json-prettify',
        name: 'JSON prettify',
        group: 'data',
        description: 'Indents JSON. Key order, numbers and escapes stay exactly as written.',
        keywords: 'json format pretty print beautify indent',
        input: TEXT,
        output: TEXT,
        ext: 'json',
        options: [select('indent', 'Indent', INDENT_CHOICES, '2')],
        run: (text, o, ctx) => printJsonTree(readJsonTree(text, ctx), { indent: indentString(o.indent) }),
    },
    {
        id: 'json-minify',
        name: 'JSON minify',
        group: 'data',
        description: 'Removes all whitespace between JSON tokens.',
        keywords: 'json compact minify uglify',
        input: TEXT,
        output: TEXT,
        ext: 'json',
        options: [],
        run: (text, o, ctx) => printJsonTree(readJsonTree(text, ctx)),
    },
    {
        id: 'json-sort-keys',
        name: 'JSON sort keys',
        group: 'data',
        description: 'Sorts object keys at every level (by Unicode code point, like jq -S).',
        keywords: 'json sort keys order canonical',
        input: TEXT,
        output: TEXT,
        ext: 'json',
        options: [select('indent', 'Indent', [...INDENT_CHOICES, ['none', 'Minified']], '2')],
        run: (text, o, ctx) => printJsonTree(readJsonTree(text, ctx), { indent: indentString(o.indent), sortKeys: true }),
    },
    {
        id: 'json-to-yaml',
        name: 'JSON → YAML',
        group: 'data',
        description: 'Converts JSON to YAML.',
        keywords: 'json yaml yml convert',
        input: TEXT,
        output: TEXT,
        ext: 'yaml',
        options: [select('indent', 'Indent', [['2', '2 spaces'], ['4', '4 spaces']], '2')],
        async run(text, o, ctx) {
            const tree = readJsonTree(text, ctx)
            if (hasMovableKeys(tree)) ctx.info('Integer-like keys (such as "10") come first in each mapping, as JavaScript orders them.')
            const { yaml, dumpSchema } = await loadYaml()
            return yaml.dump(treeToValue(tree), { schema: dumpSchema, noRefs: true, lineWidth: -1, indent: Number(o.indent) || 2 }).trimEnd()
        },
    },
    {
        id: 'yaml-to-json',
        name: 'YAML → JSON',
        group: 'data',
        description: 'Converts YAML (1.2, with anchors and merge keys) to JSON. Several documents become an array.',
        keywords: 'yaml yml json convert',
        input: TEXT,
        output: TEXT,
        ext: 'json',
        options: [select('indent', 'Indent', [...INDENT_CHOICES, ['none', 'Minified']], '2')],
        async run(text, o, ctx) {
            if (!text.trim()) throw new RecipeError('the input is empty: there’s no YAML to read')
            const { yaml, loadSchema } = await loadYaml()
            let docs
            try {
                docs = yaml.loadAll(text, { schema: loadSchema })
            } catch (error) {
                const mark = error?.mark
                const where = mark ? ` (line ${mark.line + 1}, column ${mark.column + 1})` : ''
                throw new RecipeError(`the input isn’t valid YAML: ${error?.reason ?? lowerFirst(String(error?.message ?? error))}${where}`)
            }
            let value
            if (docs.length <= 1) {
                value = docs[0] ?? null
            } else {
                value = docs.map((d) => d ?? null)
                ctx.info(`${docs.length} YAML documents became one JSON array`)
            }
            return toJsonText(value, indentString(o.indent), ctx)
        },
    },
    {
        id: 'json-to-toml',
        name: 'JSON → TOML',
        group: 'data',
        description: 'Converts a JSON object to TOML. TOML has no null, so null values are left out.',
        keywords: 'json toml convert config',
        input: TEXT,
        output: TEXT,
        ext: 'toml',
        options: [],
        async run(text, o, ctx) {
            const value = treeToValue(readJsonTree(text, ctx))
            if (!isPlainObject(value)) {
                throw new RecipeError(`TOML needs an object at the top level, but this is ${describeType(value)}. Wrap it in a key, for example {"items": …}`)
            }
            const dropped = []
            const prune = (node, path) => {
                if (Array.isArray(node)) {
                    node.forEach((item, i) => {
                        if (item === null) throw new RecipeError(`TOML has no null, and an array can’t skip values: ${path}[${i}] is null`)
                        prune(item, `${path}[${i}]`)
                    })
                } else if (isPlainObject(node)) {
                    for (const key of Object.keys(node)) {
                        const where = path ? `${path}.${key}` : key
                        if (node[key] === null) {
                            dropped.push(where)
                            delete node[key]
                        } else {
                            prune(node[key], where)
                        }
                    }
                }
            }
            prune(value, '')
            if (dropped.length) ctx.warn(`TOML has no null, so ${plural(dropped.length, 'key was', 'keys were')} left out: ${dropped.slice(0, 4).join(', ')}${dropped.length > 4 ? ', …' : ''}`)
            const { stringify } = await import('smol-toml')
            try {
                return stringify(value)
            } catch (error) {
                throw new RecipeError(`this can’t be written as TOML: ${lowerFirst(String(error?.message ?? error))}`)
            }
        },
    },
    {
        id: 'toml-to-json',
        name: 'TOML → JSON',
        group: 'data',
        description: 'Converts TOML to JSON. Dates become ISO 8601 strings.',
        keywords: 'toml json convert config',
        input: TEXT,
        output: TEXT,
        ext: 'json',
        options: [select('indent', 'Indent', [...INDENT_CHOICES, ['none', 'Minified']], '2')],
        async run(text, o, ctx) {
            const { parse } = await import('smol-toml')
            let value
            try {
                value = parse(text, { integersAsBigInt: 'asNeeded' })
            } catch (error) {
                const message = String(error?.message ?? error).split('\n')[0].replace(/^Invalid TOML document:\s*/, '')
                const where = error?.line ? ` (line ${error.line}, column ${error.column})` : ''
                throw new RecipeError(`the input isn’t valid TOML: ${lowerFirst(message)}${where}`)
            }
            return toJsonText(value, indentString(o.indent), ctx)
        },
    },
    {
        id: 'jwt-decode',
        name: 'JWT decode',
        group: 'data',
        description: 'Shows a JSON Web Token’s header and payload as JSON. The signature isn’t checked (the JWT Decoder tool does that).',
        keywords: 'jwt jws token bearer claims decode',
        input: TEXT,
        output: TEXT,
        ext: 'json',
        options: [select('part', 'Show', [['both', 'Header and payload'], ['header', 'Header'], ['payload', 'Payload']], 'both')],
        async run(text, o, ctx) {
            const { normalizeToken, decodeToken, evaluateTimes, describeValidity } = await import('../jwt.js')
            const { value: token, notes } = normalizeToken(text)
            if (!token) throw new RecipeError('the input is empty: paste a JWT (three Base64url parts separated by dots)')
            const decoded = decodeToken(token)
            if (decoded.error) throw new RecipeError(decoded.error.replace(/^Invalid JWT format: /, 'this isn’t a JWT: ').replace(/\.$/, ''))
            if (decoded.kind === 'jwe') throw new RecipeError('this is an encrypted token (JWE): its payload can’t be read without the key')
            notes.forEach((note) => ctx.info(note))
            const { header, payload } = decoded
            if (header.error) throw new RecipeError(lowerFirst(header.error))
            if (payload.type === 'error') throw new RecipeError(lowerFirst(payload.error))
            if (payload.type === 'binary') throw new RecipeError(`the payload isn’t text: it’s ${plural(payload.bytes.length, 'byte')} of binary data`)
            const headerTree = parseJsonTree(header.text).tree
            const payloadTree = payload.type === 'claims' || payload.type === 'json'
                ? parseJsonTree(payload.text).tree
                : { t: 'v', s: JSON.stringify(payload.text) }
            if (payload.type === 'nested') ctx.info('The payload is another JWT (a nested token): add another JWT decode step for it')
            if (payload.type === 'claims') {
                const validity = describeValidity(evaluateTimes(payload.value, ctx.now()))
                if (validity && (validity.tone === 'danger' || validity.tone === 'warning')) ctx.warn(validity.text)
            }
            if (o.part === 'header') return printJsonTree(headerTree, { indent: '  ' })
            if (o.part === 'payload') return printJsonTree(payloadTree, { indent: '  ' })
            return printJsonTree({ t: 'o', e: [['"header"', 'header', headerTree], ['"payload"', 'payload', payloadTree]] }, { indent: '  ' })
        },
    },

    // ----- Hashing
    hashOperation('md5', 'MD5', 'MD5 digest. Broken for security (collisions are easy), fine as a checksum.'),
    hashOperation('sha1', 'SHA-1', 'SHA-1 digest. Collisions have been demonstrated; avoid it for signatures.'),
    hashOperation('sha256', 'SHA-256', 'SHA-256 digest (SHA-2), the usual file checksum.'),
    hashOperation('sha384', 'SHA-384', 'SHA-384 digest (SHA-2).'),
    hashOperation('sha512', 'SHA-512', 'SHA-512 digest (SHA-2).'),

    // ----- Date & time
    {
        id: 'unix-to-date',
        name: 'Unix timestamp → ISO date',
        group: 'datetime',
        description: 'Converts Unix timestamps (one per line) to ISO 8601 dates in UTC. Seconds, ms, µs or ns are detected from the number of digits.',
        keywords: 'unix epoch timestamp date time iso 8601 utc',
        input: TEXT,
        output: TEXT,
        options: [select('unit', 'Unit', [['auto', 'Detect from digits'], ...TIME_UNIT_CHOICES], 'auto')],
        run(text, o, ctx) {
            const parts = splitLines(text)
            const units = new Set()
            let truncated = false
            const out = parts.lines.map((line, i) => {
                const value = line.trim()
                if (!value) return ''
                const where = parts.lines.length > 1 ? `line ${i + 1}: ` : ''
                const parsed = parseTimestamp(value, o.unit)
                if (parsed.status === 'error' && parsed.source !== 'number') {
                    throw new RecipeError(`${where}“${value.length > 40 ? `${value.slice(0, 39)}…` : value}” isn’t a Unix timestamp (a number of seconds since 1970)`)
                }
                if (parsed.status === 'error') throw new RecipeError(`${where}${lowerFirst(parsed.message.replace(/\.$/, ''))}`)
                if (parsed.source !== 'number') {
                    throw new RecipeError(`${where}“${value}” is a date, not a Unix timestamp: use Date → Unix timestamp to convert dates`)
                }
                units.add(parsed.unit)
                if (parsed.truncated) truncated = true
                return toIsoString(parsed.date, parsed.ns)
            })
            if (o.unit === 'auto' && units.size) ctx.info(`Read as ${[...units].map((u) => UNIT_INFO[u].label).join(' and ')} (from the number of digits)`)
            if (truncated) ctx.warn('Digits beyond nanoseconds were dropped')
            return joinLines(parts, out)
        },
    },
    {
        id: 'date-to-unix',
        name: 'Date → Unix timestamp',
        group: 'datetime',
        description: 'Converts dates (one per line, such as 2024-05-01T12:00:00Z) to Unix timestamps.',
        keywords: 'unix epoch timestamp date time iso 8601 utc',
        input: TEXT,
        output: TEXT,
        options: [select('unit', 'Unit', TIME_UNIT_CHOICES, 's')],
        run(text, o, ctx) {
            const parts = splitLines(text)
            let local = 0
            let dateOnly = 0
            const out = parts.lines.map((line, i) => {
                const value = line.trim()
                if (!value) return ''
                const where = parts.lines.length > 1 ? `line ${i + 1}: ` : ''
                const parsed = parseTimestamp(value)
                if (parsed.status === 'ok' && parsed.source === 'number') {
                    throw new RecipeError(`${where}“${value}” is already a number: use Unix timestamp → ISO date to read timestamps`)
                }
                if (parsed.status !== 'ok') {
                    throw new RecipeError(`${where}“${value.length > 40 ? `${value.slice(0, 39)}…` : value}” isn’t a date this browser can read. Use a format such as 2024-05-01T12:00:00Z`)
                }
                if (parsed.zone === 'local') local++
                if (parsed.zone === 'utc-date-only') dateOnly++
                return formatInUnit(parsed.ns, o.unit)
            })
            if (local) ctx.warn(`${plural(local, 'date has', 'dates have')} no time zone, so ${local === 1 ? 'it was' : 'they were'} read in your time zone (${LOCAL_TIME_ZONE})`)
            if (dateOnly) ctx.info('Dates without a time are read as midnight UTC')
            return joinLines(parts, out)
        },
    },

    // ----- Text
    {
        id: 'upper-case',
        name: 'Upper case',
        group: 'text',
        description: 'Converts text to UPPER CASE.',
        keywords: 'uppercase capitals caps',
        input: TEXT,
        output: TEXT,
        options: [],
        run: (text) => CASES.find((c) => c.id === 'upper').convert(text),
    },
    {
        id: 'lower-case',
        name: 'Lower case',
        group: 'text',
        description: 'Converts text to lower case.',
        keywords: 'lowercase small',
        input: TEXT,
        output: TEXT,
        options: [],
        run: (text) => CASES.find((c) => c.id === 'lower').convert(text),
    },
    {
        id: 'change-case',
        name: 'Change case',
        group: 'text',
        description: 'camelCase, snake_case, kebab-case, Title Case and more. Identifier styles convert each line on its own.',
        keywords: 'case camel snake kebab pascal title sentence constant',
        input: TEXT,
        output: TEXT,
        options: [select('case', 'Case', CASES.map((c) => [c.id, c.label]), 'camel')],
        run: (text, o) => (CASES.find((c) => c.id === o.case) ?? CASES[0]).convert(text),
    },
    {
        id: 'reverse',
        name: 'Reverse',
        group: 'text',
        description: 'Reverses the order of characters (emoji and accents stay whole) or of lines.',
        keywords: 'reverse backwards flip mirror',
        input: TEXT,
        output: TEXT,
        options: [select('by', 'By', [['characters', 'Characters'], ['lines', 'Lines']], 'characters')],
        run(text, o) {
            if (o.by === 'lines') {
                const parts = splitLines(text)
                return joinLines(parts, parts.lines.reverse())
            }
            return splitGraphemes(text).reverse().join('')
        },
    },
    {
        id: 'trim',
        name: 'Trim',
        group: 'text',
        description: 'Removes spaces, tabs and line breaks from the start and end.',
        keywords: 'trim strip whitespace spaces',
        input: TEXT,
        output: TEXT,
        options: [
            select('where', 'Where', [['both', 'Start and end'], ['start', 'Start'], ['end', 'End']], 'both'),
            toggle('lines', 'Each line', false),
        ],
        run(text, o) {
            const trim = o.where === 'start' ? (s) => s.trimStart() : o.where === 'end' ? (s) => s.trimEnd() : (s) => s.trim()
            if (!o.lines) return trim(text)
            const parts = splitLines(text)
            return joinLines(parts, parts.lines.map(trim))
        },
    },
    {
        id: 'sort-lines',
        name: 'Sort lines',
        group: 'text',
        description: 'Sorts lines alphabetically. Natural order puts item2 before item10.',
        keywords: 'sort lines order alphabetical natural',
        input: TEXT,
        output: TEXT,
        options: [
            select('order', 'Order', [['asc', 'A → Z'], ['desc', 'Z → A']], 'asc'),
            toggle('natural', 'Natural numbers', true),
            toggle('ignoreCase', 'Ignore case', false),
        ],
        run(text, o) {
            const parts = splitLines(text)
            const collator = new Intl.Collator(undefined, {
                numeric: o.natural,
                sensitivity: o.ignoreCase ? 'accent' : 'variant',
                caseFirst: o.ignoreCase ? 'false' : 'upper',
            })
            const dir = o.order === 'desc' ? -1 : 1
            return joinLines(parts, [...parts.lines].sort((a, b) => collator.compare(a, b) * dir))
        },
    },
    {
        id: 'unique-lines',
        name: 'Unique lines',
        group: 'text',
        description: 'Removes repeated lines, keeping the first of each.',
        keywords: 'unique dedupe duplicates distinct uniq lines',
        input: TEXT,
        output: TEXT,
        options: [toggle('ignoreCase', 'Ignore case', false)],
        run(text, o, ctx) {
            const parts = splitLines(text)
            const seen = new Set()
            const kept = parts.lines.filter((line) => {
                const key = o.ignoreCase ? line.toLocaleLowerCase() : line
                if (seen.has(key)) return false
                seen.add(key)
                return true
            })
            const removed = parts.lines.length - kept.length
            ctx.info(removed ? `Removed ${plural(removed, 'duplicate line')}` : 'No duplicate lines')
            return joinLines(parts, kept)
        },
    },
    {
        id: 'remove-empty-lines',
        name: 'Remove empty lines',
        group: 'text',
        description: 'Removes blank lines.',
        keywords: 'empty blank lines remove strip',
        input: TEXT,
        output: TEXT,
        options: [toggle('whitespace', 'Also lines with only spaces', true)],
        run(text, o, ctx) {
            const parts = splitLines(text)
            const kept = parts.lines.filter((line) => (o.whitespace ? line.trim() !== '' : line !== ''))
            const removed = parts.lines.length - kept.length
            if (removed) ctx.info(`Removed ${plural(removed, 'line')}`)
            return joinLines(parts, kept)
        },
    },
    {
        id: 'find-replace',
        name: 'Find & replace',
        group: 'text',
        description: 'Replaces text or regular expression matches. \\n and \\t stand for a line break and a tab; in a regex, $1 inserts a group.',
        keywords: 'find replace regex regexp substitute sed',
        input: TEXT,
        output: TEXT,
        options: [
            textField('find', 'Find', '', { placeholder: 'Text or pattern', mono: true }),
            textField('replace', 'Replace with', '', { placeholder: 'Nothing (delete)', mono: true }),
            toggle('regex', 'Regex', false),
            textField('flags', 'Flags', 'g', { placeholder: 'g', mono: true, maxLength: 8, size: 'xs' }),
        ],
        run(text, o, ctx) {
            if (!o.find) {
                ctx.info('Enter the text to find')
                return text
            }
            const flags = checkFlags(o.flags)
            const pattern = o.regex ? compileRegex(o.find, flags) : new RegExp(escapeRegex(unescapeField(o.find)), flags)
            const replacement = unescapeField(o.replace)
            // Without the g flag only the first match is replaced
            const global = pattern.flags.includes('g')
            let count = 0
            for (const _ of text.matchAll(global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`))) {
                count++
                if (!global) break
            }
            ctx.info(count ? `Replaced ${plural(count, 'match', 'matches')}` : 'No matches')
            return o.regex ? text.replace(pattern, replacement) : text.replace(pattern, () => replacement)
        },
    },
    {
        id: 'regex-extract',
        name: 'Extract with regex',
        group: 'text',
        description: 'Lists every match of a regular expression, one per line. Pick a group by number or name to extract just that part.',
        keywords: 'extract regex regexp match grep capture group',
        input: TEXT,
        output: TEXT,
        options: [
            textField('pattern', 'Pattern', '', { placeholder: 'e.g. \\d+ or (?<user>\\w+)@', mono: true }),
            textField('flags', 'Flags', 'g', { placeholder: 'g', mono: true, maxLength: 8, size: 'xs' }),
            textField('group', 'Group', '', { placeholder: 'All', mono: true, maxLength: 64, size: 'sm' }),
        ],
        run(text, o, ctx) {
            if (!o.pattern) {
                ctx.info('Enter a pattern to extract matches')
                return text
            }
            let flags = checkFlags(o.flags)
            if (!flags.includes('g')) flags += 'g'
            const regex = compileRegex(o.pattern, flags)
            const groupText = String(o.group ?? '').trim()
            let group = 0
            if (groupText) {
                // Group count and names, from a match of the empty string
                const probe = new RegExp(`(?:${regex.source})|`, flags.replace(/[gy]/g, '')).exec('')
                if (/^\d+$/.test(groupText)) {
                    group = Number(groupText)
                    const available = probe.length - 1
                    if (group > available) throw new RecipeError(`the pattern has ${available ? `only ${plural(available, 'group')}` : 'no groups'}, so there’s no group ${group}`)
                } else {
                    if (!probe.groups || !(groupText in probe.groups)) {
                        const names = probe.groups ? Object.keys(probe.groups) : []
                        throw new RecipeError(`the pattern has no group named “${groupText}”${names.length ? ` (it has ${names.map((n) => `“${n}”`).join(', ')})` : ''}`)
                    }
                    group = groupText
                }
            }
            const out = []
            let count = 0
            for (const m of text.matchAll(regex)) {
                count++
                const value = typeof group === 'number' ? m[group] : m.groups[group]
                if (value !== undefined) out.push(value)
            }
            ctx.info(count ? `${plural(count, 'match', 'matches')}` : 'No matches')
            return out.join('\n')
        },
    },
    {
        id: 'count',
        name: 'Count',
        group: 'text',
        description: 'Counts lines, words, characters and bytes, as a short report.',
        keywords: 'count lines words characters chars bytes length stats wc',
        input: 'any',
        output: TEXT,
        options: [],
        run(value, o, ctx) {
            const text = typeof value === 'string' ? value : decodeUtf8(value)
            if (text === null) {
                ctx.info('Binary data: only the bytes are counted')
                return `Bytes: ${value.length}`
            }
            return [
                `Lines: ${countLines(text)}`,
                `Words: ${getWords(text).length}`,
                `Characters: ${countGraphemes(text)}`,
                `Bytes (UTF-8): ${utf8ByteLength(text)}`,
            ].join('\n')
        },
    },
]

const BY_ID = new Map(OPERATIONS.map((op) => [op.id, op]))

export const getOperation = (id) => BY_ID.get(id) ?? null

/** Options for `op` with every value checked; unknown keys are dropped and invalid values reset. */
export function normalizeOptions(op, raw) {
    const options = {}
    const invalid = []
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    for (const spec of op.options) {
        const has = Object.prototype.hasOwnProperty.call(source, spec.id)
        const value = has ? source[spec.id] : undefined
        let ok = false
        if (has) {
            if (spec.type === 'select') ok = spec.choices.some((c) => c.value === value)
            else if (spec.type === 'boolean') ok = typeof value === 'boolean'
            else if (spec.type === 'text') ok = typeof value === 'string' && value.length <= spec.maxLength
            else if (spec.type === 'number') ok = typeof value === 'number' && Number.isInteger(value) && value >= spec.min && value <= spec.max
        }
        if (has && !ok) invalid.push(spec.id)
        options[spec.id] = ok ? value : spec.default
    }
    return { options, invalid }
}

export const defaultOptions = (op) => normalizeOptions(op, {}).options

/** Options that differ from the defaults (what saved recipes and links store). */
export function changedOptions(op, options) {
    const out = {}
    for (const spec of op.options) {
        if (options[spec.id] !== undefined && options[spec.id] !== spec.default) out[spec.id] = options[spec.id]
    }
    return out
}
