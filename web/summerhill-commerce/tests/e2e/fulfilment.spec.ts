import { expect, test } from '@playwright/test'

import { encodeScaleLabel } from '../../src/modules/fulfilment/barcode'

import { alertOf, checkout, fillCart, lineCard, payWith, placedOrder, staffPage } from './helpers'

/**
 * G4-18: the fulfilment journeys in a real browser, customer and store side, with the payment
 * simulator standing in for Stripe Checkout (Stripe's test card numbers, including 3-D Secure).
 */
const email = () => `e2e-${Date.now()}@example.com`

test('order → accept → scan, weigh → replace → capture → handover', async ({
  page,
  browser,
  baseURL,
}) => {
  // ---- customer: cart, pickup slot, payment
  await fillCart(page, [
    ['DEMO-0002', { quantity: 2 }], // Harbour Kitchen Honeycrisp Apples, each
    ['DEMO-0157', { quantity: 3 }], // sparkling water, HST + deposit
    ['DEMO-0006', { weightLb: 1.5 }], // bananas by weight: deli label
    ['DEMO-0001', { quantity: 2 }], // apples by count, to be replaced
    ['DEMO-0010', { quantity: 1 }], // grapes, out of stock
  ])
  await checkout(page, email())
  await payWith(page, '4242 4242 4242 4242')
  const { publicId, code } = await placedOrder(page)
  await expect(page.getByRole('heading', { name: 'Pickup' })).toBeVisible()

  // ---- store: accept and pick
  const store = await staffPage(browser, baseURL!)
  await store.goto(`/console/orders/${publicId}`)
  await store.getByRole('button', { name: 'Accept order' }).click()
  await expect(store.getByText('Accepted by the store', { exact: true })).toBeVisible()
  await store.getByRole('button', { name: 'Start picking' }).click()
  const scan = store.getByPlaceholder('Scan or type a barcode')

  await scan.fill('420260000501') // Juniper Lane Bananas: not in this order
  await scan.press('Enter')
  await expect(alertOf(store)).toContainText('Wrong item?')

  await scan.fill('420260000204') // the Harbour Kitchen apples' barcode
  await scan.press('Enter')
  await expect(lineCard(store, 'Harbour Kitchen Honeycrisp Apples')).toContainText('Picked 2')

  const water = lineCard(store, 'Cedar & Salt Sparkling Water 500 ml')
  await water.getByRole('button', { name: '✓ Picked' }).click()
  await expect(water).toContainText('Picked 3')

  await scan.fill(encodeScaleLabel('200006000008', 650)) // deli label, $6.50 embedded
  await scan.press('Enter')
  await expect(lineCard(store, 'Maple Row Bananas')).toContainText('label $6.50')

  const grapes = lineCard(store, 'Maple Row Seedless Green Grapes')
  await grapes.getByRole('combobox', { name: 'Mark unavailable' }).selectOption('out_of_stock')
  await expect(grapes).toContainText('Unavailable')
  await expect(store.getByText(/from the store until the next opening/)).toBeVisible()
  await store.getByRole('button', { name: 'No', exact: true }).click()

  // ---- replacement (best match), confirmed by the customer
  const apples = lineCard(store, 'Lakeside Farms Honeycrisp Apples')
  await apples.getByRole('button', { name: '⇄ Replace' }).click()
  const panel = store.getByRole('group', { name: 'Replace Lakeside Farms Honeycrisp Apples' })
  await panel.getByRole('radio').first().check()
  const weight = panel.getByLabel(/Weight/)
  if (await weight.count()) await weight.fill('3.1')
  await panel.getByRole('button', { name: 'Use this replacement' }).click()
  await expect(apples).toContainText('Replaced with')

  await page.reload()
  await expect(page.getByText('Instead of Lakeside Farms Honeycrisp Apples')).toBeVisible()
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByText('Accepted.')).toBeVisible()

  // ---- complete: the worker captures the final amount, the order becomes ready
  await store.getByRole('button', { name: 'Complete picking' }).click()
  await expect(store.getByRole('heading', { name: 'Hand over' })).toBeVisible({ timeout: 120_000 })
  await expect(store.getByText('Charged').first()).toBeVisible()

  // ---- handover: a wrong code is refused, the customer's code hands over
  const wrong = code === '000000' ? '111111' : '000000'
  await store.getByLabel('Pickup code from the customer').fill(wrong)
  await store.getByRole('button', { name: 'Hand over' }).click()
  await expect(alertOf(store)).toContainText('Wrong code. 4 attempt(s) left.')
  await store.getByLabel('Pickup code from the customer').fill(code)
  await store.getByRole('button', { name: 'Hand over' }).click()
  await expect(store.getByText('Picked up', { exact: true }).first()).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Picked up')
  await expect(page.getByText('Charged', { exact: true })).toBeVisible()
  await expect(page.getByText(/of the hold was released/)).toBeVisible()
})

test('customer cancels before the store accepts: the hold is released', async ({ page }) => {
  await fillCart(page, [['DEMO-0002', { quantity: 2 }]])
  await checkout(page, email())
  await payWith(page, '4242 4242 4242 4242')
  await placedOrder(page)
  await page.getByRole('button', { name: 'Cancel order' }).click()
  await page.getByRole('button', { name: 'Yes, cancel' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cancelled')
  await expect(page.getByText(/nothing was charged/)).toBeVisible()
})

test('a declined card keeps the customer on the payment page; another card works', async ({
  page,
}) => {
  await fillCart(page, [['DEMO-0002', { quantity: 2 }]])
  await checkout(page, email())
  await payWith(page, '4000 0000 0000 0002')
  await expect(alertOf(page)).toHaveText('Your card was declined.')
  await expect(page).toHaveURL(/\/simulator\/checkout\//)
  await payWith(page, '4242 4242 4242 4242')
  await placedOrder(page)
})

test('3-D Secure: a failed challenge declines, a completed one places the order', async ({
  page,
}) => {
  await fillCart(page, [['DEMO-0002', { quantity: 2 }]])
  await checkout(page, email())
  await payWith(page, '4000 0027 6000 3184')
  const challenge = page.getByRole('region', { name: 'Authentication' })
  await expect(challenge).toBeVisible()
  await challenge.getByRole('button', { name: 'Fail authentication' }).click()
  await expect(alertOf(page)).toContainText('unable to authenticate')
  await payWith(page, '4000 0027 6000 3184')
  await challenge.getByRole('button', { name: 'Complete authentication' }).click()
  await placedOrder(page)
})
