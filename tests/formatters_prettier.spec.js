import { test, expect as baseExpect } from '@playwright/test';

// The Prettier languages of the Code Formatters page. Expected outputs were
// produced independently with Prettier's own Node API (all built-in plugins),
// i.e. what the Prettier CLI prints with default options.

// Each language's Prettier plugins are downloaded on first use (TypeScript's
// is ~900 KB), which can take several seconds on a busy machine.
const expect = baseExpect.configure({ timeout: 15_000 });

const options = (page) => page.getByRole('region', { name: 'Formatting options' });
const pickLanguage = (page, value) => options(page).getByLabel('Language').selectOption(value);
const setInput = (page, text) => page.evaluate((value) => window.monaco.editor.getModels()[0].setValue(value), text);
const output = (page) => page.evaluate(() => window.monaco.editor.getModels()[1].getValue());
const formatNow = (page) => page.getByRole('button', { name: 'Format', exact: true }).click();

const SAMPLES = {
    html: {
        input: '<ul><li>One</li><li>Two</li></ul><script>let a={b:1}</script><style>a{color:red}</style>',
        output: '<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>\n<script>\n  let a = { b: 1 };\n</script>\n<style>\n  a {\n    color: red;\n  }\n</style>\n',
    },
    css: {
        input: 'a{color:red;background:blue}@media (max-width:600px){a{color:green}}',
        output: 'a {\n  color: red;\n  background: blue;\n}\n@media (max-width: 600px) {\n  a {\n    color: green;\n  }\n}\n',
    },
    scss: {
        input: '$c:red;.a{color:$c;&:hover{color:darken($c,10%)}}',
        output: '$c: red;\n.a {\n  color: $c;\n  &:hover {\n    color: darken($c, 10%);\n  }\n}\n',
    },
    less: {
        input: '@c:red;.mixin(){margin:0}.a{color:@c;.mixin();.b{color:blue}}',
        output: '@c: red;\n.mixin() {\n  margin: 0;\n}\n.a {\n  color: @c;\n  .mixin();\n  .b {\n    color: blue;\n  }\n}\n',
    },
    javascript: {
        input: 'const App=()=><div className="app"><h1>Hi</h1></div>\nconst s=\'single\'',
        output: 'const App = () => (\n  <div className="app">\n    <h1>Hi</h1>\n  </div>\n);\nconst s = "single";\n',
    },
    typescript: {
        input: 'function id<T>(x:T):T{return x}\nconst el=<div>{id<string>("a")}</div>',
        output: 'function id<T>(x: T): T {\n  return x;\n}\nconst el = <div>{id<string>("a")}</div>;\n',
    },
    yaml: {
        input: 'a:   1\nb: [1,2]\nc:\n    d: x\n',
        output: 'a: 1\nb: [1, 2]\nc:\n  d: x\n',
    },
    graphql: {
        input: 'query{user(id:1){name friends{name}}}',
        output: 'query {\n  user(id: 1) {\n    name\n    friends {\n      name\n    }\n  }\n}\n',
    },
    markdown: {
        // The ts code block is formatted too (the TypeScript plugin loads on demand)
        input: '# Title\n* a\n* b\n```ts\nlet x:number=1\n```\n',
        output: '# Title\n\n- a\n- b\n\n```ts\nlet x: number = 1;\n```\n',
    },
};

test.describe('Code Formatters: Prettier languages', () => {
    test.describe.configure({ timeout: 60_000 });

    test.beforeEach(async ({ page }) => {
        await page.goto('/formatters');
        await page.waitForSelector('.monaco-editor');
    });

    for (const [language, { input, output: expected }] of Object.entries(SAMPLES)) {
        test(`formats ${language}`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await pickLanguage(page, language);
            await setInput(page, input);
            await formatNow(page);
            await expect.poll(() => output(page)).toBe(expected);
            await expect(page.getByRole('alert').filter({ hasText: /Invalid|Couldn’t/ })).toHaveCount(0);
            // Prettier ends files with a newline, which isn't counted as a line
            const lines = expected.split('\n').length - 1;
            await expect(page.getByText(`${lines} lines ·`)).toBeVisible();
            expect(errors).toEqual([]);
        });
    }

    test('a syntax error shows its line and column, marks it in the editor and clears the output', async ({ page }) => {
        await pickLanguage(page, 'javascript');
        await setInput(page, 'const ok = 1');
        await formatNow(page);
        await expect.poll(() => output(page)).toBe('const ok = 1;\n');

        await setInput(page, 'const a = {\n  b: 1,\n  c: ,\n}');
        await formatNow(page);
        const alert = page.getByRole('alert').filter({ hasText: 'Invalid JavaScript' });
        await expect(alert).toBeVisible();
        await expect(alert).toContainText('Unexpected token (line 3, column 6)');
        await expect.poll(() => output(page)).toBe('');
        await expect(page.getByRole('region', { name: 'Output' }).getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();

        const markers = await page.evaluate(() => window.monaco.editor.getModelMarkers({ owner: 'formatter' })
            .map(({ startLineNumber, startColumn, severity }) => ({ startLineNumber, startColumn, severity })));
        expect(markers).toEqual([{ startLineNumber: 3, startColumn: 6, severity: 8 }]);

        await alert.getByRole('button', { name: 'Go to line 3' }).click();
        const position = await page.evaluate(() => {
            const input = window.monaco.editor.getModels()[0];
            return window.monaco.editor.getEditors().find((e) => e.getModel() === input).getPosition();
        });
        expect(position).toEqual({ lineNumber: 3, column: 6 });

        // Fixing the code clears the error and the marker
        await setInput(page, 'const a = {\n  b: 1,\n  c: 2,\n}');
        await formatNow(page);
        await expect.poll(() => output(page)).toBe('const a = {\n  b: 1,\n  c: 2,\n};\n');
        await expect(alert).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.monaco.editor.getModelMarkers({ owner: 'formatter' }).length)).toBe(0);
    });

    test('errors from other parsers carry positions too, and suggest the right language', async ({ page }) => {
        await pickLanguage(page, 'yaml');
        await setInput(page, 'a: 1\nb:\n  - x\n  y: 2\n');
        await formatNow(page);
        await expect(page.getByRole('alert').filter({ hasText: 'Invalid YAML' }))
            .toContainText('All mapping items must start at the same column (line 4, column 1)');
        const marker = await page.evaluate(() => window.monaco.editor.getModelMarkers({ owner: 'formatter' })
            .map(({ startLineNumber, startColumn, endLineNumber, endColumn }) => [startLineNumber, startColumn, endLineNumber, endColumn]));
        expect(marker).toEqual([[4, 1, 4, 2]]);

        // TypeScript pasted as JavaScript
        await pickLanguage(page, 'javascript');
        await setInput(page, 'let total: number = 1');
        await formatNow(page);
        const alert = page.getByRole('alert').filter({ hasText: 'Invalid JavaScript' });
        await expect(alert).toContainText('This looks like TypeScript.');
        await alert.getByRole('button', { name: 'Format as TypeScript' }).click();
        await expect(options(page).getByLabel('Language')).toHaveValue('typescript');
        await expect.poll(() => output(page)).toBe('let total: number = 1;\n');
    });

    test('options change the output, and are remembered', async ({ page }) => {
        const input = 'const s = "hi"\nconst o = {a: 1, \'b-c\': [1,\n2]}\nconst f = (x) => x';
        await pickLanguage(page, 'javascript');
        await setInput(page, input);
        await formatNow(page);
        await expect.poll(() => output(page)).toBe('const s = "hi";\nconst o = { a: 1, "b-c": [1, 2] };\nconst f = (x) => x;\n');

        const style = page.getByRole('group', { name: 'JavaScript style' });
        await style.getByLabel('Single quotes', { exact: true }).check();
        await expect.poll(() => output(page)).toBe("const s = 'hi';\nconst o = { a: 1, 'b-c': [1, 2] };\nconst f = (x) => x;\n");

        await style.getByLabel('Semicolons').uncheck();
        await style.getByLabel('Quote keys').selectOption('consistent');
        await style.getByLabel('Arrow parens').selectOption('avoid');
        await style.getByLabel('Spaces inside braces').uncheck();
        const custom = "const s = 'hi'\nconst o = {'a': 1, 'b-c': [1, 2]}\nconst f = x => x\n";
        await expect.poll(() => output(page)).toBe(custom);

        await options(page).getByLabel('Print width').selectOption('40');
        await setInput(page, 'call(argumentNumberOne, argumentNumberTwo, argumentNumberThree)');
        await formatNow(page);
        await expect.poll(() => output(page)).toBe('call(\n  argumentNumberOne,\n  argumentNumberTwo,\n  argumentNumberThree,\n)\n');
        await style.getByLabel('Trailing commas').selectOption('none');
        await expect.poll(() => output(page)).toBe('call(\n  argumentNumberOne,\n  argumentNumberTwo,\n  argumentNumberThree\n)\n');

        // Saved with the other Formatters preferences, and still applied after a reload
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vt-formatters-prefs')));
        expect(saved).toMatchObject({
            indent: '2', live: true, singleQuote: true, semi: false, quoteProps: 'consistent',
            arrowParens: 'avoid', bracketSpacing: false, printWidth: 40, trailingComma: 'none',
        });
        await page.reload();
        await page.waitForSelector('.monaco-editor');
        await pickLanguage(page, 'javascript');
        await expect(style.getByLabel('Single quotes', { exact: true })).toBeChecked();
        await expect(style.getByLabel('Semicolons')).not.toBeChecked();
        await expect(options(page).getByLabel('Print width')).toHaveValue('40');
        await setInput(page, input);
        await formatNow(page);
        await expect.poll(() => output(page)).toBe(custom);

        // Indent is shared with JSON, SQL and XML
        await options(page).getByLabel('Indent').selectOption('4');
        await setInput(page, 'function f(){return 1}');
        await formatNow(page);
        await expect.poll(() => output(page)).toBe('function f() {\n    return 1\n}\n');
    });

    test('only the options that apply to the language are shown', async ({ page }) => {
        const opts = options(page);
        await pickLanguage(page, 'javascript');
        for (const label of ['Semicolons', 'Trailing commas', 'Quote keys', 'Arrow parens', 'Single quotes in JSX', 'Bracket on same line']) {
            await expect(opts.getByLabel(label, { exact: true })).toBeVisible();
        }

        await pickLanguage(page, 'css');
        await expect(opts.getByLabel('Single quotes', { exact: true })).toBeVisible();
        await expect(opts.getByLabel('Print width')).toBeVisible();
        await expect(opts.getByLabel('Semicolons')).toHaveCount(0);
        await expect(opts.getByLabel('Trailing commas')).toHaveCount(0);

        await pickLanguage(page, 'markdown');
        await expect(opts.getByLabel('Wrap prose')).toBeVisible();
        await expect(opts.getByLabel('Format embedded code')).toBeChecked();
        await expect(opts.getByLabel('Semicolons')).toHaveCount(0);

        await pickLanguage(page, 'html');
        await expect(opts.getByLabel('Whitespace')).toBeVisible();
        await expect(opts.getByLabel('One attribute per line')).toBeVisible();
        await expect(opts.getByLabel('Wrap prose')).toHaveCount(0);

        // YAML can't use tabs
        await pickLanguage(page, 'yaml');
        await expect(opts.getByLabel('Indent').locator('option')).toHaveText(['2 spaces', '4 spaces']);

        // JSON and SQL keep their own controls and get no Prettier options
        await pickLanguage(page, 'json');
        await expect(opts.getByLabel('Print width')).toHaveCount(0);
        await expect(opts.getByLabel('Single quotes', { exact: true })).toHaveCount(0);
        await expect(page.getByPlaceholder(/JMESPath/)).toBeVisible();
        await pickLanguage(page, 'sql');
        await expect(opts.getByLabel('Dialect')).toBeVisible();
        await expect(opts.getByLabel('Print width')).toHaveCount(0);
    });

    test('CSS can be minified; Minify is offered only where it is safe', async ({ page }) => {
        const css = '/* theme */\n:root {\n  --gap: 8px;\n}\n.card > .title,\n.card:hover {\n  margin: 0 auto;\n  padding: calc(var(--gap) * 2) 4px;\n  color: #333 !important;\n}\n@media (max-width: 600px) {\n  .card {\n    display: none;\n  }\n}\n';
        await pickLanguage(page, 'css');
        await setInput(page, css);
        await page.getByTitle('Minify (0 spaces)').click();
        await formatNow(page);
        await expect.poll(() => output(page)).toBe(
            ':root{--gap:8px}.card>.title,.card:hover{margin:0 auto;padding:calc(var(--gap) * 2) 4px;color:#333!important}@media (max-width:600px){.card{display:none}}',
        );
        await expect(options(page).getByLabel('Print width')).toHaveCount(0);

        // Invalid CSS is reported, not "minified"
        await setInput(page, 'a { color: red');
        await formatNow(page);
        await expect(page.getByRole('alert').filter({ hasText: 'Invalid CSS' })).toContainText('Unclosed block (line 1, column 1)');
        await expect.poll(() => output(page)).toBe('');

        for (const language of ['scss', 'less', 'javascript', 'typescript', 'html', 'yaml', 'graphql', 'markdown']) {
            await pickLanguage(page, language);
            await expect(options(page).getByRole('group', { name: 'Output style' })).toHaveCount(0);
        }
        // Minify is remembered for the languages that have it
        await setInput(page, 'a{b:c}');
        await pickLanguage(page, 'css');
        await expect(options(page).getByRole('button', { name: 'Minify' })).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => output(page)).toBe('a{b:c}');
    });

    test('switching languages keeps the editor responsive and highlighted', async ({ page }) => {
        const all = ['json', 'yaml', 'xml', 'html', 'markdown', 'css', 'scss', 'less', 'javascript', 'typescript', 'sql', 'graphql'];
        await expect(options(page).getByLabel('Language').locator('option')).toHaveCount(all.length);
        for (const language of all) {
            await pickLanguage(page, language);
            await expect.poll(() => page.evaluate(() => window.monaco.editor.getModels().slice(0, 2).map((m) => m.getLanguageId())))
                .toEqual([language, language]);
        }

        // Each new language has a Monarch tokenizer (syntax highlighting)
        const snippets = {
            html: ['<div class="a">x</div>', '.html'],
            css: ['a { color: red; }', '.css'],
            scss: ['$a: 1;', '.scss'],
            less: ['@a: 1;', '.less'],
            javascript: ['const a = 1', '.js'],
            typescript: ['let a: number', '.ts'],
            yaml: ['a: 1', '.yaml'],
            graphql: ['query { a }', '.gql'],
            markdown: ['# Title', '.md'],
        };
        const highlighted = () => page.evaluate((cases) => Object.fromEntries(Object.entries(cases).map(([language, [code, postfix]]) => [
            language,
            window.monaco.editor.tokenize(code, language).flat().some((t) => t.type.endsWith(postfix)),
        ])), snippets);
        await expect.poll(highlighted).toEqual(Object.fromEntries(Object.keys(snippets).map((language) => [language, true])));

        // Typing still formats live after all that switching
        await pickLanguage(page, 'typescript');
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.type('let   total:number=1');
        await expect.poll(() => output(page)).toBe('let total: number = 1;\n');
        await pickLanguage(page, 'javascript');
        await expect(page.getByRole('alert').filter({ hasText: 'Invalid JavaScript' })).toContainText('(line 1, column 12)');
        await pickLanguage(page, 'graphql');
        await setInput(page, '{user{id}}');
        await expect.poll(() => output(page)).toBe('{\n  user {\n    id\n  }\n}\n');
    });

    test('shows that a formatter is loading, and can retry a failed download', async ({ page }) => {
        let release;
        const released = new Promise((resolve) => { release = resolve; });
        let fail = true;
        await page.route(/prettier_plugins_graphql|prettier-graphql/, async (route) => {
            if (fail) return route.abort('internetdisconnected');
            await released;
            return route.continue();
        });
        await pickLanguage(page, 'graphql');
        await setInput(page, '{a}');
        await formatNow(page);
        const alert = page.getByRole('alert').filter({ hasText: 'Couldn’t load the GraphQL formatter' });
        await expect(alert).toContainText('Check your connection and try again.');

        fail = false;
        await alert.getByRole('button', { name: 'Try again' }).click();
        await expect(page.getByText('Loading the GraphQL formatter…').first()).toBeVisible();
        release();
        await expect.poll(() => output(page)).toBe('{\n  a\n}\n');
        await expect(alert).toHaveCount(0);
    });

    test('stored preferences from before Prettier still work, and bad values fall back', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('vt-formatters-prefs', JSON.stringify({
                indent: '4', dialect: 'mysql', keywordCase: 'lower', live: true, semi: 'no', printWidth: 7, trailingComma: 'sometimes',
            }));
        });
        await page.reload();
        await page.waitForSelector('.monaco-editor');
        await pickLanguage(page, 'javascript');
        await expect(options(page).getByLabel('Print width')).toHaveValue('80');
        await expect(page.getByRole('group', { name: 'JavaScript style' }).getByLabel('Semicolons')).toBeChecked();
        await setInput(page, 'function f(){return [1,2]}');
        await formatNow(page);
        await expect.poll(() => output(page)).toBe('function f() {\n    return [1, 2];\n}\n');
        await pickLanguage(page, 'sql');
        await expect(options(page).getByLabel('Dialect')).toHaveValue('mysql');
        await expect(options(page).getByLabel('Keywords')).toHaveValue('lower');
    });

    test('smart input opens the new languages (and common aliases)', async ({ page }) => {
        const open = (state) => page.evaluate((usr) => {
            window.history.pushState({ usr: { smart: true, ...usr }, key: `t${Date.now()}`, idx: window.history.length }, '', '/formatters');
            window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
        }, state);
        await open({ input: 'a:   1\nb: [1,2]', mode: 'yaml' });
        await expect(options(page).getByLabel('Language')).toHaveValue('yaml');
        await expect.poll(() => output(page)).toBe('a: 1\nb: [1, 2]\n');

        await open({ input: 'let x:number=1', mode: 'ts' });
        await expect(options(page).getByLabel('Language')).toHaveValue('typescript');
        await expect.poll(() => output(page)).toBe('let x: number = 1;\n');

        // Without a mode, HTML is told apart from XML
        await open({ input: '<div><p>Hi</p></div>' });
        await expect(options(page).getByLabel('Language')).toHaveValue('html');
        await expect.poll(() => output(page)).toBe('<div><p>Hi</p></div>\n');
    });

    test('the style options fold away on a phone-width screen', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 740 });
        await pickLanguage(page, 'typescript');
        const summary = options(page).getByText('Style options (defaults)');
        await expect(summary).toBeVisible();
        await expect(options(page).getByLabel('Semicolons')).toBeHidden();
        await summary.click();
        await options(page).getByLabel('Semicolons').uncheck();
        await expect(options(page).getByText('Style options (1 changed)')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
