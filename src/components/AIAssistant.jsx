import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAI } from '../contexts/AIContext'
import { usePipeline } from '../contexts/PipelineContext'
import { Bot, X, Send, Square, RotateCcw, ChevronDown, Upload } from 'lucide-react'

const SYSTEM_PROMPT = `You are an expert developer assistant embedded inside "Vibe Toolbelt" — a browser-based developer utility suite. 
You help users understand, debug, and work with code, tokens, regex patterns, SQL queries, JSON data, and similar technical content.
Be concise, precise, and practical. Use code blocks where appropriate. When showing examples, make them immediately usable.
Never break character — you are always a coding assistant, not a general AI.`

export default function AIAssistant() {
    const { aiStatus, aiPanelOpen, setAiPanelOpen, chat, abortChat, toolContext } = useAI()
    const { setPipelineData } = usePipeline()
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [streamingText, setStreamingText] = useState('')
    const [isStreaming, setIsStreaming] = useState(false)
    const bottomRef = useRef(null)
    const inputRef = useRef(null)

    const { tool = 'Tool', suggestedPrompts = [], getContext } = toolContext || {}

    useEffect(() => {
        if (aiPanelOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 100)
        }
    }, [aiPanelOpen])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, streamingText])

    // Reset conversation when switching tools
    useEffect(() => {
        setMessages([])
        setStreamingText('')
    }, [tool])

    const buildMessages = useCallback((userMessage) => {
        const contextData = getContext?.()
        let systemContent = SYSTEM_PROMPT

        if (contextData) {
            systemContent += `\n\nCurrent tool: ${tool}`
            if (contextData.input) {
                systemContent += `\nCurrent input:\n\`\`\`\n${contextData.input.slice(0, 2000)}\n\`\`\``
            }
            if (contextData.output) {
                systemContent += `\nCurrent output:\n\`\`\`\n${contextData.output.slice(0, 2000)}\n\`\`\``
            }
        }

        const history = messages.map(m => ({ role: m.role, content: m.content }))
        return [
            { role: 'system', content: systemContent },
            ...history,
            { role: 'user', content: userMessage }
        ]
    }, [messages, tool, getContext])

    const sendMessage = useCallback(async (text) => {
        if (!text.trim() || isStreaming || aiStatus !== 'ready') return

        const userMsg = { role: 'user', content: text, id: Date.now() }
        setMessages(prev => [...prev, userMsg])
        setInput('')
        setStreamingText('')
        setIsStreaming(true)

        let accum = ''
        await chat(buildMessages(text), {
            onToken: (token) => {
                accum += token
                setStreamingText(accum)
            },
            onDone: () => {
                setMessages(prev => [...prev, { role: 'assistant', content: accum, id: Date.now() }])
                setStreamingText('')
                setIsStreaming(false)
            },
            onAbort: () => {
                if (accum) {
                    setMessages(prev => [...prev, { role: 'assistant', content: accum + ' _(aborted)_', id: Date.now() }])
                }
                setStreamingText('')
                setIsStreaming(false)
            },
        })
    }, [input, isStreaming, aiStatus, chat, buildMessages])

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage(input)
        }
    }

    const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant')
    const latestContent = streamingText || lastAssistantMessage?.content || ''

    if (!aiPanelOpen) return null

    return (
        <div style={{
            position: 'fixed',
            right: 0,
            top: 0,
            bottom: 0,
            width: 380,
            zIndex: 500,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-panel)',
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid var(--border)',
            boxShadow: '-8px 0 40px rgba(0,0,0,0.4)',
            animation: 'slideInRight 0.25s ease',
        }}>
            {/* Header */}
            <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
                background: 'rgba(var(--primary-rgb), 0.05)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Bot size={16} color="#fff" />
                    </div>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>AI Assistant</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tool}</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    {messages.length > 0 && (
                        <button
                            onClick={() => setMessages([])}
                            title="Clear chat"
                            style={{ color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                        >
                            <RotateCcw size={14} />
                        </button>
                    )}
                    <button
                        onClick={() => setAiPanelOpen(false)}
                        style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {messages.length === 0 && !streamingText && (
                    <div style={{ textAlign: 'center', paddingTop: 20 }}>
                        <div style={{ fontSize: '2rem', marginBottom: 12 }}>🤖</div>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 20 }}>
                            I can see your current {tool} data. Ask me anything about it!
                        </p>
                        {suggestedPrompts.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: 4 }}>Suggested prompts:</div>
                                {suggestedPrompts.map((prompt, i) => (
                                    <button
                                        key={i}
                                        onClick={() => sendMessage(prompt)}
                                        disabled={aiStatus !== 'ready'}
                                        style={{
                                            padding: '8px 12px',
                                            borderRadius: 'var(--radius-sm)',
                                            background: 'rgba(255,255,255,0.04)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--text-main)',
                                            fontSize: '0.82rem',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            transition: 'all 0.15s',
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.borderColor = 'var(--primary)'
                                            e.currentTarget.style.background = 'var(--primary-glow)'
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.borderColor = 'var(--border)'
                                            e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                                        }}
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {messages.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} setPipelineData={setPipelineData} />
                ))}

                {streamingText && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{
                            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                            background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <Bot size={12} color="#fff" />
                        </div>
                        <div style={{
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--border)',
                            borderRadius: '0 12px 12px 12px',
                            padding: '10px 14px',
                            flex: 1,
                            fontSize: '0.875rem',
                            lineHeight: 1.6,
                            color: 'var(--text-main)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                        }}>
                            {streamingText}
                            <span style={{ display: 'inline-block', width: 6, height: 14, background: 'var(--primary)', marginLeft: 2, animation: 'blink 0.8s ease infinite', verticalAlign: 'text-bottom', borderRadius: 1 }} />
                        </div>
                    </div>
                )}

                <div ref={bottomRef} />
            </div>

            {/* Pipeline send button for latest response */}
            {latestContent && !isStreaming && (
                <div style={{ padding: '0 20px 8px', flexShrink: 0 }}>
                    <button
                        onClick={() => setPipelineData(latestContent)}
                        style={{
                            width: '100%',
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'transparent',
                            border: '1px dashed var(--primary)',
                            color: 'var(--primary)',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                        }}
                    >
                        <Upload size={13} /> Send AI response to Pipeline
                    </button>
                </div>
            )}

            {/* Input */}
            <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={aiStatus !== 'ready' ? 'AI is not ready yet…' : 'Ask anything about your data…'}
                        disabled={aiStatus !== 'ready' && !isStreaming}
                        rows={2}
                        style={{
                            flex: 1,
                            resize: 'none',
                            padding: '10px 14px',
                            borderRadius: 'var(--radius-md)',
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-main)',
                            fontSize: '0.875rem',
                            lineHeight: 1.5,
                            outline: 'none',
                            fontFamily: 'inherit',
                        }}
                    />
                    <button
                        onClick={isStreaming ? abortChat : () => sendMessage(input)}
                        style={{
                            padding: '0 14px',
                            borderRadius: 'var(--radius-md)',
                            background: isStreaming ? 'rgba(239,68,68,0.15)' : 'var(--primary)',
                            border: isStreaming ? '1px solid rgba(239,68,68,0.4)' : 'none',
                            color: isStreaming ? '#ef4444' : '#fff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                        title={isStreaming ? 'Stop generation' : 'Send (Enter)'}
                    >
                        {isStreaming ? <Square size={16} /> : <Send size={16} />}
                    </button>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 6, textAlign: 'center' }}>
                    Enter to send · Shift+Enter for newline · Running 100% in your browser
                </div>
            </div>

            <style>{`
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }
            `}</style>
        </div>
    )
}

function MessageBubble({ msg, setPipelineData }) {
    const isUser = msg.role === 'user'
    return (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: isUser ? 'row-reverse' : 'row' }}>
            {!isUser && (
                <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Bot size={12} color="#fff" />
                </div>
            )}
            <div style={{ maxWidth: '85%' }}>
                <div style={{
                    background: isUser ? 'var(--primary)' : 'rgba(255,255,255,0.04)',
                    border: isUser ? 'none' : '1px solid var(--border)',
                    borderRadius: isUser ? '12px 12px 0 12px' : '0 12px 12px 12px',
                    padding: '10px 14px',
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                    color: isUser ? '#fff' : 'var(--text-main)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}>
                    {msg.content}
                </div>
                {!isUser && (
                    <button
                        onClick={() => setPipelineData(msg.content)}
                        style={{
                            marginTop: 4,
                            fontSize: '0.7rem',
                            color: 'var(--text-dim)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 4px',
                        }}
                    >
                        <Upload size={10} /> Send to Pipeline
                    </button>
                )}
            </div>
        </div>
    )
}
