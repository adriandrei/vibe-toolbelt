import { Helmet } from 'react-helmet-async'

export default function SEO({
    title,
    description = "A privacy-focused collection of developer utilities. Fast, secure, and always at your fingertips.",
    keywords = "developer tools, web utilities, privacy focused, offline tools, react, vite",
    image = "/og-image.png",
    url
}) {
    const siteUrl = window.location.origin
    const fullUrl = url ? `${siteUrl}${url}` : siteUrl

    return (
        <Helmet>
            {/* Basic Meta Tags */}
            <title>{title ? `${title} | Private Toolkit` : 'Private Toolkit - Privacy-First Developer Utilities'}</title>
            <meta name="description" content={description} />
            <meta name="keywords" content={keywords} />

            {/* Open Graph / Facebook */}
            <meta property="og:type" content="website" />
            <meta property="og:url" content={fullUrl} />
            <meta property="og:title" content={title ? `${title} | Private Toolkit` : 'Private Toolkit'} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={image} />

            {/* Twitter */}
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:url" content={fullUrl} />
            <meta name="twitter:title" content={title ? `${title} | Private Toolkit` : 'Private Toolkit'} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:image" content={image} />

            {/* Canonical */}
            <link rel="canonical" href={fullUrl} />
        </Helmet>
    )
}
