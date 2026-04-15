# Phase 95: Structured Observability & SLO Metrics - Research

**Researched:** 2026-04-15
**Domain:** Structured logging, ULID tracing, cost estimation, SLO metric computation in Convex
**Confidence:** HIGH

## Summary

Phase 95 adds structured observability to the extraction pipeline without any paid vendor. The scope is tightly bounded: (1) a new `convex/extraction/logging.ts` module emitting structured JSON via `console.info`/`console.error`, (2) ULID traceId generation at job creation and propagation through the workpool action, (3) a per-job metrics query aggregating cost/latency/errors, and (4) SLO metric persistence on the `extractionJobs` row at finalization.

The existing codebase is exceptionally well-positioned. Every data point needed already exists: `tokensIn`/`tokensOut` on `extractionResults`, `criticVerdict` for citation-validity-rate, `createdAt`/`completedAt` on `extractionPapers` for latency, `status === "failed"` count via the `by_job_status` index, and `classifyExtractionError()` returning `{retryable, category, message}`. The work is primarily wiring -- creating the logging helpers, replacing ad-hoc console calls, threading `traceId` through function arguments, adding schema fields, and writing two new queries.

**Primary recommendation:** Implement as three sequential waves -- (1) schema migration + ULID generation + logging module, (2) traceId propagation + log replacement in workpoolActions/extract, (3) metrics query + SLO persistence in finalizer.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Generate a ULID `traceId` in `createExtractionJob` mutation; persist on `extractionJobs` row as `v.optional(v.string())`.
- **D-02:** Install the `ulid` npm package for ULID generation.
- **D-03:** Propagate `traceId` through workpool enqueue args as a flat arg alongside `jobId` and `paperId`.
- **D-04:** Propagate `traceId` into `extractAnswers()` as a new parameter for structured logging.
- **D-05:** Durable workflow step reads `traceId` from job row and passes to each workpool enqueue call.
- **D-06:** Create `convex/extraction/logging.ts` exporting `emitStageLog()` and `emitStageError()`.
- **D-07:** Structured info log shape: `{traceId, jobId, paperId, stage, model, tokensIn, tokensOut, costUsd, latencyMs, status}`. Stage values: `"parse"`, `"extract"`, `"critic"`, `"save"`.
- **D-08:** Structured error log shape extends info with: `{errorMessage, errorCategory, retryable}`.
- **D-09:** `costUsd` derived from static cost-per-token map for each OpenRouter model. Map lives in `logging.ts`.
- **D-10:** Replace all existing ad-hoc `console.log`/`console.error` in `workpoolActions.ts` with structured calls.
- **D-11:** `latencyMs` measured via `Date.now()` delta around each stage.
- **D-12:** New `getExtractionJobMetrics` query in `convex/extraction/queries.ts`.
- **D-13:** Query returns `{papersProcessed, averageLatencyMs, estimatedCostUsd, errorCount}` -- all typed, no `v.any()`.
- **D-14:** `averageLatencyMs` computed from `(completedAt - createdAt)` across completed `extractionPapers`.
- **D-15:** `estimatedCostUsd` computed from `tokensIn`/`tokensOut` on `extractionResults` using the static cost map.
- **D-16:** `errorCount` from `extractionPapers` with `status === "failed"` via `by_job_status` index.
- **D-17:** Auth follows `getExtractionProgress` pattern: `getCurrentUser(ctx)` -> job ownership check -> return null if unauthorized.
- **D-18:** Add `citationValidityRate: v.optional(v.number())` and `recallOnInclude: v.optional(v.number())` to `extractionJobs` schema.
- **D-19:** `citationValidityRate` computed at finalization: count of `criticVerdict === "supported"` / total non-null `criticVerdict` results.
- **D-20:** `recallOnInclude` stored as `null` for now (Phase 96 populates it).
- **D-21:** `getJobSLOMetrics` query returning `{citationValidityRate: number | null, recallOnInclude: number | null}`.

### Claude's Discretion
- Whether `emitStageLog` uses a typed params object vs overloaded signatures.
- Exact cost-per-token values in the static map (use current OpenRouter pricing).
- Whether `getExtractionJobMetrics` and `getJobSLOMetrics` are one query or two.
- Test fixture design for structured log assertions.
- Whether `latencyMs` for "extract" stage is per-question or aggregate per-paper.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBS-01 | Every extraction stage emits a single structured `console.info` JSON line with `{traceId, jobId, paperId, stage, model, tokensIn, tokensOut, costUsd, latencyMs, status}` | Logging module pattern (D-06, D-07), cost map with verified pricing, `Date.now()` timing |
| OBS-02 | `traceId` (ULID) generated in `startExtraction` mutation propagated through every step | `ulid` v3 package verified, Convex V8 runtime compatible (`crypto.getRandomValues`), flat arg propagation pattern |
| OBS-03 | Failures logged via `console.error` with same JSON shape plus `{errorMessage, errorCategory, retryable}` | `ErrorCategory` type from `errors.ts` reused, `classifyExtractionError()` already returns exact shape |
| OBS-04 | UI shows per-job metrics fed by typed Convex query | Aggregation query pattern using existing indexes, auth pattern from `getExtractionProgress` |
| OBS-05 | Two SLO metrics persisted per run: recall-on-include and citation-validity-rate | Schema extension on `extractionJobs`, finalization hook in `finalizeJobIfDone`, `criticVerdict` data from Phase 92 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ULID traceId generation | Convex mutation (V8) | -- | Generated at job creation time in `createExtractionJob` mutation; must be deterministic within the transaction |
| Structured log emission | Convex action (Node.js) | -- | Logs are emitted from `workpoolActions.ts` which runs in Node.js via `"use node"`; `logging.ts` is a pure module imported by it |
| traceId propagation | Convex action (Node.js) | Convex mutation (V8) | Action receives traceId as flat arg from workpool enqueue; mutations pass it via `enqueueAllPapers` |
| Per-job metrics query | Convex query (V8) | -- | Read-only aggregation over `extractionPapers` and `extractionResults` tables |
| SLO metric persistence | Convex mutation (V8) | -- | Computed and written in `finalizeJobIfDone` / `handleExtractionComplete` mutation |
| Cost estimation | Pure function (logging.ts) | -- | Static cost-per-token map; no runtime dependency, imported wherever needed |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ulid | 3.0.2 | ULID generation for traceId | Zero dependencies, ESM/CJS, uses `crypto.getRandomValues` (available in Convex V8 runtime), monotonically sortable [VERIFIED: npm registry] |
| convex | 1.34.1 | Backend runtime (already installed) | Project's backend framework [VERIFIED: package.json] |
| vitest | 3.2.4 | Test framework (already installed) | Project's test runner [VERIFIED: package.json] |
| convex-test | 0.0.46 | Convex function testing (already installed) | Required for testing Convex mutations/queries in edge-runtime [VERIFIED: package.json] |

### Supporting
No additional libraries needed. The phase uses only the existing stack plus `ulid`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ulid v3 | ulidx v2.4.1 | ulidx has 1 dependency (`layerr`), published 1 year ago vs ulid 4 months ago. ulid v3 is the canonical package. |
| ulid v3 | `crypto.randomUUID()` + timestamp prefix | UUIDs are not lexicographically sortable; ULIDs provide timestamp-prefix grep-ability that UUIDs lack. |
| Date.now() for latency | performance.now() | `performance.now()` is not used anywhere in the Convex codebase; `Date.now()` is the established pattern and provides millisecond resolution sufficient for LLM latency (100ms-60s range). |

**Installation:**
```bash
npm install ulid
```

**Version verification:**
- ulid: 3.0.2 (published 2025-12, zero dependencies) [VERIFIED: npm registry 2026-04-15]

## Architecture Patterns

### System Architecture Diagram

```
createExtractionJob (mutation)
  |
  +-- [1] Generate ULID traceId --> persist on extractionJobs row
  |
  v
runExtractionWorkflow (workflow step)
  |
  +-- [2] Read traceId from job row
  |
  v
enqueueAllPapers (mutation)
  |
  +-- [3] Pass traceId as flat arg in workpool enqueue
  |
  v
processExtractionPaper (action, "use node")
  |
  +-- [4] Receive traceId from args
  |
  +-- PARSE stage --> emitStageLog({stage:"parse", traceId, ...})
  |                   on error --> emitStageError({...})
  |
  +-- EXTRACT stage --> extractAnswers(bodyText, questions, parsingSource, traceId)
  |   |                  emitStageLog({stage:"extract", traceId, ...})
  |   |                  on error --> emitStageError({...})
  |   |
  |   +-- CRITIC stage (inside extractSingleAnswer)
  |                      emitStageLog({stage:"critic", traceId, ...})
  |
  +-- SAVE stage --> emitStageLog({stage:"save", traceId, ...})
  |
  v
handleExtractionComplete (onComplete handler)
  |
  +-- Update paper status + counters
  |
  v
finalizeJobIfDone (mutation)
  |
  +-- [5] Compute citationValidityRate from extractionResults.criticVerdict
  +-- [6] Persist SLO metrics on job row
  |
  v
getExtractionJobMetrics (query)
  |
  +-- [7] Aggregate: papersProcessed, avgLatency, estimatedCost, errorCount
  +-- [8] Return citationValidityRate, recallOnInclude from job row
```

### Recommended Project Structure
```
convex/extraction/
  logging.ts        # NEW: emitStageLog(), emitStageError(), COST_PER_TOKEN_MAP
  errors.ts         # EXISTING: ErrorCategory type, classifyExtractionError()
  workpoolActions.ts # MODIFY: replace ad-hoc logs, add traceId arg, add timing
  extract.ts        # MODIFY: accept traceId param, emit structured logs
  mutations.ts      # MODIFY: generate ULID in createExtractionJob, SLO in finalizer
  queries.ts        # MODIFY: add getExtractionJobMetrics query
  workflow.ts       # MODIFY: read traceId from job, pass to enqueue
  validators.ts     # MODIFY: add new validators if needed
  schema.ts         # MODIFY: add traceId, citationValidityRate, recallOnInclude fields
```

### Pattern 1: Structured Log Emission

**What:** Pure helper functions that format and emit structured JSON via `console.info`/`console.error`.
**When to use:** Every extraction stage boundary (parse complete, extract complete, critic complete, save complete, error).

```typescript
// convex/extraction/logging.ts

import type { ErrorCategory } from "./errors";
import type { Id } from "../_generated/dataModel";

// --- Stage type ---
export type ExtractionStage = "parse" | "extract" | "critic" | "save";

// --- Structured log params ---
export interface StageLogParams {
  traceId: string;
  jobId: Id<"extractionJobs">;
  paperId: Id<"extractionPapers">;
  stage: ExtractionStage;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  status: "success" | "failure" | "skip";
}

export interface StageErrorParams extends StageLogParams {
  errorMessage: string;
  errorCategory: ErrorCategory;
  retryable: boolean;
}

// --- Cost-per-token map (per million tokens) ---
export const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
  "google/gemini-3-flash-preview": { input: 0.50, output: 3.00 },
  "anthropic/claude-haiku-4.5": { input: 1.00, output: 5.00 },
};

export function computeCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = COST_PER_MILLION_TOKENS[model];
  if (!pricing) return 0;
  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}

export function emitStageLog(params: StageLogParams): void {
  console.info(JSON.stringify(params));
}

export function emitStageError(params: StageErrorParams): void {
  console.error(JSON.stringify(params));
}
```
Source: Verified OpenRouter pricing pages [VERIFIED: openrouter.ai model pages, 2026-04-15]

### Pattern 2: ULID Generation in Mutation

**What:** Generate ULID in the `createExtractionJob` mutation and persist on the job row.
**When to use:** Job creation (once per extraction run).

```typescript
// In convex/extraction/mutations.ts (createExtractionJob handler)
import { ulid } from "ulid";

// Inside handler:
const traceId = ulid();
const jobId = await ctx.db.insert("extractionJobs", {
  userId: user._id,
  status: "pending",
  traceId,
  // ... other fields
});
```
Source: ulid npm package API [VERIFIED: github.com/ulid/javascript]

**Runtime compatibility note:** The `ulid` package uses `crypto.getRandomValues()` for PRNG. Convex's V8 default runtime (used by mutations) provides `crypto.getRandomValues()` as part of the Web Crypto API. This is confirmed by the fact that the project already uses `crypto`-dependent packages in the V8 runtime. The `ulid()` function call is synchronous and stateless -- ideal for use inside a Convex mutation. [ASSUMED]

### Pattern 3: traceId Propagation via Flat Args

**What:** Pass `traceId` as a flat arg through workpool enqueue, not as a nested context object.
**When to use:** Workpool enqueue and action args.

```typescript
// In enqueueAllPapers mutation:
const workId = await extractionPool.enqueueAction(
  ctx,
  internal.extraction.workpoolActions.processExtractionPaper,
  { paperId: paper._id, jobId: args.jobId, traceId: job.traceId ?? "" },
  {
    onComplete: internal.extraction.mutations.handleExtractionComplete,
    context: { paperId: paper._id, jobId: args.jobId },
  }
);

// In processExtractionPaper action args:
args: {
  paperId: v.id("extractionPapers"),
  jobId: v.id("extractionJobs"),
  traceId: v.string(),  // NEW
},
```
Source: Existing `enqueueAllPapers` code pattern [VERIFIED: codebase]

### Pattern 4: Aggregation Query with Auth

**What:** Query that aggregates metrics from multiple rows, following the existing auth + ownership pattern.
**When to use:** `getExtractionJobMetrics` query.

```typescript
// Pattern from getExtractionProgress:
const user = await getCurrentUser(ctx);
if (!user) return null;
const job = await ctx.db.get(args.jobId);
if (!job || job.userId !== user._id) return null;

// Aggregate from extractionPapers for latency:
const completedPapers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job_status", (q) => q.eq("jobId", args.jobId).eq("status", "completed"))
  .take(MAX_EXTRACTION_PAPERS_PER_JOB);

// Aggregate from extractionResults for cost:
const results = await ctx.db
  .query("extractionResults")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_EXTRACTION_PAPERS_PER_JOB * 10); // papers * questions
```
Source: Existing `getExtractionProgress` query pattern [VERIFIED: codebase]

### Anti-Patterns to Avoid
- **Freeform string logs:** Never use `console.log(\`[ExtractionPipeline] ...\`)` -- all extraction pipeline logs must go through `emitStageLog`/`emitStageError` for grep-friendliness.
- **`v.any()` in query returns:** Per project conventions and D-13, every return field must be typed with explicit validators.
- **Computing SLO metrics on read:** Computing `citationValidityRate` inside the metrics query would scan all results every time. Instead, compute once at finalization and persist as a denormalized field -- matching the existing `processedPapers`/`failedPapers` counter pattern.
- **Nested context objects for traceId:** D-03 explicitly says flat args, not a context wrapper. Keep it simple.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ULID generation | Custom timestamp+random concat | `ulid` npm package | Handles crypto PRNG detection, monotonic ordering, validation, encoding -- 10 edge cases in 69KB |
| Error classification | Inline if/else chains in log helpers | `classifyExtractionError()` from `errors.ts` | Already covers 10 error categories with priority ordering; reuse avoids divergent classification |
| Cost calculation | Inline arithmetic at each call site | `computeCostUsd()` centralized in `logging.ts` | Single source of truth for pricing; when models change, update one map |

**Key insight:** This phase is fundamentally a wiring phase. Every data source already exists in the schema. The only new things are (a) a formatting/emission layer, (b) a ULID field, and (c) two aggregation queries. Resist the urge to build infrastructure beyond what the requirements ask for.

## Common Pitfalls

### Pitfall 1: ULID in Wrong Runtime
**What goes wrong:** Importing `ulid` in a file that runs in Convex's V8 runtime but the package tries to use Node.js-specific `crypto.randomBytes`.
**Why it happens:** The `ulid` package auto-detects the PRNG. In Convex's V8 runtime, `crypto.getRandomValues` should be available (Web Crypto API), but `crypto.randomBytes` (Node.js) is not.
**How to avoid:** The `createExtractionJob` mutation runs in the V8 runtime. Verify `ulid()` works in `convex-test` edge-runtime environment before proceeding. If it fails, use the `monotonicFactory()` with a custom PRNG or generate the ULID in a helper action and pass it back.
**Warning signs:** `ReferenceError: crypto is not defined` or `crypto.randomBytes is not a function` in mutation tests.

### Pitfall 2: Unbounded Result Scan in Metrics Query
**What goes wrong:** Using `.collect()` without bounds on `extractionResults` table for cost aggregation. As jobs grow (200 papers x 5+ questions = 1000+ results), this becomes expensive.
**Why it happens:** Convex queries read every document matching the index prefix.
**How to avoid:** Use `.take(MAX_EXTRACTION_PAPERS_PER_JOB * 10)` as an upper bound (200 papers * up to ~10 questions = 2000 max results per job). This is well within Convex's read limits.
**Warning signs:** Query reads exceeding Convex transaction limits (8192 documents).

### Pitfall 3: OCC Contention on Job Row During SLO Computation
**What goes wrong:** `finalizeJobIfDone` already patches the job row with `status: "completed"`. Adding SLO metric computation (which reads `extractionResults`) in the same mutation increases read set, potentially causing OCC retries.
**Why it happens:** `handleExtractionComplete` also patches the same job row for counter increments. If `finalizeJobIfDone` is called immediately after, both mutations touch the same document.
**How to avoid:** Compute SLO metrics inside `finalizeJobIfDone` rather than in a separate mutation. This is already a single transaction that sets `status: "completed"` -- adding the SLO fields to the same `ctx.db.patch` call is atomic and adds no OCC risk.
**Warning signs:** `TransactionConflict` errors during job completion.

### Pitfall 4: Missing traceId on Retry
**What goes wrong:** If a workpool action fails and retries, the retry invocation must still have `traceId` in its args. Since `traceId` is a flat arg (D-03), workpool retries automatically re-invoke with the same args -- this works correctly by default.
**Why it happens:** It does not happen with the flat-arg approach. But if traceId were fetched from the job row inside the action, a DB read race could return stale data.
**How to avoid:** Keep traceId as a flat action arg (D-03). Never read traceId from the DB inside the action.
**Warning signs:** Structured logs with missing or empty traceId fields.

### Pitfall 5: JSON.stringify in console.info Losing Structure
**What goes wrong:** Convex's log viewer may not parse nested JSON inside `console.info`. The structured JSON becomes a flat string.
**Why it happens:** Convex's logging infrastructure treats `console.info` output as strings. The JSON structure is preserved in the string but requires `grep` + `jq` to parse, not a structured log viewer.
**How to avoid:** This is by design for this phase (D-06: "grep-friendly incident triage without a paid observability vendor"). The goal is `grep traceId | jq .` on exported logs. Future OBS-FUT-01/02 will add Sentry/Langfuse for structured querying.
**Warning signs:** Expecting Convex dashboard to show structured log fields -- it won't, and that's intentional.

## Code Examples

### Cost Computation with Verified Pricing

```typescript
// Source: OpenRouter pricing pages (verified 2026-04-15)
export const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash-lite":   { input: 0.10, output: 0.40 },
  "google/gemini-3-flash-preview":  { input: 0.50, output: 3.00 },
  "anthropic/claude-haiku-4.5":     { input: 1.00, output: 5.00 },
};

export function computeCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = COST_PER_MILLION_TOKENS[model];
  if (!pricing) return 0; // Unknown model -- zero cost rather than crash
  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}

// Example: 50,000 input + 500 output tokens on Gemini 2.5 Flash Lite
// = (50000 * 0.10 + 500 * 0.40) / 1_000_000
// = (5000 + 200) / 1_000_000
// = $0.0052
```

### SLO Metric Computation at Finalization

```typescript
// Inside finalizeJobIfDone, after confirming job is complete:
// Compute citationValidityRate (D-19)
const results = await ctx.db
  .query("extractionResults")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_EXTRACTION_PAPERS_PER_JOB * 10);

const withVerdict = results.filter((r) => r.criticVerdict != null);
const supported = withVerdict.filter((r) => r.criticVerdict === "supported");
const citationValidityRate =
  withVerdict.length > 0 ? supported.length / withVerdict.length : null;

await ctx.db.patch(args.jobId, {
  status: "completed",
  completedAt: now,
  updatedAt: now,
  citationValidityRate,
  recallOnInclude: null, // Phase 96 populates this
});
```

### Test Pattern: Console Capture for Structured Log Assertions

```typescript
// Test pattern using vitest's vi.spyOn for console.info capture
import { vi, describe, it, expect } from "vitest";
import { emitStageLog, emitStageError, computeCostUsd } from "./logging";

describe("structured logging", () => {
  it("emitStageLog emits valid JSON via console.info", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    emitStageLog({
      traceId: "01HZTEST000000000000000000",
      jobId: "fake_job_id" as any,
      paperId: "fake_paper_id" as any,
      stage: "parse",
      model: "google/gemini-2.5-flash-lite",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: 150,
      status: "success",
    });

    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(spy.mock.calls[0][0]);
    expect(logged.traceId).toBe("01HZTEST000000000000000000");
    expect(logged.stage).toBe("parse");
    expect(logged.status).toBe("success");

    spy.mockRestore();
  });
});
```

### Average Latency Computation

```typescript
// In getExtractionJobMetrics query:
const completedPapers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job_status", (q) =>
    q.eq("jobId", args.jobId).eq("status", "completed")
  )
  .take(MAX_EXTRACTION_PAPERS_PER_JOB);

const latencies = completedPapers
  .filter((p) => p.completedAt != null && p.createdAt != null)
  .map((p) => p.completedAt! - p.createdAt);

const averageLatencyMs =
  latencies.length > 0
    ? Math.round(latencies.reduce((sum, l) => sum + l, 0) / latencies.length)
    : null;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad-hoc `console.log` strings | Structured JSON `console.info` | This phase | Grep-friendly triage, consistent shape across all stages |
| No traceId | ULID traceId per job | This phase | Correlate all logs for a single extraction run |
| No cost tracking | Static cost-per-token map | This phase | Per-job cost visibility without a billing integration |
| No SLO metrics | citationValidityRate persisted per run | This phase | Track quality degradation over time |

**Deprecated/outdated:**
- `ulid` v2.x: Superseded by v3.0.2 with proper ESM support and Node 18+ requirement [VERIFIED: npm registry]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `crypto.getRandomValues()` is available in Convex's V8 default runtime, allowing `ulid()` to work in mutations | Architecture Patterns / Pattern 2 | If unavailable, ULID generation must move to a Node.js action or use `Date.now()` + `Math.random()` fallback |
| A2 | `console.info` is supported in Convex runtime and appears in Convex dashboard logs | Architecture Patterns / Pattern 1 | If only `console.log` is supported, change to `console.log` with a `level: "info"` field in the JSON payload |
| A3 | Reading up to 2000 `extractionResults` rows in a single query (200 papers * 10 questions) stays within Convex transaction read limits | Pitfalls / Pitfall 2 | If exceeded, must paginate or pre-aggregate cost during result save |

## Open Questions (RESOLVED)

1. **Does `ulid()` work in Convex's V8 (edge) runtime?** (RESOLVED -- Plan 01 Task 2 generates ULID in mutation; convex-test validates edge-runtime compatibility. If it fails, fallback to Node.js action per A1.)
   - What we know: `ulid` v3 uses `crypto.getRandomValues()` which is part of the Web Crypto API, generally available in V8 isolates and edge runtimes.
   - What's unclear: Convex's specific V8 runtime may not expose the full Web Crypto API.
   - Recommendation: Write a `convex-test` unit test that calls `ulid()` in the edge-runtime environment. If it fails, generate the ULID in the `"use node"` action layer instead and pass it back to the mutation via `ctx.runMutation`.

2. **Should metrics and SLO be one query or two?** (RESOLVED -- Plan 03 Task 1 implements a single `getExtractionJobMetrics` query returning all 6 fields per Claude's discretion.)
   - What we know: D-12 and D-21 define separate concerns (operational metrics vs quality metrics), but CONTEXT.md discretion says "a single query returning all metrics is cleaner."
   - What's unclear: Whether the UI will consume them together or separately.
   - Recommendation: Single query returning all fields. The data sources overlap (both read from the same job row and results table). One query means one reactive subscription for the UI.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 + convex-test 0.0.46 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run convex/extraction/logging.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBS-01 | emitStageLog emits valid JSON with all required fields | unit | `npx vitest run convex/extraction/logging.test.ts -t "emitStageLog"` | Wave 0 |
| OBS-01 | computeCostUsd returns correct values for all three models | unit | `npx vitest run convex/extraction/logging.test.ts -t "computeCostUsd"` | Wave 0 |
| OBS-02 | traceId generated in createExtractionJob is a valid ULID | unit | `npx vitest run convex/extraction/mutations.test.ts -t "traceId"` | Wave 0 |
| OBS-02 | traceId propagated through workpool enqueue args | unit | `npx vitest run convex/extraction/mutations.test.ts -t "traceId"` | Wave 0 |
| OBS-03 | emitStageError emits JSON with errorMessage, errorCategory, retryable | unit | `npx vitest run convex/extraction/logging.test.ts -t "emitStageError"` | Wave 0 |
| OBS-04 | getExtractionJobMetrics returns typed metrics for authorized user | unit | `npx vitest run convex/extraction/queries.test.ts -t "metrics"` | Wave 0 |
| OBS-04 | getExtractionJobMetrics returns null for unauthorized user | unit | `npx vitest run convex/extraction/queries.test.ts -t "metrics"` | Wave 0 |
| OBS-05 | finalizeJobIfDone computes and persists citationValidityRate | unit | `npx vitest run convex/extraction/mutations.test.ts -t "citationValidityRate"` | Wave 0 |
| OBS-05 | getJobSLOMetrics returns SLO fields from job row | unit | `npx vitest run convex/extraction/queries.test.ts -t "SLO"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/extraction/logging.test.ts convex/extraction/mutations.test.ts convex/extraction/queries.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `convex/extraction/logging.test.ts` -- covers OBS-01, OBS-03 (emitStageLog, emitStageError, computeCostUsd)
- [ ] New test cases in `convex/extraction/mutations.test.ts` -- covers OBS-02 (traceId generation), OBS-05 (SLO persistence)
- [ ] New test file or cases in `convex/extraction/queries.test.ts` -- covers OBS-04 (metrics query), OBS-05 (SLO query)
- [ ] Framework install: none needed -- vitest, convex-test, @edge-runtime/vm already installed

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- |
| V3 Session Management | no | -- |
| V4 Access Control | yes | `getCurrentUser(ctx)` + `job.userId !== user._id` ownership check on new queries (D-17) |
| V5 Input Validation | yes | Convex validators (`v.id()`, `v.string()`, `v.number()`) on all query args |
| V6 Cryptography | no | -- |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized metrics access | Information Disclosure | Auth + ownership check pattern from `getExtractionProgress` (D-17) |
| Log injection via paperId/jobId | Tampering | Convex IDs are system-generated (not user input); `JSON.stringify` handles escaping |
| Cost map manipulation | Tampering | Cost map is a compile-time const in `logging.ts`, not runtime-configurable |

## Sources

### Primary (HIGH confidence)
- `convex/extraction/workpoolActions.ts` -- all 11 ad-hoc log calls identified for replacement [VERIFIED: codebase grep]
- `convex/extraction/errors.ts` -- `ErrorCategory` type and `classifyExtractionError()` API [VERIFIED: codebase]
- `convex/extraction/queries.ts` -- `getExtractionProgress` auth pattern [VERIFIED: codebase]
- `convex/extraction/mutations.ts` -- `createExtractionJob`, `finalizeJobIfDone`, `handleExtractionComplete` entry points [VERIFIED: codebase]
- `convex/schema.ts` lines 410-498 -- `extractionJobs`, `extractionPapers`, `extractionResults` table definitions [VERIFIED: codebase]
- `ulid` npm package v3.0.2 -- API: `import { ulid } from "ulid"`, zero deps [VERIFIED: npm registry + GitHub README]
- OpenRouter pricing for Gemini 2.5 Flash Lite ($0.10/$0.40 per M tokens) [VERIFIED: openrouter.ai/google/gemini-2.5-flash-lite]
- OpenRouter pricing for Gemini 3 Flash Preview ($0.50/$3.00 per M tokens) [VERIFIED: openrouter.ai/google/gemini-3-flash-preview]
- OpenRouter pricing for Claude Haiku 4.5 ($1.00/$5.00 per M tokens) [VERIFIED: openrouter.ai/anthropic/claude-haiku-4.5]

### Secondary (MEDIUM confidence)
- Convex V8 runtime Web Crypto API availability [CITED: Convex docs on action vs mutation runtimes, inferred from web standard compliance]

### Tertiary (LOW confidence)
- `console.info` support in Convex runtime [ASSUMED: based on Web API compliance, needs test verification]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- single new dependency (`ulid`), version verified, API confirmed
- Architecture: HIGH -- all integration points identified from codebase, patterns derived from existing code
- Pitfalls: HIGH -- derived from Convex-specific constraints documented in guidelines and observed in existing tests
- Cost map: HIGH -- pricing verified against live OpenRouter pages (2026-04-15)

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days -- OpenRouter pricing may change; verify cost map before deployment)
