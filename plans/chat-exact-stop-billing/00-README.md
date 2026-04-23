# Chat Exact Stop Billing — Plan Set

Implementation plan set for **exact** billing of chat generations, including user-stopped streamed responses.

Target contract:

1. Every chat generation is billed from an **authoritative provider usage record**, not inferred from visible text.
2. A user-stopped generation is billed **exactly once** for the tokens actually consumed upstream.
3. The stopped-message UX remains intact; billing is reconciled independently of whether the message finished normally or was stopped.
4. Credit deductions remain auditable and idempotent.

This plan set is grounded in the current repo state on **April 23, 2026**, current AI SDK / Convex / OpenRouter docs, and comparative OSS chat behavior.

## Motivation / Gap Audit

Current verified gaps:

1. **Chat billing is completion-driven today.** The chat agent charges credits in `usageHandler`, which only runs when `output.usage` is surfaced by the agent stack. Donors: [convex/chat/agent.ts](../../convex/chat/agent.ts), [node_modules/@convex-dev/agent/src/client/start.ts](../../node_modules/@convex-dev/agent/src/client/start.ts).
2. **Stopped mid-stream generations are currently not billed.** The repo has an explicit contract test asserting `lifetimeUsed === 0` when abort lands before a step finishes. Donor: [convex/chat/messages.test.ts](../../convex/chat/messages.test.ts).
3. **Official AI SDK / Convex docs do not provide a turnkey “charge unfinished step on abort” contract.** `onAbort` exposes completed `steps`, not documented usage for the unfinished in-flight step. Sources: [AI SDK Stopping Streams](https://ai-sdk.dev/docs/advanced/stopping-streams), [AI SDK streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text), [Convex Usage Tracking](https://docs.convex.dev/agents/usage-tracking).
4. **OpenRouter exposes a documented authoritative path that the repo does not use yet.** Current verified facts:
   - streaming responses include usage in the **final chunk**,
   - every endpoint returns an **`X-Generation-Id`** response header (present on the initial HTTP response-headers frame, before any SSE body is parsed and therefore before any client-side abort can race the capture),
   - `/api/v1/generation?id=...` returns usage/cost metadata and includes a `cancelled` field that is correctly set for user-stopped generations.
   - `createOpenRouter({ fetch })` accepts a wrapped `fetch` (`node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts:308`), giving the runtime a supported place to read `X-Generation-Id` off the `Response` headers regardless of whether the stream later finishes or aborts.
   Donors: [node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts](../../node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts), [node_modules/@ai-sdk/provider-utils/src/post-to-api.ts](../../node_modules/@ai-sdk/provider-utils/src/post-to-api.ts).
   Sources: [OpenRouter Streaming](https://openrouter.ai/docs/api/reference/streaming), [OpenRouter Usage Accounting](https://openrouter.ai/docs/guides/administration/usage-accounting), [OpenRouter Generation API](https://openrouter.ai/docs/api/api-reference/generations/get-generation).
6. **AI SDK `onFinish` does not fire on abort.** Verified in `node_modules/ai/src/generate-text/stream-text.ts:1073-1088,1103-1141,1203-1217` and in `node_modules/ai/docs/09-troubleshooting/14-stream-abort-handling.mdx:7-44`. `providerMetadata.openrouter.responseId` is body-derived (`node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:700-705`) and therefore is **not** a reliable generation-id capture point for stopped runs. Any design that gates billing on `onFinish` or on `providerMetadata.responseId` will silently skip billing for every user stop. Use the fetch-wrapper path instead.
7. **`rawRequestResponseHandler` is not a real AI SDK option.** The name appears in `@convex-dev/agent`'s client notes but is not exposed on `streamText` in the installed version of `ai` — `grep rawRequestResponseHandler node_modules/ai node_modules/@ai-sdk` returns zero hits. Do not plan against it.
5. **Leading OSS chat apps mostly do not solve exact stop billing at the app layer.** Most either avoid app-layer billing entirely, or tie usage persistence to finalized responses / finish callbacks. Exact stop billing is not a common off-the-shelf pattern. Sources: [Vercel Chatbot](https://github.com/vercel/chatbot), [Open WebUI Analytics](https://docs.openwebui.com/features/administration/analytics/), [LibreChat Token Usage](https://www.librechat.ai/docs/configuration/token_usage).

## Locked Design Decisions

All decisions below are locked as of **April 23, 2026** unless a later numbered plan explicitly records a deviation.

1. **Exactness means provider-authoritative usage, not UI approximation.** Do not bill from streamed text length, delta count, or visible characters.
2. **Authoritative source:** use OpenRouter generation stats as the source of truth for token counts / cost, keyed by the `X-Generation-Id` captured from the **HTTP response headers of the initial OpenRouter request** via a `fetch` wrapper passed to `createOpenRouter({ fetch })`. Do not capture from `providerMetadata.openrouter.responseId` (body-derived; `undefined` on abort) and do not gate capture on `onFinish` (never fires on abort — see Gap 6 above).
3. **Business math remains current unless explicitly changed later.** Exactness applies to upstream usage input. Credits still flow through the repo’s current pricing / markup / ceiling rules unless the user separately asks to redesign billing policy. Donors: [convex/ai/lib/creditBilling.ts](../../convex/ai/lib/creditBilling.ts), [tests/lib/chat/credit-cost.test.ts](../../tests/lib/chat/credit-cost.test.ts).
4. **Idempotency is mandatory.** One provider generation id may create at most one billed usage record and at most one credit deduction.
5. **Do not couple billing completion to UI completion.** A stopped message can render as stopped while billing reconciles asynchronously from provider-authoritative stats.
6. **If cancelled generations cannot be reconciled exactly from provider data, stop and write a blocker.** No fallback approximation in this plan set.
7. **No legacy dual-path billing.** When cutover happens, chat must have one exact billing path, not “old usageHandler for some turns, new reconciliation for others,” except for a deliberately bounded transition step recorded in-plan.
8. **Behavior-first verification.** Tests must prove exact token/cost sourcing, idempotent deduction, and stopped-turn billing behavior with observable state. Never CSS-class assertions.

## Plan-File Inventory

- `00-README.md` — control document for the whole plan set.
- `01-authoritative-usage-source.md` — prove and lock the provider-authoritative usage source for normal and cancelled chat generations.
- `02-usage-ledger-and-reconciliation.md` — add an idempotent raw usage ledger plus reconciliation path keyed by generation id.
- `03-chat-runtime-cutover.md` — cut chat billing over from step-finish `usageHandler` semantics to exact provider-authoritative reconciliation.
- `PROMPTS.md` — copy-paste execution prompts for each numbered plan.

## Dependency Graph

```text
01 authoritative-usage-source
  -> 02 usage-ledger-and-reconciliation
       -> 03 chat-runtime-cutover
```

Reasoning:

- `01` implements the already-grounded capture + normalization contract around `X-Generation-Id` and OpenRouter generation stats.
- `02` depends on `01` because the ledger schema and idempotency keys must be designed around that authoritative identifier and reconciliation payload.
- `03` depends on both prior plans so runtime billing can safely cut over without re-deriving provider semantics or ledger invariants.

## Reuse / DRY Notes

Primary donors that must be reused instead of re-invented:

- Current chat billing path: [convex/chat/agent.ts](../../convex/chat/agent.ts), [convex/chat/provider.ts](../../convex/chat/provider.ts), [convex/chat/messages.ts](../../convex/chat/messages.ts).
- Current credit math: [convex/ai/lib/creditBilling.ts](../../convex/ai/lib/creditBilling.ts), [lib/ai/core](../../lib/ai/core), [tests/lib/chat/credit-cost.test.ts](../../tests/lib/chat/credit-cost.test.ts).
- Current credit ledger path: [convex/credits/internal.ts](../../convex/credits/internal.ts), [convex/schema.ts](../../convex/schema.ts).
- Current stop/abort contract tests: [convex/chat/messages.test.ts](../../convex/chat/messages.test.ts).
- Current provider resolution path: [lib/ai/server/providers](../../lib/ai/server/providers), [convex/chat/provider.ts](../../convex/chat/provider.ts).
- Current stopped-turn UI / runtime work: [components/extraction/chat/message-list.tsx](../../components/extraction/chat/message-list.tsx), driven by the library hook [@convex-dev/agent/react `useUIMessages`](../../node_modules/@convex-dev/agent/src/react/useUIMessages.ts).

Do **not** introduce:

- billing based on streamed text byte counts,
- duplicate credit deduction paths for the same generation,
- finish-only chat billing plus stop-specific ad hoc patches,
- legacy non-exact fallback logic.

## Testing Doctrine

This plan set follows the repo testing doctrine from `AGENTS.md`:

1. Test exact behavior through observable state: usage rows, generation ids, credit balances, credit transactions, and surfaced stop state.
2. Push normalization / idempotency logic into pure helpers and test those first.
3. Use Convex integration tests for generation reconciliation, ledger writes, and credit deductions.
4. Include at least one runtime smoke path for:
   - normal finish,
   - user stop mid-stream,
   - repeated reconciliation / retry / duplicate callback attempts.
5. Do not call the work complete until the relevant tests have been run and are green.
6. **Zero type errors is part of done.** If `tsc`, Convex typecheck, or local runtime compilation is red, the feature is not complete.
7. **Exactness must be verified against provider-authoritative fields.** A passing test that only checks “some credits were charged” is insufficient.

## Migration Stance

Schema work is expected and is additive by default, but dev data is disposable.

- If a new raw usage ledger table is added, do it cleanly and destructively if iteration demands it.
- Do not write backfill scripts or widen-then-narrow shims for dev data.
- If a ledger/table shape proves wrong during execution, revise the plan in git first and replace it cleanly.

## Delegation Policy

Subagents are mandatory for bounded research in this plan set.

- Delegate:
  - provider/OpenRouter contract reading,
  - AI SDK / Convex abort + usage contract mapping,
  - survey of OSS billing patterns,
  - isolated codebase mapping for current billing and credits internals.
- Keep in the main session:
  - TDD cycles,
  - schema edits,
  - commits,
  - final acceptance verification.

## Grounding Sources

Local source:

- [convex/chat/agent.ts](../../convex/chat/agent.ts)
- [convex/chat/messages.ts](../../convex/chat/messages.ts)
- [convex/chat/messages.test.ts](../../convex/chat/messages.test.ts)
- [convex/chat/provider.ts](../../convex/chat/provider.ts)
- [convex/ai/lib/creditBilling.ts](../../convex/ai/lib/creditBilling.ts)
- [convex/credits/internal.ts](../../convex/credits/internal.ts)
- [convex/schema.ts](../../convex/schema.ts)
- [tests/lib/chat/credit-cost.test.ts](../../tests/lib/chat/credit-cost.test.ts)
- [lib/chat/abort-signal.ts](../../lib/chat/abort-signal.ts)
- [node_modules/@convex-dev/agent/src/client/start.ts](../../node_modules/@convex-dev/agent/src/client/start.ts)

Official docs:

- [AI SDK: Stopping Streams](https://ai-sdk.dev/docs/advanced/stopping-streams)
- [AI SDK: streamText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK: abort handling caveat](https://ai-sdk.dev/docs/troubleshooting/stream-abort-handling)
- [Convex Agents: Streaming](https://docs.convex.dev/agents/streaming)
- [Convex Agents: Usage Tracking](https://docs.convex.dev/agents/usage-tracking)
- [OpenRouter: Streaming](https://openrouter.ai/docs/api/reference/streaming)
- [OpenRouter: Usage Accounting](https://openrouter.ai/docs/guides/administration/usage-accounting)
- [OpenRouter: API Overview](https://openrouter.ai/docs/api/reference/overview)
- [OpenRouter: Get Generation](https://openrouter.ai/docs/api/api-reference/generations/get-generation)

OSS comparison:

- [Vercel Chatbot](https://github.com/vercel/chatbot)
- [Open WebUI Analytics](https://docs.openwebui.com/features/administration/analytics/)
- [LobeChat discussion on usage isolation](https://github.com/lobehub/lobehub/discussions/8669)
- [LibreChat Token Usage](https://www.librechat.ai/docs/configuration/token_usage)
