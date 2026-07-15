import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .claude holds agent worktrees (full stale copies of the repo) — linting
  // them double-reports every finding against code that isn't ours to fix here.
  globalIgnores(['dist', '.claude']),
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['server/**', 'vite.config.js', 'public/firebase-messaging-sw.js'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Server code and the Vite/Node config run under Node, not the browser —
    // without this, every `process.env` reference was a false-positive
    // no-undef error (the code is correct; only the linter's globals were wrong).
    files: ['server/**/*.js', 'vite.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
  {
    // The Firebase messaging service worker runs in the SW global scope
    // (importScripts, firebase, clients), not a regular browser window.
    files: ['public/firebase-messaging-sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.serviceworker,
      sourceType: 'script',
    },
  },
])
