import type { NextRequest } from 'next/server'

import { GET as v1 } from '../../v1/search/route'
import { deprecated } from '../deprecated'

export async function GET(req: NextRequest) {
  const res = await v1(req, { params: Promise.resolve({}) })
  return res.ok
    ? deprecated(await res.json(), '/api/v1/search')
    : Response.json(await res.json(), { status: res.status })
}
