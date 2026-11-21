// Service worker built by vite-plugin-pwa (strategies: 'injectManifest').
// Behaves like the plugin's generated worker with registerType: 'autoUpdate',
// plus the runtime caches below.
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Client-side routes (e.g. /jwt) fall back to the cached app shell when offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/ffmpeg\//] }))

// The ffmpeg core (~32 MB) is too big to precache. Pages request it as
// /ffmpeg/ffmpeg-core.*?v=<version>, so the first use stores that version here and
// Video Studio works offline afterwards. Old versions age out.
registerRoute(
    ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/ffmpeg/'),
    new CacheFirst({
        cacheName: 'ffmpeg-core',
        plugins: [
            new ExpirationPlugin({ maxEntries: 4 }),
            new CacheableResponsePlugin({ statuses: [0, 200] }),
        ],
    })
)

// Large tool-specific chunks left out of the precache (Faker, Monaco, the HEIC
// decoder, PDF libraries, zxcvbn, the LLM worker) are kept here once a tool has
// loaded them, along with the fonts.
registerRoute(
    ({ request, url }) => url.origin === self.location.origin &&
        ['script', 'worker', 'style', 'font'].includes(request.destination),
    new StaleWhileRevalidate({
        cacheName: 'app-assets',
        plugins: [new ExpirationPlugin({ maxEntries: 200 })],
    })
)
