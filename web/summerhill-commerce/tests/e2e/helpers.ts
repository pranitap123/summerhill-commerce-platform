import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

import { hotp } from '../../src/modules/identity/totp'

/** Shared steps of the end-to-end journeys (G4-18). */
export type Item = [string, { quantity?: number; weightLb?: number }]

/** A guest fills a cart (through the API: product pages aren't under test here). */
export async function fillCart(page: Page, items: Item[]): Promise<void> {
  await page.goto('/')
  for (const [productId, amount] of items) {
    const res = await page.request.post('/api/v1/cart/items', { data: { productId, ...amount } })
    expect(res.status(), await res.text()).toBe(201)
  }
}

/** Cart → pickup slot → email → the payment page. */
export async function checkout(page: Page, email: string): Promise<void> {
  await page.goto('/cart')
  await page.getByRole('radio').first().check()
  await page.getByLabel('Email for your receipt').fill(email)
  await page.getByRole('button', { name: /Pay securely/ }).click()
  await page.waitForURL(/\/simulator\/checkout\/cs_sim_/)
}

export async function payWith(page: Page, card: string): Promise<void> {
  await page.getByPlaceholder('4242 4242 4242 4242').fill(card)
  await page.getByRole('button', { name: /Authorise/ }).click()
}

/** After a successful payment: the order page, once the worker has placed the order. */
export async function placedOrder(page: Page): Promise<{ publicId: string; code: string }> {
  await page.waitForURL(/\/orders\/SH-[0-9A-Z]{6}/)
  // The first order of a run waits on a cold worker and webhook route: over a minute on a 2-core
  // CI runner (later ones take seconds), so allow more than the default expect timeout.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order placed', {
    timeout: 4 * 60_000,
  })
  const publicId = page.url().match(/SH-[0-9A-Z]{6}/)![0]
  const code = (await page.locator('strong.font-mono').textContent())!.trim()
  expect(code).toMatch(/^\d{6}$/)
  return { publicId, code }
}

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>
const signedIn = new Map<string, StorageState>()

/**
 * A staff member's browser (npm run seed:users): password sign-in, then the second factor (G5-12)
 * with a code computed from DEMO_TOTP_SECRET. The session is kept for the rest of the run, like a
 * real shift, so codes aren't replayed and the per-user MFA rate limit isn't hit.
 */
export async function staffPage(
  browser: Browser,
  baseURL: string,
  who: 'PICKER' | 'SUPPORT' | 'FINANCE' | 'ADMIN' = 'PICKER',
): Promise<Page> {
  const email = process.env[`DEMO_${who}_EMAIL`]
  const password = process.env.DEMO_USER_PASSWORD
  const secret = process.env.DEMO_TOTP_SECRET
  if (!email || !password || !secret)
    throw new Error(`DEMO_${who}_EMAIL / DEMO_USER_PASSWORD / DEMO_TOTP_SECRET not set (stack.env)`)
  const cached = signedIn.get(email)
  if (cached) return (await browser.newContext({ baseURL, storageState: cached })).newPage()
  const context = await browser.newContext({ baseURL })
  // Sign in from inside the page, like the login form: Payload only accepts the session cookie on
  // requests a browser marks same-origin (G6-01), which Playwright's request API doesn't do.
  const page = await context.newPage()
  await page.goto('/login')
  const post = (url: string, data: Record<string, string>) =>
    page.evaluate(
      async ([u, d]) =>
        (
          await fetch(u, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(d),
          })
        ).ok,
      [url, data] as const,
    )
  expect(
    await post('/api/users/login', { email, password }),
    `demo ${who.toLowerCase()} can sign in (run \`npm run seed:users\`)`,
  ).toBe(true)
  // The current code, or the next one if this step was already used (codes can't be replayed).
  const step = Math.floor(Date.now() / 30_000)
  let verified = false
  for (const s of [step, step + 1]) {
    if (await post('/api/v1/me/mfa/verify', { code: hotp(secret, s) })) {
      verified = true
      break
    }
  }
  expect(verified, `second factor for ${email}`).toBe(true)
  signedIn.set(email, await context.storageState())
  return page
}

/** The console card of one line on the pick screen. */
export const lineCard = (page: Page, name: string) => page.getByRole('article', { name })

/** Our visible alerts (Next.js adds an empty route announcer with role="alert" to every page). */
export const alertOf = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)')
