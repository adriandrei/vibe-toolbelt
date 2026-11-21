import { useCallback, useMemo } from 'react'
import { useLocalStorage } from './useLocalStorage'

const MAX_RECENTS = 8

// Recently opened tool paths, newest first, shared by every component that uses
// this hook (Layout records visits; the palette and Home list them).
export function useRecents() {
    const [recents, setRecents] = useLocalStorage('vibe-tools-recents', [])
    const list = useMemo(() => (Array.isArray(recents) ? recents.filter(p => typeof p === 'string') : []), [recents])

    const recordVisit = useCallback((path) => {
        setRecents(prev => {
            const current = Array.isArray(prev) ? prev : []
            if (current[0] === path) return prev
            return [path, ...current.filter(p => p !== path)].slice(0, MAX_RECENTS)
        })
    }, [setRecents])

    return { recents: list, recordVisit }
}
