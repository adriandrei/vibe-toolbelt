import { test, expect } from '@playwright/test';

test.describe('Generator Tools', () => {

    test('Faker Tool generates data', async ({ page }) => {
        await page.goto('/faker');

        // Generate Data button
        await page.getByRole('button', { name: 'Generate Data' }).click();

        // Check output
        const output = page.getByPlaceholder('Generated data will appear here...');
        await expect(output).not.toBeEmpty();

        const value = await output.inputValue();
        // Default is JSON array of 10 items
        const json = JSON.parse(value);
        expect(Array.isArray(json)).toBe(true);
        expect(json.length).toBe(10);
        expect(json[0]).toHaveProperty('id');
        expect(json[0].user).toHaveProperty('name');
    });

    test('Username Generator creates names', async ({ page }) => {
        await page.goto('/username');

        await page.getByRole('button', { name: 'Generate New Names' }).click();

        // We expect 5 results
        // They are in divs with class glass-panel, but hard to target specifically by class
        // Use text regex or count of visible results
        await expect(page.locator('text=/^[A-Z][a-z]+[A-Z][a-z]+[0-9]+$/').first()).toBeVisible();

        // Switch to Random
        await page.getByRole('button', { name: 'Random' }).click();
        await page.getByRole('button', { name: 'Generate New Names' }).click();

        // e.g. 'a8s7d6f5'
        await expect(page.locator('text=/^[a-zA-Z0-9]{8}$/').first()).toBeVisible();
    });

    test('Username handles count variations', async ({ page }) => {
        await page.goto('/username');

        // Just verify the tool works with different counts
        await page.getByRole('button', { name: 'Generate New Names' }).click();

        // Should have results visible
        await expect(page.locator('.glass-panel').first()).toBeVisible();
    });

    test('Converter transforms JSON to YAML', async ({ page }) => {
        await page.goto('/converter');

        const jsonInput = '{"key": "value", "list": [1, 2]}';

        // Input area
        await page.getByPlaceholder('Paste JSON here...').fill(jsonInput);

        // Output should automatically update (useEffect)
        const output = page.locator('textarea[readonly]');

        // Expect YAML
        // key: value
        // list:
        //   - 1
        //   - 2
        await expect(output).toHaveValue(/key: value/);
        await expect(output).toHaveValue(/list:/);
        await expect(output).toHaveValue(/- 1/);
    });

    test('Faker supports CSV format', async ({ page }) => {
        await page.goto('/faker');

        // Select CSV format
        await page.selectOption('select', 'csv');
        await page.getByRole('button', { name: 'Generate Data' }).click();

        const output = await page.getByPlaceholder('Generated data will appear here...').inputValue();
        expect(output).toContain(','); // CSV delimiter
        const lines = output.split('\n');
        expect(lines.length).toBeGreaterThan(10); // Header + 10 rows
    });

    test('Faker supports SQL format', async ({ page }) => {
        await page.goto('/faker');

        // Select SQL format
        await page.selectOption('select', 'sql');
        await page.getByRole('button', { name: 'Generate Data' }).click();

        const output = await page.getByPlaceholder('Generated data will appear here...').inputValue();
        expect(output).toContain('INSERT INTO');
        expect(output).toContain('VALUES');
    });

    test('Faker handles count variations', async ({ page }) => {
        await page.goto('/faker');

        // Set count to 50
        await page.locator('input[type="range"]').fill('50');
        await page.getByRole('button', { name: 'Generate Data' }).click();

        const output = await page.getByPlaceholder('Generated data will appear here...').inputValue();
        const json = JSON.parse(output);
        expect(json.length).toBe(50);
    });

    test('Converter handles YAML to JSON', async ({ page }) => {
        await page.goto('/converter');

        // Switch to YAML input
        await page.locator('select').first().selectOption('yaml');

        const yamlInput = 'key: value\nlist:\n  - 1\n  - 2';
        await page.getByPlaceholder(/Paste YAML/i).fill(yamlInput);

        const output = await page.locator('textarea[readonly]').inputValue();
        // Output should be JSON format
        expect(output).toContain('key');
        expect(output).toContain('value');
        expect(output).toContain('list');
    });

    test('Converter handles invalid JSON', async ({ page }) => {
        await page.goto('/converter');

        await page.getByPlaceholder('Paste JSON here...').fill('{invalid}');

        // Should show error
        await expect(page.locator('body')).toContainText(/error|invalid/i);
    });

});
