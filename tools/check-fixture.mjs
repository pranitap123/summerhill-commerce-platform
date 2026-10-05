#!/usr/bin/env node
// Fails if db/seed/catalog.fixture.json differs from what db/seed/generate.mjs produces, i.e. the
// generator was changed without regenerating, or the fixture was edited by hand.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = path.join(ROOT, 'db/seed/catalog.fixture.json')
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex')

const before = hash(FIXTURE)
const backup = path.join(os.tmpdir(), `catalog.fixture.${process.pid}.json`)
fs.copyFileSync(FIXTURE, backup)
try {
  execFileSync(process.execPath, [path.join(ROOT, 'db/seed/generate.mjs')], { stdio: 'ignore' })
  if (hash(FIXTURE) !== before) {
    fs.copyFileSync(backup, FIXTURE)
    console.error('check-fixture: catalog.fixture.json is stale. Run `node db/seed/generate.mjs` and review the diff.')
    process.exit(1)
  }
  console.log('check-fixture: fixture matches the generator')
} finally {
  fs.rmSync(backup, { force: true })
}
