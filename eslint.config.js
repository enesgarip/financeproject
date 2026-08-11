import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // supabase/.temp: CLI'nin runtime artefaktları (start-secrets altında edge
  // runtime kopyası dahil) — proje kodu değil, lint'e girmemeli.
  globalIgnores(['dist', 'test-results', 'playwright-report', 'coverage', '.lighthouseci', 'supabase/.temp']),
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
  },
  {
    // UI ve saf util/hook katmanları supabase'e doğrudan dokunamaz; tüm veri
    // erişimi src/data (ve src/services RPC sarmalayıcıları) üzerinden gider.
    files: ['src/{pages,components,utils,hooks}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['../lib/supabase', '../../lib/supabase', '**/lib/supabase'],
        },
      ],
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
