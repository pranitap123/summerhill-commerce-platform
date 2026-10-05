import { issueContext } from '@/modules/support'
import { idParam, parseParams, route } from '@/server/http'

/** GET /api/admin/issues/{id}: the issue, the customer's 90-day refunds and earlier issues. */
export const GET = route<{ id: string }>(
  'admin',
  async ({ params }) => issueContext(parseParams(params, idParam).id),
  { permission: 'issues.resolve' },
)
