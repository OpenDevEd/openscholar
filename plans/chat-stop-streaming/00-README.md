# Chat Stop-Streaming — Plan Set

Two-plan fix for the extraction chat's half-wired **stop button**. Today the square icon in `message-composer` flips a DB flag (`job.shouldAbort=true`) that nothing reads — the LLM stream and all downstream DB writes run to completion regardless. This plan set makes the stop button actually stop: user click → LLM HTTP request canceled → partial text preserved → assistant message marked as user-stopped in the UI.

Sliced so the backend wiring (plan 01) ships independently of the UI surfacing (plan 02), with explicit dependency arrows.

---

## Motivation

The stop button exists. It is **cosmetic**. Verified end-to-end via two independent research agents:

- **Client** (`components/extraction/chat/message-composer.tsx:57-61`) — `handleStop` calls `abortGeneration({ threadId })`.
- **Mutation** (`convex/chat/messages.ts:420-431`) — patches `job.shouldAbort = true`.
- **Schema** (`convex/schema.ts:374-376`) — comment claims `shouldAbort` is *"polled by the streaming action to break out of streamText"*.
- **Action** (`convex/chat/messages.ts:118-219`) — **never polls** the flag. `paperChat.streamText(...)` at line 158 is called with **no `abortSignal`**.
- **Query** (`convex/chat/messages.ts:434-441`) — `shouldAbortInternal` is defined but has **zero callers** (grep confirmed).
- **Lock release** (`convex/chat/concurrency.ts:97-111`) — finally block clears `shouldAbort: undefined` after the stream completes naturally, erasing the trace that the user ever tried to stop.

Result: clicking stop burns credits for the remainder of the turn, saves a completed assistant message to the thread, and makes the product feel broken even though the request went through.

This plan set wires the last ~30 lines that were never written.

## Design decisions (locked via research agents, 2026-04-19)

| # | Decision | Source / rationale |
|---|---|---|
| **D1** | **Architecture: poll `job.shouldAbort` from inside `generateResponse`; thread an `AbortSignal` through `paperChat.streamText`.** The signal composes with `@convex-dev/agent`'s `DeltaStreamer.abortController`, which natively propagates to AI SDK `streamText` → OpenRouter `fetchOptions.signal` → TCP fetch cancel. | `node_modules/@convex-dev/agent/src/client/streamText.ts:116` (signal forwarding), `node_modules/@convex-dev/agent/src/client/streaming.ts:245-262` (DB-abort listener), `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:517-521` (provider signal plumbing). |
| **D2** | **Poll cadence: 500ms `setInterval` race inside the action.** Budget: ≤120 `runQuery` calls per 60s stream (≤ $0.000024 on paid tier). Click-to-LLM-cut latency: ≤500ms + `throttleMs` (currently 100ms) = **≤600ms total**. Invisible to humans. | Cost/latency calc from [Convex Limits](https://docs.convex.dev/production/state/limits). No rate limits apply at this frequency. |
| **D3** | **Single source of truth: `job.shouldAbort` flag.** Do NOT add a `streamId` field on `extractionJobs`. Do NOT call `abortStream(components.agent, {threadId, order})` from the mutation side (would require querying for the streaming row's order). The polling pattern keeps the mutation side trivial. | Two valid architectures per research; polling is simpler with our schema. |
| **D4** | **Partial text is preserved, not discarded.** AI SDK v6 `streamText` emits a `{type:'abort'}` chunk and closes the stream cleanly (no throw). `@convex-dev/agent`'s `DeltaStreamer` patches the stream row to `state:{kind:"aborted"}` and leaves already-written deltas in `streamDeltas` in place. User sees what was generated up to the stop. | [AI SDK v6 stopping-streams docs](https://sdk.vercel.ai/docs/ai-sdk-core/generating-text#stopping-streams) — "persist partial conversation history" is the documented intent of abort. |
| **D5** | **`onAbort` callback is the persistence hook**, not the catch block. `paperChat.streamText` does NOT throw when its composed signal aborts (confirmed: AI SDK swallows `AbortError`, library's `call.fail` wires to `onAsyncAbort`). We use the AI SDK's native `onAbort({ steps })` to capture final usage + log-only; the library's own DB-side abort handles the stream-row state transition. | `node_modules/ai/src/generate-text/stream-text.ts:1204-1217` (abort branch), `node_modules/@convex-dev/agent/src/client/streamText.ts:96-99` (`call.fail` wiring). |
| **D6** | **`maxRetries: 0` on the AI SDK call.** Default is 2. A retry loop between `streamText` and the provider would add up to 2× ~2s of wasted work after abort signal fires (the signal short-circuits the retry, but the first in-flight attempt still runs to provider timeout). Retries on chat streaming are not useful anyway — the user is watching. | `node_modules/ai/src/generate-text/stream-text.ts:1264-1267` (prepareRetries). |
| **D7** | **No new index needed on `shouldAbort`.** Polling reads one doc by `jobId` — primary-key lookup is O(1). Adding `by_job_shouldAbort` index would add write amplification on every mutation path that patches the job, for zero read gain. | `convex/schema.ts:391-398` indices — keep as-is. |
| **D8** | **UI: assistant message with `state:{kind:"aborted"}` renders with a discrete "Stopped by user" pill**, not a failure/error banner. Partial text stays visible. Retry button stays available (user may want to regenerate). | D4 + general UX — stop is intentional, not a failure. |
| **D9** | **No "Resume" button.** Too much complexity (state recovery, partial-context re-prompting, cost attribution). Out of scope; retry is sufficient. | Scope discipline. |
| **D10** | **Credits: whatever was consumed pre-abort is deducted.** `@convex-dev/agent`'s `usageHandler` (already wired in `convex/chat/agent.ts:53-91`) fires with the `usage` from `steps[]` captured at abort time. OpenRouter bills partial tokens regardless; we record honestly. | `convex/chat/agent.ts:53-91` — existing `usageHandler` is abort-aware by virtue of the library passing whatever usage it has. |
| **D11** | **Toast feedback on click**: `"Generation stopped"` (2s auto-dismiss, `role="status"`, `aria-live="polite"`). Shown when the `abortGeneration` mutation promise resolves, not when the action actually finishes aborting — the user gets instant acknowledgement. | UX: instant feedback beats accurate-but-delayed feedback. |
| **D12** | **Button itself doesn't need to change.** Existing `SquareIcon` + `handleStop` at `message-composer.tsx:57-61,180-190` stays. We're fixing the backend, not the UI of the button itself. | Least-change principle. |
| **D13** | **Delete `shouldAbortInternal` query's current unused signature and re-author it**. It returns `v.boolean()` which is fine but the field is a nullable optional — the current implementation uses `job?.shouldAbort === true` which is correct. Keep as-is; we now have a caller. | `convex/chat/messages.ts:434-441` — no change. |

## Plan files

```
plans/chat-stop-streaming/
├── 00-README.md                       (this file)
├── 01-action-abort-wiring.md          (poll + AbortController + abortSignal thread + onAbort)
├── 02-aborted-ui-state.md             (message pill, toast, a11y, retry affordance)
└── PROMPTS.md                         (one copy-paste execution prompt per plan)
```

## Dependency graph

```
01 action-abort-wiring ──► 02 aborted-ui-state
```

Ship order: **01 → 02**. Plan 02 can begin after plan 01's backend behavior is verifiable end-to-end (stream row transitions to `state:{kind:"aborted"}` when a user clicks stop). No parallelization benefit — plan 02 is entirely client-side and short.

## Reuse (DRY)

These plans lean hard on primitives that already exist. Primary donors:

- **`job.shouldAbort` schema field** (`convex/schema.ts:374-376`) — already defined, already patched by `abortGeneration`, already cleared by `releaseThreadLock`. Plan 01 adds the one missing consumer.
- **`shouldAbortInternal` query** (`convex/chat/messages.ts:434-441`) — already exists, untested, uncalled. Plan 01 adds the caller. No signature change.
- **`paperChat.streamText`'s `abortSignal` parameter** — it's the third arg (streamTextArgs) per `node_modules/@convex-dev/agent/src/client/streamText.ts:44-54`. Already typed, already forwarded. We just never passed it.
- **`DeltaStreamer`'s abort-to-DB bridge** (`node_modules/@convex-dev/agent/src/client/streaming.ts:245-262`) — when the composed signal aborts, the streamer calls `ctx.runMutation(component.streams.abort, { streamId, reason: "abortSignal" })`, patches the stream row to `state:{kind:"aborted"}`, and stops writing deltas. No library changes needed.
- **`@convex-dev/agent`'s `listThreadMessages` → `syncStreams`** — already streams aborted-state messages to the client if `includeStatuses` lists `"aborted"`. Plan 02 verifies and, if needed, adds `"aborted"` to the includeStatuses list in whatever query assembles the message list.
- **Existing `Toast` primitive** — project uses sonner (`components/ui/sonner.tsx`). Plan 02 reuses, not rewrites.
- **`usageHandler`** (`convex/chat/agent.ts:53-91`) — already deducts credits based on `usage` from the library. Library passes whatever usage accumulated at abort time. No changes needed.
- **`releaseThreadLock`** (`convex/chat/concurrency.ts:97-111`) — already clears `shouldAbort` in the finally block. Keep as-is; the polling loop inside `generateResponse` sees the flag flip before this runs.

## Testing doctrine

All plans follow the project's testing philosophy (project `CLAUDE.md`):

- **Assert on behavior, ARIA roles, `data-*` attributes, and semantic state — not CSS classes.**
- Expose internal contracts via `data-message-state="aborted"`, `role="status"`, `aria-live="polite"`.
- Pure logic tested in `lib/**.test.ts`; Convex wiring tested via `convex-test` harness in `convex/chat/*.test.ts`; client state tested via Testing Library against aria + data-attrs.

### TDD policy — **pure logic only**

Plan 01's pure module is `lib/chat/abort-poller.ts` — a small util that owns the `setInterval`/`clearInterval` race and exposes `startAbortPoller(readFlag, onAbort, intervalMs) → stop()`. Testable in isolation against a fake timer + fake `readFlag`.

Plan 02 has no pure logic; it's all React + aria wiring, test-after.

Convex action/mutation/query behavior and React components are **test-after**. The Test plan section in each plan enumerates the specific behavior assertions written after green-lit implementation.

## Migration stance — **none**

Per the project's migration doctrine (`plans/extraction-recovery/00-README.md` § Migration stance and `plans/chat-sources-toggle/00-README.md` § Migration stance):

- No schema changes in either plan.
- `job.shouldAbort` is already on the schema (optional boolean).
- `shouldAbortInternal` query already exists.
- Nothing to wipe, nothing to backfill.

If a production deployment exists someday and streams are in-flight during the deploy, the polling loop simply won't find a `true` value and will do nothing — safe rollout.

## Delegation policy — protect the main session's context

Context rot is the silent enemy of long-running plans. Every file read, grep, and tool output pollutes the main session's context. Subagents absorb that pollution in their own context and return only synthesized summaries.

**The executing session MUST delegate broadly** via the Agent tool. Rule of thumb: **any investigation needing more than ~3 file reads or ~3 greps → spawn a subagent**.

### Agent types to prefer

- **`Explore`** — fast codebase exploration. Use for "where is X defined?", "map all callers of Y", "find every file that imports Z". Always specify thoroughness: `"quick"` | `"medium"` | `"very thorough"`.
- **`general-purpose`** — multi-step research, web doc reading, skill discovery, cross-library synthesis.
- **`Plan`** — subsidiary planning for a non-trivial sub-problem.

### What to delegate (high value for these plans)

- "Read `node_modules/@convex-dev/agent/src/client/streamText.ts` and dump the exact signature of the third arg (streamTextArgs) — I need to confirm `abortSignal` lives there and what else is in that intersection type."
- "Read `node_modules/ai/src/generate-text/stream-text.ts` around the abort branch (L1195–1245) and summarize what fires on abort: which callbacks, which chunk types, which promises resolve vs reject."
- "Find every caller of `paperChat.streamText` in our repo and list what the third/fourth args look like at each site."
- "Read the existing `convex/chat/messages.test.ts` + `convex/chat/concurrency.test.ts` and summarize the `convex-test` test patterns used so plan 01's new tests match style."
- "Find the UI component that renders aborted/failed assistant messages today — there's likely something in `components/extraction/chat/message-list.tsx` or an error-state alert. Map the render path for an assistant message with `state:{kind:"error"}` so plan 02 can mirror it for `"aborted"`."

### What to keep in the main session

- The TDD red → green → refactor cycle for `abort-poller`. Needs tight test-runner feedback.
- Commits. Main session owns discipline.
- Plan-file edits (deviations, updates).
- Final acceptance-criteria verification (click stop in browser; watch DB; read logs).
- Trivial one-shot lookups (faster to Read directly than spawn an agent).

### Parallelism

When spawning multiple subagents for **independent** questions, put them in a **single message with multiple Agent tool calls**. The harness runs them concurrently.

### Prompting subagents

A subagent starts with **zero context**. Give it enough to succeed unattended:

- Repo root path (`/Users/mcharrad/Documents/Github/openalex-count`).
- What you've already tried / ruled out.
- Exact shape of the answer you want ("bulleted list, under 500 words, `file_path:line` citations").
- Clearly state whether it should write code or just research.

### When the session grows stale

If the main session accumulates many tool calls and you feel quality drifting, **pause, commit progress, write a one-paragraph state summary into the plan file or a commit message, then restart in a fresh `/clear`'d session** by pasting the plan's prompt from `PROMPTS.md`. The plan files are designed to be resumable from any acceptance-criteria checkpoint.

## Convex + AI SDK facts that override training data

- **AI SDK v6** (`ai@^6.0.168`) — `streamText`'s `abortSignal` is **top-level** on the options object, not nested. When fired, emits a `{type:'abort', reason}` chunk into `fullStream`, then closes the stream. **Does not throw.** `onAbort({ steps })` callback fires; `onFinish` does **not**. `finishReason` has no `"abort"` value — abort is a sibling signal delivered as its own chunk + callback. See `node_modules/ai/docs/07-reference/01-ai-sdk-core/02-stream-text.mdx:432-438` (signature) and `:1727-1744` (onAbort).
- **`@convex-dev/agent`** — `streamText` accepts `abortSignal` in streamTextArgs (the 3rd arg), composes it with the internal `DeltaStreamer.abortController`, and forwards the composed signal to AI SDK. When fired, the library patches the stream row to `state:{kind:"aborted"}`, preserves already-written deltas, and stops further writes. See `node_modules/@convex-dev/agent/src/client/streamText.ts:44-76,96-116`.
- **`ctx.scheduler.cancel` does NOT kill a running action.** Per [Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions): *"if it already started, it will continue to run"*. Do not rely on it for stop. **Polling + AbortController is the only viable path** inside an action.
- **Convex actions cannot subscribe to DB changes.** Reactivity is a query/client property. `ctx.runQuery` inside an action is a blocking one-shot RPC read. This is why we poll.
- **OpenRouter provider (`@openrouter/ai-sdk-provider@6.0.0-alpha.1`)** — propagates `abortSignal` correctly via `fetchOptions.signal`. Confirmed in `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:517-521` (non-stream), `:643-647` (stream), `:1096-1100` (embeddings).

## Sources

- Research brief (4 parallel agents, in-session 2026-04-19):
  - Current-state code map (Explore agent).
  - `@convex-dev/agent` abort API reference (general-purpose agent).
  - AI SDK v6 `streamText` abort semantics + OpenRouter provider plumbing (general-purpose agent).
  - Convex action polling feasibility + `scheduler.cancel` reality check (general-purpose agent).
- [Convex Actions docs](https://docs.convex.dev/functions/actions)
- [Convex Limits](https://docs.convex.dev/production/state/limits)
- [Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [Convex Agents Streaming](https://docs.convex.dev/agents/streaming)
- [AI SDK v6 streamText reference](https://sdk.vercel.ai/docs/reference/ai-sdk-core/stream-text)
- [AI SDK v6 stopping streams](https://sdk.vercel.ai/docs/ai-sdk-core/generating-text#stopping-streams)
- [@convex-dev/agent example: `streamAbort.ts`](https://github.com/get-convex/agent/blob/main/example/convex/chat/streamAbort.ts) — canonical mutation-triggered abort pattern (we reject this approach per D3; documented as alternative).
- [OpenRouter AI SDK provider](https://github.com/OpenRouterTeam/ai-sdk-provider)
- Project testing philosophy — `CLAUDE.md` § Testing philosophy.
