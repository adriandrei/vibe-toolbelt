import './ai.css'

/**
 * Linear progress bar.
 *
 *   <ProgressBar value={42} label="Loading Phi-3.5 Mini" />
 *   <ProgressBar indeterminate label="Getting ready" />
 */
export function ProgressBar({ value = 0, indeterminate = false, label, className = '' }) {
    const percent = Math.min(100, Math.max(0, Math.round(value)))
    return (
        <div
            className={`ai-progress ${indeterminate ? 'is-indeterminate' : ''} ${className}`}
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : percent}
            aria-valuetext={indeterminate ? 'Starting' : `${percent}%`}
        >
            <div className="ai-progress-fill" style={indeterminate ? undefined : { width: `${percent}%` }} />
        </div>
    )
}

/**
 * Model loading progress: status text, percentage and bar. Before the first
 * progress report the bar is indeterminate and no percentage is shown.
 */
export function LoadProgress({ text, percent, phase, label, className = '' }) {
    const preparing = !phase || phase === 'prepare'
    return (
        <div className={className}>
            <div className="ai-progress-meta">
                <span>{text}</span>
                {!preparing && <span className="mono">{percent}%</span>}
            </div>
            <ProgressBar value={percent} indeterminate={preparing} label={label} />
        </div>
    )
}

// Small circular progress indicator, for compact places like the header badge.
export function ProgressRing({ value = 0, size = 14 }) {
    const radius = 5
    const circumference = 2 * Math.PI * radius
    const percent = Math.min(100, Math.max(0, value))
    return (
        <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.2" />
            <circle
                cx="7"
                cy="7"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - percent / 100)}
                transform="rotate(-90 7 7)"
            />
        </svg>
    )
}
