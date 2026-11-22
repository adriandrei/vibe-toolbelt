// Which tools can open a file, best first. Shared by Smart Drop (a file
// dropped anywhere), "Open with" on the installed app (file_handlers) and the
// installed app's share target.
//
// A route is { tool, how, mode? }:
//   how 'file': the File itself is handed over through the pipeline's media
//               slot, and the page picks it up with useIncomingFiles().
//   how 'text': the file is read as text and opened with smart input
//               (useSmartInput), `mode` telling the tool how to treat it.

// Text bigger than this isn't passed through navigation state; such files
// only get the routes that take the File itself.
export const MAX_TEXT_HANDOFF = 5 * 1024 * 1024

const EXTENSIONS = {
    image: ['png', 'apng', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'ico', 'heic', 'heif', 'jxl'],
    svg: ['svg'],
    pdf: ['pdf'],
    video: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ogv', '3gp', 'flv', 'wmv', 'mts', 'm2ts'],
    audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac'],
    har: ['har'],
    cert: ['pem', 'crt', 'cer', 'der', 'csr', 'key', 'pub', 'p7b', 'p7c', 'spc'],
    json: ['json', 'jsonc', 'geojson', 'webmanifest'],
    yaml: ['yaml', 'yml'],
    toml: ['toml'],
    xml: ['xml', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist', 'csproj', 'resx'],
    csv: ['csv', 'tsv'],
    markdown: ['md', 'markdown', 'mdx'],
    sql: ['sql'],
    html: ['html', 'htm', 'xhtml'],
    css: ['css'],
    scss: ['scss'],
    less: ['less'],
    javascript: ['js', 'mjs', 'cjs', 'jsx'],
    typescript: ['ts', 'mts', 'cts', 'tsx'],
    graphql: ['graphql', 'gql'],
    text: ['txt', 'text', 'log', 'env', 'ini', 'cfg', 'conf', 'properties', 'tsbuildinfo'],
}

const BY_EXTENSION = new Map(Object.entries(EXTENSIONS).flatMap(([kind, list]) => list.map(ext => [ext, kind])))

const BY_MIME = [
    [/^image\/svg\+xml$/, 'svg'],
    [/^image\//, 'image'],
    [/^video\//, 'video'],
    [/^audio\//, 'audio'],
    [/^application\/pdf$/, 'pdf'],
    [/^application\/(?:[\w.+-]+\+)?json$/, 'json'],
    [/^(?:application|text)\/(?:x-)?yaml$/, 'yaml'],
    [/^application\/toml$/, 'toml'],
    [/^(?:application|text)\/(?:[\w.+-]+\+)?xml$/, 'xml'],
    [/^text\/(?:csv|tab-separated-values)$/, 'csv'],
    [/^text\/markdown$/, 'markdown'],
    [/^(?:application|text)\/sql$/, 'sql'],
    [/^text\/html$/, 'html'],
    [/^text\/css$/, 'css'],
    [/^(?:application|text)\/javascript$/, 'javascript'],
    [/^application\/(?:x-x509-ca-cert|pkix-cert|x-pem-file|pkcs10|pkcs7-mime|x-pkcs7-certificates)$/, 'cert'],
    [/^text\//, 'text'],
]

const ROUTES = {
    image: [['/image', 'file'], ['/exif', 'file'], ['/image-base64', 'file'], ['/color-blindness', 'file'], ['/favicon', 'file'], ['/privacy-scanner', 'file'], ['/hash', 'file']],
    svg: [['/svg', 'text'], ['/image', 'file'], ['/image-base64', 'file'], ['/favicon', 'file']],
    pdf: [['/pdf', 'file'], ['/privacy-scanner', 'file'], ['/hash', 'file']],
    video: [['/video', 'file'], ['/hash', 'file']],
    audio: [['/hash', 'file'], ['/hex', 'file']],
    har: [['/har', 'file'], ['/formatters', 'text', 'json']],
    cert: [['/certificate', 'file'], ['/hex', 'file']],
    json: [['/formatters', 'text', 'json'], ['/converter', 'text', 'json'], ['/json-schema', 'text'], ['/type-converter', 'text'], ['/csv-json', 'file'], ['/recipes', 'text']],
    yaml: [['/converter', 'text', 'yaml'], ['/formatters', 'text', 'yaml']],
    toml: [['/converter', 'text', 'toml']],
    xml: [['/formatters', 'text', 'xml'], ['/converter', 'text', 'xml']],
    csv: [['/csv-json', 'file'], ['/privacy-scanner', 'file']],
    markdown: [['/markdown', 'text'], ['/formatters', 'text', 'markdown'], ['/privacy-scanner', 'file']],
    sql: [['/formatters', 'text', 'sql']],
    html: [['/formatters', 'text', 'html']],
    css: [['/formatters', 'text', 'css']],
    scss: [['/formatters', 'text', 'scss']],
    less: [['/formatters', 'text', 'less']],
    javascript: [['/formatters', 'text', 'javascript']],
    typescript: [['/formatters', 'text', 'typescript']],
    graphql: [['/formatters', 'text', 'graphql']],
    text: [['/inspect', 'text'], ['/privacy-scanner', 'file'], ['/recipes', 'text'], ['/hash', 'file']],
    binary: [['/hex', 'file'], ['/hash', 'file'], ['/privacy-scanner', 'file']],
}

// Short names for the dialog ("Open 2 images in…")
export const KIND_NOUNS = {
    image: ['image', 'images'], svg: ['SVG file', 'SVG files'], pdf: ['PDF', 'PDFs'], video: ['video', 'videos'],
    audio: ['audio file', 'audio files'], har: ['HAR file', 'HAR files'], cert: ['certificate or key', 'certificates or keys'],
    json: ['JSON file', 'JSON files'], yaml: ['YAML file', 'YAML files'], toml: ['TOML file', 'TOML files'],
    xml: ['XML file', 'XML files'], csv: ['CSV file', 'CSV files'], markdown: ['Markdown file', 'Markdown files'],
    sql: ['SQL file', 'SQL files'], html: ['HTML file', 'HTML files'], css: ['CSS file', 'CSS files'],
    scss: ['SCSS file', 'SCSS files'], less: ['Less file', 'Less files'], javascript: ['JavaScript file', 'JavaScript files'],
    typescript: ['TypeScript file', 'TypeScript files'], graphql: ['GraphQL file', 'GraphQL files'],
    text: ['text file', 'text files'], binary: ['file', 'files'],
}

export function extensionOf(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ''))
    return match ? match[1].toLowerCase() : ''
}

/**
 * The kind of a file from its name and MIME type: one of the keys of ROUTES,
 * or null when only its content can tell (see sniffKind).
 */
export function fileKind({ name, type }) {
    const mime = String(type || '').toLowerCase().split(';')[0].trim()
    const ext = extensionOf(name)
    // .ts is TypeScript, unless the browser says it's an MPEG transport stream
    if (ext === 'ts' && mime.startsWith('video/')) return 'video'
    if (BY_EXTENSION.has(ext)) return BY_EXTENSION.get(ext)
    for (const [pattern, kind] of BY_MIME) if (pattern.test(mime)) return kind
    return null
}

/** Text vs binary for files whose name and type say nothing (first bytes). */
export function sniffKind(bytes) {
    if (!bytes.length) return 'text'
    if (bytes.includes(0)) return 'binary'
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.length > 4 ? bytes.subarray(0, bytes.length - 4) : bytes)
    } catch {
        return 'binary'
    }
    let control = 0
    for (const b of bytes) if (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12) control++
    return control / bytes.length > 0.02 ? 'binary' : 'text'
}

/** True when JSON text looks like a HAR file (log.entries), from its start. */
export function looksLikeHar(text) {
    return /^\s*\{\s*"log"\s*:\s*\{/.test(text.slice(0, 2000)) && text.includes('"entries"')
}

/**
 * Routes for a kind, best first, without duplicates. `size` (bytes) drops the
 * text routes for files too big to hand over as text. `detectedTool` (from
 * Smart Paste's detection on the text) goes first when given.
 */
export function routesFor(kind, { size = 0, detected = null } = {}) {
    const list = (ROUTES[kind] || ROUTES.binary).map(([tool, how, mode]) => ({ tool, how, ...(mode ? { mode } : {}) }))
    if (detected && !list.some(r => r.tool === detected.tool)) list.unshift({ tool: detected.tool, how: 'text', ...(detected.mode ? { mode: detected.mode } : {}) })
    else if (detected) {
        const index = list.findIndex(r => r.tool === detected.tool)
        list.unshift(...list.splice(index, 1))
    }
    const usable = size > MAX_TEXT_HANDOFF ? list.filter(r => r.how === 'file') : list
    return usable.length ? usable : ROUTES.binary.map(([tool, how]) => ({ tool, how }))
}

/**
 * Groups dropped files by kind. Returns { kind, files, skipped }: the kind of
 * the first file, the files of that kind, and how many others were left out.
 */
export function pickGroup(entries) {
    if (!entries.length) return null
    const kind = entries[0].kind
    const files = entries.filter(e => e.kind === kind).map(e => e.file)
    return { kind, files, skipped: entries.length - files.length }
}
