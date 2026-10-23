import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Sparkles, X } from 'lucide-react'
import { analyzeContent } from '../utils/detect'
import { openInTool } from '../utils/smartNav'
import { getTool } from '../config/tools'
import './SmartPaste.css'

const AUTO_HIDE_MS = 10000

function isEditable(el) {
    if (!el || el === document.body) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * Pasting recognisable content outside a text field (a JWT, JSON, a URL,
 * a timestamp…) offers to open it in the matching tool.
 */
export default function SmartPaste() {
    const [suggestion, setSuggestion] = useState(null)
    const navigate = useNavigate()
    const location = useLocation()
    const btnRef = useRef(null)
    const pathRef = useRef(location.pathname)

    useEffect(() => {
        pathRef.current = location.pathname
    }, [location.pathname])

    useEffect(() => {
        const onPaste = (e) => {
            if (isEditable(e.target) || isEditable(document.activeElement)) return
            const text = e.clipboardData?.getData('text')?.trim()
            if (!text) return
            const result = analyzeContent(text)
            if (!result || pathRef.current === result.tool) return
            setSuggestion({ ...result, content: text, id: Date.now() })
        }
        window.addEventListener('paste', onPaste)
        return () => window.removeEventListener('paste', onPaste)
    }, [])

    // Auto-hide (restarts for every new suggestion)
    useEffect(() => {
        if (!suggestion) return undefined
        btnRef.current?.focus()
        const timer = setTimeout(() => setSuggestion(null), AUTO_HIDE_MS)
        const onKey = (e) => {
            if (e.key === 'Escape') setSuggestion(null)
        }
        window.addEventListener('keydown', onKey)
        return () => {
            clearTimeout(timer)
            window.removeEventListener('keydown', onKey)
        }
    }, [suggestion])

    // Navigating elsewhere dismisses it
    const [shownOnPath, setShownOnPath] = useState(location.pathname)
    if (shownOnPath !== location.pathname) {
        setShownOnPath(location.pathname)
        if (suggestion) setSuggestion(null)
    }

    if (!suggestion) return null
    const tool = getTool(suggestion.tool)

    return (
        <div className="smart-toast" role="dialog" aria-label="Smart paste suggestion" aria-live="polite">
            <div className="smart-toast-icon">
                <Sparkles size={20} aria-hidden="true" />
            </div>
            <div className="smart-toast-content">
                <div className="smart-toast-title">Looks like {suggestion.label}</div>
                <div className="smart-toast-desc">Open it in {tool?.title ?? suggestion.tool}?</div>
            </div>
            <div className="smart-toast-actions">
                <button
                    ref={btnRef}
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                        openInTool(navigate, suggestion.tool, { input: suggestion.content, mode: suggestion.mode })
                        setSuggestion(null)
                    }}
                >
                    Open <ArrowRight size={14} aria-hidden="true" />
                </button>
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => setSuggestion(null)} aria-label="Dismiss suggestion">
                    <X size={16} aria-hidden="true" />
                </button>
            </div>
        </div>
    )
}
