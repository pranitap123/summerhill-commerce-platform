#!/usr/bin/env node
// Runs a Node CLI with extra env files whose values override the shell and .env files. Several
// files can be given comma-separated; later files win.
//   node scripts/with-env.mjs stack.env ./node_modules/next/dist/bin/next dev
//   node scripts/with-env.mjs stack.env,simulator.env ./node_modules/next/dist/bin/next dev
//
// Why not `node --env-file`: the Next.js and Payload CLIs forward Node flags to child processes
// through NODE_OPTIONS, where --env-file is not allowed. Variables not set in the file (e.g. your
// Stripe TEST key) still come from .env as usual.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import dotenv from 'dotenv'

const [envFile, entry, ...args] = process.argv.slice(2)
if (!envFile || !entry) {
  console.error('usage: node scripts/with-env.mjs <env-file> <node-entry-script> [args...]')
  process.exit(2)
}
const overrides = {}
for (const file of envFile.split(',')) {
  const envPath = path.resolve(file)
  if (!fs.existsSync(envPath)) {
    console.error(`with-env: ${file} not found`)
    process.exit(2)
  }
  Object.assign(overrides, dotenv.parse(fs.readFileSync(envPath)))
}
const dotEnv = path.resolve('.env')
const base = fs.existsSync(dotEnv) ? dotenv.parse(fs.readFileSync(dotEnv)) : {}
const child = spawn(process.execPath, [entry, ...args], {
  stdio: 'inherit',
  env: { ...base, ...process.env, ...overrides },
})
const forward = (signal) => child.kill(signal)
process.on('SIGINT', forward)
process.on('SIGTERM', forward)
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
