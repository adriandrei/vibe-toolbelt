import React, { useState, useEffect, useCallback } from 'react'
import { Shield, ShieldAlert, ShieldCheck, Key, CheckCircle, XCircle, Loader, Info } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import * as jose from 'jose'
import { useSmartInput } from '../hooks/useSmartInput'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'

const decodePart = (part) => {
    try {
        const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(decoded)
    } catch (e) {
        return null
    }
}

export default function Jwt() {
    useDocumentTitle('JWT Decoder')
    const [token, setToken] = useState('')
    const [decoded, setDecoded] = useState(null)
    const [error, setError] = useState(null)

    // Verification state
    const [secret, setSecret] = useState('')
    const [verificationResult, setVerificationResult] = useState(null) // null | 'valid' | 'invalid' | 'checking'
    const [verificationError, setVerificationError] = useState(null)

    useSmartInput({ input: setToken })

    useEffect(() => {
        if (!token) {
            setDecoded(null)
            setError(null)
            setVerificationResult(null)
            setVerificationError(null)
            return
        }

        const parts = token.split('.')
        if (parts.length !== 3) {
            setError('Invalid JWT format (must have 3 parts)')
            setDecoded(null)
            return
        }

        const header = decodePart(parts[0])
        const payload = decodePart(parts[1])
        const signature = parts[2]

        if (!header || !payload) {
            setError('Failed to decode Base64Url components')
            setDecoded(null)
            return
        }

        setError(null)
        setDecoded({ header, payload, signature })
        // Reset verification when token changes
        setVerificationResult(null)
        setVerificationError(null)
    }, [token])

    const verifySignature = useCallback(async () => {
        if (!token || !secret || !decoded) return

        setVerificationResult('checking')
        setVerificationError(null)

        try {
            const alg = decoded.header?.alg || 'HS256'

            if (alg.startsWith('HS')) {
                // HMAC signature (HS256, HS384, HS512)
                const secretKey = new TextEncoder().encode(secret)
                await jose.jwtVerify(token, secretKey, {
                    algorithms: [alg]
                })
                setVerificationResult('valid')
            } else if (alg.startsWith('RS') || alg.startsWith('PS') || alg.startsWith('ES')) {
                // RSA/EC public key verification
                try {
                    const publicKey = await jose.importSPKI(secret, alg)
                    await jose.jwtVerify(token, publicKey, {
                        algorithms: [alg]
                    })
                    setVerificationResult('valid')
                } catch (e) {
                    // Try JWK format
                    try {
                        const jwk = JSON.parse(secret)
                        const publicKey = await jose.importJWK(jwk, alg)
                        await jose.jwtVerify(token, publicKey, {
                            algorithms: [alg]
                        })
                        setVerificationResult('valid')
                    } catch (jwkError) {
                        setVerificationError(`Key format error: ${e.message}`)
                        setVerificationResult('invalid')
                    }
                }
            } else {
                setVerificationError(`Unsupported algorithm: ${alg}`)
                setVerificationResult('invalid')
            }
        } catch (e) {
            if (e.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
                setVerificationResult('invalid')
                setVerificationError('Signature does not match')
            } else if (e.code === 'ERR_JWT_EXPIRED') {
                setVerificationResult('invalid')
                setVerificationError('Token has expired')
            } else {
                setVerificationResult('invalid')
                setVerificationError(e.message)
            }
        }
    }, [token, secret, decoded])

    const getAlgorithmHint = () => {
        if (!decoded?.header?.alg) return null
        const alg = decoded.header.alg
        if (alg.startsWith('HS')) return 'Enter your shared secret key'
        if (alg.startsWith('RS') || alg.startsWith('PS')) return 'Enter RSA public key (PEM or JWK format)'
        if (alg.startsWith('ES')) return 'Enter EC public key (PEM or JWK format)'
        return 'Enter verification key'
    }

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div className="glass-panel" style={{ padding: 'var(--space-xl)' }}>
                <h2 className="text-gradient" style={{ fontSize: '1.8rem', marginBottom: 'var(--space-lg)' }}>JWT Decoder & Verifier</h2>

                {/* Input */}
                <div style={{ marginBottom: 'var(--space-xl)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                        <label style={{ color: 'var(--text-muted)' }}>Paste JWT Token</label>
                        <PipelineRead onRead={setToken} />
                    </div>
                    <textarea
                        value={token}
                        onChange={(e) => setToken(e.target.value.trim())}
                        placeholder="eyJh..."
                        style={{
                            fontFamily: 'var(--font-mono)',
                            minHeight: '100px',
                            color: error ? 'var(--accent)' : 'var(--text-main)',
                            borderColor: error ? 'var(--accent)' : 'var(--border)'
                        }}
                    />
                    {error && (
                        <div style={{ color: 'var(--accent)', marginTop: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ShieldAlert size={16} /> {error}
                        </div>
                    )}
                </div>

                {/* Verification Section */}
                {decoded && (
                    <div className="glass-panel" style={{
                        padding: 'var(--space-lg)',
                        marginBottom: 'var(--space-xl)',
                        background: 'rgba(59, 130, 246, 0.05)',
                        border: '1px solid rgba(59, 130, 246, 0.2)'
                    }}>
                        <h3 style={{ color: 'var(--text-main)', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Key size={18} /> Verify Signature
                            <span style={{
                                fontSize: '0.75rem',
                                padding: '2px 8px',
                                background: 'rgba(59, 130, 246, 0.2)',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--primary)'
                            }}>
                                {decoded.header?.alg || 'Unknown'}
                            </span>
                        </h3>

                        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: '200px' }}>
                                <label style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                    <Info size={12} /> {getAlgorithmHint()}
                                </label>
                                <textarea
                                    value={secret}
                                    onChange={(e) => {
                                        setSecret(e.target.value)
                                        setVerificationResult(null)
                                    }}
                                    placeholder={decoded.header?.alg?.startsWith('HS') ? 'your-256-bit-secret' : '-----BEGIN PUBLIC KEY-----\n...'}
                                    style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.85rem',
                                        minHeight: decoded.header?.alg?.startsWith('HS') ? '40px' : '80px',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>

                            <button
                                onClick={verifySignature}
                                disabled={!secret || verificationResult === 'checking'}
                                style={{
                                    padding: 'var(--space-md) var(--space-lg)',
                                    background: 'var(--primary)',
                                    color: '#fff',
                                    borderRadius: 'var(--radius-md)',
                                    fontWeight: 600,
                                    cursor: secret ? 'pointer' : 'not-allowed',
                                    opacity: secret ? 1 : 0.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    border: 'none',
                                    marginTop: '20px'
                                }}
                            >
                                {verificationResult === 'checking' ? (
                                    <><Loader size={16} className="spin" /> Verifying...</>
                                ) : (
                                    <><Shield size={16} /> Verify</>
                                )}
                            </button>
                        </div>

                        {/* Verification Result */}
                        {verificationResult && verificationResult !== 'checking' && (
                            <div style={{
                                marginTop: 'var(--space-md)',
                                padding: 'var(--space-md)',
                                borderRadius: 'var(--radius-md)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                background: verificationResult === 'valid'
                                    ? 'rgba(34, 197, 94, 0.1)'
                                    : 'rgba(239, 68, 68, 0.1)',
                                border: `1px solid ${verificationResult === 'valid' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                            }}>
                                {verificationResult === 'valid' ? (
                                    <>
                                        <CheckCircle size={20} style={{ color: '#22c55e' }} />
                                        <span style={{ color: '#22c55e', fontWeight: 600 }}>Signature Valid!</span>
                                    </>
                                ) : (
                                    <>
                                        <XCircle size={20} style={{ color: '#ef4444' }} />
                                        <span style={{ color: '#ef4444', fontWeight: 600 }}>
                                            Invalid Signature
                                            {verificationError && <span style={{ fontWeight: 400, marginLeft: 8 }}>— {verificationError}</span>}
                                        </span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Results */}
                {decoded ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-lg)' }}>
                        {/* Header */}
                        <div>
                            <h3 style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }}></span>
                                Header
                            </h3>
                            <pre className="glass-panel" style={{
                                padding: 'var(--space-md)',
                                margin: 0,
                                overflowX: 'auto',
                                fontSize: '0.9rem',
                                border: '1px solid rgba(239, 68, 68, 0.2)'
                            }}>
                                {JSON.stringify(decoded.header, null, 2)}
                            </pre>
                        </div>

                        {/* Payload */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                                <h3 style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#a855f7' }}></span>
                                    Payload
                                </h3>
                                <PipelineSend dataToSend={JSON.stringify(decoded.payload, null, 2)} />
                            </div>
                            <pre className="glass-panel" style={{
                                padding: 'var(--space-md)',
                                margin: 0,
                                overflowX: 'auto',
                                fontSize: '0.9rem',
                                border: '1px solid rgba(168, 85, 247, 0.2)'
                            }}>
                                {JSON.stringify(decoded.payload, null, 2)}
                            </pre>
                        </div>

                        {/* Signature */}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <h3 style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#3b82f6' }}></span>
                                Signature (Raw)
                            </h3>
                            <div className="glass-panel" style={{
                                padding: 'var(--space-md)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.85rem',
                                wordBreak: 'break-all',
                                color: 'var(--text-muted)',
                                border: '1px solid rgba(59, 130, 246, 0.2)'
                            }}>
                                {decoded.signature}
                            </div>
                        </div>
                    </div>
                ) : (
                    !error && !token && (
                        <div style={{
                            padding: 'var(--space-xl)',
                            textAlign: 'center',
                            color: 'var(--text-dim)',
                            border: '2px dashed var(--border)',
                            borderRadius: 'var(--radius-lg)'
                        }}>
                            <ShieldCheck size={48} style={{ opacity: 0.2, marginBottom: 'var(--space-md)' }} />
                            <p>Enter a JWT to decode and verify its signature.</p>
                        </div>
                    )
                )}
            </div>
        </div>
    )
}
