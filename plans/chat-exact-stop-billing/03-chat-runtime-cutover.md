# Plan 03 — Chat Runtime Cutover

**Depends on:** 02 being merged.

## Goal

Cut chat billing over from finish-only `usageHandler` semantics to exact provider-authoritative reconciliation, covering both normally finished and user-stopped generations.

## Scope

In scope:

- `convex/chat/agent.ts`
- `convex/chat/messages.ts`
- any new runtime helper needed to capture generation id and trigger reconciliation
- chat billing tests and runtime verification

Out of scope:

- redesigning the user-facing stopped-message UX,
- non-chat billing domains,
- changing the product’s markup / rounding policy.

## Design

1. **Move chat billing authority out of the current finish-only path.**
   The current `usageHandler` contract is insufficient for exact stopped-turn billing. This plan should either:
   - disable direct chat charging in `usageHandler`, or
   - reduce it to non-authoritative observation only,
   while authoritative charging happens through reconciliation.

2. **Trigger reconciliation for both finish and stop.**
   Every chat generation should end with one of:
   - authoritative usage fetched and billed,
   - authoritative usage fetch queued / retried,
   - explicit blocker/error state if the authoritative source is unavailable.

3. **Capture the generation id in the real chat runtime.**
   The runtime path proven in plan 01 must be wired into production chat generation, not left as a test-only probe.

4. **Keep stop UX separate from billing timing.**
   The user should see “stopped” immediately from the existing stop contract, while exact billing can reconcile asynchronously if provider stats arrive slightly later.

5. **Preserve single-charge semantics across all exits.**
   Normal finish, user stop, retried reconciliation, and repeated callbacks must converge on one billed generation.

## TDD Sequence

Phase A — helper first:

1. Add a small helper for deciding runtime reconciliation trigger / retry behavior.
2. Test:
   - finished generation triggers reconciliation,
   - stopped generation triggers reconciliation,
   - duplicate trigger is harmless when the ledger already exists.

Phase B — runtime:

1. Wire generation id capture into the live chat action path.
2. Replace or neutralize finish-only charging in `usageHandler`.
3. Trigger authoritative reconciliation on finish and stop.
4. Add / update integration tests for:
   - normal billed completion,
   - exact billed stopped generation,
   - idempotent repeated stop / retry flows.
5. Run the affected chat + credits test slices.

## Files Touched

- [convex/chat/agent.ts](../../convex/chat/agent.ts)
- [convex/chat/messages.ts](../../convex/chat/messages.ts)
- new reconciliation runtime helpers under `convex/chat/`
- [convex/chat/messages.test.ts](../../convex/chat/messages.test.ts)
- additional chat billing tests as needed

## Migration Stance

None beyond the additive ledger introduced in 02.

## Test Plan

- Unit:
  - runtime reconciliation trigger helper
- Convex integration:
  - normal finish bills exactly once from authoritative usage
  - user stop bills exactly once from authoritative usage
  - repeated stop / retry / re-run does not double-charge
  - credit transaction metadata references the authoritative generation id
- Runtime smoke:
  - send a chat message and let it finish
  - send a chat message and stop it mid-stream
  - confirm both paths reconcile exact usage and charge once

## Acceptance Criteria

- Chat no longer depends on finish-only `usageHandler` semantics for authoritative billing.
- Finished and stopped generations both bill exactly once from provider-authoritative stats.
- Credit balances and transactions reflect authoritative usage.
- No duplicate charge occurs on retries or duplicate triggers.
- Relevant tests are green.
- TypeScript / Convex compilation is green and the running Convex dev server loads the new code.

## Known Pitfalls

- Do not leave both old and new charging active at once.
- Do not block the stopped-message UX on provider reconciliation latency.
- Do not assume the generation id is always available at finish time only; stopped runs need it earlier.
- Do not treat “some credits were charged” as sufficient proof of exactness.
