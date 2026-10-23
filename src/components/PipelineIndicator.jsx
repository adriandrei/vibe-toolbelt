import { useEffect, useRef, useState } from 'react'
import { Workflow, X } from 'lucide-react'
import { usePipeline } from '../contexts/PipelineContext'

// Header chip showing what's in the pipeline, with a preview and a Clear button.
export default function PipelineIndicator() {
    const { payload, clearText } = usePipeline()
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return undefined
        const onDown = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false)
        }
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    if (!payload) return null

    const size = payload.value.length
    const sizeLabel = size >= 1000 ? `${(size / 1000).toFixed(1)}k` : String(size)

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                type="button"
                className="badge badge-primary"
                style={{ cursor: 'pointer' }}
                aria-expanded={open}
                aria-haspopup="dialog"
                onClick={() => setOpen(o => !o)}
                title="Data waiting in the pipeline"
            >
                <Workflow size={12} aria-hidden="true" />
                <span className="hide-sm">Pipeline</span>
                <span>{sizeLabel}</span>
            </button>
            {open && (
                <div
                    role="dialog"
                    aria-label="Pipeline contents"
                    style={{
                        position: 'absolute',
                        right: 0,
                        top: 'calc(100% + 8px)',
                        width: 'min(340px, calc(100vw - 24px))',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: 'var(--shadow-lg)',
                        padding: 'var(--space-md)',
                        zIndex: 60,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-sm)',
                    }}
                >
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {size.toLocaleString()} characters{payload.label ? ` from ${payload.label}` : ''}. Open another tool and choose <strong>Use pipeline</strong>.
                    </div>
                    <pre className="code-well" style={{ maxHeight: 160, margin: 0, fontSize: '0.75rem' }}>
                        {payload.value.slice(0, 600)}{payload.value.length > 600 ? '…' : ''}
                    </pre>
                    <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{ alignSelf: 'flex-end' }}
                        onClick={() => {
                            clearText()
                            setOpen(false)
                        }}
                    >
                        <X size={14} aria-hidden="true" /> Clear pipeline
                    </button>
                </div>
            )}
        </div>
    )
}
