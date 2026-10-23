import { useEffect, useId, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { useToast } from '../ToastProvider'

function matchesAccept(file, accept) {
    if (!accept) return true
    const name = file.name.toLowerCase()
    const type = (file.type || '').toLowerCase()
    return accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(rule => {
        if (rule.startsWith('.')) return name.endsWith(rule)
        if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1))
        return type === rule
    })
}

/**
 * Keyboard-accessible file picker with drag-and-drop (and optional paste).
 *
 *   <FileDropZone accept="image/*,.heic" multiple onFiles={files => ...}
 *                 label="Drop images here or click to browse" hint="PNG, JPEG, HEIC…" />
 *
 * - Enter/Space or click opens the picker; the input is reset after each pick,
 *   so choosing the same file again works.
 * - Files that don't match `accept` are skipped with a warning toast.
 * - While mounted, files dropped outside the zone don't navigate the tab away.
 * - `allowPaste` also accepts files pasted from the clipboard (e.g. screenshots).
 * - Pass `children` to replace the default icon/label content.
 */
export default function FileDropZone({
    onFiles,
    accept,
    multiple = false,
    disabled = false,
    label = 'Drop a file here or click to browse',
    hint,
    icon: Icon = Upload,
    compact = false,
    allowPaste = false,
    maxSizeMB,
    className = '',
    style,
    children,
    ariaLabel,
}) {
    const id = useId()
    const inputRef = useRef(null)
    const depth = useRef(0)
    const [dragging, setDragging] = useState(false)
    const toast = useToast()
    const onFilesRef = useRef(onFiles)

    useEffect(() => {
        onFilesRef.current = onFiles
    })

    const handleFiles = (list) => {
        let files = Array.from(list || [])
        if (!files.length) return
        const rejected = files.filter(f => !matchesAccept(f, accept))
        files = files.filter(f => matchesAccept(f, accept))
        if (rejected.length) toast.warning(`Skipped ${rejected.length} unsupported file${rejected.length > 1 ? 's' : ''}: ${rejected.map(f => f.name).slice(0, 3).join(', ')}`)
        if (maxSizeMB) {
            const tooBig = files.filter(f => f.size > maxSizeMB * 1024 * 1024)
            if (tooBig.length) toast.warning(`Skipped ${tooBig.length} file${tooBig.length > 1 ? 's' : ''} larger than ${maxSizeMB} MB`)
            files = files.filter(f => f.size <= maxSizeMB * 1024 * 1024)
        }
        if (!multiple) files = files.slice(0, 1)
        if (files.length) onFilesRef.current?.(files)
    }

    const handleFilesRef = useRef(handleFiles)
    useEffect(() => {
        handleFilesRef.current = handleFiles
    })

    // Dropping a file anywhere else on the page would open it in the tab.
    useEffect(() => {
        const prevent = (event) => {
            if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) event.preventDefault()
        }
        window.addEventListener('dragover', prevent)
        window.addEventListener('drop', prevent)
        return () => {
            window.removeEventListener('dragover', prevent)
            window.removeEventListener('drop', prevent)
        }
    }, [])

    useEffect(() => {
        if (!allowPaste || disabled) return undefined
        const onPaste = (event) => {
            const files = Array.from(event.clipboardData?.files || [])
            if (!files.length) return
            event.preventDefault()
            handleFilesRef.current(files)
        }
        window.addEventListener('paste', onPaste)
        return () => window.removeEventListener('paste', onPaste)
    }, [allowPaste, disabled])

    const open = () => {
        if (!disabled) inputRef.current?.click()
    }

    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            aria-label={ariaLabel}
            aria-describedby={hint ? `${id}-hint` : undefined}
            className={`drop-zone ${compact ? 'drop-zone-compact' : ''} ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
            style={style}
            onClick={open}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    open()
                }
            }}
            onDragEnter={(event) => {
                event.preventDefault()
                depth.current += 1
                if (!disabled) setDragging(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => {
                depth.current -= 1
                if (depth.current <= 0) setDragging(false)
            }}
            onDrop={(event) => {
                event.preventDefault()
                depth.current = 0
                setDragging(false)
                if (!disabled) handleFiles(event.dataTransfer.files)
            }}
        >
            <input
                ref={inputRef}
                id={`${id}-input`}
                type="file"
                accept={accept}
                multiple={multiple}
                hidden
                tabIndex={-1}
                onChange={(event) => {
                    handleFiles(event.target.files)
                    event.target.value = ''
                }}
            />
            {children ?? (
                <>
                    {Icon && <Icon size={compact ? 20 : 32} aria-hidden="true" style={{ color: 'var(--primary-text)' }} />}
                    <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{label}</div>
                    {hint && <div id={`${id}-hint`} className="field-hint" style={{ marginTop: 0 }}>{hint}</div>}
                </>
            )}
        </div>
    )
}
