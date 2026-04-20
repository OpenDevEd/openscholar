# Plan 01 — Known limitation + live smoke test handoff

Two things the autonomous execution of plan 01 could not close on its own. Both are documented here rather than silently skipped.

## 1. Live smoke test — awaiting human verification

Plan 01 § Test plan § "Live smoke test (no code, do this in browser after merge)" is a six-step browser + Convex dashboard checklist that requires:

- A Clerk-authenticated session (autonomous execution has no credentials).
- A chat thread with at least one included source.
- The ability to click the stop button and observe the DevTools Network + Convex dashboard in real time.

The autonomous run verified every observable behavior the smoke test specifies except the literal "Network tab — OpenRouter SSE closes within ~600ms" timing, which depends on an actual OpenRouter fetch:

| Smoke-test assertion | Equivalent automated coverage |
|---|---|
| Function logs show `[chat] stream aborted by user` | `convex/chat/messages.test.ts::A2` (console.info spy) |
| Job row: `isGenerating === false`, `shouldAbort === undefined` | `A5` + `A7` |
| Stream row: `state:{kind:"aborted"}` | `A3` |
| Partial text stays visible | `A4` (deltas not rolled back) |
| Click stop after stream completes: no-op | `A6` ("abortGeneration no-ops when nothing is in flight" pre-existing test) |
| OpenRouter SSE closes within ~600ms of click | **Not automated** — requires real provider. `A1` proves composed `abortSignal.aborted === true` by the time the action resolves; the TCP cancel inside OpenRouter's fetch is a library contract confirmed by reading `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:517-521` and `:643-647`. |

**Action required before shipping plan 01:** run the six-step smoke test from plan 01 § Test plan § Live smoke test in a logged-in session.

## 2. Billing gap on abort

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
