import { describe, expect, it } from 'vitest'
import { SETGID, SETUID, STICKY, applySymbolic, formatChmodExpression, formatOctal, formatSymbolic, parseModeInput } from './chmod'

describe('formatOctal', () => {
    it.each([
        [0o755, '755'], [0o644, '644'], [0, '000'], [0o7, '007'], [0o4755, '4755'], [0o1777, '1777'], [0o2750, '2750'], [0o7777, '7777'],
    ])('%o', (mode, expected) => expect(formatOctal(mode)).toBe(expected))
})

describe('formatSymbolic', () => {
    it.each([
        [0o755, 'rwxr-xr-x'], [0o644, 'rw-r--r--'], [0, '---------'], [0o777, 'rwxrwxrwx'],
        [0o4755, 'rwsr-xr-x'], [0o4644, 'rwSr--r--'], [0o2755, 'rwxr-sr-x'], [0o2745, 'rwxr-Sr-x'],
        [0o1777, 'rwxrwxrwt'], [0o1776, 'rwxrwxrwT'], [0o7777, 'rwsrwsrwt'],
    ])('%o', (mode, expected) => expect(formatSymbolic(mode)).toBe(expected))
})

describe('formatChmodExpression', () => {
    it('lists permissions per class, including special bits', () => {
        expect(formatChmodExpression(0o755)).toBe('u=rwx,g=rx,o=rx')
        expect(formatChmodExpression(0o640)).toBe('u=rw,g=r,o=')
        expect(formatChmodExpression(0o4755)).toBe('u=rwxs,g=rx,o=rx')
        expect(formatChmodExpression(0o1777)).toBe('u=rwx,g=rwx,o=rwxt')
    })
    it('round-trips through applySymbolic from mode 0', () => {
        for (const mode of [0, 0o644, 0o755, 0o4755, 0o2770, 0o1777, 0o7777]) {
            expect(applySymbolic(0, formatChmodExpression(mode))).toBe(mode)
        }
    })
})

describe('applySymbolic', () => {
    it('adds, removes and sets bits', () => {
        expect(applySymbolic(0o644, 'u+x')).toBe(0o744)
        expect(applySymbolic(0o777, 'go-w')).toBe(0o755)
        expect(applySymbolic(0o755, 'a=r')).toBe(0o444)
        expect(applySymbolic(0o755, 'o=')).toBe(0o750)
        expect(applySymbolic(0o600, 'a+r')).toBe(0o644)
    })
    it('treats a missing "who" as all (no umask)', () => {
        expect(applySymbolic(0o000, '+x')).toBe(0o111)
        expect(applySymbolic(0o777, '-w')).toBe(0o555)
    })
    it('supports comma-separated clauses and chained operators', () => {
        expect(applySymbolic(0, 'u=rwx,g=rx,o=')).toBe(0o750)
        expect(applySymbolic(0o777, 'u-x+r')).toBe(0o677)
        expect(applySymbolic(0o700, 'g=u')).toBe(0o770)
        expect(applySymbolic(0o750, 'o+g')).toBe(0o755)
    })
    it('capital X only sets execute on directories or when some x is already set', () => {
        expect(applySymbolic(0o644, 'a+X')).toBe(0o644)
        expect(applySymbolic(0o644, 'a+X', { isDirectory: true })).toBe(0o755)
        expect(applySymbolic(0o744, 'a+X')).toBe(0o755)
    })
    it('handles setuid, setgid and sticky', () => {
        expect(applySymbolic(0o755, 'u+s')).toBe(0o4755)
        expect(applySymbolic(0o755, 'g+s')).toBe(0o2755)
        expect(applySymbolic(0o777, 'o+t')).toBe(0o1777)
        expect(applySymbolic(0o4755, 'u-s')).toBe(0o755)
        expect(applySymbolic(0o755, 'a+s')).toBe(0o6755) // s applies to u and g only
        expect(applySymbolic(0o755, 'o+s')).toBe(0o755)
    })
    it('"=" keeps a directory\'s setuid/setgid unless named (GNU rule)', () => {
        expect(applySymbolic(0o2755, 'g=rx', { isDirectory: true })).toBe(0o2755)
        expect(applySymbolic(0o2755, 'g=rx')).toBe(0o755)
        expect(applySymbolic(0o2755, 'g=rxs', { isDirectory: true })).toBe(0o2755)
    })
    it('rejects invalid clauses with a readable message', () => {
        expect(() => applySymbolic(0o644, 'u+q')).toThrow('“u+q” isn’t a valid chmod clause')
        expect(() => applySymbolic(0o644, '')).toThrow('“(empty)”')
        expect(() => applySymbolic(0o644, 'u+x,,g+r')).toThrow(/valid chmod clause/)
        expect(() => applySymbolic(0o644, 'rwx')).toThrow(/valid chmod clause/)
    })
})

describe('parseModeInput', () => {
    it('parses octal', () => {
        expect(parseModeInput('755')).toEqual({ kind: 'octal', mode: 0o755 })
        expect(parseModeInput(' 0644 ')).toEqual({ kind: 'octal', mode: 0o644 })
        expect(parseModeInput('4755')).toEqual({ kind: 'octal', mode: 0o4755 })
        expect(parseModeInput('7')).toEqual({ kind: 'octal', mode: 7 })
    })
    it('reports octal errors', () => {
        expect(parseModeInput('789').error).toMatch(/Octal digits are 0–7, so “8”/)
        expect(parseModeInput('75500').error).toMatch(/at most 4 digits/)
    })
    it('parses ls-style strings, with and without the file type', () => {
        expect(parseModeInput('rwxr-xr-x')).toEqual({ kind: 'symbolic', mode: 0o755, type: undefined })
        expect(parseModeInput('drwxr-xr-x')).toEqual({ kind: 'symbolic', mode: 0o755, type: 'd' })
        expect(parseModeInput('-rwsr-xr-t')).toMatchObject({ mode: 0o5755 })
        expect(parseModeInput('rwSr--r-T')).toMatchObject({ mode: 0o5644 })
        expect(parseModeInput('rwxrwxrwx').mode).toBe(0o777)
    })
    it('parses relative expressions against the current mode', () => {
        expect(parseModeInput('u+x', 0o644)).toEqual({ kind: 'relative', mode: 0o744 })
        expect(parseModeInput('go-rwx', 0o755)).toEqual({ kind: 'relative', mode: 0o700 })
        expect(parseModeInput('+x', 0o644, { isDirectory: false }).mode).toBe(0o755)
        expect(parseModeInput('u+q', 0o644).error).toMatch(/valid chmod clause/)
    })
    it('returns null for empty input and guidance otherwise', () => {
        expect(parseModeInput('')).toBeNull()
        expect(parseModeInput('   ')).toBeNull()
        expect(parseModeInput(undefined)).toBeNull()
        expect(parseModeInput('banana').error).toMatch(/Use octal \(755\)/)
        expect(parseModeInput('rwxr-x').error).toMatch(/9 characters/)
    })
})

describe('constants', () => {
    it('are the standard special-bit values', () => {
        expect([SETUID, SETGID, STICKY]).toEqual([2048, 1024, 512])
    })
})
