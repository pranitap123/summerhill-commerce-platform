# Contributing

This repository is a demonstration project (see [README](README.md)). The conventions below keep it consistent and safe.

## First-time setup

```bash
git config core.hooksPath tools/git-hooks                 # secret/data scanner before every commit
npm install && npm install --prefix web/summerhill-commerce
npm run stack:up                                          # Postgres, Elasticsearch, Mailpit (Docker)
npm run db:setup                                          # migrations + synthetic catalogue
cp web/summerhill-commerce/.env.example web/summerhill-commerce/.env   # then add your Stripe TEST key
npm run seed:users --prefix web/summerhill-commerce       # demo admin + customer
npm run dev:stack --prefix web/summerhill-commerce        # http://localhost:3000
```

Stripe keys must be **test** keys (`sk_test_…`); the app refuses to start with a live key.

## Work items

Work is planned in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Every change belongs to a work item ID (e.g. `G2-07`), and new requirements are added to [docs/TRACEABILITY.md](docs/TRACEABILITY.md) first.

## Branches and commits

- Branch names: `<type>/<work-item>-<short-description>`, e.g. `feat/G2-07-checkout-v2`.
- [Conventional commits](https://www.conventionalcommits.org/) with the work item as scope: `feat(G2-07): create pending order before checkout session`.
- One concern per commit; a formatting-only change is its own commit.

## Definition of Done

A work item is done when all of these are true:

- [ ] Acceptance criteria in the plan are met and demonstrated
- [ ] Tests are written; `npm run ci:local` is green
- [ ] New API routes use `route(policy, …)` and appear correctly in the authorisation matrix
- [ ] Money is in integer cents and computed only in `pricing` / `payments`
- [ ] No secrets, and no real merchant data or images
- [ ] Docs/ADRs are updated if behaviour or a decision changed
- [ ] The item is ticked in the plan's tracking table

## Code rules

- **Module boundaries** (ADR-0002): outside a module, import only `@/modules/<name>`, never its internal files. Lint enforces this.
- **Input:** validate every request with zod (`parseJson` / `parseQuery` / `parseParams`). Strict schemas reject unknown keys.
- **Errors:** throw `HttpError(status, CODE, message)`; the route wrapper turns it into the standard error envelope.
- **Config:** read settings through `getConfig()` only; add new variables to the schema and to `.env.example`.
- **Database:** add a new numbered file in `db/migrations`. Never edit an applied migration; the runner refuses changed checksums.
- **Lint ratchet:** files listed in `LEGACY_HOOK_RULE_FILES` (eslint.config.mjs) may only be removed from the list, never added.

## Checks

| Command | What it runs |
|---|---|
| `npm run ci:local` | Everything CI runs: secret scan, docs traceability, fixture freshness, format, lint, typecheck, unit, authz matrix, integration, dependency audit |
| `npm run ci:fast` | The same without integration tests and the audit (no Docker needed) |
| `npm run scan:history` | Secret/data scan of the entire git history |

## Security

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
