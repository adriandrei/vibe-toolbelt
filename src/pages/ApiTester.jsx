import React, { useState, useEffect } from 'react'
import {
    Send, Plus, Trash2, Clock, RotateCw, Globe, Code,
    FileJson, AlertCircle, X, Save, Folder, Settings,
    ChevronRight, ChevronDown, Play, Edit2, Eye, Key, Copy, DownloadCloud, Check
} from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useEscape } from '../hooks/useEscape'
import { useTheme } from '../components/ThemeProvider'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { generateCode } from '../utils/codeGenerator'
import { parseCurl } from '../utils/curlParser'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const AUTH_TYPES = ['None', 'Basic', 'Bearer']

export default function ApiTester() {
    useDocumentTitle('API Tester')
    const { theme } = useTheme()

    // Persistent State
    const [history, setHistory] = useLocalStorage('api-history', [])
    const [collections, setCollections] = useLocalStorage('api-collections', [])
    const [envs, setEnvs] = useLocalStorage('api-envs', [{ id: 'default', name: 'Default', vars: [] }])
    const [activeEnvId, setActiveEnvId] = useLocalStorage('api-active-env', 'default')

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

    // UI State
    const [showEnvModal, setShowEnvModal] = useState(false)
    const [showSaveModal, setShowSaveModal] = useState(false)
    const [saveName, setSaveName] = useState('')
    const [dockTab, setDockTab] = useState('history') // history | collections

    // Auth State
    const [authType, setAuthType] = useState('None')
    const [authData, setAuthData] = useState({ username: '', password: '', token: '' })

    // View State
    const [responseTab, setResponseTab] = useState('raw') // preview | raw
    const [showCodeModal, setShowCodeModal] = useState(false)
    const [showImportModal, setShowImportModal] = useState(false)
    const [importText, setImportText] = useState('')
    const [responseCopied, setResponseCopied] = useState(false)

    // Init Logic
    useEffect(() => {
        parseParamsFromUrl(url)
    }, [])

    useEscape(() => {
        if (showImportModal) setShowImportModal(false)
    })

    // --- Helpers ---

    const getActiveVars = () => envs.find(e => e.id === activeEnvId)?.vars || []

    const substitute = (str) => {
        if (!str || typeof str !== 'string') return str
        let res = str
        const vars = getActiveVars()
        vars.forEach(v => {
            if (v.key) {
                // Global replacement of {{key}}
                res = res.replaceAll(`{{${v.key}}}`, v.value)
            }
        })
        return res
    }

    const parseParamsFromUrl = (newUrl) => {
        try {
            // Handle incomplete URLs safely
            const dummyBase = 'https://dummy.com'
            const urlToParse = newUrl.startsWith('http') ? newUrl : dummyBase + (newUrl.startsWith('/') ? newUrl : '/' + newUrl)
            const urlObj = new URL(urlToParse)

            const newParams = []
            urlObj.searchParams.forEach((value, key) => {
                newParams.push({ key, value })
            })
            if (newParams.length === 0) newParams.push({ key: '', value: '' })
            setParams(newParams)
        } catch (e) {
            // Ignore parse errors while typing
        }
    }

    const updateUrlFromParams = (newParams) => {
        try {
            // This logic is tricky with variable substitution in URL. 
            // Simplified: We assume base URL matches current input, we just update query string.
            // If URL contains {{var}}, URL parsing might fail.
            // For now, let's just append query string to base path manually or skip auto-update if invalid.
            const parts = url.split('?')
            const baseUrl = parts[0]
            const queryParts = newParams.filter(p => p.key).map(p => `${p.key}=${p.value}`)
            if (queryParts.length > 0) {
                setUrl(`${baseUrl}?${queryParts.join('&')}`)
            } else {
                setUrl(baseUrl)
            }
        } catch (e) { }
    }

    const handleUrlChange = (e) => {
        const val = e.target.value
        setUrl(val)
        // Only parse params if it looks like a valid URL structure
        if (val.includes('?')) parseParamsFromUrl(val)
    }

    const updateAuthHeader = (type, data) => {
        let newHeaders = headers.filter(h => h.key.toLowerCase() !== 'authorization')
        let authVal = ''

        if (type === 'Basic' && (data.username || data.password)) {
            const token = btoa(`${data.username}:${data.password}`)
            authVal = `Basic ${token}`
        } else if (type === 'Bearer' && data.token) {
            authVal = `Bearer ${data.token}`
        }

        if (authVal) {
            newHeaders.push({ key: 'Authorization', value: authVal })
        }
        setHeaders(newHeaders)
    }

    // --- Actions ---

    const sendRequest = async () => {
        setIsLoading(true)
        setResponse(null)
        setError(null)
        const startTime = performance.now()

        try {
            // 1. Substitute Variables
            const finalUrl = substitute(url)
            const finalHeaders = headers.reduce((acc, h) => {
                if (h.key) acc[substitute(h.key)] = substitute(h.value)
                return acc
            }, {})
            const finalBody = substitute(body)

            const options = {
                method,
                headers: finalHeaders
            }

            if (method !== 'GET' && method !== 'HEAD') {
                options.body = finalBody
            }

            // 2. Send
            const res = await fetch(finalUrl, options)
            const endTime = performance.now()

            // 3. Process Response
            const contentType = res.headers.get('content-type')
            let data
            let size = 0

            // Clone buffer to read size and content
            const buffer = await res.arrayBuffer()
            size = buffer.byteLength
            const textDecoder = new TextDecoder('utf-8')
            const text = textDecoder.decode(buffer)

            if (contentType && contentType.includes('application/json')) {
                try {
                    data = JSON.parse(text)
                } catch {
                    data = text
                }
            } else {
                data = text
            }

            const resData = {
                status: res.status,
                statusText: res.statusText,
                time: Math.round(endTime - startTime),
                size: size,
                headers: [...res.headers.entries()],
                body: data
            }

            setResponse(resData)
            addToHistory({ method, url, timestamp: Date.now() })

        } catch (err) {
            setError(err.message)
            setResponse({
                status: 0,
                statusText: 'Network Error',
                time: Math.round(performance.now() - startTime),
                body: null,
                size: 0,
                headers: []
            })
        }
        setIsLoading(false)
    }

    const addToHistory = (req) => {
        const newHist = [req, ...history.filter(h => h.url !== req.url || h.method !== req.method)].slice(0, 50)
        setHistory(newHist)
    }

    const saveRequest = () => {
        if (!saveName.trim()) return
        const newReq = {
            id: Date.now(),
            name: saveName,
            method,
            url,
            headers,
            params,
            body
        }
        setCollections([...collections, newReq])
        setSaveName('')
        setShowSaveModal(false)
        setDockTab('collections')
    }

    const loadRequest = (req) => {
        setMethod(req.method)
        setUrl(req.url)
        setHeaders(req.headers || [])
        setParams(req.params || [])
        setBody(req.body || '')
        // Auto switch tab if body present
        if (req.body) setActiveTab('body')
    }

    const deleteCollectionItem = (id) => {
        setCollections(collections.filter(c => c.id !== id))
    }

    const handleImport = () => {
        if (!importText) return
        const parsed = parseCurl(importText)
        if (parsed && parsed.url) {
            setMethod(parsed.method || 'GET')
            setUrl(parsed.url)
            setHeaders(parsed.headers || [])
            setBody(parsed.body || '')
            // Check if URL has params and parse them
            if (parsed.url.includes('?')) parseParamsFromUrl(parsed.url)

            if (parsed.body) setActiveTab('body')
            setShowImportModal(false)
            setImportText('')
        } else {
            alert('Could not parse cURL command')
        }
    }

    // --- Sub-components (Moved outside to prevent re-creation) ---
    // See bottom of file for definitions

    // Helper for method colors
    const getMethodColor = (m) => {
        switch (m) {
            case 'GET': return '#10b981'; case 'POST': return '#3b82f6'; case 'DELETE': return '#ef4444';
            case 'PUT': return '#f59e0b'; case 'PATCH': return '#8b5cf6'; default: return 'var(--text-muted)';
        }
    }

    // Param/Header Updaters
    const updateParam = (i, f, v) => { const n = [...params]; n[i][f] = v; setParams(n); updateUrlFromParams(n) }
    const addParam = () => setParams([...params, { key: '', value: '' }])
    const removeParam = (i) => { const n = params.filter((_, idx) => idx !== i); setParams(n); updateUrlFromParams(n) }

    const updateHeader = (i, f, v) => { const n = [...headers]; n[i][f] = v; setHeaders(n) }
    const addHeader = () => setHeaders([...headers, { key: '', value: '' }])
    const removeHeader = (i) => setHeaders(headers.filter((_, idx) => idx !== i))

    // -------- Render --------

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: 'var(--space-md)', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>

            {/* Top Bar */}
            <div className="glass-panel" style={{ padding: '8px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ position: 'relative', width: 100 }}>
                    <select value={method} onChange={e => setMethod(e.target.value)} style={{ width: '100%', background: 'transparent', color: getMethodColor(method), border: 'none', fontWeight: 700, padding: '12px 16px', cursor: 'pointer', outline: 'none', textAlign: 'center', appearance: 'none' }}>
                        {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div style={{ width: 1, height: 24, background: 'var(--border)' }}></div>

                <input
                    value={url}
                    onChange={handleUrlChange}
                    placeholder="Enter URL (use {{var}} for environment variables)"
                    style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-main)', padding: '12px', fontSize: '1rem', fontFamily: 'var(--font-mono)', outline: 'none' }}
                />

                {/* Env & Actions */}
                <div style={{ display: 'flex', gap: 4, paddingRight: 8 }}>
                    <button onClick={() => setShowEnvModal(true)} title="Environments" style={{ padding: 8, background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <Globe size={18} color={activeEnvId !== 'default' ? 'var(--primary)' : 'currentColor'} />
                        <span style={{ fontSize: '0.6rem', color: activeEnvId !== 'default' ? 'var(--primary)' : 'var(--text-muted)' }}>{envs.find(e => e.id === activeEnvId)?.name.substring(0, 8)}</span>
                    </button>
                    <button onClick={() => setShowCodeModal(true)} title="Generate Code" style={{ padding: 8, background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                        <Code size={18} />
                    </button>
                    <button onClick={() => setShowImportModal(true)} title="Import cURL" style={{ padding: 8, background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                        <DownloadCloud size={18} />
                    </button>
                    <button onClick={() => setShowSaveModal(true)} title="Save Request" style={{ padding: 8, background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                        <Save size={18} />
                    </button>
                    <button onClick={sendRequest} disabled={isLoading} style={{ borderRadius: 'var(--radius-sm)', padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--primary)', color: 'white', border: 'none', cursor: isLoading ? 'wait' : 'pointer', opacity: isLoading ? 0.8 : 1, fontWeight: 600 }}>
                        {isLoading ? <RotateCw className="spin" size={18} /> : <Send size={18} />} SEND
                    </button>
                </div>
            </div>

            {/* Main Area */}
            <div style={{ display: 'flex', gap: 'var(--space-md)', flex: 1, minHeight: 0 }} className="responsive-stack">
                {/* Left: Config */}
                <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', padding: 8, gap: 4, background: 'rgba(0,0,0,0.1)' }}>
                        {['params', 'auth', 'headers', 'body'].map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: '8px', background: activeTab === tab ? 'var(--bg-app)' : 'transparent', color: activeTab === tab ? 'var(--text-main)' : 'var(--text-muted)', border: '1px solid', borderColor: activeTab === tab ? 'var(--border)' : 'transparent', borderRadius: 6, cursor: 'pointer', fontWeight: 500, textTransform: 'capitalize' }}>{tab}</button>
                        ))}
                    </div>
                    <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
                        {activeTab === 'params' && (
                            <div>
                                {params.map((p, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8, marginBottom: 8 }}>
                                        <input placeholder="Key" value={p.key} onChange={e => updateParam(i, 'key', e.target.value)} style={{ padding: '8px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)' }} />
                                        <input placeholder="Value" value={p.value} onChange={e => updateParam(i, 'value', e.target.value)} style={{ padding: '8px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)' }} />
                                        <button onClick={() => removeParam(i)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                    </div>
                                ))}
                                <button onClick={addParam} style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={16} /> Add Param</button>
                            </div>
                        )}
                        {activeTab === 'auth' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>Authorization Type</label>
                                    <select
                                        value={authType}
                                        onChange={e => {
                                            const newType = e.target.value
                                            setAuthType(newType)
                                            updateAuthHeader(newType, authData)
                                        }}
                                        style={{ width: '100%', padding: '10px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 6 }}
                                    >
                                        {AUTH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>

                                {authType === 'Basic' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>Username</label>
                                            <input
                                                value={authData.username}
                                                onChange={e => {
                                                    const newData = { ...authData, username: e.target.value }
                                                    setAuthData(newData)
                                                    updateAuthHeader(authType, newData)
                                                }}
                                                style={{ width: '100%', padding: '10px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 6 }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>Password</label>
                                            <input
                                                type="password"
                                                value={authData.password}
                                                onChange={e => {
                                                    const newData = { ...authData, password: e.target.value }
                                                    setAuthData(newData)
                                                    updateAuthHeader(authType, newData)
                                                }}
                                                style={{ width: '100%', padding: '10px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 6 }}
                                            />
                                        </div>
                                    </div>
                                )}

                                {authType === 'Bearer' && (
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>Token</label>
                                        <textarea
                                            value={authData.token}
                                            onChange={e => {
                                                const newData = { ...authData, token: e.target.value }
                                                setAuthData(newData)
                                                updateAuthHeader(authType, newData)
                                            }}
                                            rows={5}
                                            style={{ width: '100%', padding: '10px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 6, resize: 'vertical' }}
                                        />
                                    </div>
                                )}
                                {authType === 'None' && <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>No authorization header will be sent.</div>}
                            </div>
                        )}
                        {activeTab === 'headers' && (
                            <div>
                                {headers.map((h, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8, marginBottom: 8 }}>
                                        <input placeholder="Header" value={h.key} onChange={e => updateHeader(i, 'key', e.target.value)} style={{ padding: '8px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)' }} />
                                        <input placeholder="Value" value={h.value} onChange={e => updateHeader(i, 'value', e.target.value)} style={{ padding: '8px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)' }} />
                                        <button onClick={() => removeHeader(i)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                    </div>
                                ))}
                                <button onClick={addHeader} style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={16} /> Add Header</button>
                            </div>
                        )}
                        {activeTab === 'body' && (
                            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="{json_body}" style={{ width: '100%', height: '100%', minHeight: '300px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 4, padding: 12, color: 'var(--text-main)', fontFamily: 'monospace', resize: 'none' }} />
                        )}
                    </div>
                </div>

                {/* Right: Response */}
                <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => setResponseTab('preview')} style={{ padding: '6px 12px', background: responseTab === 'preview' ? 'var(--bg-app)' : 'transparent', color: responseTab === 'preview' ? 'var(--primary)' : 'var(--text-muted)', border: '1px solid', borderColor: responseTab === 'preview' ? 'var(--border)' : 'transparent', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' }}>Preview</button>
                            <button onClick={() => setResponseTab('raw')} style={{ padding: '6px 12px', background: responseTab === 'raw' ? 'var(--bg-app)' : 'transparent', color: responseTab === 'raw' ? 'var(--primary)' : 'var(--text-muted)', border: '1px solid', borderColor: responseTab === 'raw' ? 'var(--border)' : 'transparent', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' }}>Raw</button>
                        </div>
                        {response && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.85rem' }}>
                                <span style={{ color: response.status < 300 ? '#10b981' : '#ef4444' }}>{response.status} {response.statusText}</span>
                                <span style={{ color: 'var(--text-dim)' }}>{response.time}ms</span>
                                <span style={{ color: 'var(--text-dim)' }}>{(response.size / 1024).toFixed(1)}KB</span>
                                <button
                                    onClick={() => {
                                        const bodyStr = typeof response.body === 'object' ? JSON.stringify(response.body, null, 2) : response.body;
                                        navigator.clipboard.writeText(bodyStr);
                                        setResponseCopied(true);
                                        setTimeout(() => setResponseCopied(false), 2000);
                                    }}
                                    style={{ padding: '4px 8px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-main)', marginLeft: 'var(--space-md)' }}
                                    title="Copy Response Body"
                                >
                                    {responseCopied ? <Check size={14} color="#10b981" /> : <Copy size={14} />} {responseCopied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                        )}
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', background: '#0d0d0d', position: 'relative' }}>
                        {error && <div style={{ padding: 20, color: '#ef4444' }}>Error: {error}</div>}
                        {isLoading && <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><RotateCw className="spin" size={32} color="var(--primary)" /></div>}
                        {!response && !isLoading && !error && <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', opacity: 0.3 }}>Ready</div>}
                        {response && (
                            <>
                                {responseTab === 'preview' ? (
                                    <div style={{ width: '100%', height: '100%', background: theme === 'dark' ? '#1a1a1a' : '#fff', color: theme === 'dark' ? '#e4e4e7' : '#18181b' }}>
                                        {response.headers.find(h => h[0].toLowerCase() === 'content-type' && h[1].includes('image')) ? (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0d0d0d' }}>
                                                <img src={url} alt="Response" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                                            </div>
                                        ) : (
                                            <iframe 
                                                srcDoc={
                                                    typeof response.body === 'object' 
                                                        ? `<html><body style="font-family: monospace; padding: 20px; white-space: pre-wrap; word-break: break-all; background: ${theme === 'dark' ? '#1a1a1a' : '#fff'}; color: ${theme === 'dark' ? '#e4e4e7' : '#18181b'};">${JSON.stringify(response.body, null, 2)}</body></html>` 
                                                        : response.body
                                                } 
                                                style={{ width: '100%', height: '100%', border: 'none' }} 
                                                title="Response Preview" 
                                                sandbox="allow-scripts" 
                                            />
                                        )}
                                    </div>
                                ) : (
                                    <div
                                        tabIndex={0}
                                        onClick={e => e.currentTarget.focus()}
                                        onKeyDown={e => {
                                            if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
                                                e.preventDefault();
                                                const range = document.createRange();
                                                range.selectNodeContents(e.currentTarget);
                                                const sel = window.getSelection();
                                                sel.removeAllRanges();
                                                sel.addRange(range);
                                            }
                                        }}
                                        style={{ outline: 'none' }}
                                    >
                                        <SyntaxHighlighter language="json" style={vscDarkPlus} customStyle={{ margin: 0, padding: '16px', background: 'transparent' }} wrapLines={true}>
                                            {typeof response.body === 'object' ? JSON.stringify(response.body, null, 2) : response.body}
                                        </SyntaxHighlighter>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Dock (History/Collections) */}
            <div className="glass-panel" style={{ height: '200px', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                    <button onClick={() => setDockTab('history')} style={{ padding: '8px 16px', background: dockTab === 'history' ? 'var(--bg-app)' : 'transparent', color: dockTab === 'history' ? 'var(--text-main)' : 'var(--text-muted)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', fontWeight: 500 }}>
                        <Clock size={16} /> History
                    </button>
                    <button onClick={() => setDockTab('collections')} style={{ padding: '8px 16px', background: dockTab === 'collections' ? 'var(--bg-app)' : 'transparent', color: dockTab === 'collections' ? 'var(--text-main)' : 'var(--text-muted)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', fontWeight: 500 }}>
                        <Folder size={16} /> Collections
                    </button>
                    <div style={{ marginLeft: 'auto', padding: '8px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        {dockTab === 'history' ? `${history.length} items` : `${collections.length} saved`}
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                    {dockTab === 'history' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
                            {history.length === 0 && <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>No history yet</div>}
                            {history.map((req, i) => (
                                <button key={i} onClick={() => loadRequest(req)} style={{ padding: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, color: getMethodColor(req.method), minWidth: 35 }}>{req.method}</span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.url}</span>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginLeft: 'auto' }}>{new Date(req.timestamp).toLocaleTimeString()}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {dockTab === 'collections' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
                            {collections.length === 0 && <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>No saved requests. Save one from the top bar!</div>}
                            {collections.map((req) => (
                                <div key={req.id} style={{ padding: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', group: 'group' }}>
                                    <button onClick={() => loadRequest(req)} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                                        <span style={{ fontSize: '0.7rem', fontWeight: 800, color: getMethodColor(req.method), minWidth: 35 }}>{req.method}</span>
                                        <div style={{ overflow: 'hidden' }}>
                                            <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 500 }}>{req.name}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.url}</div>
                                        </div>
                                    </button>
                                    <button onClick={() => deleteCollectionItem(req.id)} style={{ padding: 6, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }} title="Delete">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            {showEnvModal && (
                <EnvModal
                    envs={envs}
                    setEnvs={setEnvs}
                    activeEnvId={activeEnvId}
                    setActiveEnvId={setActiveEnvId}
                    onClose={() => setShowEnvModal(false)}
                />
            )}
            {showSaveModal && (
                <SaveModal
                    saveName={saveName}
                    setSaveName={setSaveName}
                    onSave={saveRequest}
                    onClose={() => setShowSaveModal(false)}
                />
            )}
            {showCodeModal && (
                <CodeModal
                    method={method}
                    url={url}
                    headers={headers}
                    body={body}
                    onClose={() => setShowCodeModal(false)}
                />
            )}
            {showImportModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="glass-panel" style={{ width: '500px', padding: '24px', background: 'var(--bg-panel)' }}>
                        <h3 style={{ marginTop: 0 }}>Import cURL</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Paste your cURL command below to populate the request.</p>
                        <textarea
                            value={importText}
                            onChange={e => setImportText(e.target.value)}
                            placeholder="curl -X POST https://api.example.com ..."
                            style={{ width: '100%', height: '150px', padding: '10px', marginTop: '8px', marginBottom: '24px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 6, resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button onClick={() => setShowImportModal(false)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
                            <button onClick={handleImport} style={{ padding: '8px 16px', background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Import</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    )
}

// --- Sub-components (Moved outside) ---

const EnvModal = ({ envs, setEnvs, activeEnvId, setActiveEnvId, onClose }) => {
    useEscape(onClose)
    const activeEnv = envs.find(e => e.id === activeEnvId)

    const updateEnvName = (val) => {
        setEnvs(envs.map(e => e.id === activeEnvId ? { ...e, name: val } : e))
    }

    const addVar = () => {
        const newVars = [...activeEnv.vars, { key: '', value: '' }]
        setEnvs(envs.map(e => e.id === activeEnvId ? { ...e, vars: newVars } : e))
    }

    const updateVar = (capturedEnvId, idx, field, val) => {
        const targetEnv = envs.find(e => e.id === capturedEnvId)
        const newVars = [...targetEnv.vars]
        newVars[idx][field] = val
        setEnvs(envs.map(e => e.id === capturedEnvId ? { ...e, vars: newVars } : e))
    }

    const removeVar = (idx) => {
        const newVars = activeEnv.vars.filter((_, i) => i !== idx)
        setEnvs(envs.map(e => e.id === activeEnvId ? { ...e, vars: newVars } : e))
    }

    const createEnv = () => {
        const newId = Date.now().toString()
        const newEnv = { id: newId, name: 'New Environment', vars: [] }
        setEnvs([...envs, newEnv])
        setActiveEnvId(newId)
    }

    const deleteEnv = (id) => {
        if (envs.length <= 1) return
        const newEnvs = envs.filter(e => e.id !== id)
        setEnvs(newEnvs)
        if (activeEnvId === id) setActiveEnvId(newEnvs[0].id)
    }

    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) onClose()
    }

    return (
        <div onClick={handleOverlayClick} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="glass-panel" style={{ width: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)' }}>
                <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>Manage Environments</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>

                <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                    <div style={{ width: '180px', borderRight: '1px solid var(--border)', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(0,0,0,0.2)' }}>
                        {envs.map(e => (
                            <button
                                key={e.id}
                                onClick={() => setActiveEnvId(e.id)}
                                style={{
                                    padding: '8px 12px', textAlign: 'left', borderRadius: 6,
                                    background: activeEnvId === e.id ? 'var(--primary-glow)' : 'transparent',
                                    color: activeEnvId === e.id ? 'var(--primary)' : 'var(--text-muted)',
                                    border: activeEnvId === e.id ? '1px solid var(--primary)' : '1px solid transparent',
                                    cursor: 'pointer'
                                }}
                            >
                                {e.name}
                            </button>
                        ))}
                        <button onClick={createEnv} style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: 8, color: 'var(--text-dim)', background: 'transparent', border: '1px dashed var(--border)', borderRadius: 6, cursor: 'pointer' }}>
                            <Plus size={14} /> New Env
                        </button>
                    </div>

                    <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>Environment Name</label>
                            <input
                                value={activeEnv.name}
                                onChange={e => updateEnvName(e.target.value)}
                                style={{ width: '100%', padding: '8px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 4 }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                                    Use variables as <code style={{ color: 'var(--accent)' }}>{'{{key}}'}</code>
                                </div>
                                {envs.length > 1 && (
                                    <button onClick={() => deleteEnv(activeEnv.id)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
                                        <Trash2 size={12} /> Delete Env
                                    </button>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8, paddingLeft: 8 }}>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Variable</label>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Value</label>
                            </div>
                            {activeEnv.vars.map((v, i) => (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8 }}>
                                    <input placeholder="Key" value={v.key} onChange={e => updateVar(activeEnv.id, i, 'key', e.target.value)} style={{ padding: '6px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 4 }} />
                                    <input placeholder="Value" value={v.value} onChange={e => updateVar(activeEnv.id, i, 'value', e.target.value)} style={{ padding: '6px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 4 }} />
                                    <button onClick={() => removeVar(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                </div>
                            ))}
                            <button onClick={addVar} style={{ width: 'fit-content', display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', marginTop: 8 }}>
                                <Plus size={16} /> Add Variable
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

const SaveModal = ({ saveName, setSaveName, onSave, onClose }) => {
    useEscape(onClose)
    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) onClose()
    }
    return (
        <div onClick={handleOverlayClick} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="glass-panel" style={{ width: '400px', padding: '24px', background: 'var(--bg-panel)' }}>
                <h3 style={{ marginTop: 0 }}>Save Collection Request</h3>
                <input
                    placeholder="Request Name (e.g. Get User Profile)"
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    autoFocus
                    style={{ width: '100%', padding: '10px', marginTop: '16px', marginBottom: '24px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 6 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                    <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={onSave} style={{ padding: '8px 16px', background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Save</button>
                </div>
            </div>
        </div>
    )
}

const CodeModal = ({ method, url, headers, body, onClose }) => {
    useEscape(onClose)
    const [lang, setLang] = useState('curl')
    const code = generateCode({ method, url, headers, body }, lang)
    const [copied, setCopied] = useState(false)

    const copyCode = () => {
        navigator.clipboard.writeText(code)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) onClose()
    }

    return (
        <div onClick={handleOverlayClick} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="glass-panel" style={{ width: '700px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)' }}>
                <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>Generate Code</h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                    {['curl', 'fetch', 'python'].map(l => (
                        <button key={l} onClick={() => setLang(l)} style={{ padding: '12px 24px', background: lang === l ? 'var(--bg-app)' : 'transparent', color: lang === l ? 'var(--primary)' : 'var(--text-muted)', borderRight: '1px solid var(--border)', borderTop: 'none', borderLeft: 'none', borderBottom: lang === l ? '2px solid var(--primary)' : 'none', cursor: 'pointer', fontWeight: 500, textTransform: 'capitalize' }}>
                            {l}
                        </button>
                    ))}
                </div>
                <div style={{ padding: '16px', flex: 1, overflow: 'auto', position: 'relative' }}>
                    <button onClick={copyCode} style={{ position: 'absolute', top: 24, right: 24, padding: '4px 8px', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, zIndex: 10 }}>
                        {copied ? <Clock size={14} color="#10b981" /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                    </button>
                    <SyntaxHighlighter language={lang === 'curl' ? 'bash' : lang} style={vscDarkPlus} customStyle={{ margin: 0, padding: '16px', borderRadius: 8 }}>
                        {code}
                    </SyntaxHighlighter>
                </div>
            </div>
        </div>
    )
}
