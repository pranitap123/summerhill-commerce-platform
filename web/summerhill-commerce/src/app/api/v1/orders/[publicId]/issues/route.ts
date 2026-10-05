import { consume, LIMITS } from '@/modules/ops'
import { reportIssue } from '@/modules/support'
import { parseJson, parseParams, parseQuery, route } from '@/server/http'

import { reportIssueBody } from '../../../../admin/_lib/schemas'
import { customerActor, viewableOrder } from '../../../_lib/orders'
import { orderQuery, publicIdParams } from '../../../_lib/schemas'

/**
 * POST /api/v1/orders/{publicId}/issues?t=… (G5-11, S12): report a problem within 48 h of pickup.
 * Same access rule as the order page. Small claims are refunded at once by the policy engine;
 * the rest go to an agent.
 */
export const POST = route<{ publicId: string }>(
  'public',
  async ({ req, user, params }) => {
    const { publicId } = parseParams(params, publicIdParams)
    const { t } = parseQuery(req, orderQuery)
    const order = await viewableOrder(publicId, user, t)
    await consume(LIMITS.issues, `order:${order.id}`)
    const body = await parseJson(req, reportIssueBody)
    const issue = await reportIssue(
      order,
      { type: body.type, lines: body.lines, description: body.description ?? null },
      { actor: customerActor(user) },
    )
    return Response.json(
      {
        issueId: issue.id,
        status: issue.status,
        claimedCents: issue.claimedCents,
        refunded: issue.status === 'auto_approved',
      },
      { status: 201 },
    )
  },
  { session: 'optional' },
)
