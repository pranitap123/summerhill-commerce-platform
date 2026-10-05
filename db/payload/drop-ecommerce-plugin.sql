-- One-time cleanup of the Payload database after the ecommerce plugin was removed (G2-15, ADR-0003).
-- Needed only for Payload databases created BEFORE G2; a fresh database never has these objects.
--
--   npm run payload:cleanup        (root; runs against the compose stack's payload database)
--
-- Why: in development Payload syncs its schema with drizzle "push". With the plugin's old enums
-- still present, push can't tell a new enum from a renamed one and stops at an interactive prompt,
-- which hangs the dev server (seen on /admin). Dropping the plugin's leftovers first lets push run
-- unattended. Idempotent; refuses to run if any of the plugin's tables still hold data.

DO $$
DECLARE
  t text;
  n bigint;
  e text;
  c record;
  plugin_tables text[] := ARRAY[
    'products', 'variants', 'variant_options', 'variant_types', 'carts', 'orders',
    'transactions', 'addresses'];
BEGIN
  FOREACH t IN ARRAY plugin_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'table % still has % rows; export or delete them before running this cleanup', t, n;
      END IF;
    END IF;
  END LOOP;

  -- Relationship columns pointing at the plugin's collections
  FOR c IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name ~ '^(products|variants|variant_options|variant_types|carts|orders|transactions|addresses)_id$'
      AND table_name !~ '(products|variant|carts|orders|transactions|addresses)'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS %I CASCADE', c.table_name, c.column_name);
  END LOOP;

  -- The plugin's collections (with versions) and the removed product blocks
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND (tablename ~ '^_?(products|variants|variant_options|variant_types|carts|orders|transactions|addresses)(_|$)'
           OR tablename ~ 'blocks_(archive|carousel|three_item_grid)')
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t);
  END LOOP;

  FOR e IN
    SELECT typname FROM pg_type t JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = 'public' AND t.typtype = 'e'
      AND typname ~ '^enum__?(products|variants|carts|orders|transactions|addresses)_|blocks_(archive|carousel|three_item_grid)'
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', e);
  END LOOP;
END;
$$;
