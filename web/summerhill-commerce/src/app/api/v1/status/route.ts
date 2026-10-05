import { NextResponse } from 'next/server'

import { readFlagNow } from '@/modules/ops'
import { route } from '@/server/http'

/**
 * GET /api/v1/status (G5-10): whether checkout is open, read from the flag directly (no cache), so
 * the storefront banner reflects a kill switch at the next poll.
 */
export const GET = route('public', async () =>
  NextResponse.json(
    { checkoutEnabled: await readFlagNow('checkout.enabled') },
    { headers: { 'cache-control': 'no-store' } },
  ),
)
