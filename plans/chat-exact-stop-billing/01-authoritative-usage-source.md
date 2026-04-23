# Plan 01 — Authoritative Usage Source

**Depends on:** nothing. **Blocks:** 02, 03.

## Goal

Prove and lock the exact authoritative usage source for chat generations, including user-stopped streams.

Concretely:

- capture the provider generation identifier early enough that a stopped stream can still be reconciled,
- prove whether OpenRouter returns exact usage/cost for cancelled generations via its documented generation stats path,
- normalize that payload into a repo-owned helper contract,
- stop with a blocker if exact cancelled-generation usage cannot be sourced reliably.

## Scope

In scope:

- `convex/chat/provider.ts`
- `convex/chat/messages.ts`
- a new provider-facing helper module if needed
- focused tests for usage normalization / source selection
- one dev/runtime proof path for cancelled-generation reconciliation

Out of scope:

- credit ledger writes,
- final billing cutover,
- UI changes,
- transaction list rendering.

## Design

1. **Treat OpenRouter generation stats as the target authoritative source.**
   The repo currently routes chat through OpenRouter. OpenRouter documents:
   - `X-Generation-Id` for all endpoints,
   - `/api/v1/generation?id=...`,
   - generation stats containing usage/cost and `cancelled`.
   This plan must verify those guarantees in the repo’s actual streaming path.

2. **Capture generation identity before finish-only hooks.**
   The current `usageHandler` path is too late for mid-stream aborts. This plan should identify the earliest reliable point where the generation id can be captured in the current stack:
   - provider response metadata,
   - response headers,
   - streamed chunk id,
   - or a lower-level provider hook.

3. **Normalize provider usage into a repo-owned shape.**
   Create a small pure helper that maps OpenRouter generation stats into the exact fields later plans need:
   - generation id,
   - cancelled flag,
   - prompt/completion/reasoning/cached token counts,
   - authoritative cost,
   - finish reason / native finish reason.

4. **Lock the feasibility gate.**
   If exact cancelled-generation usage cannot be fetched reliably after a stop, execution must write `01-BLOCKER.md` and stop. No approximations.

## TDD Sequence

Phase A — pure logic first:

1. Add a normalization helper for provider-authoritative generation stats.
2. Write unit tests for:
   - complete generation payload,
   - cancelled generation payload,
   - missing optional fields,
   - invalid / incomplete payload rejection.

Phase B — provider/runtime proof:

1. Add a focused proof path that captures a generation id in the current chat stack.
2. Add a test or dev-gated verification helper showing that a cancelled chat generation can be reconciled by that id.
3. Update plan notes if the current agent wrapper is insufficient and a lower-level runtime path is required in plan 03.

## Files Touched

- [convex/chat/provider.ts](../../convex/chat/provider.ts)
- [convex/chat/messages.ts](../../convex/chat/messages.ts)
- new helper(s) under `convex/chat/` or `lib/chat/`
- new focused test file(s) for normalization / proof

## Migration Stance

None in this plan.

## Test Plan

- Unit:
  - generation-stats normalization helper
  - cancelled vs non-cancelled payload mapping
- Integration or dev proof:
  - capture provider generation id for a chat turn
  - verify exact stats retrieval for a stopped generation
- Runtime verification:
  - confirm the chosen capture point survives a user stop

## Acceptance Criteria

- The plan identifies one reliable authoritative usage source for stopped chat generations.
- The provider generation id is captured early enough for stopped runs.
- Normalization into a repo-owned exact-usage shape is implemented and tested.
- If exact cancelled-generation stats are unavailable, a blocker is written and work stops.
- Relevant tests are green.
- TypeScript / Convex compilation is green.

## Known Pitfalls

- Do not confuse OpenRouter’s final SSE usage chunk with a reliable stop path; a user abort may prevent receiving it locally.
- Do not assume AI SDK `onAbort` yields unfinished-step usage. The docs do not guarantee that.
- Do not design later billing around visible text deltas.
- Do not silently continue if the authoritative source is not actually exact for cancelled generations.
