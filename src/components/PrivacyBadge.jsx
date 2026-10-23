import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

// "Runs locally" badge. Links to the privacy page, which explains exactly
// what does (and doesn't) leave the device.
export default function PrivacyBadge({ compactOnMobile = false, style }) {
    return (
        <Link
            to="/privacy"
            className="badge badge-success"
            style={{ textDecoration: 'none', ...style }}
            title="Your data is processed locally in your browser. Click for details."
        >
            <ShieldCheck size={12} aria-hidden="true" />
            <span className={compactOnMobile ? 'hide-sm' : undefined}>Runs locally</span>
            {compactOnMobile && <span className="sr-only">Runs locally</span>}
        </Link>
    )
}
