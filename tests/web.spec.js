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

});
