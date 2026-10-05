#!/usr/bin/env node
// Runs db/payload/drop-ecommerce-plugin.sql against the local Payload database (G2-15).
//   npm run payload:cleanup
// PAYLOAD_ADMIN_DATABASE_URL overrides the compose default.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const url =
  process.env.PAYLOAD_ADMIN_DATABASE_URL ||
  'postgres://grocery_admin:local_dev_only@127.0.0.1:5433/payload'
const sql = fs.readFileSync(path.join(ROOT, 'db/payload/drop-ecommerce-plugin.sql'), 'utf8')

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query(sql)
  console.log('payload:cleanup: ecommerce plugin leftovers removed (or none were present)')
} catch (err) {
  console.error(`payload:cleanup: ${err.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
