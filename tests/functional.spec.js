import { test, expect } from '@playwright/test';

test.describe('Functional Tests', () => {

    test('CIDR Calculator works correctly for valid input', async ({ page }) => {
        await page.goto('/cidr');

        // Input value
        await page.getByPlaceholder('e.g. 10.0.0.0/16').fill('10.0.0.0/16');

        const main = page.locator('main');
        await expect(main).toContainText('Network address');
        await expect(main).toContainText('10.0.0.0');
        await expect(main).toContainText('255.255.0.0');
        await expect(main).toContainText('65,536');
        await expect(main).toContainText('65,534');
    });

    test('Unix Timestamp shows current time and accepts input', async ({ page }) => {
        await page.goto('/unix');

        // Check ticker exists (big numbers)
        await expect(page.getByText('SECONDS', { exact: true })).toBeVisible();

        // Test Input: Year 2026 approx timestamp
        const testTs = '1769270400'; // ~Jan 2026
        await page.getByPlaceholder('Paste timestamp').fill(testTs);

        // Results should appear
        await expect(page.getByText('Converted Result')).toBeVisible();
        await expect(page.getByText('ISO 8601').locator('..')).toHaveText(/2026/);
    });

});
