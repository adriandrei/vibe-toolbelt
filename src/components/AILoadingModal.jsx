import React, { useEffect, useState } from 'react'
import { useAI } from '../contexts/AIContext'

export default function AILoadingModal() {
    const { aiStatus, loadProgress, loadText, selectedModel, models } = useAI()
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (aiStatus === 'loading') setVisible(true)
        else if (aiStatus === 'ready') {
            // Short delay to show the "complete" state before hiding
            const t = setTimeout(() => setVisible(false), 1200)
            return () => clearTimeout(t)
        }
    }, [aiStatus])

    if (!visible) return null

    const model = models.find(m => m.id === selectedModel)
    const isComplete = aiStatus === 'ready'

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        }}>
            <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '40px 48px',
                maxWidth: 480,
                width: '90%',
                textAlign: 'center',
                boxShadow: '0 0 80px rgba(var(--primary-rgb), 0.15)',
            }}>
                {/* Icon */}
                <div style={{
                    fontSize: '3rem',
                    marginBottom: 20,
                    animation: isComplete ? 'none' : 'spin 3s linear infinite',
                }}>
                    {isComplete ? '✅' : '🤖'}
                </div>

                <h2 style={{
                    fontSize: '1.4rem',
                    fontWeight: 700,
                    marginBottom: 8,
                    background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                }}>
                    {isComplete ? 'AI Ready!' : 'Loading AI Model'}
                </h2>

                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 24 }}>
                    {isComplete
                        ? `${model?.label} is loaded and ready to help.`
                        : `Downloading ${model?.label} (${model?.size}) — cached after this.`
                    }
                </p>

                {/* Progress Bar */}
                <div style={{
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: 100,
                    height: 8,
                    overflow: 'hidden',
                    marginBottom: 12,
                }}>
                    <div style={{
                        height: '100%',
                        width: `${loadProgress}%`,
                        background: isComplete
                            ? 'var(--accent)'
                            : 'linear-gradient(90deg, var(--primary), var(--accent))',
                        borderRadius: 100,
                        transition: 'width 0.4s ease',
                    }} />
                </div>

                <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', minHeight: 20 }}>
                    {isComplete ? 'Complete!' : (loadText || `${loadProgress}%`)}
                </p>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 20 }}>
                    Model weights are cached in your browser — no future downloads needed.
                </p>
            </div>

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    )
}
