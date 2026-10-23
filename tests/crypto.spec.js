import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Critical Security Tool Tests — Top 5 ranked gaps
// ─────────────────────────────────────────────────────────────────────────────

test.describe('JWT Decoder & Verifier', () => {
    // Known-good HS256 JWT signed with secret "secret"
    // Header: {"alg":"HS256","typ":"JWT"}
    // Payload: {"sub":"1234567890","name":"John Doe","iat":1516239022}
    const validJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    test.beforeEach(async ({ page }) => {
        await page.goto('/jwt');
    });

    test('Decodes header and payload correctly', async ({ page }) => {
        await page.getByPlaceholder('eyJh...').fill(validJwt);

        await expect(page.getByText('"HS256"')).toBeVisible();
        await expect(page.getByText('"JWT"')).toBeVisible();
        await expect(page.getByText('"John Doe"')).toBeVisible();
        await expect(page.getByText('"1234567890"')).toBeVisible();
    });

    test('Shows "Verify Signature" section after decoding', async ({ page }) => {
        await page.getByPlaceholder('eyJh...').fill(validJwt);

        // Section should appear after a valid JWT is decoded
        await expect(page.getByText('Verify Signature')).toBeVisible();
        // Algorithm badge should show HS256
        await expect(page.getByText('HS256', { exact: true })).toBeVisible();
    });

    test('Verifies valid HS256 signature correctly', async ({ page }) => {
        await page.getByPlaceholder('eyJh...').fill(validJwt);

        // Verification runs as soon as a secret is entered
        await page.getByLabel('Secret', { exact: true }).fill('your-256-bit-secret');
        await expect(page.getByText(/Signature valid/)).toBeVisible({ timeout: 8000 });
    });

    test('Rejects wrong secret as invalid', async ({ page }) => {
        await page.getByPlaceholder('eyJh...').fill(validJwt);

        await page.getByLabel('Secret', { exact: true }).fill('wrong-secret');
        await expect(page.locator('main')).toContainText(/Invalid signature|does not match/i, { timeout: 8000 });
        await expect(page.getByText(/Signature valid/)).toHaveCount(0);
    });

    test('Shows error for malformed token', async ({ page }) => {
        await page.getByPlaceholder('eyJh...').fill('not.a.valid.jwt.token');

        // Token has 5 parts — should show format error
        await expect(page.locator('body')).toContainText(/invalid jwt format/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('AES Encryption', () => {
    const encryptAction = (page) => page.locator('main').getByRole('button', { name: 'Encrypt', exact: true }).last();
    const decryptAction = (page) => page.locator('main').getByRole('button', { name: 'Decrypt', exact: true }).last();
    const ciphertextOut = (page) => page.locator('main').getByText(/^VlQB[A-Za-z0-9+/=]+$/);

    test.beforeEach(async ({ page }) => {
        await page.goto('/aes');
    });

    test('Encrypts text with AES-256-GCM by default', async ({ page }) => {
        await page.getByLabel('Passphrase', { exact: true }).fill('mysecretkey');
        await page.getByLabel('Plaintext', { exact: true }).fill('Hello World');
        await encryptAction(page).click();
        await expect(ciphertextOut(page)).toBeVisible({ timeout: 10000 });
    });

    test('Ciphertext decrypts back to the original text', async ({ page }) => {
        const plaintext = 'Hello Decrypt World';
        await page.getByLabel('Passphrase', { exact: true }).fill('testpassphrase123');
        await page.getByLabel('Plaintext', { exact: true }).fill(plaintext);
        await encryptAction(page).click();
        await expect(ciphertextOut(page)).toBeVisible({ timeout: 10000 });

        // Swap moves the ciphertext into the input and switches to decrypt
        await page.getByRole('button', { name: 'Swap' }).click();
        await decryptAction(page).click();
        await expect(page.locator('main').getByText(plaintext, { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('A wrong passphrase is rejected, not decrypted to garbage', async ({ page }) => {
        await page.getByLabel('Passphrase', { exact: true }).fill('right-passphrase');
        await page.getByLabel('Plaintext', { exact: true }).fill('Top secret');
        await encryptAction(page).click();
        await expect(ciphertextOut(page)).toBeVisible({ timeout: 10000 });

        await page.getByRole('button', { name: 'Swap' }).click();
        await page.getByLabel('Passphrase', { exact: true }).fill('wrong-passphrase');
        await decryptAction(page).click();
        await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('main').getByText('Top secret', { exact: true })).toHaveCount(0);
    });

    test('Malformed ciphertext is explained before decrypting', async ({ page }) => {
        await page.locator('main').getByRole('button', { name: 'Decrypt', exact: true }).first().click();
        await page.getByLabel('Passphrase', { exact: true }).fill('any');
        await page.getByLabel('Ciphertext', { exact: true }).fill('U2FsdGVkX19abc123invalidciphertext');
        await expect(page.locator('main')).toContainText(/truncated|not valid|invalid/i);
        await expect(decryptAction(page)).toBeDisabled();
    });

    test('Switches between Encrypt and Decrypt modes', async ({ page }) => {
        await expect(page.getByLabel('Plaintext', { exact: true })).toBeVisible();
        await page.locator('main').getByRole('button', { name: 'Decrypt', exact: true }).first().click();
        await expect(page.getByLabel('Ciphertext', { exact: true })).toBeVisible();
        await page.locator('main').getByRole('button', { name: 'Encrypt', exact: true }).first().click();
        await expect(page.getByLabel('Plaintext', { exact: true })).toBeVisible();
    });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Bcrypt Hash Generator & Verifier', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/bcrypt');
    });

    test('Generates a bcrypt hash from a password', async ({ page }) => {
        await page.getByPlaceholder('Enter password to hash...').fill('mypassword');

        // Hash is generated in a div (not a textarea), debounced 500ms + 100ms timeout
        const hashDisplay = page.locator('span').filter({ hasText: /^\$2[ab]\$/ });
        await expect(hashDisplay).toBeVisible({ timeout: 5000 });

        const hash = await hashDisplay.textContent();
        // bcrypt hash format: $2a$10$...
        expect(hash).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);
    });

    test('Hash changes when password changes', async ({ page }) => {
        await page.getByPlaceholder('Enter password to hash...').fill('password1');
        const hashSpan = page.locator('span').filter({ hasText: /^\$2[ab]\$/ });
        await expect(hashSpan).toBeVisible({ timeout: 5000 });
        const hash1 = await hashSpan.textContent();

        await page.getByPlaceholder('Enter password to hash...').fill('password2');
        await page.waitForTimeout(1200); // wait for debounce + bcrypt computation
        const hash2 = await hashSpan.textContent();

        expect(hash1).not.toEqual(hash2);
    });

    test('Verifies correct password against hash — shows Match', async ({ page }) => {
        // Pre-computed hash for "testpassword" with 4 rounds (fast for CI)
        // $2b$04$... computed offline
        const knownHash = '$2b$04$734W222w4/c8b8y4aJeuY./h3ja/uZZTwveRNOLeUX5y0nD3gR/Ja';
 
        await page.getByPlaceholder('Enter password...').fill('testpassword');
        await page.getByPlaceholder('$2a$10$...').fill(knownHash);
 
        // Wait for verify (debounced + async)
        await expect(page.getByText(/The password is correct for this hash/)).toBeVisible({ timeout: 8000 });
    });
 
    test('Verifies wrong password against hash — shows No match', async ({ page }) => {
        const knownHash = '$2b$04$734W222w4/c8b8y4aJeuY./h3ja/uZZTwveRNOLeUX5y0nD3gR/Ja';
 
        await page.getByPlaceholder('Enter password...').fill('wrongpassword');
        await page.getByPlaceholder('$2a$10$...').fill(knownHash);
 
        await expect(page.getByText('No match', { exact: true })).toBeVisible({ timeout: 8000 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('OTP / TOTP Generator', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/otp');
    });

    test('Generates a 6-digit TOTP token on load', async ({ page }) => {
        // The current code appears immediately (no 1 s delay)
        await expect(page.getByRole('button', { name: /^Copy code \d{6}$/ })).toBeVisible({ timeout: 2000 });
    });

    test('Timer progress bar is visible', async ({ page }) => {
        await expect(page.getByRole('progressbar').first()).toBeVisible();
    });

    test('Generates new secret when "New Secret" is clicked', async ({ page }) => {
        // Get initial secret value
        const secretInput = page.getByPlaceholder('JBSWY3DPEHPK3PXP');
        await expect(secretInput).not.toBeEmpty({ timeout: 3000 });
        const firstSecret = await secretInput.inputValue();

        // Click New Secret
        await page.getByRole('button', { name: /New Secret/i }).click();
        await page.waitForTimeout(300);

        const secondSecret = await secretInput.inputValue();
        expect(firstSecret).not.toEqual(secondSecret);
        // Base32 alphabet: A-Z and 2-7
        expect(secondSecret).toMatch(/^[A-Z2-7]{20,}$/);
    });

    test('QR code SVG is rendered for authenticator app', async ({ page }) => {
        // OTP page uses QRCodeSVG — renders an <svg> element
        await expect(page.locator('main svg').first()).toBeVisible({ timeout: 5000 });
    });

    test('Custom secret produces a token', async ({ page }) => {
        const secretInput = page.getByPlaceholder('JBSWY3DPEHPK3PXP');
        await secretInput.clear();
        // JBSWY3DPEHPK3PXP is the canonical test secret from RFC 6238
        await secretInput.fill('JBSWY3DPEHPK3PXP');

        await expect(page.getByRole('button', { name: /^Copy code \d{6}$/ })).toBeVisible({ timeout: 3000 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('QR Code Generator', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/qrcode');
    });

    test('Renders a QR code canvas by default', async ({ page }) => {
        // QRCodeCanvas renders a <canvas> element
        await expect(page.locator('canvas')).toBeVisible();
    });

    test('Updates QR when content changes', async ({ page }) => {
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        // Get initial data URL
        const before = await canvas.evaluate(el => el.toDataURL());

        // Change the content
        await page.getByPlaceholder('Type URL or text...').fill('https://vibelabs.dev');

        // Canvas pixel data should change
        await page.waitForTimeout(200);
        const after = await canvas.evaluate(el => el.toDataURL());
        expect(before).not.toEqual(after);
    });

    test('QR size changes with the slider', async ({ page }) => {
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();

        const sizeBefore = await canvas.evaluate(el => el.width);

        // Move the size slider to maximum (1024)
        await page.locator('input[type="range"]').first().fill('512');
        await page.waitForTimeout(100);

        const sizeAfter = await canvas.evaluate(el => el.width);
        expect(sizeAfter).not.toEqual(sizeBefore);
    });

    test('Error correction level dropdown has all four options', async ({ page }) => {
        const select = page.locator('select');
        await expect(select.locator('option[value="L"]')).toHaveCount(1);
        await expect(select.locator('option[value="M"]')).toHaveCount(1);
        await expect(select.locator('option[value="Q"]')).toHaveCount(1);
        await expect(select.locator('option[value="H"]')).toHaveCount(1);
    });

    test('Download button is present', async ({ page }) => {
        await expect(page.getByRole('button', { name: /Download PNG/i })).toBeVisible();
    });
});
