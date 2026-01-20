import React from 'react';
import { Shield } from 'lucide-react';

const Privacy = () => {
    return (
        <div className="tool-page">
            <header className="tool-header">
                <Shield className="tool-icon" />
                <div className="tool-title">
                    <h1>Privacy Policy</h1>
                    <p className="tool-description">How we handle your data</p>
                </div>
            </header>

            <div className="tool-content">
                <div className="glass-panel text-content">
                    <h2>No Server-Side Storage</h2>
                    <p>
                        Vibe Toolbelt is a client-side application. We do not store any of your data on our servers.
                        All processing happens locally in your browser.
                    </p>

                    <h2>Local Storage</h2>
                    <p>
                        We use your browser's Local Storage to save your preferences, such as:
                    </p>
                    <ul>
                        <li>Your "Favorites" list of tools.</li>
                        <li>Theme preferences (if applicable).</li>
                        <li>Recent inputs (where explicitly saved by you).</li>
                    </ul>

                    <h2>Third-Party Services</h2>
                    <p>
                        This application is hosted statically. No user-generated content is transmitted to us.
                    </p>

                    <h2>Contact</h2>
                    <p>
                        If you have any privacy concerns, please contact us at <a href="mailto:adriandrei@hotmail.com" className="accent-link">adriandrei@hotmail.com</a>.
                    </p>
                </div>
            </div>

            <style jsx>{`
                .text-content {
                    padding: 2rem;
                    line-height: 1.6;
                }
                .text-content h2 {
                    margin-top: 2rem;
                    margin-bottom: 1rem;
                    color: var(--text-main);
                }
                .text-content p, .text-content ul {
                    color: var(--text-secondary);
                    margin-bottom: 1rem;
                }
                .text-content ul {
                    list-style-type: disc;
                    padding-left: 1.5rem;
                }
                .accent-link {
                    color: var(--accent);
                    text-decoration: none;
                }
                .accent-link:hover {
                    text-decoration: underline;
                }
            `}</style>
        </div>
    );
};

export default Privacy;
