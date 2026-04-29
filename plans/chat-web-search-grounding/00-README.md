# Chat Web Search & Grounding — Plan Set

Adds an opt-in web search affordance to the chat. The corpus stays the primary source; web search is a **supplementary** lookup the model can perform when the included papers do not cover an aspect of the user's question, or to add adjacent on-topic context. Per-thread toggle, capability-gated by model, cost-accounted in the existing credit ledger, and rendered with visible streaming tool steps that show the live search query and per-call cost.

## 1. Motivation / gap audit

The chat at `convex/chat/` is a single-step, single-source experience: paper corpus injected as XML in the system prompt, then the LLM answers with `[Pn]` citations. There is **no web search**, **no tool calling** (`stopWhen: stepCountIs(1)` at `convex/chat/agent.ts:60`), and **no parts-aware UI rendering** (the `MessageRow` at `components/extraction/chat/message-list.tsx:383-516` treats messages as a single text blob). The infrastructure for this is already largely in place — `models.webSearchPrice` exists, `creditTransactions.billingType: "search"` is a live enum value, `chatGenerationUsages.totalCostUsd` is part of the abort-fallback billing path — but none of it is consumed for chat web search yet.

Source-of-truth facts established during research:

- The OpenRouter provider (`@openrouter/ai-sdk-provider@2.8.0`) ships `openrouter.tools.webSearch({ maxResults, searchPrompt, engine })` — accepts ONLY those three args (`node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts:705-716`). Other knobs go through settings-level `plugins`. The factory id is `"openrouter.web_search"` → API body `{ type: "openrouter:web_search" }`.
- OpenRouter web search is **server-side and pre-text** — it does NOT emit AI-SDK `tool-input-streaming → tool-output-available` parts. Only `source-url` parts via `url_citation` annotations on the assistant message (`dist/index.mjs:4006-4022`).
- Custom `tool({ inputSchema, execute })` (e.g., a Tavily wrapper) DOES stream `tool-input-start`/`tool-input-delta`/`tool-input-available`/`tool-output-available` parts (`dist/index.mjs:4033-4156`). This is the only path that gives the user a visible "Searching the web…" step with the live query.
- `usage.cost` lands in `providerMetadata.openrouter.usage.cost` on the AI SDK `finish` event when `usage: { include: true }` is set on the model settings (`dist/index.d.ts:393-398`, `dist/index.mjs:3760-3777, 4257-4264`). It is the **all-in** cost (token cost + provider tool cost). Currently, `convex/chat/billing.ts:333` (`billGenerationFromSdkUsage`) bills purely from token counts × per-model pricing — it does NOT read `providerMetadata.openrouter.usage.cost`. Web-search cost would silently underbill on the happy path. The abort-fallback path (`settleGenerationUsage` at `convex/chat/billing.ts:505`) already reads `total_cost` from `/api/v1/generation` and bills via `convertUsdCostToCredits` — that path is correct as-is.
- `@convex-dev/agent@0.6.1` is fully AI-SDK-v6-parts-aware: tool-call/tool-result, source-url, source-document, reasoning, and `step-start` round-trip via the persistence path (`UIMessages.ts:503-522, 687-690`) AND via the live-streaming path (`streaming.ts:419-436` only compresses text/reasoning deltas). `useUIMessages` returns one `UIMessage` per assistant turn whose `parts` array contains every part type. `tools`, `stopWhen`, `providerOptions` are pass-through (`streamText.ts:114-120`).
- Capability gating uses `models.supportedParameters` already populated by `convex/models/sync.ts:109` from OpenRouter's `/api/v1/models` `supported_parameters` array. A model supports the OpenRouter server tool iff `supportedParameters.includes("tools")`. **No new schema column is needed.**
- `nuqs` is installed and used; the project bans `useEffect` for state sync. The composer toolbar at `components/extraction/chat/message-composer.tsx:274-339` is the insertion point for the toggle. The chat already uses `components/ai-elements/` for `Streamdown`-based message rendering, plus `Shimmer`, `InlineCitation`, `PromptInput`, etc. — extend that directory for new tool-step components.

## 2. Locked design decisions (2026-04-29)

1. **Toggle scope: per-thread.** Stored as `extractionJobs.webSearchEnabled?: boolean`. Patched by a single mutation `setChatWebSearchEnabled(threadId, enabled)`. Read at the top of `generateResponse` (`convex/chat/messages.ts:288-293`) along with the existing job metadata.
2. **Two implementations behind one user-facing toggle**: Path A = OpenRouter server tool (`openrouter.tools.webSearch({...})`); Path B = custom Tavily tool wrapped via `tool({ execute })`. The two coexist; the backend selects based on env (`TAVILY_API_KEY` set ⇒ Path B; otherwise Path A). User sees one button.
3. **Path B is the default when both are available** because the user-facing requirement is a visible streaming tool-call step with a live cost annotation (§ TL;DR feature 7 of research). Path A only emits citations after-the-fact and cannot satisfy that UX.
4. **Web search is supplementary, not primary.** The system prompt instructs the model to use the corpus first and reach for the tool only to fill gaps or to add adjacent on-topic context. Citations stay `[Pn]` for papers; web hits get a separate URL-chip rendering at the message footer.
5. **Cost is read from `providerMetadata.openrouter.usage.cost` on the happy path.** `billGenerationFromSdkUsage` is extended with an optional `totalCostUsd?: number`; when present, it is the source of truth (markup applied, converted to credits via `convertUsdCostToCredits`). When absent (provider-options misconfigured, older response shape) it falls back to the existing token-based math. Abort path already reads `total_cost` from `/api/v1/generation`.
6. **Capability gate**: the toggle is hidden/disabled when the selected model lacks `"tools"` in `supportedParameters`. No new column. Helper `modelSupportsWebSearch(model)` lives at `lib/chat/web-search-capability.ts`.
7. **Step cap**: `stopWhen: stepCountIs(5)` on the agent. Capped at 5 to prevent runaway loops; 5 is enough for one search → reflect → second search → answer.
8. **No separate "web sources" tab** in the sources panel. Web `source-url` parts render inline at the bottom of the assistant message as URL chips (favicon + title + host).
9. **Cost annotations are inline on the tool-step component**: `Searching the web · ~$0.02 / ~3 credits` while in `input-available`, swapped to actual cost on `output-available`.
10. **Migration stance: destructive.** Any schema rejection on existing rows is resolved by wiping affected rows, never by widen-then-narrow.
11. **Visible step UI ⇒ Path B (Tavily) by default.** If `TAVILY_API_KEY` is unset, fall back gracefully: the toggle still works using Path A but renders only the source-url chip footer with no live "Searching…" step. Operator sets the env var to unlock the richer experience.
12. **No reasoning-part rendering changes** in this plan set. Tool/source/step rendering only. Reasoning rendering is out of scope and can be added later.

## 3. Plan-file inventory

| # | Plan | Slice |
|---|---|---|
| 01 | `01-schema-and-toggle-field.md` | Add `extractionJobs.webSearchEnabled?: boolean` and the pure-logic capability helper `modelSupportsWebSearch(model)`. |
| 02 | `02-billing-prefer-provider-cost.md` | Set `usage: { include: true }` on the chat model factory; extend `billGenerationFromSdkUsage` to accept an optional `totalCostUsd?` and prefer it; read `providerMetadata.openrouter.usage.cost` in `onFinish`. |
| 03 | `03-toggle-mutation.md` | Convex public mutation `setChatWebSearchEnabled(threadId, enabled)` — auth-gated, idempotent, surfaces the new field on the existing job row. |
| 04 | `04-openrouter-tool-factory.md` | Path A. Pure factory `buildOpenRouterWebSearchTool({ academicBias, maxResults })` → `Tool` produced by `openrouter.tools.webSearch({...})`. Configuration constants. No call-site changes. |
| 05 | `05-tavily-tool-factory.md` | Path B. Tavily HTTP client + custom `tool({ inputSchema, execute })` factory `buildTavilyWebSearchTool({ academicBias, maxResults })`. Cost capture via a sidecar Convex mutation that records search counts on `chatGenerationUsages.metadata`. No call-site changes. |
| 06 | `06-agent-orchestration.md` | Bump `agent.ts` to `stepCountIs(5)`. Add a `webSearchEnabled` parameter to `buildSystemPromptForJob` that conditionally appends a third system message instructing supplementary use. Build the `pickWebSearchTools(...)` selector pure-logic. Wire conditional `tools` map at the `paperChat.streamText` call site in `convex/chat/messages.ts:388`. |
| 07 | `07-composer-toggle-ui.md` | New `WebSearchToggle` ghost-pill button next to the model picker in `components/extraction/chat/message-composer.tsx:274-339`. Lucide `Globe` icon, shadcn `Tooltip`, `aria-pressed`. Capability-gated by model `supportedParameters`. Reads/writes via the new mutation. No `useEffect`. |
| 08 | `08-message-row-parts-rendering.md` | Refactor `MessageRow` at `components/extraction/chat/message-list.tsx:383-516` to iterate `parts[]`. New `<ToolStep>` component (under `components/ai-elements/tool-step.tsx`) for `tool-${name}` parts with state machine and live cost label. New `<WebSourceChips>` rendered at message footer for `source-url` parts. `step-start` collapsed by default, visible only between tool-call and text. |

`PROMPTS.md` ships the copy-paste execution prompt for each numbered plan.

## 4. Dependency graph

```
01 (schema + capability helper)  ─┐
02 (billing cost reader)          ─┤
                                   │
03 (toggle mutation)  ── depends on 01
                                   │
04 (OpenRouter factory)  ── independent
05 (Tavily factory)  ── independent
                                   │
06 (orchestration)  ── depends on 01, 02, 03, 04, 05
                                   │
07 (composer toggle UI)  ── depends on 03 (mutation) + 01 (capability helper)
08 (parts rendering)  ── depends on 06 (because parts only flow once tools are wired)
```

Suggested execution order: 01, 02, 03 in parallel waves (no inter-dependencies between them); 04 and 05 in parallel; then 06; then 07 and 08 in parallel.

## 5. Reuse / DRY notes

- **Do NOT** add a new `capabilities.webSearch?: boolean` column to `models`. `supportedParameters` already exists (`convex/models/sync.ts:109`) and OpenRouter's `supported_parameters.includes("tools")` is the authoritative signal for both Path A and Path B.
- **Do NOT** add a new sources panel tab for web sources. Render inline at the message footer only.
- **Do NOT** create a new Convex table for tool-call billing. `chatGenerationUsages.metadata` (untyped JSON-ish per existing usage) is enough for `webSearchRequests`, `webSearchEngine`, `tavilySearches`. If new analytics queries demand a column later, promote then.
- **Reuse**: `convertUsdCostToCredits()` in `convex/ai/lib/creditBilling.ts`. `AI_COST_MARKUP = 1.3` from `convex/lib/constants.ts`. `deductCreditsTransaction` from `convex/credits/`. `buildChatBillingMetadata` in `convex/chat/billing.ts:129`.
- **Reuse**: `Streamdown` for markdown text parts; existing `<PaperCitation>` chip styles for the new `<WebSourceChip>` (different icon, same chrome).
- **Reuse**: `components/ai-elements/shimmer.tsx` for the live "Searching…" affordance during `input-streaming`/`input-available`.
- **Reuse**: shadcn `Tooltip` (already in `components/ui/tooltip.tsx`), `Switch` (`components/ui/switch.tsx`) is NOT used here — the toggle is a ghost pill button matching the model picker, not a Switch. Match the model picker's `h-7 gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground` chrome.
- **Reuse**: `nuqs` is installed, but the toggle is per-thread state, NOT URL state — Convex mutation is the right path. Do not introduce URL coupling.

## 6. Testing doctrine

- Pure logic helpers (`modelSupportsWebSearch`, `pickWebSearchTools`, `pickProviderCostFromMetadata`, `formatWebSearchCostLabel`, Tavily client argument builder, system-prompt composer) are TDD: red → green → refactor → commit, one commit per green.
- Convex mutations and actions tested via `convexTest()` harness (existing pattern in `convex/chat/billing.integration.test.ts`).
- React components tested via `@testing-library/react` with `vitest`. Assertions on `data-*` attributes, ARIA, and `getByRole`/`getByText` only — never on Tailwind class strings (CLAUDE.md testing philosophy).
- New `data-*` contracts to introduce: `data-tool-state` on the tool-step component; `data-web-search-enabled` on the toggle; `data-source-type="web"` on web URL chips; `data-step-boundary` on visible `step-start` separators.
- E2E happy path covered by extending `convex/chat/messages.test.ts` with a "web search on, model supports tools, model emits source-url and tool-call parts, MessageRow renders both, billing prefers `providerMetadata.openrouter.usage.cost`" scenario.
- Non-covered: visual regression of the tool-step component (no JSDOM layout). Punted to manual smoke + future Playwright if added.

## 7. Migration stance

- **Project default: destructive.** All schema additions are optional fields; existing rows pass validation. If any plan introduces a non-optional change (none currently expected), the affected dev tables are wiped via the Convex dashboard or a dev-gated admin helper mutation.
- **Do NOT** write `@convex-dev/migrations` scripts. **Do NOT** add backwards-compat shims, feature flags that linger, or "old field, new field, both work" code paths.

## 8. Delegation policy

- **Investigations spanning 3+ files**: delegate to an `Explore` subagent.
- **External research** (Tavily docs, OpenRouter pricing changes, AI SDK release notes): delegate to a `general-purpose` subagent.
- **Single-file edits + tests**: keep in main session.
- Per-plan prompts in `PROMPTS.md` repeat this policy so each fresh `/clear`'d run inherits it.

## 9. Grounding sources

Verified during planning, every claim in this README cited to a file path or doc URL:

- `node_modules/ai/src/ui/ui-messages.ts` — UIMessagePart discriminated union.
- `node_modules/ai/src/ui-message-stream/ui-message-chunks.ts` — wire chunk types.
- `node_modules/ai/src/generate-text/{stop-condition,prepare-step,step-result}.ts` — `stepCountIs`, `prepareStep`, `StepResult`.
- `node_modules/@ai-sdk/provider-utils/src/types/tool.ts` — `tool()` factory and `Tool<INPUT,OUTPUT>` type.
- `node_modules/@openrouter/ai-sdk-provider/dist/{index.mjs,index.d.ts}` — `webSearch` factory shape, `usage.cost` propagation, annotation → source-url mapping.
- `node_modules/@convex-dev/agent/src/{client/streamText.ts,client/start.ts,client/streaming.ts,client/UIMessages.ts,client/createTool.ts,react/useUIMessages.ts,validators.ts}` — wrapper pass-through behavior, per-step persistence, source persistence, ctx-bound tools.
- `convex/chat/{agent.ts,context.ts,messages.ts,billing.ts,openrouterFetch.ts,billing.integration.test.ts}` — current state of the chat backend.
- `components/extraction/chat/{message-composer.tsx,message-list.tsx,composer-model-picker.tsx,paper-citation.tsx,sources-panel/}` — current chat UI.
- `convex/schema.ts` — extractionJobs, models, creditTransactions, chatGenerationUsages.
- `convex/models/sync.ts` — `supportedParameters`, `webSearchPrice` already populated from OpenRouter.
- OpenRouter docs: <https://openrouter.ai/docs/guides/features/server-tools/web-search>, <https://openrouter.ai/docs/api/api-reference/generations/get-generation>.
- Tavily docs: <https://docs.tavily.com/documentation/api-reference/endpoint/search>, <https://docs.tavily.com/documentation/api-credits>, <https://tavily.com/pricing>, <https://docs.tavily.com/documentation/best-practices/best-practices-search>, <https://docs.tavily.com/documentation/rate-limits>.
- AI SDK docs (local): `node_modules/ai/docs/04-ai-sdk-ui/03-chatbot-tool-usage.mdx`, `04-ai-sdk-ui/50-stream-protocol.mdx`, `03-agents/04-loop-control.mdx`, `07-reference/01-ai-sdk-core/31-ui-message.mdx`.
- AI Elements references: <https://github.com/vercel/ai-chatbot/tree/main/components/ai-elements> (`tool.tsx`, `reasoning.tsx`, `shimmer.tsx`).
- ARIA: <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions>, <https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22>.

## 10. Glossary

- **Path A** — OpenRouter server-side web search (`openrouter.tools.webSearch({...})`). No visible streaming tool steps; only `source-url` chips after-the-fact.
- **Path B** — Tavily as a custom AI SDK `tool({...})`. Visible streaming tool steps with live cost annotation. Default when `TAVILY_API_KEY` is set.
- **Capability gate** — UI hides the toggle on models that lack tool calling (`supportedParameters.includes("tools") === false`).
- **Supplementary use** — system-prompt instruction: corpus first, web only to fill gaps or add adjacent on-topic context.

## 11. Out of scope

- Reasoning-part rendering, sources side-panel restructuring, OpenAlex-as-a-tool (paper search via tool call), academic-domain dropdown UI, multilingual search, image search, Vercel AI Gateway provider switch.
