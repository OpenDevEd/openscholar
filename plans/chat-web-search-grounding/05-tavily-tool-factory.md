# 05 — Path B: Tavily custom-tool factory

## Goal

Produce the custom AI SDK `tool({...})` that wraps the Tavily `/search` API. This is the path that emits visible streaming `tool-input-start → tool-input-delta → tool-input-available → tool-output-available` UIMessage parts so the user sees a live "Searching the web…" affordance with the query, then a result list, then per-call cost. Default path when `TAVILY_API_KEY` is set.

## Scope

In:
- New file `lib/tavily/client.ts`: typed Tavily HTTP client. POST `https://api.tavily.com/search` with `Authorization: Bearer ${TAVILY_API_KEY}`. Pure (no Convex deps).
- New file `lib/tavily/client.test.ts`: unit tests with `vi.mock` on `fetch`.
- New file `lib/tavily/academic-domains.ts`: the curated `INCLUDE_DOMAINS_ACADEMIC` array.
- New file `convex/chat/tools/tavily-web-search.ts`: factory `buildTavilyWebSearchTool({ academicBias, maxResults, costSink })`. Wraps the client in an AI SDK `tool({ inputSchema, execute })`.
- New file `convex/chat/tools/tavily-web-search.test.ts`: unit tests for the factory's input schema and output shape.
- `.env.example` (or the project's analog): document `TAVILY_API_KEY`.

Out:
- Per-thread cost annotation on the UI (plan 08 — pulls from the part output).
- Orchestrator wiring (plan 06).
- Crawl/extract/research endpoints — only `/search`.

## Design

### Tavily client (lib-level, framework-agnostic)

```ts
// lib/tavily/client.ts
export interface TavilySearchRequest {
  query: string;
  searchDepth?: "basic" | "advanced";
  maxResults?: number;
  topic?: "general" | "news";
  includeAnswer?: boolean | "basic" | "advanced";
  includeRawContent?: boolean | "markdown" | "text";
  includeDomains?: string[];
  excludeDomains?: string[];
  timeRange?: "day" | "week" | "month" | "year";
  country?: string;
  chunksPerSource?: number;
  includeUsage?: boolean;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  rawContent?: string;
  publishedDate?: string;
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  responseTime: number;
  requestId: string;
  usage?: { creditsUsed: number };
}

export class TavilyError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`Tavily ${status}`);
  }
}

export async function tavilySearch(
  apiKey: string,
  req: TavilySearchRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<TavilySearchResponse> {
  const body = toSnakeCaseBody(req); // pure helper
  const res = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let payload: unknown = null;
    try { payload = await res.json(); } catch {}
    throw new TavilyError(res.status, payload);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return parseResponse(json); // pure helper, validates with zod
}
```

The `toSnakeCaseBody` and `parseResponse` helpers are pure and unit-tested. `tavilySearch` itself is a thin transport — TDD covers `toSnakeCaseBody`, `parseResponse`, and error mapping; the network call itself is covered with `vi.mock`'d `fetch`.

### Academic include-domain list

Per Tavily best practices (<https://docs.tavily.com/documentation/best-practices/best-practices-search>): keep domain lists short. Default to ~12 high-signal scholarly hosts, cap at 30 if expanded:

```ts
// lib/tavily/academic-domains.ts
export const INCLUDE_DOMAINS_ACADEMIC = [
  "arxiv.org",
  "*.arxiv.org",
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "semanticscholar.org",
  "openalex.org",
  "scholar.google.com",
  "nature.com",
  "science.org",
  "biorxiv.org",
  "medrxiv.org",
  "doaj.org",
];
```

Passed via `includeDomains: [...]` only when `academicBias: true`. Subdomain wildcards use the explicit `"*.host"` form (Tavily's apex-only default for bare entries is documented).

### Custom tool factory

```ts
// convex/chat/tools/tavily-web-search.ts
import { tool } from "ai";
import { z } from "zod";
import { tavilySearch } from "../../../lib/tavily/client";
import { INCLUDE_DOMAINS_ACADEMIC } from "../../../lib/tavily/academic-domains";

export interface BuildTavilyWebSearchOptions {
  apiKey: string;
  academicBias?: boolean;     // default true
  maxResults?: number;        // default 5
  searchDepth?: "basic" | "advanced"; // default "basic"
  costSink?: (creditsUsed: number) => Promise<void> | void; // optional callback for billing
}

const inputSchema = z.object({
  query: z.string().describe("A focused web search query that complements the user's paper corpus."),
});

export function buildTavilyWebSearchTool(opts: BuildTavilyWebSearchOptions) {
  const { apiKey, academicBias = true, maxResults = 5, searchDepth = "basic", costSink } = opts;
  return tool({
    description: [
      "Search the web ONLY when the included papers do not cover the user's question, or to add adjacent on-topic context.",
      "Always prefer paper [Pn] citations from the corpus over web sources.",
      "Use one short, focused query per call. Do not repeat searches.",
    ].join(" "),
    inputSchema,
    execute: async ({ query }, { abortSignal }) => {
      const res = await tavilySearch(apiKey, {
        query,
        searchDepth,
        maxResults,
        topic: "general",
        includeAnswer: false,
        includeRawContent: false,
        ...(academicBias ? { includeDomains: INCLUDE_DOMAINS_ACADEMIC } : {}),
      }, abortSignal ? abortableFetch(abortSignal) : fetch);
      const creditsUsed = res.usage?.creditsUsed ?? (searchDepth === "advanced" ? 2 : 1);
      if (costSink) await costSink(creditsUsed);
      return {
        sources: res.results.map((r) => ({
          url: r.url,
          title: r.title,
          snippet: r.content,
          score: r.score,
        })),
        creditsUsed,
      };
    },
  });
}
```

The factory takes `apiKey` as an arg, not `process.env.TAVILY_API_KEY` directly — keeps the factory unit-testable and lets the orchestrator (plan 06) read the env var once and pass it in.

### Cost capture: `costSink`

Tavily charges a fixed per-call cost (1 credit basic, 2 advanced; $0.008/credit pay-as-you-go = $0.008 / $0.016 per call) — independent of OpenRouter's `usage.cost`. The model would never see this cost in `providerMetadata.openrouter.usage.cost`. We capture it via the `costSink` callback at `execute` time. The orchestrator (plan 06) will pass a sink that calls a Convex internal mutation:

```ts
// pseudo-code, in plan 06:
costSink: (credits) => ctx.runMutation(internal.chat.billing.recordTavilyCost, {
  generationId: capturedGenerationId,
  threadId,
  credits,
}),
```

The mutation `recordTavilyCost` (introduced in plan 06) accumulates onto `chatGenerationUsages.metadata.tavilyCredits` and adds the matching credit deduction to the ledger via `deductCreditsTransaction(billingType: "search")`.

### Output shape on the UIMessage

When the model gets the result, it is fed back as a normal tool-result. The AI SDK produces a `tool-${name}` UIMessage part with `state: "output-available"` and `output: { sources, creditsUsed }`. The renderer in plan 08 reads `output.sources` to draw URL chips and `output.creditsUsed` for the cost annotation.

### Streaming visibility

Verified at `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:4033-4156`: when the LLM emits `tool_calls` deltas during streaming, the OpenRouter provider forwards them as `tool-input-start` → `tool-input-delta` → `tool-input-available` → `tool-call` parts. So when the model decides to call the Tavily tool, the user sees the query stream in incrementally — exactly the UX the user asked for.

## TDD sequence

Phase A — pure logic (one commit per green):

R1 — RED: `lib/tavily/client.test.ts`:
- `toSnakeCaseBody({ searchDepth: "basic", maxResults: 3, includeDomains: ["x"] })` → `{ search_depth: "basic", max_results: 3, include_domains: ["x"] }`.
- `parseResponse({...valid})` → typed object.
- `parseResponse({...missing-results})` → throws.
- `tavilySearch(...)` happy: `vi.mock` `fetch` to return 200 + JSON, assert request body and headers.
- `tavilySearch(...)` 401: throws `TavilyError(401, body)`.
- `tavilySearch(...)` 429 with `retry-after` header: throws `TavilyError(429, body)` with the header preserved on the error.

G1 — GREEN: implement client. Commits per pair.

R2 — RED: `convex/chat/tools/tavily-web-search.test.ts`:
- `buildTavilyWebSearchTool({ apiKey: "x" })` returns a `Tool` of `type === "function"` with non-empty `description` and `inputSchema` accepting `{ query: string }`.
- `inputSchema.parse({ query: "foo" })` → succeeds.
- `inputSchema.parse({})` → fails.
- `execute({ query: "foo" }, { abortSignal: undefined })`: with mocked client, returns `{ sources: [...], creditsUsed: 1 }`.
- `execute(...)` calls `costSink(1)` once.
- `execute(...)` with `searchDepth: "advanced"` and missing usage → `creditsUsed: 2`.

G2 — GREEN: implement factory. Commit pairs.

## Files touched

- `lib/tavily/client.ts` (new, ~ 80 LOC)
- `lib/tavily/client.test.ts` (new, ~ 100 LOC)
- `lib/tavily/academic-domains.ts` (new, ~ 15 LOC)
- `convex/chat/tools/tavily-web-search.ts` (new, ~ 50 LOC)
- `convex/chat/tools/tavily-web-search.test.ts` (new, ~ 80 LOC)
- `.env.example` — document `TAVILY_API_KEY` (no value).

## Migration stance

None — additive code, no schema, no existing-row impact.

## Test plan

- All pure-logic unit tests above pass.
- Manual smoke after plan 06 wires the factory: enable web search, ask a question deliberately outside the corpus (e.g., "what's the weather in Paris today?"), confirm the tool call streams and resolves with web sources.

## Acceptance criteria

- [ ] `tavilySearch` POSTs to the correct URL with the correct headers; snake-cases the body.
- [ ] `parseResponse` validates the response shape and throws on malformed input.
- [ ] `TavilyError` carries status and body.
- [ ] `buildTavilyWebSearchTool` returns a `Tool` of `type: "function"` (per AI SDK `Tool<INPUT,OUTPUT>` union).
- [ ] `inputSchema` is a zod object with `query: z.string()`.
- [ ] `execute` invokes the client, returns `{ sources, creditsUsed }`, and calls `costSink` exactly once.
- [ ] Default `searchDepth = "basic"` (1 credit), `maxResults = 5`, `academicBias = true`.
- [ ] When `academicBias: true`, `includeDomains: INCLUDE_DOMAINS_ACADEMIC`.
- [ ] All unit tests pass, `tsc --noEmit` clean.

## Known pitfalls

- **Do not** call `process.env.TAVILY_API_KEY` inside `buildTavilyWebSearchTool`. Pass it in. Keeps the factory testable and lets the orchestrator decide whether to route to Path A vs Path B based on env presence.
- **Do not** include `auto_parameters: true` — Tavily docs flag this as a billing footgun (silently upgrades to advanced = 2 credits).
- **Do not** include `exact_match: true` — returns near-empty results unless `query` already has quoted phrases.
- **Do not** request `topic: "news"` — academic queries default to general; news topic adds noise.
- **Do not** request `includeRawContent: true` for the default — raw content blows up the token bill on the LLM side. Only the `content` snippet is needed for the model.
- **Beware of the rate limit**: Tavily dev keys cap at 100 RPM and prod at 1,000 RPM. The chat fan-out is one request per tool call per user, so this is generous, but log 429s and respect `retry-after`. For a chat with `stepCountIs(5)` a single user message could trigger up to 5 searches in the worst case.
- **Domain wildcards**: Tavily matches the apex only on a bare `arxiv.org`. Always use `"*.arxiv.org"` to include subdomains.
- **Abort propagation**: pass `abortSignal` from `ToolExecutionOptions` to the client `fetch`. If the chat is aborted mid-search, the Tavily call should bail. The helper `abortableFetch(signal)` returns a wrapped fetch implementation; alternatively, `fetch(url, { signal })` works directly — but the AI SDK's `tool` `execute` second arg is `{ abortSignal? }`, not `{ signal }`, so be explicit.
- **Do not** persist the full `rawContent` per result on the `chatGenerationUsages` row — only sources `{ url, title, snippet, score }`. Storage cost is real.
- **Do not** include `include_answer` — the model is the answerer; Tavily's pre-baked answer would compete with corpus citations.
