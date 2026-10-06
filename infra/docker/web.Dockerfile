# Next.js + Payload app, used for the web, worker and init services in infra/docker-compose.yml.
# Build context: web/summerhill-commerce. Builds with webpack (Turbopack's production build stalls on
# small machines) and with the payment simulator enabled, so no Stripe account is needed.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
ENV NPM_CONFIG_FETCH_RETRIES=6 NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=5000 NPM_CONFIG_FETCH_TIMEOUT=300000 NPM_CONFIG_MAXSOCKETS=6 NODE_OPTIONS=--dns-result-order=ipv4first
RUN npm ci

# Fast type check from a clean install: docker build --target typecheck (minutes, not the full build)
FROM deps AS typecheck
WORKDIR /app
COPY . .
RUN ./node_modules/.bin/tsc --noEmit

FROM deps AS build
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_SERVER_URL=http://localhost:3000
ENV NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL} \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS="--no-deprecation --max-old-space-size=3072" \
    PAYMENT_PROVIDER=simulator \
    ALLOW_PAYMENT_SIMULATOR=true \
    PAYLOAD_SECRET=build-only-not-a-secret \
    STRIPE_SECRET_KEY=sk_test_placeholder_not_used_by_simulator \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/payload \
    CATALOG_DATABASE_URL=postgres://build:build@127.0.0.1:5432/grocery
RUN ./node_modules/next/dist/bin/next build --webpack

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS="--no-deprecation"
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "./node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]
