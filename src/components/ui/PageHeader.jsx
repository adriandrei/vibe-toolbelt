// Standard page heading: icon + gradient h1, optional subtitle and actions.
export default function PageHeader({ icon: Icon, title, subtitle, actions, align = 'center', className = '', children }) {
    return (
        <header className={`page-header ${align === 'center' ? 'is-centered' : ''} ${className}`}>
            <div className="page-header-row">
                {Icon && <Icon size={28} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />}
                <h1 className="page-title text-gradient">{title}</h1>
            </div>
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
            {(actions || children) && (
                <div className="page-header-actions">
                    {actions}
                    {children}
                </div>
            )}
        </header>
    )
}
