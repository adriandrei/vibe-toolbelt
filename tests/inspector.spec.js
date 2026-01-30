import { test, expect } from '@playwright/test'

test.describe('Universal Inspector', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/inspect')
    })

    test('Inspector page loads correctly', async ({ page }) => {
        await expect(page.getByRole('heading', { name: /Universal Inspector/i })).toBeVisible()
        await expect(page.getByPlaceholder(/paste any text/i)).toBeVisible()
    })

    test('Detects JSON format', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('{"name": "test", "value": 123}')

        await expect(page.getByText('Detected Format')).toBeVisible()
        await expect(page.getByText('JSON', { exact: true })).toBeVisible()
        await expect(page.getByText(/Formatted JSON Preview/i)).toBeVisible()
    })

    test('Detects JWT token', async ({ page }) => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill(jwt)

        await expect(page.getByText('JWT Token')).toBeVisible()
        await expect(page.getByText(/JWT Decoded Preview/i)).toBeVisible()
        // Check for decoded content
        await expect(page.getByText('"name": "John Doe"')).toBeVisible()
    })

    test('Detects UUID', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('123e4567-e89b-12d3-a456-426614174000')

        await expect(page.locator('.glass-panel').getByText('UUID', { exact: true })).toBeVisible()
    })

    test('Detects URL format', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('https://example.com/path?query=value')

        await expect(page.getByText('URL', { exact: true })).toBeVisible()
    })

    test('Detects Email', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('test@example.com')

        await expect(page.getByText('Email Address')).toBeVisible()
    })

    test('Detects IPv4 address', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('192.168.1.1')

        await expect(page.getByText('IPv4 Address')).toBeVisible()
    })

    test('Detects IPv6 address', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('2001:0db8:85a3:0000:0000:8a2e:0370:7334')

        await expect(page.getByText('IPv6 Address')).toBeVisible()
    })

    test('Detects MAC Address', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('00:1A:2B:3C:4D:5E')

        await expect(page.getByText('MAC Address')).toBeVisible()
    })

    test('Detects Unix Timestamp', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('1609459200') // 2021-01-01

        await expect(page.locator('.glass-panel').filter({ hasText: 'Detected Format' }).getByText('Unix Timestamp', { exact: true })).toBeVisible()
        await expect(page.getByText(/Timestamp Interpretation/i)).toBeVisible()
    })

    test('Detects ISO 8601 Date', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('2021-01-01T00:00:00Z')

        await expect(page.getByText('ISO 8601 Date')).toBeVisible()
    })

    test('Detects Semantic Version', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('1.0.0-beta.1')

        await expect(page.getByText('Semantic Version')).toBeVisible()
    })

    test('Detects Hex Color', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('#ff0000')

        await expect(page.getByText('Hex Color')).toBeVisible()
    })

    test('Detects Cron Expression', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('*/5 * * * *')

        await expect(page.getByText('Cron Expression')).toBeVisible()
    })

    test('Detects CIDR notation', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('192.168.1.0/24')

        await expect(page.getByText('CIDR Notation')).toBeVisible()
    })

    test('Detects Base64 and decodes it', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('SGVsbG8gV29ybGQ=') // "Hello World"

        await expect(page.getByText('Base64 Encoded')).toBeVisible()
        await expect(page.getByText(/Base64 Decoded Preview/i)).toBeVisible()
        await expect(page.getByText('Hello World')).toBeVisible()
    })

    test('Detects Hex string', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        // Must be longer than 32 chars to trigger hex detection (heuristic)
        const hex = '0123456789abcdef0123456789abcdef01'
        await input.fill(hex)

        await expect(page.getByText('Hexadecimal')).toBeVisible()
    })

    test('Shows statistics section', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('Hello World!')

        await expect(page.locator('h3', { hasText: 'Statistics' })).toBeVisible()
        const statsCard = page.locator('.glass-panel', { hasText: 'Statistics' })
        await expect(statsCard.getByText('12', { exact: true }).first()).toBeVisible() // 12 chars (and bytes)
        await expect(statsCard.getByText('2', { exact: true })).toBeVisible() // 2 words
    })

    test('Shows Shannon entropy analysis', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('aaaaaaaaaa') // Low entropy input

        await expect(page.getByText('Shannon Entropy')).toBeVisible()
        await expect(page.getByText(/Low/i)).toBeVisible()
    })

    test('Calculate and shows hash values', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('test')

        await expect(page.locator('h3', { hasText: 'Hash Values' })).toBeVisible()

        // SHA-256 for 'test'
        const sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
        await expect(page.getByText(sha256)).toBeVisible()
    })

    test('Shows character frequency section', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('hello world')

        await expect(page.locator('h3', { hasText: 'Character Frequency' })).toBeVisible()
        await expect(page.getByText('l', { exact: true })).toBeVisible()
        await expect(page.getByText('3 (27.3%)')).toBeVisible() // 3 'l's in 11 chars ~ 27.3%
    })
})
