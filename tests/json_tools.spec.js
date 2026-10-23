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
        await page.waitForSelector('.monaco-editor');
        await page.evaluate((val) => {
            window.monaco?.editor?.getModels()?.[0]?.setValue(val);
        }, input);

        await page.getByRole('button', { name: 'Format', exact: true }).click();

        // Expect indented output (default 2 spaces)
        await expect.poll(() => page.evaluate(() => window.monaco?.editor?.getModels()?.[1]?.getValue())).toBe(`{\n  "foo": "bar"\n}`);
    });

    test('JMESPath Querying works', async ({ page }) => {
        const input = '[{"id":1,"name":"a"},{"id":2,"name":"b"}]';
        await page.waitForSelector('.monaco-editor');
        await page.evaluate((val) => {
            window.monaco?.editor?.getModels()?.[0]?.setValue(val);
        }, input);

        // Set JMESPath filter to get IDs
        const jqInput = page.getByPlaceholder('JMESPath Filter');
        await jqInput.fill('[].id');

        await page.getByRole('button', { name: 'Format', exact: true }).click();

        await expect.poll(() => page.evaluate(() => window.monaco?.editor?.getModels()?.[1]?.getValue())).toBe(`[\n  1,\n  2\n]`);
    });

    test('Minify Toggle works', async ({ page }) => {
        const input = '{"foo":"bar"}';
        await page.waitForSelector('.monaco-editor');
        await page.evaluate((val) => {
            window.monaco?.editor?.getModels()?.[0]?.setValue(val);
        }, input);

        // Click Minify button (AlignJustify icon)
        await page.getByTitle('Minify (0 spaces)').click();

        await page.getByRole('button', { name: 'Format', exact: true }).click();

        await expect.poll(() => page.evaluate(() => window.monaco?.editor?.getModels()?.[1]?.getValue())).toBe(`{"foo":"bar"}`);
    });

    test('Reports Syntax Error', async ({ page }) => {
        const input = '{"foo":}'; // Invalid
        await page.waitForSelector('.monaco-editor');
        await page.evaluate((val) => {
            window.monaco?.editor?.getModels()?.[0]?.setValue(val);
        }, input);
        await page.getByRole('button', { name: 'Format', exact: true }).click();

        await expect(page.getByRole('alert').filter({ hasText: 'Invalid JSON' })).toBeVisible();
        // A failed run clears the previous output
        const outputVal = await page.evaluate(() => window.monaco?.editor?.getModels()?.[1]?.getValue());
        expect(outputVal || '').toBe('');
    });
});
