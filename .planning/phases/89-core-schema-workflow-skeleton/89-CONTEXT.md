# Phase 89: Core Schema & Workflow Skeleton - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Define the new slim extraction schema (job, paper, question, result tables with `by_paper_question` unique index), register a single `extractionPool` workpool, and stand up a durable `@convex-dev/workflow` whose stages enqueue all papers in one batched mutation and save results idempotently — the rails that all downstream extraction phases (90-97) run on. No parsing logic, no LLM calls, no UI — pure schema + orchestration skeleton.

</domain>

<decisions>
## Implementation Decisions

### Schema Table Design
- **D-01:** Four new tables: `extractionJobs`, `extractionPapers`, `extractionQuestions`, `extractionResults`. Minimal MVP fields only — downstream phases add fields as needed (parsing_source in Phase 90, confidence/evidence in Phase 91, etc.).
- **D-02:** `extractionJobs` includes denormalized progress counters (`totalPapers`, `processedPapers`, `failedPapers`) matching the proven `screeningJobs` pattern for reactive progress subscriptions.
- **D-03:** `extractionPapers` stores `workpoolId` per paper row (WORK-03 requirement) for targeted cancel in Phase 93.
- **D-04:** `extractionResults` has a `by_paper_question` composite index for idempotent save (WORK-07). Also `by_job` for job-level queries and `by_paper` for paper-level queries.
- **D-05:** `extractionQuestions` stores the user-defined questions per job — same shape as screening questions but with extraction-specific fields (e.g., expected answer type).
- **D-06:** Job status enum follows screening pattern: `pending`, `processing`, `completed`, `cancelled`, `failed`.
- **D-07:** Paper status enum: `pending`, `parsing`, `extracting`, `completed`, `failed`, `cancelled`. Parsing and extracting states are distinct for Phase 90/91 progress visibility.

### Workflow Stage Granularity
- **D-08:** Workflow follows the proven screening pattern: 3 journaled steps — (1) load job + validate, (2) batched enqueue of all papers to workpool, (3) finalization. NOT per-paper journaled steps.
- **D-09:** Each workpool item runs the full per-paper pipeline autonomously (parse → extract → critic → persist). The workflow doesn't micromanage per-paper stages — the workpool item's action handler does.
- **D-10:** The workpool `onComplete` handler handles per-paper result aggregation and job finalization when all papers are done.

### Workpool Registration
- **D-11:** Register `extractionPool` as a separate named component `extractionWorkpool` in `convex.config.ts` — alongside the existing `screeningWorkpool`. These are isolated pools.
- **D-12:** `maxParallelism: 5` — upper bound of the WORK-02 range (3-5), matches the existing `screeningPool` configuration.
- **D-13:** Retry config: `maxAttempts: 3`, `initialBackoffMs: 2000`, `base: 2` — same as screening. Phase 93 will add error classification (retryable vs permanent).

### Batched Enqueue Pattern
- **D-14:** `enqueueAllPapers` is a single mutation that creates all paper rows in the `extractionPapers` table AND enqueues each to the `extractionPool` workpool in one transaction — matches WORK-06 requirement for exactly one batched mutation.
- **D-15:** Idempotent result save: the persist step queries the `by_paper_question` index first; if a row exists, it skips the insert. This prevents `onComplete` double-fire corruption (WORK-07).

### Claude's Discretion
- Exact field names and validator shapes for the four tables — follow Convex conventions and screening table patterns as reference.
- Whether `extractionQuestions` are stored as a nested array on the job (like screening) or as separate rows — optimize for the extraction query patterns in Phase 91.
- Internal vs public function split for the new extraction module.
- Test file organization (colocated in `convex/extraction/` or under `tests/extraction/`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Existing Patterns
- `convex/schema.ts` — Current schema after Phase 88 teardown. New extraction tables go here.
- `convex/screening/workflow.ts` — Proven screening workflow pattern to mirror for extraction workflow.
- `convex/screening/mutations.ts` — `enqueueScreeningPaper` mutation pattern for workpool enqueue.
- `convex/screening/workpoolActions.ts` — Workpool action handler pattern.
- `convex/screening/validators.ts` — Validator patterns for screening tables.

### Component Configuration
- `convex/convex.config.ts` — Component registrations. New `extractionWorkpool` goes here.
- `convex/workflow.ts` — WorkflowManager singleton used by both screening and extraction workflows.
- `convex/workpool.ts` — Workpool instances. New `extractionPool` goes here.

### Requirements
- `.planning/REQUIREMENTS.md` — WORK-01, WORK-02, WORK-06, WORK-07 define exact scope for this phase.

### Conventions
- `.planning/codebase/CONVENTIONS.md` — Naming, code style, Convex patterns to follow.
- `.planning/codebase/STACK.md` — Dependency versions and runtime constraints.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/workflow.ts` — WorkflowManager singleton with retry config. Extraction workflow uses this same instance.
- `convex/workpool.ts` — Workpool instantiation pattern. New `extractionPool` mirrors `screeningPool`.
- `convex/screening/workflow.ts` — 74-line workflow: load job → load pending → update status → enqueue loop. Extraction workflow follows this shape.
- `convex/screening/mutations.ts` — `enqueueScreeningPaper` mutation pattern for workpool item creation.
- `convex/lib/errors.ts` — `createError(code, message)` factory with discriminated ErrorCode union.
- `convex/lib/validators.ts` — Centralized validator definitions.

### Established Patterns
- Workflow + Workpool: `@convex-dev/workflow` defines the durable workflow, `@convex-dev/workpool` handles bounded parallelism. Screening uses this exact combination.
- Component registration: Named components in `convex.config.ts` (e.g., `{ name: "screeningWorkpool" }`).
- Schema conventions: `defineTable` with typed validators, composite indexes, status enums via `v.union(v.literal(...))`.
- Progress counters: Denormalized on job row (screeningJobs.processedPapers, failedPapers, qualifiedPapers).

### Integration Points
- `convex/schema.ts` — New tables added here.
- `convex/convex.config.ts` — New component registered here.
- `convex/_generated/api` — Auto-generated after schema change. All internal refs flow through this.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the REQUIREMENTS.md WORK-01, WORK-02, WORK-06, WORK-07 are precise. Follow the screening workflow pattern as the primary reference implementation.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 89-core-schema-workflow-skeleton*
*Context gathered: 2026-04-15*
