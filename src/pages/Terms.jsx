import React from 'react';
import { FileText } from 'lucide-react';

const Terms = () => {
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
                <div className="glass-panel text-content">
                    <h2>Disclaimer</h2>
                    <p>
                        Vibe Toolbelt is provided "as is", without warranty of any kind, express or implied.
                        In no event shall the authors or copyright holders be liable for any claim, damages or other liability,
                        whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software
                        or the use or other dealings in the software.
                    </p>

                    <h2>Usage</h2>
                    <p>
                        You are free to use these tools for any personal or commercial purpose.
                        Please responsibly use generated data (e.g., from Faker or Key Generators).
                    </p>

                    <h2>Changes</h2>
                    <p>
                        We reserve the right to modify these terms at any time. Continued use of the application constitutes acceptance of these terms.
                    </p>

                    <h2>Contact</h2>
                    <p>
                        For any questions regarding these terms, please contact <a href="mailto:adriandrei@hotmail.com" className="accent-link">adriandrei@hotmail.com</a>.
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
                .text-content p {
                    color: var(--text-secondary);
                    margin-bottom: 1rem;
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

export default Terms;
