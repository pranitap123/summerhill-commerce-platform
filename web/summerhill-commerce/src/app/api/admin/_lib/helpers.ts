import { NextResponse } from 'next/server'

import { can, SUPPORT_REFUND_LIMIT_CENTS, type SessionUser } from '@/modules/identity'
import { consume, LIMITS, readIdempotencyKey, requestHash, withIdempotency } from '@/modules/ops'
import { HttpError, type RouteContext } from '@/server/http'

export function refundLimitFor(user: SessionUser | null): number | null {
  return can(user, 'refunds.unlimited') ? null : SUPPORT_REFUND_LIMIT_CENTS
}

export async function moneyAction<T>(
  ctx: Pick<RouteContext<unknown>, 'req' | 'user'>,
  scope: string,
  body: unknown,
  run: () => Promise<T>,
  status = 201,
): Promise<Response> {
  await consume(LIMITS.adminMoney, `user:${ctx.user?.id}`)
  const key = readIdempotencyKey(ctx.req.headers)
  const result = await withIdempotency(
    `${scope}:${ctx.user?.id}`,
    key,
    requestHash({ scope, body }),
    async () => ({ status, body: await run() }),
  )
  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.replayed ? { 'idempotent-replayed': 'true' } : {},
  })
}

export function csvResponse(csv: string, filename: string): Response {
  if (!/^[a-z0-9._-]+$/i.test(filename)) throw new HttpError(400, 'BAD_FILENAME', 'Bad file name')
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
