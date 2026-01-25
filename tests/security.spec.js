import { test, expect } from '@playwright/test';

test.describe('Security Tools', () => {

    test('Base64 Converter encodes and decodes correctly', async ({ page }) => {
        await page.goto('/base64');

        // Test Encoding
        await page.getByPlaceholder('Type something here...').fill('Hello World');
        await expect(page.getByPlaceholder('Result will appear here...')).toHaveValue('SGVsbG8gV29ybGQ=');

        // Switch to Decode
        await page.getByRole('button', { name: 'decode' }).click();
        await page.getByPlaceholder('Paste Base64 here...').fill('SGVsbG8gV29ybGQ=');
        await expect(page.getByPlaceholder('Result will appear here...')).toHaveValue('Hello World');
    });

    test('Hash Generator calculates hashes correctly', async ({ page }) => {
        await page.goto('/hash');

        await page.getByPlaceholder('Enter text to hash...').fill('test');

        // MD5 for 'test' is 098f6bcd4621d373cade4e832627b4f6
        await expect(page.getByText('098f6bcd4621d373cade4e832627b4f6')).toBeVisible();
        // SHA256 for 'test' starts with 9f86d081884c7d659a2...
        await expect(page.getByText('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')).toBeVisible();
    });

    test('UUID Generator generates UUIDs', async ({ page }) => {
        await page.goto('/uuid');

        // Default generates 5 UUIDs
        const resultBox = page.locator('textarea[readonly]');
        await expect(resultBox).not.toBeEmpty();

        const content = await resultBox.inputValue();
        const lines = content.split('\n');
        expect(lines.length).toBe(5);
        expect(lines[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('JWT Decoder decodes token parts', async ({ page }) => {
        await page.goto('/jwt');

        // Simple JWT: header={"alg":"HS256","typ":"JWT"} payload={"sub":"1234567890","name":"John Doe","iat":1516239022}
        // from jwt.io
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.TMZNZkE4iVfR6w26kfeP_m55ad3J_cIXlk00oq2tO2U';

        await page.getByPlaceholder('eyJh...').fill(jwt);

        await expect(page.getByText('"HS256"')).toBeVisible();
        await expect(page.getByText('"John Doe"')).toBeVisible();
    });

    test('HMAC Generator creates hash', async ({ page }) => {
        await page.goto('/hmac');
        await page.getByPlaceholder('Enter message to hash...').fill('message');
        await page.getByPlaceholder('Secret Key').fill('secret');

        // SHA256 HMAC of 'message' with key 'secret':
        // 8b5f48702995c1598c573db1e21866a9b825d4a794d169d7065a97f945d8b28d
        const output = page.getByPlaceholder('HMAC will appear here...');
        await expect(output).toHaveValue(/8b5f4870/);
    });

    test('RSA Key Generator creates keys', async ({ page }) => {
        await page.goto('/rsa');
        // It's 2048 by default. It takes time.
        // We'll switch to 1024 to be faster if possible, or just click generate.
        await page.selectOption('select', '1024');
        await page.getByRole('button', { name: 'Generate New Keys' }).click();

        // Wait for generation
        const privateKey = page.locator('textarea').nth(1);
        await expect(privateKey).toContainText('BEGIN RSA PRIVATE KEY', { timeout: 15000 });
    });

    test('Password Auditor evaluates strength', async ({ page }) => {
        await page.goto('/password');
        await page.getByPlaceholder('Type a password...').fill('password123');

        // Check for strength label (Weak/Very Weak/Fair/Good/Strong)
        const content = page.locator('body');
        await expect(content).toContainText(/Weak|Fair|Good|Strong/);
    });

});
