#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog.fixture.json');
const url = process.env.SEED_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('seed: set SEED_DATABASE_URL (or MIGRATION_DATABASE_URL / DATABASE_URL)');
  process.exit(2);
}
if (!fs.existsSync(FIXTURE)) {
  console.error('seed: fixture missing; run `node db/seed/generate.mjs` first');
  process.exit(2);
}
const { merchant, location } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const PIPELINE = path.join(path.dirname(FIXTURE), '..', '..', 'pipeline');

function pipelinePython() {
  if (process.env.PIPELINE_PYTHON) return process.env.PIPELINE_PYTHON;
  const venv = path.join(PIPELINE, '..', '.venv');
  const exe = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
  if (!fs.existsSync(exe)) {
    console.error('seed: Python virtualenv missing. Run `npm run pipeline:install` first.');
    process.exit(2);
  }
  return exe;
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('BEGIN');
  const m = await client.query(
    `INSERT INTO merchant.merchants (slug, name, min_order_cents, hst_registration_number)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, min_order_cents = EXCLUDED.min_order_cents,
       hst_registration_number = EXCLUDED.hst_registration_number
     RETURNING id`,

    [merchant.slug, merchant.name, merchant.min_order_cents ?? 0, '000000000RT0001'],
  );
  const merchantId = m.rows[0].id;
  const l = await client.query(
    `INSERT INTO merchant.locations (merchant_id, slug, name, address_line1, city, province, postal_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (merchant_id, slug) DO UPDATE SET name = EXCLUDED.name, address_line1 = EXCLUDED.address_line1,
       city = EXCLUDED.city, province = EXCLUDED.province, postal_code = EXCLUDED.postal_code
     RETURNING id`,
    [merchantId, location.slug, location.name, location.address_line1, location.city, location.province, location.postal_code],
  );

  await client.query(
    'INSERT INTO merchant.location_settings (location_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [l.rows[0].id],
  );
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  console.error(`seed: ${err.message}`);
  process.exitCode = 1;
}
if (!process.exitCode) {

  const ingestUrl = process.env.INGEST_DATABASE_URL || url;
  const r = spawnSync(pipelinePython(), ['-m', 'catalog_pipeline', 'ingest', '--connector', 'fixture', '--mode', 'full',
    '--merchant', merchant.slug, '--location', location.slug], {
    cwd: PIPELINE, env: { ...process.env, INGEST_DATABASE_URL: ingestUrl, CATALOG_FIXTURE_PATH: FIXTURE }, encoding: 'utf8',
  });
  if (r.error || r.status !== 0) {
    console.error(`seed: catalogue ingest failed (${r.error?.message ?? `exit ${r.status}`})
${r.stdout ?? ''}${r.stderr ?? ''}`);
    process.exitCode = 1;
  } else console.log(`seed: ingest ${r.stdout.trim()}`);
}
try {
  const counts = await client.query(`SELECT
      (SELECT count(*) FROM catalog.categories) AS categories,
      (SELECT count(*) FROM catalog.subcategories) AS subcategories,
      (SELECT count(*) FROM catalog.products) AS products,
      (SELECT count(*) FROM catalog.promotions) AS promotions`);
  console.log(`seed: merchant "${merchant.name}"`, counts.rows[0]);
} finally {
  await client.end();
}
