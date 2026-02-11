import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { Check, X, AlertTriangle, Info } from 'lucide-react'

const ToastContext = createContext(null)

const TOAST_ICONS = {
    success: { icon: Check, color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },
    error: { icon: X, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
    warning: { icon: AlertTriangle, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
    info: { icon: Info, color: '#6366f1', bg: 'rgba(99, 102, 241, 0.12)' }
}

let _toastId = 0

function Toast({ toast, onDismiss }) {
    const config = TOAST_ICONS[toast.type] || TOAST_ICONS.info
    const Icon = config.icon

    return (
        <div
            role="alert"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                background: 'var(--bg-panel)',
                border: `1px solid ${config.color}33`,
                borderLeft: `3px solid ${config.color}`,
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                backdropFilter: 'blur(12px)',
                minWidth: '280px',
                maxWidth: '420px',
                animation: 'toastSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                pointerEvents: 'auto'
            }}
        >
            <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: config.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
            }}>
                <Icon size={16} color={config.color} />
            </div>

            <span style={{
                flex: 1,
                color: 'var(--text-main)',
                fontSize: '0.9rem',
                lineHeight: 1.4
            }}>
                {toast.message}
            </span>

            <button
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss"
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    flexShrink: 0
                }}
            >
                <X size={14} />
            </button>
        </div>
    )
}

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([])
    const timersRef = useRef({})

    const dismiss = useCallback((id) => {
        clearTimeout(timersRef.current[id])
        delete timersRef.current[id]
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    const toast = useCallback((message, type = 'info', duration = 3500) => {
        const id = ++_toastId
        setToasts(prev => [...prev.slice(-4), { id, message, type }]) // Max 5 visible
        timersRef.current[id] = setTimeout(() => dismiss(id), duration)
        return id
    }, [dismiss])

    const api = {
        toast,
        success: (msg, dur) => toast(msg, 'success', dur),
        error: (msg, dur) => toast(msg, 'error', dur),
        warning: (msg, dur) => toast(msg, 'warning', dur),
        info: (msg, dur) => toast(msg, 'info', dur),
    }

    return (
        <ToastContext.Provider value={api}>
            {children}

            {/* Toast Container */}
            <div
                aria-live="polite"
                style={{
                    position: 'fixed',
                    bottom: 'var(--space-lg)',
                    right: 'var(--space-lg)',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column-reverse',
                    gap: 8,
                    pointerEvents: 'none'
                }}
            >
                {toasts.map(t => (
                    <Toast key={t.id} toast={t} onDismiss={dismiss} />
                ))}
            </div>

            <style>{`
                @keyframes toastSlideIn {
                    from {
                        opacity: 0;
                        transform: translateX(40px) scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0) scale(1);
                    }
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
