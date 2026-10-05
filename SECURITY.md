# Security policy

## Scope

This is a demonstration project. It runs in Stripe **test mode** only and must never be configured with live payment keys or real customer data.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private vulnerability reporting instead: on the repository page, go to **Security → Report a vulnerability**. Include:
- the affected file or route
- steps to reproduce
- the impact you expect

You'll get an acknowledgement within 7 days.

## What we already guard against

- **Secret and data scanning:** a pre-commit hook (`tools/git-hooks/pre-commit` → `tools/scan-secrets.mjs`) blocks:
  - Stripe keys, webhook secrets, cloud keys, private keys and hard-coded credentials
  - `.env` files
  - scraped or real merchant data
- **History scan before publishing:** run `node tools/scan-secrets.mjs --history`.

The threat model and planned controls are in [docs/SECURITY_AND_COMPLIANCE.md](docs/SECURITY_AND_COMPLIANCE.md).

## For contributors

After cloning, enable the hook once:

```bash
git config core.hooksPath tools/git-hooks
```
