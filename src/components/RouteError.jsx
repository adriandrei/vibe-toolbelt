import { useRouteError } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// Last-resort error screen for errors outside a page (e.g. in the layout).
export default function RouteError() {
    const error = useRouteError()
    const message = error?.message || error?.statusText || String(error)

    return (
        <div
            role="alert"
            style={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-md)',
                padding: 'var(--space-xl)',
                textAlign: 'center',
            }}
        >
            <AlertTriangle size={40} aria-hidden="true" style={{ color: 'var(--danger)' }} />
            <h1 style={{ fontSize: '1.5rem' }}>The app hit an unexpected error</h1>
            <p style={{ color: 'var(--text-muted)', maxWidth: 460 }}>
                Reloading usually fixes it. Your data never left this device.
            </p>
            <pre className="code-well" style={{ maxWidth: 560, width: '100%', color: 'var(--danger)', textAlign: 'left' }}>{message}</pre>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                <RefreshCw size={16} aria-hidden="true" /> Reload
            </button>
        </div>
    )
}
