import { NextResponse } from 'next/server'

import { recordSearchClick } from '@/modules/search'
import { parseJson, route } from '@/server/http'

import { searchClickBody } from '../../_lib/schemas'

/**
 * POST /api/v1/search/clicks: which result of a search was opened, and at which position (G3-15).
 * No personal data; unknown or day-old search ids are ignored. Always 202.
 */
export const POST = route('public', async ({ req }) => {
  const { searchId, productId, position } = await parseJson(req, searchClickBody)
  await recordSearchClick(searchId, productId, position)
  return NextResponse.json({ accepted: true }, { status: 202 })
})
