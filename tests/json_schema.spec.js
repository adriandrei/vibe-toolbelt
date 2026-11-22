import { test, expect } from '@playwright/test';

const schemaBox = (page) => page.getByRole('textbox', { name: /^Schema/ });
const dataBox = (page) => page.getByRole('textbox', { name: /^Data/ });
const results = (page) => page.getByRole('region', { name: 'Result' });
const errorList = (page) => page.getByRole('list', { name: 'Validation errors' });
// Copying is asynchronous; the Windows clipboard also turns \n into \r\n
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText()).then(t => t.replace(/\r\n/g, '\n'));

test.describe('JSON Schema Validator', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/json-schema');
        await expect(page.locator('main h1')).toHaveText('JSON Schema Validator');
    });

    test('shows the real causes of the example first and keeps the summaries', async ({ page }) => {
        await expect(page.getByText('Nothing to check yet')).toBeVisible();
        await page.getByRole('button', { name: 'Load example' }).first().click();

        await expect(results(page).getByText('Invalid: 3 problems')).toBeVisible();
        const items = errorList(page).getByRole('listitem');
        await expect(items).toHaveCount(3);
        await expect(items.nth(0)).toContainText('$.items[1].quantity');
        await expect(items.nth(0)).toContainText('Must be at least 1 (got 0).');
        await expect(items.nth(0)).toContainText('/items/1/quantity');
        await expect(items.nth(0)).toContainText('#/properties/items/items/properties/quantity/minimum');
        await expect(items.nth(1)).toContainText('$.items[2].price');
        await expect(items.nth(1)).toContainText('Expected a number, got the string "4.99".');
        await expect(items.nth(1)).toContainText('type');
        await expect(items.nth(2)).toContainText('$.status');
        await expect(items.nth(2)).toContainText('Must be one of "pending", "paid" or "shipped" (got "refunded").');

        // The wrapper errors are collapsed but available
        const summaries = page.getByRole('list', { name: 'Summary errors' });
        await expect(summaries).toBeHidden();
        await page.getByText('Show 6 summary errors').click();
        await expect(summaries.getByRole('listitem')).toHaveCount(6);
        await expect(summaries.getByRole('listitem').first()).toContainText('Property "items" has errors.');

        await expect(page.getByText('Using 2020-12 (from $schema).')).toBeVisible();
    });

    test('fixing the data makes it valid', async ({ page }) => {
        await page.getByRole('button', { name: 'Load example' }).first().click();
        await expect(results(page).getByText('Invalid: 3 problems')).toBeVisible();
        const fixed = (await dataBox(page).inputValue())
            .replace('"quantity": 0', '"quantity": 3')
            .replace('"4.99"', '4.99')
            .replace('"refunded"', '"paid"');
        await dataBox(page).fill(fixed);
        await expect(results(page).getByRole('status').filter({ hasText: 'Valid' })).toContainText('The data matches the schema (2020-12).');
        await expect(errorList(page)).toHaveCount(0);
    });

    test('reads YAML for both inputs', async ({ page }) => {
        await schemaBox(page).fill('type: object\nrequired: [name]\nproperties:\n  name: { type: string, minLength: 2 }\n  tags:\n    type: array\n    uniqueItems: true\n');
        await dataBox(page).fill('name: A\ntags: [x, y, x]\n');
        await expect(page.getByRole('region', { name: 'Schema' }).getByText('YAML', { exact: true })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Data' }).getByText('YAML', { exact: true })).toBeVisible();
        await expect(results(page).getByText('Invalid: 2 problems')).toBeVisible();
        await expect(errorList(page)).toContainText('Must be at least 2 characters long (it has 1).');
        await expect(errorList(page)).toContainText('Items 0 and 2 are the same, but items must be unique.');

        // YAML can be rewritten as JSON
        await page.getByRole('button', { name: 'Convert schema to JSON' }).click();
        const json = JSON.parse(await schemaBox(page).inputValue());
        expect(json).toEqual({ type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 2 }, tags: { type: 'array', uniqueItems: true } } });
    });

    test('formats JSON without changing numbers', async ({ page }) => {
        await dataBox(page).fill('{"id":12345678901234567890,"price":1.50,"tags":["a"]}');
        await page.getByRole('button', { name: 'Format data' }).click();
        await expect(dataBox(page)).toHaveValue('{\n  "id": 12345678901234567890,\n  "price": 1.50,\n  "tags": [\n    "a"\n  ]\n}');
    });

    test('reports schema problems separately and does not validate against a broken schema', async ({ page }) => {
        await schemaBox(page).fill('{"type": "int", "properties": {"age": {"minimum": "18"}}}');
        await dataBox(page).fill('{"age": 3}');
        const problems = results(page).getByRole('alert').filter({ hasText: 'Schema problems (2)' });
        await expect(problems).toBeVisible();
        await expect(problems).toContainText('#/type');
        await expect(problems).toContainText('"int" isn’t a JSON Schema type. Did you mean "integer"?');
        await expect(problems).toContainText('#/properties/age/minimum');
        await expect(problems).toContainText('"minimum" must be a number, not a string.');
        await expect(results(page).getByText(/^Invalid:/)).toHaveCount(0);
        await expect(results(page).getByText('Valid', { exact: true })).toHaveCount(0);

        // A JSON array is not a schema
        await schemaBox(page).fill('[1, 2]');
        await expect(results(page)).toContainText('A schema must be a JSON object or a boolean (true or false), but this is an array.');
    });

    test('warns about likely typos', async ({ page }) => {
        await schemaBox(page).fill('{"type": "string", "maxlength": 3}');
        await dataBox(page).fill('"abcdef"');
        await expect(results(page).getByText('Schema warnings (1)')).toBeVisible();
        await expect(results(page)).toContainText('Unknown keyword "maxlength" is ignored. Did you mean "maxLength"?');
        // The misspelt keyword really is ignored
        await expect(results(page).getByText('The data matches the schema (2020-12).')).toBeVisible();
    });

    test('reports a $ref that cannot be resolved', async ({ page }) => {
        await schemaBox(page).fill('{"properties": {"a": {"$ref": "https://example.com/other.json"}}}');
        await dataBox(page).fill('{"a": 1}');
        await expect(results(page).getByRole('alert').filter({ hasText: 'The schema can’t be used' })).toContainText('Can’t resolve "$ref": "https://example.com/other.json"');
    });

    test('picks the draft from $schema and lets you override it', async ({ page }) => {
        await schemaBox(page).fill('{"$schema": "http://json-schema.org/draft-04/schema#", "minimum": 5, "exclusiveMinimum": true}');
        await dataBox(page).fill('5');
        await expect(page.getByText('Using draft-04 (from $schema).')).toBeVisible();
        await expect(errorList(page)).toContainText('Must be greater than 5 (got 5).');

        await page.getByLabel('Draft', { exact: true }).selectOption('2020-12');
        await expect(results(page)).toContainText('The schema’s "$schema" says draft-04, but 2020-12 is selected.');
        await expect(results(page)).toContainText('"exclusiveMinimum": true is draft-04 style.');
    });

    test('shows why each anyOf option failed', async ({ page }) => {
        await schemaBox(page).fill('{"properties": {"id": {"anyOf": [{"type": "string"}, {"type": "integer", "minimum": 1}]}}}');
        await dataBox(page).fill('{"id": 0}');
        const item = errorList(page).getByRole('listitem').first();
        await expect(item).toContainText('$.id');
        await expect(item).toContainText('Doesn’t match any of the allowed options (anyOf).');
        await item.getByText('Why each option failed').click();
        await expect(item).toContainText('Option 1');
        await expect(item).toContainText('Expected a string, got the number 0.');
        await expect(item).toContainText('Option 2');
        await expect(item).toContainText('Must be at least 1 (got 0).');
    });

    test('explains unreadable data', async ({ page }) => {
        await schemaBox(page).fill('{"type": "object"}');
        await dataBox(page).fill('{"a": }');
        await expect(page.getByRole('region', { name: 'Data' }).getByText('Invalid', { exact: true })).toBeVisible();
        await expect(dataBox(page)).toHaveAttribute('aria-invalid', 'true');
        await expect(results(page).getByRole('alert').filter({ hasText: 'The data can’t be read' })).toBeVisible();
    });

    test('copies the errors', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.getByRole('button', { name: 'Load example' }).first().click();
        await page.evaluate(() => navigator.clipboard.writeText(''));
        await page.getByRole('button', { name: 'Copy errors' }).click();
        await expect.poll(() => clipboard(page)).not.toBe('');
        expect((await clipboard(page)).split('\n')).toEqual([
            '$.items[1].quantity: Must be at least 1 (got 0). (minimum at #/properties/items/items/properties/quantity/minimum)',
            '$.items[2].price: Expected a number, got the string "4.99". (type at #/properties/items/items/properties/price/type)',
            '$.status: Must be one of "pending", "paid" or "shipped" (got "refunded"). (enum at #/properties/status/enum)',
        ]);
    });

    test('a shared link reopens the schema and data', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await schemaBox(page).fill('{"type": "array", "maxItems": 1}');
        await dataBox(page).fill('[1, 2]');
        await page.getByLabel('Draft', { exact: true }).selectOption('7');
        await expect(results(page).getByText('Invalid: 1 problem')).toBeVisible();
        await page.evaluate(() => navigator.clipboard.writeText(''));
        await page.getByRole('button', { name: 'Share link' }).click();
        await expect.poll(() => clipboard(page)).toMatch(/\/json-schema#s=[A-Za-z0-9_-]+$/);
        const url = await clipboard(page);

        const other = await context.newPage();
        await other.goto(url);
        await expect(schemaBox(other)).toHaveValue('{"type": "array", "maxItems": 1}');
        await expect(dataBox(other)).toHaveValue('[1, 2]');
        await expect(other.getByLabel('Draft', { exact: true })).toHaveValue('7');
        await expect(errorList(other)).toContainText('Must have at most 1 item (it has 2).');
        await expect(other).toHaveURL(/\/json-schema$/);
    });

    test('sends the data to JSON to Types to generate a schema', async ({ page }) => {
        await dataBox(page).fill('name: Ada\nage: 36\n');
        await page.getByRole('button', { name: 'Generate schema' }).click();
        await expect(page).toHaveURL(/\/type-converter$/);
        const input = page.getByRole('textbox', { name: /JSON sample/ });
        await expect.poll(async () => JSON.parse(await input.inputValue())).toEqual({ name: 'Ada', age: 36 });
        // It opens on the JSON Schema output, not the default TypeScript one
        await expect(page.getByRole('button', { name: 'JSON Schema', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('main')).toContainText('"$schema"');
    });

    test('fits a phone screen with results showing', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 740 });
        await page.getByRole('button', { name: 'Load example' }).first().click();
        await expect(results(page).getByText('Invalid: 3 problems')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
