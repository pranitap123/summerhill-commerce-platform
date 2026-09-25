import subprocess
import os
from dagster import job, op

DAGSTER_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(DAGSTER_DIR, '..', 'scripts')

@op
def load_products_from_json():
    """Read scraped.json and load into Postgres"""
    script_path = os.path.join(SCRIPTS_DIR, 'load-data.js')
    result = subprocess.run(['node', script_path], capture_output=True, text=True, cwd=SCRIPTS_DIR)
    print("STDOUT:", result.stdout)
    print("STDERR:", result.stderr)
    print("Return code:", result.returncode)
    if result.returncode != 0:
        raise Exception(f"load-data.js failed with code {result.returncode}. stdout: {result.stdout} stderr: {result.stderr}")
    return "Products loaded into Postgres"

@op
def index_products_in_elasticsearch(upstream_result):
    """Load products from Postgres into Elasticsearch. Depends on upstream_result to run after load_products_from_json."""
    script_path = os.path.join(SCRIPTS_DIR, 'load-elasticsearch.js')
    result = subprocess.run(['node', script_path], capture_output=True, text=True, cwd=SCRIPTS_DIR)
    print("STDOUT:", result.stdout)
    print("STDERR:", result.stderr)
    print("Return code:", result.returncode)
    if result.returncode != 0:
        raise Exception(f"load-elasticsearch.js failed with code {result.returncode}. stdout: {result.stdout} stderr: {result.stderr}")
    return "Products indexed in Elasticsearch"

@job
def ingest_pipeline():
    """Full data ingestion pipeline: Postgres -> Elasticsearch"""
    postgres_result = load_products_from_json()
    index_products_in_elasticsearch(postgres_result)