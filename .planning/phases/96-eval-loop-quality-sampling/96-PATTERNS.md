# Phase 96: Eval Loop & Quality Sampling - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 10 (4 new, 6 modified)
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tests/evals/screening-golden.ts` | test-data | static | `convex/extraction/validators.ts` | role-match |
| `tests/evals/screening-eval.test.ts` | test | request-response | `convex/extraction/extract.test.ts` | role-match |
| `convex/extraction/qualitySampling.ts` | service (action) | CRUD + event-driven | `convex/extraction/workpoolActions.ts` | exact |
| `.github/workflows/evals.yml` | config | batch | `.github/workflows/ci.yml` | exact |
| `convex/schema.ts` (modify) | model | CRUD | self | exact |
| `convex/crons.ts` (modify) | config | event-driven | self | exact |
| `convex/extraction/queries.ts` (modify) | controller | request-response | self (`getExtractionJobMetrics`) | exact |
| `convex/extraction/mutations.ts` (modify) | controller | CRUD | self (`updatePaperStatus`) | exact |
| `convex/extraction/validators.ts` (modify) | utility | transform | self | exact |

## Pattern Assignments

### `tests/evals/screening-golden.ts` (test-data, static)

**Analog:** `convex/extraction/validators.ts` (for typed export pattern)

**Typed export pattern** (validators.ts lines 8-14):
```typescript
// Export a named type and a const -- same structure for golden set
export const extractionJobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed")
);
```

**Apply to golden set as:**
```typescript
export interface GoldenCase {
  paperId: string;
  paperBodyText: string;
  question: string;
  expectedAnswer: string;
  expectedVerdict: "include" | "exclude" | "insufficient_evidence";
  expectedSourceSpan: { startChar: number; endChar: number };
  parsingSource: "pmc" | "arxiv" | "unpdf" | "gemini" | "abstract_only";
}

export const SCREENING_GOLDEN_SET: readonly GoldenCase[] = [
  // ... 20 cases
] as const;
```

---

### `tests/evals/screening-eval.test.ts` (test, request-response)

**Analog:** `convex/extraction/extract.test.ts`

**Imports pattern** (lines 1-2):
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
```

**Mock setup pattern** (lines 8-46):
```typescript
const mockGenerateText = vi.fn();

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: mockGenerateText,
  };
});

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => (modelId: string) => ({ modelId, provider: "openrouter" }),
}));
```

**Direct function import pattern** (line 191-196, 211-215):
```typescript
// extractAnswers is a pure async function -- callable directly from tests
const { extractAnswers } = await import("./extract");

const results = await extractAnswers(
  "The study enrolled 42 participants in a randomized controlled trial.",
  [{ key: "q1", question: "How many participants?", expectedType: "number" }]
);
```

**describe.skipIf gate pattern** (project convention from vitest docs):
```typescript
// Gate eval suite behind RUN_EVALS=1 environment variable
describe.skipIf(process.env.RUN_EVALS !== "1")("screening golden set evals", () => {
  // ... eval tests here
});
```

**Levenshtein similarity pattern** (extract.ts lines 113-117):
```typescript
import { distance } from "fastest-levenshtein";

const sourceSlice = bodyText.slice(data.evidence_start_char, data.evidence_end_char);
const maxLen = Math.max(data.evidence_quote.length, sourceSlice.length);
const similarity = maxLen === 0 ? 1 : 1 - distance(data.evidence_quote, sourceSlice) / maxLen;
```

---

### `convex/extraction/qualitySampling.ts` (service/action, CRUD + event-driven)

**Analog:** `convex/extraction/workpoolActions.ts`

**"use node" + imports pattern** (lines 1-8):
```typescript
"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
```

**internalAction registration pattern** (lines 39-48):
```typescript
export const processExtractionPaper = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    traceId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
```

**ctx.runQuery + ctx.runMutation pattern for DB access from action** (lines 50-56, 91-98):
```typescript
// READING from action -- must use ctx.runQuery
const job = await ctx.runQuery(
  internal.extraction.queries.getJobInternal,
  { jobId: args.jobId }
);
if (!job) {
  console.warn(JSON.stringify({ event: "job_not_found", jobId: String(args.jobId) }));
  return { success: false };
}

// WRITING from action -- must use ctx.runMutation
await ctx.runMutation(
  internal.extraction.mutations.storeParsedText,
  {
    paperId: args.paperId,
    bodyText: result.bodyText,
    parsingSource: result.parsingSource,
  }
);
```

**LLM invocation pattern from extract.ts** (lines 241-252, 259-276):
```typescript
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";

const openrouter = createOpenRouter();
const model = openrouter("google/gemini-2.5-flash-lite", {
  plugins: [{ id: "response-healing" }],
  provider: { allowFallbacks: true },
});

const { output, usage } = await generateText({
  model: tier.model,
  output: Output.object({ schema: criticOutputSchema }),
  temperature: 0,
  system: criticPrompts.system,
  prompt: criticPrompts.prompt,
  abortSignal: criticSignal,
});
```

**Critic prompt builder invocation pattern** (extract.ts lines 259-264):
```typescript
import { buildCriticPrompt } from "../../lib/ai/core/prompts";

const criticPrompts = buildCriticPrompt({
  question: question.question,
  answer: output.answer,
  evidenceQuote: output.evidence_quote,
  sourceSlice,
});
```

**Critic output schema** (extract.ts lines 141-146):
```typescript
const criticOutputSchema = z.object({
  verdict: z.enum(["supported", "unsupported", "partial"]).describe(
    "Whether the evidence quote appears verbatim in the source and supports the answer"
  ),
  reason: z.string().describe("Brief explanation of the verdict"),
});
```

**CRITICAL: `qualitySampling.ts` MUST only export actions.** Per Convex guidelines and Pitfall 6 from RESEARCH.md: files with `"use node"` cannot export queries or mutations. Internal queries/mutations needed by the sampling action must go in `queries.ts` and `mutations.ts` respectively.

---

### `.github/workflows/evals.yml` (config, batch)

**Analog:** `.github/workflows/ci.yml`

**Workflow structure pattern** (ci.yml lines 1-35):
```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  unit-and-build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk_test_placeholder
      # ...
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run unit and contract tests
        run: npm run test
```

**The evals workflow differs:** uses `paths` filter for extraction-only triggers, adds `RUN_EVALS=1` env, and runs `pnpm test tests/evals/` specifically.

---

### `convex/schema.ts` (modify -- add qualityChecks table)

**Analog:** Self -- `extractionResults` table definition (schema.ts lines 475-501)

**Table definition pattern with indexes** (lines 475-501):
```typescript
  extractionResults: defineTable({
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    questionId: v.string(),
    answer: v.union(v.string(), v.null()),
    confidence: v.optional(v.union(
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    )),
    // ... more fields ...
    createdAt: v.number(),
  })
    .index("by_paper_question", ["paperId", "questionId"])
    .index("by_job", ["jobId"])
    .index("by_paper", ["paperId"]),
```

**Section comment convention** (lines 503-505):
```typescript
  // ═══════════════════════════════════════════════════════════════
  // LIBRARY ITEMS - User's saved paper library (rated papers)
  // ═══════════════════════════════════════════════════════════════
```

**Apply as:**
```typescript
  // ═══════════════════════════════════════════════════════════════
  // QUALITY CHECKS - Hourly production quality sampling (EVAL-04)
  // ═══════════════════════════════════════════════════════════════
  qualityChecks: defineTable({
    answerId: v.id("extractionResults"),
    verdict: v.string(),
    judgeModel: v.string(),
    timestamp: v.number(),
    reviewStatus: v.string(), // "pending" | "reviewed" | "promoted"
  })
    .index("by_answerId", ["answerId"])
    .index("by_timestamp", ["timestamp"]),
```

---

### `convex/crons.ts` (modify -- add hourly quality sampling)

**Analog:** Self -- existing cron registrations (crons.ts lines 13-19)

**Hourly cron pattern** (lines 13-19):
```typescript
// Hourly subscription status check: corrective sync + past-due expiry
crons.interval(
  "check subscription status",
  { hours: 1 },
  internal.maintenance.internal.checkSubscriptionStatus,
  {},
);
```

**Apply as:**
```typescript
// Hourly quality sampling: pick 1 production answer, re-run critic (EVAL-04)
crons.interval(
  "quality sampling",
  { hours: 1 },
  internal.extraction.qualitySampling.sampleAndCheck,
  {},
);
```

---

### `convex/extraction/queries.ts` (modify -- add getQualityTrend, getReviewQueue)

**Analog:** Self -- `getExtractionJobMetrics` (queries.ts lines 76-152)

**Auth-gated public query with typed return** (lines 76-95):
```typescript
export const getExtractionJobMetrics = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      papersProcessed: v.number(),
      averageLatencyMs: v.union(v.number(), v.null()),
      estimatedCostUsd: v.number(),
      errorCount: v.number(),
      citationValidityRate: v.union(v.number(), v.null()),
      recallOnInclude: v.union(v.number(), v.null()),
    })
  ),
  handler: async (ctx, args) => {
    // Auth + ownership guard (D-17)
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;
```

**Index-based query with .take() bound** (lines 98-103):
```typescript
    const completedPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "completed")
      )
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);
```

**Apply to getQualityTrend as:**
```typescript
export const getQualityTrend = query({
  args: {},
  returns: v.union(v.null(), v.object({
    supported: v.number(),
    unsupported: v.number(),
    partial: v.number(),
    total: v.number(),
    passRate: v.number(),
  })),
  handler: async (ctx, _args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const checks = await ctx.db
      .query("qualityChecks")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", sevenDaysAgo))
      .take(1000);
    // ... aggregate counts ...
  },
});
```

**Joined query pattern for getReviewQueue** -- use `getPaperBodyText` as reference (queries.ts lines 205-223):
```typescript
export const getPaperBodyText = query({
  args: { paperId: v.id("extractionPapers") },
  returns: v.union(
    v.null(),
    v.object({ bodyText: v.union(v.string(), v.null()) })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;

    const job = await ctx.db.get(paper.jobId);
    if (!job || job.userId !== user._id) return null;

    return { bodyText: paper.bodyText ?? null };
  },
});
```

**Apply to getReviewQueue:** load qualityChecks with `reviewStatus === "pending"`, then join each check's answerId to `extractionResults`, then join paperId to `extractionPapers` for context.

---

### `convex/extraction/mutations.ts` (modify -- add updateReviewStatus)

**Analog:** Self -- `updatePaperStatus` (mutations.ts lines 373-395)

**Auth-gated internal mutation with patch** (lines 373-395):
```typescript
export const updatePaperStatus = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    status: extractionPaperStatusValidator,
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage;
    }

    await ctx.db.patch(args.paperId, patch);
    return null;
  },
});
```

**For `updateReviewStatus`, use public `mutation` (not `internalMutation`) with `requireAuth` pattern** from `cancelExtractionJob` (mutations.ts lines 161-167):
```typescript
export const cancelExtractionJob = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) {
      throw createError("EXTRACTION_JOB_NOT_FOUND", "Extraction job not found");
    }
```

**Apply as:**
```typescript
export const updateReviewStatus = mutation({
  args: {
    qualityCheckId: v.id("qualityChecks"),
    reviewStatus: v.union(v.literal("reviewed"), v.literal("promoted")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    // ... load check, verify, patch ...
  },
});
```

---

### `convex/extraction/validators.ts` (modify -- add qualityChecks validators)

**Analog:** Self (validators.ts lines 8-14, 74-78)

**Validator pattern** (lines 74-78):
```typescript
export const extractionConfidenceValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low")
);
```

**Apply as:**
```typescript
export const reviewStatusValidator = v.union(
  v.literal("pending"),
  v.literal("reviewed"),
  v.literal("promoted")
);
```

---

## Shared Patterns

### Authentication (getCurrentUser)
**Source:** `convex/lib/auth.ts` lines 31-39
**Apply to:** `getQualityTrend`, `getReviewQueue` (public queries)
```typescript
import { getCurrentUser } from "../lib/auth";

// In query handler:
const user = await getCurrentUser(ctx);
if (!user) return null;
```

### Authentication (requireAuth)
**Source:** `convex/lib/auth.ts` lines 48-64
**Apply to:** `updateReviewStatus` (public mutation)
```typescript
import { requireAuth } from "../lib/auth";

// In mutation handler:
const user = await requireAuth(ctx);
```

### Error Handling (createError)
**Source:** `convex/lib/errors.ts` lines 73-81
**Apply to:** `updateReviewStatus` mutation
```typescript
import { createError } from "../lib/errors";

throw createError("NOT_FOUND", "Quality check not found");
```

### Convex Validators (typed returns)
**Source:** `convex/extraction/queries.ts` lines 78-88
**Apply to:** All new query/mutation functions
```typescript
// Every function has explicit returns validator -- no v.any()
returns: v.union(
  v.null(),
  v.object({
    // ... typed fields ...
  })
),
```

### Index-Based Queries (no .filter())
**Source:** `convex/extraction/queries.ts` lines 98-103
**Apply to:** All new queries on `qualityChecks`
```typescript
// ALWAYS use .withIndex(), NEVER .filter()
const checks = await ctx.db
  .query("qualityChecks")
  .withIndex("by_timestamp", (q) => q.gte("timestamp", sevenDaysAgo))
  .take(1000);
```

### Bounded .take() (no unbounded .collect())
**Source:** `convex/extraction/queries.ts` line 103, `convex/lib/queryBounds.ts`
**Apply to:** All new DB queries
```typescript
// qualityChecks grows ~24 rows/day, so .take(1000) covers ~41 days
.take(1000);
```

### Structured Logging
**Source:** `convex/extraction/workpoolActions.ts` lines 55-56
**Apply to:** `qualitySampling.ts` action
```typescript
console.warn(JSON.stringify({ event: "job_not_found", jobId: String(args.jobId), traceId: args.traceId }));
console.info(JSON.stringify({ event: "quality_sample_complete", answerId: String(sample._id), verdict }));
```

### Cron Pattern
**Source:** `convex/crons.ts` lines 13-19
**Apply to:** New cron entry for quality sampling
```typescript
crons.interval(
  "quality sampling",
  { hours: 1 },
  internal.extraction.qualitySampling.sampleAndCheck,
  {},
);
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All files have close analogs in the existing codebase |

Every file in this phase maps to existing patterns. The `vitest-evals` `describeEval` API is new (no existing usage), but its test file structure mirrors `extract.test.ts`. The `autoevals` Factuality scorer is a library call with no codebase precedent, but RESEARCH.md provides the API pattern.

## Metadata

**Analog search scope:** `convex/extraction/`, `convex/lib/`, `convex/crons.ts`, `convex/schema.ts`, `tests/`, `.github/workflows/`, `lib/ai/core/`
**Files scanned:** 15 analogs read in full
**Pattern extraction date:** 2026-04-15
