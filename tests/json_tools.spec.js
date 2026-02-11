import { test, expect } from '@playwright/test';

test.describe('JSON Power Tools', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/formatters');
    });

    test('Loads JSON mode by default', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeVisible();
        await expect(page.getByPlaceholder(/JMESPath/)).toBeVisible();
    });

    test('Formats Valid JSON', async ({ page }) => {
        const input = '{"foo":"bar"}';
        await page.locator('textarea').first().fill(input);
        await page.getByRole('button', { name: 'Process' }).click();

        // Expect indented output (default 2 spaces)
        const output = page.locator('textarea').nth(1);
        await expect(output).toHaveValue(`{\n  "foo": "bar"\n}`);
    });

    test('JMESPath Querying works', async ({ page }) => {
        const input = '[{"id":1,"name":"a"},{"id":2,"name":"b"}]';
        await page.locator('textarea').first().fill(input);

        // Set JMESPath filter to get IDs
        const jqInput = page.getByPlaceholder('JMESPath Filter');
        await jqInput.fill('[].id');

        await page.getByRole('button', { name: 'Process' }).click();

        const output = page.locator('textarea').nth(1);
        // Expect [1, 2]
        await expect(output).toHaveValue(`[\n  1,\n  2\n]`);
    });

    test('Minify Toggle works', async ({ page }) => {
        const input = '{"foo":"bar"}';
        await page.locator('textarea').first().fill(input);

        // Click Minify button (AlignJustify icon)
        await page.getByTitle('Minify (0 spaces)').click();

        await page.getByRole('button', { name: 'Process' }).click();

        const output = page.locator('textarea').nth(1);
        await expect(output).toHaveValue(`{"foo":"bar"}`);
    });

    test('Reports Syntax Error', async ({ page }) => {
        const input = '{"foo":}'; // Invalid
        await page.locator('textarea').first().fill(input);
        await page.getByRole('button', { name: 'Process' }).click();

        await expect(page.getByText('Error:')).toBeVisible();
        await expect(page.getByText(/JSON Syntax Error/)).toBeVisible();
    });
});
