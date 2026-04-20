# Plan 01 — Action-Side Abort Wiring (poll `shouldAbort`, thread `AbortSignal`, preserve partial text)

**Depends on:** nothing (uses existing schema field + existing query). **Blocks:** 02 (UI needs a stream row that actually transitions to `state:{kind:"aborted"}` when a user clicks stop).

## Goal

Close the one missing loop: when a user clicks stop, `generateResponse` observes `job.shouldAbort === true` within 500ms, aborts the `AbortController` it passes to `paperChat.streamText`, which cascades through `@convex-dev/agent`'s `DeltaStreamer` → AI SDK's `streamText` → OpenRouter's `fetch` → TCP cancel. Partial deltas are preserved in DB (library behavior). The stream row transitions to `state:{kind:"aborted"}`. Credits are deducted honestly for whatever was consumed pre-abort (existing `usageHandler`). The lock releases cleanly (existing `releaseThreadLock`).

No UI work. No schema changes. No new mutations. One new pure util, one new action-level polling helper, one new `abortSignal` arg threaded through an existing call, one `onAbort` callback for observability.

Implements decisions D1, D2, D3, D4, D5, D6, D7, D10.

## Scope

**In scope**

- `lib/chat/abort-poller.ts` (NEW) — pure util that owns the `setInterval`/`clearInterval` race. Testable in isolation against fake timers.
- `convex/chat/messages.ts::generateResponse` — construct an `AbortController` at the top; start the poller against `internal.chat.messages.shouldAbortInternal`; pass `controller.signal` into `paperChat.streamText`'s streamTextArgs; wire AI SDK's `onAbort` callback for observability + final usage capture; ensure `maxRetries: 0`; stop the poller in the `finally` block.
- TDD sequence for `abort-poller` (§ TDD sequence).
- Test-after Convex integration tests for the abort flow (§ Test plan).

**Out of scope**

- UI rendering of the aborted state (plan 02).
- New schema fields (D7 — no index, no `streamId` column).
- Mutation-side `abortStream` calls (D3 — rejected in favor of polling).
- Retry/resume behavior (D9 — out of scope entirely).
- Replacing `stepCountIs(1)` with multi-step configs (would require `onStepFinish`-based polling instead; defer).

## Design

### 1. The mechanism in plain English

`generateResponse` is an `internalAction`. Inside, it already calls `paperChat.streamText(...)` which sets up a `DeltaStreamer`, which calls AI SDK's `streamText`, which opens a fetch to OpenRouter. All of this runs inside one async scope inside the action.

We add three pieces:

1. **An `AbortController`** owned by the action. Its `signal` is passed into `paperChat.streamText`'s streamTextArgs (3rd arg). The library composes it with its own internal `DeltaStreamer.abortController` and forwards the composed signal to AI SDK.
2. **A poller** — `setInterval(checkFlag, 500)`. Each tick calls `ctx.runQuery(internal.chat.messages.shouldAbortInternal, { jobId })`. If it returns `true`, the poller calls `controller.abort(new DOMException("user_stopped", "AbortError"))` and clears itself.
3. **An `onAbort` callback** on `paperChat.streamText`'s options — forwarded to AI SDK's `streamText.onAbort`. Fires exactly once with `{steps}`. We log here and optionally capture final usage for the `usageHandler` (the library already handles this via its `usageHandler` — verify, don't duplicate).

Everything else is the library's existing behavior:

- DeltaStreamer observes the composed signal, calls `ctx.runMutation(component.streams.abort, { streamId, reason: "abortSignal" })` which patches the stream row to `state:{kind:"aborted"}` and stops further `addDelta` writes (`node_modules/@convex-dev/agent/src/client/streaming.ts:245-262`).
- AI SDK `streamText` emits a `{type:'abort'}` chunk, closes the stream cleanly, calls `onAbort({steps})`. Does **not** throw out of the `await paperChat.streamText(...)` call (`node_modules/ai/src/generate-text/stream-text.ts:1195-1245`).
- `paperChat.streamText` returns normally. The existing `try/catch` at `convex/chat/messages.ts:181-204` is not triggered by abort.
- The `finally` block runs `releaseThreadLock` which clears `shouldAbort: undefined` and `isGenerating: false` (`convex/chat/concurrency.ts:97-111`).

### 2. Pure util — `lib/chat/abort-poller.ts`

```ts
// lib/chat/abort-poller.ts
export type StopPoller = () => void;

export type StartAbortPollerArgs = {
  /** Reads the current abort flag. Typically a closure over ctx.runQuery. */
  readFlag: () => Promise<boolean>;
  /** Fired exactly once when readFlag resolves true. */
  onAbort: () => void;
  /** Poll interval in ms. Default 500. */
  intervalMs?: number;
};

export function startAbortPoller({
  readFlag,
  onAbort,
  intervalMs = 500,
}: StartAbortPollerArgs): StopPoller {
  let stopped = false;
  let fired = false;

  const tick = async () => {
    if (stopped || fired) return;
    try {
      const flag = await readFlag();
      if (flag && !fired && !stopped) {
        fired = true;
        onAbort();
      }
    } catch {
      // readFlag failure shouldn't kill the stream — swallow.
      // The outer finally + zombie-lock sweep (concurrency.ts:119-146) handles stale state.
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
```

**Why a util, not inline:** testability (fake timers against a deterministic `readFlag`), and clear ownership of the once-only-fires invariant. The util does NOT own the AbortController — callers pass their own `onAbort` that calls `controller.abort()`. Keeps the util pure (no Web API dependency beyond `setInterval`).

### 3. Action refactor — `convex/chat/messages.ts::generateResponse`

**Current shape** (`convex/chat/messages.ts:118-219`, abridged):

```ts
export const generateResponse = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, promptMessageId }) => {
    const meta = await ctx.runQuery(internal.chat.threads.getModelForThread, { threadId });
    if (!meta) throw createError("NOT_FOUND", "Thread not found");
    const { jobId, userId, chatModelId } = meta;

    let envelopePatchedFromOnError = false;
    try {
      // credit check...
      const { model } = await resolveOpenRouterModel(ctx, chatModelId);
      try {
        await paperChat.streamText(
          ctx,
          { threadId, userId },
          {
            promptMessageId,
            model,
            onError: async ({ error }) => { /* ... */ },
          },
          { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
        );
      } catch (err) { /* ... */ }
    } catch (err) { /* ... */ }
    finally {
      await ctx.runMutation(internal.chat.concurrency.releaseThreadLock, { jobId });
    }
    return null;
  },
});
```

**New shape:**

```ts
import { startAbortPoller } from "../../lib/chat/abort-poller";

export const generateResponse = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, promptMessageId }) => {
    const meta = await ctx.runQuery(internal.chat.threads.getModelForThread, { threadId });
    if (!meta) throw createError("NOT_FOUND", "Thread not found");
    const { jobId, userId, chatModelId } = meta;

    // ------ NEW: abort wiring ------
    const abortController = new AbortController();
    const stopPolling = startAbortPoller({
      readFlag: () => ctx.runQuery(internal.chat.messages.shouldAbortInternal, { jobId }),
      onAbort: () => {
        if (!abortController.signal.aborted) {
          abortController.abort(new DOMException("user_stopped", "AbortError"));
        }
      },
      intervalMs: 500,
    });
    // --------------------------------

    let envelopePatchedFromOnError = false;
    try {
      // credit check unchanged...
      const { model } = await resolveOpenRouterModel(ctx, chatModelId);
      try {
        await paperChat.streamText(
          ctx,
          { threadId, userId },
          {
            promptMessageId,
            model,
            // NEW — thread signal, disable retries, add onAbort
            abortSignal: abortController.signal,
            maxRetries: 0,
            onAbort: async ({ steps }) => {
              // Observability only — library's DeltaStreamer patches stream row to
              // state:{kind:"aborted"} via its signal listener. Usage is already
              // routed through the agent's usageHandler (convex/chat/agent.ts:53-91)
              // from the steps accumulated pre-abort.
              console.info("[chat] stream aborted by user", {
                jobId,
                threadId,
                stepCount: steps.length,
              });
            },
            onError: async ({ error }) => {
              const patched = await patchLastAssistantAsFailed(ctx, threadId, error).catch(() => false);
              if (patched) envelopePatchedFromOnError = true;
            },
          },
          { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
        );
      } catch (err) {
        // unchanged — catch still handles real errors, not user-stop
        if (!envelopePatchedFromOnError) {
          const patched = await patchLastAssistantAsFailed(ctx, threadId, err).catch(() => false);
          if (!patched) {
            await saveStandaloneErrorMessage(ctx, threadId, err).catch(() => {});
          }
        }
      }
    } catch (err) {
      await saveStandaloneErrorMessage(ctx, threadId, err).catch(() => {});
      throw err;
    } finally {
      stopPolling();  // NEW — always stop the poller
      await ctx.runMutation(internal.chat.concurrency.releaseThreadLock, { jobId });
    }
    return null;
  },
});
```

**Placement notes:**

1. **`abortController` and `stopPolling` are declared before the outer `try`**, so `finally` can always clear the poller. If construction throws (it shouldn't), nothing to clean up.
2. **Poller starts immediately** — even before the credit check. If the user clicks stop during credit-check latency (unlikely but possible), we still honor it. The check fires on the first `setInterval` tick (up to 500ms after the start), so this is fully benign.
3. **`abortSignal` lives in streamTextArgs** (3rd arg to `paperChat.streamText`), not the 4th arg (options/streaming config). Confirmed in `node_modules/@convex-dev/agent/src/client/streamText.ts:44-76`. The 4th arg (`{saveStreamDeltas: ...}`) stays untouched.
4. **`maxRetries: 0`** per D6 — kills the AI SDK retry loop so abort is snappy.
5. **`onAbort` is forwarded to AI SDK via the library's streamTextArgs spread**. Confirmed accepted in the same intersection type.
6. **The existing `catch (err)` block is NOT the abort path.** AI SDK swallows `AbortError` and converts to an `abort` chunk; `paperChat.streamText` returns normally after abort. Do **not** add `if (err.name === "AbortError") ...` — it won't fire.
7. **`stopPolling()` runs BEFORE `releaseThreadLock`** in `finally`. Ensures no stale `runQuery` calls are in flight against a thread whose lock is being released. Ordering matters because `releaseThreadLock` clears `shouldAbort: undefined`; if a poll tick raced past that clear, we'd spuriously abort *the next* stream if another turn had somehow started (impossible under the current lock, but defense in depth).

### 4. Why the mutation and the schema stay identical

- `abortGeneration` (`convex/chat/messages.ts:420-431`) already does the right thing: patches `job.shouldAbort = true` only when `isGenerating`. No change.
- `shouldAbortInternal` (`convex/chat/messages.ts:434-441`) already has the right signature: `{ jobId } → boolean`. Plan 01 is the first caller.
- `releaseThreadLock` (`convex/chat/concurrency.ts:97-111`) already clears `shouldAbort: undefined` on all release paths (success, error, credit failure). Good.
- `schema.shouldAbort` field — already optional boolean. Good. Delete the now-inaccurate comment ("polled by the streaming action to break out of streamText") once this plan lands — the behavior it describes finally exists.

## TDD sequence (pure logic only — `lib/chat/abort-poller.ts`)

### `lib/chat/abort-poller.test.ts`

Use `vi.useFakeTimers()`. Each R → G is one commit after green.

```
R1 → G1   test: startAbortPoller returns a function
           - call startAbortPoller with stub readFlag (returns false)
           - assert return value is a function
R2 → G2   test: stop() clears the interval
           - start poller with readFlag that throws if called
           - immediately call stop()
           - vi.advanceTimersByTime(10_000)
           - assert readFlag was never called
R3 → G3   test: onAbort fires when readFlag resolves true
           - readFlag returns false, false, true, false, false...
           - start poller
           - advance 3 intervals
           - assert onAbort called exactly once
R4 → G4   test: onAbort fires AT MOST once even if readFlag stays true
           - readFlag always returns true
           - start poller, advance 10 intervals
           - assert onAbort called exactly once
R5 → G5   test: onAbort does not fire after stop()
           - readFlag returns true on tick 3
           - start poller, advance 2 ticks, call stop(), advance 10 ticks
           - assert onAbort never called
R6 → G6   test: readFlag errors are swallowed (poller keeps polling, never fires onAbort spuriously)
           - readFlag throws twice, then returns false
           - start poller, advance 5 ticks
           - assert onAbort never called (no crash, no spurious fire)
R7 → G7   test: intervalMs default is 500ms
           - readFlag = spy returning false
           - start poller with no intervalMs
           - advance 499ms → assert 0 calls
           - advance 1ms more → assert 1 call
R8 → G8   test: custom intervalMs honored
           - start poller with intervalMs: 1000
           - advance 999ms → 0 calls; 1ms more → 1 call
REFACTOR  if the once-only guard (`fired`) and the stop guard (`stopped`) can be
          collapsed into a single state enum without losing clarity, do it; otherwise keep both.
```

**Phase A (TDD):** write the above. Watch red, implement, watch green. Commit per green.

**Phase B (test-after):** action refactor + Convex integration tests. One commit per logical unit.

## Files touched

- `lib/chat/abort-poller.ts` — NEW, pure util (~30 lines).
- `lib/chat/abort-poller.test.ts` — NEW, Vitest fake-timers.
- `convex/chat/messages.ts` — extend `generateResponse` with abort wiring (~20 new lines, no removals).
- `convex/chat/messages.test.ts` — extend with abort integration tests (§ Test plan).
- `convex/schema.ts:374-376` — delete or rewrite the now-stale comment on `shouldAbort` (one-line doc fix).

## Migration stance — **none**

No schema changes. `shouldAbort` field already exists. `shouldAbortInternal` query already exists. Pure additive wiring.

## Test plan

### Unit (pure — covered in TDD sequence)

- `abort-poller` — 8 cases.

### Convex integration (test-after, in `convex/chat/messages.test.ts`)

Use the `convex-test` harness already in use. Each test seeds a chat-mode job, a thread, and sets `isGenerating: true` manually (or invokes `sendMessage` and awaits the scheduled action).

- **A1 — poller fires `controller.abort()` when flag flips**
  - Seed job + thread, set `isGenerating: true`, invoke `generateResponse` with a mocked `paperChat.streamText` that awaits a 2s timer.
  - After 100ms, patch `job.shouldAbort = true`.
  - Within ~600ms, assert the mocked `abortSignal.aborted === true`.
  - (Harness requires either a mock layer for `paperChat.streamText` or a real model call against a test provider. If mocking is awkward, use the real library against a fake `model` that stalls — see e.g. AI SDK's `MockLanguageModel` utility.)

- **A2 — `onAbort` callback receives steps**
  - Same setup as A1. When abort fires, assert the spy passed as `onAbort` was called exactly once with `{ steps: StepResult[] }`.
  - Assert the spy was called BEFORE `paperChat.streamText` resolved (i.e., abort chunk precedes stream close).

- **A3 — stream row transitions to `state:{kind:"aborted"}`**
  - After A1's abort, query the agent component's `streamingMessages` table (or the public `syncStreams` RPC) for the row tied to this thread/order.
  - Assert `row.state.kind === "aborted"` and `row.state.reason` contains "abortSignal" (or whatever the library sets; confirm in library source).

- **A4 — already-written deltas survive abort**
  - Before abort fires, let the stream emit 2-3 word deltas. Abort. Query `streamDeltas`.
  - Assert those 2-3 deltas still exist in DB (library does not roll back).

- **A5 — `releaseThreadLock` clears state after abort**
  - After A1 completes (abort fired, action resolved), re-fetch the job.
  - Assert `isGenerating === false`, `shouldAbort === undefined`, `generatingStartedAt === undefined`.

- **A6 — no-op abort is benign**
  - Invoke `generateResponse` with a mocked stream that completes in 100ms. Do NOT set `shouldAbort`.
  - Assert the action completes normally, `onAbort` is NEVER called, `onFinish` / `streamText` return path fires, stream row is `state:{kind:"finished"}` (or whatever the non-abort terminal state is).

- **A7 — rapid click-stop-click is safe**
  - Seed. Invoke `generateResponse`. Within 50ms, patch `shouldAbort: true`. Within another 50ms, mutation `abortGeneration` again (idempotent per its `if (!job.isGenerating) return` guard).
  - Assert abort fires once, action completes cleanly, no duplicate message rows.

- **A8 — `maxRetries: 0` — abort during a retry does not produce a second request**
  - Seed. Mock the model to fail the first attempt (so AI SDK would normally retry).
  - Assert: since `maxRetries: 0`, the failure bubbles to the existing `catch (err)` path — i.e., NOT the abort path. This test guards the config setting, not the abort behavior.

### Credits (test-after, in `convex/chat/messages.test.ts` or `convex/credits/*.test.ts`)

- **C1 — partial usage is deducted on abort**
  - Seed a user with known balance. Trigger a stream that aborts after ~5 tokens. Assert `usageHandler` was called with `usage` reflecting the partial token count (input tokens + 5 output).
  - If the library's `usageHandler` is NOT invoked on abort (needs verification — check `node_modules/@convex-dev/agent/src/client/streamText.ts` + component), file a BLOCKER.md with the finding and decide whether to call `usageHandler` manually in `onAbort`.

### Live smoke test (no code, do this in browser after merge)

1. Start a chat with a large model (slow streaming).
2. Click stop at ~3 seconds in.
3. Assert in browser devtools:
   - Network tab: OpenRouter SSE request closes within ~600ms of click.
   - UI: streaming cursor disappears; partial text stays visible; (plan 02 handles the pill).
4. Assert in Convex dashboard:
   - Function logs show `[chat] stream aborted by user` from `onAbort`.
   - Job row: `isGenerating === false`, `shouldAbort === undefined`.
   - Stream row: `state:{kind:"aborted"}`.
5. Click stop AFTER a stream completes naturally. Expected: no-op per `abortGeneration`'s `if (!job.isGenerating) return` guard. No errors.

## Acceptance criteria

- [x] `startAbortPoller` is pure, tested (8 cases green), and exported from `lib/chat/abort-poller.ts`.
- [x] `generateResponse` constructs an `AbortController`, starts/stops the poller in `try/finally`, passes `controller.signal` as `abortSignal` in streamTextArgs, sets `maxRetries: 0`, wires an `onAbort` handler.
- [x] `paperChat.streamText` call site still passes `{ saveStreamDeltas: { chunking: "word", throttleMs: 250 } }` as the 4th arg unchanged. (Pre-plan throttle was raised from 100ms to 250ms in plan-chat-perf; this plan preserved the value.)
- [x] Convex integration tests A1–A8 green.
- [x] Credit test C1 green (BLOCKER.md filed — `usageHandler` does not fire on mid-stream abort; V1 accepts the gap).
- [ ] Live smoke test passes: click stop → network close < 600ms; stream row state `"aborted"`; logs show `onAbort` fired. **Pending human verification** — requires Clerk-authenticated browser session; see `01-BLOCKER.md` § 1 for the mapping of each smoke-test assertion to its equivalent automated coverage (A1–A7, C1).
- [x] `rg -n "shouldAbort" convex/` shows callers in `messages.ts::generateResponse` (new), `messages.ts::abortGeneration` (existing), `concurrency.ts::releaseThreadLock` (existing), `concurrency.ts::cleanupZombieChatLocks` (existing), `schema.ts` (field). No orphans.
- [x] `rg -n "shouldAbortInternal" convex/` shows AT LEAST ONE caller (the new poller).

## Known pitfalls

- **Abort doesn't throw — don't guard the catch block.** `paperChat.streamText` returns normally after an abort; the `catch (err)` block is for real errors only. If you add `if (isAbortError(err)) ...` inside the catch, you're handling a case that can't fire. Don't do it.
- **`onAbort` fires once — don't rely on it to persist the assistant message**. The library's `DeltaStreamer` already writes partial deltas to DB as they stream. The stream row is patched to `"aborted"` by the library's internal signal listener, not by your `onAbort`. Your `onAbort` is observability + diagnostics only. If you try to `ctx.db.patch` the message row inside `onAbort`, you'll race the library's own patch. Just log.
- **The 500ms polling cadence is a floor on click-to-cut latency.** Total worst-case = 500 (poll) + 100 (throttleMs for DeltaStreamer's next write) + network = ~700ms. If product wants sub-200ms, switch to the mutation-triggered `abortStream` pattern (see `plans/chat-stop-streaming/00-README.md` § D3 — documented alternative). Don't do it in this plan.
- **Polling the job doc uses one `runQuery` per tick.** At 500ms cadence over a 60s stream, that's 120 queries. Billed as function calls ($2 per 1M on Pro); negligible. But if you ever multi-tenant this or stream for minutes, reconsider. Do NOT try to cache the query result — `ctx.runQuery` is the only way to read fresh DB state from an action.
- **`setInterval` inside an action is legal** — the Convex Node.js runtime supports it. The `clearInterval` in `finally` ensures no dangling timers escape the action's scope.
- **Action timeout is 10 minutes** — the poller + stream + release all fit comfortably. No concern.
- **`DOMException` is a Web global** — available in Convex's Node runtime. If running in the V8 runtime (64 MB RAM), verify it exists. If not, fall back to `new Error("user_stopped")` with `name = "AbortError"`. The AI SDK checks `error.name === "AbortError"`, not the constructor.
- **Order of wiring in the handler matters.** The `AbortController` and poller live OUTSIDE the outer try/catch so the `finally` always sees them. If you move them inside the try, a throw before the `try` line would skip cleanup. (Currently the only pre-try throw is `createError("NOT_FOUND")` if meta is missing — which returns before the controller exists, so no leak. But be defensive.)
- **If the library version changes the internal streamer signal path**, this plan's behavior breaks silently. Lock `@convex-dev/agent` version in `package.json` and add a sanity check to CI: "when abortSignal fires, assert stream row transitions to state.kind='aborted' within 1s". This check is test A3 above.

## Deviations

If during execution you find any of these, **do not patch around them — update this plan, commit the plan edit, then proceed**:

- `@convex-dev/agent` does not accept `abortSignal` in streamTextArgs (would contradict research — library version mismatch). Re-run the research agent against `node_modules/@convex-dev/agent/src/client/streamText.ts` and update this plan with the correct arg shape.
- `DOMException` is not defined in the Convex runtime for this project. Switch to a plain `Error` with `name = "AbortError"` and note it in D1.
- `onAbort` is not forwarded by `paperChat.streamText` wrapper (intersection type doesn't include it). Drop the `onAbort` wiring and use a console log inside the poller's `onAbort` closure instead — same observability, different placement.
- The credit deduction path (test C1) does not fire on abort. Either (a) invoke `usageHandler` manually in `onAbort`, or (b) file a ticket against `@convex-dev/agent` and accept the behavior for now. Document the choice.
