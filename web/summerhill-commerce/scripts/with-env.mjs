#!/usr/bin/env node

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
