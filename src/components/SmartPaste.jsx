import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { analyzeContent } from '../utils/analyzers';
import './SmartPaste.css';

export default function SmartPaste() {
    const [suggestion, setSuggestion] = useState(null);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const handlePaste = (e) => {
            // Ignore if pasting into an input/textarea (user usually knows what they are doing)
            // UNLESS it's the body or a non-input element
            const targetTag = e.target.tagName.toLowerCase();
            if (targetTag === 'input' || targetTag === 'textarea') {
                return;
            }

            const text = e.clipboardData.getData('text');
            if (!text) return;

            const result = analyzeContent(text);

            // If matched tool is current page, ignore
            if (result && location.pathname !== result.tool) {
                // Suggestion logic
                setSuggestion(result);

                // Auto-hide after 8 seconds
                setTimeout(() => setSuggestion(null), 8000);
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [location.pathname]);

    if (!suggestion) return null;

    return (
        <div className="smart-toast glass-panel">
            <div className="icon-area">
                <Sparkles size={32} color="var(--accent)" fill="var(--accent)" style={{ opacity: 0.8 }} />
            </div>
            <div className="content-area">
                <div className="title">Smart Detect</div>
                <div className="desc">
                    Looks like <strong>{suggestion.label}</strong> content.
                </div>
            </div>
            <div className="actions">
                <button
                    className="btn-go"
                    onClick={() => {
                        navigate(suggestion.tool);
                        setSuggestion(null);
                    }}
                >
                    Open Tool <ArrowRight size={14} />
                </button>
                <button
                    className="btn-close"
                    onClick={() => setSuggestion(null)}
                >
                    <X size={16} />
                </button>
            </div>

        </div>
    );
}
