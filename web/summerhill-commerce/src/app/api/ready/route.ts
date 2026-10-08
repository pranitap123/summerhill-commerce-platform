import { NextResponse } from 'next/server'

import { pingSearch, searchIndexExists } from '@/modules/search'
import { getDb } from '@/server/db'
import { route } from '@/server/http'

export const GET = route('public', async ({ log }) => {
  const database = await getDb()
    .query('SELECT 1')
    .then(() => true)
    .catch((err) => {
      log.warn({ err }, 'readiness: database unavailable')
      return false
    })

  const search = await pingSearch()
  const searchIndex = search && (await searchIndexExists())
  const checks = { database, search, searchIndex }
  return NextResponse.json(
    { status: database ? 'ready' : 'not_ready', checks },
    { status: database ? 200 : 503 },
  )
})
