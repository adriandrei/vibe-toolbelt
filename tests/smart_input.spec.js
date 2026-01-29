import { test, expect } from '@playwright/test';

test.describe('Smart Input Feature', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('Command Palette opens with Ctrl+K', async ({ page }) => {
        await page.keyboard.press('Control+k');
        await expect(page.locator('input[placeholder*="Type to search"]')).toBeVisible();
    });

    test('Smart detection for JWT', async ({ page }) => {
        // Mock a JWT
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

        await page.keyboard.press('Control+k');
        await page.locator('input[placeholder*="Type to search"]').fill(jwt);

        // Expect Smart Suggestion
        const suggestion = page.locator('text=Detected JWT Decoder');
        await expect(suggestion).toBeVisible();

        // Navigate
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/jwt');
    });

    test('Smart detection for Base64', async ({ page }) => {
        const base64 = 'SGVsbG8gV29ybGQ='; // Hello World

        await page.keyboard.press('Control+k');
        await page.locator('input[placeholder*="Type to search"]').fill(base64);

        // Expect Smart Suggestion
        await expect(page.locator('text=Detected Base64 Decoder')).toBeVisible();

        // Navigate
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/base64');
    });

    test('Smart detection for JSON', async ({ page }) => {
        const json = '{"foo":"bar"}';

        await page.keyboard.press('Control+k');
        await page.locator('input[placeholder*="Type to search"]').fill(json);

        // Expect Smart Suggestion
        await expect(page.locator('text=Detected JSON Formatter')).toBeVisible();

        // Navigate
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/formatters');
    });
});
