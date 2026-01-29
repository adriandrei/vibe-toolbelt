import { test, expect } from '@playwright/test';

// Note: These tests are marked as skip because they require proper browser focus
// and keyboard event handling which can be flaky in CI environments.
// The Command Palette functionality works correctly in manual testing.

test.describe('Smart Input Feature', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('Command Palette opens with Ctrl+K', async ({ page }) => {
        // Dispatch keydown manually to ensure window listener catches it
        await page.evaluate(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'k',
                code: 'KeyK',
                ctrlKey: true,
                bubbles: true,
                cancelable: true
            }));
        });
        // Use filter to find the specific overlay that contains the input, ensuring uniqueness
        const overlay = page.locator('div[style*="position: fixed"]').filter({ has: page.getByRole('textbox') });
        await expect(overlay).toBeVisible({ timeout: 5000 });
    });

    // Skipped: Depends on Command Palette opening reliably
    test('Smart detection for JWT', async ({ page }) => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

        await page.evaluate(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
        });

        // Wait for animation
        await page.waitForTimeout(500);

        // Type slowly to ensure React state updates
        await page.keyboard.type(jwt, { delay: 10 });

        await expect(page.getByText('Detected JWT Decoder')).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/jwt');
    });

    // Skipped: Depends on Command Palette opening reliably
    test('Smart detection for Base64', async ({ page }) => {
        const base64 = 'SGVsbG8gV29ybGQ=';

        await page.evaluate(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
        });

        await page.waitForTimeout(500);
        await page.keyboard.type(base64, { delay: 10 });

        await expect(page.getByText('Detected Base64 Decoder')).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/base64');
    });

    // Skipped: Depends on Command Palette opening reliably
    test('Smart detection for JSON', async ({ page }) => {
        const json = '{"foo":"bar"}';

        await page.evaluate(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
        });

        await page.waitForTimeout(500);
        await page.keyboard.type(json, { delay: 10 });

        await expect(page.getByText('Detected JSON Formatter')).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/formatters');
    });
});
