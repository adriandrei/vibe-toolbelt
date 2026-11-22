// parseColor / isValidColor / normalizeColor depend on a canvas 2D context
// (and CSS.supports) and can't run in Node: they are covered by the browser
// suite. The pure conversion and WCAG maths are tested here.
import { describe, expect, it } from 'vitest'
import { contrastRatio, luminance, parseColor, toHex, toRgbString } from './color'

describe('parseColor input guards (no canvas needed)', () => {
    it('returns null for non-strings and blank strings', () => {
        expect(parseColor(undefined)).toBeNull()
        expect(parseColor(42)).toBeNull()
        expect(parseColor('   ')).toBeNull()
    })
})

describe('toHex', () => {
    it('formats and pads', () => {
        expect(toHex({ r: 0, g: 15, b: 255 })).toBe('#000fff')
        expect(toHex({ r: 255, g: 128, b: 1 })).toBe('#ff8001')
    })
    it('adds an alpha byte only when alpha < 1 and requested', () => {
        expect(toHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080')
        expect(toHex({ r: 255, g: 0, b: 0, a: 0.5 }, false)).toBe('#ff0000')
        expect(toHex({ r: 255, g: 0, b: 0, a: 1 })).toBe('#ff0000')
        expect(toHex({ r: 255, g: 0, b: 0, a: 0 })).toBe('#ff000000')
    })
    it('rounds and clamps out-of-range channels', () => {
        expect(toHex({ r: 300, g: -5, b: 127.6 })).toBe('#ff0080')
    })
})

describe('toRgbString', () => {
    it('uses rgb() when opaque and rgba() otherwise', () => {
        expect(toRgbString({ r: 1, g: 2, b: 3 })).toBe('rgb(1, 2, 3)')
        expect(toRgbString({ r: 1.4, g: 2.6, b: 3, a: 1 })).toBe('rgb(1, 3, 3)')
        expect(toRgbString({ r: 1, g: 2, b: 3, a: 0.12345 })).toBe('rgba(1, 2, 3, 0.123)')
    })
})

describe('luminance and contrastRatio (WCAG 2.x)', () => {
    const black = { r: 0, g: 0, b: 0 }
    const white = { r: 255, g: 255, b: 255 }
    it('has the expected endpoints and primaries', () => {
        expect(luminance(black)).toBe(0)
        expect(luminance(white)).toBeCloseTo(1, 10)
        expect(luminance({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.2126, 10)
        expect(luminance({ r: 0, g: 255, b: 0 })).toBeCloseTo(0.7152, 10)
        expect(luminance({ r: 0, g: 0, b: 255 })).toBeCloseTo(0.0722, 10)
    })
    it('matches an independent sRGB linearisation for a mid grey', () => {
        // 119/255 = 0.4667; ((0.4667+0.055)/1.055)^2.4 = 0.18447
        expect(luminance({ r: 119, g: 119, b: 119 })).toBeCloseTo(0.18447, 4)
    })
    it('gives 21:1 for black on white, symmetric', () => {
        expect(contrastRatio(black, white)).toBeCloseTo(21, 10)
        expect(contrastRatio(white, black)).toBeCloseTo(21, 10)
    })
    it('gives 1:1 for identical colours', () => {
        expect(contrastRatio({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 })).toBe(1)
    })
    it('matches the well-known #767676 on white value (4.54:1)', () => {
        expect(contrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, white)).toBeCloseTo(4.54, 2)
    })
    it('matches #777777 on white (4.48:1, just failing AA)', () => {
        expect(contrastRatio({ r: 0x77, g: 0x77, b: 0x77 }, white)).toBeCloseTo(4.48, 2)
    })
})
