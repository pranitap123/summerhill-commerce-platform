import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
for (const file of ['stack.env', 'simulator.env'])
  if (fs.existsSync(path.join(here, file)))
    Object.assign(process.env, dotenv.parse(fs.readFileSync(path.join(here, file))))

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',

  timeout: 5 * 60_000,
  expect: { timeout: 60_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

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
