# Phase 90: Free-First Parsing Waterfall - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 6 new/modified files
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `convex/extraction/parse.ts` | service | request-response (waterfall) | `convex/screening/workpoolActions.ts` | role-match |
| `convex/extraction/workpoolActions.ts` | controller (action) | request-response | `convex/screening/workpoolActions.ts` | exact |
| `convex/schema.ts` | config (schema) | N/A | `convex/schema.ts` (self) | exact |
| `convex/extraction/validators.ts` | config (validators) | N/A | `convex/extraction/validators.ts` (self) | exact |
| `convex.json` | config (runtime) | N/A | none (new file type) | no-analog |
| `tests/extraction/parse.test.ts` | test | N/A | `convex/extraction/mutations.test.ts` | role-match |

## Pattern Assignments

### `convex/extraction/parse.ts` (service, request-response waterfall) -- NEW FILE

**Analog:** `convex/screening/workpoolActions.ts` (for action structure) + `convex/library/backfill.ts` (for OpenAlex fetch pattern)

This is the core new module. It exports `parseFullText()` and contains all tier functions internally. It runs in Node.js runtime context (called from an action), but is NOT itself a registered Convex function -- it is a plain async module.

**File directive pattern** -- `convex/extraction/workpoolActions.ts` (line 1):
```typescript
"use node";
```
The file that imports `parse.ts` already has `"use node"`. The `parse.ts` module itself does NOT need the directive since it is not registering Convex functions directly, but it WILL be imported by a `"use node"` action file and uses Node.js APIs (`AbortSignal.timeout`, `fetch`, `Buffer`). Per Convex guidelines: `"use node"` goes on files that register actions, not on pure helper modules. However, since `parse.ts` uses `linkedom` and `fast-xml-parser` (Node.js-only packages), it must only be imported from `"use node"` files.

**OpenAlex fetch pattern** -- `convex/library/backfill.ts` (lines 8-9, 46-56):
```typescript
const OPENALEX_API_BASE = "https://api.openalex.org/works";

// Inside the handler:
const workId = item.openalexId.includes("/")
  ? item.openalexId.split("/").pop()!
  : item.openalexId;

const response = await fetch(
  `${OPENALEX_API_BASE}/${workId}?mailto=openscholar@sickrin.com`,
);

if (!response.ok) {
  console.warn(
    `[Backfill] Failed to fetch ${item.openalexId}: ${response.status}`,
  );
  failCount++;
  continue;
}

const work = await response.json();
```
**Adaptation for parse.ts:** Replace the hardcoded email with `process.env.OPENALEX_CONTACT_EMAIL` (per D-05). Accept a DOI parameter rather than openalexId. The URL pattern becomes `https://api.openalex.org/works/https://doi.org/${doi}?mailto=${email}`.

**Abstract reconstruction pattern** -- `lib/openalex/reconstruct-abstract.ts` (lines 10-27):
```typescript
export function reconstructAbstract(
  invertedIndex: Record<string, number[]>
): string {
  if (!invertedIndex || Object.keys(invertedIndex).length === 0) {
    return "";
  }

  const positionMap: Map<number, string> = new Map();

  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      positionMap.set(pos, word);
    }
  }

  const sortedPositions = Array.from(positionMap.keys()).sort((a, b) => a - b);
  return sortedPositions.map((pos) => positionMap.get(pos)).join(" ");
}
```
**Usage in parse.ts:** Import this function for the `abstract_only` fallback tier. The abstract inverted index comes from the OpenAlex metadata response at `work.abstract_inverted_index`.

**AI SDK generateText pattern** -- `lib/ai/core/execute.ts` (lines 71-79):
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
**Adaptation for Gemini PDF tier:** Much simpler call -- no structured output, no repair, no schema. Use `messages` array with `file` content part instead of `prompt`. Use `createGoogleGenerativeAI` directly (not OpenRouter).

**Google provider pattern** -- `lib/ai/server/providers.ts` (lines 23-26):
```typescript
case 'google': {
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
  return createGoogleGenerativeAI(baseOptions)(modelId)
}
```
**Adaptation for parse.ts:** Instantiate directly without dynamic import (since this file only uses Google). Pass no `apiKey` option to let the SDK use `GOOGLE_GENERATIVE_AI_API_KEY` env var automatically.

**Error logging pattern** -- `convex/screening/workpoolActions.ts` (lines 60-71, 78-83):
```typescript
console.warn(`[screenPaperAction] Job ${args.jobId} not found, skipping`);
// ...
console.log(
  `[screenPaperAction] Job ${args.jobId} is ${job.status}, skipping paper ${args.resultId}`
);
// ...
console.warn(
  `[screenPaperAction] Result ${args.resultId} not found, skipping`
);
```
**Adaptation for parse.ts:** Use `console.warn` for tier failures with prefix `[ParseWaterfall]` and tier name. Log the DOI/paper identifier and error message at each catch boundary.

---

### `convex/extraction/workpoolActions.ts` (controller/action, request-response) -- MODIFIED

**Analog:** `convex/screening/workpoolActions.ts`

This file already exists as a stub. Phase 90 fills the handler with: (1) load paper metadata via query, (2) call `parseFullText()`, (3) store bodyText + parsingSource via mutation, (4) return success.

**Action registration pattern** -- `convex/screening/workpoolActions.ts` (lines 1-2, 39-48):
```typescript
"use node";

// ... imports ...

export const screenPaperAction = internalAction({
  args: {
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  },
  returns: v.object({
    responses: v.record(v.string(), v.union(v.boolean(), v.null())),
    confidence: v.number(),
  }),
  handler: async (ctx, args): Promise<ScreeningActionResult> => {
```
**Adaptation:** The existing `processExtractionPaper` already follows this pattern. The handler body needs to be replaced.

**Terminal-status guard pattern** -- `convex/screening/workpoolActions.ts` (lines 54-71):
```typescript
// 1. Load job
const job = await ctx.runQuery(
  internal.screening.queries.getJobInternal,
  { jobId: args.jobId }
);
if (!job) {
  console.warn(`[screenPaperAction] Job ${args.jobId} not found, skipping`);
  return emptyResult;
}

// 2. Credit guard: skip terminal jobs
const terminalStatuses = ["cancelled", "creditsExhausted", "completed", "failed"];
if (terminalStatuses.includes(job.status)) {
  console.log(
    `[screenPaperAction] Job ${args.jobId} is ${job.status}, skipping paper ${args.resultId}`
  );
  return emptyResult;
}
```
**Copy directly.** Replace `screeningJobs` references with `extractionJobs`. Use `internal.extraction.queries.getJobInternal`.

**Idempotency guard pattern** -- `convex/screening/workpoolActions.ts` (lines 85-91):
```typescript
// 4. Idempotency guard: skip if already completed (prevents double-billing on retry)
if (result.status === "completed") {
  console.log(
    `[screenPaperAction] Result ${args.resultId} already completed, skipping (workpool retry)`
  );
  return emptyResult;
}
```
**Adaptation:** Check if `paper.bodyText` is already populated (idempotency for parsing). If bodyText exists, skip parsing and return success immediately.

**Error re-throw pattern** -- `convex/screening/workpoolActions.ts` (lines 170-199):
```typescript
} catch (error: unknown) {
  // Handle credit exhaustion: update job status and re-throw
  const isInsufficientCredits =
    error instanceof Error &&
    (error.message.includes("AI_INSUFFICIENT_CREDITS") || /* ... */);

  if (isInsufficientCredits) {
    console.warn(`[screenPaperAction] Credits exhausted for job ${args.jobId}`);
    await ctx.runMutation(
      internal.screening.mutations.updateJobStatus,
      { jobId: args.jobId, status: "creditsExhausted" }
    );
  }

  throw error;
}
```
**Adaptation:** No credit-specific handling needed for parsing (parsing is free except Gemini). But the catch-and-rethrow structure should be preserved so the workpool `onComplete` handler receives the error correctly.

**Storing results via mutation pattern** -- `convex/extraction/mutations.ts` `handleExtractionComplete` (lines 336-340):
```typescript
// Mark paper completed
await ctx.db.patch(context.paperId, {
  status: "completed",
  completedAt: Date.now(),
  updatedAt: Date.now(),
});
```
**Adaptation:** The workpool action should call an internal mutation to persist `bodyText` and `parsingSource` on the paper row. Alternatively, since the `onComplete` handler already runs a mutation, the action can return the parse result and let `handleExtractionComplete` store it. Prefer the latter -- it matches the screening pattern where the action returns data and the onComplete handler persists it.

---

### `convex/schema.ts` (config/schema) -- MODIFIED

**Analog:** Self (existing `extractionPapers` table definition)

**Current extractionPapers definition** -- `convex/schema.ts` (lines 437-457):
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
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
})
  .index("by_job", ["jobId"])
  .index("by_job_status", ["jobId", "status"]),
```
**Modification:** Add two new optional fields after `workpoolId`:
```typescript
bodyText: v.optional(v.string()),
parsingSource: v.optional(
  v.union(
    v.literal("pmc"),
    v.literal("arxiv"),
    v.literal("unpdf"),
    v.literal("gemini"),
    v.literal("abstract_only")
  )
),
```
Both fields are `v.optional()` because they are populated after the parsing step runs. The existing indexes and other fields remain unchanged.

---

### `convex/extraction/validators.ts` (config/validators) -- MODIFIED

**Analog:** Self (existing validators file)

**Current validator pattern** -- `convex/extraction/validators.ts` (lines 1-14):
```typescript
import { v } from "convex/values";

/**
 * Extraction job lifecycle statuses.
 * Unlike screening, extraction has no `creditsExhausted` state --
 * credit failures surface as `failed` with an error message.
 */
export const extractionJobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed")
);
```
**Addition:** Add a new exported validator for parsing source:
```typescript
/**
 * Parsing source tag indicating which tier produced the body text.
 * Surfaced in UI for transparency (PARSE-07).
 */
export const parsingSourceValidator = v.union(
  v.literal("pmc"),
  v.literal("arxiv"),
  v.literal("unpdf"),
  v.literal("gemini"),
  v.literal("abstract_only")
);
```
This validator can then be referenced from both `schema.ts` and `parse.ts` to keep the union definition DRY.

---

### `convex.json` (config/runtime) -- NEW FILE

**Analog:** None -- this is a new file type for the project.

**Reference:** RESEARCH.md provides the exact content (verified against Convex docs):
```json
{
  "$schema": "./node_modules/convex/schemas/convex.schema.json",
  "node": {
    "externalPackages": ["unpdf"]
  }
}
```
Note: The research initially suggested `"nodeVersion": "22"` but this project already has Node 22 pinned in CI. The `externalPackages` array is the critical piece -- it tells Convex's bundler to leave `unpdf` as an external dependency (not bundled) since `unpdf` bundles PDF.js which has wasm/binary assets that cannot be inlined.

---

### `convex/extraction/parse.test.ts` (test) -- NEW FILE

**Analog:** `convex/extraction/mutations.test.ts`

**Test file structure pattern** -- `convex/extraction/mutations.test.ts` (lines 1-9):
```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
```

**Seed helper pattern** -- `convex/extraction/mutations.test.ts` (lines 10-24):
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

**Test environment note:** Per `vitest.config.ts` (lines 14-16), Convex tests use `edge-runtime`:
```typescript
environmentMatchGlobs: [
  ["convex/**/*.test.ts", "edge-runtime"],
],
```

**Adaptation for parse.test.ts:** The parse module contains pure async functions (not Convex-registered functions), so tests can call them directly without `convexTest`. However, since the file lives in `convex/`, it will run in edge-runtime. For functions that use Node.js-only packages (`fast-xml-parser`, `linkedom`, `unpdf`), the tests may need to mock the external HTTP calls and library invocations. Alternatively, place integration tests in `tests/extraction/parse.test.ts` which runs in Node.js environment.

**Vitest environment config** -- `vitest.config.ts` (lines 12-16):
```typescript
test: {
  environment: "node",
  environmentMatchGlobs: [
    ["convex/**/*.test.ts", "edge-runtime"],
  ],
```
Files under `convex/` run in edge-runtime. Files under `tests/` run in Node.js. For testing `parse.ts` functions that require Node.js APIs, put tests in `tests/extraction/parse.test.ts` instead.

---

## Shared Patterns

### Terminal-Status Guard
**Source:** `convex/screening/workpoolActions.ts` (lines 64-71)
**Apply to:** `convex/extraction/workpoolActions.ts` handler

```typescript
const terminalStatuses = ["cancelled", "creditsExhausted", "completed", "failed"];
if (terminalStatuses.includes(job.status)) {
  console.log(
    `[screenPaperAction] Job ${args.jobId} is ${job.status}, skipping paper ${args.resultId}`
  );
  return emptyResult;
}
```

### Convex Error Creation
**Source:** `convex/lib/errors.ts` (lines 73-81)
**Apply to:** Any Convex function that needs typed errors

```typescript
import { createError } from "../lib/errors";

// Usage:
throw createError("EXTRACTION_JOB_NOT_FOUND", `Extraction job ${jobId} not found`);
```

### Internal Action Registration
**Source:** `convex/extraction/workpoolActions.ts` (lines 1-2, 13-14, 24-40)
**Apply to:** Any new Convex action in the extraction module

```typescript
"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const processExtractionPaper = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (_ctx, args) => {
    // ...
  },
});
```

### Workpool Pool Configuration
**Source:** `convex/workpool.ts` (lines 16-24)
**Apply to:** Understanding retry behavior for parse failures

```typescript
export const extractionPool = new Workpool(components.extractionWorkpool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});
```
The workpool retries 3 times with exponential backoff (2s, 4s, 8s). Parse failures that throw will be retried automatically. Idempotency guard in the action handler prevents double-work on retry.

### Console Log Prefix Convention
**Source:** Multiple files -- `convex/library/backfill.ts` (line 26), `convex/screening/workpoolActions.ts` (line 60), `convex/extraction/workflow.ts` (line 23)
**Apply to:** All new log statements

```typescript
// Pattern: [ModuleName] message with identifiers
console.log(`[ExtractionWorkflow] Starting extraction for job ${jobId}`);
console.warn(`[screenPaperAction] Job ${args.jobId} not found, skipping`);
console.log(`[Backfill] Processing ${batch.items.length} items...`);
```
For `parse.ts`, use `[ParseWaterfall]` prefix. Include DOI or paper identifier in all log messages.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `convex.json` | config | N/A | No existing `convex.json` in the project. This is the first file of this type. Content is fully specified in RESEARCH.md (verified against Convex docs). |

## Metadata

**Analog search scope:** `convex/`, `lib/`, project root
**Files scanned:** 14 source files read, 4 glob/grep searches
**Pattern extraction date:** 2026-04-15
