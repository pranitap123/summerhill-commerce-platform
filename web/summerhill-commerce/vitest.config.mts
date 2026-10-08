import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const GATED = [
  'src/modules/pricing/money.ts',
  'src/modules/pricing/fees.ts',
  'src/modules/pricing/final.ts',
  'src/modules/pricing/quote.ts',
  'src/modules/pricing/revenueShare.ts',
  'src/modules/payments/ledgerRules.ts',
  'src/modules/payments/refundMath.ts',
  'src/modules/ordering/stateMachine.ts',
]
const full = { lines: 100, branches: 100, functions: 100, statements: 100 }

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup/test-env.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/authz/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],

    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/modules/**', 'src/server/**', 'src/worker/**'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        lines: 75,
        ...Object.fromEntries(GATED.map((file) => [file, full])),
      },
    },
  },
})
