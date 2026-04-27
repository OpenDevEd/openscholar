# Chat Stop / Regenerate / Clear — Plan Set

Remediation plan set for the chat turn lifecycle so it matches the intended UX contract:

1. `Stop` actually stops generation.
2. The stopped turn renders as **stopped**, not **error**.
3. `Regenerate` reuses that same logical assistant turn instead of leaving residue.
4. `Delete chat history` clears **both** persisted messages and stream artifacts while preserving the chat thread, paper set, and selected model.

This plan set is grounded in the current repo state on **April 23, 2026**, current AI SDK / Convex docs, and comparative OSS chat behavior.

## Motivation / Gap Audit

Current gaps are specific and verified:

1. **Stop is transport-real but app-indirect.** The button calls `abortGeneration`, which only flips `job.shouldAbort`; the running action notices it on a poll loop before aborting the provider request. That creates a visible race window after click. Donors: [components/extraction/chat/message-composer.tsx](../../components/extraction/chat/message-composer.tsx), [convex/chat/messages.ts](../../convex/chat/messages.ts), [lib/chat/abort-poller.ts](../../lib/chat/abort-poller.ts).
2. **Stopped content is intentionally preserved, but the turn lifecycle is incomplete.** The current stack preserves pre-abort deltas and exposes a stopped pill path, which is good, but it does not fully own the turn as a first-class “stopped assistant reply” contract across regenerate and clear.
3. **Regenerate only deletes the latest assistant message doc.** It does not remove same-turn stream artifacts first, so an aborted stream artifact can compete with the regenerated answer. Donor: [convex/chat/messages.ts](../../convex/chat/messages.ts).
4. **Clear deletes messages only.** It leaves stream rows and stream deltas behind; live verification on April 23, 2026 confirmed a thread with an empty messages page but surviving aborted streams. Donors: [convex/chat/messages.ts](../../convex/chat/messages.ts), [node_modules/@convex-dev/agent/src/component/messages.ts](../../node_modules/@convex-dev/agent/src/component/messages.ts), [node_modules/@convex-dev/agent/src/component/streams.ts](../../node_modules/@convex-dev/agent/src/component/streams.ts).
5. **Coverage is thin at the exact failure points.** The repo tests abort preservation and query merging, but not “regenerate after stopped turn without residue” and not “clear after aborted stream removes all artifacts.”

## Locked Design Decisions

All decisions below are locked as of **April 23, 2026** unless a later numbered plan explicitly records a deviation.

1. **Product contract:** stopped turns remain visible with partial text and a stopped indicator. They are not rendered as ordinary failures.
2. **Transport contract:** actual stop continues to rely on `AbortSignal`. Do not treat component-side `abortByOrder` or stream-row mutation alone as sufficient to stop upstream model execution.
3. **Architecture constraint:** the current Convex action architecture cannot be externally interrupted without polling state from inside the running action. This plan set does **not** rewrite chat generation out of Convex actions.
4. **Regenerate contract:** “same message” means the same logical assistant turn/order, not necessarily the same database row id. Regenerating must first remove artifacts for the prior assistant turn, then reschedule generation from the same prior user prompt.
5. **Clear contract:** clear-history keeps the chat thread itself alive. It deletes message docs plus all stream rows/deltas for that thread. Do **not** call helpers that delete the thread row.
6. **No schema expansion by default:** prefer existing thread id, message order, and stream tables over adding compatibility fields. If a new schema field becomes necessary during execution, the plan must be revised in git first.
7. **Behavior-first verification:** tests assert on observable behavior, ARIA, and `data-*` contracts. Never on CSS classes or Tailwind literals.
8. **Use `@convex-dev/agent/react`'s `useUIMessages`, NOT AI SDK's `useChat`.** AI SDK's `useChat` ships a `DefaultChatTransport` that talks to a Next.js HTTP route handler returning a UI message stream. Our generation runs in a Convex `internalAction` (`convex/chat/messages.ts:generateResponse`) and the reactive read path comes from a Convex query subscription, not an HTTP route. `useUIMessages` is the Convex-native equivalent that subscribes to `listThreadMessages` and merges in the agent component's stream sync. Re-routing through `useChat` would require writing a custom `Transport` that ultimately just round-trips through Convex anyway — net loss. This decision is locked: any future "should we move to useChat?" discussion needs to start by replacing the Convex-action backend, not the React hook.

## Plan-File Inventory

- `00-README.md` — control document for the whole plan set.
- `01-stop-runtime-contract.md` — tighten the stop runtime contract inside the current Convex action architecture.
- `02-regenerate-and-clear-artifacts.md` — remove same-turn residue for regenerate and fully purge stream artifacts on clear.
- `03-ui-contract-and-verification.md` — lock the stopped-turn UI contract and add end-to-end verification around stop / regenerate / clear.
- `PROMPTS.md` — copy-paste execution prompts for each numbered plan.

## Dependency Graph

```text
01 stop-runtime-contract
  -> 02 regenerate-and-clear-artifacts
       -> 03 ui-contract-and-verification
```

Reasoning:

- `01` owns the runtime stop semantics and any polling / abort tightening.
- `02` depends on the stop contract being stable so it can safely treat an aborted assistant turn as a durable turn to replace or purge.
- `03` depends on both backend behaviors so UI tests can assert the final product contract instead of compensating for transient backend bugs.

## Reuse / DRY Notes

Primary donors that must be reused instead of re-invented:

- Existing stop path: [components/extraction/chat/message-composer.tsx](../../components/extraction/chat/message-composer.tsx), [convex/chat/messages.ts](../../convex/chat/messages.ts), [lib/chat/abort-poller.ts](../../lib/chat/abort-poller.ts), [lib/chat/abort-signal.ts](../../lib/chat/abort-signal.ts).
- Existing stopped UI path: [components/extraction/chat/message-list.tsx](../../components/extraction/chat/message-list.tsx), [components/extraction/chat/aborted-pill.tsx](../../components/extraction/chat/aborted-pill.tsx), [components/extraction/chat/chat-error-alert.tsx](../../components/extraction/chat/chat-error-alert.tsx).
- Existing regenerate entry point: [convex/chat/messages.ts](../../convex/chat/messages.ts).
- Agent-library message deletion path: [node_modules/@convex-dev/agent/src/client/index.ts](../../node_modules/@convex-dev/agent/src/client/index.ts), [node_modules/@convex-dev/agent/src/component/messages.ts](../../node_modules/@convex-dev/agent/src/component/messages.ts).
- Agent-library stream deletion path: [node_modules/@convex-dev/agent/src/component/streams.ts](../../node_modules/@convex-dev/agent/src/component/streams.ts).
- Existing chat-stop-streaming plan set as a donor for prior research and test style: [plans/chat-stop-streaming/00-README.md](../chat-stop-streaming/00-README.md), [plans/chat-stop-streaming/01-action-abort-wiring.md](../chat-stop-streaming/01-action-abort-wiring.md), [plans/chat-stop-streaming/02-aborted-ui-state.md](../chat-stop-streaming/02-aborted-ui-state.md).

Do **not** introduce:

- a second “stop” mutation,
- a second chat read model,
- thread-deleting helpers for clear-history,
- legacy compatibility paths for “old clear” or “old regenerate.”

## Testing Doctrine

This plan set follows the repo testing doctrine from `AGENTS.md` / `CLAUDE.md`:

1. Prefer behavioral assertions and durable contracts: visible text, ARIA roles, `data-*`, store state.
2. Push reusable turn-resolution logic into a pure helper when it simplifies regenerate / clear targeting; test that helper first.
3. Use Convex integration tests for mutation/query/action behavior that crosses component boundaries.
4. Add one real smoke verification path for:
   - stop during streaming,
   - regenerate on the stopped turn,
   - clear after a stopped turn.
5. Never call the work complete without a green test run for touched slices.
6. **Zero type errors is part of done.** If `tsc`, Convex typecheck, or Next/Convex dev compilation is red, the plan is not complete, regardless of local unit-test results.
7. **A broken dev server is a blocker, not a follow-up.** If Convex or Next refuses to load the changed code, stop feature work and fix the compile/type errors first.

## Typecheck / Runtime Doctrine

This is explicit because the failure mode is expensive:

1. Local code that passes Vitest but fails Convex/TypeScript compilation is **not acceptable**.
2. For any plan that touches Convex code, completion requires:
   - relevant tests green,
   - Convex typecheck green,
   - the running Convex dev server actually loading the updated code.
3. For any plan that touches Next/client code, completion requires:
   - relevant tests green,
   - Next compilation green,
   - no knowingly broken local runtime state left behind.
4. If a change introduces type errors in unrelated-looking generic wrappers or component table ids, that is still the executor's responsibility. Do not leave those errors for “later.”
5. If the dev server is still serving old behavior because compilation failed, treat the feature as **not implemented**.

## Migration Stance

None by default.

- The target behavior is achievable against the current schema and component tables.
- No backfills.
- No compatibility shims.
- If execution discovers a truly necessary schema field, revise the relevant numbered plan first and keep the migration stance destructive and dev-only.

## Delegation Policy

Subagents are mandatory for bounded research in this plan set.

- Any investigation needing more than ~3 file reads or ~3 greps should be delegated.
- Good delegation targets:
  - mapping current regenerate callers / assumptions,
  - extracting exact agent-library stream deletion contracts,
  - gathering official docs / OSS references for stop and regenerate semantics,
  - reading tests in adjacent areas and summarizing reusable patterns.
- Keep in the main session:
  - TDD red-green cycles,
  - plan-file edits,
  - commits,
  - final acceptance verification.

## Grounding Sources

Local source and live evidence:

- [convex/chat/messages.ts](../../convex/chat/messages.ts)
- [convex/chat/messages.test.ts](../../convex/chat/messages.test.ts)
- [components/extraction/chat/message-composer.tsx](../../components/extraction/chat/message-composer.tsx)
- [components/extraction/chat/message-list.tsx](../../components/extraction/chat/message-list.tsx)
- [components/extraction/chat/message-actions.tsx](../../components/extraction/chat/message-actions.tsx)
- [components/extraction/chat/clear-conversation.tsx](../../components/extraction/chat/clear-conversation.tsx)
- [lib/chat/abort-poller.ts](../../lib/chat/abort-poller.ts)
- [lib/chat/abort-signal.ts](../../lib/chat/abort-signal.ts)
- [node_modules/@convex-dev/agent/src/component/messages.ts](../../node_modules/@convex-dev/agent/src/component/messages.ts)
- [node_modules/@convex-dev/agent/src/component/streams.ts](../../node_modules/@convex-dev/agent/src/component/streams.ts)
- PM2 / live-thread evidence gathered on April 23, 2026 for job `k573pdnx273ptt19dykezm87b9857h2f` and thread `m575tk4ta6yzjygh4bhfkjf3eh85710n`.

Official docs:

- [AI SDK: Stopping Streams](https://ai-sdk.dev/docs/advanced/stopping-streams)
- [AI SDK: streamText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK UI: Chatbot](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot)
- [Convex Agents: Streaming](https://docs.convex.dev/agents/streaming)
- [Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)

Leading OSS behavior references:

- [text-generation-webui wiki: Chat Tab](https://github.com/oobabooga/textgen/wiki/01-%E2%80%90-Chat-Tab)
- [Open WebUI issue #456](https://github.com/open-webui/open-webui/issues/456)
- [Blazity shadcn-chatbot-kit](https://github.com/Blazity/shadcn-chatbot-kit)
