import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

/**
 * End-to-end journeys (G4-18) in a real browser against the app running with the payment
 * simulator (PAYMENT_PROVIDER=simulator): no Stripe account or network access needed.
 *
 *   npm run stack:up && npm run db:setup && npm run seed:users   (once)
 *   npm run test:e2e
 *
 * The web server is started unless one is already running on E2E_BASE_URL: a production build
 * (`build:sim` + `start:sim`), because the dev server compiles routes on demand, which on a slow
 * machine stalls requests long enough to fail database connects. E2E_DEV=1 uses `dev:sim`
 * instead. global-setup starts a worker (outbox, webhooks, capture). Browser: Playwright's Chromium when
 * installed (CI: `npx playwright install chromium`), else set PW_CHANNEL=chrome|msedge to use an
 * installed browser.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
for (const file of ['stack.env', 'simulator.env'])
  if (fs.existsSync(path.join(here, file)))
    Object.assign(process.env, dotenv.parse(fs.readFileSync(path.join(here, file))))

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  // The dev server compiles pages on first use; the order flow also waits on the worker.
  timeout: 5 * 60_000,
  expect: { timeout: 60_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One store, one slot calendar: run the journeys one after the other.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 120_000,
    actionTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: {
    command: process.env.E2E_DEV ? 'npm run dev:sim' : 'npm run build:sim && npm run start:sim',
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 30 * 60_000,
  },
})
