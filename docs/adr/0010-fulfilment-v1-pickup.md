# ADR-0010: Pilot fulfilment is store pickup; delivery through a courier API in v1.1

- Status: Accepted (implemented in G4, 2026-09-28)
- Date: 2026-09-27

## Context
Delivery adds address validation, zones, fees, tips, courier dispatch, cold-chain timing, and more liability scenarios. None of it is needed to validate the core loop (order → merchant fulfils → customer receives → money settles correctly).

## Decision
- v1.0 pilot: **pickup at the merchant**, with time slots, capacity and a pickup-code handover.
- v1.1: local delivery through a courier API (Uber Direct / DoorDash Drive), booked at `ready`; our own drivers are not considered.
- The data model includes `fulfilment_type` from day one so delivery is additive.

## Consequences
- \+ Cuts ~4–6 engineer-weeks and major operational risk from the pilot.
- − A smaller addressable audience during the pilot; validated explicitly ([PRD §7](../product/PRD.md#7-assumptions-to-validate-during-the-pilot)).

## Implementation (G4)
- `commerce.orders.fulfilment_type` exists with the single value `pickup`; slots, holds and the pickup-code handover are in migration 007.
- Deviations from the fulfilment design are listed in [ORDERS §13](../domains/ORDERS_AND_FULFILMENT.md#13-implementation-notes-g4).
