import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'vibe-toolbelt-history'
const MAX_HISTORY_ITEMS = 50

/**
 * Custom hook for managing operation history with LocalStorage persistence.
 * Supports incognito mode to disable persistence.
 * 
 * @returns {Object} History state and methods
 */
export function useHistory() {
    const [history, setHistory] = useState([])
    const [incognitoMode, setIncognitoMode] = useState(() => {
        try {
            return localStorage.getItem('vibe-toolbelt-incognito') === 'true'
        } catch {
            return false
        }
    })

    // Load history from localStorage on mount
    useEffect(() => {
        if (incognitoMode) {
            setHistory([])
            return
        }

        try {
            const stored = localStorage.getItem(STORAGE_KEY)
            if (stored) {
                const parsed = JSON.parse(stored)
                if (Array.isArray(parsed)) {
                    setHistory(parsed)
                }
            }
        } catch (e) {
            console.warn('Failed to load history:', e)
            setHistory([])
        }
    }, [incognitoMode])

    // Persist history changes to localStorage
    useEffect(() => {
        if (incognitoMode) return

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
        } catch (e) {
            console.warn('Failed to save history:', e)
        }
    }, [history, incognitoMode])

    /**
     * Add an operation to history
     * @param {Object} entry - History entry
     * @param {string} entry.tool - Tool name (e.g., 'base64', 'hash', 'jwt')
     * @param {string} entry.action - Action performed (e.g., 'encode', 'decode', 'verify')
     * @param {string} entry.inputPreview - Truncated input preview
     * @param {string} entry.outputPreview - Truncated output preview
     */
    const addEntry = useCallback((entry) => {
        if (incognitoMode) return

        const newEntry = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            ...entry,
            inputPreview: entry.inputPreview?.slice(0, 100) || '',
            outputPreview: entry.outputPreview?.slice(0, 100) || ''
        }

        setHistory(prev => {
            const updated = [newEntry, ...prev].slice(0, MAX_HISTORY_ITEMS)
            return updated
        })
    }, [incognitoMode])

    /**
     * Clear all history
     */
    const clearHistory = useCallback(() => {
        setHistory([])
        try {
            localStorage.removeItem(STORAGE_KEY)
        } catch (e) {
            console.warn('Failed to clear history:', e)
        }
    }, [])

    /**
     * Remove a specific entry by ID
     */
    const removeEntry = useCallback((id) => {
        setHistory(prev => prev.filter(item => item.id !== id))
    }, [])

    /**
     * Toggle incognito mode
     */
    const toggleIncognito = useCallback(() => {
        setIncognitoMode(prev => {
            const newValue = !prev
            try {
                localStorage.setItem('vibe-toolbelt-incognito', String(newValue))
                if (newValue) {
                    // Clear history when entering incognito
                    localStorage.removeItem(STORAGE_KEY)
                }
            } catch (e) {
                console.warn('Failed to save incognito state:', e)
            }
            return newValue
        })
        if (!incognitoMode) {
            setHistory([])
        }
    }, [incognitoMode])

    return {
        history,
        incognitoMode,
        addEntry,
        clearHistory,
        removeEntry,
        toggleIncognito
    }
}

/**
 * Format relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(isoString) {
    const date = new Date(isoString)
    const now = new Date()
    const diff = Math.floor((now - date) / 1000) // seconds

    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`

    return date.toLocaleDateString()
}
