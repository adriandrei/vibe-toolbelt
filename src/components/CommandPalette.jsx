import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Command, CornerDownLeft } from 'lucide-react'
import { TOOL_CATEGORIES } from './Sidebar'

export default function CommandPalette({ isOpen, onClose }) {
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
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
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex(prev => (prev + 1) % filteredItems.length)
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex(prev => (prev - 1 + filteredItems.length) % filteredItems.length)
            } else if (e.key === 'Enter') {
                e.preventDefault()
                if (filteredItems[selectedIndex]) {
                    navigate(filteredItems[selectedIndex].to)
                    onClose()
                }
            } else if (e.key === 'Escape') {
                onClose()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, filteredItems, selectedIndex, navigate, onClose])

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
                        placeholder="Search tools..."
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
                    {filteredItems.length === 0 ? (
                        <div style={{ padding: 'var(--space-lg)', textAlign: 'center', color: 'var(--text-muted)' }}>
                            No tools found matching "{query}"
                        </div>
                    ) : (
                        filteredItems.map((item, index) => (
                            <div
                                key={item.to}
                                onClick={() => { navigate(item.to); onClose(); }}
                                onMouseEnter={() => setSelectedIndex(index)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-md)',
                                    padding: 'var(--space-md)',
                                    borderRadius: 'var(--radius-md)',
                                    background: index === selectedIndex ? 'var(--primary)' : 'transparent',
                                    color: index === selectedIndex ? '#fff' : 'var(--text-main)',
                                    cursor: 'pointer',
                                    transition: 'all 0.1s'
                                }}
                            >
                                <item.icon size={20} style={{ opacity: index === selectedIndex ? 1 : 0.7 }} />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 500 }}>{item.label}</div>
                                    <div style={{ fontSize: '0.8rem', opacity: 0.7, textTransform: 'uppercase' }}>{item.category}</div>
                                </div>
                                {index === selectedIndex && <CornerDownLeft size={16} />}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
