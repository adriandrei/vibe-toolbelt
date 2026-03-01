import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Command, CornerDownLeft, Sparkles, ArrowRight } from 'lucide-react'
import { TOOL_CATEGORIES } from './Sidebar'
import { analyzeContent } from '../utils/analyzers'

export default function CommandPalette({ isOpen, onClose }) {
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [suggestion, setSuggestion] = useState(null)
    const inputRef = useRef(null)
    const navigate = useNavigate()

    // Flatten all items for search
    const allItems = TOOL_CATEGORIES.flatMap(cat =>
        cat.items.map(item => ({ ...item, category: cat.name }))
    )

    const filteredItems = allItems.filter(item =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.category.toLowerCase().includes(query.toLowerCase())
    )

    // Analyze content for smart suggestions
    useEffect(() => {
        if (!query) {
            setSuggestion(null)
            return
        }
        const result = analyzeContent(query)
        setSuggestion(result)
    }, [query])

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus()
            setQuery('')
            setSelectedIndex(0)
        }
    }, [isOpen])

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return

        const handleKeyDown = (e) => {
            const totalItems = filteredItems.length + (suggestion ? 1 : 0)

            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex(prev => (prev + 1) % totalItems)
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex(prev => (prev - 1 + totalItems) % totalItems)
            } else if (e.key === 'Enter') {
                e.preventDefault()

                // Handle Suggestion Selection (Index 0 if exists)
                if (suggestion && selectedIndex === 0) {
                    navigate(suggestion.tool, { state: { input: query } })
                    onClose()
                    return
                }

                // Handle List Selection
                const listIndex = suggestion ? selectedIndex - 1 : selectedIndex
                if (filteredItems[listIndex]) {
                    navigate(filteredItems[listIndex].to, { state: { input: query } })
                    onClose()
                }
            } else if (e.key === 'Escape') {
                onClose()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, filteredItems, selectedIndex, navigate, onClose, suggestion])

    if (!isOpen) return null

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '15vh'
        }} onClick={onClose}>
            <div
                className="glass-panel"
                style={{
                    width: '100%',
                    maxWidth: '600px',
                    maxHeight: '400px',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                    overflow: 'hidden'
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Search Input */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-md)',
                    padding: 'var(--space-md)',
                    borderBottom: '1px solid var(--border)'
                }}>
                    <Search size={20} color="var(--text-muted)" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                        placeholder="Type to search or paste content (JWT, Base64, JSON)..."
                        style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            fontSize: '1.2rem',
                            boxShadow: 'none',
                            outline: 'none',
                            width: '100%',
                            color: 'var(--text-main)'
                        }}
                    />
                    <div style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        background: 'var(--border)',
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)'
                    }}>ESC</div>
                </div>

                {/* Results */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-xs)' }}>

                    {/* Smart Suggestion */}
                    {suggestion && (
                        <div
                            onClick={() => { navigate(suggestion.tool, { state: { input: query } }); onClose(); }}
                            onMouseEnter={() => setSelectedIndex(0)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-md)',
                                padding: 'var(--space-md)',
                                borderRadius: 'var(--radius-md)',
                                background: selectedIndex === 0 ? 'var(--primary)' : 'rgba(var(--primary-rgb), 0.1)',
                                color: selectedIndex === 0 ? '#fff' : 'var(--primary)',
                                cursor: 'pointer',
                                transition: 'all 0.1s',
                                marginBottom: 'var(--space-xs)',
                                border: '1px solid var(--primary)'
                            }}
                        >
                            <Sparkles size={20} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600 }}>Detected {suggestion.label}</div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>Press Enter to open tool</div>
                            </div>
                            <ArrowRight size={16} />
                        </div>
                    )}

                    {filteredItems.length === 0 && !suggestion ? (
                        <div style={{ padding: 'var(--space-lg)', textAlign: 'center', color: 'var(--text-muted)' }}>
                            No tools found matching "{query}"
                        </div>
                    ) : (
                        filteredItems.map((item, index) => {
                            const actualIndex = suggestion ? index + 1 : index;
                            return (
                                <div
                                    key={item.to}
                                    onClick={() => { navigate(item.to, { state: { input: query } }); onClose(); }}
                                    onMouseEnter={() => setSelectedIndex(actualIndex)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-md)',
                                        padding: 'var(--space-md)',
                                        borderRadius: 'var(--radius-md)',
                                        background: actualIndex === selectedIndex ? 'var(--primary)' : 'transparent',
                                        color: actualIndex === selectedIndex ? '#fff' : 'var(--text-main)',
                                        cursor: 'pointer',
                                        transition: 'all 0.1s'
                                    }}
                                >
                                    <item.icon size={20} style={{ opacity: actualIndex === selectedIndex ? 1 : 0.7 }} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 500 }}>{item.label}</div>
                                        <div style={{ fontSize: '0.8rem', opacity: 0.7, textTransform: 'uppercase' }}>{item.category}</div>
                                    </div>
                                    {actualIndex === selectedIndex && <CornerDownLeft size={16} />}
                                </div>
                            )
                        })
                    )}
                </div>
            </div>
        </div>
    )
}
