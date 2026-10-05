import { resolveIssue } from '@/modules/support'
import { idParam, parseJson, parseParams, route } from '@/server/http'

import { moneyAction, refundLimitFor } from '../../../_lib/helpers'
import { resolveIssueBody } from '../../../_lib/schemas'

/**
 * POST /api/admin/issues/{id}/resolve (ORDERS §10): approve (refund, liability per the matrix,
 * role limits apply) or reject (liability: customer; the customer is emailed the note).
 */
export const POST = route<{ id: string }>(
  'admin',
  async (ctx) => {
    const { id } = parseParams(ctx.params, idParam)
    const body = await parseJson(ctx.req, resolveIssueBody)
    return moneyAction(
      ctx,
      `issue:${id}`,
      body,
      () => resolveIssue(ctx.auditContext, id, { ...body, limitCents: refundLimitFor(ctx.user) }),
      200,
    )
  },
  { permission: 'issues.resolve', audit: 'service' },
)
