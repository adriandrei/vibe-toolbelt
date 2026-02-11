import React from 'react';
import { Shield } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const Privacy = () => {
    useDocumentTitle('Privacy Policy');

    const styles = {
        textContent: {
            padding: '2rem',
            lineHeight: 1.6,
        },
        sectionTitle: {
            marginTop: '2rem',
            marginBottom: '1rem',
            color: 'var(--text-main)',
            fontSize: '1.5rem',
            fontWeight: 600
        },
        paragraph: {
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
        },
        list: {
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
            listStyleType: 'disc',
            paddingLeft: '1.5rem',
        },
        link: {
            color: 'var(--primary)',
            textDecoration: 'none',
        }
    };

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
                <div className="glass-panel" style={styles.textContent}>
                    <h2 style={styles.sectionTitle}>No Server-Side Storage</h2>
                    <p style={styles.paragraph}>
                        Vibe Toolbelt is a client-side application. We do not store any of your data on our servers.
                        All processing happens locally in your browser.
                    </p>

                    <h2 style={styles.sectionTitle}>Local Storage</h2>
                    <p style={styles.paragraph}>
                        We use your browser's Local Storage to save your preferences, such as:
                    </p>
                    <ul style={styles.list}>
                        <li>Your "Favorites" list of tools.</li>
                        <li>Theme preferences (if applicable).</li>
                        <li>Recent inputs (where explicitly saved by you).</li>
                    </ul>

                    <h2 style={styles.sectionTitle}>Third-Party Services</h2>
                    <p style={styles.paragraph}>
                        This application is hosted statically. No user-generated content is transmitted to us.
                    </p>

                    <h2 style={styles.sectionTitle}>Contact</h2>
                    <p style={styles.paragraph}>
                        If you have any privacy concerns, please contact us at <a href="mailto:adriandrei@hotmail.com" style={styles.link}>adriandrei@hotmail.com</a>.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Privacy;
