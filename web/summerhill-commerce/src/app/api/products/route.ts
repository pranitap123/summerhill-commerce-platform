import type { NextRequest } from 'next/server'

import { GET as v1 } from '../v1/products/route'
import { deprecated } from './deprecated'

export async function GET(req: NextRequest) {
  const res = await v1(req, { params: Promise.resolve({}) })
  return deprecated(await res.json(), '/api/v1/products')
}
