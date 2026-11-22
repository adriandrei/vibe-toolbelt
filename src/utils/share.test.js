import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { ShareError, buildShareUrl, decodeShareState, encodeShareState, readShareFragment } from './share'

describe('share links', () => {
    it('round-trips state, including Unicode and nested values', async () => {
        const data = { pattern: '(\\d+)-ü', flags: 'gu', text: 'a\nb 😀', options: { multiline: true, n: [1, 2] } }
        const encoded = await encodeShareState('/regex', data)
        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
        expect(await decodeShareState(encoded, '/regex')).toEqual(data)
    })

    it('compresses repetitive input', async () => {
        const encoded = await encodeShareState('/diff', { text: 'hello world\n'.repeat(500) })
        expect(encoded.length).toBeLessThan(200)
    })

    it('rejects a link made for another tool', async () => {
        const encoded = await encodeShareState('/regex', { a: 1 })
        await expect(decodeShareState(encoded, '/cron')).rejects.toThrow(ShareError)
    })

    it('rejects damaged input', async () => {
        await expect(decodeShareState('not-really-deflate', '/regex')).rejects.toThrow(ShareError)
        const encoded = await encodeShareState('/regex', { a: 1 })
        await expect(decodeShareState(encoded.slice(0, -4), '/regex')).rejects.toThrow(ShareError)
    })

    it('refuses links that are far too long', async () => {
        await expect(decodeShareState('A'.repeat(64_001), '/regex')).rejects.toThrow('too long')
    })

    it('stops decompressing a "deflate bomb" instead of freezing', async () => {
        // ~30 MB of zeros compress to a few tens of KB: a short link that would expand enormously
        const zeros = new Uint8Array(30 * 1024 * 1024)
        const packed = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
        const encoded = Buffer.from(packed).toString('base64url')
        expect(encoded.length).toBeLessThan(64_000)
        await expect(decodeShareState(encoded, '/regex')).rejects.toThrow('more data than a shared link can')
    })

    it('reads only well-formed fragments', () => {
        expect(readShareFragment('#s=abc_-1')).toBe('abc_-1')
        expect(readShareFragment('#s=')).toBeNull()
        expect(readShareFragment('#other')).toBeNull()
        expect(readShareFragment('#s=a+b')).toBeNull()
        expect(readShareFragment(undefined)).toBeNull()
    })

    it('builds a link on the given origin', async () => {
        const url = await buildShareUrl('/cron', { expression: '*/5 * * * *' }, 'https://example.test')
        expect(url).toMatch(/^https:\/\/example\.test\/cron#s=[A-Za-z0-9_-]+$/)
        const fragment = readShareFragment(url.slice(url.indexOf('#')))
        expect(await decodeShareState(fragment, '/cron')).toEqual({ expression: '*/5 * * * *' })
    })
})
