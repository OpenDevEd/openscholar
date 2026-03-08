# Project Research Summary

**Project:** OpenAlex Count -- v4.0 Bulk Screening & Auto-Rating
**Domain:** Background job orchestration with scoring engine for academic search platform
**Researched:** 2026-03-08
**Confidence:** HIGH

## Executive Summary

v4.0 adds bulk background screening (up to 200 papers), user-defined scoring rules, automatic star ratings, and auto-save to library/collections. The research conclusively shows this is an **integration milestone, not an infrastructure milestone**. Every required building block already exists in the codebase: durable workflow orchestration (`@convex-dev/workflow`), parallel batch processing (`@convex-dev/workpool`), a production-proven batch screening action (`generateBatchScreeningResponses`), reactive progress queries, and library/collection mutations with denormalized counters. Zero new dependencies are needed.

The recommended approach directly reuses the extraction workflow pattern: a Convex workflow orchestrates the job, enqueues batches of ~10 papers into a workpool, each batch calls the existing AI screening pipeline, and an `onComplete` mutation computes scores, maps to ratings, and saves to the library. The scoring engine is pure arithmetic (sum of per-question points mapped to star thresholds) requiring no external library. The architecture adds two new Convex tables (`screeningJobs` for job state/config, `screeningResults` for per-paper outcomes) and a set of internal mutation variants for background auth-free writes.

The primary risks are: (1) denormalized counter contention when bulk-saving 200 papers to the same user's library -- mitigated by serializing library writes or batching counter updates; (2) the TOCTOU credit gap where credits can run out mid-job -- mitigated by pre-checking at job creation and adding graceful exhaustion handling; (3) data isolation between the existing client-side per-page screening (Zustand) and the new server-side bulk results -- mitigated by establishing clear precedence (manual overrides bulk) and using Convex reactive queries as the source of truth.

## Key Findings

### Recommended Stack

No new packages. The entire feature is built on existing dependencies. This is a strong signal of architectural maturity -- the platform was designed for exactly this kind of extension.

**Core technologies (all existing):**
- `@convex-dev/workflow` (^0.3.4): Durable multi-step job orchestration -- same pattern as extraction
- `@convex-dev/workpool` (^0.3.1): Parallel batch processing with retry and cancellation
- `ai` (^6.0.62): LLM calls via existing `processScreeningBatch` -- no new prompts or schemas needed
- Convex reactive queries: Real-time progress tracking with zero additional setup
- Pure TypeScript: Scoring engine and rating computation -- no library needed

### Expected Features

**Must have (table stakes):**
- Bulk screening job creation from "Screen All" button (processes all results, not just current page)
- Background processing with real-time progress bar (N/200 papers)
- Paper count and credit cost estimate before starting
- Cancel in-progress job with credit-guard protection
- Per-paper error handling (failures do not block the batch)
- Server-side persistence of screening results (not client-side Zustand)

**Should have (differentiators):**
- User-defined scoring rules (point values per screening question answer -- core differentiator vs. Rayyan/Covidence binary include/exclude)
- Score-to-rating threshold mapping (cumulative score mapped to 0-5 stars)
- Auto-save to library with computed rating (upsert)
- Auto-assign to user-selected collection
- Configuration dialog with scoring preview and cost estimate
- Minimum score threshold to filter library saves

**Defer (v4.1+):**
- Scoring rule presets/templates (save and reuse configs)
- Bulk screening from library page
- Export bulk screening results to CSV
- Active learning / priority ordering (only relevant at 10,000+ papers, not 200)

### Architecture Approach

The architecture follows the existing extraction system almost exactly: a `screeningJobs` table tracks job state and embeds scoring configuration, a `screeningResults` table stores per-paper outcomes, and the workflow+workpool pattern handles orchestration. The scoring engine is a pure function computed inside the workpool's `onComplete` mutation. Internal mutation variants (`internalSaveToLibrary`, `internalAddToCollection`) handle library writes without auth context. Credit deduction happens per-batch, not upfront.

**Major components:**
1. `screeningJobs` table -- Job state, scoring config, rating thresholds, progress counters
2. `screeningResults` table -- Per-paper screening responses, computed score/rating, library link
3. `runBulkScreeningWorkflow` -- Workflow orchestrator (fetch papers, batch, enqueue to workpool)
4. `screenBatchAction` -- Workpool action calling existing AI screening pipeline with credit-guard
5. `handleScreeningBatchComplete` -- onComplete mutation: compute score, compute rating, save to library, assign to collection, update progress
6. Scoring engine (`computeScore` + `computeRating`) -- Pure functions, independently testable
7. Configuration dialog -- Scoring rules editor, rating thresholds, collection picker, cost estimate

### Critical Pitfalls

1. **Denormalized counter contention** -- Bulk-saving 200 papers to one user's library creates OCC retry storms on `user.libraryItemCount` and `collection.itemCount`. Serialize library writes via workpool (maxParallelism: 1 for save step) or batch counter increments into a single mutation.

2. **Action 10-minute timeout** -- Processing 200 papers in a single action will timeout. Use per-paper (or per-batch-of-10) workpool actions from the start. This is non-negotiable.

3. **Credit TOCTOU** -- Credits can be exhausted mid-job. Pre-check at creation, deduct per-batch, and add a `creditsExhausted` job status for clear UX when credits run out.

4. **Client-server data isolation** -- Per-page screening (Zustand) and bulk screening (Convex) create two sources of truth. Establish manual-overrides-bulk precedence. Skip already-screened papers in bulk runs.

5. **Rating threshold gaps** -- Negative scores or scores outside configured thresholds produce undefined ratings. Validate threshold coverage at configuration time, clamp output to 0-5.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Schema, Internal Mutations, and Job Infrastructure

**Rationale:** Everything else depends on the data model and background job scaffolding. The schema must exist before any processing logic can be built or tested.
**Delivers:** `screeningJobs` and `screeningResults` tables, `internalSaveToLibrary` and `internalAddToCollection` mutations, `startBulkScreening` mutation, `cancelBulkScreening` mutation, `getScreeningJobStatus` reactive query, rate limiting for job creation, and bounded query constants.
**Addresses:** Table stakes -- job creation, cancellation, progress tracking infrastructure.
**Avoids:** Pitfall 1 (plan counter serialization from the start), Pitfall 2 (workpool-per-batch architecture), Pitfall 10 (cancellation from day one).

### Phase 2: Scoring Engine and Workflow Processing

**Rationale:** The scoring engine is a pure-function dependency of the processing pipeline. Build and unit-test it before integrating with the workflow. Then wire up the full workflow+workpool screening pipeline.
**Delivers:** `computeScore` and `computeRating` pure functions, `screenBatchAction` workpool action, `handleScreeningBatchComplete` mutation (score, rate, save to library, assign to collection), `runBulkScreeningWorkflow` orchestrator, credit-guard pattern for cancellation.
**Addresses:** Table stakes -- background processing, per-paper error handling. Differentiators -- scoring rules, rating mapping, auto-save, auto-collection-assign.
**Avoids:** Pitfall 3 (credit pre-check + per-batch deduction), Pitfall 5 (explicit null handling in scoring), Pitfall 6 (threshold validation), Pitfall 8 (idempotent collection membership).

### Phase 3: Configuration Dialog and Progress UI

**Rationale:** UI depends on the backend being functional. Build the configuration dialog (scoring rules editor, rating thresholds, collection picker, cost estimate) and the progress tracking UI (reactive progress bar, job status indicator).
**Delivers:** Configuration dialog with scoring preview, credit cost estimation display, real-time progress bar, job history view, results list for completed jobs.
**Addresses:** Table stakes -- cost estimate, progress tracking UX. Differentiators -- configuration dialog with preview, minimum score threshold.
**Avoids:** Pitfall 4 (clear data isolation between Zustand and Convex results), Pitfall 13 (conservative cost estimate with disclaimer), Pitfall 14 (reactive queries for live updates).

### Phase Ordering Rationale

- Phase 1 before Phase 2 because the workflow and workpool actions need tables to write to and internal mutations to call. The extraction system proves this build order works.
- Phase 2 before Phase 3 because the UI needs real backend endpoints to bind to. The scoring engine being pure functions means it can be fully unit-tested before UI work begins.
- The scoring pipeline (rules -> score -> rating -> library save -> collection assign) is the critical path and lives entirely in Phase 2. This is the core value delivery.
- Phases 1 and 2 together deliver a working backend that can be tested via `npx convex run` before any UI is built.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (scoring engine):** The scoring UX is novel (no competitor does per-question point weighting). Threshold validation edge cases (negative scores, all-null responses, single-question configs) need thorough test cases defined during planning.
- **Phase 3 (configuration dialog):** The UI for defining scoring rules and rating thresholds has no existing pattern in the codebase. Needs wireframe-level design decisions during planning.

Phases with standard patterns (skip research-phase):
- **Phase 1 (infrastructure):** Directly mirrors the extraction system. Schema, internal mutations, workflow setup, workpool config -- all have proven patterns to copy.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. Every technology is production-proven in this codebase. |
| Features | HIGH | Table stakes mirror extraction job UX. Differentiators (scoring rules) are well-scoped and arithmetically simple. Competitor analysis confirms feature positioning. |
| Architecture | HIGH | Direct codebase analysis of extraction workflow provides an exact blueprint. Schema, data flow, and integration points are fully specified. |
| Pitfalls | HIGH | 14 pitfalls identified from codebase analysis and Convex platform docs. Counter contention and credit TOCTOU are the most critical; both have clear mitigations. |

**Overall confidence:** HIGH

### Gaps to Address

- **Scoring rules UX design:** No competitor implements per-question point weighting. The configuration dialog UX needs design validation -- how do users understand point assignment and threshold mapping? Consider a "preview" section showing sample score calculations.
- **Credit cost estimation accuracy:** Per-paper screening cost varies with abstract length and question count. The estimate shown in the config dialog will be approximate. Need to decide: show a range ("~50-100 credits") or a conservative upper bound?
- **Data migration for existing screening results:** Current per-page screening results live in Zustand (client-side, transient). There is no migration needed (bulk results are a new, separate data path), but the precedence rules for merging manual and bulk results in the UI need explicit specification.
- **Workpool isolation decision:** Start with reusing `pdfProcessingPool` or create a dedicated `screeningPool`? Research recommends starting shared, but if extraction and screening run simultaneously, competition for 3 parallelism slots could degrade both. This should be validated during Phase 1 implementation.

## Sources

### Primary (HIGH confidence)
- Codebase: `convex/extraction/workflow.ts` -- durable workflow pattern (multi-step, progress, workpool integration)
- Codebase: `convex/ai/actions.ts` -- `generateBatchScreeningResponses` (production-proven batch screening)
- Codebase: `convex/ai/helpers.ts` -- `withUserCreditsBatch` for background credit handling
- Codebase: `convex/extraction/workpoolActions.ts` -- credit-guard pattern, per-paper processing
- Codebase: `convex/library/mutations.ts` -- `saveToLibrary` upsert with denormalized counter
- Codebase: `convex/library/collections.ts` -- `addToCollection` with idempotent assignment
- Codebase: `convex/schema.ts` -- table design patterns, index naming, validator conventions

### Secondary (MEDIUM confidence)
- [Rayyan AI-Powered Systematic Review](https://www.rayyan.ai/) -- competitor feature analysis
- [Elicit Systematic Review](https://elicit.com/solutions/literature-review) -- per-criteria screening transparency
- [Convex Workpool component](https://www.convex.dev/components/workpool) -- background job infrastructure
- [Convex Workflow component](https://www.convex.dev/components/workflow) -- durable execution docs
- [Convex Limits](https://docs.convex.dev/production/state/limits) -- action timeouts, scheduler limits

### Tertiary (LOW confidence)
- Credit cost estimation accuracy -- based on observed token usage patterns, not measured across diverse paper sets

---
*Research completed: 2026-03-08*
*Ready for roadmap: yes*
