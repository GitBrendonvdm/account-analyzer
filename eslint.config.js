import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Tests and their helpers run under Node, not the browser.
    files: ['**/*.test.{js,jsx}', 'src/test/**/*.js', 'scripts/**/*.mjs', 'vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // The server is plain Node ESM: no JSX, no React, no browser globals.
    files: ['server/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
])
