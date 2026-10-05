-- Schemas per module and least-privilege grants (ADR-0004, SYSTEM_DESIGN §5.1).
-- Login roles app_rw / ingest_rw / readonly are created outside migrations (they carry passwords):
-- locally by infra/postgres/init/01-roles.sh. Grants below are skipped for roles that don't exist,
-- so this migration also runs against a database without them (e.g. an older local database).

CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS merchant;
CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS ops;
-- Payload (users, pages, media) lives in its own database, not a schema here: Payload's
-- schemaName option is experimental and breaks when table names repeat across schemas
-- (Payload's `categories` vs catalog.categories). See ADR-0004.

-- Shared trigger function: keep updated_at current.
CREATE OR REPLACE FUNCTION ops.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  s text;
BEGIN
  -- app_rw: the web app and worker
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT USAGE ON SCHEMA catalog, merchant, commerce, finance, ops TO app_rw;
    GRANT EXECUTE ON FUNCTION ops.set_updated_at() TO app_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA catalog GRANT SELECT ON TABLES TO app_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA merchant GRANT SELECT, INSERT, UPDATE ON TABLES TO app_rw;
    FOREACH s IN ARRAY ARRAY['commerce', 'finance', 'ops'] LOOP
      -- finance.ledger_entries is narrowed to INSERT-only by its own migration (G2-01).
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw', s);
    END LOOP;
    FOREACH s IN ARRAY ARRAY['catalog', 'merchant', 'commerce', 'finance', 'ops'] LOOP
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO app_rw', s);
    END LOOP;
  END IF;

  -- ingest_rw: the catalogue pipeline writes the catalog schema only
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest_rw') THEN
    GRANT USAGE ON SCHEMA catalog, merchant, ops TO ingest_rw;
    GRANT EXECUTE ON FUNCTION ops.set_updated_at() TO ingest_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA catalog GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ingest_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA catalog GRANT USAGE, SELECT ON SEQUENCES TO ingest_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA merchant GRANT SELECT ON TABLES TO ingest_rw;
  END IF;

  -- readonly: reporting and support queries (no access to the Payload database, which holds credentials and PII)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly') THEN
    GRANT USAGE ON SCHEMA catalog, merchant, commerce, finance, ops TO readonly;
    FOREACH s IN ARRAY ARRAY['catalog', 'merchant', 'commerce', 'finance', 'ops'] LOOP
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO readonly', s);
    END LOOP;
  END IF;
END;
$$;
