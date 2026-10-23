import { Check, Copy } from 'lucide-react'
import { useCopy } from '../../hooks/useCopy'

/**
 * Copy-to-clipboard button with "Copied" feedback and error handling.
 *
 *   <CopyButton text={output} />                    // "Copy" text button
 *   <CopyButton text={() => build()} iconOnly label="Copy CSS" />
 *
 * `text` may be a string or a function returning one. The button is disabled
 * while a string `text` is empty.
 */
export default function CopyButton({
    text,
    label = 'Copy',
    copiedLabel = 'Copied',
    iconOnly = false,
    variant = 'ghost',
    size = 'sm',
    disabled,
    className = '',
    style,
    toastOnSuccess = false,
    onCopied,
}) {
    const { copy, copied } = useCopy()
    const empty = typeof text !== 'function' && (text === undefined || text === null || text === '')
    const isDisabled = disabled ?? empty
    const iconSize = size === 'lg' ? 18 : 14

    const handleClick = async (event) => {
        event.stopPropagation()
        const ok = await copy(text, { toast: toastOnSuccess, label })
        if (ok) onCopied?.()
    }

    const classes = iconOnly
        ? `icon-btn ${size === 'sm' ? 'icon-btn-sm' : ''} ${className}`
        : `btn btn-${variant} ${size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : ''} ${className}`

    return (
        <button
            type="button"
            className={classes}
            onClick={handleClick}
            disabled={isDisabled}
            aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
            title={iconOnly ? label : undefined}
            style={{ ...(copied ? { color: 'var(--success)' } : null), ...style }}
        >
            {copied ? <Check size={iconSize} aria-hidden="true" /> : <Copy size={iconSize} aria-hidden="true" />}
            {!iconOnly && <span>{copied ? copiedLabel : label}</span>}
            <span className="sr-only" aria-live="polite">{copied ? copiedLabel : ''}</span>
        </button>
    )
}
