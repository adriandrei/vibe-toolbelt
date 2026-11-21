import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output and test artefacts
  globalIgnores(['dist', 'dev-dist', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      // __FFMPEG_CORE_VERSION__ is injected by `define` in vite.config.js
      globals: { ...globals.browser, __FFMPEG_CORE_VERSION__: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]', caughtErrors: 'none' }],
      // Context modules export their provider together with its hook/constants
      'react-refresh/only-export-components': ['warn', {
        allowConstantExport: true,
        allowExportNames: ['useTheme', 'useToast', 'useAI', 'usePipeline', 'COLOR_PRESETS'],
      }],
    },
  },
  {
    // Node-side files: configs, tests and scripts
    files: ['*.config.js', 'tests/**/*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
])
