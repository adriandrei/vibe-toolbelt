import React, { useState, useEffect } from 'react'
import { Network, ArrowRight, Copy, Activity } from 'lucide-react'
import { Address4, Address6 } from 'ip-address'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function CidrCalculator() {
    useDocumentTitle('CIDR Calculator')
    const [input, setInput] = useState('')
    const [result, setResult] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!input.trim()) {
            setResult(null)
            setError(null)
            return
        }

        try {
            let addr4 = null
            let addr6 = null
            let isV4 = false

            // Try to parse as IPv4
            try {
                addr4 = new Address4(input)
                if (addr4.isCorrect()) isV4 = true
            } catch (e) {
                // Not v4
            }

            // If not V4, try V6
            if (!isV4) {
                try {
                    addr6 = new Address6(input)
                } catch (e) {
                    // Not v6
                }
            }

            if (isV4 && addr4) {
                generateResultV4(addr4)
                setError(null)
                return
            }

            if (addr6 && addr6.isCorrect()) {
                generateResultV6(addr6)
                setError(null)
                return
            }

            setError('Invalid IP address or CIDR format')
            setResult(null)

        } catch (e) {
            console.error(e)
            setError('Invalid format')
            setResult(null)
        }
    }, [input])

    const generateResultV4 = (addr) => {
        // addr is Address4 instance
        const start = addr.startAddress().correctForm()
        const end = addr.endAddress().correctForm()

        // Calculate hosts: 2^(32 - subnet)
        // addr.subnet is likely a string '/24', we need number
        const mask = parseInt(addr.subnet.replace('/', ''), 10)
        const hosts = Math.pow(2, 32 - mask)

        setResult({
            type: 'IPv4',
            ip: addr.address,
            start: start,
            end: end,
            hosts: hosts.toLocaleString(),
            netmask: addr.subnetMask,
            broadcast: end
        })
    }

    const generateResultV6 = (addr) => {
        const start = addr.startAddress().correctForm()
        const end = addr.endAddress().correctForm()

        // addr.subnet is '/64'
        const mask = parseInt(addr.subnet.replace('/', ''), 10)
        // 2^(128 - mask) is huge, use BigInt
        const hosts = (BigInt(1) << BigInt(128 - mask)).toString()

        setResult({
            type: 'IPv6',
            ip: addr.address,
            start: start,
            end: end,
            hosts: hosts,
            netmask: 'N/A for IPv6',
            broadcast: 'N/A'
        })
    }

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text)
    }

    const ResultRow = ({ label, value }) => (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px',
            borderBottom: '1px solid var(--border)',
        }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-main)',
                    fontSize: '0.95rem',
                    textAlign: 'right',
                    wordBreak: 'break-all',
                    maxWidth: '400px'
                }}>
                    {value || '-'}
                </span>
                {value && (
                    <button
                        onClick={() => copyToClipboard(value)}
                        className="action-btn"
                        title="Copy"
                        style={{ padding: 4 }}
                    >
                        <Copy size={14} color="var(--primary)" />
                    </button>
                )}
            </div>
        </div>
    )

    return (
        <div className="container">
            <h1 className="tool-title">
                <Network className="tool-icon" />
                IP / CIDR Calculator
            </h1>
            <p className="tool-desc">
                Calculate IP range and subnet details from a CIDR block (e.g., 10.0.0.0/16 or 2001:db8::/32).
            </p>

            <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                <div style={{ marginBottom: '2rem' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>CIDR Block or IP</label>
                    <div style={{ position: 'relative' }}>
                        <input
                            type="text"
                            placeholder="e.g. 10.0.0.0/16"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            style={{ paddingLeft: '40px' }}
                        />
                        <Activity size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    </div>
                </div>

                {result && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <h3 className="section-title">Network Details</h3>
                            <span style={{
                                background: 'var(--primary-light)',
                                color: 'var(--primary)',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '0.8rem',
                                fontWeight: 700
                            }}>
                                {result.type}
                            </span>
                        </div>

                        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                            <ResultRow label="Start IP" value={result.start} />
                            <ResultRow label="End IP" value={result.end} />
                            <ResultRow label="Total Hosts" value={result.hosts} />
                            {result.type === 'IPv4' && <ResultRow label="Netmask" value={result.netmask} />}
                            {result.type === 'IPv4' && <ResultRow label="Broadcast" value={result.broadcast} />}
                        </div>
                        {error && <div style={{ color: '#ef4444', marginTop: '8px', fontSize: '0.9rem' }}>{error}</div>}

                        <div style={{
                            marginTop: '1rem',
                            padding: '1rem',
                            background: 'rgba(16, 185, 129, 0.1)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid rgba(16, 185, 129, 0.2)',
                            fontSize: '0.9rem',
                            color: 'var(--text-main)',
                            display: 'flex',
                            gap: '12px'
                        }}>
                            <Activity size={20} color="#10b981" />
                            <div>
                                <strong>Valid Block</strong>
                                <br />
                                Calculation successful.
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
