# RB-16 Privacy request (access or deletion)

When: a person asks for a copy of their data or for it to be deleted (PIPEDA, [SECURITY §7](../SECURITY_AND_COMPLIANCE.md#7-data-protection-and-privacy)). Respond within 30 days.

Signed-in customers can do both themselves from their account page (download my data, delete my account). This runbook is for requests by email.

## 1. Verify the requester

Only act for the account holder. Reply to the email address on the account (not a new address) and ask them to confirm. Don't send data to any other address.

## 2. Act

`/ops/privacy` (admin), with the account's email:

- **Export:** downloads JSON with the account, orders (lines, ratings), support issues and the emails we sent. Send it to the verified address.
- **Delete:** the account is anonymised and closed (signed out everywhere, MFA removed); orders stay for 7 years for tax records, with the email replaced by `deleted-<id>@anonymised.invalid` and the pickup name, notes and rating comments removed; carts are detached; issue descriptions are removed. It can't be undone.

Staff accounts can't be deleted until their staff roles and store memberships are removed (`/ops/users`).

Both are recorded in `ops.privacy_requests` (a hash of the email, never the data) and the audit log.

## 3. Things outside the database

- **Stripe** keeps payment records under its own legal obligations; we don't delete them. Say so in the reply.
- **Mailpit / the email provider** keeps sent mail per its retention.
- **Backups** expire on their schedule (30 days). A database restored from before the deletion brings the data back, and `ops.privacy_requests` (restored too, and holding only a hash) can't tell you whose it was. So keep the request itself (the email thread or ticket) until the backups have expired, and after a restore ([RB-14](RB-14-restore-database.md)) re-run the deletions made since the restore point.

## 4. Reply

Confirm what was done and what is kept and why (tax records, Stripe).

Walked through 2026-09-29: export and deletion are exercised end to end in `tests/integration/backoffice.test.ts` (including the refusal for staff accounts).
