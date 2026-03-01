import React, { useState, useEffect } from 'react'
import { UAParser } from 'ua-parser-js'
import { Monitor, Smartphone, Globe, Cpu, Copy } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useSmartInput } from '../hooks/useSmartInput'

export default function UserAgent() {
    useDocumentTitle('User Agent Parser')
    const [uaString, setUaString] = useState(navigator.userAgent)
    const [result, setResult] = useState(null)

    useSmartInput({ input: setUaString })

    useEffect(() => {
        if (!uaString) {
            setResult(null)
            return
        }
        try {
            const parser = new UAParser(uaString)
            setResult(parser.getResult())
        } catch (e) {
            console.error(e)
        }
    }, [uaString])

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient">User Agent Parser</h2>
                <p style={{ color: 'var(--text-muted)' }}>Identify browser, engine, OS, CPU, and device type.</p>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-xl)' }}>
                <label style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>User Agent String</label>
                <textarea
                    value={uaString}
                    onChange={e => setUaString(e.target.value)}
                    style={{
                        width: '100%',
                        minHeight: '80px',
                        padding: '12px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-app)',
                        color: 'var(--text-main)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.9rem',
                        resize: 'vertical'
                    }}
                />
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button
                        onClick={() => setUaString(navigator.userAgent)}
                        style={{ fontSize: '0.8rem', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                        Use My Current UA
                    </button>
                </div>
            </div>

            {result && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)' }}>
                    <Card icon={<Globe size={24} color="#3b82f6" />} title="Browser">
                        <Row label="Name" value={result.browser.name} />
                        <Row label="Version" value={result.browser.version} />
                        <Row label="Major" value={result.browser.major} />
                    </Card>

                    <Card icon={<Monitor size={24} color="#a855f7" />} title="OS">
                        <Row label="Name" value={result.os.name} />
                        <Row label="Version" value={result.os.version} />
                    </Card>

                    <Card icon={<Cpu size={24} color="#ef4444" />} title="Engine">
                        <Row label="Name" value={result.engine.name} />
                        <Row label="Version" value={result.engine.version} />
                    </Card>

                    <Card icon={<Smartphone size={24} color="#10b981" />} title="Device">
                        <Row label="Vendor" value={result.device.vendor} />
                        <Row label="Model" value={result.device.model} />
                        <Row label="Type" value={result.device.type || 'Desktop'} />
                        <Row label="Arch" value={result.cpu.architecture} />
                    </Card>
                </div>
            )}
        </div>
    )
}

const Card = ({ icon, title, children }) => (
    <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', paddingBottom: 'var(--space-sm)', borderBottom: '1px solid var(--border)' }}>
            {icon}
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {children}
        </div>
    </div>
)

const Row = ({ label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontWeight: 500 }}>{value || '-'}</span>
    </div>
)
