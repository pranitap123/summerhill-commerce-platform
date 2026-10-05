import fs from 'node:fs'

import { expect, test, type Browser, type Page } from '@playwright/test'

import { alertOf, checkout, fillCart, lineCard, payWith, placedOrder, staffPage } from './helpers'

/**
 * G5-19: the back-office journeys in a real browser, with the payment simulator standing in for
 * Stripe (TESTING journeys 7–8): a support agent refunds a line, an admin onboards a merchant
 * through (simulated) Stripe-hosted onboarding, and finance answers a test-mode dispute. Staff
 * sign in with a password and the second factor (G5-12).
 */
const email = () => `e2e-bo-${Date.now()}@example.com`

/** The store accepts, picks every line and completes; the worker captures (G4). */
async function pickAndCapture(
  browser: Browser,
  baseURL: string,
  publicId: string,
  items: string[],
) {
  const store = await staffPage(browser, baseURL)
  await store.goto(`/console/orders/${publicId}`)
  await store.getByRole('button', { name: 'Accept order' }).click()
  await store.getByRole('button', { name: 'Start picking' }).click()
  for (const name of items) {
    const card = lineCard(store, name)
    await card.getByRole('button', { name: '✓ Picked' }).click()
    await expect(card).toContainText('Picked')
  }
  await store.getByRole('button', { name: 'Complete picking' }).click()
  await expect(store.getByRole('heading', { name: 'Hand over' })).toBeVisible({ timeout: 120_000 })
  return store
}

async function customerOrder(page: Page, card = '4242 4242 4242 4242') {
  await fillCart(page, [['DEMO-0002', { quantity: 2 }]]) // Harbour Kitchen Honeycrisp Apples
  await checkout(page, email())
  await payWith(page, card)
  return placedOrder(page)
}

test('support refunds a damaged line within their limit; the customer sees it', async ({
  page,
  browser,
  baseURL,
}) => {
  const { publicId } = await customerOrder(page)
  await pickAndCapture(browser, baseURL!, publicId, ['Harbour Kitchen Honeycrisp Apples'])

  const agent = await staffPage(browser, baseURL!, 'SUPPORT')
  await agent.goto('/ops')
  const menu = agent.getByRole('navigation', { name: 'Operations' })
  await expect(menu.getByRole('link', { name: 'Orders' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Payouts' })).toHaveCount(0) // not for support
  await agent.goto(`/ops/orders?q=${publicId}`)
  await agent.getByRole('link', { name: publicId }).click()
  await expect(agent.getByRole('heading', { level: 1 })).toContainText(publicId)

  const refund = agent.locator('section', { has: agent.getByRole('heading', { name: 'Refund' }) })
  await refund.getByLabel('Case (liability matrix)').selectOption('damaged')
  await refund.getByLabel(/Harbour Kitchen Honeycrisp Apples/).check()
  await refund.getByLabel('Quantity of Harbour Kitchen Honeycrisp Apples').fill('1')
  await refund
    .getByLabel('Reason (kept in the audit log)')
    .fill('Bruised bag, photo sent by the customer')
  await refund.getByRole('button', { name: 'Refund' }).click()
  await expect(refund.getByRole('status')).toContainText('Refund of $9.39: succeeded')
  await expect(agent.getByText(/Refund #\d+ \(damaged\)/)).toBeVisible()

  await page.reload()
  await expect(page.getByText('Refunded $9.39')).toBeVisible()
})

test('admin onboards a merchant with Stripe-hosted onboarding (simulated); go-live stays gated', async ({
  browser,
  baseURL,
}) => {
  const admin = await staffPage(browser, baseURL!, 'ADMIN')
  const slug = `e2e-market-${Date.now()}`
  await admin.goto('/ops/merchants')
  const form = admin.locator('form', {
    has: admin.getByRole('button', { name: 'Create draft merchant' }),
  })
  await form.getByLabel('Name').fill(`E2E Market ${slug.slice(-6)}`)
  await form.getByLabel('Slug').fill(slug)
  await form.getByRole('button', { name: 'Create draft merchant' }).click()
  await admin.waitForURL(/\/ops\/merchants\/\d+$/)
  await expect(admin.getByRole('heading', { level: 1 })).toContainText('draft')

  await admin.getByRole('button', { name: 'Start onboarding' }).click()
  await admin.waitForURL(/\/simulator\/onboarding\/acct_sim_/)
  await admin.getByRole('button', { name: 'Agree and submit (test)' }).click()
  await admin.waitForURL(/onboarding=done/)
  // account.updated goes through the webhook store and the worker
  await expect(async () => {
    await admin.reload()
    await expect(admin.getByText('verified', { exact: true })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })

  await admin.getByRole('button', { name: 'Go live' }).click()
  await expect(alertOf(admin)).toContainText('No published catalogue')
})

test('finance answers a test-mode dispute with the evidence pack', async ({
  page,
  browser,
  baseURL,
}) => {
  const { publicId, code } = await customerOrder(page, '4000 0000 0000 0259') // disputed once captured
  const store = await pickAndCapture(browser, baseURL!, publicId, [
    'Harbour Kitchen Honeycrisp Apples',
  ])
  await store.getByLabel('Pickup code from the customer').fill(code)
  await store.getByRole('button', { name: 'Hand over' }).click()
  await expect(store.getByText('Picked up', { exact: true }).first()).toBeVisible()

  const finance = await staffPage(browser, baseURL!, 'FINANCE')
  await expect(async () => {
    await finance.goto('/ops/disputes')
    await expect(finance.getByRole('row', { name: new RegExp(publicId) })).toBeVisible({
      timeout: 2_000,
    })
  }).toPass({ timeout: 60_000 })
  await finance
    .getByRole('row', { name: new RegExp(publicId) })
    .getByRole('link')
    .first()
    .click()
  await expect(finance.getByRole('heading', { level: 1 })).toContainText('needs response')

  await finance.getByRole('button', { name: 'Rebuild evidence pack' }).click()
  await expect(finance.getByText('Evidence pack rebuilt')).toBeVisible()
  const handover = finance
    .locator('div', { has: finance.getByRole('heading', { name: 'Handover' }) })
    .first()
  await expect(handover).toContainText('Pickup code verified')
  await expect(handover).toContainText('Yes')

  finance.once('dialog', (d) => d.accept())
  await finance.getByRole('button', { name: 'Submit evidence to Stripe' }).click()
  await expect(finance.getByRole('heading', { level: 1 })).toContainText('under review')
})

test('finance downloads the monthly close export as a file (not a page navigation)', async ({
  browser,
  baseURL,
}) => {
  const finance = await staffPage(browser, baseURL!, 'FINANCE')
  await finance.goto('/ops/reconciliation')
  const link = finance.getByRole('link', { name: /^\d{4}-\d{2}$/ })
  const month = (await link.textContent())!.trim()
  const [download] = await Promise.all([finance.waitForEvent('download'), link.click()])
  expect(download.suggestedFilename()).toBe(`ledger-${month}.csv`)
  const csv = fs.readFileSync((await download.path())!, 'utf8')
  expect(csv.split('\r\n')[0]).toBe(
    'date,journal,event,order,account,debit,credit,stripe_reference',
  )
  await expect(finance).toHaveURL(/\/ops\/reconciliation$/) // stayed on the page
})
