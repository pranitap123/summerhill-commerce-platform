import { lbToMlb } from '@/modules/pricing'
import { createRefund, refundableSummary } from '@/modules/payments'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { moneyAction, refundLimitFor } from '../../../_lib/helpers'
import { refundBody } from '../../../_lib/schemas'

/** GET: what can still be refunded, per line. */
export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => refundableSummary(parseParams(params, idParam).id),
  { permission: 'refunds.create' },
)

/**
 * POST /api/admin/orders/{id}/refunds (G5-04): a line, part-line, amount or full refund. The
 * scenario decides the liability (ORDERS §9); support is capped at $50 per order. Requires an
 * Idempotency-Key; rate-limited; audited with the amounts and who bears them.
 */
export const POST = route<{ id: string }>(
  'admin',
  async (ctx) => {
    const { id } = parseParams(ctx.params, idParam)
    const body = await parseJson(ctx.req, refundBody)
    return moneyAction(ctx, `refund:${id}`, body, () =>
      createRefund(ctx.auditContext, {
        orderId: id,
        scenario: body.scenario as never,
        lines: body.lines?.map((l) => ({
          lineId: l.lineId,
          quantity: l.quantity,
          weightMlb: l.weightLb === undefined ? undefined : lbToMlb(l.weightLb.toFixed(3)),
        })),
        amountCents: body.amountCents,
        full: body.full,
        liability: body.liability,
        merchantShareCents: body.merchantShareCents,
        reason: body.reason,
        limitCents: refundLimitFor(ctx.user),
      }),
    )
  },
  { permission: 'refunds.create', audit: 'service' },
)
