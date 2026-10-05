import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const MODULES_DIR = path.join(dirname, 'src/modules')
const modules = fs.existsSync(MODULES_DIR)
  ? fs.readdirSync(MODULES_DIR).filter((d) => fs.statSync(path.join(MODULES_DIR, d)).isDirectory())
  : []

const deepImportMessage =
  "Import another module only through its public API ('@/modules/<name>'), never its internal files (ADR-0002)."

/**
 * Module boundaries (G1-05, ADR-0002). Outside a module, only `@/modules/<name>` (its index.ts) may
 * be imported. Inside module X, deep imports of other modules and relative imports that climb into
 * a sibling module are errors. One config block per module is generated from the folder list.
 */
const boundaryRules = [
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/modules/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/modules/*/*'], message: deepImportMessage }] },
      ],
    },
  },
  ...modules.map((name) => ({
    files: [`src/modules/${name}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/modules/*/*', `!@/modules/${name}/*`], message: deepImportMessage },
            { group: ['../*/*'], message: deepImportMessage },
          ],
        },
      ],
    },
  })),
]

/**
 * Lint ratchet. These files predate G1 (Payload template + stage-3 UI) and break the React
 * Compiler-era hook rules; they were hidden while the old ESLint config crashed. They're listed
 * explicitly (not disabled globally) so every NEW file still gets these rules as errors. Remove a
 * file from this list when it's rewritten; the list must only shrink.
 *   - Payload template commerce UI → deleted in G2-15 (done)
 *   - storefront UI, theme provider → rewritten in G3-13 (storefront v2, theme mismatch fix)
 */
const LEGACY_HOOK_RULE_FILES = [
  'src/components/Header/MobileMenu.tsx', // G3-13
  'src/components/forms/LoginForm/index.tsx', // G2-20
  'src/components/ui/carousel.tsx', // G3-13
  'src/providers/Theme/ThemeSelector/index.tsx', // G3-13
]
const legacyRatchet = {
  files: LEGACY_HOOK_RULE_FILES,
  rules: {
    'react-hooks/set-state-in-effect': 'warn',
    'react-hooks/preserve-manual-memoization': 'warn',
    'react-hooks/refs': 'warn',
  },
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  legacyRatchet,
  {
    rules: {
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  ...boundaryRules,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'src/payload-types.ts',
    'src/payload-generated-schema.ts',
    'src/app/(payload)/admin/importMap.js',
  ]),
])
