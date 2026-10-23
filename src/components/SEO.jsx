import { Helmet } from 'react-helmet-async'
import { BRAND, pageTitle } from '../config/brand'

const DEFAULT_IMAGE = '/pwa-512x512.png'

/**
 * Open Graph, Twitter Card and canonical tags for a page.
 *
 * It never sets <title> (pages use ToolHeader / useDocumentTitle) or
 * <meta name="description"> (index.html already has the site description,
 * and a second one would conflict).
 *
 *   <SEO />                                  // the home page
 *   <SEO title="JWT Decoder" path="/jwt" />
 */
export default function SEO({ title, description = BRAND.description, path = '/', image = DEFAULT_IMAGE, imageAlt = `${BRAND.name} logo` }) {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = new URL(path, origin || 'http://localhost').href
    const imageUrl = new URL(image, origin || 'http://localhost').href
    const fullTitle = pageTitle(title)

    return (
        <Helmet>
            <meta property="og:type" content="website" />
            <meta property="og:site_name" content={BRAND.name} />
            <meta property="og:url" content={url} />
            <meta property="og:title" content={fullTitle} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={imageUrl} />
            <meta property="og:image:width" content="512" />
            <meta property="og:image:height" content="512" />
            <meta property="og:image:alt" content={imageAlt} />

            {/* The image is square, so the small card fits it */}
            <meta name="twitter:card" content="summary" />
            <meta name="twitter:title" content={fullTitle} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:image" content={imageUrl} />
            <meta name="twitter:image:alt" content={imageAlt} />

            <link rel="canonical" href={url} />
        </Helmet>
    )
}
