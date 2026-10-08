#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plan = fs.readFileSync(path.join(root, 'docs/IMPLEMENTATION_PLAN.md'), 'utf8')
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const repo = args[args.indexOf('--repo') + 1]

const OPEN = new Set(['G0-01', 'G0-02', 'G0-03', 'G6-06', 'G6-07', 'G7-04', 'G7-05', 'G7-06'])
const OPTIONAL_PHASE = 'G8'

const LABELS = {
  core: { color: '1d76db', description: 'Core track (★): needed for a complete system' },
  money: { color: 'b60205', description: 'Touches money: pricing, payments, ledger, payouts' },
  security: { color: '5319e7', description: 'Security, auth, secrets or privacy' },
  'good first issue': { color: '7057ff', description: 'Small and self-contained' },
}
const MONEY = /pric|payment|capture|refund|ledger|payout|fee|reconcil|dispute|stripe|money|tax|hst|charge|checkout/i
const SECURITY = /secur|auth|csp|secret|mfa|zap|privacy|csrf|owasp|permission|role|leak|gitleaks/i

const clean = (s) =>
  s
    .replace(/\*\*|\*/g, '')
    .replace(/`/g, '')
    .trim()

function workItems() {
  const items = []
  let phase = null
  let milestone = null
  let columns = null
  for (const line of plan.split('\n')) {
    const section = line.match(/^## (G\d) — (.+)$/)
    if (section) {
      phase = section[1]
      milestone = `${section[1]} ${section[2]}`
      columns = null
      continue
    }

    if (line.startsWith('## ') || line.startsWith('### ')) {
      phase = null
      columns = null
      continue
    }
    if (!phase || !line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells[0] === 'ID') {
      columns = cells
      continue
    }
    if (!columns || !/^G\d-\d{2}$/.test(cells[0])) continue
    const get = (name) => cells[columns.findIndex((c) => c.startsWith(name))] ?? ''
    const title = clean(get('Work item') || get('Showcase'))
    const acceptance = clean(get('Acceptance') || get('Why'))
    const est = Number(get('Est')) || null
    const core = get('★') === '★'
    const text = `${title} ${acceptance} ${get('Key files')}`
    const labels = [
      ...(core ? ['core'] : []),
      ...(MONEY.test(text) ? ['money'] : []),
      ...(SECURITY.test(text) ? ['security'] : []),
      ...(est !== null && est <= 0.5 && !MONEY.test(text) ? ['good first issue'] : []),
    ]
    const state = phase === OPTIONAL_PHASE || OPEN.has(cells[0]) ? 'open' : 'closed'
    items.push({ id: cells[0], title, acceptance, est, labels, milestone, state })
  }
  return items
}

const items = workItems()
const milestones = [...new Set(items.map((i) => i.milestone))]
const byState = (s) => items.filter((i) => i.state === s).length
console.log(
  `${items.length} work items in ${milestones.length} milestones: ${byState('open')} open, ${byState('closed')} closed`,
)
for (const m of milestones)
  console.log(`  ${m}: ${items.filter((i) => i.milestone === m).length}`)
for (const l of Object.keys(LABELS))
  console.log(`  label ${l}: ${items.filter((i) => i.labels.includes(l)).length}`)
if (args.includes('--list'))
  for (const i of items)
    console.log(`${i.state === 'open' ? '○' : '●'} ${i.id}: ${i.title.slice(0, 90)} [${i.labels.join(', ')}]`)

if (!apply) {
  console.log('\ndry run: nothing created (use --apply --repo owner/name at publication)')
  process.exit(0)
}
if (!repo || repo.startsWith('--')) {
  console.error('github-board: --apply needs --repo owner/name')
  process.exit(2)
}

function gh(...ghArgs) {
  const res = spawnSync('gh', ghArgs, { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`gh ${ghArgs.slice(0, 3).join(' ')}: ${res.stderr.trim()}`)
  return res.stdout.trim()
}

for (const [name, { color, description }] of Object.entries(LABELS))
  gh('label', 'create', name, '--repo', repo, '--color', color, '--description', description, '--force')
const existingMilestones = new Set(
  JSON.parse(gh('api', `repos/${repo}/milestones?state=all&per_page=100`)).map((m) => m.title),
)
for (const m of milestones)
  if (!existingMilestones.has(m)) gh('api', `repos/${repo}/milestones`, '-f', `title=${m}`)
const existingIssues = new Set(
  JSON.parse(gh('issue', 'list', '--repo', repo, '--state', 'all', '--limit', '500', '--json', 'title')).map(
    (i) => i.title.split(':')[0],
  ),
)
for (const i of items) {
  if (existingIssues.has(i.id)) continue
  const body = `**Acceptance criteria:** ${i.acceptance}\n\nEstimate: ${i.est ?? '–'} d · From [IMPLEMENTATION_PLAN](../blob/main/docs/IMPLEMENTATION_PLAN.md)`
  const url = gh(
    'issue', 'create', '--repo', repo, '--title', `${i.id}: ${i.title}`, '--body', body,
    '--milestone', i.milestone, ...i.labels.flatMap((l) => ['--label', l]),
  )
  if (i.state === 'closed') gh('issue', 'close', url, '--reason', 'completed')
  console.log(`${i.state} ${url}`)
}
