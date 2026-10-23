import { test, expect } from '@playwright/test';
import { findLowContrast, routePaths, useTheme } from './helpers.js';

// Every page must be readable in both themes and fit a phone screen.
const routes = routePaths();

for (const theme of ['light', 'dark']) {
    test.describe(`Readable text (${theme})`, () => {
        for (const path of routes) {
            test(`${path}`, async ({ page }) => {
                await useTheme(page, theme);
                await page.goto(path);
                await expect(page.locator('main h1').first()).toBeVisible();
                await page.waitForTimeout(150);
                const low = await page.evaluate(findLowContrast, 3);
                expect(low, low.join('\n')).toEqual([]);
            });
        }
    });
}

test.describe('Fits a 375px phone screen', () => {
    test.use({ viewport: { width: 375, height: 740 } });
    for (const path of routes) {
        test(`${path}`, async ({ page }) => {
            await page.goto(path);
            await expect(page.locator('main h1').first()).toBeVisible();
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow).toBeLessThanOrEqual(0);
        });
    }
});
