# 06 — Agent orchestration: stepCountIs bump, system prompt, tool selection, call-site wiring

## Goal

Bring all of the previously-isolated pieces together at the `paperChat.streamText` call site:
1. Bump the agent's stop condition to `stepCountIs(5)` so multi-step tool loops can run.
2. Compose the conditional `tools` map per request based on the toggle, the model's capabilities, and the env (`TAVILY_API_KEY` presence).
3. Append a third system message instructing supplementary use when web search is on.
4. Capture per-step Tavily costs into the ledger via a new internal mutation.

## Scope

In:
- `convex/chat/agent.ts`: change `stopWhen: stepCountIs(1)` to `stepCountIs(5)`.
- `convex/chat/context.ts`: extend `buildSystemPromptForJob` to accept `webSearchEnabled` and conditionally append a third system message.
- New file `convex/chat/tools/select-web-search-tool.ts`: pure helper `pickWebSearchTool({ enabled, modelSupportsWebSearch, hasTavilyKey })` returning `"tavily" | "openrouter" | null`.
- New file `convex/chat/tools/select-web-search-tool.test.ts`.
- `convex/chat/messages.ts:288-293`: read `webSearchEnabled` from the chat job; read `model.supportedParameters` from the resolved model row.
- `convex/chat/messages.ts:388-522`: at the `paperChat.streamText` call, conditionally compose `tools: { web_search: ... }` based on the selector.
- New internal mutation `convex/chat/billing.ts:recordTavilyCost(generationId | threadId, credits)` that adds a `creditTransactions` row (billingType: `"search"`) and accumulates onto `chatGenerationUsages.metadata.tavilyCredits`.
- Tests for the selector and for the messages.ts wiring.

Out:
- The composer toggle UI (plan 07).
- Parts rendering in MessageRow (plan 08).

## Design

### Selector

```ts
// convex/chat/tools/select-web-search-tool.ts
export type WebSearchPath = "tavily" | "openrouter" | null;

export function pickWebSearchTool(args: {
  enabled: boolean | undefined;
  modelSupportsWebSearch: boolean;
  hasTavilyKey: boolean;
}): WebSearchPath {
  if (!args.enabled) return null;
  if (!args.modelSupportsWebSearch) return null;
  if (args.hasTavilyKey) return "tavily";
  return "openrouter";
}
```

Decision rules:
- Toggle off OR capability missing → no tool. Web search silently skipped.
- Toggle on AND Tavily key set → Path B (visible streaming + per-call cost).
- Toggle on AND Tavily key NOT set → Path A (citations only, no streaming step).

This keeps the env decision behind the selector so the messages.ts call site stays declarative.

### System prompt extension

```ts
// convex/chat/context.ts (excerpt)
export const buildSystemPromptForJob = internalQuery({
  args: { jobId: v.id("extractionJobs"), webSearchEnabled: v.optional(v.boolean()) },
  returns: ...,
  handler: async (ctx, { jobId, webSearchEnabled }) => {
    // ...existing 2 messages...
    const messages = [persona, corpus];
    if (webSearchEnabled) {
      messages.push({
        role: "system" as const,
        content: WEB_SEARCH_SYSTEM_INSTRUCTION,
      });
    }
    return messages;
  },
});

const WEB_SEARCH_SYSTEM_INSTRUCTION = [
  "WEB SEARCH POLICY:",
  "- The paper corpus above is your PRIMARY source. Always answer from the papers when possible and cite as [Pn].",
  "- A web_search tool is available only as a SUPPLEMENT. Use it when:",
  "  • The included papers do not cover an aspect of the user's question, OR",
  "  • You need to add adjacent on-topic context (e.g. a definition, a related dataset, a recent development).",
  "- Do NOT use web search for questions the corpus already answers.",
  "- When you cite a web result, do so by URL inline (markdown link). Never reuse [Pn] for web sources.",
  "- One short, focused web query per call. Avoid redundant searches.",
].join("\n");
```

The contextHandler in `convex/chat/agent.ts:26-47` (`buildChatContext`) needs to pass `webSearchEnabled` through to the query. Since `args` for `contextHandler` does not give us the job's `webSearchEnabled` directly, we read it from the job row via the existing `internal.chat.threads.getModelForThread` pattern OR add the field to that query's return shape — pick whichever is the smaller diff.

### `agent.ts` change

```ts
// convex/chat/agent.ts (line 60)
stopWhen: stepCountIs(5),
```

### `messages.ts` call-site wiring

Inside `generateResponse` (around line 388), after model resolution:

```ts
const job = await ctx.runQuery(internal.chat.threads.getJobByThread, { threadId });
const modelDoc = await ctx.runQuery(internal.models.queries.getById, { id: job.chatModelId });
const path = pickWebSearchTool({
  enabled: job.webSearchEnabled,
  modelSupportsWebSearch: modelSupportsWebSearch(modelDoc),
  hasTavilyKey: Boolean(process.env.TAVILY_API_KEY),
});

const tools = path === "tavily"
  ? {
      web_search: buildTavilyWebSearchTool({
        apiKey: process.env.TAVILY_API_KEY!,
        costSink: async (credits) => {
          await ctx.runMutation(internal.chat.billing.recordTavilyCost, {
            threadId,
            generationId: capturedGenerationId ?? undefined,
            credits,
          });
        },
      }),
    }
  : path === "openrouter"
  ? { web_search: buildOpenRouterWebSearchTool() }
  : undefined;

await paperChat.streamText(ctx, { threadId, userId }, {
  promptMessageId,
  model,
  abortSignal,
  maxRetries: 0,
  ...(tools ? { tools } : {}),
  // existing onChunk/onFinish/onAbort/onError unchanged
}, { saveStreamDeltas: { chunking: "word", throttleMs: 250 } });
```

### `recordTavilyCost` mutation

Internal. Takes `{ generationId?, threadId, credits }`. Looks up the user, deducts credits via `deductCreditsTransaction(billingType: "search")`. Persists onto the `chatGenerationUsages` row's `metadata.tavilyCredits` (cumulative) so the ledger lines up with the OpenRouter happy-path row.

The credits-per-USD conversion:
- 1 Tavily credit (basic) = $0.008
- 2 Tavily credits (advanced) = $0.016
- USD → credits via `convertUsdCostToCredits($0.008 * credits)` so the markup applies symmetrically with model billing.

### `WEB_SEARCH_SYSTEM_INSTRUCTION` location

Define at module top of `convex/chat/context.ts`. Single source of truth so it can be unit-tested with `expect(WEB_SEARCH_SYSTEM_INSTRUCTION).toMatch(/PRIMARY/i)`-style assertions and grep'd later for tuning.

## TDD sequence

Phase A — pure logic:

R1 — RED: `select-web-search-tool.test.ts`:
- toggle off → `null`
- toggle undefined → `null`
- toggle on + capability false → `null`
- toggle on + capability true + tavily key → `"tavily"`
- toggle on + capability true + no tavily key → `"openrouter"`

G1 — GREEN: implement `pickWebSearchTool`. Commits per pair.

R2 — RED: assert `WEB_SEARCH_SYSTEM_INSTRUCTION` content invariants:
- contains "PRIMARY" (uppercase, on the corpus precedence line)
- contains "[Pn]" (preserves citation format)
- contains "supplement" or "supplementary"
- never contains a request for web search by default ("only as a SUPPLEMENT")

G2 — GREEN: define the constant. Single commit.

R3 — RED: `buildSystemPromptForJob`-style integration test:
- `webSearchEnabled: false` → returns 2 messages (existing behavior preserved)
- `webSearchEnabled: true` → returns 3 messages, third one has the WEB_SEARCH_SYSTEM_INSTRUCTION as content
- `webSearchEnabled: undefined` → behaves like false

G3 — GREEN: extend the query. Commit.

Phase B — call-site wiring (one commit per logical unit):

U1 — Bump `stopWhen: stepCountIs(5)` in `agent.ts`. One-line commit `feat(chat): [plan-06] bump stepCountIs to 5 to enable tool loops`.

U2 — Add the mutation `recordTavilyCost` in `billing.ts`. Test: deducts the right credits, idempotent on duplicate calls (uses an internal dedupe key composed of `generationId + searchIndex` if available).

U3 — Wire the selector + tools composition in `messages.ts`. Commit `feat(chat): [plan-06] compose tools map per request based on toggle and capability`.

U4 — Plumb `webSearchEnabled` through `buildChatContext` → `buildSystemPromptForJob`. Commit `feat(chat): [plan-06] plumb webSearchEnabled to system prompt builder`.

## Files touched

- `convex/chat/agent.ts` (~ 1 LOC change)
- `convex/chat/context.ts` (~ 30 LOC)
- `convex/chat/messages.ts` (~ 40 LOC additions, in `generateResponse`)
- `convex/chat/billing.ts` (new internal mutation, ~ 80 LOC)
- `convex/chat/tools/select-web-search-tool.ts` (new, ~ 15 LOC)
- `convex/chat/tools/select-web-search-tool.test.ts` (new, ~ 50 LOC)
- `convex/chat/context.test.ts` (extension, ~ 40 LOC)
- `convex/chat/messages.test.ts` (extension, ~ 80 LOC for the toggle path)

## Migration stance

None — additive code. The `stepCountIs(5)` change is forward-only; existing single-step turns continue to work because they emit a `finish-step` after the assistant message and the loop terminates.

## Test plan

- All unit/integration tests above.
- `convex/chat/messages.test.ts`: extend with three scenarios:
  1. Toggle off → no `tools` arg passed to `paperChat.streamText` (assert via spy).
  2. Toggle on, capability true, Tavily key set → `tools.web_search` is the Tavily-shaped tool (`type: "function"`).
  3. Toggle on, capability false → no `tools`. (User opts in but model can't; we silently downgrade.)
- Integration: send a message with toggle on, mock the model to emit a `tool_calls` chunk that triggers a Tavily search; confirm `tool-input-available` and `tool-output-available` parts land on the assistant message; confirm `recordTavilyCost` runs and creates a `creditTransactions` row with `billingType: "search"`.

## Acceptance criteria

- [ ] `agent.ts` uses `stepCountIs(5)`.
- [ ] `pickWebSearchTool` returns the documented union for all five truth-table cases.
- [ ] `WEB_SEARCH_SYSTEM_INSTRUCTION` contains the locked policy text and is appended only when `webSearchEnabled === true`.
- [ ] `messages.ts` reads `webSearchEnabled` from the job row and forwards it to both the prompt builder and the tools composition.
- [ ] When the path is `"tavily"`, `tools.web_search` is a `tool({})` with `type: "function"`, `inputSchema: { query: string }`.
- [ ] When the path is `"openrouter"`, `tools.web_search.id === "openrouter.web_search"`.
- [ ] When the path is `null`, no `tools` arg is passed.
- [ ] `recordTavilyCost` deducts via `deductCreditsTransaction(billingType: "search")` and is idempotent on retry.
- [ ] All tests pass; `tsc --noEmit` clean.

## Known pitfalls

- **Do not** read `process.env.TAVILY_API_KEY` from inside the selector. Read it once at the messages.ts call site and pass `hasTavilyKey: Boolean(env)` into the selector. Selector stays pure and testable.
- **`stepCountIs(5)` does NOT force 5 steps.** It caps at 5. Single-turn questions still terminate at step 1 because the model has nothing more to do. The cap exists to bound runaway tool loops.
- **Cost capping**: 5 steps × 5 results × $0.008 = up to $0.20 in Tavily fees per turn worst case. The pre-flight floor `ESTIMATED_CREDITS_PER_CHAT_MESSAGE` (currently 200) is fine for typical single-search turns; if turns are observed to consistently exceed this, raise the floor in a follow-up. Do not raise it speculatively.
- **`saveStreamDeltas` interaction with tool parts**: per `node_modules/@convex-dev/agent/src/client/streaming.ts:419-436`, `compressUIMessageChunks` only compresses text/reasoning deltas. Tool parts pass through uncompressed. No special opts needed beyond the existing `chunking: "word", throttleMs: 250`.
- **Tool ctx**: the Tavily tool does NOT need Convex `ctx`; use `tool({})` from `ai`, not `createTool({})` from `@convex-dev/agent`. The orchestrator captures cost via the `costSink` callback closure, which closes over `ctx.runMutation`. This is intentional — the tool itself stays pure and unit-testable.
- **Abort propagation**: the AI SDK passes `abortSignal` to the tool's `execute(input, { abortSignal })`. Plan 05 already wires this. No work here.
- **Do not** change the existing `onAbort`/`onError`/`onChunk` callbacks in `messages.ts`. They handle the abort/error contract precisely; only add the `tools` composition.
- **Env read at runtime**: `process.env.TAVILY_API_KEY` is evaluated each request — do NOT cache at module load. Convex actions can be deployed independently of env updates; live re-read prevents stale-key surprises after key rotation.
