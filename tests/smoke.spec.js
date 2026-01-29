import { test, expect } from '@playwright/test';

const pages = [
    '/',
    '/base64',
    '/jwt',
    '/username',
    '/diff',
    '/uuid',
    '/hash',
    '/hmac',
    '/rsa',
    '/password',
    '/url',
    '/ua',
    '/curl',
    '/meta',
    '/faker',
    '/lorem',
    '/css',
    '/gradient',
    '/triangle',
    '/color-blindness',
    '/box-shadow',
    '/formatters',
    '/converter',
    '/unix',
    '/cidr',
    '/svg',
    '/cron',
    '/markdown',
    '/privacy',
    '/terms'
];

for (const path of pages) {
    test(`Smoke Test: ${path} loads correctly`, async ({ page }) => {
        // 1. Go to page
        await page.goto(path);

        // 2. Check title contains app name
        await expect(page).toHaveTitle(/Vibe Toolbelt/);

        // 3. Ensure no serious visual errors (main content visible)
        await expect(page.locator('main')).toBeVisible();

        // 4. Check Sidebar is present (Sidebar uses <aside> which has role 'complementary')
        await expect(page.getByRole('complementary')).toBeVisible();
    });
}
