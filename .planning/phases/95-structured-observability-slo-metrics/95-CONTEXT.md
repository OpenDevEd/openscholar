# Phase 95: Structured Observability & SLO Metrics - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Give future-us grep-friendly incident triage without a paid observability vendor. Every extraction stage emits one structured `console.info` JSON line with a ULID `traceId`, failures log via `console.error` with the same JSON shape plus `{errorMessage, errorCategory, retryable}`, the UI shows per-job metrics (papers processed, average latency, estimated cost, errors), and two SLO metrics (recall-on-include, citation-validity-rate) are persisted per run on the job row.

</domain>

<decisions>
## Implementation Decisions

### TraceId Generation & Propagation (OBS-01, OBS-02)
- **D-01:** Generate a ULID `traceId` in the `createExtractionJob` mutation and persist it on the `extractionJobs` row. Add `traceId: v.optional(v.string())` to the schema. ULID is chosen over UUIDv7 because it's monotonically sortable and grep-friendly (timestamp-prefixed).
- **D-02:** Install the `ulid` npm package for ULID generation. Lightweight, no dependencies, well-maintained.
- **D-03:** Propagate `traceId` through the workpool enqueue args — the `processExtractionPaper` action receives `traceId` alongside `jobId` and `paperId`. No separate context object; it's a flat arg.
- **D-04:** Propagate `traceId` into `extractAnswers()` as a new parameter so every LLM call's structured log includes the trace. The `ExtractionResult` type does NOT grow — `traceId` is for logging, not persistence.
- **D-05:** The durable workflow step that enqueues papers reads `traceId` from the job row and passes it to each workpool enqueue call.

### Structured Log Format (OBS-01, OBS-03)
- **D-06:** Create a `convex/extraction/logging.ts` module exporting `emitStageLog(params)` and `emitStageError(params)` helpers. These format the structured JSON and call `console.info` / `console.error` respectively.
- **D-07:** The structured info log shape is: `{traceId, jobId, paperId, stage, model, tokensIn, tokensOut, costUsd, latencyMs, status}`. Stage values: `"parse"`, `"extract"`, `"critic"`, `"save"`.
- **D-08:** The structured error log shape extends info with: `{errorMessage, errorCategory, retryable}`. Error category reuses the `ErrorCategory` type from `convex/extraction/errors.ts`.
- **D-09:** `costUsd` is derived from a static cost-per-token map for each OpenRouter model (Gemini 2.5 Flash Lite, Gemini 3 Flash, Claude Haiku 4.5). Approximate but sufficient for MVP cost tracking. The map lives in `logging.ts` as a const object.
- **D-10:** Replace all existing ad-hoc `console.log` and `console.error` calls in `convex/extraction/workpoolActions.ts` with structured `emitStageLog` / `emitStageError` calls. No more freeform log strings in the extraction pipeline.
- **D-11:** `latencyMs` is measured via `performance.now()` (or `Date.now()` delta) around each stage in `workpoolActions.ts`. Each stage (parse, extract per question, critic, save) gets its own timing.

### Per-Job UI Metrics Query (OBS-04)
- **D-12:** Create a new `getExtractionJobMetrics` query in `convex/extraction/queries.ts` that computes aggregated metrics from `extractionResults` and `extractionPapers` rows for a given job.
- **D-13:** The query returns: `{papersProcessed: number, averageLatencyMs: number | null, estimatedCostUsd: number, errorCount: number}`. All fields are typed — no `v.any()`.
- **D-14:** `averageLatencyMs` is computed from paper-level duration: `(completedAt - createdAt)` across completed `extractionPapers`. This requires no new schema fields — `completedAt` and `createdAt` already exist on `extractionPapers`.
- **D-15:** `estimatedCostUsd` is computed from `tokensIn`/`tokensOut` on `extractionResults` rows using the same static cost map from `logging.ts`. Sum across all results for the job.
- **D-16:** `errorCount` is the count of `extractionPapers` with `status === "failed"` for the job — already queryable via the `by_job_status` index.
- **D-17:** Auth and user-isolation follow the existing `getExtractionProgress` pattern: verify user identity, verify job ownership. Return `null` for unauthorized access.

### SLO Metric Persistence (OBS-05)
- **D-18:** Add `citationValidityRate: v.optional(v.number())` and `recallOnInclude: v.optional(v.number())` to the `extractionJobs` schema. Both are 0-1 floats computed at job completion.
- **D-19:** `citationValidityRate` is computed in the job finalization handler (`finalizeJobIfDone` or `handleExtractionComplete`) as: count of results with `criticVerdict === "supported"` / total results with a non-null `criticVerdict`. Data already exists from Phase 92.
- **D-20:** `recallOnInclude` is stored as `null` for now — it requires the golden set from Phase 96. The schema field is forward-compatible; Phase 96 will populate it when the eval loop runs.
- **D-21:** Create a `getJobSLOMetrics` query (or extend `getExtractionJobMetrics`) that returns `{citationValidityRate: number | null, recallOnInclude: number | null}` for a given job.

### Claude's Discretion
- Whether `emitStageLog` accepts a typed params object or uses overloaded signatures for info vs error.
- Exact cost-per-token values in the static map — use current OpenRouter pricing at implementation time.
- Whether `getExtractionJobMetrics` and `getJobSLOMetrics` are one query or two — a single query returning all metrics is cleaner.
- Test fixture design for structured log assertions (capture `console.info` output and parse JSON).
- Whether `latencyMs` for the "extract" stage is per-question or aggregate per-paper — per-paper total is simpler and more useful for the UI metric.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Tables
- `convex/schema.ts` lines 410-498 — `extractionJobs`, `extractionPapers`, `extractionResults` tables. Jobs need `traceId`, `citationValidityRate`, `recallOnInclude` fields added. Papers already have `createdAt`/`completedAt` for latency computation.
- `convex/extraction/validators.ts` — Extraction validators. May need new validator entries for SLO fields.

### Extraction Pipeline (current code)
- `convex/extraction/workpoolActions.ts` lines 100-260 — `processExtractionPaper` action with ad-hoc console.log/error calls that need structured log replacement.
- `convex/extraction/mutations.ts` line 30 — `createExtractionJob` mutation where `traceId` ULID must be generated.
- `convex/extraction/mutations.ts` lines 370-460 — `saveResult` and `handleExtractionComplete` / `finalizeJobIfDone` where SLO metrics are computed at completion.
- `convex/extraction/extract.ts` — `extractAnswers()` function that needs `traceId` parameter for structured logging within cascade calls.
- `convex/extraction/queries.ts` — Existing queries. New `getExtractionJobMetrics` query goes here.

### Error Classification (Phase 93)
- `convex/extraction/errors.ts` — `ErrorCategory` type and `classifyExtractionError()`. The `errorCategory` field in structured error logs reuses this type.

### Existing Logging Calls to Replace
- `convex/extraction/workpoolActions.ts:102-104` — `console.log` for parse success.
- `convex/extraction/workpoolActions.ts:106-108` — `console.log` for parse skip.
- `convex/extraction/workpoolActions.ts:122-125` — `console.error` for no bodyText.
- `convex/extraction/workpoolActions.ts:219-222` — `console.error` for all questions failed.
- `convex/extraction/workpoolActions.ts:226-228` — `console.log` for extraction success.
- `convex/extraction/workpoolActions.ts:234-239` — `console.error` for classified error.
- `convex/extraction/mutations.ts:136` — `console.error` for workflow start failure.

### Requirements
- `.planning/REQUIREMENTS.md` — OBS-01 through OBS-05 define exact scope.
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/extraction/errors.ts:ErrorCategory` — Error classification type reusable for structured error log's `errorCategory` field.
- `convex/extraction/errors.ts:classifyExtractionError()` — Already classifies errors with `{retryable, category, message}` — the exact shape needed for OBS-03 error logs.
- `convex/extraction/queries.ts:getExtractionProgress` — Auth + user-isolation pattern to follow for new metrics query.
- `convex/extraction/extract.ts:ExtractionResult` — Already carries `tokensIn`, `tokensOut`, `modelUsed` per question — raw data for cost computation.
- `convex/schema.ts:extractionPapers` — Already has `createdAt` and `completedAt` for latency computation. Already has `status` with `by_job_status` index for error counting.
- `convex/schema.ts:extractionResults` — Already has `criticVerdict` for citation-validity-rate computation, `tokensIn`/`tokensOut` for cost computation.

### Established Patterns
- Auth + ownership guard: `getCurrentUser(ctx)` → `job.userId !== user._id` → return null. Used in all public queries.
- Typed returns: `returns: v.object(...)` with explicit validators — no `v.any()`.
- Module-per-concern: `parse.ts`, `extract.ts`, `errors.ts` — new `logging.ts` follows this pattern.
- Denormalized counters on job row: `processedPapers`, `failedPapers`, `cancelledPapers` — SLO metrics follow same pattern.

### Integration Points
- `convex/schema.ts` — Add `traceId`, `citationValidityRate`, `recallOnInclude` to `extractionJobs`.
- `convex/extraction/mutations.ts:createExtractionJob` — Generate ULID traceId.
- `convex/extraction/workpoolActions.ts` — Replace ad-hoc logs with structured logging, add timing instrumentation.
- `convex/extraction/extract.ts` — Accept `traceId` parameter, emit structured logs from cascade.
- `convex/extraction/queries.ts` — New `getExtractionJobMetrics` query.
- `convex/extraction/workflow.ts` — Read traceId from job, pass to workpool enqueue.
- New file: `convex/extraction/logging.ts` — Structured log helpers + cost map.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the REQUIREMENTS.md OBS-01 through OBS-05 are precise. The structured JSON log shape, ULID traceId propagation path, error log extension, per-job metrics query, and SLO metric fields are all locked in requirements. The existing codebase already carries all the raw data needed (tokensIn/tokensOut on results, criticVerdict for citation validity, createdAt/completedAt for latency, error classification in errors.ts).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 95-structured-observability-slo-metrics*
*Context gathered: 2026-04-15*
