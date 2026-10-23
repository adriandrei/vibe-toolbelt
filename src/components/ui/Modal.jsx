import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const WIDTHS = { sm: 420, md: 560, lg: 760, xl: 960 }
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessible dialog: Escape and overlay click close it, focus moves into the
 * dialog and back to the trigger on close, and Tab stays inside.
 *
 *   <Modal open={open} onClose={() => setOpen(false)} title="Import cURL"
 *          footer={<button className="btn btn-primary">Import</button>}>…</Modal>
 */
export default function Modal({ open, onClose, title, children, footer, size = 'md', closeOnOverlay = true, initialFocusRef }) {
    const titleId = useId()
    const dialogRef = useRef(null)
    const onCloseRef = useRef(onClose)

    useEffect(() => {
        onCloseRef.current = onClose
    })

    useEffect(() => {
        if (!open) return undefined
        const previouslyFocused = document.activeElement
        const dialog = dialogRef.current
        const first = initialFocusRef?.current || dialog?.querySelector(FOCUSABLE)
        ;(first || dialog)?.focus()

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation()
                onCloseRef.current?.()
            } else if (event.key === 'Tab' && dialog) {
                const items = [...dialog.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
                if (!items.length) return
                const firstItem = items[0]
                const lastItem = items[items.length - 1]
                if (event.shiftKey && document.activeElement === firstItem) {
                    event.preventDefault()
                    lastItem.focus()
                } else if (!event.shiftKey && document.activeElement === lastItem) {
                    event.preventDefault()
                    firstItem.focus()
                }
            }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
            document.removeEventListener('keydown', onKeyDown, true)
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus()
        }
    }, [open, initialFocusRef])

    if (!open) return null

    return createPortal(
        <div
            className="modal-overlay"
            onMouseDown={(event) => {
                if (closeOnOverlay && event.target === event.currentTarget) onClose?.()
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? titleId : undefined}
                tabIndex={-1}
                className="modal"
                style={{ maxWidth: WIDTHS[size] ?? size }}
            >
                {title && (
                    <div className="modal-header">
                        <h2 id={titleId} className="modal-title">{title}</h2>
                        <button type="button" className="icon-btn" onClick={() => onClose?.()} aria-label="Close dialog">
                            <X size={18} aria-hidden="true" />
                        </button>
                    </div>
                )}
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>,
        document.body
    )
}
