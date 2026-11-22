import { useId, useState } from 'react'

/**
 * Labelled range slider with its current value, and an optional number input.
 * Always calls onChange with a number, clamped to [min, max].
 *
 *   <SliderField label="Blur" value={blur} onChange={setBlur} min={0} max={40} unit="px" />
 *
 * The number input applies what's typed once it is in range, and clamps when
 * it loses focus, so typing "32" into a box with min 8 doesn't turn the
 * intermediate "3" into 8.
 */
export default function SliderField({
    label,
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    unit = '',
    format,
    showInput = false,
    hint,
    disabled = false,
    className = '',
    style,
}) {
    const id = useId()
    const [draft, setDraft] = useState(null) // text in the number input while it's being typed
    const display = format ? format(value) : `${value}${unit}`
    const clamp = (n) => Math.min(max, Math.max(min, n))

    return (
        <div className={className} style={style}>
            <div className="slider-field-header">
                <label className="field-label" htmlFor={id} style={{ marginBottom: 0 }}>{label}</label>
                {!showInput && <span className="slider-field-value">{display}</span>}
            </div>
            <div className="slider-field-row">
                <input
                    id={id}
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    disabled={disabled}
                    aria-valuetext={display}
                    onChange={(e) => onChange(clamp(Number(e.target.value)))}
                />
                {showInput && (
                    <input
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        value={draft ?? value}
                        disabled={disabled}
                        aria-label={`${label} value`}
                        onChange={(e) => {
                            setDraft(e.target.value)
                            const n = e.target.valueAsNumber
                            if (!Number.isNaN(n) && n >= min && n <= max) onChange(n)
                        }}
                        onBlur={(e) => {
                            // Only report a change: the in-range value was already applied while typing
                            const n = e.target.valueAsNumber
                            if (!Number.isNaN(n) && clamp(n) !== value) onChange(clamp(n))
                            setDraft(null)
                        }}
                    />
                )}
                {showInput && unit && <span className="slider-field-value" aria-hidden="true">{unit}</span>}
            </div>
            {hint && <div className="field-hint">{hint}</div>}
        </div>
    )
}
