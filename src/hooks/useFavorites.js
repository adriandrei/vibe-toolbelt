import { useState, useEffect } from 'react'

export function useFavorites() {
    const [favorites, setFavorites] = useState(() => {
        try {
            const stored = localStorage.getItem('vibe-tools-favorites')
            return stored ? JSON.parse(stored) : []
        } catch (e) {
            return []
        }
    })

    useEffect(() => {
        localStorage.setItem('vibe-tools-favorites', JSON.stringify(favorites))
    }, [favorites])

    const toggleFavorite = (path) => {
        setFavorites(prev => {
            if (prev.includes(path)) {
                return prev.filter(p => p !== path)
            } else {
                return [...prev, path]
            }
        })
    }

    const isFavorite = (path) => favorites.includes(path)

    return { favorites, toggleFavorite, isFavorite }
}
