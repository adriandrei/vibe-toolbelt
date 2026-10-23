import { useCallback, useMemo } from 'react'
import { useLocalStorage } from './useLocalStorage'

// Favourite tool paths, shared by every component that uses this hook.
export function useFavorites() {
    const [favorites, setFavorites] = useLocalStorage('vibe-tools-favorites', [])
    const list = useMemo(() => (Array.isArray(favorites) ? favorites : []), [favorites])

    const toggleFavorite = useCallback((path) => {
        setFavorites(prev => {
            const current = Array.isArray(prev) ? prev : []
            return current.includes(path) ? current.filter(p => p !== path) : [...current, path]
        })
    }, [setFavorites])

    const isFavorite = useCallback((path) => list.includes(path), [list])

    return { favorites: list, toggleFavorite, isFavorite }
}
