import { NextResponse } from 'next/server'

export function deprecated(body: unknown, successor: string): NextResponse {
  return NextResponse.json(body, {
    headers: { deprecation: 'true', link: `<${successor}>; rel="successor-version"` },
  })
}
