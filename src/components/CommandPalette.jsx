import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft, Sparkles, ArrowRight } from 'lucide-react'
import { TOOL_CATEGORIES } from './Sidebar'
import { analyzeContent } from '../utils/analyzers'
import { motion, AnimatePresence } from 'framer-motion'

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
            setTimeout(() => {
                if (inputRef.current) inputRef.current.focus()
            }, 100) // Small delay for framer-motion entrance
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

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 100,
                        background: 'rgba(0,0,0,0.6)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        paddingTop: '15vh'
                    }} 
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, y: -20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        className="glass-panel"
                        style={{
                            width: '100%',
                            maxWidth: '650px',
                            maxHeight: '500px',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                            overflow: 'hidden',
                            borderRadius: '16px',
                            border: '1px solid rgba(139, 92, 246, 0.3)',
                            background: 'var(--bg-panel)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Search Input */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-md)',
                            padding: '20px',
                            borderBottom: '1px solid var(--border)',
                            background: 'rgba(0,0,0,0.2)'
                        }}>
                            <Search size={24} color="var(--primary)" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                                placeholder="Type a command or paste data (e.g. JWT, JSON)..."
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    padding: 0,
                                    fontSize: '1.2rem',
                                    boxShadow: 'none',
                                    outline: 'none',
                                    width: '100%',
                                    color: 'var(--text-main)',
                                    fontWeight: 500
                                }}
                            />
                            <div style={{
                                padding: '4px 8px',
                                borderRadius: '6px',
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border)',
                                fontSize: '0.8rem',
                                color: 'var(--text-muted)',
                                fontWeight: 600
                            }}>ESC</div>
                        </div>

                        {/* Results */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                            {/* Smart Suggestion */}
                            {suggestion && (
                                <div
                                    onClick={() => { navigate(suggestion.tool, { state: { input: query } }); onClose(); }}
                                    onMouseEnter={() => setSelectedIndex(0)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-md)',
                                        padding: '16px',
                                        borderRadius: '12px',
                                        background: selectedIndex === 0 ? 'var(--primary)' : 'rgba(var(--primary-rgb), 0.1)',
                                        color: selectedIndex === 0 ? '#fff' : 'var(--primary)',
                                        cursor: 'pointer',
                                        transition: 'all 0.1s',
                                        marginBottom: '12px',
                                        border: '1px solid',
                                        borderColor: selectedIndex === 0 ? 'var(--primary)' : 'rgba(139, 92, 246, 0.3)'
                                    }}
                                >
                                    <Sparkles size={24} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>Detected {suggestion.label}</div>
                                        <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Press Enter to open tool securely</div>
                                    </div>
                                    <ArrowRight size={20} />
                                </div>
                            )}

                            {filteredItems.length === 0 && !suggestion ? (
                                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                    <Search size={40} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                                    <div style={{ fontSize: '1.1rem' }}>No tools found matching "{query}"</div>
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
                                                padding: '12px 16px',
                                                borderRadius: '10px',
                                                background: actualIndex === selectedIndex ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
                                                color: actualIndex === selectedIndex ? 'var(--primary)' : 'var(--text-main)',
                                                cursor: 'pointer',
                                                transition: 'all 0.1s',
                                                border: '1px solid',
                                                borderColor: actualIndex === selectedIndex ? 'rgba(139, 92, 246, 0.3)' : 'transparent'
                                            }}
                                        >
                                            <item.icon size={20} style={{ color: actualIndex === selectedIndex ? 'var(--primary)' : 'var(--text-muted)' }} />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 600 }}>{item.label}</div>
                                                <div style={{ fontSize: '0.75rem', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '2px' }}>{item.category}</div>
                                            </div>
                                            {actualIndex === selectedIndex && <CornerDownLeft size={16} />}
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
