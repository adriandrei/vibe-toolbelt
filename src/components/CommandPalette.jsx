import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion as Motion } from 'framer-motion'
import { ArrowRight, CornerDownLeft, ScanSearch, Search, Sparkles } from 'lucide-react'
import { ALL_TOOLS, getTool, searchTools } from '../config/tools'
import { detectFormats } from '../utils/detect'
import { openInTool } from '../utils/smartNav'

const MAX_RESULTS = 40

export default function CommandPalette({ isOpen, onClose }) {
    return (
        <AnimatePresence>
            {isOpen && <PaletteDialog onClose={onClose} />}
        </AnimatePresence>
    )
}

function PaletteDialog({ onClose }) {
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const inputRef = useRef(null)
    const listRef = useRef(null)
    const navigate = useNavigate()
    const listboxId = useId()

    // Focus before the browser paints, so the first keystrokes aren't lost
    useLayoutEffect(() => {
        inputRef.current?.focus()
    }, [])

    useEffect(() => {
        const previous = document.activeElement
        return () => {
            if (previous && typeof previous.focus === 'function') previous.focus()
        }
    }, [])

    // Detected content: open the right tool with it, or inspect it
    const suggestions = useMemo(() => {
        const trimmed = query.trim()
        if (trimmed.length < 3) return []
        const detected = detectFormats(trimmed).filter(c => c.confidence >= 0.6)
        const items = []
        const seenTools = new Set()
        for (const c of detected) {
            if (seenTools.has(c.tool) || items.length >= 2) continue
            seenTools.add(c.tool)
            const tool = getTool(c.tool)
            items.push({ kind: 'smart', key: `smart-${c.id}`, label: `Open as ${c.label}`, sub: `in ${tool?.title ?? c.tool}`, tool: c.tool, mode: c.mode, icon: Sparkles })
        }
        if (detected.length && !seenTools.has('/inspect')) {
            items.push({ kind: 'smart', key: 'smart-inspect', label: 'Inspect this text', sub: 'in Universal Inspector', tool: '/inspect', icon: ScanSearch })
        }
        return items
    }, [query])

    const results = useMemo(() => {
        const matches = query.trim() ? searchTools(query) : ALL_TOOLS
        return matches.slice(0, MAX_RESULTS).map(tool => ({ kind: 'tool', key: tool.path, tool }))
    }, [query])

    const items = useMemo(() => [...suggestions, ...results], [suggestions, results])
    const activeIndex = items.length ? Math.min(selectedIndex, items.length - 1) : -1

    // Keep the highlighted option visible
    useEffect(() => {
        if (activeIndex < 0) return
        const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`)
        el?.scrollIntoView({ block: 'nearest' })
    }, [activeIndex])

    const choose = (item) => {
        if (!item) return
        if (item.kind === 'smart') openInTool(navigate, item.tool, { input: query, mode: item.mode })
        else navigate(item.tool.path)
        onClose()
    }

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (items.length) setSelectedIndex((activeIndex + 1) % items.length)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (items.length) setSelectedIndex((activeIndex - 1 + items.length) % items.length)
        } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(items[activeIndex])
        } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
        } else if (e.key === 'Tab') {
            e.preventDefault()
        }
    }

    const optionId = (i) => `${listboxId}-opt-${i}`

    return (
        <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 100,
                background: 'var(--overlay)',
                backdropFilter: 'blur(6px)',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                padding: '12vh 12px 12px',
            }}
        >
            <Motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Search tools"
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                style={{
                    width: '100%',
                    maxWidth: 640,
                    maxHeight: 'min(560px, 76vh)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    borderRadius: 16,
                    border: '1px solid var(--primary-border)',
                    background: 'var(--bg-elevated)',
                    boxShadow: 'var(--shadow-lg)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
                    <Search size={20} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                    <input
                        ref={inputRef}
                        type="text"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls={listboxId}
                        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                        aria-autocomplete="list"
                        value={query}
                        onChange={e => {
                            setQuery(e.target.value)
                            setSelectedIndex(0)
                        }}
                        onKeyDown={onKeyDown}
                        placeholder="Search tools, or paste a JWT, JSON, timestamp…"
                        spellCheck={false}
                        autoComplete="off"
                        style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            fontSize: '1.1rem',
                            boxShadow: 'none',
                            outline: 'none',
                            color: 'var(--text-main)',
                            fontWeight: 500,
                            fontFamily: 'inherit',
                        }}
                    />
                    <button type="button" className="kbd" onClick={onClose} aria-label="Close search" style={{ cursor: 'pointer' }}>Esc</button>
                </div>

                <div ref={listRef} id={listboxId} role="listbox" aria-label="Results" style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                    {items.length === 0 && (
                        <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            No tools match “{query}”
                        </div>
                    )}
                    {items.map((item, index) => {
                        const active = index === activeIndex
                        const Icon = item.kind === 'smart' ? item.icon : item.tool.icon
                        const title = item.kind === 'smart' ? item.label : item.tool.label
                        const sub = item.kind === 'smart' ? item.sub : item.tool.description
                        return (
                            <div
                                key={item.key}
                                id={optionId(index)}
                                data-index={index}
                                role="option"
                                aria-selected={active}
                                onMouseMove={() => { if (!active) setSelectedIndex(index) }}
                                onClick={() => choose(item)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    padding: '10px 12px',
                                    borderRadius: 10,
                                    cursor: 'pointer',
                                    background: active ? (item.kind === 'smart' ? 'var(--primary)' : 'var(--primary-glow)') : 'transparent',
                                    color: active && item.kind === 'smart' ? 'var(--on-primary)' : 'var(--text-main)',
                                    marginBottom: item.kind === 'smart' && index === suggestions.length - 1 ? 8 : 0,
                                }}
                            >
                                <Icon size={18} aria-hidden="true" style={{ flexShrink: 0, color: active ? 'inherit' : item.kind === 'smart' ? 'var(--primary-text)' : 'var(--text-muted)' }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{title}</div>
                                    <div style={{ fontSize: '0.78rem', opacity: active && item.kind === 'smart' ? 0.9 : 1, color: active && item.kind === 'smart' ? 'inherit' : 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {sub}
                                    </div>
                                </div>
                                {item.kind === 'tool' && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{item.tool.category}</span>}
                                {active && (item.kind === 'smart' ? <ArrowRight size={16} aria-hidden="true" /> : <CornerDownLeft size={16} aria-hidden="true" style={{ color: 'var(--text-dim)' }} />)}
                            </div>
                        )
                    })}
                </div>
            </Motion.div>
        </Motion.div>
    )
}
