import { issueContext } from '@/modules/support'
import { idParam, parseParams, route } from '@/server/http'

export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => issueContext(parseParams(params, idParam).id),
  { permission: 'issues.resolve' },
)
