import React, { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext(null)

export const COLOR_PRESETS = [
    { name: 'Indigo Vibe', hue: 250, color: 'hsl(250, 90%, 65%)' },
    { name: 'Emerald Mint', hue: 145, color: 'hsl(145, 80%, 50%)' },
    { name: 'Amber Glow', hue: 35, color: 'hsl(35, 90%, 55%)' },
    { name: 'Crimson Rose', hue: 340, color: 'hsl(340, 85%, 60%)' },
    { name: 'Cyber Blue', hue: 200, color: 'hsl(200, 90%, 55%)' },
    { name: 'Amethyst', hue: 280, color: 'hsl(280, 85%, 65%)' }
]

export function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(() => {
        return localStorage.getItem('pt-theme') || 'dark'
    })

    const [hue, setHue] = useState(() => {
        const saved = localStorage.getItem('pt-hue')
        return saved ? parseInt(saved, 10) : 250
    })

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
        localStorage.setItem('pt-theme', theme)
    }, [theme])

    useEffect(() => {
        document.documentElement.style.setProperty('--hue', hue)
        localStorage.setItem('pt-hue', hue.toString())
    }, [hue])

    const toggle = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark')

    return (
        <ThemeContext.Provider value={{ theme, toggle, hue, setHue }}>
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme() {
    const ctx = useContext(ThemeContext)
    if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
    return ctx
}
