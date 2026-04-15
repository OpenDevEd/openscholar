# Phase 91: Extraction Cascade Core - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Given parsed source text on an `extractionPapers` row (from Phase 90), send the whole paper through a three-tier OpenRouter model cascade — Gemini 2.5 Flash Lite pre-screen → Gemini 3 Flash default → Claude Haiku 4.5 escalation — using a flat 7-field Zod schema with `propertyOrdering` forcing `reasoning` before `answer`, parallelized per-question with concurrency cap 5, and returning the documented result shape to the UI. This phase extends the `processExtractionPaper` workpool action stub (which currently stops after parsing) to perform the actual LLM extraction.

</domain>

<decisions>
## Implementation Decisions

### Result Schema Extension
- **D-01:** Extend the `extractionResults` table in `convex/schema.ts` with all fields from EXTR-09: `answer` (string), `confidence` (union: "high"/"medium"/"low"), `evidenceQuote` (string), `evidenceSourceId` (string), `evidenceStartChar` (number), `evidenceEndChar` (number), `reasoning` (string), `modelUsed` (string), `criticVerdict` (optional string — populated by Phase 92), `parsingSource` (reuse `parsingSourceValidator` — copied from the paper row for denormalized access).
- **D-02:** Extend the `saveResult` internal mutation to accept the full result payload. The idempotent save pattern (check `by_paper_question` index before insert) from Phase 89 stays unchanged — only the fields inserted grow.
- **D-03:** Create a new `extractionResultValueValidator` in `convex/extraction/validators.ts` that defines the shape of an extraction answer (answer, confidence, evidence fields, reasoning, modelUsed). This validator is shared between the `saveResult` mutation args and the Zod schema used in AI calls.

### Cascade Model Selection
- **D-04:** Three-tier cascade via `@openrouter/ai-sdk-provider` with `plugins: [{id: 'response-healing'}]` (EXTR-06). Application-level sequential try/catch chain: try Flash Lite → on schema failure or error, try Flash → on failure, try Haiku. This is NOT confidence-based escalation — it's failure-driven escalation.
- **D-05:** OpenRouter `provider.order` + `allow_fallbacks: true` handles provider-level failover within each model tier (EXTR-07). Application cascade handles model-tier escalation across tiers.
- **D-06:** All tiers pin `temperature: 0` (EXTR-07) and use `Output.object({ schema })` from AI SDK v6 for structured output.
- **D-07:** Gemini automatic caching is leveraged by default — OpenRouter enables this for Gemini models when the same prompt prefix is reused across questions on the same paper (EXTR-07). No explicit caching configuration needed.
- **D-08:** Model IDs: `google/gemini-2.5-flash-lite` (tier 1), `google/gemini-3-flash` (tier 2), `anthropic/claude-haiku-4.5` (tier 3). These are OpenRouter model IDs, not direct provider IDs.

### Prompt Architecture
- **D-09:** New extraction prompt builder function `buildExtractionPrompts` added to `lib/ai/core/prompts.ts`, following the established pattern (returns `{ system, prompt }`, takes typed input, supports retryCount).
- **D-10:** System prompt defines the role (academic data extraction specialist), enforces the flat 7-field output schema, requires verbatim quoting from source text, and instructs reasoning-before-answer order. The schema uses `propertyOrdering` at the AI SDK level to enforce field order (EXTR-02).
- **D-11:** User prompt provides: the full paper body text (no chunking), the specific question, and optional expected answer type hint. Each question gets its own LLM call with the same system prompt and paper text.
- **D-12:** The Zod schema for extraction output is defined alongside the prompt builder — a flat object: `{ reasoning, answer, confidence, evidence_quote, evidence_source_id, evidence_start_char, evidence_end_char }`. `reasoning` comes first due to `propertyOrdering` (EXTR-02).

### Per-Question Parallelism
- **D-13:** Questions for a single paper are extracted via `Promise.allSettled` with a concurrency cap of 5 (EXTR-10). A simple semaphore pattern limits concurrent LLM calls — not a library, just a counter + queue.
- **D-14:** Each question's extraction has its own `AbortSignal.timeout(60000)` (EXTR-10). One question's timeout or failure does not abort siblings — `Promise.allSettled` guarantees this.
- **D-15:** Failed questions are recorded with `answer: null` and an error message, but the paper is still marked `completed` (not `failed`) if at least one question succeeded. A paper is `failed` only if ALL questions fail.

### Credit Billing Integration
- **D-16:** Extraction LLM calls are billed via the existing `withUserCreditsBatch` pattern from `convex/ai/helpers.ts`. The workpool action loads `userId` from the job and wraps cascade calls in the credit wrapper.
- **D-17:** Parsing (Phase 90) remains free — only the LLM extraction calls in Phase 91 consume credits.
- **D-18:** Token usage (tokensIn, tokensOut) from the AI SDK response is captured and stored on the result for cost tracking (feeds Phase 95 observability).

### Extraction Module Organization
- **D-19:** The cascade logic lives in a new `convex/extraction/extract.ts` module — separate from `workpoolActions.ts` (mirrors the `parse.ts` pattern from Phase 90). The workpool action calls `extractAnswers(ctx, paper, questions, bodyText)` after parsing.
- **D-20:** `extract.ts` exports a single `extractAnswers` function that returns an array of per-question results. It handles the cascade internally — callers don't know about model tiers.
- **D-21:** `extract.ts` uses `createOpenRouter` from `@openrouter/ai-sdk-provider` directly (not through `getModel()` / `SERVER_AI_CONFIG`) because the cascade has its own fixed model progression that doesn't depend on env var configuration.

### Claude's Discretion
- Exact system prompt wording for the extraction specialist role — follow the tone and structure of existing prompts in `lib/ai/core/prompts.ts`.
- Concurrency semaphore implementation details — simple counter+resolve queue vs. a `p-limit`-style utility. Inline is preferred over adding a dependency.
- Whether `tokensIn`/`tokensOut` are stored on the `extractionResults` row or aggregated to the job level — optimize for the Phase 95 observability query patterns.
- Test fixture design: whether to use real paper snippets or synthetic text for cascade tests.
- Whether the `processExtractionPaper` action should early-return a partial result shape (for failed questions) or always return `{ success: boolean }` — as long as `handleExtractionComplete` can determine paper completion status.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Tables
- `convex/schema.ts` — Current extraction tables (lines ~409-479). `extractionResults` needs value fields added.
- `convex/extraction/validators.ts` — Current validators for status unions, question shape, paper input shape. Needs new result-value validator.

### Extraction Skeleton (Phase 89 output)
- `convex/extraction/workpoolActions.ts` — `processExtractionPaper` action, currently parse-only. Phase 91 adds cascade calls after step 5.
- `convex/extraction/mutations.ts` — `saveResult` mutation needs field extension. `updatePaperStatus`, `finalizeJobIfDone` reused as-is.
- `convex/extraction/queries.ts` — `getJobInternal`, `getPaperInternal` used by workpool action.
- `convex/extraction/workflow.ts` — Durable workflow orchestrator. No changes needed for Phase 91.

### Parsing Module (Phase 90 output)
- `convex/extraction/parse.ts` — `parseFullText` function. Phase 91 reads its output (bodyText, parsingSource) from the paper row.

### AI SDK Patterns
- `lib/ai/core/prompts.ts` — 5 existing prompt builders. New `buildExtractionPrompts` follows this pattern.
- `lib/ai/core/execute.ts` — `executeAIOperation` generic with `Output.object({ schema })`. Reference for structured output pattern.
- `lib/ai/core/schemas.ts` — `STANDARD_PROVIDER_OPTIONS` for provider config.
- `convex/ai/helpers.ts` — `withUserCreditsBatch()` credit wrapper. `getModel()` for server model.
- `lib/ai/server/providers.ts` — `getProviderModel()` with OpenRouter support via `createOpenRouter`.

### Screening Reference Implementation
- `convex/screening/workpoolActions.ts` — Proven pattern for credit-gated AI calls in workpool actions.

### Dependencies
- `@openrouter/ai-sdk-provider` (v6.0.0-alpha.1) — Already installed. Used for cascade model calls.
- `ai` (v6.0.62) — AI SDK core. `generateText`, `Output.object`, structured output.
- `@ai-sdk/google` (v3.0.18) — Used by parse.ts for Gemini PDF parsing (NOT used by cascade).

### Requirements
- `.planning/REQUIREMENTS.md` — EXTR-01, EXTR-02, EXTR-06, EXTR-07, EXTR-09, EXTR-10 define exact scope.
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/extraction/workpoolActions.ts` — Stub ready for cascade insertion after parsing step.
- `convex/extraction/mutations.ts:saveResult` — Idempotent save skeleton, needs field extension only.
- `lib/ai/core/prompts.ts` — Prompt builder pattern to follow for extraction prompts.
- `lib/ai/core/execute.ts:executeAIOperation` — Structured output via `Output.object({ schema })`. May be usable for individual cascade tier calls.
- `convex/ai/helpers.ts:withUserCreditsBatch` — Credit billing wrapper, proven in screening.
- `lib/ai/server/providers.ts:getProviderModel` — OpenRouter provider factory with `createOpenRouter`.

### Established Patterns
- `"use node"` directive on Convex actions needing Node.js APIs (workpoolActions.ts already has this).
- Terminal-status guard: check `job.status` before proceeding (already in workpoolActions.ts).
- Idempotency guard: check `by_paper_question` before insert (already in saveResult).
- Prompt builders return `{ system, prompt }` with typed inputs and `retryCount`.
- `Output.object({ schema })` for structured LLM output with Zod validation.
- Module-per-concern: `parse.ts` for parsing, `extract.ts` for extraction — thin workpool action dispatches.

### Integration Points
- `convex/extraction/workpoolActions.ts` — Cascade called from here after parsing.
- `convex/extraction/mutations.ts` — `saveResult` extended with value fields.
- `convex/schema.ts` — `extractionResults` table extended with value fields.
- `convex/extraction/validators.ts` — New result-value validator added.
- `lib/ai/core/prompts.ts` — New `buildExtractionPrompts` function.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the REQUIREMENTS.md EXTR-01, EXTR-02, EXTR-06, EXTR-07, EXTR-09, EXTR-10 are precise. The cascade order (Flash Lite → Flash → Haiku), the 7-field schema, `propertyOrdering`, per-question parallelism with cap 5, and the result shape are all locked in requirements.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 91-extraction-cascade-core*
*Context gathered: 2026-04-15*
