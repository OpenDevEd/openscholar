# Phase 93: Workflow Cancel, Retry, and Progress - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Make a running extraction job fully controllable: implement a `cancelExtractionJob` mutation that iterates persisted `workpoolId` values for targeted per-paper cancel (no `cancelAll` blast radius), classify errors as retryable vs permanent so workpool retry fires only on transient failures, verify the existing early-return guards on cancelled/failed jobs, and confirm the reactive progress subscription meets WORK-09 requirements. This phase modifies `convex/extraction/` to add cancel logic and error classification — no UI changes (those belong in Phase 97).

</domain>

<decisions>
## Implementation Decisions

### Cancel Mutation Design (WORK-03, WORK-04)
- **D-01:** Create a `cancelExtractionJob` mutation in `convex/extraction/mutations.ts` modeled after `convex/screening/mutations.ts:cancelScreeningJob` (lines 169-214) but using **targeted per-paper cancel** instead of `cancelAll`. The mutation iterates `extractionPapers` rows for the job, calls `extractionPool.cancel(ctx, workpoolId)` on each non-terminal paper, and marks them as `cancelled`.
- **D-02:** The cancel mutation also cancels the parent workflow via `workflow.cancel(ctx, workflowId)` — both workflow-level and per-paper workpool-level cancellation happen in the same mutation. Workflow cancel stops future step execution; per-paper cancel stops in-flight work.
- **D-03:** Auth and ownership checks follow the screening pattern: verify user identity, verify the user owns the job. Terminal-status jobs (already `completed`/`cancelled`/`failed`) are idempotent no-ops.
- **D-04:** The `workflowId` must be stored on the `extractionJobs` row so the cancel mutation can reference it. Check if this field exists in the schema; if not, add `workflowId: v.optional(v.string())` and persist it when the workflow starts.
- **D-05:** After cancelling all papers, the mutation sets the job status to `cancelled` and updates progress counters (remaining papers counted as cancelled, not failed).

### Error Classification (WORK-05)
- **D-06:** Create an `classifyExtractionError` helper function. Retryable errors (throw to trigger workpool retry): network errors, HTTP 5xx, HTTP 429 (rate limit), `AbortSignal` timeouts, transient OpenRouter errors. Permanent errors (return `{success: false}`, no retry): HTTP 404, HTTP 400, Zod validation failure (after cascade exhaustion), empty body text, page-count exceeded.
- **D-07:** The classification logic lives in a new `convex/extraction/errors.ts` module — shared between `workpoolActions.ts` and any future extraction error handling. It returns `{retryable: boolean, category: "network" | "rate_limit" | "timeout" | "validation" | "not_found" | "bad_request" | "parse_failure", message: string}`.
- **D-08:** In `workpoolActions.ts:processExtractionPaper`, wrap the pipeline in a try/catch that calls `classifyExtractionError`. If retryable → rethrow (workpool retries). If permanent → return the error result with `{success: false}` and save the paper as `failed` with error details.
- **D-09:** When a paper exhausts retry attempts (workpool `maxAttempts: 3`), the workpool's failure handler marks it as permanently failed. The error category and message are persisted on the paper row for debugging.

### Early-Return on Cancelled/Failed Jobs (WORK-08)
- **D-10:** Early-return guards already exist in `workflow.ts:39-49`, `workpoolActions.ts:58-64`, and `handleExtractionComplete` at `mutations.ts:410-416`. Phase 93 verifies these guards are comprehensive and adds tests asserting zero LLM tokens consumed for cancelled jobs.
- **D-11:** If any gap is found in early-return coverage (e.g., a code path that could still call the LLM after status flips to cancelled), fix it. The test must mock the LLM call and assert it was never invoked.

### Reactive Progress (WORK-09)
- **D-12:** The existing `getExtractionProgress` query (`queries.ts:20-61`) already returns `{status, totalPapers, processedPapers, failedPapers, percentComplete}` with the cap-at-99% pattern. This satisfies WORK-09's requirement for reactive `{processed, failed, remaining}` counters. No new query needed.
- **D-13:** Add a `cancelledPapers` counter to the job row and progress query so the UI can distinguish between failed and cancelled papers after a cancel operation. This counter is incremented by the cancel mutation, not by individual paper failure handlers.

### Claude's Discretion
- Exact error classification boundaries for edge cases (e.g., OpenRouter returning non-standard status codes).
- Whether `classifyExtractionError` should handle critic-pass errors differently from extraction errors.
- Test fixture design: whether to use real HTTP error responses or synthetic error objects.
- Whether the `cancelledPapers` counter is a new schema field or derived from counting papers with status `cancelled`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Tables
- `convex/schema.ts` §445-497 — `extractionJobs` and `extractionPapers` tables. Check for `workflowId` field on jobs and `workpoolId` on papers.
- `convex/extraction/validators.ts` — Extraction validators. May need `cancelledPapers` counter validator.

### Extraction Module (Phases 89-92 output)
- `convex/extraction/mutations.ts` — `enqueueAllPapers` (stores `workpoolId`), `handleExtractionComplete` (finalization), `saveResult`. Cancel mutation goes here.
- `convex/extraction/workpoolActions.ts` — `processExtractionPaper` action with existing terminal-status guard. Error classification wraps this pipeline.
- `convex/extraction/workflow.ts` — Durable workflow with existing early-return guard. Must store `workflowId` on job row.
- `convex/extraction/queries.ts` — `getExtractionProgress` reactive query. May need `cancelledPapers` addition.

### Screening Reference (Cancel Pattern)
- `convex/screening/mutations.ts` lines 169-214 — `cancelScreeningJob` is the reference cancel implementation. Auth check, ownership check, idempotent terminal-status guard, workflow cancel, workpool cancel.
- `convex/screening/cancel.test.ts` — 8 cancel tests covering auth, ownership, idempotency, result preservation. Template for extraction cancel tests.

### Workpool & Workflow Infrastructure
- `convex/workpool.ts` — Workpool instances with `retryActionsByDefault: true`, 3 max attempts, 2s backoff.
- `convex/workflow.ts` — WorkflowManager singleton. `workflow.cancel(ctx, workflowId)` API.

### Error Handling Patterns
- `convex/lib/errors.ts` — `createError(code, message)` factory with discriminated `ErrorCode` union. New extraction error codes may be needed.

### Requirements
- `.planning/REQUIREMENTS.md` — WORK-03, WORK-04, WORK-05, WORK-08, WORK-09 define exact scope.
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/screening/mutations.ts:cancelScreeningJob` — Reference cancel mutation pattern (auth, ownership, idempotency, workflow cancel, workpool cancel).
- `convex/screening/cancel.test.ts` — 8-test cancel suite. Template for extraction cancel tests.
- `convex/extraction/mutations.ts:enqueueAllPapers` — Already stores `workpoolId` per paper row (D-03 from Phase 89).
- `convex/extraction/queries.ts:getExtractionProgress` — Reactive progress query with cap-at-99% pattern. Already satisfies WORK-09.
- `convex/lib/errors.ts:createError` — Error factory for Convex errors. Reusable for cancel-related errors.

### Established Patterns
- Cancel mutation: auth check → ownership check → terminal-status guard → set job status → cancel workflow → cancel workpool items → mark papers.
- Workpool retry: `retryActionsByDefault: true` with exponential backoff. All errors currently retry uniformly — Phase 93 adds classification.
- Early-return: terminal-status check at the start of workflow steps, workpool actions, and completion handlers.
- Progress counters: denormalized on job row, incremented atomically by completion/failure handlers.

### Integration Points
- `convex/extraction/mutations.ts` — New `cancelExtractionJob` mutation.
- `convex/extraction/errors.ts` — New error classification module.
- `convex/extraction/workpoolActions.ts` — Error classification wraps the existing pipeline.
- `convex/schema.ts` — Possible `workflowId` field on `extractionJobs`, `cancelledPapers` counter.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the REQUIREMENTS.md WORK-03, WORK-04, WORK-05, WORK-08, WORK-09 are precise. The targeted cancel pattern (per-paper workpoolId vs cancelAll), error classification (retryable vs permanent), early-return guards, and reactive progress are all locked in requirements. Screening cancel implementation is the direct reference pattern.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 93-workflow-cancel-retry-and-progress*
*Context gathered: 2026-04-15*
