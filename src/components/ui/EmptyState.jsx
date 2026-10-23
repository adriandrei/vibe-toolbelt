// Placeholder shown before there's anything to display.
export default function EmptyState({ icon: Icon, title, children, className = '', style }) {
    return (
        <div className={`empty-state ${className}`} style={style}>
            {Icon && <Icon size={36} aria-hidden="true" style={{ opacity: 0.6 }} />}
            {title && <div className="empty-state-title">{title}</div>}
            {children && <div style={{ fontSize: '0.9rem', maxWidth: '50ch' }}>{children}</div>}
        </div>
    )
}
