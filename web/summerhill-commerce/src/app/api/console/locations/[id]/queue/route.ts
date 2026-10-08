import { consoleQueue } from '@/modules/fulfilment'
import { parseParams, route } from '@/server/http'

import { scopeOf } from '../../../_lib/scope'
import { locationParams } from '../../../_lib/schemas'

export const GET = route<{ id: string }>('staff', async (ctx) => {
  const { id } = parseParams(ctx.params, locationParams)
  return consoleQueue(scopeOf(ctx), id)
})
