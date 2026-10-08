import { merchantStatement, statementCsv } from '@/modules/payouts'
import { parseParams, parseQuery, route } from '@/server/http'

import { csvResponse } from '../../../../_lib/helpers'
import { monthParam, statementQuery } from '../../../../_lib/schemas'

export const GET = route<{ id: string; month: string }>(
  'admin',
  async ({ req, params }) => {
    const { id, month } = parseParams(params, monthParam)
    const { format } = parseQuery(req, statementQuery)
    const statement = await merchantStatement(id, month)
    return format === 'csv'
      ? csvResponse(statementCsv(statement), `statement-${id}-${month}.csv`)
      : statement
  },
  { permission: 'finance.read' },
)
