import { test, expect } from '@playwright/test';

test.describe('Smart Paste Feature', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(500); // Ensure app is loaded
    });

    test('Detects Base64 content on paste', async ({ page, browserName }) => {
        if (browserName === 'webkit') test.skip();

        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        // Dispatch paste event on document.body
        await page.evaluate(() => {
            const data = new DataTransfer();
            data.setData('text', 'SGVsbG8gV29ybGQ='); // Hello World

            const event = new ClipboardEvent('paste', {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
                composed: true
            });
            document.body.dispatchEvent(event);
        });

        // Debug: Check if toast appears
        const toast = page.locator('.smart-toast');
        await expect(toast).toBeVisible({ timeout: 5000 });
        await expect(toast).toContainText('Looks like Base64 Decoder content');

        // Click Open Tool
        await page.getByRole('button', { name: /Open Tool/i }).click();
        await expect(page).toHaveURL('/base64');
    });

    test('Detects JSON content on paste', async ({ page }) => {
        const json = '{"foo":"bar"}';

        await page.evaluate((text) => {
            const data = new DataTransfer();
            data.setData('text', text); // use 'text' instead of 'text/plain' for wider compatibility
            const event = new ClipboardEvent('paste', {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
                composed: true
            });
            document.body.dispatchEvent(event);
        }, json);

        const toast = page.locator('.smart-toast');
        await expect(toast).toBeVisible({ timeout: 5000 });
        await expect(toast).toContainText('Looks like JSON Formatter content');
    });

    test('Detects JWT content on paste', async ({ page }) => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

        await page.evaluate((text) => {
            const data = new DataTransfer();
            data.setData('text', text);
            const event = new ClipboardEvent('paste', {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
                composed: true
            });
            document.body.dispatchEvent(event);
        }, jwt);

        const toast = page.locator('.smart-toast');
        await expect(toast).toBeVisible({ timeout: 5000 });
        await expect(toast).toContainText('Looks like JWT Decoder content');
    });
});
