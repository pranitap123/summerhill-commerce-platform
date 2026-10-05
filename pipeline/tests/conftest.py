"""Shared fixtures. DB tests use a throwaway database in the compose Postgres (npm run stack:up),
migrated with db/migrate.mjs, and run the pipeline as the least-privilege ingest_rw role."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REPO_ROOT = Path(__file__).resolve().parents[2]
ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgres://grocery_admin:local_dev_only@127.0.0.1:5433/grocery")
ROLE_PASSWORD = os.environ.get("TEST_ROLE_PASSWORD", "local_dev_only")


def with_db(url: str, db: str, user: str | None = None) -> str:
    parts = urlsplit(url)
    netloc = parts.netloc
    if user:
        host = netloc.rsplit("@", 1)[-1]
        netloc = f"{user}:{ROLE_PASSWORD}@{host}"
    return urlunsplit((parts.scheme, netloc, f"/{db}", parts.query, parts.fragment))


class TestDb:
    def __init__(self, name: str):
        self.name = name
        self.admin_url = with_db(ADMIN_URL, name)
        self.ingest_url = with_db(ADMIN_URL, name, "ingest_rw")
        self.app_url = with_db(ADMIN_URL, name, "app_rw")

    def sql(self, text: str, params=(), url: str | None = None):
        with psycopg.connect(url or self.admin_url, autocommit=True) as conn:
            cur = conn.execute(text, params)
            return cur.fetchall() if cur.description else cur.rowcount


def _create_db(prefix: str) -> TestDb:
    name = f"{prefix}_{os.getpid()}_{int(time.time() * 1000)}"
    try:
        with psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=5) as conn:
            conn.execute(f"CREATE DATABASE {name}")
            conn.execute(f"GRANT CONNECT ON DATABASE {name} TO app_rw, ingest_rw, readonly")
    except psycopg.OperationalError as exc:
        pytest.fail(f"compose Postgres unreachable ({exc}); run `npm run stack:up`", pytrace=False)
    db = TestDb(name)
    subprocess.run(
        ["node", str(REPO_ROOT / "db" / "migrate.mjs")],
        env={**os.environ, "MIGRATION_DATABASE_URL": db.admin_url},
        check=True,
        capture_output=True,
    )
    db.sql(
        """INSERT INTO merchant.merchants (slug, name) VALUES ('demo-market', 'Demo Market');
           INSERT INTO merchant.locations (merchant_id, slug, name)
           SELECT id, 'downtown', 'Demo Market Downtown' FROM merchant.merchants WHERE slug = 'demo-market';"""
    )
    return db


def _drop_db(db: TestDb) -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {db.name} WITH (FORCE)")


@pytest.fixture
def db():
    """A fresh migrated database with the demo merchant and location (no products)."""
    d = _create_db("pipeline_it")
    yield d
    _drop_db(d)
