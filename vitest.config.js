import { defineConfig } from 'vitest/config'

// Unit tests for pure helpers (src/**/*.test.js), run in Node in milliseconds.
// The browser suite (Playwright, tests/) covers pages and flows. This config
// deliberately skips vite.config.js and its build plugins (PWA, ffmpeg copy).
export default defineConfig({
    test: {
        include: ['src/**/*.test.js'],
        environment: 'node',
    },
    define: {
        __FFMPEG_CORE_VERSION__: JSON.stringify('test'),
    },
})
