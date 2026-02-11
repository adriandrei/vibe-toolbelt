import React from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary]', error, errorInfo)
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null })
    }

    handleGoHome = () => {
        this.setState({ hasError: false, error: null })
        window.location.href = '/'
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '60vh',
                    textAlign: 'center',
                    padding: 'var(--space-xl)'
                }}>
                    <div style={{
                        width: 64,
                        height: 64,
                        borderRadius: '50%',
                        background: 'rgba(239, 68, 68, 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 'var(--space-lg)'
                    }}>
                        <AlertTriangle size={32} color="#ef4444" />
                    </div>

                    <h2 style={{
                        fontSize: '1.5rem',
                        fontWeight: 600,
                        color: 'var(--text-main)',
                        marginBottom: 'var(--space-sm)'
                    }}>
                        Something went wrong
                    </h2>

                    <p style={{
                        color: 'var(--text-muted)',
                        maxWidth: '400px',
                        marginBottom: 'var(--space-md)',
                        lineHeight: 1.6
                    }}>
                        This tool encountered an unexpected error. Your data is safe — nothing was sent anywhere.
                    </p>

                    {this.state.error && (
                        <pre style={{
                            padding: 'var(--space-md)',
                            background: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            borderRadius: 'var(--radius-md)',
                            color: '#f87171',
                            fontSize: '0.8rem',
                            fontFamily: 'var(--font-mono)',
                            maxWidth: '500px',
                            overflow: 'auto',
                            marginBottom: 'var(--space-lg)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            textAlign: 'left'
                        }}>
                            {this.state.error.message}
                        </pre>
                    )}

                    <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button
                            onClick={this.handleRetry}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '12px 24px',
                                background: 'var(--primary)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                fontWeight: 600,
                                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)'
                            }}
                        >
                            <RefreshCw size={18} /> Try Again
                        </button>

                        <button
                            onClick={this.handleGoHome}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '12px 24px',
                                background: 'transparent',
                                color: 'var(--text-main)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                fontWeight: 500
                            }}
                        >
                            <Home size={18} /> Go Home
                        </button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
