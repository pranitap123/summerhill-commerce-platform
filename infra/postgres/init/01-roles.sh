#!/bin/sh
# Runs once, when the Postgres volume is first created.
#  - creates the least-privilege login roles (ADR-0004); the POSTGRES_USER superuser acts as the
#    "migrator", and schemas/grants in the marketplace database come from /db/migrations
#  - creates a separate `payload` database for Payload CMS (users, pages, media), owned by app_rw
#    so Payload can manage its own tables; other roles can't connect to it (it holds credentials)
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE app_rw     LOGIN PASSWORD '${APP_DB_PASSWORD}';
CREATE ROLE ingest_rw  LOGIN PASSWORD '${INGEST_DB_PASSWORD}';
CREATE ROLE readonly   LOGIN PASSWORD '${READONLY_DB_PASSWORD}';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO app_rw, ingest_rw, readonly;

CREATE DATABASE payload OWNER app_rw;
REVOKE ALL ON DATABASE payload FROM PUBLIC;
SQL
