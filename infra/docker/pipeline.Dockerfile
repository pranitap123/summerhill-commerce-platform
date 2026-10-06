# Python catalogue pipeline (Dagster) plus the Node migration and seed scripts, used by the
# `init` and `dagster` services in infra/docker-compose.yml. Build context: the repo root.
FROM python:3.13-slim-bookworm
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:20-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /app
COPY pipeline/requirements.txt pipeline/requirements.txt
RUN pip install --no-cache-dir -r pipeline/requirements.txt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY db db
COPY pipeline pipeline
ENV PIPELINE_PYTHON=/usr/local/bin/python \
    DAGSTER_HOME=/app/.dagster
RUN mkdir -p /app/.dagster
WORKDIR /app/pipeline
EXPOSE 3070
CMD ["dagster", "dev", "--host", "0.0.0.0", "--port", "3070"]
