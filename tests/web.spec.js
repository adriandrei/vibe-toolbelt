import { test, expect } from '@playwright/test';

test.describe('Web Tools', () => {

    test('URL Parser parses URLs correctly', async ({ page }) => {
        await page.goto('/url');

        const testUrl = 'https://example.com:8080/path/to/resource?query=param&key=value#hash';
        await page.getByPlaceholder('https://example.com/path?query=123').fill(testUrl);

        // Verify parsed components via text content on the page
        const content = page.locator('body');
        await expect(content).toContainText('https:');
        await expect(content).toContainText('example.com:8080');
        await expect(content).toContainText('/path/to/resource');
        await expect(content).toContainText('#hash');

        await expect(content).toContainText('query');
        await expect(content).toContainText('param');
    });

    test('User Agent Parser loads', async ({ page }) => {
        await page.goto('/ua');
        await expect(page.getByRole('heading', { name: 'User Agent Parser' })).toBeVisible();
    });

    test('Curl Converter converts curl to fetch', async ({ page }) => {
        await page.goto('/curl');

        const curlCommand = "curl -X POST https://api.example.com/items -H 'Content-Type: text/plain' -d 'simple_body'";
        await page.getByPlaceholder('curl -X POST').fill(curlCommand);

        const outputArea = page.locator('textarea[readonly]');
        const code = await outputArea.inputValue();

        expect(code).toContain("fetch('https://api.example.com/items'");
        expect(code).toContain("method: 'POST'");
        expect(code).toContain("simple_body");
    });

    test('Meta Tags Generator builds HTML', async ({ page }) => {
        await page.goto('/meta');

        await page.locator('input[name="title"]').fill('My Amazing Page');
        await page.locator('textarea[name="description"]').fill('Best description ever');

        const output = page.locator('pre');
        await expect(output).toContainText('<title>My Amazing Page</title>');
        await expect(output).toContainText('name="description" content="Best description ever"');
    });

    test('Unix Timestamp Converter shows current time', async ({ page }) => {
        await page.goto('/unix');

        // Should show current timestamp (10 digits for seconds)
        const content = page.locator('body');
        await expect(content).toContainText(/\d{10}/); // Unix timestamp in seconds

        // Test input conversion
        await page.getByPlaceholder(/Paste timestamp/).fill('1609459200');
        await expect(content).toContainText('2021'); // Jan 1, 2021
    });

    test('Unix Timestamp handles milliseconds', async ({ page }) => {
        await page.goto('/unix');

        // Input milliseconds (13 digits)
        await page.getByPlaceholder(/Paste timestamp/).fill('1609459200000');
        await expect(page.locator('body')).toContainText('2021');
    });

    test('Unix Timestamp pause/resume works', async ({ page }) => {
        await page.goto('/unix');

        // Get initial timestamp from the big display (4rem font)
        const bigDisplay = page.locator('div[style*="4rem"]');
        const initialText = await bigDisplay.textContent();
        const timestamp1 = parseInt(initialText);

        // Pause
        await page.getByRole('button', { name: /Pause/i }).click();

        // Wait a bit
        await page.waitForTimeout(2000);

        // Get paused timestamp
        const pausedText = await bigDisplay.textContent();
        const timestamp2 = parseInt(pausedText);

        // Should be same or very close (within 1 second)
        expect(Math.abs(timestamp2 - timestamp1)).toBeLessThan(2);
    });

});
