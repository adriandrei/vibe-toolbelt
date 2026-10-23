import { useId, useState } from 'react'
import { normalizeColor, parseColor, toHex } from '../../utils/color'

/**
 * Colour picker + text field with validation.
 *
 *   <ColorField label="Background" value={bg} onChange={setBg} />
 *
 * onChange only fires with a valid colour, normalised to hex ("#rrggbb", or
 * "#rrggbbaa" when `allowAlpha` and the colour is translucent). Typing an
 * invalid value marks the field invalid and keeps the last valid colour.
 */
export default function ColorField({ label, value, onChange, allowAlpha = false, hint, className = '', style, inputStyle }) {
    const id = useId()
    const [text, setText] = useState(value ?? '')
    const [syncedValue, setSyncedValue] = useState(value)

    // Follow external value changes (e.g. presets) without clobbering typing
    if (value !== syncedValue) {
        setSyncedValue(value)
        if (normalizeColor(text, allowAlpha) !== normalizeColor(value ?? '', allowAlpha)) setText(value ?? '')
    }

    const valid = parseColor(text) !== null
    const parsed = parseColor(value ?? '') || { r: 0, g: 0, b: 0, a: 1 }
    const pickerValue = toHex(parsed, false)

    const emit = (raw) => {
        const normalized = normalizeColor(raw, allowAlpha)
        if (normalized) onChange(normalized)
    }

    return (
        <div className={className} style={style}>
            {label && <label className="field-label" htmlFor={id}>{label}</label>}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                <input
                    type="color"
                    value={pickerValue}
                    aria-label={label ? `${label} colour picker` : 'Colour picker'}
                    onChange={(e) => {
                        setText(e.target.value)
                        emit(e.target.value)
                    }}
                />
                <input
                    id={id}
                    type="text"
                    value={text}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={!valid}
                    aria-describedby={!valid ? `${id}-error` : hint ? `${id}-hint` : undefined}
                    className={valid ? '' : 'field-invalid'}
                    style={{ fontFamily: 'var(--font-mono)', padding: '0.55rem 0.75rem', fontSize: '0.9rem', ...inputStyle }}
                    onChange={(e) => {
                        setText(e.target.value)
                        emit(e.target.value)
                    }}
                />
            </div>
            {!valid && <div id={`${id}-error`} className="field-error">Not a valid colour</div>}
            {valid && hint && <div id={`${id}-hint`} className="field-hint">{hint}</div>}
        </div>
    )
}
