/**
 * Mutually exclusive options (mode toggles, tabs-like switches).
 *
 *   <SegmentedControl ariaLabel="Mode" value={mode} onChange={setMode}
 *     options={[{ value: 'encode', label: 'Encode' }, { value: 'decode', label: 'Decode', icon: Unlock }]} />
 *
 * Options can also be plain strings. Each button exposes aria-pressed.
 */
export default function SegmentedControl({ options, value, onChange, ariaLabel, size, block = false, disabled = false, className = '', style }) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className={`segmented ${size === 'sm' ? 'segmented-sm' : ''} ${block ? 'segmented-block' : ''} ${className}`}
            style={style}
        >
            {options.map((option) => {
                const opt = typeof option === 'object' ? option : { value: option, label: String(option) }
                const active = opt.value === value
                const Icon = opt.icon
                return (
                    <button
                        key={String(opt.value)}
                        type="button"
                        className={`segmented-item ${active ? 'is-active' : ''}`}
                        aria-pressed={active}
                        title={opt.title}
                        disabled={disabled || opt.disabled}
                        onClick={() => {
                            if (!active) onChange(opt.value)
                        }}
                    >
                        {Icon && <Icon size={14} aria-hidden="true" />}
                        {opt.label}
                    </button>
                )
            })}
        </div>
    )
}
