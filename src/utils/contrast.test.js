import { describe, it, expect } from 'vitest'
import {
    BLACK, CRITERIA, WHITE,
    apcaContrast, composite, effectiveColors, formatRatio, oklchToRgb, pairRatio, parseHex, passes, rgbToOklch, suggestColor,
} from './contrast.js'
import { contrastRatio } from './color.js'

const hex = (h) => parseHex(h)

describe('parseHex', () => {
    it('reads 3, 4, 6 and 8 digit hex exactly', () => {
        expect(parseHex('#6366f1')).toEqual({ r: 99, g: 102, b: 241, a: 1 })
        expect(parseHex('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 128 / 255 })
        expect(parseHex('fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
        expect(parseHex('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 0x88 / 255 })
        expect(parseHex('#12345')).toBeNull()
        expect(parseHex('red')).toBeNull()
        expect(parseHex(null)).toBeNull()
    })
})

describe('WCAG 2.x ratios for known pairs', () => {
    it('black on white is 21:1 and the same colour is 1:1', () => {
        expect(pairRatio(BLACK, WHITE)).toBe(21)
        expect(formatRatio(pairRatio(BLACK, WHITE))).toBe('21.00')
        expect(formatRatio(pairRatio(hex('#336699'), hex('#336699')))).toBe('1.00')
    })

    it('is symmetric', () => {
        expect(pairRatio(hex('#336699'), WHITE)).toBeCloseTo(pairRatio(WHITE, hex('#336699')), 12)
    })

    it('#777 on white is 4.48: fails AA for normal text, passes large text', () => {
        const ratio = pairRatio(hex('#777777'), WHITE)
        expect(formatRatio(ratio)).toBe('4.48')
        expect(passes(ratio, 4.5)).toBe(false)
        expect(passes(ratio, 3)).toBe(true)
    })

    it('#767676 on white is 4.54 and passes AA', () => {
        const ratio = pairRatio(hex('#767676'), WHITE)
        expect(formatRatio(ratio)).toBe('4.54')
        expect(passes(ratio, 4.5)).toBe(true)
        expect(passes(ratio, 7)).toBe(false)
    })

    it('#949494 on white passes 3:1 but #959595 does not', () => {
        expect(formatRatio(pairRatio(hex('#949494'), WHITE))).toBe('3.03')
        expect(passes(pairRatio(hex('#949494'), WHITE), 3)).toBe(true)
        expect(formatRatio(pairRatio(hex('#959595'), WHITE))).toBe('2.99')
        expect(passes(pairRatio(hex('#959595'), WHITE), 3)).toBe(false)
    })

    it('#6366f1 (indigo) on white is 4.47 and fails AA', () => {
        const ratio = pairRatio(hex('#6366f1'), WHITE)
        expect(formatRatio(ratio)).toBe('4.47')
        expect(passes(ratio, 4.5)).toBe(false)
    })

    it('white on #0000ff is 8.59', () => {
        expect(formatRatio(pairRatio(WHITE, hex('#0000ff')))).toBe('8.59')
    })

    it('lists the five WCAG checks with their thresholds', () => {
        expect(CRITERIA.map(c => [c.id, c.min])).toEqual([
            ['normal-aa', 4.5], ['normal-aaa', 7], ['large-aa', 3], ['large-aaa', 4.5], ['ui', 3],
        ])
    })
})

describe('threshold edge cases', () => {
    it('never rounds up across a threshold', () => {
        expect(formatRatio(4.499)).toBe('4.49')
        expect(formatRatio(4.4951)).toBe('4.49')
        expect(formatRatio(2.996)).toBe('2.99')
        expect(formatRatio(6.9999)).toBe('6.99')
        expect(passes(4.499, 4.5)).toBe(false)
        expect(passes(4.4951, 4.5)).toBe(false)
        expect(passes(6.9999, 7)).toBe(false)
    })

    it('rounds normally elsewhere', () => {
        expect(formatRatio(4.5)).toBe('4.50')
        expect(formatRatio(4.506)).toBe('4.51')
        expect(formatRatio(4.478)).toBe('4.48')
        expect(formatRatio(7.004)).toBe('7.00')
        expect(formatRatio(3.0049)).toBe('3.00')
        expect(passes(4.5, 4.5)).toBe(true)
        expect(passes(7, 7)).toBe(true)
    })

    it('the shown value always agrees with pass/fail', () => {
        for (let i = 0; i < 20000; i++) {
            const ratio = 1 + Math.random() * 20
            for (const t of [3, 4.5, 7]) {
                expect(Number(formatRatio(ratio)) >= t).toBe(passes(ratio, t))
            }
        }
    })
})

describe('alpha compositing', () => {
    it('composites a translucent colour over an opaque one', () => {
        expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
        expect(composite({ r: 255, g: 0, b: 0, a: 0.25 }, BLACK)).toEqual({ r: 63.75, g: 0, b: 0, a: 1 })
        expect(composite({ r: 10, g: 20, b: 30, a: 1 }, WHITE)).toEqual({ r: 10, g: 20, b: 30, a: 1 })
        expect(composite({ r: 10, g: 20, b: 30, a: 0 }, WHITE)).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    })

    it('measures translucent text as drawn on the background', () => {
        const ratio = pairRatio({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)
        expect(ratio).toBeCloseTo(contrastRatio({ r: 127.5, g: 127.5, b: 127.5 }, WHITE), 12)
        expect(formatRatio(ratio)).toBe('3.98')
    })

    it('draws a translucent background on the backdrop first', () => {
        const bg = { r: 0, g: 0, b: 0, a: 0.5 }
        const overWhite = effectiveColors(WHITE, bg, WHITE)
        expect(overWhite.bg).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
        const overBlack = effectiveColors(WHITE, bg, BLACK)
        expect(overBlack.bg).toEqual({ r: 0, g: 0, b: 0, a: 1 })
        expect(pairRatio(WHITE, bg, BLACK)).toBe(21)
        expect(formatRatio(pairRatio(WHITE, bg, WHITE))).toBe('3.98')
    })

    it('translucent text on a translucent background uses both', () => {
        const fg = { r: 255, g: 255, b: 255, a: 0.5 }
        const bg = { r: 0, g: 0, b: 0, a: 0.5 }
        const eff = effectiveColors(fg, bg, WHITE)
        // background 127.5 grey, then 50% white over it
        expect(eff.bg.r).toBeCloseTo(127.5, 10)
        expect(eff.fg.r).toBeCloseTo(191.25, 10)
    })
})

describe('OKLCH conversion', () => {
    it('round-trips sRGB colours', () => {
        for (const h of ['#6366f1', '#ff0000', '#00ff00', '#123456', '#777777', '#ffffff', '#000000', '#f0e68c']) {
            const c = hex(h)
            const back = oklchToRgb(rgbToOklch(c))
            expect([back.r, back.g, back.b]).toEqual([c.r, c.g, c.b])
        }
    })

    it('reduces chroma, not lightness or hue, when out of gamut', () => {
        const vivid = rgbToOklch(hex('#ff0000'))
        const light = oklchToRgb({ l: 0.9, c: vivid.c, h: vivid.h })
        const result = rgbToOklch(light)
        expect(result.l).toBeCloseTo(0.9, 2)
        expect(Math.abs(result.h - vivid.h)).toBeLessThan(3)
        expect(result.c).toBeLessThan(vivid.c)
    })

    it('gives black and white at the ends', () => {
        expect(oklchToRgb({ l: 0, c: 0.2, h: 30 })).toEqual({ r: 0, g: 0, b: 0 })
        expect(oklchToRgb({ l: 1, c: 0.2, h: 30 })).toEqual({ r: 255, g: 255, b: 255 })
    })
})

describe('suggestions', () => {
    const check = (fg, bg, target, adjust, backdrop = WHITE) => {
        const s = suggestColor({ fg, bg, backdrop, target, adjust })
        expect(s.status).toBe('found')
        const color = hex(s.color)
        const ratio = adjust === 'fg' ? pairRatio(color, bg, backdrop) : pairRatio(fg, color, backdrop)
        expect(passes(ratio, target)).toBe(true)
        expect(ratio).toBeCloseTo(s.ratio, 10)
        return { s, color }
    }

    it('says when the pair already passes', () => {
        expect(suggestColor({ fg: BLACK, bg: WHITE, target: 7, adjust: 'fg' }).status).toBe('passes')
    })

    it('finds the nearest text colour for AA and AAA and keeps the hue', () => {
        const indigo = hex('#6366f1')
        for (const target of [4.5, 7]) {
            const { s, color } = check(indigo, WHITE, target, 'fg')
            expect(s.direction).toBe('darker')
            const a = rgbToOklch(indigo)
            const b = rgbToOklch(color)
            expect(Math.abs(a.h - b.h)).toBeLessThan(4)
            expect(b.l).toBeLessThan(a.l)
            // Only just over the line: nothing much darker than needed
            expect(s.ratio).toBeLessThan(target + 0.2)
        }
    })

    it('#777 on white for AA becomes a slightly darker grey', () => {
        const { color } = check(hex('#777777'), WHITE, 4.5, 'fg')
        expect(color.r).toBe(color.g)
        expect(color.g).toBe(color.b)
        expect(color.r).toBe(0x76)
    })

    it('lightens text on a dark background', () => {
        const { s } = check(hex('#555555'), hex('#202020'), 4.5, 'fg')
        expect(s.direction).toBe('lighter')
    })

    it('adjusts the background instead when asked', () => {
        const fg = hex('#ffffff')
        const bg = hex('#3b82f6')
        for (const target of [4.5, 7]) {
            const { s, color } = check(fg, bg, target, 'bg')
            expect(s.direction).toBe('darker')
            expect(Math.abs(rgbToOklch(bg).h - rgbToOklch(color).h)).toBeLessThan(4)
        }
    })

    it('keeps the alpha of translucent text when a lightness gets there', () => {
        // #828282 at 90% over white is 3.26:1
        const fg = { r: 130, g: 130, b: 130, a: 230 / 255 }
        expect(passes(pairRatio(fg, WHITE), 4.5)).toBe(false)
        const s = suggestColor({ fg, bg: WHITE, target: 4.5, adjust: 'fg' })
        expect(s.status).toBe('found')
        expect(s.opaque).toBe(false)
        expect(s.color).toMatch(/^#[0-9a-f]{6}e6$/)
        expect(passes(pairRatio(hex(s.color), WHITE), 4.5)).toBe(true)
    })

    it('makes translucent text opaque when no lightness is enough', () => {
        // 50% black over white is at best 3.98:1
        const faint = { r: 0, g: 0, b: 0, a: 0.5 }
        const s = suggestColor({ fg: faint, bg: WHITE, target: 4.5, adjust: 'fg' })
        expect(s.status).toBe('found')
        expect(s.opaque).toBe(true)
        expect(s.color).toMatch(/^#[0-9a-f]{6}$/)
        expect(passes(pairRatio(hex(s.color), WHITE), 4.5)).toBe(true)
    })

    it('reports unreachable targets with the best possible colour', () => {
        // Mid grey: neither black (5.32:1) nor white (3.95:1) reaches 7:1
        const grey = hex('#808080')
        const s = suggestColor({ fg: hex('#999999'), bg: grey, target: 7, adjust: 'fg' })
        expect(s.status).toBe('unreachable')
        expect(s.best.color).toBe('#000000')
        expect(formatRatio(s.best.ratio)).toBe('5.32')
    })

    it('suggestions pass for many random pairs', () => {
        let seed = 7
        const rand = () => {
            seed = (seed * 16807) % 2147483647
            return seed / 2147483647
        }
        const randomColor = () => ({ r: Math.floor(rand() * 256), g: Math.floor(rand() * 256), b: Math.floor(rand() * 256), a: 1 })
        for (let i = 0; i < 150; i++) {
            const fg = randomColor()
            const bg = randomColor()
            for (const target of [4.5, 7]) {
                for (const adjust of ['fg', 'bg']) {
                    const s = suggestColor({ fg, bg, target, adjust })
                    if (s.status === 'found') {
                        const color = hex(s.color)
                        const ratio = adjust === 'fg' ? pairRatio(color, bg) : pairRatio(fg, color)
                        expect(passes(ratio, target)).toBe(true)
                    } else if (s.status === 'unreachable') {
                        expect(passes(s.best.ratio, target)).toBe(false)
                    }
                }
            }
        }
    })
})

describe('APCA (draft)', () => {
    it('matches the reference values', () => {
        expect(apcaContrast(BLACK, WHITE)).toBeCloseTo(106.04, 1)
        expect(apcaContrast(WHITE, BLACK)).toBeCloseTo(-107.88, 1)
        expect(apcaContrast(hex('#888888'), WHITE)).toBeCloseTo(63.06, 1)
    })

    it('is zero for the same colour', () => {
        expect(apcaContrast(hex('#336699'), hex('#336699'))).toBe(0)
    })
})
