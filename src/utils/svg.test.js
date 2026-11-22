// Only the DOM-free helpers; parseSvg and optimizeSvg rely on DOMParser and are
// covered by the browser suite.
import { describe, expect, it } from 'vitest'
import { DEFAULT_SVG_OPTIONS, byteSize, svgDataUrl } from './svg'

describe('byteSize', () => {
    it('counts UTF-8 bytes', () => {
        expect(byteSize('')).toBe(0)
        expect(byteSize('<svg/>')).toBe(6)
        expect(byteSize('é€😀')).toBe(2 + 3 + 4)
    })
})

describe('svgDataUrl', () => {
    it('percent-encodes the markup so it survives in an <img src>', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>a & b #1</text></svg>'
        const url = svgDataUrl(svg)
        expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
        expect(url).not.toMatch(/[<>"#& ]/)
        expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toBe(svg)
    })
})

describe('DEFAULT_SVG_OPTIONS', () => {
    it('is frozen', () => {
        expect(Object.isFrozen(DEFAULT_SVG_OPTIONS)).toBe(true)
        expect(DEFAULT_SVG_OPTIONS.removeUnusedIds).toBe(false)
    })
})
