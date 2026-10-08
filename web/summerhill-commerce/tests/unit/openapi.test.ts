import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { OPERATIONS, renderOpenApi } from '@/app/api/v1/_lib/openapi'

const SPEC = path.resolve(__dirname, '../../../../docs/openapi.yaml')
const API = path.resolve(__dirname, '../../src/app/api')

function routeFiles(dir: string, base = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('_')) return []
    const rel = `${base}/${e.name}`
    if (e.isDirectory()) return routeFiles(path.join(dir, e.name), rel)
    return e.name === 'route.ts' ? [base] : []
  })
}

describe('OpenAPI contract', () => {
  it('docs/openapi.yaml is up to date (run `npm run openapi`)', () => {
    expect(fs.readFileSync(SPEC, 'utf8').replace(/\r\n/g, '\n')).toBe(renderOpenApi())
  })

  it.each(['v1', 'console', 'admin'])(
    'documents every exported handler of every /api/%s route',
    async (area) => {
      const dir = path.join(API, area)
      for (const rel of routeFiles(dir)) {
        const mod = await import(path.join(dir, rel, 'route.ts'))
        const apiPath = `/api/${area}${rel.replace(/\[(\w+)\]/g, '{$1}')}`
        for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(
          (m) => typeof mod[m] === 'function',
        ))
          expect(
            OPERATIONS.some((o) => o.path === apiPath && o.method === method.toLowerCase()),
            `${method} ${apiPath} is not in the OpenAPI registry`,
          ).toBe(true)
      }
    },
    60_000,
  )
})
