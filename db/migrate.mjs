#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_ID = 727_001;
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('migrate: set MIGRATION_DATABASE_URL (or DATABASE_URL)');
  process.exit(2);
}

function loadMigrations() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set();
  return files.map((file) => {
    const m = file.match(/^(\d{3})_[a-z0-9_]+\.sql$/);
    if (!m) throw new Error(`bad migration file name: ${file} (expected NNN_snake_case.sql)`);
    if (seen.has(m[1])) throw new Error(`duplicate migration number ${m[1]}`);
    seen.add(m[1]);

    const sql = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
    return { id: file.replace(/\.sql$/, ''), sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
  });
}

async function main() {
  const mode = process.argv[2] || 'up';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    const applied = new Map((await client.query('SELECT id, checksum FROM public.schema_migrations')).rows.map((r) => [r.id, r.checksum]));
    const migrations = loadMigrations();

    for (const [id] of applied) {
      if (!migrations.some((m) => m.id === id)) throw new Error(`applied migration ${id} is missing from db/migrations`);
    }
    for (const m of migrations) {
      if (applied.has(m.id) && applied.get(m.id) !== m.checksum)
        throw new Error(`migration ${m.id} was edited after being applied (checksum mismatch). Add a new migration instead.`);
    }

    const pending = migrations.filter((m) => !applied.has(m.id));
    if (mode === 'status') {
      for (const m of migrations) console.log(`${applied.has(m.id) ? 'applied' : 'PENDING'}  ${m.id}`);
      return;
    }
    if (mode !== 'up') throw new Error(`unknown mode ${mode}`);
    if (!pending.length) {
      console.log('migrate: up to date');
      return;
    }
    for (const m of pending) {
      process.stdout.write(`migrate: ${m.id} ... `);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO public.schema_migrations (id, checksum) VALUES ($1, $2)', [m.id, m.checksum]);
        await client.query('COMMIT');
        console.log('ok');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error(`migrate: ${err.message}`);
  process.exit(1);
});
