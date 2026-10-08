#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(DOCS, rel), 'utf8');
const errors = [];
const fail = (msg) => errors.push(msg);

const mdFiles = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.md')) mdFiles.push(p);
  }
})(DOCS);

const ROOT = path.resolve(DOCS, '..');
for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.md')) mdFiles.push(path.join(ROOT, f));
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const anchors = new Map(
  mdFiles.map((f) => [
    f,
    new Set(fs.readFileSync(f, 'utf8').split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, '')))),
  ]),
);
let linkCount = 0;
for (const f of mdFiles) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/\]\(([^)#]*?)(#[^)]*)?\)/g)) {
    if (/^https?:/.test(m[1])) continue;
    linkCount++;
    const target = m[1] ? path.resolve(path.dirname(f), m[1]) : f;
    if (!fs.existsSync(target)) { fail(`broken link in ${path.relative(DOCS, f)}: ${m[1]}`); continue; }
    if (m[2] && target.endsWith('.md') && !anchors.get(target)?.has(m[2].slice(1)))
      fail(`broken anchor in ${path.relative(DOCS, f)}: ${m[1]}${m[2]}`);
  }
}

const plan = read('IMPLEMENTATION_PLAN.md');
const planItems = new Set([...plan.matchAll(/^\| (G\d-\d+) \|/gm)].map((m) => m[1]));
const phaseOf = (id) => id.split('-')[0];

const rtm = read('TRACEABILITY.md');
const DISPOSITIONS = new Set(['Plan', 'Stretch', 'Backlog', "Won't", 'OOS']);
const rows = [];
for (const line of rtm.split('\n')) {
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length !== 4 || /^-+$/.test(cells[0]) || cells[0] === 'Req' || cells[0] === 'Code') continue;
  rows.push({ req: cells[0], text: cells[1], disp: cells[2], items: cells[3] });
}
const rtmReqs = new Set(rows.map((r) => r.req));
for (const r of rows) {
  if (!DISPOSITIONS.has(r.disp)) fail(`RTM ${r.req}: invalid disposition "${r.disp}"`);
  for (const m of r.items.matchAll(/G\d-\d+/g)) if (!planItems.has(m[0])) fail(`RTM ${r.req}: unknown work item ${m[0]}`);
  for (const m of r.items.matchAll(/(G\d-\d+) … (G\d-\d+)/g))
    if (phaseOf(m[1]) !== phaseOf(m[2])) fail(`RTM ${r.req}: range crosses phases ${m[0]}`);
  if (r.disp === 'Plan' && !/G\d/.test(r.items)) fail(`RTM ${r.req}: "Plan" without work items`);
}

const expect = (label, ids) => {
  for (const id of ids) if (!rtmReqs.has(id)) fail(`${label}: ${id} has no traceability row`);
  return ids.length;
};
const counts = {};
counts.useCases = expect('PRD', [...read('product/PRD.md').matchAll(/^\| ((?:S|M|A|X)\d+) \|/gm)].map((m) => m[1]));
counts.gaps = expect('CURRENT_STATE', [...read('architecture/CURRENT_STATE.md').matchAll(/^\| (GAP-\d+) \|/gm)].map((m) => m[1]));
const sd = read('architecture/SYSTEM_DESIGN.md');
counts.jobs = expect('SYSTEM_DESIGN jobs', [...sd.matchAll(/^\| `([a-z]+\.[a-zA-Z.]+)` \|/gm)].map((m) => 'JOB-' + m[1]));
const endpointPaths = [...sd.matchAll(/^\| (?:GET|POST|PUT|PATCH|DELETE|GET\/PUT)[^|]*\| `([^`]+)`/gm)].map((m) => m[1]);
for (const p of endpointPaths) if (!rtm.includes(p)) fail(`SYSTEM_DESIGN endpoint ${p} has no traceability row`);
counts.endpoints = endpointPaths.length;
const sec = read('SECURITY_AND_COMPLIANCE.md');
counts.threats = expect('SECURITY threats', [...sec.matchAll(/^\| (T\d+) \|/gm)].map((m) => m[1]));
const backlog = sec.slice(sec.indexOf('## 10.'));
counts.securityBacklog = expect('SECURITY backlog', [...backlog.matchAll(/^(\d+)\. /gm)].map((m) => 'SEC-' + m[1].padStart(2, '0')));
const ops = read('OPERATIONS.md');
const runbooks = ops.slice(ops.indexOf('## 6.'), ops.indexOf('## 7.'));
counts.runbooks = expect('OPERATIONS runbooks', [...new Set([...runbooks.matchAll(/\bRB-\d{2}\b/g)].map((m) => m[0]))]);
counts.testAreas = expect('TESTING', [...read('TESTING.md').matchAll(/^### (3\.\d+) /gm)].map((m) => 'TST-' + m[1]));
const fr = read('product/FEATURE_ROADMAP.md');
const featureMap = fr.slice(fr.indexOf('## 2. Feature map'), fr.indexOf('## 3.'));
const featureRows = featureMap.split('\n').filter((l) => /^\| [^-|]/.test(l) && !/^\| Feature \|/.test(l));
counts.features = featureRows.length;
const fRows = rows.filter((r) => r.req.startsWith('F-')).length;
if (fRows < featureRows.length) fail(`FEATURE_ROADMAP has ${featureRows.length} features but TRACEABILITY has only ${fRows} F- rows`);

const byDisp = {};
for (const r of rows) byDisp[r.disp] = (byDisp[r.disp] || 0) + 1;
const usedItems = new Set(rows.flatMap((r) => [...r.items.matchAll(/G\d-\d+/g)].map((m) => m[0])));
const expanded = new Set(usedItems);
for (const r of rows) for (const m of r.items.matchAll(/(G\d)-(\d+) … G\d-(\d+)/g))
  for (let i = +m[2]; i <= +m[3]; i++) expanded.add(`${m[1]}-${String(i).padStart(2, '0')}`);
for (const r of rows) for (const m of r.items.matchAll(/\b(G\d)\b(?!-)/g)) for (const id of planItems) if (phaseOf(id) === m[1]) expanded.add(id);
const unreferenced = [...planItems].filter((id) => !expanded.has(id) && !/^G[078]-/.test(id));

console.log(`docs: ${mdFiles.length} files, ${linkCount} internal links`);
console.log(`plan: ${planItems.size} work items`);
console.log(`requirements traced: ${rows.length} rows`, byDisp);
console.log('sources:', counts, `feature rows traced: ${fRows}`);
if (unreferenced.length) console.log(`note: plan items not referenced by any requirement (enablers/process): ${unreferenced.join(', ')}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n- ` + errors.join('\n- '));
  process.exit(1);
}
console.log('\nOK: every requirement is traced, every reference resolves.');
