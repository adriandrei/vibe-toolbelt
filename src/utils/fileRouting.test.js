import { describe, expect, it } from 'vitest'
import { ALL_TOOLS } from '../config/tools'
import { MAX_TEXT_HANDOFF, extensionOf, fileKind, looksLikeHar, pickGroup, routesFor, sniffKind } from './fileRouting'

const KNOWN_PATHS = new Set(ALL_TOOLS.map(t => t.path))

describe('fileKind', () => {
    it.each([
        ['photo.JPG', '', 'image'],
        ['IMG_0001.heic', '', 'image'],
        ['logo.svg', 'image/svg+xml', 'svg'],
        ['report.pdf', 'application/pdf', 'pdf'],
        ['clip.mov', 'video/quicktime', 'video'],
        ['song.flac', '', 'audio'],
        ['session.har', '', 'har'],
        ['server.crt', '', 'cert'],
        ['request.csr', '', 'cert'],
        ['data.json', 'application/json', 'json'],
        ['config.yml', '', 'yaml'],
        ['Cargo.toml', '', 'toml'],
        ['feed.rss', '', 'xml'],
        ['table.tsv', '', 'csv'],
        ['README.md', '', 'markdown'],
        ['schema.sql', '', 'sql'],
        ['index.html', 'text/html', 'html'],
        ['app.tsx', '', 'typescript'],
        ['app.mjs', '', 'javascript'],
        ['query.gql', '', 'graphql'],
        ['notes.txt', 'text/plain', 'text'],
    ])('%s (%s) is %s', (name, type, kind) => {
        expect(fileKind({ name, type })).toBe(kind)
    })

    it('treats .ts as video when the browser says it is MPEG-TS', () => {
        expect(fileKind({ name: 'recording.ts', type: 'video/mp2t' })).toBe('video')
        expect(fileKind({ name: 'index.ts', type: '' })).toBe('typescript')
    })

    it('falls back to the MIME type, ignoring parameters', () => {
        expect(fileKind({ name: 'download', type: 'application/ld+json; charset=utf-8' })).toBe('json')
        expect(fileKind({ name: 'blob', type: 'image/webp' })).toBe('image')
        expect(fileKind({ name: 'x', type: 'text/x-shellscript' })).toBe('text')
    })

    it('returns null when only the content can tell', () => {
        expect(fileKind({ name: 'firmware.bin', type: 'application/octet-stream' })).toBeNull()
        expect(fileKind({ name: 'Makefile', type: '' })).toBeNull()
    })

    it('reads extensions case-insensitively', () => {
        expect(extensionOf('A.B.C.PNG')).toBe('png')
        expect(extensionOf('no-extension')).toBe('')
    })
})

describe('sniffKind', () => {
    const enc = (s) => new TextEncoder().encode(s)

    it('detects text, including UTF-8 and empty files', () => {
        expect(sniffKind(enc('hello\nworld\t✓'))).toBe('text')
        expect(sniffKind(new Uint8Array())).toBe('text')
    })

    it('detects binary data', () => {
        expect(sniffKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13]))).toBe('binary')
        expect(sniffKind(new Uint8Array([0xff, 0xfe, 0xfd, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46]))).toBe('binary')
        expect(sniffKind(new Uint8Array(Array.from({ length: 100 }, (_, i) => (i % 5 === 0 ? 1 : 65))))).toBe('binary')
    })

    it('tolerates a multi-byte character cut at the end of the sample', () => {
        const bytes = enc(`${'a'.repeat(20)}€`)
        expect(sniffKind(bytes.subarray(0, bytes.length - 1))).toBe('text')
    })
})

describe('looksLikeHar', () => {
    it('recognises the start of a HAR file', () => {
        expect(looksLikeHar('{\n  "log": {\n    "version": "1.2",\n    "entries": []')).toBe(true)
        expect(looksLikeHar('{"logs": {"entries": []}}')).toBe(false)
        expect(looksLikeHar('{"name": "log", "entries": 1}')).toBe(false)
    })
})

describe('routesFor', () => {
    it('only routes to registered tools', () => {
        const kinds = ['image', 'svg', 'pdf', 'video', 'audio', 'har', 'cert', 'json', 'yaml', 'toml', 'xml', 'csv', 'markdown', 'sql', 'html', 'css', 'scss', 'less', 'javascript', 'typescript', 'graphql', 'text', 'binary']
        for (const kind of kinds) {
            for (const route of routesFor(kind)) expect(KNOWN_PATHS.has(route.tool), `${kind} → ${route.tool}`).toBe(true)
        }
    })

    it('puts the best tool first, with its mode', () => {
        expect(routesFor('json')[0]).toEqual({ tool: '/formatters', how: 'text', mode: 'json' })
        expect(routesFor('pdf')[0]).toEqual({ tool: '/pdf', how: 'file' })
        expect(routesFor('yaml')[0]).toEqual({ tool: '/converter', how: 'text', mode: 'yaml' })
    })

    it('moves or adds the detected tool to the front', () => {
        const added = routesFor('text', { detected: { tool: '/jwt' } })
        expect(added[0]).toEqual({ tool: '/jwt', how: 'text' })
        const moved = routesFor('text', { detected: { tool: '/recipes' } })
        expect(moved[0].tool).toBe('/recipes')
        expect(moved.filter(r => r.tool === '/recipes')).toHaveLength(1)
    })

    it('drops text routes for files too big to hand over as text', () => {
        const routes = routesFor('json', { size: MAX_TEXT_HANDOFF + 1 })
        expect(routes.every(r => r.how === 'file')).toBe(true)
        expect(routes.map(r => r.tool)).toContain('/csv-json')
        // Nothing left: fall back to the binary tools
        expect(routesFor('sql', { size: MAX_TEXT_HANDOFF + 1 }).map(r => r.tool)).toEqual(['/hex', '/hash', '/privacy-scanner'])
    })

    it('uses the binary routes for unknown kinds', () => {
        expect(routesFor('nonsense').map(r => r.tool)).toEqual(['/hex', '/hash', '/privacy-scanner'])
    })
})

describe('pickGroup', () => {
    it('keeps the files of the first kind and counts the rest', () => {
        const a = { name: 'a.png' }
        const b = { name: 'b.pdf' }
        const c = { name: 'c.jpg' }
        expect(pickGroup([{ file: a, kind: 'image' }, { file: b, kind: 'pdf' }, { file: c, kind: 'image' }])).toEqual({ kind: 'image', files: [a, c], skipped: 1 })
        expect(pickGroup([])).toBeNull()
    })
})
