import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

import { hotp } from '../../src/modules/identity/totp'

export type Item = [string, { quantity?: number; weightLb?: number }]

export async function fillCart(page: Page, items: Item[]): Promise<void> {
  await page.goto('/')
  for (const [productId, amount] of items) {
    const res = await page.request.post('/api/v1/cart/items', { data: { productId, ...amount } })
    expect(res.status(), await res.text()).toBe(201)
  }
}

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

export async function placedOrder(page: Page): Promise<{ publicId: string; code: string }> {
  await page.waitForURL(/\/orders\/SH-[0-9A-Z]{6}/)

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

export const lineCard = (page: Page, name: string) => page.getByRole('article', { name })

export const alertOf = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)')
