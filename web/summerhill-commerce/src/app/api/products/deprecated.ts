import { NextResponse } from 'next/server'

/**
 * The pre-G3 catalogue routes (/api/products, /api/products/{id}, /api/products/search,
 * /api/categories) now answer exactly like their /api/v1 successors, marked deprecated (RFC 9745).
 * The storefront uses /api/v1 and module services only.
 */
export function deprecated(body: unknown, successor: string): NextResponse {
  return NextResponse.json(body, {
    headers: { deprecation: 'true', link: `<${successor}>; rel="successor-version"` },
  })
}
