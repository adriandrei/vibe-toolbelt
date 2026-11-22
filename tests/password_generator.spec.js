import { test, expect } from '@playwright/test';
import { long as EFF_LONG } from '@wordlist/english-eff/long';

// Password Generator: passwords, EFF passphrases and PINs made with
// crypto.getRandomValues; options persist, generated values never do.

const DEFAULT_SYMBOLS = '!#$%&()*+,-./:;<=>?@[]^_{|}~';
const LOOKALIKES = 'Il1|O0o';
const EFF_WORDS = new Set(EFF_LONG);
const LOWER = /[a-z]/;
const UPPER = /[A-Z]/;
const DIGIT = /[0-9]/;

const values = (page) => page.locator('main .pwgen-value');
const modeButton = (page, name) => page.getByRole('group', { name: 'Type' }).getByRole('button', { name, exact: true });

async function readValues(page, count) {
    await expect(values(page)).toHaveCount(count);
    return values(page).allTextContents();
}

async function strengthLabel(page, bits) {
    const levels = [[100, 'Very strong'], [75, 'Strong'], [60, 'Fair'], [40, 'Weak'], [0, 'Very weak']];
    const label = levels.find(([min]) => bits >= min)[1];
    await expect(page.getByText(`${label} · ${Math.floor(bits)} bits`, { exact: true })).toBeVisible();
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ context }) => {
    // Remember what the app copies, without racing other tests for the real clipboard
    await context.addInitScript(() => {
        const clipboard = navigator.clipboard;
        if (!clipboard?.writeText) return;
        const write = clipboard.writeText.bind(clipboard);
        clipboard.writeText = (text) => {
            window.__copied = text;
            return write(text);
        };
    });
});

test.describe('Password Generator', () => {
    test('makes a 20-character password from all four sets, with its exact entropy', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto('/password-generator');
        await expect(modeButton(page, 'Password')).toHaveAttribute('aria-pressed', 'true');

        const [pw] = await readValues(page, 1);
        expect(pw).toHaveLength(20);
        for (const ch of pw) expect(/[A-Za-z0-9]/.test(ch) || DEFAULT_SYMBOLS.includes(ch), `unexpected “${ch}”`).toBe(true);
        // "At least one from each set" is on by default
        expect(pw).toMatch(LOWER);
        expect(pw).toMatch(UPPER);
        expect(pw).toMatch(DIGIT);
        expect([...pw].some((ch) => DEFAULT_SYMBOLS.includes(ch))).toBe(true);

        const bits = 20 * Math.log2(26 + 26 + 10 + 28);
        await strengthLabel(page, bits); // Very strong · 129 bits
        await expect(page.getByText(`20 characters × log₂ 90 = ${bits.toFixed(1)} bits.`, { exact: false })).toBeVisible();
        await expect(page.getByText(/slight upper bound/)).toBeVisible();

        // Each value is copied exactly
        await page.getByRole('button', { name: 'Copy password' }).click();
        await expect.poll(() => page.evaluate(() => window.__copied)).toBe(pw);
        expect(errors).toEqual([]);
    });

    test('changes length and count, and Regenerate makes new values', async ({ page }) => {
        await page.goto('/password-generator');
        await page.getByLabel('Length value').fill('32');
        const [one] = await readValues(page, 1);
        expect(one).toHaveLength(32);
        await strengthLabel(page, 32 * Math.log2(90));

        await page.getByLabel('How many value').fill('5');
        const first = await readValues(page, 5);
        for (const pw of first) expect(pw).toHaveLength(32);
        expect(new Set(first).size).toBe(5);

        await page.getByRole('button', { name: 'Regenerate' }).click();
        await expect.poll(async () => (await values(page).allTextContents()).some((pw) => first.includes(pw))).toBe(false);
        const second = await readValues(page, 5);
        for (const pw of second) expect(pw).toHaveLength(32);

        // Copy all puts one per line; a row's icon copies just that row
        await page.getByRole('button', { name: 'Copy all' }).click();
        await expect.poll(() => page.evaluate(() => window.__copied)).toBe(second.join('\n'));
        await page.getByRole('button', { name: 'Copy password 2' }).click();
        await expect.poll(() => page.evaluate(() => window.__copied)).toBe(second[1]);
    });

    test('avoids look-alike characters', async ({ page }) => {
        await page.goto('/password-generator');
        await page.getByLabel('Avoid look-alike characters').check();
        await page.getByLabel('Length value').fill('128');
        await page.getByLabel('How many value').fill('50');
        const list = await readValues(page, 50);
        for (const pw of list) {
            expect(pw).toHaveLength(128);
            for (const ch of LOOKALIKES) expect(pw).not.toContain(ch);
        }
        const bits = 128 * Math.log2(83);
        await expect(page.getByText(`128 characters × log₂ 83 = ${bits.toFixed(1)} bits.`, { exact: false })).toBeVisible();
    });

    test('uses only the chosen sets and symbols, and explains impossible settings', async ({ page }) => {
        await page.goto('/password-generator');
        await page.getByLabel('Lowercase').uncheck();
        await page.getByLabel('Uppercase').uncheck();
        await page.getByLabel('Symbols to use').fill('!@!');
        await page.getByLabel('How many value').fill('20');
        const list = await readValues(page, 20);
        for (const pw of list) {
            expect(pw).toMatch(/^[0-9!@]{20}$/);
            expect(pw).toMatch(DIGIT);
            expect(pw).toMatch(/[!@]/);
        }
        await expect(page.getByText(/^2 symbols\. .*Repeats count once\./)).toBeVisible();
        await strengthLabel(page, 20 * Math.log2(12));

        // Letters in the symbol set are ignored and said so
        await page.getByLabel('Symbols to use').fill('!a');
        await expect(page.getByText(/Ignored: “a” \(only ASCII punctuation counts\)/)).toBeVisible();

        // No symbols at all: an error instead of output
        await page.getByLabel('Symbols to use').fill('');
        await expect(page.locator('main').getByRole('alert')).toContainText('Add at least one symbol');
        await expect(values(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Copy all' })).toBeDisabled();

        // Nothing selected
        await page.getByLabel('Symbols to use').fill('#');
        await expect(values(page)).toHaveCount(20);
        await page.getByLabel('Digits').uncheck();
        await page.getByRole('checkbox', { name: /^Symbols/ }).uncheck();
        await expect(page.locator('main').getByRole('alert')).toContainText('Choose at least one character set');
        await expect(values(page)).toHaveCount(0);
        await expect(page.getByText(/ · \d+ bits$/)).toHaveCount(0);

        await page.getByLabel('Lowercase').check();
        const lower = await readValues(page, 20);
        for (const pw of lower) expect(pw).toMatch(/^[a-z]{20}$/);
    });

    test('makes EFF passphrases with the chosen words, separator and extras', async ({ page }) => {
        await page.goto('/password-generator');
        await modeButton(page, 'Passphrase').click();
        const [hyphenated] = await readValues(page, 1);
        expect(hyphenated).toMatch(/^[a-z-]+$/);
        await strengthLabel(page, 6 * Math.log2(7776)); // Strong · 77 bits
        await expect(page.getByText('6 words × log₂ 7,776 = 77.5 bits.', { exact: false })).toBeVisible();

        await page.getByRole('button', { name: 'Space', exact: true }).click();
        const [spaced] = await readValues(page, 1);
        const words = spaced.split(' ');
        expect(words).toHaveLength(6);
        for (const word of words) expect(EFF_WORDS.has(word), `“${word}” isn’t in the EFF list`).toBe(true);

        // 8 words, capitalised
        const slider = page.getByLabel('Words', { exact: true });
        await slider.focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await page.getByLabel('Capitalise words').check();
        const [capital] = await readValues(page, 1);
        const capWords = capital.split(' ');
        expect(capWords).toHaveLength(8);
        for (const word of capWords) {
            expect(word).toMatch(/^[A-Z]/);
            expect(EFF_WORDS.has(word.charAt(0).toLowerCase() + word.slice(1))).toBe(true);
        }

        // A digit and a symbol (from a two-symbol set), each after some word
        await page.getByLabel('Add a digit').check();
        await page.getByLabel('Add a symbol').check();
        await page.getByLabel('Symbols to use').fill('!#');
        await page.getByLabel('How many value').fill('10');
        for (const phrase of await readValues(page, 10)) {
            expect(phrase.match(/[0-9]/g)).toHaveLength(1);
            expect(phrase.match(/[!#]/g)).toHaveLength(1);
            const parts = phrase.split(' ');
            expect(parts).toHaveLength(8);
            for (const part of parts) {
                const word = part.replace(/[0-9]?[!#]?$/, '');
                expect(EFF_WORDS.has(word.charAt(0).toLowerCase() + word.slice(1)), part).toBe(true);
            }
        }
        const bits = 8 * Math.log2(7776) + Math.log2(10) + Math.log2(8) + Math.log2(2) + Math.log2(8);
        await strengthLabel(page, bits); // Very strong · 113 bits

        // No separator: the words still parse (the list is prefix-free)
        await page.getByRole('button', { name: 'None', exact: true }).click();
        await page.getByLabel('Add a digit').uncheck();
        await page.getByLabel('Add a symbol').uncheck();
        for (const phrase of await readValues(page, 10)) expect(phrase).toMatch(/^([A-Z][a-z-]+){8}$/);

        const link = page.getByRole('link', { name: 'Words from the EFF long word list (CC BY 3.0 US)' });
        await expect(link).toHaveAttribute('href', 'https://www.eff.org/dice');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);
        await expect(link).toHaveAttribute('rel', /noreferrer/);
    });

    test('loads the word list only when a passphrase is needed', async ({ page }) => {
        const requests = [];
        page.on('request', (request) => requests.push(request.url()));
        // The list is node_modules/@wordlist/english-eff in dev, and a `long-<hash>.js` chunk in a build
        const isWordList = (url) => url.includes('english-eff') || /\/assets\/long-[\w-]+\.js$/.test(url);
        await page.goto('/password-generator');
        await readValues(page, 1);
        expect(requests.filter(isWordList)).toEqual([]);
        await modeButton(page, 'Passphrase').click();
        await readValues(page, 1);
        expect(requests.filter(isWordList).length).toBeGreaterThan(0);
        // Nothing leaves the device
        const origin = new URL(test.info().project.use.baseURL).origin;
        expect(requests.filter((url) => /^https?:/.test(url) && !url.startsWith(`${origin}/`))).toEqual([]);
    });

    test('makes PINs', async ({ page }) => {
        await page.goto('/password-generator');
        await modeButton(page, 'PIN').click();
        const [pin] = await readValues(page, 1);
        expect(pin).toMatch(/^[0-9]{6}$/);
        await strengthLabel(page, 6 * Math.log2(10)); // Very weak · 19 bits
        await expect(page.getByText(/A PIN only holds up where wrong guesses are limited/)).toBeVisible();

        const slider = page.getByLabel('Digits', { exact: true });
        await slider.focus();
        await page.keyboard.press('End');
        const [long] = await readValues(page, 1);
        expect(long).toMatch(/^[0-9]{12}$/);
        await expect(page.getByText('12 digits × log₂ 10 = 39.9 bits.', { exact: false })).toBeVisible();
    });

    test('opens a value in the Password Audit', async ({ page }) => {
        await page.goto('/password-generator');
        await page.getByLabel('How many value').fill('3');
        const list = await readValues(page, 3);
        await page.getByRole('button', { name: 'Check password 2 in Password Audit' }).click();
        await expect(page).toHaveURL(/\/password$/);
        await expect(page.getByLabel('Password', { exact: true })).toHaveValue(list[1]);
        await expect(page.getByText(/Score \d\/4/)).toBeVisible({ timeout: 10000 });
        // The navigation state that carried it is cleared
        expect(await page.evaluate(() => window.history.state?.usr ?? null)).toBeNull();

        await page.goBack();
        await page.getByLabel('How many value').fill('1');
        const [single] = await readValues(page, 1);
        await page.getByRole('button', { name: 'Check in Password Audit' }).click();
        await expect(page.getByLabel('Password', { exact: true })).toHaveValue(single);
    });

    test('remembers the options but never the generated values', async ({ page }) => {
        await page.goto('/password-generator');
        await page.getByLabel('Length value').fill('40');
        await page.getByLabel('Avoid look-alike characters').check();
        const [pw] = await readValues(page, 1);
        await modeButton(page, 'PIN').click();
        const [pin] = await readValues(page, 1);

        const stored = await page.evaluate(() => ({ ...localStorage }));
        expect(JSON.parse(stored['pwgen-options'])).toMatchObject({ mode: 'pin', length: 40, avoidLookalikes: true });
        const everything = JSON.stringify(stored) + JSON.stringify(await page.evaluate(() => ({ ...sessionStorage })));
        expect(everything).not.toContain(pw);
        expect(stored['pwgen-options']).not.toContain(pin);

        await page.reload();
        await expect(modeButton(page, 'PIN')).toHaveAttribute('aria-pressed', 'true');
        const [newPin] = await readValues(page, 1);
        expect(newPin).toMatch(/^[0-9]{6}$/);
        await modeButton(page, 'Password').click();
        await expect(page.getByLabel('Length value')).toHaveValue('40');
        await expect(page.getByLabel('Avoid look-alike characters')).toBeChecked();
        const [again] = await readValues(page, 1);
        expect(again).toHaveLength(40);
        expect(again).not.toBe(pw);
    });

    test('ignores malformed stored options', async ({ page, context }) => {
        await context.addInitScript(() => {
            localStorage.setItem('pwgen-options', JSON.stringify({ mode: 'bogus', length: 'x', count: 999, separator: '__proto__', lower: 'yes', symbolSet: 42 }));
        });
        await page.goto('/password-generator');
        await expect(modeButton(page, 'Password')).toHaveAttribute('aria-pressed', 'true');
        const list = await readValues(page, 50); // count clamped to the 50 maximum
        for (const pw of list) expect(pw).toHaveLength(20);
        await expect(page.getByLabel('Symbols to use')).toHaveValue(DEFAULT_SYMBOLS);
    });

    test('survives stored options that aren’t JSON', async ({ page, context }) => {
        await context.addInitScript(() => localStorage.setItem('pwgen-options', '{not json'));
        await page.goto('/password-generator');
        const [pw] = await readValues(page, 1);
        expect(pw).toHaveLength(20);
    });

    test('long values wrap on a 375px screen', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 740 });
        await page.goto('/password-generator');
        await page.getByLabel('Length value').fill('128');
        await readValues(page, 1);
        await page.getByLabel('How many value').fill('50');
        await readValues(page, 50);
        const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(await overflow()).toBeLessThanOrEqual(0);

        await modeButton(page, 'Passphrase').click();
        await page.getByRole('button', { name: 'None', exact: true }).click();
        const slider = page.getByLabel('Words', { exact: true });
        await slider.focus();
        await page.keyboard.press('End');
        const phrases = await readValues(page, 50);
        expect(phrases[0].length).toBeGreaterThanOrEqual(36); // 12 words of at least 3 letters, no separator
        expect(await overflow()).toBeLessThanOrEqual(0);
    });
});
