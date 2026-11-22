import { describe, expect, it, vi } from 'vitest'
import { openInTool, smartState } from './smartNav'

describe('smartState', () => {
    it('marks the state as smart and keeps input, mode and extras', () => {
        expect(smartState({ input: 'abc', mode: 'decode', extra: 1 })).toEqual({ smart: true, input: 'abc', mode: 'decode', extra: 1 })
    })
    it('works without arguments', () => {
        expect(smartState()).toEqual({ smart: true, input: undefined, mode: undefined })
    })
})

describe('openInTool', () => {
    it('navigates to the path with smart state', () => {
        const navigate = vi.fn()
        openInTool(navigate, '/base64', { input: 'SGk=', mode: 'decode' })
        expect(navigate).toHaveBeenCalledOnce()
        expect(navigate).toHaveBeenCalledWith('/base64', { state: { smart: true, input: 'SGk=', mode: 'decode' } })
    })
    it('defaults to an empty payload', () => {
        const navigate = vi.fn()
        openInTool(navigate, '/jwt')
        expect(navigate).toHaveBeenCalledWith('/jwt', { state: { smart: true, input: undefined, mode: undefined } })
    })
})
