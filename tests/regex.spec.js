import { test, expect } from '@playwright/test';

test.describe('Regex Tester', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/regex');
    });

    test('Loads correctly', async ({ page }) => {
        await expect(page.locator('h2')).toHaveText('Regex Tester');
    });

    test('Matches pattern correctly', async ({ page }) => {
        // Default pattern is ([A-Z])\w+ and text "Hello World, this is a Vibe Check."
        // The page should display these words as they are part of the test string
        await expect(page.locator('body')).toContainText('Hello');
        await expect(page.locator('body')).toContainText('World');
        await expect(page.locator('body')).toContainText('Vibe');
        await expect(page.locator('body')).toContainText('Check');
    });

    test('Updates pattern and matches', async ({ page }) => {
        // Scope to main to avoid Sidebar search input which comes first in DOM
        const regexInput = page.locator('main input[type="text"]').first();
        await regexInput.clear();
        await regexInput.type('is', { delay: 50 });

        // Wait specifically for the text to appear
        await expect(page.locator('body')).toContainText('Match Details (2)', { timeout: 5000 });
    });
});
