# Plan 02 — Regenerate Same Turn And Clear Artifacts

**Depends on:** 01. **Blocks:** 03.

## Goal

Make stopped turns replaceable and clearable:

- `Regenerate` targets the same logical assistant turn after a stop.
- `Regenerate` removes same-turn stream artifacts before re-running the prompt.
- `Delete chat history` removes both persisted messages and stream artifacts while keeping the thread alive.

This is the core artifact-lifecycle fix.

## Scope

In scope:

- `convex/chat/messages.ts`
- any new local helper for resolving / purging latest assistant turn artifacts
- targeted use of existing agent-library stream deletion primitives
- mutation and integration tests for regenerate-after-stop and clear-after-stop

Out of scope:

- UI copy and pill presentation,
- global thread deletion,
- changes to model-picker or paper-selection behavior.

## Design

1. **Resolve the latest assistant turn as a logical turn, not only a message row.**
   Current regenerate assumes the latest assistant reply is represented only by the latest assistant message doc. That is insufficient once stream artifacts exist separately.

2. **Introduce one local turn-resolution helper.**
   Push the turn-targeting rules into a small pure helper so regenerate and tests do not duplicate message/stream ordering logic.

   The helper should answer:
   - latest assistant turn order,
   - prior user prompt message id,
   - persisted assistant message ids for that order,
   - stream ids for that same order.

3. **Regenerate must purge same-turn artifacts first.**
   Before rescheduling generation:
   - delete assistant message docs for the target order,
   - delete stream rows/deltas for that target order,
   - then reschedule generation from the prior user prompt.

4. **Clear must purge both stores.**
   `clearThread` must:
   - delete all message docs by order range,
   - delete all stream rows/deltas for the thread,
   - reset the job counters,
   - keep the thread itself intact.

5. **Do not use thread-deleting helpers.**
   The agent library contains thread-wide helpers that eventually delete the thread row. Those are the wrong primitive for clear-history and must not be used.

## TDD Sequence

Phase A — pure helper first:

1. Add `lib/chat/latest-assistant-turn.ts` (or equivalent) with tests covering:
   - stopped turn with persisted assistant message,
   - stopped turn with stream artifacts present,
   - latest ordinary assistant turn,
   - no valid regenerate target.

Phase B — mutation behavior:

1. Red test: regenerate after stopped turn leaves no old same-order stream artifact behind.
2. Implement regenerate artifact purge.
3. Red test: clear after stopped turn leaves no messages and no streams.
4. Implement clear artifact purge.
5. Run full affected chat mutation/query test slice.

## Files Touched

- [convex/chat/messages.ts](../../convex/chat/messages.ts)
- `lib/chat/latest-assistant-turn.ts` (new helper)
- its unit test
- [convex/chat/messages.test.ts](../../convex/chat/messages.test.ts)

Likely donors:

- [node_modules/@convex-dev/agent/src/component/streams.ts](../../node_modules/@convex-dev/agent/src/component/streams.ts)
- [node_modules/@convex-dev/agent/src/client/index.ts](../../node_modules/@convex-dev/agent/src/client/index.ts)

## Migration Stance

None.

## Test Plan

- Unit:
  - latest-turn resolver chooses the correct assistant order and prompt message
- Convex integration:
  - regenerate after stopped turn removes same-order stream artifacts first
  - regenerate reuses the same logical assistant turn/order
  - clear after stopped turn removes all messages
  - clear after stopped turn removes all stream rows/deltas
  - clear preserves thread / selected model / paper set
- Live smoke:
  - stop mid-stream,
  - regenerate,
  - verify only one assistant turn remains for that reply,
  - stop again,
  - clear history,
  - verify empty chat and no ghost reply

## Acceptance Criteria

- Regenerate no longer relies solely on the latest assistant message doc.
- Regenerate removes same-turn stream artifacts before rerun.
- Clear removes stream artifacts in addition to message docs.
- Clear keeps the thread row alive.
- No ghost reply remains after clear.
- Relevant tests are green.
- Convex typecheck is green and the running Convex dev server has loaded the new clear/regenerate behavior.

## Known Pitfalls

- The wrong stream helper can delete the thread itself; avoid it.
- Deleting only messages is not enough; deleting only streams is not enough.
- “Same message” is a logical-turn contract, not a row-id contract.
- Keep regenerate idempotent under quick repeated clicks where possible; if behavior must be serialized, document it in tests.
- `Id<"...">` typing around agent component tables is easy to get subtly wrong. Those errors are not acceptable to leave behind because they prevent Convex from serving the new code.
