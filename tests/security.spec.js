import { test, expect } from '@playwright/test';

test.describe('Security Tools', () => {

    test('Base64 Converter encodes and decodes correctly', async ({ page }) => {
        await page.goto('/base64');

        // Test Encoding
        await page.getByPlaceholder('Type something here...').fill('Hello World');
        await expect(page.getByPlaceholder('Result will appear here...')).toHaveValue('SGVsbG8gV29ybGQ=');

        // Switch to Decode
        await page.locator('main').getByRole('button', { name: 'Decode', exact: true }).click();
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

        // Default: five v4 UUIDs, each with its own copy button
        await expect(page.getByRole('button', { name: /^Copy UUID \d+$/ })).toHaveCount(5);
        const text = await page.locator('main').innerText();
        const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) || [];
        expect(uuids.length).toBeGreaterThanOrEqual(5);
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

        // HMAC-SHA256 of 'message' with key 'secret'
        await expect(page.locator('main')).toContainText('8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b');
    });

    test('RSA Key Generator creates keys', async ({ page }) => {
        await page.goto('/rsa');
        await page.getByRole('button', { name: /Generate new keys/i }).click();
        await expect(page.locator('main')).toContainText('BEGIN PUBLIC KEY', { timeout: 15000 });
        await expect(page.locator('main')).toContainText('BEGIN PRIVATE KEY');
    });

    test('Password Auditor evaluates strength', async ({ page }) => {
        await page.goto('/password');
        await page.getByPlaceholder('Type a password...').fill('password123');

        // Check for strength label (Weak/Very Weak/Fair/Good/Strong)
        const content = page.locator('body');
        await expect(content).toContainText(/weak|fair|good|strong/i);
    });

    test('Password shows multiple strength levels', async ({ page }) => {
        await page.goto('/password');

        // Test very weak
        await page.getByPlaceholder('Type a password...').fill('123');
        await expect(page.locator('body')).toContainText(/very weak|weak/i);

        // Test strong
        await page.getByPlaceholder('Type a password...').fill('Tr0ng!P@ssw0rd#2024$');
        await expect(page.locator('body')).toContainText(/strong|good/i);
    });

    test('Password toggle shows/hides password', async ({ page }) => {
        await page.goto('/password');

        const input = page.getByPlaceholder('Type a password...');
        await input.fill('secret');

        // Should start as password type
        await expect(input).toHaveAttribute('type', 'password');

        await page.getByRole('button', { name: 'Show password' }).click();
        await expect(input).toHaveAttribute('type', 'text');
    });

    test('RSA offers only secure key sizes and generates them', async ({ page }) => {
        await page.goto('/rsa');
        await expect(page.getByRole('button', { name: '2048-bit' })).toBeVisible();
        await expect(page.getByRole('button', { name: '1024-bit' })).toHaveCount(0);
        await page.getByRole('button', { name: '3072-bit' }).click();
        await page.getByRole('button', { name: /Generate new keys/i }).click();
        await expect(page.locator('main')).toContainText('BEGIN PUBLIC KEY', { timeout: 30000 });
        await expect(page.locator('main')).toContainText('3072');
    });

    test('RSA regenerates different keys', async ({ page }) => {
        await page.goto('/rsa');
        const generate = page.getByRole('button', { name: /Generate new keys/i });
        await generate.click();
        await expect(page.locator('main')).toContainText('BEGIN PUBLIC KEY', { timeout: 15000 });
        const pem = () => page.locator('main').innerText().then(t => t.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/)?.[0]);
        const first = await pem();
        await generate.click();
        await expect.poll(pem, { timeout: 15000 }).not.toBe(first);
    });
});
