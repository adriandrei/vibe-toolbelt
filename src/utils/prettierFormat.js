// Code formatting with Prettier's standalone build (Code Formatters page).
//
// Prettier and its language plugins are large, so nothing is loaded up front:
// formatCode() imports prettier/standalone and only the plugins a language
// needs, the first time that language is formatted. vite.config.js gives each
// of these modules its own prettier-<name> chunk and keeps them out of the
// service worker's precache; that only works with these exact specifiers, so
// the import() calls below must stay literal.
// None of these modules use eval() or new Function(), so they run under the
// production Content-Security-Policy.

const MODULE_LOADERS = {
    standalone: () => import('prettier/standalone'),
    babel: () => import('prettier/plugins/babel'),
    estree: () => import('prettier/plugins/estree'),
    typescript: () => import('prettier/plugins/typescript'),
    postcss: () => import('prettier/plugins/postcss'),
    html: () => import('prettier/plugins/html'),
    yaml: () => import('prettier/plugins/yaml'),
    graphql: () => import('prettier/plugins/graphql'),
    markdown: () => import('prettier/plugins/markdown'),
}

const modulePromises = new Map()
const loadedModules = new Set()

function loadModule(name) {
    let promise = modulePromises.get(name)
    if (!promise) {
        promise = MODULE_LOADERS[name]().then(
            (mod) => {
                loadedModules.add(name)
                return mod
            },
            (error) => {
                // Forget the failure so the next attempt (e.g. back online) retries
                modulePromises.delete(name)
                throw error
            },
        )
        modulePromises.set(name, promise)
    }
    return promise
}

const JS_PLUGINS = ['babel', 'estree']
const TS_PLUGINS = ['typescript', 'estree']
const CSS_PLUGINS = ['postcss']
// HTML formats the code in <script>, <style> and style/event attributes with
// the JavaScript and CSS plugins.
const HTML_PLUGINS = ['html', 'postcss', 'babel', 'estree']

/** The languages formatted with Prettier: Prettier parser and the plugins it always needs. */
export const PRETTIER_LANGUAGES = {
    html: { label: 'HTML', parser: 'html', plugins: ['html'] },
    css: { label: 'CSS', parser: 'css', plugins: CSS_PLUGINS },
    scss: { label: 'SCSS', parser: 'scss', plugins: CSS_PLUGINS },
    less: { label: 'Less', parser: 'less', plugins: CSS_PLUGINS },
    javascript: { label: 'JavaScript', parser: 'babel', plugins: JS_PLUGINS },
    typescript: { label: 'TypeScript', parser: 'typescript', plugins: TS_PLUGINS },
    yaml: { label: 'YAML', parser: 'yaml', plugins: ['yaml'] },
    graphql: { label: 'GraphQL', parser: 'graphql', plugins: ['graphql'] },
    markdown: { label: 'Markdown', parser: 'markdown', plugins: ['markdown'] },
}

export const isPrettierLanguage = (language) => Object.hasOwn(PRETTIER_LANGUAGES, language)

/** Languages with a Minify action (whitespace and comment removal after a syntax check). */
export const MINIFIABLE_LANGUAGES = ['css']

export const PRINT_WIDTHS = [40, 60, 80, 100, 120, 140, 160, 200]

/**
 * The Prettier options the page offers, with Prettier's own defaults. Choice
 * options list their allowed values; the others are booleans.
 * (Indentation comes from the page's shared Indent setting, see formatCode.)
 */
export const PRETTIER_OPTIONS = {
    printWidth: { default: 80, values: PRINT_WIDTHS },
    semi: { default: true },
    singleQuote: { default: false },
    jsxSingleQuote: { default: false },
    trailingComma: { default: 'all', values: ['all', 'es5', 'none'] },
    quoteProps: { default: 'as-needed', values: ['as-needed', 'consistent', 'preserve'] },
    arrowParens: { default: 'always', values: ['always', 'avoid'] },
    bracketSpacing: { default: true },
    bracketSameLine: { default: false },
    singleAttributePerLine: { default: false },
    htmlWhitespaceSensitivity: { default: 'css', values: ['css', 'strict', 'ignore'] },
    proseWrap: { default: 'preserve', values: ['preserve', 'always', 'never'] },
    embeddedLanguageFormatting: { default: 'auto', values: ['auto', 'off'] },
}

export const PRETTIER_DEFAULTS = Object.fromEntries(
    Object.entries(PRETTIER_OPTIONS).map(([key, spec]) => [key, spec.default]),
)

const JS_OPTIONS = [
    'printWidth', 'semi', 'singleQuote', 'trailingComma', 'quoteProps', 'arrowParens',
    'bracketSpacing', 'jsxSingleQuote', 'bracketSameLine', 'singleAttributePerLine',
]
const CSS_OPTIONS = ['printWidth', 'singleQuote']

/** The options that change the output for each language, in display order. */
export const LANGUAGE_OPTIONS = {
    html: ['printWidth', 'htmlWhitespaceSensitivity', 'singleAttributePerLine', 'bracketSameLine', 'embeddedLanguageFormatting'],
    css: CSS_OPTIONS,
    scss: CSS_OPTIONS,
    less: CSS_OPTIONS,
    javascript: JS_OPTIONS,
    typescript: JS_OPTIONS,
    yaml: ['printWidth', 'singleQuote', 'bracketSpacing', 'proseWrap'],
    graphql: ['printWidth', 'bracketSpacing'],
    markdown: ['printWidth', 'proseWrap', 'singleQuote', 'embeddedLanguageFormatting'],
}

/**
 * Picks the Prettier options out of stored preferences, replacing anything
 * missing or invalid (old or hand-edited storage) with Prettier's default.
 */
export function readPrettierOptions(stored) {
    const source = stored && typeof stored === 'object' ? stored : {}
    const out = {}
    for (const [key, spec] of Object.entries(PRETTIER_OPTIONS)) {
        const value = source[key]
        const valid = spec.values ? spec.values.includes(value) : typeof value === 'boolean'
        out[key] = valid ? value : spec.default
    }
    return out
}

// Code-fence languages Prettier formats inside Markdown, spelled the way
// Prettier matches them (language name, alias or file extension; case
// sensitive), and the plugins each one needs.
const FENCE_PLUGINS = new Map([
    ...['js', 'javascript', 'jsx', 'mjs', 'cjs', 'es6', 'node', 'json', 'json5', 'jsonc'].map((lang) => [lang, JS_PLUGINS]),
    ...['ts', 'typescript', 'tsx', 'mts', 'cts'].map((lang) => [lang, TS_PLUGINS]),
    ...['css', 'scss', 'less', 'pcss', 'postcss'].map((lang) => [lang, CSS_PLUGINS]),
    ...['yaml', 'yml'].map((lang) => [lang, ['yaml']]),
    ...['graphql', 'gql', 'graphqls'].map((lang) => [lang, ['graphql']]),
    ...['html', 'htm', 'vue'].map((lang) => [lang, HTML_PLUGINS]),
])
// The first word of a fence's info string (```js, ~~~ yaml), also inside
// list items and block quotes. Over-matching only loads a plugin early.
const FENCE = /^[ \t>*+\-.)\d]*(?:`{3,}|~{3,})[ \t]*([^\s`]+)/gm

/**
 * The Prettier plugins needed to format `text` as `language`. With embedded
 * formatting on, HTML adds the CSS and JavaScript plugins (for <style> and
 * <script>), and Markdown adds the plugins for the fenced code blocks it
 * contains and for YAML front matter, so a plain document loads only the
 * Markdown plugin.
 */
export function pluginsFor(language, text = '', embedded = true) {
    const names = new Set(PRETTIER_LANGUAGES[language].plugins)
    if (embedded && language === 'html') HTML_PLUGINS.forEach((name) => names.add(name))
    if (embedded && language === 'markdown') {
        if (text.startsWith('---')) names.add('yaml')
        for (const [, lang] of text.matchAll(FENCE)) FENCE_PLUGINS.get(lang)?.forEach((name) => names.add(name))
    }
    return [...names]
}

/** True when Prettier and the language's own plugins have been downloaded. */
export function isFormatterLoaded(language) {
    return loadedModules.has('standalone') && PRETTIER_LANGUAGES[language].plugins.every((name) => loadedModules.has(name))
}

const positiveInt = (value) => (Number.isInteger(value) && value > 0 ? value : null)

/**
 * Turns an error thrown by Prettier into
 * { kind: 'syntax', message, line, column, endLine, endColumn } with 1-based
 * positions (null when Prettier gives none). The message is the first line of
 * Prettier's, without its "(line:column)" suffix, parser name or links.
 */
export function describePrettierError(error) {
    const raw = String(error?.message ?? error ?? '')
    const first = raw.split('\n')[0]
    const suffix = first.match(/\((\d+):(\d+)\)\s*$/)
    const message = first
        .replace(/\s*\(\d+:\d+\)\s*$/, '')
        .replace(/^(?:CssSyntaxError|SyntaxError|Syntax Error|Error):\s*/i, '')
        .replace(/\s*For more info see \S+\s*$/i, '')
        .replace(/\.$/, '')
        .trim() || 'The code could not be parsed'
    const start = error?.loc?.start
    const end = error?.loc?.end
    const line = positiveInt(start?.line) ?? (suffix ? Number(suffix[1]) : null)
    const column = line ? (positiveInt(start?.column) ?? (suffix ? Number(suffix[2]) : 1)) : null
    let endLine = null
    let endColumn = null
    if (line && positiveInt(end?.line) && positiveInt(end?.column)
        && (end.line > line || (end.line === line && end.column > column))) {
        endLine = end.line
        endColumn = end.column
    }
    return { kind: 'syntax', message, line, column, endLine, endColumn }
}

/**
 * Formats `text` as `language` (a PRETTIER_LANGUAGES key).
 *
 * options: the PRETTIER_OPTIONS (validated with readPrettierOptions),
 *   indent: '2' | '4' | 'tab' (YAML can't use tabs, so it gets 2 spaces),
 *   minify: true to minify instead (CSS only: the CSS is parsed first, so
 *   invalid input is reported instead of being "minified").
 *
 * Resolves to { output } or { error } and never rejects. error is the shape
 * of describePrettierError(), or { kind: 'load', message } when Prettier
 * could not be downloaded.
 */
export async function formatCode(text, language, options = {}) {
    const lang = PRETTIER_LANGUAGES[language]
    if (!lang) throw new Error(`Prettier doesn’t format "${language}" here`)
    if (options.minify && !MINIFIABLE_LANGUAGES.includes(language)) throw new Error(`Minify isn’t available for ${lang.label}`)
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // drop a byte order mark
    const prefs = readPrettierOptions(options)
    const embedded = prefs.embeddedLanguageFormatting === 'auto' && !options.minify
    const names = pluginsFor(language, source, embedded)

    let prettier
    let plugins
    try {
        [prettier, ...plugins] = await Promise.all([loadModule('standalone'), ...names.map(loadModule)])
    } catch {
        return { error: { kind: 'load', message: `Couldn’t download the ${lang.label} formatter. Check your connection and try again.` } }
    }

    try {
        const output = await prettier.format(source, {
            ...prefs,
            parser: lang.parser,
            plugins,
            tabWidth: options.indent === '4' ? 4 : 2,
            useTabs: options.indent === 'tab' && language !== 'yaml',
        })
        return { output: options.minify ? minifyCss(source) : output }
    } catch (error) {
        return { error: describePrettierError(error) }
    }
}

// ---------------------------------------------------------------- CSS minify

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'
const isHex = (c) => /^[0-9a-fA-F]$/.test(c)
const isNameChar = (c) => /^[\w-]$/.test(c) || c > '\u007f'

// Whitespace next to these never matters outside custom property values.
const NO_SPACE_AROUND = new Set(['{', '}', ';', ',', '>', '~', '!', '/'])
const NO_SPACE_AFTER = new Set(['(', ':'])
const NO_SPACE_BEFORE = new Set([')'])
// A comment between two characters can simply be dropped when one of them is
// one of these single-character tokens (they never merge with a neighbour).
const JOINS_AFTER = new Set(['{', '}', ';', ',', ':', '(', ')', '>', '~', '!'])
const JOINS_BEFORE = new Set(['{', '}', ';', ',', ':', ')', '>', '~', '!'])

const CUSTOM_PROPERTY = /--(?:[\w-]|\\[\s\S]|[\u0080-\uffff])*[ \t\n\r\f]*:/y

/**
 * Minifies CSS by removing comments (except /*! ... *\/ notices) and the
 * whitespace that doesn't matter: around { } ; , > ~ ! /, after ( and :, and
 * before ). Strings, url() values, escapes and custom property values (whose
 * whitespace can matter) are kept; spaces that separate tokens (descendant
 * selectors, "and (", calc's + and -) stay. The last ; in a block is dropped.
 * Expects valid CSS (formatCode checks it with Prettier first).
 */
export function minifyCss(css) {
    let out = ''
    let prev = '' // the last structural character written ('a' after a word, string or escape)
    let pendingSpace = false
    let atStatementStart = true
    let custom = null // { depth, written } while inside a custom property value
    let lastWasSemicolon = false
    let i = 0
    const n = css.length

    const write = (text, first, last) => {
        if (pendingSpace && out) {
            const droppable = NO_SPACE_AROUND.has(prev) || NO_SPACE_AROUND.has(first)
                || NO_SPACE_AFTER.has(prev) || NO_SPACE_BEFORE.has(first)
            // "/ *" must not become "/*", which would open a comment
            const needed = custom ? custom.written : !droppable || (prev === '/' && first === '*')
            if (needed) out += ' '
        }
        pendingSpace = false
        out += text
        prev = last
        lastWasSemicolon = false
        if (custom) custom.written = true
    }

    while (i < n) {
        const c = css[i]

        if (isSpace(c)) {
            pendingSpace = true
            i++
            continue
        }

        if (c === '/' && css[i + 1] === '*') {
            const close = css.indexOf('*/', i + 2)
            const end = close === -1 ? n : close + 2
            if (css[i + 2] === '!') {
                write(css.slice(i, end), '/', '/')
            } else if (!pendingSpace && end < n && !isSpace(css[end]) && out
                && !JOINS_AFTER.has(prev) && !JOINS_BEFORE.has(css[end])) {
                // a/**/b: the comment is the only thing separating two tokens
                write('/**/', '/', '/')
            } else {
                pendingSpace = pendingSpace || (end < n && isSpace(css[end]))
            }
            i = end
            continue
        }

        if (c === '"' || c === "'") {
            let j = i + 1
            while (j < n && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1
            j = Math.min(j + 1, n)
            write(css.slice(i, j), c, 'a')
            atStatementStart = false
            i = j
            continue
        }

        if (c === '\\') {
            let j = i + 1
            if (isHex(css[j] ?? '')) {
                while (j < n && j < i + 7 && isHex(css[j])) j++
                if (isSpace(css[j] ?? '')) j += css[j] === '\r' && css[j + 1] === '\n' ? 2 : 1
            } else {
                j = Math.min(j + 1, n)
            }
            write(css.slice(i, j), 'a', 'a')
            atStatementStart = false
            i = j
            continue
        }

        // Unquoted url(...): copied as is (it may contain , ; and :)
        if ((c === 'u' || c === 'U') && css.slice(i, i + 4).toLowerCase() === 'url(' && !isNameChar(css[i - 1] ?? '')) {
            let j = i + 4
            while (j < n && isSpace(css[j])) j++
            if (css[j] !== '"' && css[j] !== "'") {
                let k = j
                while (k < n && css[k] !== ')') k += css[k] === '\\' ? 2 : 1
                write(`${css.slice(i, i + 4)}${css.slice(j, k).trim()})`, 'a', ')')
                atStatementStart = false
                i = Math.min(k + 1, n)
                continue
            }
        }

        if (custom) {
            if ((c === ';' || c === '}') && custom.depth === 0) {
                // An empty value keeps one space (older browsers require a token)
                if (!custom.written && pendingSpace) out += ' '
                pendingSpace = false
                custom = null
                // fall through: the ; or } is written below
            } else {
                if (c === '(' || c === '[' || c === '{') custom.depth++
                else if ((c === ')' || c === ']' || c === '}') && custom.depth > 0) custom.depth--
                write(c, c, isNameChar(c) ? 'a' : c)
                i++
                continue
            }
        }

        if (atStatementStart && c === '-' && css[i + 1] === '-') {
            CUSTOM_PROPERTY.lastIndex = i
            const m = CUSTOM_PROPERTY.exec(css)
            if (m) {
                const name = m[0].slice(0, -1).replace(/[ \t\n\r\f]+$/, '')
                write(`${name}:`, '-', ':')
                custom = { depth: 0, written: false }
                atStatementStart = false
                i += m[0].length
                continue
            }
        }

        if (c === ';') {
            // Skip empty statements (;; or { ;)
            if (!lastWasSemicolon && prev !== '{' && out) {
                write(';', ';', ';')
                lastWasSemicolon = true
            }
            pendingSpace = false
            atStatementStart = true
            i++
            continue
        }

        if (c === '}') {
            if (lastWasSemicolon) out = out.slice(0, -1)
            pendingSpace = false
            write('}', '}', '}')
            atStatementStart = true
            i++
            continue
        }

        write(c, c, isNameChar(c) ? 'a' : c)
        atStatementStart = c === '{'
        i++
    }
    return out
}
