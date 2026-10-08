import { setFlag } from '@/modules/ops'
import { parseJson, parseParams, route } from '@/server/http'

import { flagBody, flagParam } from '../../_lib/schemas'

export const PUT = route<{ key: string }>(
  'admin',
  async ({ req, params, auditContext }) => {
    const { key } = parseParams(params, flagParam)
    const { enabled } = await parseJson(req, flagBody)
    return { flag: await setFlag(auditContext, key, enabled) }
  },
  { permission: 'flags.manage', audit: 'service' },
)
