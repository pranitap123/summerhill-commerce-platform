import { monthlyCloseCsv } from '@/modules/payouts'
import { parseParams, route } from '@/server/http'

import { csvResponse } from '../../../_lib/helpers'
import { closeMonthParam } from '../../../_lib/schemas'

/** GET /api/admin/reconciliation/close/{YYYY-MM}: monthly close export (A10), every ledger entry. */
export const GET = route<{ month: string }>(
  'admin',
  async ({ params }) => {
    const { month } = parseParams(params, closeMonthParam)
    return csvResponse(await monthlyCloseCsv(month), `ledger-${month}.csv`)
  },
  { permission: 'finance.read' },
)
