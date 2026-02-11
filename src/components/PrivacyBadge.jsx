import React from 'react'
import { ShieldCheck } from 'lucide-react'

export default function PrivacyBadge({ className = '', style = {} }) {
    return (
        <div
            className={`privacy-badge ${className}`}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                borderRadius: '12px',
                background: 'rgba(16, 185, 129, 0.1)',
                color: '#10b981',
                fontSize: '0.75rem',
                fontWeight: 600,
                border: '1px solid rgba(16, 185, 129, 0.2)',
                userSelect: 'none',
                ...style
            }}
            title="All processing happens locally in your browser. No data is sent to any server."
        >
            <ShieldCheck size={12} />
            <span>100% Client-Side</span>
        </div>
    )
}
