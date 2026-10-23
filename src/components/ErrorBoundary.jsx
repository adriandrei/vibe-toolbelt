import React from 'react'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'

/**
 * Catches render errors in one tool so the rest of the app keeps working.
 * Give it a `resetKey` (e.g. the route path): when the key changes, the error
 * is cleared, so a crash never follows you to the next page.
 */
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null, resetKey: props.resetKey }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    static getDerivedStateFromProps(props, state) {
        if (props.resetKey !== state.resetKey) {
            return { hasError: false, error: null, resetKey: props.resetKey }
        }
        return null
    }

    componentDidCatch(error, errorInfo) {
        // Kept in production builds on purpose (console.error is not stripped)
        console.error('[ErrorBoundary]', error, errorInfo?.componentStack)
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null })
    }

    render() {
        if (!this.state.hasError) return this.props.children

        const { compact, onGoHome } = this.props
        return (
            <div
                role="alert"
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: compact ? 'auto' : '50vh',
                    textAlign: 'center',
                    padding: compact ? 'var(--space-lg)' : 'var(--space-xl)',
                    gap: 'var(--space-md)',
                }}
            >
                <div style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: 'var(--danger-bg)',
                    color: 'var(--danger)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <AlertTriangle size={28} aria-hidden="true" />
                </div>

                <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    Something went wrong
                </h2>

                <p style={{ color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6 }}>
                    This tool hit an unexpected error. Your data is safe: nothing was sent anywhere.
                </p>

                {this.state.error && (
                    <pre className="code-well" style={{ maxWidth: 520, width: '100%', color: 'var(--danger)', textAlign: 'left', margin: 0 }}>
                        {this.state.error.message || String(this.state.error)}
                    </pre>
                )}

                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button type="button" className="btn btn-primary" onClick={this.handleRetry}>
                        <RefreshCw size={16} aria-hidden="true" /> Try again
                    </button>
                    {onGoHome !== false && (
                        <a className="btn btn-secondary" href="/" onClick={onGoHome}>
                            <Home size={16} aria-hidden="true" /> Go home
                        </a>
                    )}
                </div>
            </div>
        )
    }
}
