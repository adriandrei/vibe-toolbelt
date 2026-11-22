import { describe, it, expect, vi } from 'vitest'
import {
    LANGUAGE_OPTIONS,
    PRETTIER_DEFAULTS,
    PRETTIER_LANGUAGES,
    PRETTIER_OPTIONS,
    describePrettierError,
    formatCode,
    isPrettierLanguage,
    minifyCss,
    pluginsFor,
    readPrettierOptions,
} from './prettierFormat.js'

// Messy input → Prettier's output with default options. The expected strings
// were checked against Prettier's own Node API (all built-in plugins), so the
// standalone build with only the plugins each language loads gives the same
// result as the Prettier CLI.
const SAMPLES = {
    html: {
        input: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Demo</title><style>body{margin:0}.card{padding:16px}</style></head><body><main class="card"><h1>Hello</h1><ul><li>One</li><li>Two</li></ul></main><script>document.querySelector(\'h1\').addEventListener(\'click\',()=>{console.log("hi")})</script></body></html>',
        output: [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '  <head>',
            '    <meta charset="utf-8" />',
            '    <title>Demo</title>',
            '    <style>',
            '      body {',
            '        margin: 0;',
            '      }',
            '      .card {',
            '        padding: 16px;',
            '      }',
            '    </style>',
            '  </head>',
            '  <body>',
            '    <main class="card">',
            '      <h1>Hello</h1>',
            '      <ul>',
            '        <li>One</li>',
            '        <li>Two</li>',
            '      </ul>',
            '    </main>',
            '    <script>',
            '      document.querySelector("h1").addEventListener("click", () => {',
            '        console.log("hi");',
            '      });',
            '    </script>',
            '  </body>',
            '</html>',
            '',
        ].join('\n'),
    },
    css: {
        input: ':root{--accent:#6d5efc}body{margin:0;font:16px/1.5 system-ui,sans-serif}.btn,.btn:hover{padding:.5rem 1rem;background:var(--accent)}@media (max-width:600px){.btn{width:100%}}',
        output: [
            ':root {',
            '  --accent: #6d5efc;',
            '}',
            'body {',
            '  margin: 0;',
            '  font:',
            '    16px/1.5 system-ui,',
            '    sans-serif;',
            '}',
            '.btn,',
            '.btn:hover {',
            '  padding: 0.5rem 1rem;',
            '  background: var(--accent);',
            '}',
            '@media (max-width: 600px) {',
            '  .btn {',
            '    width: 100%;',
            '  }',
            '}',
            '',
        ].join('\n'),
    },
    scss: {
        input: '$accent:#6d5efc;@mixin card($pad:16px){padding:$pad}.card{@include card(24px);background:lighten($accent,40%);&:hover{box-shadow:0 2px 8px rgba(0,0,0,.2)}}',
        output: [
            '$accent: #6d5efc;',
            '@mixin card($pad: 16px) {',
            '  padding: $pad;',
            '}',
            '.card {',
            '  @include card(24px);',
            '  background: lighten($accent, 40%);',
            '  &:hover {',
            '    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);',
            '  }',
            '}',
            '',
        ].join('\n'),
    },
    less: {
        input: '@accent:#6d5efc;.rounded(@r:8px){border-radius:@r}.card{.rounded(12px);background:lighten(@accent,40%);&:hover{color:darken(@accent,10%)}}',
        output: [
            '@accent: #6d5efc;',
            '.rounded(@r:8px) {',
            '  border-radius: @r;',
            '}',
            '.card {',
            '  .rounded(12px);',
            '  background: lighten(@accent, 40%);',
            '  &:hover {',
            '    color: darken(@accent, 10%);',
            '  }',
            '}',
            '',
        ].join('\n'),
    },
    javascript: {
        input: "import {useState} from 'react'\nexport default function Counter({initial=0,step=1}){const [count,setCount]=useState(initial);const label=count===1?\"1 click\":`${count} clicks`\nreturn <div className=\"counter\"><button onClick={()=>setCount(c=>c+step)}>Add {step}</button><span>{label}</span></div>}",
        output: [
            'import { useState } from "react";',
            'export default function Counter({ initial = 0, step = 1 }) {',
            '  const [count, setCount] = useState(initial);',
            '  const label = count === 1 ? "1 click" : `${count} clicks`;',
            '  return (',
            '    <div className="counter">',
            '      <button onClick={() => setCount((c) => c + step)}>Add {step}</button>',
            '      <span>{label}</span>',
            '    </div>',
            '  );',
            '}',
            '',
        ].join('\n'),
    },
    typescript: {
        input: "interface User{id:number;name:string;email?:string;roles:Array<'admin'|'editor'>}\ntype Result<T>={ok:true;value:T}|{ok:false;error:string}\nexport async function getUser(id:number):Promise<Result<User>>{const res=await fetch(`/api/users/${id}`);if(!res.ok){return {ok:false,error:res.statusText}}return {ok:true,value:await res.json() as User}}",
        output: [
            'interface User {',
            '  id: number;',
            '  name: string;',
            '  email?: string;',
            '  roles: Array<"admin" | "editor">;',
            '}',
            'type Result<T> = { ok: true; value: T } | { ok: false; error: string };',
            'export async function getUser(id: number): Promise<Result<User>> {',
            '  const res = await fetch(`/api/users/${id}`);',
            '  if (!res.ok) {',
            '    return { ok: false, error: res.statusText };',
            '  }',
            '  return { ok: true, value: (await res.json()) as User };',
            '}',
            '',
        ].join('\n'),
    },
    yaml: {
        input: 'name:   vibe-toolbelt\non: {push: {branches: [main]}, pull_request: {}}\njobs:\n  build:\n      runs-on: ubuntu-latest\n      steps:\n          - uses: actions/checkout@v4\n          - name:   Install\n            run: npm ci\n',
        output: [
            'name: vibe-toolbelt',
            'on: { push: { branches: [main] }, pull_request: {} }',
            'jobs:',
            '  build:',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - uses: actions/checkout@v4',
            '      - name: Install',
            '        run: npm ci',
            '',
        ].join('\n'),
    },
    graphql: {
        input: 'query GetUser($id:ID!,$withPosts:Boolean=false){user(id:$id){id name posts(first:10)@include(if:$withPosts){edges{node{id title}}}}}',
        output: [
            'query GetUser($id: ID!, $withPosts: Boolean = false) {',
            '  user(id: $id) {',
            '    id',
            '    name',
            '    posts(first: 10) @include(if: $withPosts) {',
            '      edges {',
            '        node {',
            '          id',
            '          title',
            '        }',
            '      }',
            '    }',
            '  }',
            '}',
            '',
        ].join('\n'),
    },
    markdown: {
        input: 'Tools\n===\nA set of *developer tools* that run in your browser.\n* Formatters\n* Encoders\n\n1) Paste some code\n2) Pick a language\n```js\nconst greeting = {text:"hello"}\n```\n',
        output: [
            'Tools',
            '===',
            '',
            'A set of _developer tools_ that run in your browser.',
            '',
            '- Formatters',
            '- Encoders',
            '',
            '1. Paste some code',
            '2. Pick a language',
            '',
            '```js',
            'const greeting = { text: "hello" };',
            '```',
            '',
        ].join('\n'),
    },
}

describe('formatCode', () => {
    for (const [language, { input, output }] of Object.entries(SAMPLES)) {
        it(`formats messy ${PRETTIER_LANGUAGES[language].label}`, async () => {
            expect(await formatCode(input, language)).toEqual({ output })
        })
    }

    it('covers every Prettier language', () => {
        expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(PRETTIER_LANGUAGES).sort())
        expect(Object.keys(LANGUAGE_OPTIONS).sort()).toEqual(Object.keys(PRETTIER_LANGUAGES).sort())
    })

    it('applies the JavaScript options', async () => {
        const input = "const a = {b:1, 'c-d': 2}\nconst f = x => [x,\n'y']"
        expect((await formatCode(input, 'javascript')).output).toBe(
            'const a = { b: 1, "c-d": 2 };\nconst f = (x) => [x, "y"];\n',
        )
        const custom = await formatCode(input, 'javascript', {
            semi: false, singleQuote: true, quoteProps: 'consistent', arrowParens: 'avoid', bracketSpacing: false,
        })
        expect(custom.output).toBe("const a = {'b': 1, 'c-d': 2}\nconst f = x => [x, 'y']\n")
    })

    it('applies trailing commas and print width', async () => {
        const input = 'call(argumentNumberOne, argumentNumberTwo, argumentNumberThree)'
        expect((await formatCode(input, 'javascript', { printWidth: 40 })).output).toBe(
            'call(\n  argumentNumberOne,\n  argumentNumberTwo,\n  argumentNumberThree,\n);\n',
        )
        expect((await formatCode(input, 'javascript', { printWidth: 40, trailingComma: 'none' })).output).toBe(
            'call(\n  argumentNumberOne,\n  argumentNumberTwo,\n  argumentNumberThree\n);\n',
        )
        expect((await formatCode(input, 'javascript', { printWidth: 80 })).output).toBe(`${input};\n`)
    })

    it('uses the shared indent setting (YAML always indents with spaces)', async () => {
        expect((await formatCode('a{b:c}', 'css', { indent: '4' })).output).toBe('a {\n    b: c;\n}\n')
        expect((await formatCode('a{b:c}', 'css', { indent: 'tab' })).output).toBe('a {\n\tb: c;\n}\n')
        expect((await formatCode('a:\n      b: 1\n', 'yaml', { indent: 'tab' })).output).toBe('a:\n  b: 1\n')
        expect((await formatCode('a:\n      b: 1\n', 'yaml', { indent: '4' })).output).toBe('a:\n    b: 1\n')
    })

    it('applies the YAML, HTML and Markdown options', async () => {
        expect((await formatCode('a: "x"\nb: {c: 1}\n', 'yaml', { singleQuote: true, bracketSpacing: false })).output)
            .toBe("a: 'x'\nb: {c: 1}\n")
        expect((await formatCode('<a href="x" class="y">z</a>', 'html')).output).toBe('<a href="x" class="y">z</a>\n')
        expect((await formatCode('<a href="x" class="y">z</a>', 'html', { singleAttributePerLine: true })).output)
            .toBe('<a\n  href="x"\n  class="y"\n  >z</a\n>\n')
        const spans = '<div><span>first</span><span>second</span><span>third</span></div>'
        expect((await formatCode(spans, 'html', { printWidth: 40 })).output)
            .toBe('<div>\n  <span>first</span><span>second</span\n  ><span>third</span>\n</div>\n')
        expect((await formatCode(spans, 'html', { printWidth: 40, htmlWhitespaceSensitivity: 'ignore' })).output)
            .toBe('<div>\n  <span>first</span>\n  <span>second</span>\n  <span>third</span>\n</div>\n')
        const button = '<button type="submit" class="btn btn-primary" disabled>Save</button>'
        expect((await formatCode(button, 'html', { printWidth: 40, bracketSameLine: true })).output)
            .toBe('<button\n  type="submit"\n  class="btn btn-primary"\n  disabled>\n  Save\n</button>\n')
        // Widths the page doesn't offer fall back to 80 (at 20 this would break over 6 lines)
        expect((await formatCode('<a href="x" class="y">z</a>', 'html', { printWidth: 20, htmlWhitespaceSensitivity: 'ignore' })).output)
            .toBe('<a href="x" class="y">z</a>\n')
        const prose = 'One two three four five six seven eight nine ten eleven twelve.\n'
        expect((await formatCode(prose, 'markdown', { proseWrap: 'always', printWidth: 40 })).output)
            .toBe('One two three four five six seven eight\nnine ten eleven twelve.\n')
        expect((await formatCode(prose, 'markdown', { printWidth: 40 })).output).toBe(prose)
    })

    it('formats code embedded in Markdown and HTML unless that is turned off', async () => {
        const md = '---\ntitle:   Notes\n---\n\n```ts\nlet x:number=1\n```\n\n```css\na{color:red}\n```\n\n```sh\nls   -la\n```\n'
        expect((await formatCode(md, 'markdown')).output).toBe(
            '---\ntitle: Notes\n---\n\n```ts\nlet x: number = 1;\n```\n\n```css\na {\n  color: red;\n}\n```\n\n```sh\nls   -la\n```\n',
        )
        expect((await formatCode(md, 'markdown', { embeddedLanguageFormatting: 'off' })).output).toBe(md)

        const html = '<div><script>let a={b:1}</script><style>a{color:red}</style></div>'
        expect((await formatCode(html, 'html')).output).toBe(
            '<div>\n  <script>\n    let a = { b: 1 };\n  </script>\n  <style>\n    a {\n      color: red;\n    }\n  </style>\n</div>\n',
        )
        expect((await formatCode(html, 'html', { embeddedLanguageFormatting: 'off' })).output).toBe(
            '<div>\n  <script>\n    let a={b:1}\n  </script>\n  <style>\n    a{color:red}\n  </style>\n</div>\n',
        )
    })

    it('normalises line endings and drops a byte order mark', async () => {
        expect((await formatCode('\uFEFFa{b:c}\r\nd{e:f}', 'css')).output).toBe('a {\n  b: c;\n}\nd {\n  e: f;\n}\n')
    })

    it('minifies CSS after checking it parses', async () => {
        expect(await formatCode('a {\n  color : red ;\n}\n/* note */\nb { margin: 0 auto }\n', 'css', { minify: true }))
            .toEqual({ output: 'a{color :red}b{margin:0 auto}' })
        const invalid = await formatCode('a {\n  color: red;\n  b {\n', 'css', { minify: true })
        expect(invalid.output).toBeUndefined()
        expect(invalid.error).toMatchObject({ kind: 'syntax', message: 'Unclosed block', line: 3, column: 3 })
    })

    it('refuses Minify for languages without a safe minifier', async () => {
        await expect(formatCode('a', 'javascript', { minify: true })).rejects.toThrow(/Minify/)
        await expect(formatCode('a', 'json')).rejects.toThrow(/json/)
    })
})

describe('syntax errors carry the line and column', () => {
    const cases = [
        ['javascript', 'const a = {\n  b: 1,\n  c: ,\n}', { message: 'Unexpected token', line: 3, column: 6 }],
        ['typescript', 'let x: number = ;', { message: 'Expression expected', line: 1, column: 17, endLine: null }],
        ['css', 'a { color red }', { message: 'Unknown word color', line: 1, column: 5 }],
        ['scss', '.a {\n  $x: 1\n  .b { color: red }\n', { message: 'Unclosed block', line: 1, column: 1 }],
        ['less', '.a {\n  .mixin(;\n}', { message: 'Unclosed bracket', line: 2, column: 9 }],
        ['html', '<div>\n</span>\n</div>', {
            message: 'Unexpected closing tag "span". It may happen when the tag has already been closed by another tag',
            line: 2, column: 1, endLine: 2, endColumn: 8,
        }],
        ['yaml', 'a: 1\nb:\n  - x\n  y: 2\n', { message: 'All mapping items must start at the same column', line: 4, column: 1, endLine: 4, endColumn: 2 }],
        ['graphql', 'query Q { a(b: ) }', { message: 'Unexpected ")"', line: 1, column: 16 }],
    ]
    for (const [language, input, expected] of cases) {
        it(PRETTIER_LANGUAGES[language].label, async () => {
            const result = await formatCode(input, language)
            expect(result.output).toBeUndefined()
            expect(result.error).toMatchObject({ kind: 'syntax', ...expected })
        })
    }
})

describe('describePrettierError', () => {
    it('cleans up the message and reads the location', () => {
        const error = Object.assign(new SyntaxError('CssSyntaxError: Unclosed string (2:7)\n> 2 | a { b: "c }'), {
            loc: { start: { line: 2, column: 7 } },
        })
        expect(describePrettierError(error)).toEqual({ kind: 'syntax', message: 'Unclosed string', line: 2, column: 7, endLine: null, endColumn: null })
    })

    it('falls back to the (line:column) suffix and ignores a bogus end', () => {
        const error = Object.assign(new Error('Syntax Error: Expected Name, found <EOF>. (5:1)'), {
            loc: { start: { line: 0 }, end: { line: 1, column: 1 } },
        })
        expect(describePrettierError(error)).toEqual({ kind: 'syntax', message: 'Expected Name, found <EOF>', line: 5, column: 1, endLine: null, endColumn: null })
    })

    it('copes with errors without a location', () => {
        expect(describePrettierError(new Error('Something broke'))).toEqual({
            kind: 'syntax', message: 'Something broke', line: null, column: null, endLine: null, endColumn: null,
        })
        expect(describePrettierError(undefined).message).toBe('The code could not be parsed')
    })
})

describe('readPrettierOptions', () => {
    it('returns Prettier’s defaults for missing or invalid storage', () => {
        expect(readPrettierOptions(undefined)).toEqual(PRETTIER_DEFAULTS)
        expect(readPrettierOptions('garbage')).toEqual(PRETTIER_DEFAULTS)
        // The preferences stored before Prettier was added
        expect(readPrettierOptions({ indent: '4', dialect: 'mysql', keywordCase: 'lower', live: false })).toEqual(PRETTIER_DEFAULTS)
    })

    it('keeps valid values and replaces invalid ones', () => {
        const options = readPrettierOptions({
            printWidth: 120, semi: false, singleQuote: 'yes', trailingComma: 'es5', quoteProps: 'sometimes',
            proseWrap: 'always', embeddedLanguageFormatting: 'off', arrowParens: null, bracketSpacing: 0,
        })
        expect(options).toEqual({
            ...PRETTIER_DEFAULTS,
            printWidth: 120, semi: false, trailingComma: 'es5', proseWrap: 'always', embeddedLanguageFormatting: 'off',
        })
        expect(readPrettierOptions({ printWidth: 90 }).printWidth).toBe(80)
        expect(readPrettierOptions({ printWidth: '120' }).printWidth).toBe(80)
    })

    it('only offers options Prettier knows, for every language', () => {
        for (const keys of Object.values(LANGUAGE_OPTIONS)) {
            for (const key of keys) expect(Object.hasOwn(PRETTIER_OPTIONS, key)).toBe(true)
        }
    })
})

describe('pluginsFor', () => {
    it('loads only what a language needs', () => {
        expect(pluginsFor('javascript')).toEqual(['babel', 'estree'])
        expect(pluginsFor('typescript')).toEqual(['typescript', 'estree'])
        expect(pluginsFor('less')).toEqual(['postcss'])
        expect(pluginsFor('graphql')).toEqual(['graphql'])
        expect(pluginsFor('html')).toEqual(['html', 'postcss', 'babel', 'estree'])
        expect(pluginsFor('html', '', false)).toEqual(['html'])
    })

    it('adds Markdown’s embedded languages only when the document has them', () => {
        expect(pluginsFor('markdown', '# Title\n\nText with `inline` code.\n')).toEqual(['markdown'])
        expect(pluginsFor('markdown', '---\na: 1\n---\n\n~~~ yml\nb: 2\n~~~\n')).toEqual(['markdown', 'yaml'])
        const doc = '- item\n\n  ```tsx\n  x\n  ```\n\n> ```css\n> a{}\n> ```\n\n````JS\nshouty\n````\n'
        expect(pluginsFor('markdown', doc).sort()).toEqual(['estree', 'markdown', 'postcss', 'typescript'])
        expect(pluginsFor('markdown', '```constructor\n```\n```sh\n```\n')).toEqual(['markdown'])
        expect(pluginsFor('markdown', '```js\n```\n', false)).toEqual(['markdown'])
    })

    it('knows which languages are Prettier’s', () => {
        expect(isPrettierLanguage('markdown')).toBe(true)
        expect(isPrettierLanguage('json')).toBe(false)
        expect(isPrettierLanguage('toString')).toBe(false)
    })
})

describe('minifyCss', () => {
    const cases = [
        ['a { color: red ; }', 'a{color:red}'],
        ['/* a */ a { /* b */ color: red; /* c */ }', 'a{color:red}'],
        ['/*! license */\na { }\n/*! two */ b{c:d}', '/*! license */a{}/*! two */b{c:d}'],
        ['a::after { content: " a  ;  b " ; quotes: \'"\' "\'" }', 'a::after{content:" a  ;  b ";quotes:\'"\' "\'"}'],
        ['a { background: url( data:image/png;base64,AA== ) no-repeat , URL( "x y.png" ) }', 'a{background:url(data:image/png;base64,AA==) no-repeat,URL("x y.png")}'],
        ['a { width: calc( 100% - 2 * 8px ); margin: -1px -2px }', 'a{width:calc(100% - 2 * 8px);margin:-1px -2px}'],
        ['@media screen and ( max-width: 600px ) { a { color: red } }', '@media screen and (max-width:600px){a{color:red}}'],
        ['ul > li + li ~ p , a:hover , a :focus { }', 'ul>li + li~p,a:hover,a :focus{}'],
        [':root { --x :  a  b ,  c ; --empty: ; --obj: { a: b } }', ':root{--x:a b , c;--empty: ;--obj:{ a: b }}'],
        ['a { color: red ! important; }', 'a{color:red!important}'],
        [String.raw`.a\: .b { } .\31 0 { } .sm\:flex { }`, String.raw`.a\: .b{}.\31 0{}.sm\:flex{}`],
        ['@charset "UTF-8";\n@import url(foo.css) screen , print;', '@charset "UTF-8";@import url(foo.css) screen,print;'],
        ['a/**/b { color: red/**/; } and/**/(x) { }', 'a/**/b{color:red}and/**/(x){}'],
        [String.raw`a { content: x\; }`, String.raw`a{content:x\;}`],
        ['.a { color: red; &:hover { color: blue } .b & { } > .c { } }', '.a{color:red;&:hover{color:blue}.b &{}>.c{}}'],
        ['a { font: 12px / 1.5 serif; aspect-ratio: 16 / 9; color: rgb(0 0 0 / 50%) }', 'a{font:12px/1.5 serif;aspect-ratio:16/9;color:rgb(0 0 0/50%)}'],
        ['a{;;color:red;;}', 'a{color:red}'],
        ['a { b: c /*! keep */ ; d: e }', 'a{b:c/*! keep */;d:e}'],
        ['a { grid-template-areas: "a b" "c d"; }', 'a{grid-template-areas:"a b" "c d"}'],
        ['\n\n  a  {  }  \n\n', 'a{}'],
    ]
    for (const [input, output] of cases) {
        it(JSON.stringify(input), () => {
            expect(minifyCss(input)).toBe(output)
        })
    }
})

describe('when a module can’t be downloaded', () => {
    it('reports it, and retries on the next call', async () => {
        vi.resetModules()
        vi.doMock('prettier/plugins/graphql', () => {
            throw new Error('Failed to fetch dynamically imported module')
        })
        const offline = await import('./prettierFormat.js')
        expect(await offline.formatCode('{a}', 'graphql')).toEqual({
            error: { kind: 'load', message: 'Couldn’t download the GraphQL formatter. Check your connection and try again.' },
        })
        expect(offline.isFormatterLoaded('graphql')).toBe(false)

        vi.doUnmock('prettier/plugins/graphql')
        expect(await offline.formatCode('{a}', 'graphql')).toEqual({ output: '{\n  a\n}\n' })
        expect(offline.isFormatterLoaded('graphql')).toBe(true)
    })
})
