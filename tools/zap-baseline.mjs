#!/usr/bin/env node
// OWASP ZAP baseline scan (G6-02) against the running app, in Docker (compose profile "security").
// ZAP spiders the site for a few minutes and reports passive findings; nothing is attacked.
//
//   npm run start:sim --prefix web/summerhill-commerce    (or any build on :3000)
//   npm run scan:zap
//
// Fails on any High-risk finding, and on any rule marked FAIL in infra/zap/rules.tsv. The full
// report is written to infra/zap/zap-report.html (git-ignored).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPORT = path.join(ROOT, 'infra/zap/zap-report.json')
const RULES = path.join(ROOT, 'infra/zap/rules.tsv')
const LOCAL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const RISK = { 3: 'High', 2: 'Medium', 1: 'Low', 0: 'Info' }

try {
  await fetch(`${LOCAL}/api/health`)
} catch {
  console.error(`No app answering at ${LOCAL}. Start it first (npm run start:sim --prefix web/summerhill-commerce).`)
  process.exit(2)
}

fs.rmSync(REPORT, { force: true })
const run = spawnSync(
  'docker',
  ['compose', '-f', 'infra/docker-compose.yml', '--profile', 'security', 'run', '--rm', 'zap'],
  { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
)
if (!fs.existsSync(REPORT)) {
  console.error(`ZAP produced no report (exit ${run.status}).`)
  process.exit(1)
}

const failRules = new Set(
  fs
    .readFileSync(RULES, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t'))
    .filter(([, action]) => action === 'FAIL')
    .map(([id]) => id),
)
const alerts = JSON.parse(fs.readFileSync(REPORT, 'utf8')).site.flatMap((s) => s.alerts ?? [])
const byRisk = { 3: [], 2: [], 1: [], 0: [] }
for (const a of alerts) byRisk[a.riskcode].push(a)

console.log('\n──────── ZAP baseline ────────')
for (const risk of [3, 2, 1, 0]) {
  console.log(`${RISK[risk].padEnd(7)} ${byRisk[risk].length}`)
  for (const a of byRisk[risk])
    console.log(`  [${a.pluginid}] ${a.alert} (${a.count} URL${a.count === '1' ? '' : 's'})`)
}
const failing = alerts.filter((a) => a.riskcode === '3' || failRules.has(a.pluginid))
if (failing.length) {
  console.log(`\n${failing.length} failing finding(s): ${failing.map((a) => a.pluginid).join(', ')}`)
  process.exit(1)
}
console.log('\nNo High-risk findings and no FAIL rules triggered.')
