#!/usr/bin/env node
// Blocks secrets and real merchant data from entering the repository.
//
// Modes:
//   --staged          scan files staged for commit (used by the pre-commit hook)
//   --all             scan every tracked or untracked, non-ignored file in the working tree
//   --history         scan every line ever added in any branch (pre-publish check)
//   --files <paths>   scan the given files (used by tests)
//
// A line can be allow-listed with the comment marker: secret-scan:allow
// If gitleaks is installed it also runs (staged/all modes) as a second opinion.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_RULES = [
  { id: 'stripe-secret-key', re: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}\b/ },
  { id: 'stripe-webhook-secret', re: /\bwhsec_[0-9A-Za-z]{10,}\b/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'connection-string-password', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/]+:[^@\s]{3,}@(?!localhost|127\.0\.0\.1)/ },
  { id: 'hardcoded-credential', re: /\b(?:api[_-]?key|apikey|secret|token|passwd|password)\b["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i },
  // Confidential merchant analytics seen in the upstream search API (sales volumes).
  { id: 'merchant-sales-data', re: /"(?:inStoreVolumeL30|onlineVolumeL30|totalVolumeL30)"/ },
];

const PATH_RULES = [
  { id: 'env-file', test: (p) => /(^|\/)\.env(\.|$)/.test(p) && !/\.env\.example$/.test(p) },
  { id: 'scraped-data-file', test: (p) => /(^|\/)(scraped|sample|search_sample)\.json$/.test(p) || /_sample\.json$/.test(p) },
  { id: 'key-file', test: (p) => /\.(pem|key|p12|pfx)$/.test(p) },
];

const MAX_JSON_BYTES = 500 * 1024; // large JSON blobs are almost always data dumps
const SKIP_CONTENT = /\.(png|jpe?g|gif|webp|ico|ttf|woff2?|pdf|zip|pyc|lock)$|package-lock\.json$/;
const ALLOW = 'secret-scan:allow';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
const findings = [];
const report = (where, rule, line) =>
  findings.push(`${where}  [${rule}]${line ? '  ' + line.trim().slice(0, 100) : ''}`);

function scanText(where, text) {
  text.split('\n').forEach((line, i) => {
    if (line.includes(ALLOW)) return;
    for (const r of CONTENT_RULES) if (r.re.test(line)) report(`${where}:${i + 1}`, r.id, redact(line));
  });
}
function redact(line) {
  return line.replace(/([A-Za-z0-9_]{6})[A-Za-z0-9_]{8,}/g, '$1********');
}
function scanPath(p, readContent, size) {
  const norm = p.replace(/\\/g, '/');
  for (const r of PATH_RULES) if (r.test(norm)) report(norm, r.id);
  if (norm.endsWith('.json') && size > MAX_JSON_BYTES && !/package(-lock)?\.json$/.test(norm))
    report(norm, 'large-json-dump', `${Math.round(size / 1024)} KB`);
  if (!SKIP_CONTENT.test(norm)) scanText(norm, readContent());
}

const mode = process.argv[2] || '--staged';
if (mode === '--staged') {
  const files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean);
  for (const f of files) {
    const blob = () => git('show', `:${f}`);
    const size = Number(git('cat-file', '-s', `:${f}`).trim());
    scanPath(f, blob, size);
  }
} else if (mode === '--all') {
  const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
  for (const f of files) {
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
    scanPath(f, () => fs.readFileSync(f, 'utf8'), fs.statSync(f).size);
  }
} else if (mode === '--history') {
  const log = git('log', '--all', '-p', '--no-color', '--pretty=format:@@commit %h');
  let commit = '';
  let file = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('@@commit ')) { commit = line.slice(9); continue; }
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      for (const r of PATH_RULES) if (r.test(file)) report(`${commit} ${file}`, r.id);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++') && !line.includes(ALLOW))
      for (const r of CONTENT_RULES) if (r.re.test(line)) report(`${commit} ${file}`, r.id, redact(line.slice(1)));
  }
} else if (mode === '--files') {
  for (const f of process.argv.slice(3)) scanPath(f, () => fs.readFileSync(f, 'utf8'), fs.statSync(f).size);
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}

// Second opinion from gitleaks when available.
if (mode === '--staged' || mode === '--all') {
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  if (!probe.error && probe.status === 0) {
    const args = mode === '--staged' ? ['protect', '--staged', '--no-banner'] : ['detect', '--no-git', '--no-banner', '--source', '.'];
    const res = spawnSync('gitleaks', args, { stdio: 'inherit' });
    if (res.status !== 0) findings.push('gitleaks reported findings (see above)');
  }
}

// Dedupe per-file path findings in history mode (one file can appear in many commits).
const unique = [...new Set(findings)];
if (unique.length) {
  console.error(`\nsecret-scan: ${unique.length} finding(s) in ${mode} mode:\n  ` + unique.join('\n  '));
  console.error(`\nFix the files, or mark a verified false positive with "${ALLOW}".`);
  process.exit(1);
}
console.log(`secret-scan: clean (${mode})`);
