import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // supabase/.temp: CLI'nin runtime artefaktları (start-secrets altında edge
  // runtime kopyası dahil) — proje kodu değil, lint'e girmemeli.
  // .claude: paralel oturumların git worktree'leri (.claude/worktrees/*) repo
  // kökünün altında yaşar; kök lint'i onları tarayınca her dosya
  // "multiple candidate TSConfigRootDirs" ile patlıyordu. Her worktree kendi
  // lint'ini kendi içinde koşar.
  globalIgnores(['dist', 'test-results', 'playwright-report', 'coverage', '.lighthouseci', 'supabase/.temp', '.claude']),
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
      parserOptions: {
        // Kök AÇIKÇA sabit: paralel oturumların .claude/worktrees/* kopyaları
        // repo altında ikinci bir tsconfig kökü oluşturur; typescript-eslint
        // kökü tahmin etmeye kalkınca her dosya parse hatasıyla düşüyordu.
        tsconfigRootDir: import.meta.dirname,
      },
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
