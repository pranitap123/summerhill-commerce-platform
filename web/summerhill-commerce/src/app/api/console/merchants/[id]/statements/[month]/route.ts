import { requireMerchantOwner, staffScope } from '@/modules/fulfilment'
import { merchantStatement, statementCsv } from '@/modules/payouts'
import { parseParams, route } from '@/server/http'

import { csvResponse } from '../../../../../admin/_lib/helpers'
import { consoleStatementParams } from '../../../../../admin/_lib/schemas'

/** GET /api/console/merchants/{id}/statements/{YYYY-MM}: the monthly statement as CSV (owner). */
export const GET = route<{ id: string; month: string }>(
  'staff',
  async ({ params, user, memberships }) => {
    const { id, month } = parseParams(params, consoleStatementParams)
    requireMerchantOwner(staffScope(user!, memberships), id)
    return csvResponse(statementCsv(await merchantStatement(id, month)), `statement-${month}.csv`)
  },
)
