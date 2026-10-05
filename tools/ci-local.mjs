#!/usr/bin/env node
// Local CI (G1-14): the same checks, in the same order, that .github/workflows/ci.yml runs.
//   npm run ci:local                 all checks (needs `npm run stack:up` for integration tests)
//   npm run ci:local -- --fast       skip integration tests and dependency audit
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = path.join(ROOT, 'web/summerhill-commerce')
const fast = process.argv.includes('--fast')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const steps = [
  { name: 'secret scan (working tree)', cwd: ROOT, cmd: process.execPath, args: ['tools/scan-secrets.mjs', '--all'] },
  { name: 'docs traceability', cwd: ROOT, cmd: process.execPath, args: ['docs/tools/check-docs.mjs'] },
  { name: 'seed fixture is up to date', cwd: ROOT, cmd: process.execPath, args: ['tools/check-fixture.mjs'] },
  { name: 'pipeline unit tests (pytest)', cwd: ROOT, cmd: process.execPath, args: ['tools/pipeline.mjs', 'test:unit'] },
  { name: 'format (new code)', cwd: WEB, cmd: npm, args: ['run', '--silent', 'format:check'] },
  { name: 'lint', cwd: WEB, cmd: npm, args: ['run', '--silent', 'lint'] },
  { name: 'typecheck', cwd: WEB, cmd: npm, args: ['run', '--silent', 'typecheck'] },
  // Fast mode runs unit + authz; full mode runs every project once, with the coverage gates (G6-03)
  { name: 'unit tests', cwd: WEB, cmd: npm, args: ['run', '--silent', 'test:unit'], fastOnly: true },
  { name: 'authorisation matrix', cwd: WEB, cmd: npm, args: ['run', '--silent', 'test:authz'], fastOnly: true },
  { name: 'all tests + coverage gates (unit, authz, integration)', cwd: WEB, cmd: npm, args: ['run', '--silent', 'test:coverage'], slow: true },
  { name: 'pipeline ingest tests (Postgres)', cwd: ROOT, cmd: process.execPath, args: ['tools/pipeline.mjs', 'test:db'], slow: true },
  { name: 'dependency audit (high+)', cwd: WEB, cmd: npm, args: ['audit', '--omit=dev', '--audit-level=high'], slow: true },
]

const results = []
for (const step of steps) {
  if (!fast && step.fastOnly) continue
  if (fast && step.slow) {
    results.push({ name: step.name, status: 'skipped', ms: 0 })
    continue
  }
  console.log(`\n▶ ${step.name}`)
  const started = Date.now()
  const r = spawnSync(step.cmd, step.args, { cwd: step.cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  results.push({ name: step.name, status: r.status === 0 ? 'passed' : 'FAILED', ms: Date.now() - started })
}

console.log('\n──────── ci:local summary ────────')
for (const r of results) console.log(`${r.status.padEnd(8)} ${r.name}${r.ms ? `  (${(r.ms / 1000).toFixed(1)}s)` : ''}`)
const failed = results.filter((r) => r.status === 'FAILED')
if (failed.length) {
  console.log(`\n${failed.length} step(s) failed.`)
  process.exit(1)
}
console.log(`\nAll checks passed${fast ? ' (fast mode: integration tests and audit skipped)' : ''}.`)
