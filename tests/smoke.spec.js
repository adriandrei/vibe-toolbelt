import { test, expect } from '@playwright/test';
import { ALL_TOOLS } from '../src/config/tools.js';
import { BRAND, pageTitle } from '../src/config/brand.js';
import { routePaths } from './helpers.js';

// Every registered route must render its page (with an h1) without crashing
// or logging page errors, and set its tab title.
for (const path of routePaths()) {
    test(`Smoke: ${path}`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));

        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.getByRole('complementary', { name: 'Tools' })).toBeVisible();
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(page.getByText('Something went wrong')).toHaveCount(0);

        const tool = ALL_TOOLS.find((t) => t.path === path);
        if (tool && path !== '/') {
            await expect(page).toHaveTitle(pageTitle(tool.title));
        } else {
            await expect(page).toHaveTitle(new RegExp(BRAND.name));
        }

        expect(errors).toEqual([]);
    });
}

test('Unknown routes show the 404 page inside the app shell', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/not found/i);
    await expect(page.getByRole('complementary', { name: 'Tools' })).toBeVisible();
});

test('/settings redirects to the settings page', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/ai-settings$/);
});
