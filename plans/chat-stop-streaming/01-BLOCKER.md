# Plan 01 — Known limitation (not a blocker to ship)

## Finding

`usageHandler` (wired in `convex/chat/agent.ts:65-91`) does **not** fire when the user aborts a chat mid-stream.

Root cause: `@convex-dev/agent@0.6.1` invokes `usageHandler` from inside the library's `save()` closure, which runs only when a step finishes:

- `node_modules/@convex-dev/agent/src/client/start.ts:314-324` — `if (opts.usageHandler && output.usage) { await opts.usageHandler(...) }`
- `save()` is called from the step-finish callbacks.
- AI SDK v6 `streamText.onAbort({ steps })` (`node_modules/ai/src/generate-text/stream-text.ts:1195-1245`) fires with `steps = recordedSteps` — only **completed** steps. A step that was still mid-`fullStream` consumption when abort fired is not in `recordedSteps`.
- In V1 we set `stopWhen: stepCountIs(1)`, so there is at most one step per turn. Aborting that single step mid-stream produces `steps: []` and no usage.

Verified by `convex/chat/messages.test.ts::C1` — `lifetimeUsed === 0` after a mid-stream abort, even with non-zero `inputPricePerMillion` / `outputPricePerMillion`.

## Decision

**Accept the gap for V1** (option (b) from plan 01 § Deviations).

Rationale:
- Mid-stream aborts are rare in practice — most users let their turns finish.
- The per-event cost is small (≤ ~500 tokens before the user visibly sees stream start + decides to click stop).
- Option (a) — manually invoking `usageHandler` from our `onAbort` — would require synthesizing a `usage` shape from incomplete step state. AI SDK does not expose a token-count delta at the chunk level on provider abort; we would either guess (wrong) or bypass the handler and call `deductCredits` directly with a heuristic.
- OpenRouter still bills us for the partial tokens — so the project eats a tiny cost, not the user.

## Future work

If billing completeness becomes important:
1. File a ticket against `get-convex/agent` requesting that `usageHandler` be invoked on abort with partial-step usage (AI SDK v6 has the data; library just needs to forward it).
2. Alternatively, parse OpenRouter's `finish_reason: "cancelled"` response chunk (when provider surfaces one) in a custom chunk handler and deduct credits there.
3. Or, add a post-abort reconciliation job that reads OpenRouter's billing API and backfills `creditTransactions`.

Out of scope for plan 01. Plan 01 is complete.

## Test lockdown

`C1` asserts the current behavior (`lifetimeUsed === 0`). If a library upgrade starts surfacing partial usage on abort, `C1` will fail and force us to update this document + decide whether to start deducting those credits.
