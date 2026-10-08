import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { encodeScaleLabel } from '../../src/modules/fulfilment/barcode'

import { checkout, fillCart, lineCard, payWith, placedOrder, staffPage } from './helpers'

const here = path.dirname(fileURLToPath(import.meta.url))
const MEDIA = path.resolve(here, '../../../../docs/media')
const FRAMES = path.resolve(here, '../../test-results/demo-frames')
const VIEWPORT = { width: 1280, height: 800 }

test.skip(!process.env.DEMO_RECORD, 'recording only: DEMO_RECORD=1')
test.use({ viewport: VIEWPORT })

let frame = 0
async function beat(page: Page, hold = 2) {
  await page.waitForTimeout(400)
  const shot = await page.screenshot()
  for (let i = 0; i < hold; i++)
    fs.writeFileSync(path.join(FRAMES, `frame-${String(frame++).padStart(4, '0')}.png`), shot)
}

async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.screenshot({ path: path.join(MEDIA, `${name}.png`) })
}

async function browse(page: Page) {
  await page.goto('/')
  await shot(page, '01-home')
  await page.goto('/shop?q=honeycrisp')
  await expect(page.getByText('Harbour Kitchen Honeycrisp Apples').first()).toBeVisible()
  await shot(page, '02-search')
  await page.goto('/products/harbour-kitchen-honeycrisp-apples-5cdeeb')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Honeycrisp')
  await shot(page, '03-product')
}

test('demo: browse → hold → pick with a weight and a replacement → capture → refund → reconcile', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(15 * 60_000)
  fs.mkdirSync(MEDIA, { recursive: true })
  fs.rmSync(FRAMES, { recursive: true, force: true })
  fs.mkdirSync(FRAMES, { recursive: true })

  if (!process.env.DEMO_SKIP_BROWSE) await browse(page)

  await fillCart(page, [
    ['DEMO-0002', { quantity: 2 }], // Harbour Kitchen Honeycrisp Apples
    ['DEMO-0006', { weightLb: 1.5 }], // bananas by weight: estimated
    ['DEMO-0157', { quantity: 3 }], // sparkling water: HST + deposit
    ['DEMO-0001', { quantity: 2 }], // Lakeside apples, to be replaced
  ])
  await page.goto('/cart')
  await page.getByRole('radio').first().check()
  await expect(page.getByText(/temporary hold/).first()).toBeVisible()
  await shot(page, '04-cart-hold')
  await checkout(page, `demo-${Date.now()}@example.com`)
  await payWith(page, '4242 4242 4242 4242')
  const { publicId, code } = await placedOrder(page)
  await shot(page, '05-order-placed')

  const signedIn = await staffPage(browser, baseURL!)
  const storeContext = await browser.newContext({
    baseURL,
    viewport: VIEWPORT,
    storageState: await signedIn.context().storageState(),
  })
  await signedIn.context().close()
  const store = await storeContext.newPage()
  await store.goto('/console')
  await expect(store.getByText(publicId).first()).toBeVisible()
  await beat(store)
  await shot(store, '06-console-queue')
  await store.goto(`/console/orders/${publicId}`)
  await beat(store)
  await store.getByRole('button', { name: 'Accept order' }).click()
  await beat(store)
  await store.getByRole('button', { name: 'Start picking' }).click()
  await beat(store)

  const scan = store.getByPlaceholder('Scan or type a barcode')
  await scan.pressSequentially('420260000204', { delay: 60 })
  await scan.press('Enter')
  await expect(lineCard(store, 'Harbour Kitchen Honeycrisp Apples')).toContainText('Picked 2')
  await beat(store)
  const water = lineCard(store, 'Cedar & Salt Sparkling Water 500 ml')
  await water.getByRole('button', { name: '✓ Picked' }).click()
  await expect(water).toContainText('Picked 3')
  await beat(store)
  await scan.pressSequentially(encodeScaleLabel('200006000008', 712), { delay: 60 })
  await scan.press('Enter')
  await expect(lineCard(store, 'Maple Row Bananas')).toContainText('label $7.12')
  await beat(store)

  const apples = lineCard(store, 'Lakeside Farms Honeycrisp Apples')
  await apples.getByRole('button', { name: '⇄ Replace' }).click()
  await beat(store)
  const panel = store.getByRole('group', { name: 'Replace Lakeside Farms Honeycrisp Apples' })
  await panel.getByRole('radio').first().check()
  const weight = panel.getByLabel(/Weight/)
  if (await weight.count()) await weight.fill('3.1')
  await beat(store, 1)
  await panel.getByRole('button', { name: 'Use this replacement' }).click()
  await expect(apples).toContainText('Replaced with')
  await beat(store)
  await shot(store, '07-console-pick')

  await page.reload()
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByText('Accepted.')).toBeVisible()

  await store.getByRole('button', { name: 'Complete picking' }).click()
  await expect(store.getByRole('heading', { name: 'Hand over' })).toBeVisible({ timeout: 120_000 })
  await beat(store, 3)

  await store.getByLabel('Pickup code from the customer').pressSequentially(code, { delay: 80 })
  await store.getByRole('button', { name: 'Hand over' }).click()
  await expect(store.getByText('Picked up', { exact: true }).first()).toBeVisible()
  await beat(store, 4)
  await storeContext.close()

  await page.reload()
  await expect(page.getByText(/of the hold was released/)).toBeVisible()
  await shot(page, '08-order-charged')

  const agent = await staffPage(browser, baseURL!, 'SUPPORT')
  await agent.setViewportSize(VIEWPORT)
  await agent.goto(`/ops/orders/${publicId}`)
  const refund = agent.locator('section', { has: agent.getByRole('heading', { name: 'Refund' }) })
  await refund.getByLabel('Case (liability matrix)').selectOption('damaged')
  await refund.getByLabel(/Harbour Kitchen Honeycrisp Apples/).check()
  await refund.getByLabel('Quantity of Harbour Kitchen Honeycrisp Apples').fill('1')
  await refund.getByLabel('Reason (kept in the audit log)').fill('Bruised, photo from the customer')
  await refund.getByRole('button', { name: 'Refund' }).click()
  await expect(refund.getByRole('status')).toContainText('succeeded')
  await agent.reload()
  await shot(agent, '09-ops-order-refund')

  const finance = await staffPage(browser, baseURL!, 'FINANCE')
  await finance.setViewportSize(VIEWPORT)
  await finance.goto('/ops/reconciliation')
  await finance.getByRole('button', { name: 'Reconcile' }).click()
  await finance.waitForURL(/\/ops\/reconciliation\/\d+$/, { timeout: 120_000 })
  await expect(finance.getByRole('heading', { level: 1 })).toBeVisible()
  await shot(finance, '10-ops-reconciliation')
})
