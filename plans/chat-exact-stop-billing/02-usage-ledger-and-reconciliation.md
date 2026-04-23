# Plan 02 — Usage Ledger And Reconciliation

**Depends on:** 01 being merged. **Blocks:** 03.

## Goal

Add an idempotent raw usage ledger and reconciliation path for chat generations so exact provider-authoritative usage can be stored once and billed once.

## Scope

In scope:

- `convex/schema.ts`
- new Convex modules for chat usage reconciliation and raw usage storage
- `convex/credits/internal.ts` integration points if needed
- tests for idempotent reconciliation and one-time deduction

Out of scope:

- changing how the live stop button works,
- UI changes,
- full chat runtime cutover from `usageHandler`.

## Design

1. **Introduce a raw chat generation usage ledger keyed by provider generation id.**
   This table owns authoritative usage/cost facts, separate from user-facing message docs and separate from aggregated credit balances.

2. **Separate “usage recorded” from “credits deducted.”**
   The ledger row should make billing state explicit, for example:
   - generation id,
   - job/thread/user linkage,
   - authoritative usage fields,
   - cancelled flag,
   - billing status / deducted-at marker,
   - source metadata for audit.

3. **Idempotency is first-class.**
   Re-fetching the same generation stats or retrying reconciliation must not double-deduct credits.

4. **Reuse the existing credit math and credit ledger path.**
   Once authoritative usage is normalized, pass it through the existing pricing / markup logic and `deductCredits` mutation. Do not fork billing math.

5. **Make reconciliation retryable.**
   Generation stats may not be queryable immediately at the instant stop occurs. Reconciliation should support retry without duplicate charge risk.

## TDD Sequence

Phase A — pure logic first:

1. Add a billing-state / idempotency helper that decides whether a ledger row can deduct.
2. Test:
   - first reconciliation deducts,
   - repeated reconciliation with same generation id does not deduct,
   - invalid / incomplete usage rows do not deduct.

Phase B — schema + integration:

1. Add the raw usage ledger table and indexes.
2. Add reconciliation mutations / internal actions.
3. Add integration tests for:
   - insert authoritative usage row,
   - deduct exactly once,
   - retry after transient provider fetch delay,
   - cancelled generation still bills once from authoritative stats.

## Files Touched

- [convex/schema.ts](../../convex/schema.ts)
- new chat usage reconciliation modules under `convex/chat/`
- [convex/credits/internal.ts](../../convex/credits/internal.ts) only if a small shared helper extraction is justified
- new tests for schema-backed reconciliation behavior

## Migration Stance

Additive schema only in this plan, but dev data is disposable if the shape changes during execution.

## Test Plan

- Unit:
  - billing-state / idempotency helper
- Convex integration:
  - authoritative usage row creation
  - one-time credit deduction
  - repeated reconciliation no-op
  - cancelled usage row still charges exactly once
- Ledger verification:
  - credit transaction metadata clearly points back to generation id / billing source

## Acceptance Criteria

- A raw usage ledger exists for chat generations.
- Billing reconciliation is keyed by provider generation id and is idempotent.
- Existing credit math is reused, not duplicated.
- Cancelled generations can be stored and billed from authoritative stats.
- Relevant tests are green.
- TypeScript / Convex compilation is green.

## Known Pitfalls

- Do not store exact billing state only in `creditTransactions.metadata`; that is not strong enough for idempotent reconciliation.
- Do not couple reconciliation success to message finalization success.
- Do not duplicate credit math already centralized in the repo.
- Do not leave the ledger shape underspecified; retries and audits depend on it.
