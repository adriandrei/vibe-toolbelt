import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

const ICONS = { success: CheckCircle2, warning: AlertTriangle, danger: XCircle, info: Info }

/**
 * Inline message for results and errors.
 *
 *   <StatusBanner tone="danger" title="Invalid JSON">Unexpected token } at line 3</StatusBanner>
 *
 * tone: success | warning | danger | info. Danger banners are announced to
 * screen readers immediately (role="alert"), the rest politely.
 */
export default function StatusBanner({ tone = 'info', title, children, icon, className = '', style, action }) {
    const Icon = icon ?? ICONS[tone] ?? Info
    return (
        <div
            role={tone === 'danger' ? 'alert' : 'status'}
            className={`status-banner tone-${tone} ${className}`}
            style={style}
        >
            <Icon size={18} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0 }}>
                {title && <div className="status-banner-title">{title}</div>}
                {children && <div className="status-banner-body">{children}</div>}
            </div>
            {action}
        </div>
    )
}
