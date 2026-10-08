import { NextResponse } from 'next/server'

import { recordSearchClick } from '@/modules/search'
import { parseJson, route } from '@/server/http'

import { searchClickBody } from '../../_lib/schemas'

export const POST = route('public', async ({ req }) => {
  const { searchId, productId, position } = await parseJson(req, searchClickBody)
  await recordSearchClick(searchId, productId, position)
  return NextResponse.json({ accepted: true }, { status: 202 })
})
