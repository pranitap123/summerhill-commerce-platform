import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ALERT_ROUTES, CONDITION_RULES, routeFor } from '@/modules/ops'

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.tsx?$/.test(e.name) ? [p] : []
  })
}

function raisedKinds(): Map<string, string> {
  const kinds = new Map<string, string>()
  for (const file of sourceFiles(path.resolve('src'))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const call of text.matchAll(/raiseAlert\([^,]+,\s*\{\s*kind:\s*'([^']+)'/g))
      kinds.set(call[1], path.relative(process.cwd(), file))
  }
  return kinds
}

describe('alert routes', () => {
  it('finds the alerts raised in the code', { timeout: 30_000 }, () => {
    expect(raisedKinds().size).toBeGreaterThanOrEqual(15)
  })

  it('routes every alert kind the code raises', { timeout: 30_000 }, () => {
    const missing = [...raisedKinds()].filter(([kind]) => !ALERT_ROUTES[kind])
    expect(missing).toEqual([])
  })

  it('points every route at a runbook that exists (G7-07)', () => {
    const repoRoot = path.resolve('../..')
    const missing = Object.entries(ALERT_ROUTES)
      .filter(([, route]) => !fs.existsSync(path.join(repoRoot, route.runbook)))
      .map(([kind, route]) => `${kind} → ${route.runbook}`)
    expect(missing).toEqual([])
    expect(fs.existsSync(path.join(repoRoot, routeFor('unknown.kind').runbook))).toBe(true)
  })

  it('routes every condition rule, and pages for SEV1', () => {
    for (const rule of CONDITION_RULES) expect(ALERT_ROUTES[rule.kind]).toBeDefined()
    for (const [kind, route] of Object.entries(ALERT_ROUTES))
      if (route.sev === 'SEV1') expect(route.channel, kind).toBe('page')
  })

  it('sends unknown kinds to ops rather than dropping them', () => {
    expect(routeFor('something.new')).toMatchObject({ channel: 'ops', sev: 'SEV3', known: false })
  })
})
