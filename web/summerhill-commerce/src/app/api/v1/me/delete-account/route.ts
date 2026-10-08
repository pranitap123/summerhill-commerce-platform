import { NextResponse } from 'next/server'

import { deletePersonalData } from '@/modules/privacy'
import { parseJson, route } from '@/server/http'

import { deleteAccountBody } from '../../../admin/_lib/schemas'

export const POST = route('customer', async ({ req, user, auditContext }) => {
  await parseJson(req, deleteAccountBody)
  const result = await deletePersonalData(auditContext, { userId: String(user!.id) })
  const res = NextResponse.json({ deleted: true, ...result })
  res.cookies.delete('payload-token')
  return res
})
