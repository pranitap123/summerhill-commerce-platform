## Work item

<!-- e.g. G2-07: Checkout v2. Link the line in docs/IMPLEMENTATION_PLAN.md -->

## What changed and why

## How it was tested

- [ ] `npm run ci:local` green
- [ ] New/changed behaviour covered by tests (list them)
- [ ] Manually verified (describe)

## Checklist

- [ ] Acceptance criteria met
- [ ] New API routes wrapped with `route(policy, …)`; authorisation matrix passes
- [ ] Money in integer cents, computed only in `pricing` / `payments`
- [ ] No secrets, no real merchant data or images
- [ ] Migrations are new files (no edits to applied migrations)
- [ ] Docs/ADRs and the plan's tracking table updated
