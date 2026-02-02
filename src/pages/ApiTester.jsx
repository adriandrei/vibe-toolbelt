import React, { useState, useEffect } from 'react'
import { Send, Plus, Trash2, Clock, RotateCw, Globe, Code, FileJson, AlertCircle, X } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export default function ApiTester() {
    useDocumentTitle('API Tester')

    // Request State
    const [method, setMethod] = useState('GET')
    const [url, setUrl] = useState('https://jsonplaceholder.typicode.com/todos/1')
    const [params, setParams] = useState([{ key: '', value: '' }])
    const [headers, setHeaders] = useState([{ key: 'Content-Type', value: 'application/json' }])
    const [body, setBody] = useState('{\n  "title": "foo",\n  "body": "bar",\n  "userId": 1\n}')
    const [activeTab, setActiveTab] = useState('params')

    // Response State
    const [isLoading, setIsLoading] = useState(false)
    const [response, setResponse] = useState(null)
    const [error, setError] = useState(null)

    // History
    const [history, setHistory] = useState([])

    useEffect(() => {
        const saved = localStorage.getItem('api-history')
        if (saved) setHistory(JSON.parse(saved))

        // Init params from URL
        parseParamsFromUrl('https://jsonplaceholder.typicode.com/todos/1')
    }, [])

    // Sync Params <-> URL
    const parseParamsFromUrl = (newUrl) => {
        try {
            const urlObj = new URL(newUrl)
            const newParams = []
            urlObj.searchParams.forEach((value, key) => {
                newParams.push({ key, value })
            })
            if (newParams.length === 0) newParams.push({ key: '', value: '' })
            setParams(newParams)
        } catch (e) {
            // Invalid URL, ignore
        }
    }

    const updateUrlFromParams = (newParams) => {
        try {
            const urlObj = new URL(url)
            // Clear existing
            const keys = Array.from(urlObj.searchParams.keys())
            keys.forEach(k => urlObj.searchParams.delete(k))

            // Add new
            newParams.forEach(p => {
                if (p.key) urlObj.searchParams.append(p.key, p.value)
            })

            setUrl(urlObj.toString())
        } catch (e) {
            // If URL is invalid (e.g. empty), just store params state
        }
    }

    const handleUrlChange = (e) => {
        const val = e.target.value
        setUrl(val)
        // Debounce param parsing? For now direct
        parseParamsFromUrl(val)
    }

    const updateParam = (i, field, val) => {
        const newParams = [...params]
        newParams[i][field] = val
        setParams(newParams)
        updateUrlFromParams(newParams)
    }

    const addParam = () => setParams([...params, { key: '', value: '' }])
    const removeParam = (i) => {
        const newParams = params.filter((_, idx) => idx !== i)
        setParams(newParams)
        updateUrlFromParams(newParams)
    }

    const saveToHistory = (req) => {
        const newHistory = [req, ...history.filter(h => h.url !== req.url || h.method !== req.method)].slice(0, 20)
        setHistory(newHistory)
        localStorage.setItem('api-history', JSON.stringify(newHistory))
    }

    const loadRequest = (req) => {
        setMethod(req.method)
        setUrl(req.url)
        parseParamsFromUrl(req.url)
    }

    const sendRequest = async () => {
        setIsLoading(true)
        setResponse(null)
        setError(null)
        const startTime = performance.now()

        try {
            const options = {
                method,
                headers: headers.reduce((acc, h) => {
                    if (h.key) acc[h.key] = h.value
                    return acc
                }, {})
            }

            if (method !== 'GET' && method !== 'HEAD') {
                options.body = body
            }

            const res = await fetch(url, options)
            const endTime = performance.now()

            const contentType = res.headers.get('content-type')
            let data
            if (contentType && contentType.includes('application/json')) {
                data = await res.json()
            } else {
                data = await res.text()
            }

            const resData = {
                status: res.status,
                statusText: res.statusText,
                time: Math.round(endTime - startTime),
                size: new Blob([typeof data === 'string' ? data : JSON.stringify(data)]).size,
                headers: [...res.headers.entries()],
                body: data
            }

            setResponse(resData)
            saveToHistory({ method, url, timestamp: Date.now() })

        } catch (err) {
            setError(err.message)
            // Still capture fetch failures (network/CORS)
            setResponse({
                status: 0,
                statusText: 'Network Error',
                time: Math.round(performance.now() - startTime),
                body: null
            })
        }
        setIsLoading(false)
    }

    const addHeader = () => setHeaders([...headers, { key: '', value: '' }])
    const removeHeader = (i) => setHeaders(headers.filter((_, idx) => idx !== i))
    const updateHeader = (i, field, val) => {
        const newHeaders = [...headers]
        newHeaders[i][field] = val
        setHeaders(newHeaders)
    }

    // Styles & Helpers
    const getMethodColor = (m) => {
        switch (m) {
            case 'GET': return '#10b981';
            case 'POST': return '#3b82f6';
            case 'DELETE': return '#ef4444';
            case 'PUT': return '#f59e0b';
            case 'PATCH': return '#8b5cf6';
            default: return 'var(--text-muted)';
        }
    }

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: 'var(--space-md)', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>

            {/* Top Bar: Address Bar Style */}
            <div className="glass-panel" style={{ padding: '8px', display: 'flex', gap: 0, alignItems: 'center' }}>
                {/* Method Select */}
                <div style={{ position: 'relative', width: 100 }}>
                    <select
                        value={method}
                        onChange={e => setMethod(e.target.value)}
                        style={{
                            width: '100%',
                            appearance: 'none',
                            background: 'transparent',
                            color: getMethodColor(method),
                            border: 'none',
                            fontWeight: 700,
                            padding: '12px 16px',
                            cursor: 'pointer',
                            outline: 'none',
                            textAlign: 'center'
                        }}
                    >
                        {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>

                <div style={{ width: 1, height: 24, background: 'var(--border)' }}></div>

                {/* URL Input */}
                <input
                    type="text"
                    value={url}
                    onChange={handleUrlChange}
                    placeholder="Enter request URL"
                    style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-main)',
                        padding: '12px 16px',
                        fontSize: '1rem',
                        fontFamily: 'var(--font-mono)',
                        outline: 'none'
                    }}
                />

                {/* Send Button */}
                <button
                    onClick={sendRequest}
                    disabled={isLoading}
                    style={{
                        borderRadius: 'var(--radius-sm)',
                        margin: '4px',
                        padding: '10px 32px',
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        color: 'white',
                        border: 'none',
                        cursor: isLoading ? 'wait' : 'pointer',
                        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
                        transition: 'all 0.2s ease',
                        opacity: isLoading ? 0.8 : 1
                    }}
                    onMouseEnter={e => { if (!isLoading) e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(59, 130, 246, 0.5)'; }}
                    onMouseLeave={e => { if (!isLoading) e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)'; }}
                >
                    {isLoading ? <RotateCw className="spin" size={18} /> : <Send size={18} />}
                    <span style={{ fontWeight: 600, fontSize: '1rem', letterSpacing: '0.5px' }}>SEND</span>
                </button>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-md)', flex: 1, minHeight: 0 }} className="responsive-stack">

                {/* Left: Request Config */}
                <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                    {/* Tabs */}
                    <div style={{ display: 'flex', padding: 8, gap: 4, background: 'rgba(0,0,0,0.1)' }}>
                        {['params', 'headers', 'body'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    flex: 1,
                                    padding: '8px',
                                    background: activeTab === tab ? 'var(--bg-app)' : 'transparent',
                                    color: activeTab === tab ? 'var(--text-main)' : 'var(--text-muted)',
                                    border: '1px solid',
                                    borderColor: activeTab === tab ? 'var(--border)' : 'transparent',
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    fontWeight: 500,
                                    textTransform: 'capitalize',
                                    fontSize: '0.9rem',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
                        {activeTab === 'params' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8, marginBottom: 4, paddingLeft: 8 }}>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Key</label>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Value</label>
                                </div>
                                {params.map((p, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8 }}>
                                        <input
                                            placeholder="Key"
                                            value={p.key}
                                            onChange={e => updateParam(i, 'key', e.target.value)}
                                            style={{ padding: '8px 12px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 4, fontSize: '0.9rem' }}
                                        />
                                        <input
                                            placeholder="Value"
                                            value={p.value}
                                            onChange={e => updateParam(i, 'value', e.target.value)}
                                            style={{ padding: '8px 12px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 4, fontSize: '0.9rem' }}
                                        />
                                        <button onClick={() => removeParam(i)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.6 }}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                                <button onClick={addParam} style={{ width: 'fit-content', display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', marginTop: 8, fontSize: '0.9rem' }}>
                                    <Plus size={16} /> Add Param
                                </button>
                            </div>
                        )}

                        {activeTab === 'headers' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8, marginBottom: 4, paddingLeft: 8 }}>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Key</label>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Value</label>
                                </div>
                                {headers.map((h, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8 }}>
                                        <input
                                            placeholder="Key"
                                            value={h.key}
                                            onChange={e => updateHeader(i, 'key', e.target.value)}
                                            style={{ padding: '8px 12px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 4, fontSize: '0.9rem' }}
                                        />
                                        <input
                                            placeholder="Value"
                                            value={h.value}
                                            onChange={e => updateHeader(i, 'value', e.target.value)}
                                            style={{ padding: '8px 12px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 4, fontSize: '0.9rem' }}
                                        />
                                        <button onClick={() => removeHeader(i)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.6 }}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                                <button onClick={addHeader} style={{ width: 'fit-content', display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', marginTop: 8, fontSize: '0.9rem' }}>
                                    <Plus size={16} /> Add Header
                                </button>
                            </div>
                        )}

                        {activeTab === 'body' && (
                            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                <textarea
                                    value={body}
                                    onChange={e => setBody(e.target.value)}
                                    placeholder="{json_body}"
                                    style={{
                                        flex: 1,
                                        width: '100%',
                                        background: 'var(--bg-app)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--text-main)',
                                        fontFamily: "'JetBrains Mono', monospace",
                                        fontSize: '0.9rem',
                                        padding: 12,
                                        borderRadius: 4,
                                        resize: 'none',
                                        minHeight: '200px',
                                        lineHeight: 1.5
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Response */}
                <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '50px' }}>
                        <span style={{ fontWeight: 600 }}>Response</span>
                        {response && (
                            <div style={{ display: 'flex', gap: 12, fontSize: '0.85rem', alignItems: 'center' }}>
                                <span style={{ color: response.status >= 200 && response.status < 300 ? '#10b981' : '#ef4444', fontWeight: 700, padding: '2px 8px', background: response.status >= 200 && response.status < 300 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 4 }}>
                                    {response.status} {response.statusText}
                                </span>
                                <span style={{ color: 'var(--text-dim)' }}>
                                    {response.time} ms
                                </span>
                                <span style={{ color: 'var(--text-dim)' }}>
                                    {(response.size / 1024).toFixed(1)} KB
                                </span>
                            </div>
                        )}
                    </div>

                    <div style={{ flex: 1, overflow: 'auto', position: 'relative', background: '#0d0d0d' }}>
                        {error && (
                            <div style={{ padding: 20, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <AlertCircle size={20} />
                                Error: {error}
                            </div>
                        )}
                        {!response && !isLoading && !error && (
                            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
                                <Globe size={48} style={{ opacity: 0.1, marginBottom: 16 }} />
                                <div style={{ opacity: 0.5 }}>Ready to send request</div>
                            </div>
                        )}
                        {isLoading && (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div className="spinner"></div>
                            </div>
                        )}
                        {response && response.body && (
                            <SyntaxHighlighter
                                language="json"
                                style={vscDarkPlus}
                                customStyle={{ margin: 0, padding: '16px', minHeight: '100%', fontSize: '0.9rem', background: 'transparent' }}
                                wrapLines={true}
                            >
                                {typeof response.body === 'object' ? JSON.stringify(response.body, null, 2) : response.body}
                            </SyntaxHighlighter>
                        )}
                    </div>
                </div>
            </div>

            {/* History Dock */}
            <div style={{ marginTop: 0 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <Clock size={14} /> Recent Requests
                </div>
                {history.length === 0 ? (
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>No history yet</div>
                ) : (
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'thin' }}>
                        {history.map((req, i) => (
                            <button
                                key={i}
                                onClick={() => loadRequest(req)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 12px',
                                    background: 'var(--bg-panel)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    fontSize: '0.8rem',
                                    color: 'var(--text-main)',
                                    minWidth: '160px',
                                    maxWidth: '240px',
                                    transition: 'border-color 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                            >
                                <span style={{ fontWeight: 800, fontSize: '0.7rem', color: getMethodColor(req.method), minWidth: 35 }}>{req.method}</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-muted)' }}>{req.url}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <style>{`
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { 100% { transform: rotate(360deg); } }
                .spinner {
                    width: 32px; height: 32px;
                    border: 3px solid rgba(255,255,255,0.1);
                    border-radius: 50%;
                    border-top-color: var(--primary);
                    animation: spin 1s linear infinite;
                }
             `}</style>
        </div>
    )
}
