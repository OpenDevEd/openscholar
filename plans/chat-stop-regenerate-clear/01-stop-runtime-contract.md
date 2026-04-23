# Plan 01 — Stop Runtime Contract

**Depends on:** nothing. **Blocks:** 02, 03.

## Goal

Make the existing stop path behave as a trustworthy runtime contract inside the current Convex action architecture:

- click stop,
- provider call is aborted through `AbortSignal`,
- aborted state is durable and singular,
- no duplicate aborted artifacts are created for one stop event,
- the runtime race window is explicitly tightened and tested.

This plan does **not** change regenerate or clear-history. It only stabilizes stop semantics so later plans can safely replace or purge a stopped turn.

## Scope

In scope:

- `convex/chat/messages.ts`
- `lib/chat/abort-poller.ts`
- `lib/chat/abort-signal.ts`
- `convex/chat/messages.test.ts`
- one small pure helper test surface around stop polling / stop-state invariants if needed

Out of scope:

- clear-history implementation,
- regenerate implementation,
- message-list UI rendering,
- chat thread deletion,
- architectural rewrite away from Convex actions.

## Design

1. **Keep `AbortSignal` as the real stop primitive.**
   The action must continue to abort the upstream provider request through `paperChat.streamText(..., { abortSignal })`. Do not replace this with stream-row mutation only.

2. **Retain poll bridging, but tighten it deliberately.**
   The current architecture requires the running action to discover stop intent by reading shared state. This plan should reduce the runtime slack from the current `500ms` cadence if test and runtime evidence support it, but it should not pretend polling can be eliminated without changing architecture.

3. **Make stop singular.**
   A single stop event must result in at most one aborted logical turn and at most one surviving aborted stream artifact for that turn. No duplicate aborted stream rows on repeat clicks.

4. **Treat abort as non-error transport completion.**
   The action should keep its current distinction between user-stop and genuine provider failure. Stopped runs should not fall through ordinary failure handling.

5. **Harden observability.**
   The runtime should emit enough structured logging / test-visible state to explain whether a stop was seen, when it was applied, and whether cleanup ran.

## TDD Sequence

Phase A — pure logic first:

1. Add or extend unit tests for [lib/chat/abort-poller.ts](../../lib/chat/abort-poller.ts):
   - fires once when flag becomes true,
   - stops polling cleanly,
   - ignores read failures,
   - remains idempotent under rapid repeated truthy reads.
2. If the stop cadence or once-only behavior needs refactoring, do that here first.

Phase B — integration:

1. Write a red Convex test that asserts the chosen tighter stop contract:
   - stop intent is observed within the new target cadence,
   - no second aborted stream appears on repeated stop clicks,
   - lock cleanup still clears `isGenerating`, `shouldAbort`, and `generatingStartedAt`.
2. Update `generateResponse`.
3. Run the abort integration tests plus adjacent chat tests.

## Files Touched

- [lib/chat/abort-poller.ts](../../lib/chat/abort-poller.ts)
- [lib/chat/abort-signal.ts](../../lib/chat/abort-signal.ts) if sentinel wiring needs minor cleanup only
- [convex/chat/messages.ts](../../convex/chat/messages.ts)
- [convex/chat/messages.test.ts](../../convex/chat/messages.test.ts)

## Migration Stance

None.

## Test Plan

- Unit:
  - `abort-poller` once-only behavior
  - `abort-poller` cleanup behavior
- Convex integration:
  - stop aborts the active request
  - repeated stop clicks remain idempotent
  - aborted stream row count remains singular for one logical turn
  - lock cleanup still runs on stop
- Runtime smoke:
  - trigger streaming,
  - click stop,
  - verify stream ends and chat returns to idle without generic failure state

## Acceptance Criteria

- Stop still aborts through `AbortSignal`, not only local DB mutation.
- The stop race window is intentionally set and tested, not accidental.
- Repeat stop clicks do not create duplicate aborted turn artifacts.
- Stopped runs remain distinct from true provider failures.
- Relevant tests are green.
- Convex typecheck is green and the Convex dev server is actually serving the updated action code.

## Known Pitfalls

- Do not rewrite the transport architecture in this plan.
- Do not conflate “aborted stream row” with “provider request already canceled”; the former is evidence, not the transport primitive.
- Do not loosen stop semantics by silently swallowing real provider failures.
- Do not change query/UI contracts here unless a tiny type-safe cleanup is required for tests.
- Do not stop after getting Vitest green if Convex still rejects the changed file. That means the app is still running old code.
