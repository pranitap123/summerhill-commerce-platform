import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { fillCart, payWith, placedOrder, staffPage } from './helpers'

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function expectAccessible(page: Page, label: string) {
  await page.waitForLoadState('networkidle')
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }))
  expect(serious, `${label}: serious accessibility violations`).toEqual([])
}

async function tabTo(page: Page, target: Locator, max = 80) {
  const handle = await target.elementHandle()
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate((el) => document.activeElement === el, handle)) return
  }
  throw new Error(`could not reach ${target} with the Tab key`)
}

async function expectVisibleFocus(page: Page) {
  const style = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!)
    return { outline: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow }
  })
  expect(
    (style.outline !== 'none' && style.width !== '0px') || style.shadow !== 'none',
    `visible focus indicator (${JSON.stringify(style)})`,
  ).toBe(true)
}

test.describe('storefront', () => {
  test('browse, search and account pages', async ({ page }) => {
    for (const [path, label] of [
      ['/', 'home'],
      ['/shop', 'shop'],
      ['/shop/produce', 'category'],
      ['/shop?q=apples', 'search results'],
      ['/specials', 'specials'],
      ['/stores', 'stores'],
      ['/login', 'sign in'],
      ['/create-account', 'create account'],
      ['/find-order', 'find an order'],
    ]) {
      await page.goto(path)
      await expectAccessible(page, label)
    }
    await page.goto('/shop/produce')
    await page
      .getByRole('link', { name: /Harbour Kitchen Honeycrisp Apples/ })
      .first()
      .click()
    await page.waitForURL(/\/products\//)
    await expectAccessible(page, 'product page')
  })

  test('checkout with the keyboard only, and the cart, payment and order pages', async ({
    page,
  }) => {
    await fillCart(page, [
      ['DEMO-0002', { quantity: 2 }],
      ['DEMO-0001', { quantity: 2 }],
    ])
    await page.goto('/cart')
    await expectAccessible(page, 'cart')

    const slot = page.getByRole('radio').first()
    await tabTo(page, slot)
    await expectVisibleFocus(page)
    await page.keyboard.press('Space')
    await expect(slot).toBeChecked()

    const email = page.getByLabel('Email for your receipt')
    await tabTo(page, email)
    await page.keyboard.type(`a11y-${Date.now()}@example.com`)

    const pay = page.getByRole('button', { name: /Pay securely/ })
    await tabTo(page, pay)
    await expectVisibleFocus(page)
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/simulator\/checkout\/cs_sim_/)
    await expectAccessible(page, 'payment page')

    const card = page.getByPlaceholder('4242 4242 4242 4242')
    await tabTo(page, card)
    await page.keyboard.type('4242 4242 4242 4242')
    await tabTo(page, page.getByRole('button', { name: /Authorise/ }))
    await page.keyboard.press('Enter')
    await placedOrder(page)
    await expectAccessible(page, 'order page')
  })

  test('a declined card is announced', async ({ page }) => {
    await fillCart(page, [['DEMO-0002', { quantity: 3 }]])
    await page.goto('/cart')
    await page.getByRole('radio').first().check()
    await page.getByLabel('Email for your receipt').fill(`a11y-decline-${Date.now()}@example.com`)
    await page.getByRole('button', { name: /Pay securely/ }).click()
    await page.waitForURL(/\/simulator\/checkout\/cs_sim_/)
    await payWith(page, '4000 0000 0000 0002')
    await expect(page.getByRole('alert').filter({ hasText: 'declined' })).toBeVisible()
    await expectAccessible(page, 'payment page with an error')
  })
})

test.describe('staff', () => {
  test('merchant console: order list and pick screen', async ({ page, browser, baseURL }) => {
    await fillCart(page, [['DEMO-0002', { quantity: 2 }]])
    await page.goto('/cart')
    await page.getByRole('radio').first().check()
    await page.getByLabel('Email for your receipt').fill(`a11y-console-${Date.now()}@example.com`)
    await page.getByRole('button', { name: /Pay securely/ }).click()
    await page.waitForURL(/\/simulator\/checkout\/cs_sim_/)
    await payWith(page, '4242 4242 4242 4242')
    const { publicId } = await placedOrder(page)

    const store = await staffPage(browser, baseURL!)
    await store.goto('/console')
    await expectAccessible(store, 'console home')
    await store.goto(`/console/orders/${publicId}`)
    await store.getByRole('button', { name: 'Accept order' }).click()
    await store.getByRole('button', { name: 'Start picking' }).click()
    await expect(store.getByPlaceholder('Scan or type a barcode')).toBeVisible()
    await expectAccessible(store, 'pick screen')
  })

  test('operations console', async ({ browser, baseURL }) => {
    const ops = await staffPage(browser, baseURL!, 'ADMIN')
    for (const [path, label] of [
      ['/ops', 'ops dashboard'],
      ['/ops/orders', 'ops orders'],
      ['/ops/merchants', 'ops merchants'],
      ['/ops/reconciliation', 'ops reconciliation'],
      ['/ops/users', 'ops users'],
    ]) {
      await ops.goto(path)
      await expectAccessible(ops, label)
    }
  })
})
