"""Command line entry point.

  python -m catalog_pipeline ingest [--connector fixture] [--mode full|delta] [--merchant demo-market]
                                    [--location downtown] [--force]
  python -m catalog_pipeline approve RUN_ID --by NAME     apply a held run
  python -m catalog_pipeline reject RUN_ID --by NAME
  python -m catalog_pipeline runs [--limit 10]
  python -m catalog_pipeline process-requests     carry out approvals/re-runs asked for in /ops (G5-14)

Connection: INGEST_DATABASE_URL (the least-privilege ingest_rw role).
Exit codes: 0 applied/approved, 3 held for approval, 1 failed, 2 usage/configuration error.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from .connectors import ConnectorDisabled, get_connector
from .ingest import IngestError, approve_run, connect, reject_run, run_ingest
from .requests import process_requests
from .settings import settings


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=os.environ.get("PIPELINE_LOG_LEVEL", "WARNING"), format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(prog="catalog_pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    s = settings()

    ingest = sub.add_parser("ingest", help="run one ingest")
    ingest.add_argument("--connector", default=s.connector)
    ingest.add_argument("--mode", choices=["full", "delta"], default="full")
    ingest.add_argument("--merchant", default=s.merchant_slug)
    ingest.add_argument("--location", default=s.location_slug)
    ingest.add_argument("--force", action="store_true", help="skip the anomaly guard (use with care)")

    for name in ("approve", "reject"):
        p = sub.add_parser(name, help=f"{name} a held run")
        p.add_argument("run_id", type=int)
        p.add_argument("--by", required=True, help="who decided (recorded on the run)")
        if name == "approve":
            p.add_argument("--connector", default=s.connector)

    sub.add_parser("process-requests", help="carry out pending requests from /ops (G5-14)")

    runs = sub.add_parser("runs", help="list recent runs")
    runs.add_argument("--limit", type=int, default=10)

    args = parser.parse_args(argv)
    if not s.database_url:
        print("catalog_pipeline: set INGEST_DATABASE_URL (a postgres:// connection string)", file=sys.stderr)
        return 2
    try:
        if args.command == "ingest":
            result = run_ingest(s.database_url, get_connector(args.connector, os.environ), args.merchant, args.location, args.mode, args.force)
            print(json.dumps(result.summary()))
            return {"applied": 0, "approved": 0, "held": 3}.get(result.status, 1)
        if args.command == "approve":
            result = approve_run(s.database_url, args.run_id, args.by, get_connector(args.connector, os.environ))
            print(json.dumps(result.summary()))
            return 0
        if args.command == "process-requests":
            for outcome in process_requests(s.database_url, s.connector, os.environ):
                print(json.dumps(outcome, default=str))
            return 0
        if args.command == "reject":
            reject_run(s.database_url, args.run_id, args.by)
            print(json.dumps({"run_id": args.run_id, "status": "rejected"}))
            return 0
        with connect(s.database_url) as conn:
            rows = conn.execute(
                """SELECT id, connector, mode, status, fetched, inserted, updated, unchanged, deactivated,
                          quarantined, anomalies, started_at::text, duration_ms
                   FROM ops.ingest_runs ORDER BY id DESC LIMIT %s""",
                (args.limit,),
            ).fetchall()
        for r in rows:
            print(json.dumps(r, default=str))
        return 0
    except (ConnectorDisabled, IngestError, ValueError) as exc:
        print(f"catalog_pipeline: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
