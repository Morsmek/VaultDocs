import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // These effects subscribe to IndexedDB/Yjs and must reflect their initial
      // external value in component state.
      'react-hooks/set-state-in-effect': 'off',
      // The document lifecycle handlers are intentionally declared below the
      // loading effect so they can share the component's stateful resources.
      'react-hooks/immutability': 'off',
    },
  },
])
