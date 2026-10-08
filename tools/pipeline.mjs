#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PIPELINE = path.join(ROOT, 'pipeline')
const VENV = path.join(ROOT, '.venv')
const win = process.platform === 'win32'
const venvBin = (name) => path.join(VENV, win ? 'Scripts' : 'bin', win ? `${name}.exe` : name)
const [command, ...rest] = process.argv.slice(2)

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: PIPELINE, stdio: 'inherit', ...opts })
  if (r.error) {
    console.error(`pipeline: ${r.error.message}`)
    process.exit(1)
  }
  process.exit(r.status ?? 1)
}

function python() {
  const exe = venvBin('python')
  if (!fs.existsSync(exe)) {
    console.error('pipeline: .venv missing. Run `npm run pipeline:install` (needs Python 3.12+).')
    process.exit(2)
  }
  return exe
}

switch (command) {
  case 'install': {
    if (!fs.existsSync(venvBin('python'))) {
      const r = spawnSync(win ? 'py' : 'python3', [...(win ? ['-3'] : []), '-m', 'venv', VENV], { stdio: 'inherit' })
      if (r.status !== 0) process.exit(r.status ?? 1)
    }
    run(venvBin('python'), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', 'requirements.txt'])
    break
  }
  case 'test':
    run(python(), ['-m', 'pytest', ...rest])
    break

  case 'test:unit':
    run(python(), ['-m', 'pytest', '-m', 'not db', ...rest])
    break
  case 'test:db':
    run(python(), ['-m', 'pytest', '-m', 'db', ...rest])
    break
  case 'ingest':
  case 'runs':
  case 'approve':
  case 'reject':
  case 'process-requests':
    run(python(), ['-m', 'catalog_pipeline', command, ...rest])
    break
  case 'dagster': {
    python()
    const home = path.join(ROOT, '.dagster')
    fs.mkdirSync(home, { recursive: true })
    run(venvBin('dagster'), ['dev', '--port', '3070', ...rest], { env: { ...process.env, DAGSTER_HOME: home } })
    break
  }
  default:
    console.error('usage: node tools/pipeline.mjs install|test|test:unit|test:db|ingest|runs|approve|reject|dagster [args]')
    process.exit(2)
}
