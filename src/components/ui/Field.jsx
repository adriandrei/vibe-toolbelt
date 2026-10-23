import { Children, cloneElement, isValidElement, useId } from 'react'

/**
 * Labels a single form control and wires up hint/error text for screen readers.
 *
 *   <Field label="Secret key" hint="UTF-8 text" error={keyError}>
 *     <input value={key} onChange={...} />
 *   </Field>
 *
 * `labelAction` renders on the right of the label row (e.g. a Clear button).
 */
export default function Field({ label, hint, error, labelAction, children, className = '', style }) {
    const autoId = useId()
    const child = Children.only(children)
    const childId = (isValidElement(child) && child.props.id) || autoId
    const hintId = hint ? `${childId}-hint` : undefined
    const errorId = error ? `${childId}-error` : undefined
    const describedBy = [child.props['aria-describedby'], errorId || hintId].filter(Boolean).join(' ') || undefined

    return (
        <div className={className} style={style}>
            {(label || labelAction) && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                    {label && <label className="field-label" htmlFor={childId} style={{ marginBottom: 0 }}>{label}</label>}
                    {labelAction}
                </div>
            )}
            {cloneElement(child, {
                id: childId,
                'aria-describedby': describedBy,
                'aria-invalid': error ? true : child.props['aria-invalid'],
            })}
            {error ? (
                <div id={errorId} className="field-error">{error}</div>
            ) : hint ? (
                <div id={hintId} className="field-hint">{hint}</div>
            ) : null}
        </div>
    )
}
