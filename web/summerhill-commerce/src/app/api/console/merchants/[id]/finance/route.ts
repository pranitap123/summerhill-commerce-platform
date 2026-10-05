import { requireMerchantOwner, staffScope } from '@/modules/fulfilment'
import { getMerchantById } from '@/modules/merchant'
import { listPayouts, merchantStatement, statementMonths } from '@/modules/payouts'
import { HttpError, parseParams, parseQuery, route } from '@/server/http'

import { consoleFinanceQuery, consoleMerchantParams } from '../../../../admin/_lib/schemas'

/**
 * GET /api/console/merchants/{id}/finance?month=YYYY-MM (G5-13, M12): the owner's sales, fees,
 * refunds, payouts and statement months, from the same ledger as the platform's statements.
 */
export const GET = route<{ id: string }>('staff', async ({ req, params, user, memberships }) => {
  const { id } = parseParams(params, consoleMerchantParams)
  requireMerchantOwner(staffScope(user!, memberships), id)
  const merchant = await getMerchantById(id)
  if (!merchant) throw new HttpError(404, 'NOT_FOUND', 'Not found')
  const months = await statementMonths(id)
  const { month = months[0] ?? new Date().toISOString().slice(0, 7) } = parseQuery(
    req,
    consoleFinanceQuery,
  )
  const [statement, payouts] = await Promise.all([
    merchantStatement(id, month),
    listPayouts({ merchantId: id, limit: 20 }),
  ])
  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      payoutSchedule: merchant.payout_schedule_interval,
    },
    months,
    statement,
    payouts: payouts.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      status: p.status,
      method: p.method,
      arrivalDate: p.arrivalDate,
      failureMessage: p.failureMessage,
      createdAt: p.createdAt,
    })),
  }
})
