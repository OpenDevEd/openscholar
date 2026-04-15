# Phase 91: Extraction Cascade Core - Research

**Researched:** 2026-04-15
**Domain:** LLM structured extraction via OpenRouter cascade, AI SDK v6, Convex workpool actions
**Confidence:** HIGH

## Summary

Phase 91 extends the parse-only `processExtractionPaper` workpool action stub to perform actual LLM extraction using a three-tier OpenRouter model cascade. The cascade sends whole-paper text through Gemini 2.5 Flash Lite (pre-screen), Gemini 3 Flash Preview (default), and Claude Haiku 4.5 (escalation) using a flat 7-field Zod schema with `propertyOrdering` forcing reasoning-before-answer field order. Per-question extraction is parallelized via `Promise.allSettled` with concurrency cap 5 and per-question `AbortSignal.timeout(60000)`.

All core dependencies are already installed: `ai@6.0.161`, `@openrouter/ai-sdk-provider@6.0.0-alpha.1`, `zod@4.3.6`. The extraction pattern follows established conventions from the screening workpool actions and the `executeAIOperation` pattern in `lib/ai/core/execute.ts`. Credit billing uses the proven `withUserCreditsBatch` wrapper from `convex/ai/helpers.ts`.

**Primary recommendation:** Build `convex/extraction/extract.ts` as a pure async module (mirroring `parse.ts`) that exports a single `extractAnswers()` function. Use `createOpenRouter` directly with model-specific options for each cascade tier. Pass `propertyOrdering` via Zod v4's `.meta()` which correctly propagates through the AI SDK JSON Schema pipeline to OpenRouter's API. Use the `plugins` model option for response-healing.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Extend `extractionResults` table with all EXTR-09 fields: answer, confidence (union), evidenceQuote, evidenceSourceId, evidenceStartChar, evidenceEndChar, reasoning, modelUsed, criticVerdict (optional), parsingSource (reuse validator).
- **D-02:** Extend `saveResult` mutation to accept full result payload; idempotent save pattern unchanged.
- **D-03:** Create `extractionResultValueValidator` in validators.ts shared between mutation args and Zod schema.
- **D-04:** Three-tier cascade via `@openrouter/ai-sdk-provider` with `plugins: [{id: 'response-healing'}]`. Application-level sequential try/catch: Flash Lite -> Flash -> Haiku. Failure-driven, NOT confidence-based.
- **D-05:** OpenRouter `provider.order` + `allow_fallbacks: true` for provider-level failover within each tier.
- **D-06:** All tiers pin `temperature: 0` and use `Output.object({ schema })` from AI SDK v6.
- **D-07:** Gemini automatic caching via OpenRouter -- no explicit config needed.
- **D-08:** Model IDs: `google/gemini-2.5-flash-lite` (tier 1), `google/gemini-3-flash` (tier 2), `anthropic/claude-haiku-4.5` (tier 3).
- **D-09:** New `buildExtractionPrompts` in `lib/ai/core/prompts.ts`, returns `{ system, prompt }`.
- **D-10:** System prompt defines extraction specialist role, enforces 7-field schema, verbatim quoting, reasoning-before-answer.
- **D-11:** User prompt provides full paper body text, the question, and optional expected answer type hint.
- **D-12:** Zod schema defined alongside prompt builder: `{ reasoning, answer, confidence, evidence_quote, evidence_source_id, evidence_start_char, evidence_end_char }`. `reasoning` first via `propertyOrdering`.
- **D-13:** `Promise.allSettled` with concurrency cap 5 via inline semaphore.
- **D-14:** Per-question `AbortSignal.timeout(60000)`. One question's timeout does not abort siblings.
- **D-15:** Failed questions get `answer: null` + error message. Paper is `completed` if any question succeeded; `failed` only if ALL fail.
- **D-16:** Credit billing via `withUserCreditsBatch` from `convex/ai/helpers.ts`.
- **D-17:** Parsing (Phase 90) is free; only Phase 91 LLM calls consume credits.
- **D-18:** Token usage (tokensIn, tokensOut) captured and stored on result for cost tracking.
- **D-19:** Cascade logic in new `convex/extraction/extract.ts` module (mirrors `parse.ts`).
- **D-20:** `extract.ts` exports `extractAnswers(ctx, paper, questions, bodyText)` returning per-question results array.
- **D-21:** `extract.ts` uses `createOpenRouter` directly, NOT through `getModel()` / `SERVER_AI_CONFIG`.

### Claude's Discretion
- Exact system prompt wording for extraction specialist role.
- Concurrency semaphore implementation (inline counter+queue preferred).
- Whether `tokensIn`/`tokensOut` stored on result row vs. aggregated to job level.
- Test fixture design (real paper snippets vs. synthetic text).
- `processExtractionPaper` return shape (partial vs. `{ success: boolean }`).

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXTR-01 | Send whole-paper text to Gemini 3 Flash via OpenRouter -- no RAG, no vector DB | `generateText` with `Output.object({ schema })` supports full-text prompts; Gemini 3 Flash has 1M context. OpenRouter model ID verified: `google/gemini-3-flash-preview`. |
| EXTR-02 | Flat 7-field Zod schema with `propertyOrdering` forcing reasoning before answer | Zod v4 `.meta({ propertyOrdering: [...] })` confirmed to propagate through AI SDK's `z4.toJSONSchema()` into the JSON Schema sent to OpenRouter. Verified in local test. |
| EXTR-06 | Three-tier OpenRouter cascade with response-healing plugin | `@openrouter/ai-sdk-provider@6.0.0-alpha.1` supports `plugins: [{ id: 'response-healing' }]` via model options. Response healing is free, <1ms latency, non-streaming only. |
| EXTR-07 | Cost minimization via Gemini caching, `provider.order`, `allow_fallbacks`, `temperature: 0` | Provider routing config supported via model options `{ provider: { order: [...], allowFallbacks: true } }`. Temperature passed as standard `generateText` option. |
| EXTR-09 | Result shape: `{ answer, confidence, evidence, reasoning, model_used, critic_verdict, parsing_source }` | Schema extension maps directly to Convex validators. `extractionResults` table currently has only `jobId`, `paperId`, `questionId`, `createdAt` -- needs all value fields added. |
| EXTR-10 | Per-question parallelism via `Promise.allSettled` with concurrency cap 5 and 60s timeout | `AbortSignal.timeout(60000)` passed to `generateText`'s `abortSignal` option. Inline semaphore pattern with counter+queue for concurrency control. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- This project uses Convex as its backend. Always read `convex/_generated/ai/guidelines.md` first.
- DRY principle: check codebase for reusable patterns before implementing.
- No legacy behavior, no compatibility -- treat everything with destructiveness and cleanliness.
- Use best practices and most modern standards.
- Academic research tool for systematic review teams (OpenScholar).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| LLM extraction cascade | Convex Action (Node.js) | -- | Actions are the only Convex function type that can make external API calls (OpenRouter). workpoolActions.ts already has `"use node"`. |
| Extraction result persistence | Convex Mutation | -- | `saveResult` mutation writes to `extractionResults` table. Must be mutation for transactional guarantees and idempotency. |
| Schema validation (Zod) | Convex Action | -- | Zod schema validates LLM output within the action before calling saveResult mutation. |
| Credit billing | Convex Action + Mutation | -- | `withUserCreditsBatch` wraps the action; credit deduction is a mutation called internally. |
| Prompt construction | Shared lib (`lib/ai/core/`) | -- | Prompt builders are pure functions shared between action code and future test harnesses. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` | 6.0.161 | AI SDK core -- `generateText`, `Output.object` | [VERIFIED: npm registry] Already installed. Provides structured output with Zod schema validation. |
| `@openrouter/ai-sdk-provider` | 6.0.0-alpha.1 | OpenRouter model provider | [VERIFIED: npm registry] Already installed. Supports plugins, provider routing, model options. |
| `zod` | 4.3.6 | Schema definition + JSON Schema generation | [VERIFIED: npm registry] Already installed. v4's `.meta()` propagates `propertyOrdering` to JSON Schema. |
| `convex` | (project version) | Backend platform -- actions, mutations, queries | [VERIFIED: codebase] Convex is the application backend. 10-minute action timeout confirmed. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `convex-test` | (dev) | Convex function unit testing | Testing saveResult mutation extension, schema validation tests. |
| `vitest` | (dev) | Test runner | Running `convex/**/*.test.ts` files with `edge-runtime` environment. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline semaphore | `p-limit` | p-limit adds a dependency for ~15 lines of inline code. D-13 explicitly says "not a library, just a counter + queue." |
| `createOpenRouter` directly | `getModel()` from helpers | D-21 explicitly says cascade has its own fixed model progression, not env var config. |
| `executeAIOperation` | Direct `generateText` | `executeAIOperation` adds retry logic and repair strategies. Cascade already has its own retry via tier escalation. Direct `generateText` is simpler and avoids double-retry. |

**Installation:**
No new packages needed. All dependencies are already installed.

## Architecture Patterns

### System Architecture Diagram

```
processExtractionPaper (workpool action)
    |
    v
[1] Parse paper (Phase 90 -- already done)
    |-- parseFullText(doi, openalexId) -> { bodyText, parsingSource }
    |-- storeParsedText mutation
    |
    v
[2] Load questions from job (ctx.runQuery)
    |
    v
[3] extractAnswers(paper, questions, bodyText) --- NEW in Phase 91
    |
    |-- For each question (Promise.allSettled, cap 5):
    |     |
    |     v
    |   extractSingleAnswer(bodyText, question, expectedType)
    |     |
    |     |-- [Tier 1] generateText(Flash Lite) + Output.object
    |     |     |-- Success? -> return result
    |     |     |-- Error/schema failure? -> continue
    |     |
    |     |-- [Tier 2] generateText(Flash) + Output.object
    |     |     |-- Success? -> return result
    |     |     |-- Error/schema failure? -> continue
    |     |
    |     |-- [Tier 3] generateText(Haiku 4.5) + Output.object
    |     |     |-- Success? -> return result
    |     |     |-- Error? -> return { answer: null, error }
    |     |
    |     v
    |   Per-question result with modelUsed tag
    |
    v
[4] Save results (ctx.runMutation saveResult for each question)
    |
    v
[5] Return { success: boolean } to workpool onComplete handler
```

### Recommended Project Structure
```
convex/extraction/
  extract.ts           # NEW: cascade logic, extractAnswers() export
  workpoolActions.ts   # MODIFIED: calls extractAnswers() after parsing
  mutations.ts         # MODIFIED: saveResult extended with value fields
  validators.ts        # MODIFIED: new extractionResultValueValidator
  parse.ts             # EXISTING: unchanged
  queries.ts           # EXISTING: unchanged
  workflow.ts          # EXISTING: unchanged

lib/ai/core/
  prompts.ts           # MODIFIED: new buildExtractionPrompts()

convex/schema.ts       # MODIFIED: extractionResults table extended
```

### Pattern 1: OpenRouter Model Creation with Cascade Config

**What:** Create OpenRouter models with per-tier configuration including plugins and provider routing.
**When to use:** Each cascade tier needs its own model instance.

```typescript
// Source: Verified against @openrouter/ai-sdk-provider@6.0.0-alpha.1 type definitions
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter();

// Tier 1: Flash Lite (cheapest)
const flashLiteModel = openrouter('google/gemini-2.5-flash-lite', {
  plugins: [{ id: 'response-healing' }],
  provider: {
    order: ['Google AI Studio', 'Google Vertex'],
    allowFallbacks: true,
  },
});

// Tier 2: Flash (default)
const flashModel = openrouter('google/gemini-3-flash-preview', {
  plugins: [{ id: 'response-healing' }],
  provider: {
    order: ['Google AI Studio', 'Google Vertex'],
    allowFallbacks: true,
  },
});

// Tier 3: Haiku 4.5 (escalation)
const haikuModel = openrouter('anthropic/claude-haiku-4.5', {
  plugins: [{ id: 'response-healing' }],
  provider: {
    order: ['Anthropic'],
    allowFallbacks: true,
  },
});
```

### Pattern 2: Structured Output with propertyOrdering via Zod v4 `.meta()`

**What:** Define a Zod schema whose JSON Schema output includes `propertyOrdering` for Gemini field ordering.
**When to use:** When field generation order matters for output quality (reasoning before answer).

```typescript
// Source: Verified locally -- z.toJSONSchema produces { propertyOrdering: [...] }
import { z } from 'zod';
import { generateText, Output } from 'ai';

const extractionOutputSchema = z.object({
  reasoning: z.string().describe('Step-by-step reasoning for the answer, referencing specific text from the paper'),
  answer: z.string().describe('The extracted answer to the question'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Confidence level of the answer'),
  evidence_quote: z.string().describe('Verbatim quote from the source text supporting the answer'),
  evidence_source_id: z.string().describe('Identifier of the source (paper section or paragraph)'),
  evidence_start_char: z.number().describe('Start character offset of the evidence in the source text'),
  evidence_end_char: z.number().describe('End character offset of the evidence in the source text'),
}).meta({
  propertyOrdering: [
    'reasoning',
    'answer',
    'confidence',
    'evidence_quote',
    'evidence_source_id',
    'evidence_start_char',
    'evidence_end_char',
  ],
});

const { output, usage } = await generateText({
  model: flashLiteModel,
  output: Output.object({ schema: extractionOutputSchema }),
  temperature: 0,
  system: systemPrompt,
  prompt: userPrompt,
  abortSignal: AbortSignal.timeout(60000),
});
```

### Pattern 3: Inline Semaphore for Concurrency Cap

**What:** Simple counter + queue pattern limiting concurrent async operations.
**When to use:** Limiting parallel LLM calls to avoid rate limiting or resource exhaustion.

```typescript
// Source: Standard concurrency control pattern [ASSUMED]
async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let running = 0;
  let index = 0;

  return new Promise((resolve) => {
    function next() {
      while (running < limit && index < tasks.length) {
        const i = index++;
        running++;
        tasks[i]()
          .then((value) => { results[i] = { status: 'fulfilled', value }; })
          .catch((reason) => { results[i] = { status: 'rejected', reason }; })
          .finally(() => {
            running--;
            if (index >= tasks.length && running === 0) {
              resolve(results);
            } else {
              next();
            }
          });
      }
    }
    next();
  });
}
```

### Pattern 4: Credit Billing Integration (from screening reference)

**What:** Wrap extraction calls in `withUserCreditsBatch` for credit-gated AI operations.
**When to use:** All LLM extraction calls in the workpool action.

```typescript
// Source: convex/screening/workpoolActions.ts (existing pattern)
// Source: convex/ai/helpers.ts (withUserCreditsBatch definition)
import { withUserCreditsBatch } from '../ai/helpers';

const extractionResults = await withUserCreditsBatch(
  ctx,
  job.userId,
  `Extraction (paper ${args.paperId})`,
  async (pricing) => {
    const results = await extractAnswers(paper, questions, bodyText);
    const totalUsage = aggregateUsage(results);
    return { result: results, totalUsage };
  },
);
```

### Anti-Patterns to Avoid
- **Double retry:** Do NOT use `executeAIOperation` for cascade tier calls. The cascade IS the retry strategy. Using `executeAIOperation` adds a second retry loop that wastes tokens and time.
- **Streaming for extraction:** Response-healing plugin only works with non-streaming requests. Always use `generateText`, never `streamText` for extraction.
- **Shared model instances:** Do NOT reuse `getModel()` from `convex/ai/helpers.ts`. The cascade needs its own `createOpenRouter` instances with tier-specific model IDs. D-21 is explicit about this.
- **Chunking or RAG:** EXTR-01 is explicit: whole-paper text, no chunking, no vector DB.
- **Confidence-based escalation:** D-04 is explicit: escalation is failure-driven (schema failure or error), NOT confidence-based.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON schema validation | Custom JSON validator | `Output.object({ schema })` from AI SDK | AI SDK handles schema enforcement via tool calls/structured output mode with automatic validation against Zod schema. |
| JSON healing/repair | Custom JSON repair logic | `plugins: [{ id: 'response-healing' }]` via OpenRouter | OpenRouter's server-side response healing reduces JSON defects by 80%+ at <1ms latency cost, free to use. |
| Concurrency limiting | npm package (p-limit) | Inline semaphore pattern | D-13 says "not a library." 15 lines of inline code. Adding a dependency is overkill. |
| Provider failover | Custom load balancer | OpenRouter `provider.order` + `allowFallbacks` | OpenRouter handles provider-level failover automatically (e.g., Google AI Studio -> Google Vertex). |
| Credit billing | Custom billing logic | `withUserCreditsBatch` from `convex/ai/helpers.ts` | Proven in screening workpool. Handles auth, balance check, usage tracking, deduction in one wrapper. |

**Key insight:** The cascade itself is the retry strategy. Each tier is a fallback for the previous one. Do not add additional retry logic within a tier -- if `generateText` fails (schema validation, timeout, provider error), catch the error and move to the next tier.

## Common Pitfalls

### Pitfall 1: Model ID Mismatch for Gemini 3 Flash
**What goes wrong:** `google/gemini-3-flash` returns "model not available" from OpenRouter.
**Why it happens:** The model is currently listed as `google/gemini-3-flash-preview` on OpenRouter. The non-preview ID does not resolve.
**How to avoid:** Verify the exact model ID against OpenRouter's model page before hardcoding. Use `google/gemini-3-flash-preview` as the tier 2 model ID. The CONTEXT.md says `google/gemini-3-flash` (D-08) -- this needs correction at implementation time.
**Warning signs:** HTTP 404 or "model not available" errors from OpenRouter when running tier 2.
[VERIFIED: openrouter.ai/google/gemini-3-flash returns "not available"; openrouter.ai/google/gemini-3-flash-preview is active]

### Pitfall 2: Response Healing Only Works Non-Streaming
**What goes wrong:** JSON defects are not healed when using `streamText`.
**Why it happens:** OpenRouter's response-healing plugin only activates for non-streaming requests.
**How to avoid:** Always use `generateText` (not `streamText`) for extraction calls. Extraction does not need streaming -- results are saved to the database, not streamed to UI.
**Warning signs:** Malformed JSON errors in structured output despite having response-healing enabled.
[VERIFIED: openrouter.ai/docs/guides/features/plugins/response-healing]

### Pitfall 3: Convex Action Timeout with Many Questions
**What goes wrong:** Action times out before all questions are processed.
**Why it happens:** Convex actions have a 10-minute hard limit. With 60s per question and serial processing, >10 questions would exceed the limit.
**How to avoid:** Parallel processing with concurrency cap 5 ensures worst-case time is ~120s for 10 questions (2 batches of 5). Keep well under the 10-minute limit.
**Warning signs:** Actions failing with timeout errors for papers with many extraction questions.
[VERIFIED: docs.convex.dev/production/state/limits -- 10 min action limit]

### Pitfall 4: propertyOrdering Stripped by AI SDK
**What goes wrong:** `propertyOrdering` field disappears from the JSON Schema sent to OpenRouter.
**Why it happens:** Earlier versions of the AI SDK or incorrect Zod usage could strip unknown JSON Schema properties.
**How to avoid:** Use Zod v4's `.meta({ propertyOrdering: [...] })` -- verified locally that this propagates through `z4.toJSONSchema()` and the AI SDK's `addAdditionalPropertiesToJsonSchema` function does NOT strip extra properties. The OpenRouter provider passes `responseFormat.schema` through to the API unchanged.
**Warning signs:** Gemini generating `answer` before `reasoning` in the output.
[VERIFIED: local test with zod@4.3.6 + inspection of @ai-sdk/provider-utils and @openrouter/ai-sdk-provider source]

### Pitfall 5: `NoObjectGeneratedError` Not Caught in Cascade
**What goes wrong:** A `NoObjectGeneratedError` from `generateText` with `Output.object` is not caught by a generic `catch (error)` block because it has a specific class.
**Why it happens:** AI SDK throws `NoObjectGeneratedError` when structured output fails validation. If the cascade's try/catch doesn't recognize this error type, it may not escalate properly.
**How to avoid:** Import `NoObjectGeneratedError` from `ai` and catch it explicitly, or use a broad `catch (error)` which WILL catch it (it extends Error). Either way, any error triggers escalation to the next tier.
**Warning signs:** Cascade stuck on tier 1 without escalating despite schema failures.
[VERIFIED: ai SDK exports NoObjectGeneratedError]

### Pitfall 6: OCC Contention on saveResult
**What goes wrong:** Multiple concurrent `saveResult` mutations for the same paper cause OCC (Optimistic Concurrency Control) retries.
**Why it happens:** Each question's result is saved via a separate `ctx.runMutation` call. With 5 concurrent calls completing near-simultaneously, the mutations may conflict.
**How to avoid:** Convex automatically retries OCC conflicts. The idempotency guard (check `by_paper_question` before insert) ensures correctness even with retries. The existing pattern from Phase 89 handles this correctly.
**Warning signs:** `console.warn` messages about OCC retries in Convex logs.
[VERIFIED: convex/_generated/ai/guidelines.md + existing saveResult implementation]

### Pitfall 7: OpenRouter Alpha Provider API Surface
**What goes wrong:** The `@openrouter/ai-sdk-provider@6.0.0-alpha.1` uses the Responses API (`beta.responses.send`) instead of Chat Completions. The `plugins` field is in the TypeScript type definitions but may not be explicitly forwarded to the API request body.
**Why it happens:** Alpha SDK -- the implementation is still evolving.
**How to avoid:** If `plugins` via model options does not work at runtime, fall back to passing plugins via `providerOptions.openrouter.plugins` or via `extraBody: { plugins: [{ id: 'response-healing' }] }` on `createOpenRouter()`. Test at implementation time.
**Warning signs:** Response healing not activating despite being configured. Check request body via OpenRouter dashboard or debug mode.
[VERIFIED: source inspection of @openrouter/ai-sdk-provider@6.0.0-alpha.1 dist/index.mjs]

## Code Examples

### Extraction Zod Schema (verified pattern)

```typescript
// Source: Verified locally with zod@4.3.6 + z.toJSONSchema()
import { z } from 'zod';

export const extractionOutputSchema = z.object({
  reasoning: z.string().describe(
    'Step-by-step reasoning referencing specific text from the paper. Explain WHY this answer is correct.'
  ),
  answer: z.string().describe(
    'The extracted answer to the question. Use the exact text from the paper when possible.'
  ),
  confidence: z.enum(['high', 'medium', 'low']).describe(
    'Confidence level: high = explicit statement, medium = inferred, low = uncertain/partial evidence'
  ),
  evidence_quote: z.string().describe(
    'Verbatim quote from the source text that supports this answer. Must be an exact substring.'
  ),
  evidence_source_id: z.string().describe(
    'Section or paragraph identifier where the evidence was found'
  ),
  evidence_start_char: z.number().describe(
    'Start character offset of the evidence quote in the full source text'
  ),
  evidence_end_char: z.number().describe(
    'End character offset of the evidence quote in the full source text'
  ),
}).meta({
  propertyOrdering: [
    'reasoning',
    'answer',
    'confidence',
    'evidence_quote',
    'evidence_source_id',
    'evidence_start_char',
    'evidence_end_char',
  ],
});
```

### Cascade Model Factory (verified pattern)

```typescript
// Source: @openrouter/ai-sdk-provider@6.0.0-alpha.1 type definitions + README
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

interface CascadeTier {
  model: LanguageModel;
  name: string;
}

function createCascadeTiers(): CascadeTier[] {
  const openrouter = createOpenRouter();

  return [
    {
      name: 'google/gemini-2.5-flash-lite',
      model: openrouter('google/gemini-2.5-flash-lite', {
        plugins: [{ id: 'response-healing' }],
        provider: { allowFallbacks: true },
      }),
    },
    {
      name: 'google/gemini-3-flash-preview',
      model: openrouter('google/gemini-3-flash-preview', {
        plugins: [{ id: 'response-healing' }],
        provider: { allowFallbacks: true },
      }),
    },
    {
      name: 'anthropic/claude-haiku-4.5',
      model: openrouter('anthropic/claude-haiku-4.5', {
        plugins: [{ id: 'response-healing' }],
        provider: { allowFallbacks: true },
      }),
    },
  ];
}
```

### Convex Validator for Result Values (follows existing patterns)

```typescript
// Source: convex/extraction/validators.ts existing patterns
import { v } from 'convex/values';

export const extractionConfidenceValidator = v.union(
  v.literal('high'),
  v.literal('medium'),
  v.literal('low'),
);

export const extractionResultValueValidator = v.object({
  answer: v.union(v.string(), v.null()),
  confidence: v.optional(extractionConfidenceValidator),
  evidenceQuote: v.optional(v.string()),
  evidenceSourceId: v.optional(v.string()),
  evidenceStartChar: v.optional(v.number()),
  evidenceEndChar: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  modelUsed: v.optional(v.string()),
  tokensIn: v.optional(v.number()),
  tokensOut: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
});
```

### generateText with Output.object (verified pattern)

```typescript
// Source: node_modules/ai/docs/07-reference/01-ai-sdk-core/28-output.mdx
import { generateText, Output, NoObjectGeneratedError } from 'ai';

async function callTier(
  model: LanguageModel,
  schema: ZodSchema,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
) {
  const { output, usage } = await generateText({
    model,
    output: Output.object({ schema }),
    temperature: 0,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: signal,
  });
  return { output, usage };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `generateObject()` | `generateText({ output: Output.object() })` | AI SDK v6.0 | `generateObject` still works but `Output.object` is the new standard. Unified API for structured output. [VERIFIED: AI SDK v6 docs] |
| `zod-to-json-schema` | `z.toJSONSchema()` (Zod v4 native) | Zod v4 | No external dependency for JSON Schema conversion. `.meta()` propagates custom properties. [VERIFIED: zod@4.3.6] |
| Manual JSON repair | OpenRouter response-healing plugin | 2025 | Server-side healing reduces JSON defects by 80%+ at near-zero latency cost. [CITED: openrouter.ai/announcements/response-healing] |
| Chat Completions API | Responses API (`beta.responses.send`) | @openrouter/ai-sdk-provider v6.0.0-alpha | New API surface in alpha. May affect how certain parameters (plugins) are forwarded. [VERIFIED: source inspection] |

**Deprecated/outdated:**
- `streamObject()` / `generateObject()`: Still functional but `Output.object` via `generateText` is the v6 standard.
- `zodSchema()` helper: Automatic in v6 -- Zod schemas passed directly to `Output.object({ schema })` are auto-detected as Zod v4 and converted.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Gemini 3 Flash Preview accepts `propertyOrdering` via OpenRouter's JSON Schema passthrough. If OpenRouter strips it before forwarding to Gemini, field ordering will be unpredictable. | Architecture Patterns - Pattern 2 | LOW -- Gemini ignores the field gracefully; reasoning-before-answer is also enforced via system prompt instruction. |
| A2 | The OpenRouter `plugins` model option in `@openrouter/ai-sdk-provider@6.0.0-alpha.1` is forwarded to the API request body. The type definitions declare it, but the JS implementation for the Responses API path may not forward all model options. | Architecture Patterns - Pattern 1 | MEDIUM -- If not forwarded, use `extraBody` on `createOpenRouter()` as fallback. JSON healing is a nice-to-have, not critical -- AI SDK also has `experimental_repairToolCall`. |
| A3 | The inline semaphore pattern (counter + queue) correctly handles `Promise.allSettled` semantics -- all tasks complete regardless of individual failures. | Architecture Patterns - Pattern 3 | LOW -- Standard pattern, well-understood. |
| A4 | Token usage (`usage.promptTokens`, `usage.completionTokens` or equivalent) is returned by OpenRouter via the AI SDK's `generateText` response for all three model tiers. | Code Examples | LOW -- All providers return usage. OpenRouter's usage accounting is well-documented. |

## Open Questions

1. **Gemini 3 Flash Model ID: `google/gemini-3-flash` vs `google/gemini-3-flash-preview`**
   - What we know: `google/gemini-3-flash` returns "model not available" on OpenRouter (verified). `google/gemini-3-flash-preview` is active.
   - What's unclear: The CONTEXT.md D-08 specifies `google/gemini-3-flash`. This may become valid when the model exits preview, or it may already be a GA alias that routes to the preview.
   - Recommendation: Use `google/gemini-3-flash-preview` at implementation time. If `google/gemini-3-flash` becomes valid later, it can be updated with a one-line change.

2. **Token usage field naming in AI SDK v6 response**
   - What we know: AI SDK v6 uses `usage.inputTokens` / `usage.outputTokens` (new) alongside `usage.promptTokens` / `usage.completionTokens` (legacy). The `Usage` type in `lib/ai/core/types.ts` includes both.
   - What's unclear: Which fields OpenRouter populates via the Responses API path.
   - Recommendation: Read both fields with fallback: `usage.inputTokens ?? usage.promptTokens ?? 0`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ai` | Structured output | Yes | 6.0.161 | -- |
| `@openrouter/ai-sdk-provider` | OpenRouter cascade | Yes | 6.0.0-alpha.1 | -- |
| `zod` | Schema definition | Yes | 4.3.6 | -- |
| `OPENROUTER_API_KEY` env var | API authentication | Assumed | -- | Will fail at runtime without it |

**Missing dependencies with no fallback:** None -- all packages installed.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest + convex-test + @edge-runtime/vm |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run convex/extraction/mutations.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXTR-01 | Whole-paper text sent to Gemini via OpenRouter | integration (live LLM) | Manual -- requires OPENROUTER_API_KEY | No |
| EXTR-02 | Zod schema has propertyOrdering in JSON Schema | unit | `npx vitest run convex/extraction/extract.test.ts` | No -- Wave 0 |
| EXTR-06 | Three-tier cascade escalates on failure | unit (mock) | `npx vitest run convex/extraction/extract.test.ts` | No -- Wave 0 |
| EXTR-07 | Temperature 0, provider routing config | unit (config check) | `npx vitest run convex/extraction/extract.test.ts` | No -- Wave 0 |
| EXTR-09 | Result shape matches spec | unit | `npx vitest run convex/extraction/mutations.test.ts` | Partial -- extend existing |
| EXTR-10 | Parallel extraction with cap 5, per-question timeout | unit | `npx vitest run convex/extraction/extract.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/extraction/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `convex/extraction/extract.test.ts` -- covers EXTR-02 (schema propertyOrdering), EXTR-06 (cascade logic with mocked models), EXTR-10 (concurrency pattern)
- [ ] Extend `convex/extraction/mutations.test.ts` -- covers EXTR-09 (saveResult with all value fields)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Auth handled at job creation (Phase 89). workpool actions run in internal context. |
| V3 Session Management | No | No sessions in extraction pipeline. |
| V4 Access Control | Yes | Terminal-status guard on job prevents processing cancelled/completed jobs. User isolation via userId on job row. |
| V5 Input Validation | Yes | Zod schema validates LLM output. Convex validators on mutation args. `AbortSignal.timeout` prevents unbounded execution. |
| V6 Cryptography | No | No crypto in extraction pipeline. |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via paper text | Tampering | Phase 94 (CRASH-05) adds UUID delimiter defense. Phase 91 uses standard system prompt separation but does NOT implement delimiter defense -- that's Phase 94 scope. |
| Credit exhaustion via large papers | Denial of Service | `withUserCreditsBatch` checks balance before starting. Per-question timeout prevents unbounded cost. |
| LLM hallucinated evidence quotes | Information Disclosure | Phase 92 (EXTR-03, EXTR-04, EXTR-05) adds citation grounding. Phase 91 stores raw LLM output; Phase 92 validates it. |

## Sources

### Primary (HIGH confidence)
- `node_modules/ai/docs/07-reference/01-ai-sdk-core/28-output.mdx` -- Output.object API reference
- `node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts` -- Provider type definitions (plugins, provider routing)
- `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs` -- Provider implementation (schema passthrough at L1071)
- `node_modules/@ai-sdk/provider-utils/dist/index.mjs` -- zodSchema/zod4Schema JSON Schema conversion pipeline
- Local Zod v4 test confirming `.meta({ propertyOrdering })` propagation to `z.toJSONSchema()` output
- `convex/extraction/workpoolActions.ts` -- Current parse-only stub
- `convex/extraction/mutations.ts` -- Current saveResult skeleton
- `convex/extraction/validators.ts` -- Current validators
- `convex/schema.ts` L471-479 -- Current extractionResults table
- `convex/ai/helpers.ts` -- withUserCreditsBatch implementation
- `convex/screening/workpoolActions.ts` -- Reference implementation for credit-gated workpool actions
- `lib/ai/core/prompts.ts` -- 5 existing prompt builders (pattern reference)
- `lib/ai/core/execute.ts` -- executeAIOperation pattern (reference, not used directly)

### Secondary (MEDIUM confidence)
- [OpenRouter Response Healing docs](https://openrouter.ai/docs/guides/features/plugins/response-healing) -- Plugin syntax, limitations
- [OpenRouter Gemini 2.5 Flash Lite model page](https://openrouter.ai/google/gemini-2.5-flash-lite) -- Model availability, pricing
- [OpenRouter Gemini 3 Flash Preview model page](https://openrouter.ai/google/gemini-3-flash-preview) -- Model availability
- [OpenRouter Claude Haiku 4.5 model page](https://openrouter.ai/anthropic/claude-haiku-4.5) -- Model availability, pricing
- [Convex Limits documentation](https://docs.convex.dev/production/state/limits) -- 10-minute action timeout
- [GitHub Issue: AI SDK propertyOrdering support](https://github.com/vercel/ai/issues/5879) -- Feature request status (open)

### Tertiary (LOW confidence)
- None. All critical claims verified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages verified installed with correct versions
- Architecture: HIGH -- cascade pattern follows established codebase conventions; key technical claims (propertyOrdering, schema passthrough) verified via source inspection and local tests
- Pitfalls: HIGH -- model ID mismatch verified against live OpenRouter; response-healing limitations documented from official docs; alpha SDK behavior verified from source

**Research date:** 2026-04-15
**Valid until:** 2026-04-30 (OpenRouter model IDs may change; @openrouter/ai-sdk-provider alpha may release new versions)
