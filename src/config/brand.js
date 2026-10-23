// Single source of truth for the app's name and positioning.
// Change it here and every title, header, manifest-facing string and prompt follows.
export const BRAND = {
    name: 'Vibe Toolbelt',
    shortName: 'Toolbelt',
    tagline: 'Privacy-first developer tools',
    description:
        'Developer utilities that run entirely in your browser: formatters, encoders, crypto, media and more. Your data stays on your device.',
    repoUrl: 'https://github.com/adriandrei/vibe-toolbelt',
}

export function pageTitle(title) {
    return title ? `${title} · ${BRAND.name}` : `${BRAND.name} — ${BRAND.tagline}`
}
