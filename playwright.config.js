import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    // CI gates the deploy on this suite, so one retry keeps a single flaky run from
    // blocking it. Tests are independent; four workers run the suite in ~4 minutes.
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : 4,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
    timeout: 30000, // 30 second timeout for all tests
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
    // Run local dev server before starting the tests
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
    },
});
