import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    retries: 0,
    workers: 1, // Keep it simple for local dev
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
        viewport: { width: 1280, height: 720 },
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    // OPTIONAL: Run local dev server before starting the tests
    // webServer: {
    //   command: 'npm run dev',
    //   url: 'http://localhost:5173',
    //   reuseExistingServer: true,
    // },
});
