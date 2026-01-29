import React, { useState, useEffect } from 'react'
import { faker } from '@faker-js/faker'
import { Copy, RefreshCw, Type } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Lorem() {
    useDocumentTitle('Lorem Ipsum')
    const [count, setCount] = useState(3)
    const [unit, setUnit] = useState('paragraphs') // paragraphs, sentences, words
    const [text, setText] = useState('')

    const generate = () => {
        if (unit === 'paragraphs') {
            setText(faker.lorem.paragraphs(count))
        } else if (unit === 'sentences') {
            setText(faker.lorem.sentences(count))
        } else {
            setText(faker.lorem.words(count))
        }
    }

    useEffect(() => {
        generate()
    }, []) // Generate on mount

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Lorem Ipsum</h2>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem' }}>Count</label>
                    <input type="number" min="1" max="100" value={count} onChange={e => setCount(Number(e.target.value))} style={{ width: '100%', padding: '8px' }} />
                </div>

                <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem' }}>Unit</label>
                    <select value={unit} onChange={e => setUnit(e.target.value)} style={{ width: '100%', padding: '8px', background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 6 }}>
                        <option value="paragraphs">Paragraphs</option>
                        <option value="sentences">Sentences</option>
                        <option value="words">Words</option>
                    </select>
                </div>

                <div style={{ alignSelf: 'flex-end' }}>
                    <button
                        onClick={generate}
                        style={{
                            background: 'var(--primary)',
                            color: '#fff',
                            padding: '10px 16px',
                            borderRadius: 6,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontWeight: 600
                        }}
                    >
                        <RefreshCw size={16} /> Generate
                    </button>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-lg)', position: 'relative', minHeight: '300px' }}>
                <button
                    onClick={() => navigator.clipboard.writeText(text)}
                    style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        color: 'var(--primary)'
                    }}
                >
                    <Copy size={14} /> Copy
                </button>

                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '1.1rem' }}>
                    {text}
                </div>
            </div>
        </div>
    )
}
