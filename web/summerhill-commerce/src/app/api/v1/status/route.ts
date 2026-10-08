import { NextResponse } from 'next/server'

import { readFlagNow } from '@/modules/ops'
import { route } from '@/server/http'

export const GET = route('public', async () =>
  NextResponse.json(
    { checkoutEnabled: await readFlagNow('checkout.enabled') },
    { headers: { 'cache-control': 'no-store' } },
  ),
)
