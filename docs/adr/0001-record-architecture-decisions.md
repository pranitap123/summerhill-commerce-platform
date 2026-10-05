# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-09-27

## Context
The project grew from a scraper into a payments marketplace without written decisions. New contributors can't tell why things are the way they are.

## Decision
We keep Architecture Decision Records in `docs/adr/`, numbered, in this format (Context / Decision / Consequences / Alternatives). Status is one of: Proposed, Accepted, Superseded by ADR-NNNN, Rejected. Decisions touching money, auth, PII or a new external integration require an ADR before code.

## Consequences
A small writing overhead; a durable record for reviews, audits and onboarding.
