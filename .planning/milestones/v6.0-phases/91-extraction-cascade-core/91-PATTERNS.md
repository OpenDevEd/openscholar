# Phase 91: Extraction Cascade Core - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 7 new/modified files
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `convex/extraction/extract.ts` | service | request-response (cascade) | `convex/extraction/parse.ts` | exact |
| `convex/extraction/workpoolActions.ts` | controller | request-response | `convex/screening/workpoolActions.ts` | exact |
| `convex/extraction/mutations.ts` | model | CRUD | (self - extend `saveResult`) | exact |
| `convex/extraction/validators.ts` | utility | transform | (self - extend with new validator) | exact |
| `convex/schema.ts` | config | CRUD | (self - extend `extractionResults` table) | exact |
| `lib/ai/core/prompts.ts` | utility | transform | (self - 5 existing prompt builders) | exact |
| `convex/extraction/mutations.test.ts` | test | CRUD | (self - extend existing tests) | exact |

## Pattern Assignments

### `convex/extraction/extract.ts` (NEW - service, cascade)

**Analog:** `convex/extraction/parse.ts`

This is the primary new file. It mirrors `parse.ts` exactly: a pure async module (NOT a Convex function file), no `"use node"` directive, no function registrations. Imported by the workpool action file which has `"use node"`.

**Module header pattern** (parse.ts lines 1-19):
```typescript
/**
 * Multi-tier parsing waterfall for academic paper full-text retrieval.
 *
 * Exported function: parseFullText(doi, openalexId) -> { bodyText, parsingSource }
 *
 * Tier order (cheapest first):
 *   1. PMC JATS XML via Europe PMC (free, structured)
 *   2. arXiv HTML (free, semi-structured)
 *   ...
 *
 * This is a pure async module -- NOT a Convex function file.
 * No "use node" directive, no function registrations.
 * Imported by the "use node" workpool action file.
 */
```

**Type exports pattern** (parse.ts lines 32-42):
```typescript
export type ParsingSource =
  | "pmc"
  | "arxiv"
  | "unpdf"
  | "gemini"
  | "abstract_only";

export interface ParseResult {
  bodyText: string;
  parsingSource: ParsingSource;
}
```

**Tiered try/catch cascade pattern** (parse.ts lines 396-410):
```typescript
// 2. Tier 1: PMC JATS XML (30s timeout)
if (pmcId) {
  try {
    const bodyText = await withTimeout(
      (signal) => parsePmc(pmcId, signal),
      30_000
    );
    if (bodyText.length > 0) {
      return { bodyText, parsingSource: "pmc" };
    }
  } catch (error) {
    console.warn(
      `[ParseWaterfall] PMC tier failed for ${paperId} (${pmcId}): ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

**Main export function signature pattern** (parse.ts lines 382-385):
```typescript
export async function parseFullText(
  doi: string,
  openalexId: string
): Promise<ParseResult> {
```

**Structured output via AI SDK pattern** (lib/ai/core/execute.ts lines 71-79):
```typescript
const result = await generateText({
  model,
  output: Output.object({ schema }),
  experimental_repairToolCall: repairToolCall,
  providerOptions: STANDARD_PROVIDER_OPTIONS as unknown as Parameters<typeof generateText>[0]['providerOptions'],
  temperature,
  system: prompts.system,
  prompt: prompts.prompt,
});
```

**OpenRouter model creation pattern** (lib/ai/server/providers.ts lines 32-55):
```typescript
case 'openrouter': {
  const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')

  const extraBody: Record<string, unknown> = {}
  if (options?.openrouterProviderOrder) {
    const providerOrder = options.openrouterProviderOrder
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0)

    if (providerOrder.length > 0) {
      extraBody.provider = {
        order: providerOrder,
        allow_fallbacks: options.openrouterAllowFallbacks ?? true,
      }
    }
  }

  const openRouterOptions = {
    ...baseOptions,
    ...(Object.keys(extraBody).length > 0 && { extraBody }),
  }

  return createOpenRouter(openRouterOptions)(modelId)
}
```

---

### `convex/extraction/workpoolActions.ts` (MODIFIED - controller, request-response)

**Analog:** `convex/screening/workpoolActions.ts` (credit-gated AI call pattern), plus self (existing stub)

**Import pattern for credit billing** (screening/workpoolActions.ts lines 16-17):
```typescript
import { withUserCreditsBatch, getModel } from "../ai/helpers";
```

**Credit-gated AI call wrapper** (screening/workpoolActions.ts lines 100-158):
```typescript
const screeningResult: ScreeningResultData = await withUserCreditsBatch<ScreeningResultData>(
  ctx,
  job.userId as Id<"users">,
  `Bulk screening (paper ${result.openalexId})`,
  async (_pricing) => {
    const model = await getModel();
    const paperId = String(args.resultId);
    const batchResult = await processScreeningBatch({
      model,
      papers: [
        {
          id: paperId,
          title: result.title,
          abstract: result.abstract ?? "",
        },
      ],
      questions: questionTexts,
    });

    const totalUsage = batchResult.usages[0] ?? {
      inputTokens: 0,
      outputTokens: 0,
    };

    // ...tracking entries...

    return {
      result: paperResult,
      totalUsage,
      trackingEntries,
    };
  }
);
```

**Credit exhaustion error handling** (screening/workpoolActions.ts lines 170-199):
```typescript
} catch (error: unknown) {
  // Handle credit exhaustion: update job status and re-throw
  const isInsufficientCredits =
    error instanceof Error &&
    (error.message.includes("AI_INSUFFICIENT_CREDITS") ||
      (typeof (error as { data?: { code?: string } }).data === "object" &&
        (error as { data?: { code?: string } }).data?.code ===
          "AI_INSUFFICIENT_CREDITS"));

  if (isInsufficientCredits) {
    console.warn(
      `[screenPaperAction] Credits exhausted for job ${args.jobId}`
    );
    await ctx.runMutation(
      internal.screening.mutations.updateJobStatus,
      { jobId: args.jobId, status: "creditsExhausted" }
    );
    // ...tracking event...
  }

  throw error;
}
```

**Existing workpool action structure to extend** (extraction/workpoolActions.ts lines 30-112):
```typescript
export const processExtractionPaper = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // 1. Load job -- terminal-status guard
    // 2. Load paper -- idempotency guard
    // 3. Mark paper as parsing
    // 4. Run parsing waterfall
    // 5. Store parsed text via mutation
    // --- Phase 91 inserts here: ---
    // 6. Load questions from job
    // 7. Call extractAnswers() with credit billing
    // 8. Save results via saveResult mutation
    return { success: true };
  },
});
```

---

### `convex/extraction/mutations.ts` (MODIFIED - model, CRUD)

**Analog:** Self - extend `saveResult` at lines 300-327

**Current saveResult skeleton to extend** (mutations.ts lines 300-327):
```typescript
export const saveResult = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    questionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Idempotency check via by_paper_question index
    const existing = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper_question", (q) =>
        q.eq("paperId", args.paperId).eq("questionId", args.questionId)
      )
      .unique();

    if (existing) return null; // Skip -- idempotent

    await ctx.db.insert("extractionResults", {
      jobId: args.jobId,
      paperId: args.paperId,
      questionId: args.questionId,
      createdAt: Date.now(),
    });

    return null;
  },
});
```

**Validator import pattern** (mutations.ts lines 5-11):
```typescript
import {
  extractionJobStatusValidator,
  extractionPaperStatusValidator,
  extractionQuestionValidator,
  extractionPaperInputValidator,
  parsingSourceValidator,
} from "./validators";
```

---

### `convex/extraction/validators.ts` (MODIFIED - utility, transform)

**Analog:** Self - existing union validators as pattern

**Union validator pattern** (validators.ts lines 8-14):
```typescript
export const extractionJobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed")
);
```

**Object validator pattern** (validators.ts lines 49-53):
```typescript
export const extractionQuestionValidator = v.object({
  key: v.string(),
  question: v.string(),
  expectedType: v.optional(v.string()),
});
```

---

### `convex/schema.ts` (MODIFIED - config, CRUD)

**Analog:** Self - current `extractionResults` table at lines 471-479

**Current table definition to extend** (schema.ts lines 471-479):
```typescript
extractionResults: defineTable({
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  questionId: v.string(),
  createdAt: v.number(),
})
  .index("by_paper_question", ["paperId", "questionId"])
  .index("by_job", ["jobId"])
  .index("by_paper", ["paperId"]),
```

**Existing table pattern with optional fields** (schema.ts lines 438-460 for extractionPapers):
```typescript
extractionPapers: defineTable({
  jobId: v.id("extractionJobs"),
  openalexId: v.string(),
  title: v.string(),
  doi: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("parsing"),
    v.literal("extracting"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled")
  ),
  workpoolId: v.optional(v.string()),
  bodyText: v.optional(v.string()),
  parsingSource: v.optional(parsingSourceValidator),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
})
```

---

### `lib/ai/core/prompts.ts` (MODIFIED - utility, transform)

**Analog:** Self - 5 existing prompt builders

**Prompt builder function signature pattern** (prompts.ts lines 4-8):
```typescript
export function buildEnhanceQueryPrompts(input: EnhanceSearchQueryInput, retryCount: number) {
  const language = input.language
  const languageName = language ? getLanguageName(language) : null

  return {
    system: `...`,
    prompt: `...`,
  }
}
```

**Import pattern for prompt types** (prompts.ts line 1):
```typescript
import type { EnhanceSearchQueryInput, GenerateScreeningQuestionsInput, TranslateQueryInput, TranslatePaperContentInput, GenerateScreeningResponsesInput } from './types'
```

**System prompt structure: role definition + output format + instructions** (prompts.ts lines 9-61 for enhance query):
```typescript
system: `You are an Elasticsearch Query String Query optimization expert for academic search.

CRITICAL: You MUST respond with valid JSON in the following format:
{
  "enhancedQuery": "your query here"
}

...

Your task:
- ...

Core Principles:
1. ...

Validation Rules:
- ...`
```

**User prompt with input interpolation** (prompts.ts lines 62-76):
```typescript
prompt: `Enhance this academic search query using Elasticsearch Query String Query syntax.
Input query: "${input.query}"

...

Requirements:
1. ...
${retryCount > 0 ? '\n\nIMPORTANT: Previous attempt had...' : ''}`,
```

---

### `convex/extraction/mutations.test.ts` (MODIFIED - test, CRUD)

**Analog:** Self - existing test structure

**Test file imports and helpers** (mutations.test.ts lines 1-8):
```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
```

**Seed helper pattern** (mutations.test.ts lines 10-24):
```typescript
async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_extraction_test",
      email: "extraction-test@example.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    });
    return (await ctx.db.get(userId))!;
  });
}
```

**Test pattern with direct db operations** (mutations.test.ts lines 104-149):
```typescript
it("saving same (paperId, questionId) twice produces one row", async () => {
  const t = convexTest(schema);
  const user = await seedUser(t);
  const job = await seedExtractionJob(t, user._id);
  const paper = await seedExtractionPaper(t, job._id, "W001");

  // First save
  await t.run(async (ctx) => {
    await ctx.db.insert("extractionResults", {
      jobId: job._id,
      paperId: paper._id,
      questionId: "q1",
      createdAt: Date.now(),
    });
  });

  // ... assert ...
  expect(results).toHaveLength(1);
});
```

---

## Shared Patterns

### Credit Billing for Background Actions
**Source:** `convex/ai/helpers.ts` lines 320-402 (`withUserCreditsBatch`)
**Apply to:** `convex/extraction/workpoolActions.ts` (the cascade call)

```typescript
export async function withUserCreditsBatch<T>(
  ctx: ActionCtx,
  userId: Id<"users">,
  operation: string,
  handler: (pricing: Pricing) => Promise<{ result: T; totalUsage: Usage; trackingEntries?: AITrackingEntry[] }>,
): Promise<T> {
  // 1. Get user by ID (no auth check -- trusts userId from parent)
  // 2. Check credits balance
  // 3. Fetch pricing
  // 4. Run handler
  // 5. Calculate credits, PostHog tracking
  // 6. Deduct credits
  // 7. Return result
}
```

**Key contract:** The handler must return `{ result, totalUsage, trackingEntries? }`. Usage type uses `inputTokens`/`outputTokens` with fallback to `promptTokens`/`completionTokens`.

### Usage Type (Token Fields)
**Source:** `lib/ai/core/types.ts` lines 71-76
**Apply to:** `convex/extraction/extract.ts`, `convex/extraction/workpoolActions.ts`

```typescript
export interface Usage {
  promptTokens?: number;
  inputTokens?: number;
  completionTokens?: number;
  outputTokens?: number;
}
```

**Usage aggregation pattern** (helpers.ts line 271):
```typescript
inputTokens: totalUsage.inputTokens ?? totalUsage.promptTokens ?? 0,
outputTokens: totalUsage.outputTokens ?? totalUsage.completionTokens ?? 0,
```

### Terminal Status Guard
**Source:** `convex/extraction/workpoolActions.ts` lines 39-57
**Apply to:** Already in `workpoolActions.ts`, no changes needed

```typescript
const job = await ctx.runQuery(
  internal.extraction.queries.getJobInternal,
  { jobId: args.jobId }
);
if (!job) {
  console.warn(`[ExtractionPipeline] Job ${args.jobId} not found, skipping`);
  return { success: false };
}

const terminalStatuses = ["completed", "cancelled", "failed"];
if (terminalStatuses.includes(job.status)) {
  console.log(
    `[ExtractionPipeline] Job ${args.jobId} is ${job.status}, skipping paper ${args.paperId}`
  );
  return { success: false };
}
```

### Logging Convention
**Source:** `convex/extraction/workpoolActions.ts` lines 99-101, `convex/extraction/parse.ts` lines 406-408
**Apply to:** All extraction module files

```typescript
// Success logs
console.log(`[ExtractionPipeline] Paper ${args.paperId} parsed via ${result.parsingSource} (${result.bodyText.length} chars)`);

// Warning logs (tier failures)
console.warn(`[ParseWaterfall] PMC tier failed for ${paperId} (${pmcId}): ${error instanceof Error ? error.message : String(error)}`);
```

Pattern: `[ModuleName] Description` prefix, with error message extraction via `error instanceof Error ? error.message : String(error)`.

### Convex Internal Mutation Registration
**Source:** `convex/extraction/mutations.ts` lines 300-327
**Apply to:** `saveResult` extension

```typescript
export const saveResult = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    questionId: v.string(),
    // Phase 91 adds: ...extractionResultValueValidator.fields (spread)
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Idempotency check
    // Insert with all value fields
    return null;
  },
});
```

## No Analog Found

No files in this phase lack an analog. All 7 files have exact-match patterns from existing codebase files.

## Metadata

**Analog search scope:** `convex/extraction/`, `convex/screening/`, `convex/ai/`, `lib/ai/core/`, `lib/ai/server/`, `convex/schema.ts`
**Files scanned:** 12
**Pattern extraction date:** 2026-04-15
