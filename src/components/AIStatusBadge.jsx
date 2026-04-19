import React, { useState } from 'react'
import { useAI } from '../contexts/AIContext'
import { Bot, Loader, AlertTriangle, Zap } from 'lucide-react'

export default function AIStatusBadge() {
    const { aiStatus, loadProgress, webGPUSupported, setAiPanelOpen, aiPanelOpen, loadModel } = useAI()
    const [tooltip, setTooltip] = useState(false)

    const getConfig = () => {
        if (aiStatus === 'unsupported' || webGPUSupported === false) return {
            icon: <AlertTriangle size={14} />,
            label: 'AI Unavailable',
            color: 'var(--text-dim)',
            bg: 'rgba(255,255,255,0.05)',
            border: 'var(--border)',
            tip: 'WebGPU is required. Use Chrome 113+ or Edge 113+.',
            clickable: false,
        }
        if (aiStatus === 'loading') return {
            icon: <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />,
            label: `${loadProgress}%`,
            color: 'hsl(38,95%,65%)',
            bg: 'rgba(234,179,8,0.1)',
            border: 'rgba(234,179,8,0.3)',
            tip: 'Downloading AI model…',
            clickable: false,
        }
        if (aiStatus === 'thinking') return {
            icon: <Zap size={14} style={{ animation: 'pulse 0.8s ease-in-out infinite' }} />,
            label: 'Thinking…',
            color: 'var(--primary)',
            bg: 'var(--primary-glow)',
            border: 'var(--primary)',
            tip: 'AI is generating a response',
            clickable: true,
        }
        if (aiStatus === 'ready') return {
            icon: <Bot size={14} />,
            label: 'AI Ready',
            color: 'hsl(142,70%,55%)',
            bg: 'rgba(34,197,94,0.1)',
            border: 'rgba(34,197,94,0.3)',
            tip: 'Click to open AI assistant',
            clickable: true,
        }
        // idle
        return {
            icon: <Bot size={14} />,
            label: 'AI',
            color: 'var(--text-muted)',
            bg: 'rgba(255,255,255,0.05)',
            border: 'var(--border)',
            tip: 'Click to load AI assistant',
            clickable: webGPUSupported !== false,
        }
    }

    const cfg = getConfig()

    const handleClick = () => {
        if (!cfg.clickable) return
        if (aiStatus === 'idle') {
            loadModel()
        } else if (aiStatus === 'ready' || aiStatus === 'thinking') {
            setAiPanelOpen(!aiPanelOpen)
        }
    }

    return (
        <div style={{ position: 'relative' }}>
            <button
                id="ai-status-badge"
                onClick={handleClick}
                onMouseEnter={() => setTooltip(true)}
                onMouseLeave={() => setTooltip(false)}
                title={cfg.tip}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 10px',
                    borderRadius: 100,
                    background: aiPanelOpen ? 'var(--primary-glow)' : cfg.bg,
                    border: `1px solid ${aiPanelOpen ? 'var(--primary)' : cfg.border}`,
                    color: aiPanelOpen ? 'var(--primary)' : cfg.color,
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: cfg.clickable ? 'pointer' : 'default',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap',
                }}
            >
                {cfg.icon}
                <span>{cfg.label}</span>
            </button>

            {tooltip && (
                <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    background: 'var(--bg-panel)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    zIndex: 1000,
                    pointerEvents: 'none',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                }}>
                    {cfg.tip}
                </div>
            )}

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.4; }
                }
            `}</style>
        </div>
    )
}
