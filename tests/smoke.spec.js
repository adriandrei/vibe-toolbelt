import { test, expect } from '@playwright/test';

// All routes registered in App.jsx — every page must load without crashing
const pages = [
    // Core / Home
    '/',
    // Security & Crypto
    '/base64',
    '/jwt',
    '/hash',
    '/hmac',
    '/rsa',
    '/password',
    '/aes',
    '/bcrypt',
    '/otp',
    // Generators
    '/username',
    '/uuid',
    '/faker',
    '/lorem',
    '/nanoid',
    '/qrcode',
    // Text & Code
    '/diff',
    '/formatters',
    '/markdown',
    '/regex',
    '/case',
    '/list',
    '/text-stats',
    '/snippets',
    // Data & Conversion
    '/converter',
    '/csv',
    '/number-base',
    '/color',
    '/hex',
    '/html-entity',
    '/urlencode',
    // Web & Network
    '/url',
    '/ua',
    '/curl',
    '/meta',
    '/unix',
    '/cidr',
    '/http-status',
    '/inspect',
    // Visual & CSS
    '/css',
    '/gradient',
    '/triangle',
    '/color-blindness',
    '/box-shadow',
    '/svg',
    // Dev Tools
    '/cron',
    '/chmod',
    '/keycode',
    '/exif',
    // Media
    '/image',
    '/image-base64',
    '/favicon',
    '/pdf',
    '/recorder',
    '/video',
    // Web Tester
    '/api',
    // Legal/Info
    '/privacy',
    '/terms',
];

for (const path of pages) {
    test(`Smoke: ${path}`, async ({ page }) => {
        await page.goto(path);

        // Title must include the app name
        await expect(page).toHaveTitle(/Private Toolkit/);

        // Main content area must be present
        await expect(page.locator('main')).toBeVisible();

        // Sidebar must be present
        await expect(page.getByRole('complementary')).toBeVisible();
    });
}
