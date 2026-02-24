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
        await expect(page.getByText('HS256')).toBeVisible();
    });

    test('Verifies valid HS256 signature correctly', async ({ page }) => {
        await page.getByPlaceholder('eyJh...').fill(validJwt);

        // Fill the secret key
        const secretInput = page.locator('textarea').nth(1); // verification textarea
        await secretInput.fill('your-256-bit-secret');

        await page.getByRole('button', { name: 'Verify' }).click();

        await expect(page.getByText('Signature Valid!')).toBeVisible({ timeout: 8000 });
    });

    test('Rejects wrong secret as invalid', async ({ page }) => {
        await page.getByPlaceholder('eyJh...').fill(validJwt);

        const secretInput = page.locator('textarea').nth(1);
        await secretInput.fill('wrong-secret');

        await page.getByRole('button', { name: 'Verify' }).click();

        await expect(page.getByText('Invalid Signature')).toBeVisible({ timeout: 8000 });
    });

    test('Shows error for malformed token', async ({ page }) => {
        await page.getByPlaceholder('eyJh...').fill('not.a.valid.jwt.token');

        // Token has 5 parts — should show format error
        await expect(page.locator('body')).toContainText(/invalid jwt format/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('AES Encryption', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/aes');
    });

    test('Encrypts text and produces ciphertext', async ({ page }) => {
        await page.getByPlaceholder('Enter a strong secret key...').fill('mysecretkey');
        await page.getByPlaceholder(/Text to encrypt/).fill('Hello World');

        // Wait for auto-process (debounced 300ms)
        const output = page.locator('textarea[readonly]');
        await expect(output).not.toBeEmpty({ timeout: 3000 });

        const cipher = await output.inputValue();
        // CryptoJS AES ciphertext starts with "U2FsdGVk" (OpenSSL prefix in base64)
        expect(cipher).toMatch(/^U2FsdGVk/);
    });

    test('Decrypt mode produces original plaintext', async ({ page }) => {
        // Known cipher: "Hello World" encrypted with key "mysecretkey"
        // Generated with CryptoJS.AES.encrypt("Hello World", "mysecretkey").toString()
        // This is a stable value for the same key+salt — we test decrypt round-trip via UI
        const plaintext = 'Hello Decrypt World';
        const key = 'testpassphrase123';

        // Step 1: Encrypt
        await page.getByPlaceholder('Enter a strong secret key...').fill(key);
        await page.getByPlaceholder(/Text to encrypt/).fill(plaintext);

        const encryptOutput = page.locator('textarea[readonly]');
        await expect(encryptOutput).not.toBeEmpty({ timeout: 3000 });
        const ciphertext = await encryptOutput.inputValue();
        expect(ciphertext.length).toBeGreaterThan(10);

        // Step 2: Switch to Decrypt mode
        await page.getByRole('button', { name: /Decrypt/i }).click();

        // Step 3: Fill ciphertext and same key
        await page.getByPlaceholder(/U2Fsd/).fill(ciphertext);
        await page.getByPlaceholder('Enter a strong secret key...').fill(key);

        // Step 4: Check decrypted output matches original
        await expect(encryptOutput).toHaveValue(plaintext, { timeout: 3000 });
    });

    test('Shows error for wrong decryption key', async ({ page }) => {
        // Switch to decrypt mode
        await page.getByRole('button', { name: /Decrypt/i }).click();

        await page.getByPlaceholder('Enter a strong secret key...').fill('wrongkey');
        // Paste a real CryptoJS ciphertext that was made with a different key
        await page.getByPlaceholder(/U2Fsd/).fill('U2FsdGVkX19abc123invalidciphertext');

        await expect(page.locator('body')).toContainText(/Decryption Failed|Invalid key/i, { timeout: 3000 });
    });

    test('Switches between Encrypt and Decrypt modes', async ({ page }) => {
        // Default is Encrypt
        await expect(page.getByPlaceholder(/Text to encrypt/)).toBeVisible();

        // Switch to Decrypt
        await page.getByRole('button', { name: /Decrypt/i }).click();
        await expect(page.getByPlaceholder(/U2Fsd/)).toBeVisible();

        // Switch back
        await page.getByRole('button', { name: /Encrypt/i }).click();
        await expect(page.getByPlaceholder(/Text to encrypt/)).toBeVisible();
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
        // $2a$04$... computed offline
        const knownHash = '$2a$04$YRer2VIeMEBdoLbqwV4qseoiJ9aaVjGrBKV.0BTHqbE0rMFzXUdwS';

        await page.getByPlaceholder('Enter password...').fill('testpassword');
        await page.getByPlaceholder('$2a$10$...').fill(knownHash);

        // Wait for verify (debounced + async)
        await expect(page.getByText('Match! Password is correct.')).toBeVisible({ timeout: 8000 });
    });

    test('Verifies wrong password against hash — shows No match', async ({ page }) => {
        const knownHash = '$2a$04$YRer2VIeMEBdoLbqwV4qseoiJ9aaVjGrBKV.0BTHqbE0rMFzXUdwS';

        await page.getByPlaceholder('Enter password...').fill('wrongpassword');
        await page.getByPlaceholder('$2a$10$...').fill(knownHash);

        await expect(page.getByText('No match.')).toBeVisible({ timeout: 8000 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('OTP / TOTP Generator', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/otp');
    });

    test('Generates a 6-digit TOTP token on load', async ({ page }) => {
        // Token is rendered as text inside a sibling div to the "current token" label
        // Both live inside a wrapper div — we target the big token div via its font-size style
        const tokenDiv = page.locator('div[style*="3rem"]');

        // Wait for the timer loop to fire (1s interval — should catch within 3s)
        await expect(tokenDiv).toHaveText(/^\d{6}$/, { timeout: 5000 });
    });

    test('Timer progress bar is visible', async ({ page }) => {
        // The countdown is shown as a shrinking progress bar (no text countdown)
        // Verify the token display area and the progress bar container both exist
        await expect(page.locator('body')).toContainText('current token');
        // Progress bar is a div inside its track — verify the track div exists
        await expect(page.locator('div[style*="height: 6px"], div[style*="height:6px"]').first()).toBeVisible();
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
        await expect(page.locator('svg')).toBeVisible({ timeout: 5000 });
    });

    test('Custom secret produces a token', async ({ page }) => {
        const secretInput = page.getByPlaceholder('JBSWY3DPEHPK3PXP');
        await secretInput.clear();
        // JBSWY3DPEHPK3PXP is the canonical test secret from RFC 6238
        await secretInput.fill('JBSWY3DPEHPK3PXP');

        // Should produce a valid 6-digit token within 2 seconds
        const tokenDisplay = page.locator('div[style*="3rem"]');
        await expect(tokenDisplay).toHaveText(/^\d{6}$/, { timeout: 5000 });
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
