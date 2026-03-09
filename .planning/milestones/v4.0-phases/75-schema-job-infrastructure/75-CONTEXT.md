# Phase 75: Schema & Job Infrastructure - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the database schema (screeningJobs, screeningResults tables) and core mutations for bulk screening jobs: job creation with credit verification, job cancellation with workpool stop, and a reactive progress query. This is backend infrastructure — no UI in this phase.

</domain>

<decisions>
## Implementation Decisions

### Credit Cost Model
- 1 credit per paper for bulk screening — same cost as single-paper screening
- Credit verification at job creation: check user has >= paperCount credits before starting
- Per-batch credit deduction during processing (not upfront lump sum) with credit-guard pattern matching extraction

### Concurrent Job Policy
- One active bulk screening job at a time per user
- Job creation mutation rejects if user has a job in pending/processing status
- Matches extraction pattern and avoids credit TOCTOU complexity across concurrent jobs

### Duplicate Paper Handling
- Each bulk screening job is independent — papers are re-screened even if previously screened in another job
- Users may change scoring rules between jobs, making re-screening appropriate
- No cross-job deduplication in schema (simpler, no unique constraints across jobs)

### Cancelled Job Behavior
- Partial results preserved in screeningResults (per success criteria)
- Already-qualifying papers that were saved to library before cancellation remain in library
- Credit-guard prevents billing for papers processed after cancellation signal

### Screening Questions Capture
- Snapshot screening questions into the screeningJobs record at creation time
- Questions come from the existing screening panel (DIALOG-02) and are frozen for the job's lifetime
- Scoring config (point values per question per answer) embedded in job record alongside questions

### Claude's Discretion
- Exact schema field names and types for screeningJobs and screeningResults tables
- Index design for optimal query patterns
- Status enum values and transitions
- Progress query implementation (polling vs reactive subscription)
- Error code naming for credit/validation failures
- Internal mutation structure for status updates

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Extraction workflow pattern** (`convex/extraction/workflow.ts`): Durable workflow + workpool orchestration — direct model for bulk screening workflow in Phase 77
- **Credit guard pattern** (`convex/extraction/workpoolActions.ts:862-882`): Re-query job status before deducting credits — reuse for screening credit guards
- **createError() factory** (`convex/lib/errors.ts`): Typed error codes with ConvexError — use for CREDITS_INSUFFICIENT, JOB_ALREADY_ACTIVE errors
- **requireAuth()** (`convex/lib/auth.ts`): Auth helper — use in all screening mutations
- **queryBounds.ts** (`convex/lib/queryBounds.ts`): MAX constants pattern — add MAX_SCREENING_PAPERS_PER_JOB = 200
- **Library upsert** (`convex/library/mutations.ts:39-93`): saveToLibrary with upsert pattern — reuse in Phase 77 for auto-save
- **Denormalized counter** (`users.libraryItemCount`): Atomic increment on library save — must maintain when bulk-saving

### Established Patterns
- **Domain module organization**: `convex/screening/queries.ts`, `convex/screening/mutations.ts`, `convex/screening/actions.ts`
- **Status union validators**: `v.union(v.literal("pending"), v.literal("processing"), ...)` for job status
- **Composite indexes**: `by_user`, `by_user_status` for filtered queries
- **Job creation → workflow start → workpool enqueue** pipeline
- **cancelAll() + credit-guard** for cancellation (workpool cancels all, credit guard prevents billing)
- **TDD standard**: All new features built test-first per project constraint

### Integration Points
- **Schema** (`convex/schema.ts`): Add screeningJobs and screeningResults table definitions
- **Workpool** (`convex/workpool.ts`): Will need a screening-specific workpool or reuse pdfProcessingPool (Phase 77 decision)
- **Credits** (`convex/credits/internal.ts`): deductCredits mutation for per-batch billing
- **Library** (`convex/library/mutations.ts`): saveToLibrary for auto-save in Phase 77
- **Collections** (`convex/library/mutations.ts`): addToCollection for auto-assign in Phase 77

</code_context>

<specifics>
## Specific Ideas

- Counter contention risk when bulk-saving 200 papers — may need serialized or batched counter updates (noted in STATE.md blockers)
- Credit TOCTOU: credits can exhaust mid-job — per-batch deduction with creditsExhausted status (noted in STATE.md blockers)
- Screening data source: existing client-side AI screening runs in browser (lib/ai/client/); bulk screening must run server-side via Convex actions since it processes in background

</specifics>

<deferred>
## Deferred Ideas

- Plan-tier limits on bulk screening cap (free=50, go=100, pro=200) — captured as JOB-09 in Future Requirements
- Bulk screening job results page with detailed per-paper breakdown — captured as JOB-10 in Future Requirements
- Saved scoring rule presets reusable across searches — captured as SCORE-06 in Future Requirements

</deferred>

---

*Phase: 75-schema-job-infrastructure*
*Context gathered: 2026-03-09*
