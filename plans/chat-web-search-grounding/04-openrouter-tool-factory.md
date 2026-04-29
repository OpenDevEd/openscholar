# 04 — Path A: OpenRouter server-tool factory

## Goal

Produce the pure factory `buildOpenRouterWebSearchTool({ academicBias, maxResults })` that returns a `Tool` instance via `openrouter.tools.webSearch({...})`. No call-site changes here — plan 06 wires it.

## Scope

In:
- New file `convex/chat/tools/openrouter-web-search.ts`: factory function + the academic search-prompt constant.
- New file `convex/chat/tools/openrouter-web-search.test.ts`: unit tests for the factory's return shape and arg passthrough.

Out:
- Tavily implementation (plan 05).
- Orchestrator wiring (plan 06).
- Per-thread engine selection — hardcoded `engine: "auto"` (Exa fallback or native pass-through; OpenRouter decides per provider).

## Design

The factory is a thin wrapper. The reason it is a separate plan from the call-site wiring is that the academic-bias `searchPrompt` constant and the choice of `maxResults` are configuration concerns that benefit from isolated review and tests, and putting them behind a factory makes the orchestration plan trivially short.

### Factory contract

```ts
// convex/chat/tools/openrouter-web-search.ts
import { openrouter } from "@openrouter/ai-sdk-provider";

export const ACADEMIC_SEARCH_PROMPT = [
  "You are searching the web to supplement an academic paper corpus.",
  "Prefer scholarly sources (journals, preprint servers, official institutional pages).",
  "Avoid forums, social media, and content farms.",
  "Return at most 5 high-relevance results.",
].join(" ");

export interface BuildOpenRouterWebSearchOptions {
  academicBias?: boolean; // default true
  maxResults?: number;    // default 5
}

export function buildOpenRouterWebSearchTool(opts: BuildOpenRouterWebSearchOptions = {}) {
  const { academicBias = true, maxResults = 5 } = opts;
  return openrouter.tools.webSearch({
    maxResults,
    ...(academicBias ? { searchPrompt: ACADEMIC_SEARCH_PROMPT } : {}),
    engine: "auto",
  });
}
```

`openrouter.tools.webSearch` accepts ONLY `maxResults`, `searchPrompt`, `engine` per `node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts:705-716`. Domain filters and other knobs are NOT accepted by the typed factory; they would have to go through settings-level `plugins`, which is out of scope here. If domain filtering becomes a requirement later, switch the factory to emit a settings-level plugin entry instead.

### Tool key (used by the orchestrator)

The orchestrator (plan 06) maps this tool into the `tools` map under the key `web_search`. The OpenRouter provider transforms `tool.id = "openrouter.web_search"` to API body `type: "openrouter:web_search"` (`dist/index.mjs:4274-4289`); the AI SDK key (`web_search`) is internal to the SDK's tool result routing.

### What this tool DOES NOT emit

OpenRouter's server-side web search does NOT emit `tool-input-streaming` or `tool-output-available` AI-SDK parts (verified in `dist/index.mjs:4006-4032` — the chunk processor only enqueues `source-url` parts for `url_citation` annotations, never tool-call parts). So the UI for this path is the source-url chip footer only — no streaming "Searching…" affordance. This is documented in `00-README.md` and is the reason Path B exists.

## TDD sequence

Phase A — pure logic (one commit per green):

R1 — RED: assert the factory returns a `Tool` whose `id === "openrouter.web_search"` and whose `args` includes the snake-cased fields (`max_results`, `search_prompt`, `engine`) — but note that the OpenRouter provider's `mapProviderTool` does the `camelToSnake` transform AT REQUEST TIME, not factory time. The factory's `tool.args` is the camelCase user-facing object. Test on that.

Cases:
- defaults: `{ maxResults: 5, engine: "auto", searchPrompt: ACADEMIC_SEARCH_PROMPT }`
- `academicBias: false`: `searchPrompt` absent
- `maxResults: 10`: passes `10`
- `tool.type === "provider"` (per `Tool<INPUT,OUTPUT>` discriminated union with `type: "provider"`)
- `tool.id === "openrouter.web_search"` (verified factory id at `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:5025`)

G1 — GREEN: implement. Commit `test(chat): [plan-04] openrouter web-search factory cases` then `feat(chat): [plan-04] buildOpenRouterWebSearchTool factory`.

## Files touched

- `convex/chat/tools/openrouter-web-search.ts` (new, ~ 30 LOC)
- `convex/chat/tools/openrouter-web-search.test.ts` (new, ~ 50 LOC)

## Migration stance

None.

## Test plan

- Unit tests above. No integration test in this plan — the call site is wired in plan 06 and tested there.
- Manual: `console.log(buildOpenRouterWebSearchTool())` at a Convex action eval to confirm shape.

## Acceptance criteria

- [ ] `buildOpenRouterWebSearchTool` exists and returns a `Tool<INPUT, OUTPUT>` with `type: "provider"` and `id: "openrouter.web_search"`.
- [ ] The factory passes `engine: "auto"` by default.
- [ ] When `academicBias: true` (default), `searchPrompt` is set to `ACADEMIC_SEARCH_PROMPT`.
- [ ] When `academicBias: false`, `searchPrompt` is absent.
- [ ] `maxResults` defaults to `5`, overridable.
- [ ] Five unit assertions pass.
- [ ] `tsc --noEmit` clean.

## Known pitfalls

- **Do not** add `includeDomains`/`excludeDomains` to the factory — `WebSearchToolArgs` does not type them and the SDK would silently drop them. If you need domain filtering, switch to settings-level `plugins: [{ id: "web", include_domains: [...] }]` and document the move.
- **Do not** import `openrouter` from anywhere except `@openrouter/ai-sdk-provider`. Do NOT use the `createOpenRouter()` instance from `convex/chat/agent.ts:23` here — that instance carries the chat-specific `usage: { include: true }` setting; the tool factory is independent.

  Wait — verify this against the source: `openrouter.tools.webSearch` is exported from the *package*, not the instance. Reading `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:5018-5027` confirms it is module-level (the factory does not need an instance). Use the named import `{ openrouter }` from `@openrouter/ai-sdk-provider` at module scope.

- **Do not** vary the `searchPrompt` per user message. It is request-scope guidance for the search engine; per-call variation is accomplished by the user's actual message, not by morphing the prompt. Keep it static.
- **Do not** test against the private `id` namespace beyond the contract above. If OpenRouter renames `webSearch` to `webSearch_v2` later, the test should still pass on shape — only the explicit `id` assertion locks us to the version, and that is intentional (it would break loudly on upgrade).
