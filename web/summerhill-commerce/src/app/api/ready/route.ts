import { NextResponse } from 'next/server'

import { pingSearch, searchIndexExists } from '@/modules/search'
import { getDb } from '@/server/db'
import { route } from '@/server/http'

/** Readiness: dependencies the app needs to serve traffic. 503 if any required one is down. */
export const GET = route('public', async ({ log }) => {
  const database = await getDb()
    .query('SELECT 1')
    .then(() => true)
    .catch((err) => {
      log.warn({ err }, 'readiness: database unavailable')
      return false
    })
  // Search is degradable (browse and the Postgres fallback still work), so it's reported but doesn't
  // fail readiness. `searchIndex` is false until the worker has built the index (G3-08).
  const search = await pingSearch()
  const searchIndex = search && (await searchIndexExists())
  const checks = { database, search, searchIndex }
  return NextResponse.json(
    { status: database ? 'ready' : 'not_ready', checks },
    { status: database ? 200 : 503 },
  )
})
