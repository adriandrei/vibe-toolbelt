import { useId } from 'react'

/**
 * Labelled range slider with its current value, and an optional number input.
 * Always calls onChange with a number, clamped to [min, max].
 *
 *   <SliderField label="Blur" value={blur} onChange={setBlur} min={0} max={40} unit="px" />
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
                        value={value}
                        disabled={disabled}
                        aria-label={`${label} value`}
                        onChange={(e) => {
                            const n = e.target.valueAsNumber
                            if (!Number.isNaN(n)) onChange(clamp(n))
                        }}
                    />
                )}
                {showInput && unit && <span className="slider-field-value" aria-hidden="true">{unit}</span>}
            </div>
            {hint && <div className="field-hint">{hint}</div>}
        </div>
    )
}
