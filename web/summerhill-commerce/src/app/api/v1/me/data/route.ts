import { NextResponse } from 'next/server'

import { exportPersonalData } from '@/modules/privacy'
import { route } from '@/server/http'

export const GET = route('customer', async ({ user, auditContext }) => {
  const data = await exportPersonalData(auditContext, { userId: String(user!.id) })
  return NextResponse.json(data, {
    headers: {
      'content-disposition': 'attachment; filename="my-data.json"',
      'cache-control': 'no-store',
    },
  })
})
