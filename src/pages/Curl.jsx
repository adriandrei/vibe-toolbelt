import React, { useState, useEffect } from 'react'
import { Copy, Terminal, Code } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Curl() {
    useDocumentTitle('Curl to Fetch')
    const [curl, setCurl] = useState('')
    const [output, setOutput] = useState('')

    useEffect(() => {
        if (!curl.trim()) {
            setOutput('')
            return
        }

        // Very basic naive parser for demonstration
        try {
            let url = ''
            let method = 'GET'
            let headers = {}
            let body = null

            // Extract URL (simplistic: look for http/s)
            const urlMatch = curl.match(/'(http[^']*)'|"(http[^"]*)"|(http\S+)/)
            if (urlMatch) url = urlMatch[1] || urlMatch[2] || urlMatch[3]

            // Extract Method
            if (curl.includes('-X POST') || curl.includes('--request POST') || curl.includes('-d ')) method = 'POST'
            if (curl.includes('-X PUT')) method = 'PUT'
            if (curl.includes('-X DELETE')) method = 'DELETE'
            if (curl.includes('-X PATCH')) method = 'PATCH'

            // Extract Headers
            const headerRegex = /-H ['"]([^'"]+)['"]/g
            let match
            while ((match = headerRegex.exec(curl)) !== null) {
                const parts = match[1].split(':')
                if (parts.length >= 2) {
                    headers[parts[0].trim()] = parts.slice(1).join(':').trim()
                }
            }

            // Extract Body (-d or --data)
            const dataMatch = curl.match(/(-d|--data)\s+['"]([^'"]+)['"]/)
            if (dataMatch) {
                body = dataMatch[2]
            }

            // Generate Code
            const code = `fetch('${url}', {
    method: '${method}',
    headers: ${JSON.stringify(headers, null, 4).replace(/"([^"]+)":/g, '$1:')},${body ? `\n    body: JSON.stringify(${body})` : ''}
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));`

            setOutput(code)

        } catch (e) {
            setOutput('// Error parsing curl command')
        }
    }, [curl])

    return (
        <div style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
                <h2 className="text-gradient">Curl Converter</h2>
                <p style={{ color: 'var(--text-muted)' }}>Convert Curl commands to JavaScript Fetch.</p>
            </div>

            <div className="split-pane">
                {/* Input */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-sm)' }}>
                        <Terminal size={16} /> Curl Command
                    </label>
                    <textarea
                        value={curl}
                        onChange={e => setCurl(e.target.value)}
                        placeholder="curl -X POST https://api.example.com/data -H 'Content-Type: application/json' -d '{...}'"
                        style={{
                            flex: 1,
                            padding: '12px',
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-main)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            resize: 'none',
                            minHeight: '150px'
                        }}
                    />
                </div>

                {/* Output */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Code size={16} /> Fetch (JavaScript)
                        </label>
                        <button
                            onClick={() => navigator.clipboard.writeText(output)}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}
                        >
                            <Copy size={14} /> Copy
                        </button>
                    </div>
                    <textarea
                        readOnly
                        value={output}
                        style={{
                            flex: 1,
                            padding: '12px',
                            background: '#1e1e1e', // Code background
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            color: '#d4d4d4',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.85rem',
                            resize: 'none',
                            minHeight: '150px'
                        }}
                    />
                </div>
            </div>
        </div>
    )
}
