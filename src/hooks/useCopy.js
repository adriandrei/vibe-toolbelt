import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../components/ToastProvider'
import { copyText } from '../utils/clipboard'

/**
 * Clipboard copy with feedback.
 *
 *   const { copy, isCopied } = useCopy()
 *   <button onClick={() => copy(value, { key: 'hex' })}>{isCopied('hex') ? 'Copied' : 'Copy'}</button>
 *
 * Failures always show an error toast. Successes are silent by default (the
 * button's own "Copied" state is the feedback); pass `toast: true` when the
 * trigger has no visible state of its own.
 */
export function useCopy({ resetAfter = 1500 } = {}) {
    const toast = useToast()
    const [copiedKey, setCopiedKey] = useState(null)
    const timer = useRef(null)

    useEffect(() => () => clearTimeout(timer.current), [])

    const copy = useCallback(async (value, { key = 'default', toast: showToast = false, label } = {}) => {
        const text = typeof value === 'function' ? value() : value
        if (text === undefined || text === null || text === '') {
            toast.warning('Nothing to copy yet')
            return false
        }
        const ok = await copyText(text)
        if (!ok) {
            toast.error('Copy failed: the browser blocked clipboard access')
            return false
        }
        setCopiedKey(key)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopiedKey(null), resetAfter)
        if (showToast) toast.success(label ? `${label} copied` : 'Copied to clipboard')
        return true
    }, [toast, resetAfter])

    const isCopied = useCallback((key = 'default') => copiedKey === key, [copiedKey])

    return { copy, copied: copiedKey !== null, copiedKey, isCopied }
}
