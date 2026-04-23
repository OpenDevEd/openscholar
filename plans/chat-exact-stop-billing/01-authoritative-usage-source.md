# Plan 01 — Authoritative Usage Source

**Depends on:** nothing. **Blocks:** 02, 03.

## Deviation — April 23, 2026

The first execution pass of this plan (commits up to and including `a5c8e3b4` plus the preceding uncommitted billing infrastructure) attempted capture through `providerMetadata.openrouter.responseId` inside `streamText`'s `onFinish` callback. That path is **unreachable on abort**:

- `onFinish` does not fire when the stream is cancelled via `AbortSignal` (AI SDK v5, confirmed in `node_modules/ai/src/generate-text/stream-text.ts:1073-1088,1103-1141,1203-1217`).
- `providerMetadata.openrouter.responseId` is parsed from SSE body events (`node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:700-705`), so it is `undefined` when the stream aborts before those events arrive.

As a result, user-stopped turns captured no generation id, scheduled no reconciliation, and were never billed. This revision locks in the abort-safe capture point — a `fetch` wrapper around `createOpenRouter({ fetch })` that reads `X-Generation-Id` from HTTP response headers — and removes the `onFinish`-gated billing branch. `@convex-dev/agent` does **not** expose a `rawRequestResponseHandler` in the installed version of `ai`; ignore any earlier design note that referenced it.

## Goal

Implement the exact authoritative usage-source contract for chat generations, including user-stopped streams.

Concretely:

- capture the OpenRouter generation identifier from the raw response headers already exposed by the current stack,
- normalize OpenRouter generation stats into a repo-owned exact-usage helper contract,
- wire a focused retrieval path for authoritative usage/cost by generation id,
- lock the exact fields later phases will depend on.

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
   This is already grounded:
   - the repo currently routes chat through OpenRouter,
   - OpenRouter documents `X-Generation-Id` for all endpoints,
   - OpenRouter documents `/api/v1/generation?id=...`,
   - generation stats include usage/cost plus `cancelled`.

2. **Capture generation identity before finish-only hooks.**
   The capture point is a `fetch` wrapper passed to `createOpenRouter({ fetch })`:
   - `@openrouter/ai-sdk-provider` accepts a custom `fetch` (`node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts:308`),
   - the `Response` carries `X-Generation-Id` in its headers on the initial HTTP response frame, before any SSE body is parsed,
   - headers are therefore available even if the consumer later aborts the stream.

   Reject these alternatives (do not use them):
   - `providerMetadata.openrouter.responseId` — body-derived at `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:700-705`; `undefined` on abort.
   - `streamText`'s `onFinish` — does not fire on abort (`node_modules/ai/src/generate-text/stream-text.ts:1203-1217`, `node_modules/ai/docs/09-troubleshooting/14-stream-abort-handling.mdx:7-44`).
   - `rawRequestResponseHandler` — does not exist in the installed `ai` package.
   - `onAbort({ steps })` alone — `steps` is empty on mid-stream abort because no step reached `finish-step`.

3. **Normalize provider usage into a repo-owned shape.**
   Create a small pure helper that maps OpenRouter generation stats into the exact fields later plans need:
   - generation id,
   - cancelled flag,
   - prompt/completion/reasoning/cached token counts,
   - authoritative cost,
   - finish reason / native finish reason.

4. **Lock the runtime donor contract.**
   At the end of this plan, later phases should not need to rediscover where generation ids come from or how OpenRouter generation stats are normalized.

## TDD Sequence

Phase A — pure logic first:

1. Add a normalization helper for provider-authoritative generation stats.
2. Write unit tests for:
   - complete generation payload,
   - cancelled generation payload,
   - missing optional fields,
   - invalid / incomplete payload rejection.

Phase B — provider/runtime implementation:

1. Add a pure `withGenerationIdCapture` helper that wraps `fetch` and calls a sink with the `X-Generation-Id` response-header value. Unit-test it with a mocked `fetch` for both presence and absence of the header.
2. Thread an optional `fetch` override through `lib/ai/server/providers.ts` (`getProviderModel`) and through `convex/chat/provider.ts` (`resolveOpenRouterModel`) so the chat runtime can pass a per-request wrapped fetch into `createOpenRouter`.
3. In `convex/chat/messages.ts:generateResponse`, create a per-action `capturedGenerationId: string | undefined`, pass `withGenerationIdCapture((id) => { capturedGenerationId = id; })` into the provider, and after the `try { await paperChat.streamText(...) } catch {}` block — regardless of whether the stream finished, aborted, or errored — if `capturedGenerationId` is set, call `captureGenerationFromResponse` and schedule `reconcileGenerationUsage`.
4. Delete the `onFinish`-gated billing branch. Reconciliation is the single exact billing path.
5. Add a messages.test.ts test that drives a mid-stream abort and asserts (a) `chatGenerationUsages` row exists for the captured id; (b) `fetchOpenRouterGeneration` is called with that id; (c) after the mocked `cancelled: true` response lands, a `creditTransactions` row with `billingSource: "openrouter_generation_api"` exists.

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
- The provider generation id is captured from raw response headers early enough for stopped runs.
- Normalization into a repo-owned exact-usage shape is implemented and tested.
- A focused retrieval path exists for authoritative generation stats by generation id.
- Relevant tests are green.
- TypeScript / Convex compilation is green.

## Known Pitfalls

- Do not confuse OpenRouter’s final SSE usage chunk with the exact stop path; a user abort may prevent receiving it locally.
- Do not assume AI SDK `onAbort` yields unfinished-step usage. The docs do not guarantee that.
- Do not design later billing around visible text deltas.
- Do not capture provider metadata `responseId` and assume it equals `X-Generation-Id` unless the implementation proves they are the same field.
