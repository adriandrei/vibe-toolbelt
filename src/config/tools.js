// Tool registry: the single list behind the sidebar, the command palette,
// the Home grid and every page header. Labels are short (sidebar); titles are
// the page heading and tab title. Keep descriptions to one short sentence.
import {
    Home, ScanSearch, Zap, ScreenShare, Film, Images,
    Braces, ArrowRightLeft, Sheet, FileType, FileText, Binary,
    Code, ImageDown, Link2, Code2, Calculator,
    KeyRound, Hash, Fingerprint, ShieldCheck, Lock, FileLock2, Timer, Gauge,
    Shuffle, UserRound, Database, Type, QrCode,
    ChartColumn, CaseSensitive, ListOrdered, Regex, FileDiff,
    Link, Monitor, TerminalSquare, Network, Tags, Server,
    Clock, CalendarClock, FolderLock, Keyboard,
    FileStack, Shapes, Layers, Aperture, ScanEye,
    Droplets, Palette, Triangle, SquareStack, Pipette, Eye, Camera,
    Wand2, Settings, Sparkles, Wrench, FileImage, Lightbulb,
} from 'lucide-react'

export const TOOL_CATEGORIES = [
    {
        id: 'core',
        name: 'Core',
        icon: Wand2,
        items: [
            { path: '/', label: 'Home', title: 'Home', icon: Home, description: 'Every tool in one place.', keywords: 'start overview all tools' },
            { path: '/inspect', label: 'Inspector', title: 'Universal Inspector', icon: ScanSearch, description: 'Paste anything to detect its format, decode it and get stats.', keywords: 'detect analyze identify entropy auto' },
            { path: '/api-tester', label: 'API Tester', title: 'API Tester', icon: Zap, description: 'Send HTTP requests with headers, auth, environments and history.', keywords: 'rest http request postman fetch client' },
            { path: '/recorder', label: 'Screen Recorder', title: 'Screen Recorder', icon: ScreenShare, description: 'Record your screen, a window or a tab, with mic and webcam.', keywords: 'capture video webm gif record' },
            { path: '/video', label: 'Video Studio', title: 'Video Studio', icon: Film, description: 'Trim, crop, speed up and convert videos with ffmpeg.', keywords: 'ffmpeg mp4 gif mp3 edit trim crop' },
            { path: '/image', label: 'Image Converter', title: 'Image Converter', icon: Images, description: 'Convert, resize, rotate and crop images in bulk.', keywords: 'png jpeg webp avif heic ico pdf resize compress' },
        ],
    },
    {
        id: 'data',
        name: 'Data & Formats',
        icon: Braces,
        items: [
            { path: '/formatters', label: 'Formatters', title: 'Code Formatters', icon: Braces, description: 'Prettify, minify and query JSON, SQL and XML.', keywords: 'json sql xml beautify prettify minify jmespath lint' },
            { path: '/converter', label: 'Data Converter', title: 'Data Converter', icon: ArrowRightLeft, description: 'Convert between JSON, YAML, TOML and XML.', keywords: 'yaml toml xml json convert' },
            { path: '/csv-json', label: 'CSV ↔ JSON', title: 'CSV ↔ JSON', icon: Sheet, description: 'Convert CSV to JSON and back.', keywords: 'csv tsv spreadsheet table excel' },
            { path: '/type-converter', label: 'JSON to Types', title: 'JSON to Types', icon: FileType, description: 'Generate TypeScript, Go structs or JSON Schema from JSON.', keywords: 'typescript interface go struct schema types' },
            { path: '/markdown', label: 'Markdown', title: 'Markdown Editor', icon: FileText, description: 'Write Markdown with a live GitHub-flavored preview.', keywords: 'md preview gfm readme' },
            { path: '/hex', label: 'Hex Viewer', title: 'Hex Viewer', icon: Binary, description: 'Inspect any file byte by byte.', keywords: 'binary bytes dump file' },
        ],
    },
    {
        id: 'encoders',
        name: 'Encoders',
        icon: Code,
        items: [
            { path: '/base64', label: 'Base64', title: 'Base64 Encode / Decode', icon: Code, description: 'Encode and decode Base64 text, including URL-safe Base64.', keywords: 'atob btoa base64url encode decode' },
            { path: '/image-base64', label: 'Image to Base64', title: 'Image to Base64', icon: ImageDown, description: 'Turn images into data URIs, HTML and CSS snippets, or decode a data URI back to an image.', keywords: 'data uri image embed inline decode base64 svg' },
            { path: '/urlencode', label: 'URL Encode', title: 'URL Encode / Decode', icon: Link2, description: 'Percent-encode and decode URLs and query values.', keywords: 'percent encodeuricomponent escape' },
            { path: '/html-entity', label: 'HTML Entities', title: 'HTML Entity Encoder', icon: Code2, description: 'Escape and unescape HTML entities.', keywords: 'escape unescape html entities &amp;' },
            { path: '/number-base', label: 'Number Base', title: 'Number Base Converter', icon: Calculator, description: 'Convert between binary, octal, decimal and hex.', keywords: 'binary hex octal radix bigint two complement' },
        ],
    },
    {
        id: 'security',
        name: 'Security',
        icon: ShieldCheck,
        items: [
            { path: '/jwt', label: 'JWT Decoder', title: 'JWT Decoder & Verifier', icon: KeyRound, description: 'Decode JSON Web Tokens and verify their signatures.', keywords: 'jwt token jose bearer jws verify' },
            { path: '/hash', label: 'Hash Generator', title: 'Hash Generator', icon: Hash, description: 'MD5, SHA-1, SHA-2 and SHA-3 digests of text or files.', keywords: 'md5 sha sha256 sha3 keccak checksum digest file' },
            { path: '/hmac', label: 'HMAC Generator', title: 'HMAC Generator', icon: Fingerprint, description: 'Keyed message signatures for webhooks and APIs.', keywords: 'hmac signature webhook sha256' },
            { path: '/bcrypt', label: 'Bcrypt', title: 'Bcrypt Hash & Verify', icon: ShieldCheck, description: 'Hash passwords with bcrypt and check them against a hash.', keywords: 'password hash salt verify' },
            { path: '/aes', label: 'AES Encryption', title: 'AES Encrypt / Decrypt', icon: Lock, description: 'Encrypt and decrypt text with a passphrase, using AES-256-GCM by default.', keywords: 'aes gcm encrypt decrypt openssl cryptojs cipher pbkdf2' },
            { path: '/rsa', label: 'RSA Keys', title: 'RSA Key Generator', icon: FileLock2, description: 'Generate RSA key pairs in your browser with WebCrypto, as PEM or JWK.', keywords: 'rsa pem jwk keypair public private pkcs8 pkcs1' },
            { path: '/otp', label: 'TOTP', title: 'TOTP Generator', icon: Timer, description: 'Two-factor codes and QR setup for authenticator apps.', keywords: 'otp 2fa authenticator totp mfa' },
            { path: '/password', label: 'Password Audit', title: 'Password Strength Audit', icon: Gauge, description: 'Check how hard a password is to crack.', keywords: 'zxcvbn strength entropy' },
        ],
    },
    {
        id: 'generators',
        name: 'Generators',
        icon: Shuffle,
        items: [
            { path: '/uuid', label: 'UUID', title: 'UUID Generator', icon: Shuffle, description: 'Generate UUIDs (v4, v7, v1, v5) in bulk, and inspect any UUID.', keywords: 'guid uuid v4 v7 v1 v5 random id validate inspect' },
            { path: '/nanoid', label: 'Nano ID / ULID', title: 'Nano ID & ULID Generator', icon: Lightbulb, description: 'Generate compact, URL-safe and sortable IDs.', keywords: 'id ulid nanoid short unique' },
            { path: '/username', label: 'Username', title: 'Username Generator', icon: UserRound, description: 'Random readable or random-character usernames.', keywords: 'handle name nickname' },
            { path: '/faker', label: 'Fake Data', title: 'Fake Data Generator', icon: Database, description: 'Build a schema and generate mock JSON, CSV or SQL.', keywords: 'mock faker seed test data sql csv' },
            { path: '/lorem', label: 'Lorem Ipsum', title: 'Lorem Ipsum Generator', icon: Type, description: 'Placeholder paragraphs, sentences and words.', keywords: 'placeholder dummy text filler' },
            { path: '/qrcode', label: 'QR Code', title: 'QR Code Generator', icon: QrCode, description: 'Create QR codes for links and text.', keywords: 'qr barcode share' },
        ],
    },
    {
        id: 'text',
        name: 'Text',
        icon: CaseSensitive,
        items: [
            { path: '/text-stats', label: 'Text Stats', title: 'Text Statistics', icon: ChartColumn, description: 'Count words, characters and reading time.', keywords: 'word count characters reading time' },
            { path: '/case', label: 'Case Converter', title: 'Case Converter', icon: CaseSensitive, description: 'camelCase, snake_case, kebab-case and more.', keywords: 'camel snake kebab pascal upper lower title' },
            { path: '/list', label: 'List Sorter', title: 'List Sorter & Deduplicator', icon: ListOrdered, description: 'Sort, dedupe and clean up lines of text.', keywords: 'sort unique lines dedupe' },
            { path: '/regex', label: 'Regex Tester', title: 'Regex Tester', icon: Regex, description: 'Test regular expressions with live highlighting.', keywords: 'regexp pattern match replace' },
            { path: '/diff', label: 'Text Diff', title: 'Text Diff', icon: FileDiff, description: 'Compare two texts line by line.', keywords: 'compare difference patch secure diff' },
        ],
    },
    {
        id: 'web',
        name: 'Web',
        icon: Link,
        items: [
            { path: '/url', label: 'URL Parser', title: 'URL Parser', icon: Link, description: 'Break a URL into its parts and query parameters.', keywords: 'query string link params' },
            { path: '/ua', label: 'User Agent', title: 'User Agent Parser', icon: Monitor, description: 'Identify browser, OS, engine and device from a user-agent string.', keywords: 'browser device os ua' },
            { path: '/curl', label: 'cURL Converter', title: 'cURL Converter', icon: TerminalSquare, description: 'Convert cURL commands to fetch or Python code.', keywords: 'curl fetch python request http' },
            { path: '/cidr', label: 'IP / CIDR', title: 'IP / CIDR Calculator', icon: Network, description: 'Address ranges, masks and host counts for IPv4 and IPv6.', keywords: 'subnet ip network mask ipv6' },
            { path: '/meta', label: 'Meta Tags', title: 'Meta Tag Generator', icon: Tags, description: 'SEO, Open Graph and Twitter Card tags.', keywords: 'seo og twitter html head' },
            { path: '/http-status', label: 'HTTP Status', title: 'HTTP Status Codes', icon: Server, description: 'Searchable reference of HTTP status codes.', keywords: '404 500 200 response codes' },
        ],
    },
    {
        id: 'dev',
        name: 'Dev Utilities',
        icon: Wrench,
        items: [
            { path: '/unix', label: 'Unix Timestamp', title: 'Unix Timestamp Converter', icon: Clock, description: 'Convert epoch timestamps to dates and back.', keywords: 'epoch time date milliseconds' },
            { path: '/cron', label: 'Cron Parser', title: 'Cron Expression Parser', icon: CalendarClock, description: 'Explain cron schedules and list upcoming runs.', keywords: 'schedule crontab job' },
            { path: '/chmod', label: 'Chmod', title: 'Chmod Calculator', icon: FolderLock, description: 'Unix permissions in octal and symbolic form, both ways.', keywords: 'permissions unix rwx octal symbolic setuid sticky' },
            { path: '/keycode', label: 'Keycode', title: 'Keycode Viewer', icon: Keyboard, description: 'See key, code and keyCode for any key press.', keywords: 'keyboard event key code' },
        ],
    },
    {
        id: 'files',
        name: 'Images & Files',
        icon: FileStack,
        items: [
            { path: '/pdf', label: 'PDF Tools', title: 'PDF Tools', icon: FileStack, description: 'Merge PDFs, rotate pages and extract page ranges.', keywords: 'merge split rotate extract pdf' },
            { path: '/svg', label: 'SVG Optimizer', title: 'SVG Optimizer', icon: Shapes, description: 'Shrink SVG files without breaking them.', keywords: 'svg compress minify optimize' },
            { path: '/favicon', label: 'Favicon Generator', title: 'Favicon Generator', icon: Layers, description: 'Every favicon size, an ICO and a manifest from one image.', keywords: 'icon ico manifest apple touch' },
            { path: '/exif', label: 'EXIF Viewer', title: 'EXIF Viewer', icon: Aperture, description: 'Read photo metadata and save a clean copy.', keywords: 'metadata gps camera exif strip' },
            { path: '/privacy-scanner', label: 'Privacy Scanner', title: 'Privacy Scanner', icon: ScanEye, description: 'Find personal data in text and hidden metadata in files.', keywords: 'pii gdpr metadata redact email phone' },
        ],
    },
    {
        id: 'design',
        name: 'Design',
        icon: Palette,
        items: [
            { path: '/css', label: 'Glassmorphism', title: 'Glassmorphism Generator', icon: Droplets, description: 'Frosted-glass CSS with a live preview.', keywords: 'glass blur css backdrop filter' },
            { path: '/gradient', label: 'Gradient', title: 'Gradient Generator', icon: Palette, description: 'Linear, radial and conic CSS gradients with any number of colour stops.', keywords: 'css background gradient linear radial conic stops' },
            { path: '/triangle', label: 'CSS Triangle', title: 'CSS Triangle Generator', icon: Triangle, description: 'Pure CSS triangles.', keywords: 'css arrow border triangle' },
            { path: '/box-shadow', label: 'Box Shadow', title: 'Box Shadow Generator', icon: SquareStack, description: 'Layered CSS box shadows.', keywords: 'css shadow elevation' },
            { path: '/color', label: 'Color Converter', title: 'Color Converter', icon: Pipette, description: 'Convert any CSS colour to HEX, RGB, HSL, HWB and OKLCH, with alpha.', keywords: 'hex rgb hsl hwb oklch alpha colour picker contrast' },
            { path: '/color-blindness', label: 'Color Blindness', title: 'Color Blindness Simulator', icon: Eye, description: 'See images the way people with color-vision deficiencies do.', keywords: 'accessibility cvd protanopia deuteranopia' },
            { path: '/snippets', label: 'Code Screenshot', title: 'Code Screenshot', icon: Camera, description: 'Turn code into a shareable image.', keywords: 'carbon snippet image png share code' },
        ],
    },
]

// Not listed in a sidebar category; reachable from the sidebar footer.
export const SETTINGS_TOOL = {
    path: '/ai-settings',
    label: 'Settings',
    title: 'Settings',
    icon: Settings,
    description: 'Appearance, accent colour and the on-device AI model.',
    keywords: 'theme dark light accent color hue ai model webgpu preferences',
}

export const AI_ICON = Sparkles
export const FALLBACK_ICON = FileImage

export const ALL_TOOLS = [
    ...TOOL_CATEGORIES.flatMap(cat => cat.items.map(item => ({ ...item, category: cat.name, categoryId: cat.id }))),
    { ...SETTINGS_TOOL, category: 'Settings', categoryId: 'settings' },
]

const BY_PATH = new Map(ALL_TOOLS.map(tool => [tool.path, tool]))

export function getTool(path) {
    return BY_PATH.get(path) || null
}

// Number of tools, excluding Home and Settings.
export const TOOL_COUNT = ALL_TOOLS.filter(t => t.path !== '/' && t.path !== SETTINGS_TOOL.path).length

// Ranked search used by the sidebar and the command palette.
export function searchTools(query, tools = ALL_TOOLS) {
    const q = query.trim().toLowerCase()
    if (!q) return tools
    const words = q.split(/\s+/)
    const scored = []
    for (const tool of tools) {
        const label = tool.label.toLowerCase()
        const title = tool.title.toLowerCase()
        const haystack = `${label} ${title} ${tool.keywords || ''} ${tool.description} ${tool.category || ''} ${tool.path}`.toLowerCase()
        let score = 0
        if (label === q || title === q) score = 100
        else if (label.startsWith(q) || title.startsWith(q)) score = 80
        else if (label.split(/[\s/]+/).some(w => w.startsWith(q)) || title.split(/[\s/&]+/).some(w => w.startsWith(q))) score = 65
        else if (label.includes(q) || title.includes(q)) score = 55
        else if (words.every(w => haystack.includes(w))) score = (tool.keywords || '').toLowerCase().split(/\s+/).some(k => k.startsWith(words[0])) ? 40 : 25
        if (score > 0) scored.push({ tool, score })
    }
    return scored.sort((a, b) => b.score - a.score).map(s => s.tool)
}
