import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const TOAST_TONES = {
    success: { icon: Check, color: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
    error: { icon: X, color: 'var(--danger)', bg: 'var(--danger-bg)', border: 'var(--danger-border)' },
    warning: { icon: AlertTriangle, color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
    info: { icon: Info, color: 'var(--info)', bg: 'var(--info-bg)', border: 'var(--info-border)' },
}

let toastId = 0

function Toast({ toast, onDismiss }) {
    const tone = TOAST_TONES[toast.type] || TOAST_TONES.info
    const Icon = tone.icon

    return (
        <div
            role={toast.type === 'error' ? 'alert' : 'status'}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px 10px 14px',
                background: 'var(--bg-elevated)',
                border: `1px solid ${tone.border}`,
                borderLeft: `3px solid ${tone.color}`,
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-md)',
                width: 'min(420px, calc(100vw - 32px))',
                animation: 'toastSlideIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                pointerEvents: 'auto',
            }}
        >
            <div style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: tone.bg,
                color: tone.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
            }}>
                <Icon size={16} aria-hidden="true" />
            </div>
            <span style={{ flex: 1, color: 'var(--text-main)', fontSize: '0.9rem', lineHeight: 1.4, wordBreak: 'break-word' }}>
                {toast.message}
            </span>
            {toast.action && (
                <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                        toast.action.onClick()
                        onDismiss(toast.id)
                    }}
                >
                    {toast.action.label}
                </button>
            )}
            <button type="button" className="icon-btn icon-btn-sm" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
                <X size={14} aria-hidden="true" />
            </button>
        </div>
    )
}

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([])
    const timers = useRef({})

    useEffect(() => {
        const pending = timers.current
        return () => Object.values(pending).forEach(clearTimeout)
    }, [])

    const dismiss = useCallback((id) => {
        clearTimeout(timers.current[id])
        delete timers.current[id]
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    const toast = useCallback((message, type = 'info', duration = 3500, action) => {
        const id = ++toastId
        setToasts(prev => [...prev.slice(-3), { id, message, type, action }])
        timers.current[id] = setTimeout(() => dismiss(id), action ? Math.max(duration, 6000) : duration)
        return id
    }, [dismiss])

    const api = useMemo(() => ({
        toast,
        dismiss,
        success: (msg, dur, action) => toast(msg, 'success', dur, action),
        error: (msg, dur, action) => toast(msg, 'error', dur ?? 5000, action),
        warning: (msg, dur, action) => toast(msg, 'warning', dur ?? 4500, action),
        info: (msg, dur, action) => toast(msg, 'info', dur, action),
    }), [toast, dismiss])

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div
                aria-live="polite"
                className="toast-region"
                style={{
                    position: 'fixed',
                    bottom: 16,
                    right: 16,
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column-reverse',
                    gap: 8,
                    pointerEvents: 'none',
                }}
            >
                {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={dismiss} />)}
            </div>
            <style>{`
                @keyframes toastSlideIn {
                    from { opacity: 0; transform: translateX(24px) scale(0.97); }
                    to { opacity: 1; transform: translateX(0) scale(1); }
                }
            `}</style>
        </ToastContext.Provider>
    )
}

export function useToast() {
    const ctx = useContext(ToastContext)
    if (!ctx) throw new Error('useToast must be used within ToastProvider')
    return ctx
}
