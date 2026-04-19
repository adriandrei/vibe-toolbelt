import React, { useState } from 'react'
import { Bot, Cpu, HardDrive, RefreshCw, CheckCircle, AlertTriangle, Trash2 } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAI } from '../contexts/AIContext'

export default function AISettings() {
    useDocumentTitle('AI Settings')
    const { selectedModel, models, changeModel, loadModel, aiStatus, loadProgress, loadText, webGPUSupported } = useAI()
    const [cleared, setCleared] = useState(false)

    const handleClearCache = async () => {
        try {
            // Clear IndexedDB and Cache Storage used by WebLLM
            if ('caches' in window) {
                const cacheNames = await caches.keys()
                await Promise.all(cacheNames.filter(n => n.includes('mlc') || n.includes('webllm')).map(n => caches.delete(n)))
            }
            if ('indexedDB' in window) {
                indexedDB.deleteDatabase('mlc-webllm')
                indexedDB.deleteDatabase('webllm')
            }
            setCleared(true)
            setTimeout(() => setCleared(false), 3000)
        } catch (e) {
            console.error('Cache clear failed', e)
        }
    }

    return (
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>AI Settings</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Configure your in-browser AI assistant — 100% local, zero data leaves your machine.
                </p>
            </div>

            {/* WebGPU Status */}
            <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 16 }}>
                {webGPUSupported === null && <RefreshCw size={20} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />}
                {webGPUSupported === true && <CheckCircle size={20} style={{ color: '#22c55e' }} />}
                {webGPUSupported === false && <AlertTriangle size={20} style={{ color: '#ef4444' }} />}
                <div>
                    <div style={{ fontWeight: 600 }}>
                        {webGPUSupported === null && 'Checking WebGPU…'}
                        {webGPUSupported === true && 'WebGPU Supported ✓'}
                        {webGPUSupported === false && 'WebGPU Not Supported'}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {webGPUSupported === true && 'Your browser can run WebLLM in-browser AI.'}
                        {webGPUSupported === false && 'Switch to Chrome 113+ or Edge 113+ to use this feature.'}
                    </div>
                </div>
            </div>

            {/* Model Selection */}
            <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
                <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Bot size={18} /> Model Selection
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {models.map(model => (
                        <label
                            key={model.id}
                            style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 16,
                                padding: 'var(--space-md)',
                                borderRadius: 'var(--radius-md)',
                                border: `1px solid ${selectedModel === model.id ? 'var(--primary)' : 'var(--border)'}`,
                                background: selectedModel === model.id ? 'var(--primary-glow)' : 'rgba(255,255,255,0.02)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                        >
                            <input
                                type="radio"
                                name="model"
                                value={model.id}
                                checked={selectedModel === model.id}
                                onChange={() => changeModel(model.id)}
                                style={{ marginTop: 2, accentColor: 'var(--primary)' }}
                            />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>{model.label}</div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8 }}>{model.description}</div>
                                <div style={{ display: 'flex', gap: 16, fontSize: '0.8rem' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-dim)' }}>
                                        <HardDrive size={12} /> {model.size} download
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-dim)' }}>
                                        <Cpu size={12} /> ~{model.vram} VRAM
                                    </span>
                                </div>
                            </div>
                        </label>
                    ))}
                </div>
            </div>

            {/* Load Model */}
            <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
                <h3 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={18} /> Load Model
                </h3>

                {aiStatus === 'loading' ? (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            <span>Downloading…</span>
                            <span>{loadProgress}%</span>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 100, height: 8, overflow: 'hidden', marginBottom: 8 }}>
                            <div style={{
                                height: '100%',
                                width: `${loadProgress}%`,
                                background: 'linear-gradient(90deg, var(--primary), var(--accent))',
                                transition: 'width 0.4s ease',
                                borderRadius: 100,
                            }} />
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{loadText}</div>
                    </>
                ) : aiStatus === 'ready' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#22c55e' }}>
                        <CheckCircle size={16} /> Model loaded and ready
                    </div>
                ) : (
                    <>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
                            Model weights are downloaded once and cached permanently in your browser's storage.
                        </p>
                        <button
                            onClick={() => loadModel()}
                            disabled={webGPUSupported === false}
                            style={{
                                padding: '10px 24px',
                                background: 'var(--primary)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 'var(--radius-md)',
                                cursor: webGPUSupported === false ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                                opacity: webGPUSupported === false ? 0.5 : 1,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                            }}
                        >
                            <Bot size={16} /> Load {models.find(m => m.id === selectedModel)?.label}
                        </button>
                    </>
                )}
            </div>

            {/* Cache Management */}
            <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                <h3 style={{ marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Trash2 size={18} /> Cache Management
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
                    Removing the cached model will require a re-download next time you load AI.
                </p>
                <button
                    onClick={handleClearCache}
                    style={{
                        padding: '8px 18px',
                        background: 'transparent',
                        color: cleared ? '#22c55e' : '#ef4444',
                        border: `1px solid ${cleared ? '#22c55e' : 'rgba(239,68,68,0.4)'}`,
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        transition: 'all 0.2s',
                    }}
                >
                    {cleared ? <CheckCircle size={14} /> : <Trash2 size={14} />}
                    {cleared ? 'Cache Cleared!' : 'Clear Model Cache'}
                </button>
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
