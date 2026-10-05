import type { Order, OrderLine } from '@/modules/ordering'

/**
 * Versioned email templates (ORDERS §11). The version is logged with every notification, so a
 * support agent can see exactly which wording a customer received.
 */
export interface Rendered {
  template: string
  version: number
  subject: string
  text: string
  html: string
}

const money = (cents: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f2a24;max-width:560px;margin:auto;padding:24px">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}
<p style="color:#6b7280;font-size:12px;margin-top:32px">Grocery Marketplace Demo · test mode, no real money moves. Independent educational project.</p>
</body></html>`
}

/** "Tue, Nov 3, 11:00 a.m. – 12:00 p.m." in the store's time zone. */
export function pickupWindow(
  order: Pick<Order, 'pickupStartsAt' | 'pickupEndsAt'>,
  timeZone = 'America/Toronto',
): string | null {
  if (!order.pickupStartsAt || !order.pickupEndsAt) return null
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(order.pickupStartsAt)
  const time = new Intl.DateTimeFormat('en-CA', { timeZone, hour: 'numeric', minute: '2-digit' })
  return `${day}, ${time.format(order.pickupStartsAt)} – ${time.format(order.pickupEndsAt)}`
}

function lineText(l: OrderLine): string {
  const qty = l.isWeighed
    ? `est. ${((l.estimatedWeightMlb ?? 0) / 1000).toFixed(2)} lb`
    : `× ${l.quantity}`
  return `${l.name} ${qty}: ${money(l.lineTotalCents)}${l.taxCents ? ' (HST)' : ''}`
}

export function orderConfirmation(order: Order, lines: OrderLine[], orderUrl: string): Rendered {
  const holdNote =
    order.weightBufferCents > 0
      ? `Your card has a temporary hold of ${money(order.authorizationCents)}, which includes ${money(order.weightBufferCents)} for weighed items. You'll be charged only the final amount after your order is packed; the rest of the hold is released.`
      : `Your card has a temporary hold of ${money(order.authorizationCents)}. You'll be charged the final amount after your order is packed.`
  const totals = [
    `Items: ${money(order.itemSubtotalCents)}`,
    ...(order.depositCents ? [`Deposits: ${money(order.depositCents)}`] : []),
    `HST: ${money(order.taxCents)}`,
    `Estimated total: ${money(order.estimatedTotalCents)}`,
  ]
  const pickup = pickupWindow(order)
  const pickupLines = [
    ...(pickup ? [`Pickup: ${pickup}`] : []),
    ...(order.pickupCode
      ? [`Your pickup code: ${order.pickupCode} (tell it to the store staff)`]
      : []),
  ]
  const text = [
    `Thanks for your order ${order.publicId}.`,
    ...pickupLines,
    '',
    ...lines.map(lineText),
    '',
    ...totals,
    '',
    holdNote,
    '',
    `Track your order: ${orderUrl}`,
  ].join('\n')
  const html = layout(
    `Order ${order.publicId} placed`,
    `<p>Thanks for your order. The store will confirm it shortly.</p>
${pickupLines.length ? `<p><strong>${pickupLines.map(escapeHtml).join('<br>')}</strong></p>` : ''}
<ul>${lines.map((l) => `<li>${escapeHtml(lineText(l))}</li>`).join('')}</ul>
<p>${totals.map(escapeHtml).join('<br>')}</p>
<p>${escapeHtml(holdNote)}</p>
<p><a href="${escapeHtml(orderUrl)}">View your order</a></p>`,
  )
  return {
    template: 'order_confirmation',
    version: 2,
    subject: `Order ${order.publicId} placed`,
    text,
    html,
  }
}

/** Why an order was cancelled, in the customer's words (ORDERS §5 and §8). */
function cancellationText(reason: string | null): string {
  if (reason === 'customer_cancelled') return 'You cancelled your order.'
  if (reason === 'auto_rejected')
    return "We're sorry: the store couldn't confirm your order in time, so it was cancelled."
  if (reason?.startsWith('merchant_rejected'))
    return "We're sorry: the store couldn't take your order this time."
  return 'Your order was cancelled.'
}

export function orderCancelled(
  order: Order,
  orderUrl: string,
  reason: string | null = null,
): Rendered {
  const why = cancellationText(reason)
  const released = 'The hold on your card has been released and you have not been charged.'
  const text = `${why} (order ${order.publicId})\n\n${released}\n\nDetails: ${orderUrl}`
  return {
    template: 'order_cancelled',
    version: 2,
    subject: `Order ${order.publicId} cancelled`,
    text,
    html: layout(
      `Order ${order.publicId} cancelled`,
      `<p>${escapeHtml(why)}</p><p>${escapeHtml(released)}</p>
<p><a href="${escapeHtml(orderUrl)}">View your order</a></p>`,
    ),
  }
}

export interface ReceiptMerchant {
  name: string
  hstRegistrationNumber: string | null
}

/**
 * Ready for pickup + receipt (G4-17, ORDERS §11): final lines with HST per line, what was
 * released from the hold, the pickup code and time. Names the merchant as the seller (with its
 * HST number) and the platform as the marketplace facilitator. Built from the captured order, so
 * its total is the amount the ledger recorded.
 */
export function orderReady(
  order: Order,
  lines: OrderLine[],
  merchant: ReceiptMerchant,
  orderUrl: string,
): Rendered {
  const byId = new Map(lines.map((l) => [l.id, l]))
  const rows = lines
    .filter((l) => l.status !== 'substituted' && l.status !== 'unavailable')
    .map((l) => {
      const qty =
        l.isWeighed && l.actualWeightMlb !== null
          ? `${(l.actualWeightMlb / 1000).toFixed(3)} lb`
          : `× ${l.pickedQuantity ?? l.quantity}`
      const replaced = l.substitutesLineId ? byId.get(l.substitutesLineId) : undefined
      const tax = l.finalTaxCents ? `, HST ${money(l.finalTaxCents)}` : ''
      const deposit = l.finalDepositCents ? `, deposit ${money(l.finalDepositCents)}` : ''
      const note = replaced ? ` (replaces ${replaced.name})` : ''
      return `${l.name} ${qty}: ${money(l.finalLineTotalCents ?? 0)}${tax}${deposit}${note}`
    })
  const missing = lines
    .filter((l) => l.status === 'unavailable' && l.substitutesLineId === null)
    .map((l) => `${l.name}: unavailable, not charged`)
  const total = order.finalTotalCents ?? 0
  const totals = [
    `Items: ${money(order.finalItemSubtotalCents ?? 0)}`,
    ...(order.finalDepositCents ? [`Deposits: ${money(order.finalDepositCents)}`] : []),
    `HST: ${money(order.finalTaxCents ?? 0)}`,
    `Total charged: ${money(total)}`,
    `Card hold ${money(order.authorizationCents)}; released ${money(order.authorizationCents - total)}`,
  ]
  const pickup = pickupWindow(order)
  const hst = merchant.hstRegistrationNumber ? ` (HST ${merchant.hstRegistrationNumber})` : ''
  const seller = `Sold by ${merchant.name}${hst}. Grocery Marketplace Demo acts as the marketplace facilitator.`
  const intro = [
    `Your order ${order.publicId} is ready for pickup.`,
    ...(pickup ? [`Pickup: ${pickup}`] : []),
    ...(order.pickupCode ? [`Pickup code: ${order.pickupCode}`] : []),
  ]
  const text = [
    ...intro,
    '',
    'Receipt',
    ...rows,
    ...missing,
    '',
    ...totals,
    '',
    seller,
    '',
    `Order: ${orderUrl}`,
  ].join('\n')
  const html = layout(
    `Order ${order.publicId} is ready`,
    `<p>${intro.map(escapeHtml).join('<br>')}</p>
<h2 style="font-size:16px">Receipt</h2>
<ul>${[...rows, ...missing].map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
<p>${totals.map(escapeHtml).join('<br>')}</p>
<p style="font-size:12px">${escapeHtml(seller)}</p>
<p><a href="${escapeHtml(orderUrl)}">View your order</a></p>`,
  )
  return {
    template: 'order_ready',
    version: 1,
    subject: `Order ${order.publicId} is ready for pickup`,
    text,
    html,
  }
}

/** A picker replaced an item (G4-12): the customer can reject it until packing is finished. */
export function orderSubstitution(
  order: Order,
  original: OrderLine,
  substitute: OrderLine,
  orderUrl: string,
): Rendered {
  const text = `We replaced ${original.name} with ${substitute.name} in order ${order.publicId}. You pay no more than the original item's price.\n\nNot happy with it? Reject it before your order is packed: ${orderUrl}`
  return {
    template: 'order_substitution',
    version: 1,
    subject: `Order ${order.publicId}: we replaced an item`,
    text,
    html: layout(
      'We replaced an item',
      `<p>We replaced <strong>${escapeHtml(original.name)}</strong> with <strong>${escapeHtml(substitute.name)}</strong>. You pay no more than the original item's price.</p>
<p><a href="${escapeHtml(orderUrl)}">Approve or reject the replacement</a> (until your order is packed)</p>`,
    ),
  }
}

export function orderLookupLink(publicId: string, orderUrl: string): Rendered {
  return {
    template: 'order_lookup',
    version: 1,
    subject: `Your link to order ${publicId}`,
    text: `Here is your link to order ${publicId}:\n${orderUrl}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: layout(
      `Your order ${publicId}`,
      `<p><a href="${escapeHtml(orderUrl)}">Open your order</a></p><p>If you didn't ask for this, you can ignore this email.</p>`,
    ),
  }
}

/** A refund went through (G5-04). Card refunds take 5–10 business days to appear. */
export function orderRefunded(
  order: Order,
  refund: { amountCents: number; lines: Array<{ name: string }> },
  orderUrl: string,
): Rendered {
  const what = refund.lines.length ? ` for ${refund.lines.map((l) => l.name).join(', ')}` : ''
  const text = `We refunded ${money(refund.amountCents)}${what} on order ${order.publicId}. It goes back to the card you paid with and usually shows within 5–10 business days.\n\n${orderUrl}`
  return {
    template: 'order_refunded',
    version: 1,
    subject: `Refund of ${money(refund.amountCents)} for order ${order.publicId}`,
    text,
    html: layout(
      `We refunded ${money(refund.amountCents)}`,
      `<p>We refunded <strong>${escapeHtml(money(refund.amountCents))}</strong>${escapeHtml(what)} on order ${escapeHtml(order.publicId)}. It goes back to the card you paid with and usually shows within 5–10 business days.</p>
<p><a href="${escapeHtml(orderUrl)}">View your order</a></p>`,
    ),
  }
}

/** A reported problem was reviewed and not refunded (G5-11). */
export function issueRejected(order: Order, note: string, orderUrl: string): Rendered {
  return {
    template: 'issue_rejected',
    version: 1,
    subject: `About the problem you reported on order ${order.publicId}`,
    text: `We looked into the problem you reported on order ${order.publicId}.\n\n${note}\n\n${orderUrl}`,
    html: layout(
      'We reviewed your report',
      `<p>We looked into the problem you reported on order ${escapeHtml(order.publicId)}.</p><p>${escapeHtml(note)}</p>
<p><a href="${escapeHtml(orderUrl)}">View your order</a></p>`,
    ),
  }
}

/** An operational alert for a staff channel (G6-09). */
export function opsAlert(alert: {
  alertId: number
  kind: string
  severity: string
  sev: string
  message: string
  runbook: string
  opsUrl: string
}): Rendered {
  const text = `${alert.sev} · ${alert.kind} (${alert.severity})

${alert.message}

Alert #${alert.alertId}: ${alert.opsUrl}
Runbook: ${alert.runbook}`
  return {
    template: 'ops_alert',
    version: 1,
    subject: `[${alert.sev}] ${alert.message}`.slice(0, 200),
    text,
    html: layout(
      `${alert.sev}: ${alert.kind}`,
      `<p>${escapeHtml(alert.message)}</p><p>Severity: ${escapeHtml(alert.severity)}</p>
<p><a href="${escapeHtml(alert.opsUrl)}">Open the operations dashboard</a> · Runbook: ${escapeHtml(alert.runbook)}</p>`,
    ),
  }
}
