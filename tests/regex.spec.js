import { test, expect } from '@playwright/test';

test.describe('Regex Tester', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/regex');
    });

    test('Loads correctly', async ({ page }) => {
        await expect(page.locator('h2')).toHaveText('Regex Tester');
    });

    test('Matches pattern correctly', async ({ page }) => {
        // Default pattern is ([A-Z])\w+ and text "Hello World..."
        // Should match "Hello", "World", "Vibe", "Check"

        await expect(page.locator('text=Hello')).toBeVisible();
        await expect(page.locator('text=World')).toBeVisible();

        // Check details
        const details = page.locator('div:has-text("Match Details")');
        await expect(details).toBeVisible();
        await expect(details).toContainText('Hello');
        await expect(details).toContainText('World');
    });

    test('Updates pattern and matches', async ({ page }) => {
        // Change pattern to "is"
        await page.locator('input[type="text"]').first().fill('is');

        // "is" appears twice in "this" and "is"
        const details = page.locator('div:has-text("Match Details")');
        await expect(details).toContainText('Match Details (2)');
    });
});
