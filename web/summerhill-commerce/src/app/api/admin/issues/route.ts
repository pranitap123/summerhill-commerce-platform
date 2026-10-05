import { listIssues } from '@/modules/support'
import { parseQuery, route } from '@/server/http'

import { issueListQuery } from '../_lib/schemas'

/** GET /api/admin/issues?status=open (G5-11): the support queue. */
export const GET = route(
  'admin',
  async ({ req }) => ({ issues: await listIssues(parseQuery(req, issueListQuery)) }),
  { permission: 'issues.resolve' },
)
