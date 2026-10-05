# RB-13 Rotate secrets

When: on a schedule (database credentials quarterly, [SECURITY §8](../SECURITY_AND_COMPLIANCE.md#8-infrastructure-security)), when someone with access leaves, or **at once** after a leak (a secret in a commit, a log or a screenshot). After a leak, rotate first and investigate afterwards.

Secrets live in the deployment's secret manager (locally: `web/summerhill-commerce/.env`; `stack.env` and `infra/local.env` hold local-only defaults that are not secrets). The app validates them at startup and refuses a live Stripe key.

| Secret | Used for | What a rotation breaks | Order of steps |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | All Stripe calls | Nothing, if the new key is in place before the old one is revoked | Stripe dashboard → roll key (keeps the old one valid for a while) → deploy new → confirm → expire old |
| `STRIPE_WEBHOOKS_SIGNING_SECRET`, `STRIPE_CONNECT_WEBHOOKS_SIGNING_SECRET` | Verifying webhooks | Events signed with the old secret are rejected (Stripe retries them) | Roll the endpoint secret in Stripe → deploy the new value within the overlap → check deliveries. Missed events: [RB-03](RB-03-webhook-replay.md) |
| `PAYLOAD_SECRET` | Payload sessions; HKDF keys for cart cookies, guest order links, revalidation, the MFA cookie **and the encrypted TOTP secrets** | Everyone is signed out; guest carts and emailed order links stop working (customers use *Find my order*); **staff are locked out of two-step verification until the TOTP secrets are re-encrypted** | See below |
| Database passwords (`app_rw`, `ingest_rw`, readonly, admin) | App, worker, pipeline, migrations | Connections with the old password fail | Below |
| SMTP password | Email | Emails retry, then dead-letter | Set new at the provider → deploy |

## PAYLOAD_SECRET

1. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Deploy the app and the worker with the new `PAYLOAD_SECRET`, and with the old value as `PAYLOAD_SECRET_PREVIOUS` for the next step only.
3. Re-encrypt the staff TOTP secrets, or no staff member can pass two-step verification:

   ```bash
   app: npm run ops -- mfa:reencrypt --by "your name"
   # mfa: 6 re-encrypted, 0 already current, 0 unreadable
   ```

   Safe to run twice. Anyone listed as *unreadable* needs **Reset MFA** in `/ops/users` and enrols again at the next sign-in.
4. Remove `PAYLOAD_SECRET_PREVIOUS`.
5. Tell support that customers were signed out and old order links need *Find my order*.

## Database passwords

```sql
-- as the admin role, for each role; the app keeps working on the old password until restarted
ALTER ROLE app_rw PASSWORD '<new>';
```

Update the connection strings (`DATABASE_URL`, `CATALOG_DATABASE_URL`, `INGEST_DATABASE_URL`, …) and restart app, worker and pipeline. Existing pooled connections survive until they're recycled; new ones use the new password. Locally the defaults come from `infra/docker-compose.yml`.

## After a leak

- Check the audit log (`/ops/audit`) and Stripe's logs for use of the leaked secret.
- If it was committed: rotate, then remove it from history (the pre-publish checklist's history rewrite), and keep the scanner hook on (`tools/git-hooks`, `npm run scan:history`).

Walked through 2026-09-29 on the local stack, for `PAYLOAD_SECRET` (set in the process environment, `.env` unchanged): with a new secret, none of the 5 demo staff TOTP secrets could be read (`0 already current`), which is the lock-out; `mfa:reencrypt` re-encrypted all 5; a second run changed nothing; rotating back to the original secret the same way restored the original state. The re-encryption is unit-tested (`tests/unit/secretRotation.test.ts`). Stripe and database rotations were not rehearsed (read-through only).
