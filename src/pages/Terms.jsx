import React from 'react';
import { FileText } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const Terms = () => {
    useDocumentTitle('Terms of Service');

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
        link: {
            color: 'var(--primary)',
            textDecoration: 'none',
        }
    };

    return (
        <div className="tool-page">
            <header className="tool-header">
                <FileText className="tool-icon" />
                <div className="tool-title">
                    <h1>Terms of Service</h1>
                    <p className="tool-description">Usage guidelines</p>
                </div>
            </header>

            <div className="tool-content">
                <div className="glass-panel" style={styles.textContent}>
                    <h2 style={styles.sectionTitle}>Disclaimer</h2>
                    <p style={styles.paragraph}>
                        Vibe Toolbelt is provided "as is", without warranty of any kind, express or implied.
                        In no event shall the authors or copyright holders be liable for any claim, damages or other liability,
                        whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software
                        or the use or other dealings in the software.
                    </p>

                    <h2 style={styles.sectionTitle}>Usage</h2>
                    <p style={styles.paragraph}>
                        You are free to use these tools for any personal or commercial purpose.
                        Please responsibly use generated data (e.g., from Faker or Key Generators).
                    </p>

                    <h2 style={styles.sectionTitle}>Changes</h2>
                    <p style={styles.paragraph}>
                        We reserve the right to modify these terms at any time. Continued use of the application constitutes acceptance of these terms.
                    </p>

                    <h2 style={styles.sectionTitle}>Contact</h2>
                    <p style={styles.paragraph}>
                        For any questions regarding these terms, please contact <a href="mailto:adriandrei@hotmail.com" style={styles.link}>adriandrei@hotmail.com</a>.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Terms;
