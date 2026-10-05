import type { NextRequest } from 'next/server'

import { GET as v1 } from '../../v1/products/[slug]/route'
import { deprecated } from '../deprecated'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await v1(req, { params: Promise.resolve({ slug: id }) })
  const body = await res.json()
  return res.ok
    ? deprecated(body, `/api/v1/products/${encodeURIComponent(id)}`)
    : Response.json(body, { status: res.status })
}
