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

        // Should detect JSON and show formatted preview
        await expect(page.getByText('Detected Format')).toBeVisible()
        await expect(page.getByText(/Formatted JSON Preview/i)).toBeVisible()
    })

    test('Detects JWT token', async ({ page }) => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill(jwt)

        await expect(page.getByText('JWT Token')).toBeVisible()
    })

    test('Detects URL format', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('https://example.com/path?query=value')

        // URL contains both url and uses text matching
        await expect(page.getByText('Detected Format')).toBeVisible()
    })

    test('Detects IPv4 address', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('192.168.1.1')

        await expect(page.getByText('IPv4 Address')).toBeVisible()
    })

    test('Shows statistics section', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('Hello World!')

        // Wait for statistics to appear
        await expect(page.locator('h3', { hasText: 'Statistics' })).toBeVisible()
    })

    test('Shows Shannon entropy analysis', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('aaaaaaaaaa') // Low entropy input

        await expect(page.getByText('Shannon Entropy')).toBeVisible()
    })

    test('Shows hash values section', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('test')

        await expect(page.locator('h3', { hasText: 'Hash Values' })).toBeVisible()
    })

    test('Shows character frequency section', async ({ page }) => {
        const input = page.getByPlaceholder(/paste any text/i)
        await input.fill('hello world')

        await expect(page.locator('h3', { hasText: 'Character Frequency' })).toBeVisible()
    })
})
