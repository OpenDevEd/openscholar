# Architecture / DRY / Code-Organization Review — `convex/extraction/`

## Summary

`convex/extraction/` is three god files (mutations 2288L, queries 1659L, workpoolActions 1191L) plus a sprawl of 6 overlapping debug modules and 6 duplicate test fixtures. Split mutations/queries by domain (jobs/papers/results/reviews/templates/reports/lifecycle), extract pure retrieval/citation helpers out of workpoolActions into `lib/extraction/`, consolidate debug files to 1-2 (many duplicate each other verbatim), fold test fixtures into one `tests/fixtures.ts`. Delete dead code: `guard.ts` (4L stub), `test_helpers.ts` (unreferenced), `extractAndChunkPdf`/`formatChunkWithMetadata`/`prepareChunksForRag`, `detectQuestionType`, `testSimpleWorkflow`, `debug_papers.ts` (subsumed by `debug_errors.ts`), and redundant `getCurrentUserInternal`. Triplicated `GENERIC_ARRAY_TERMS`, 8-step cascade-delete repetition, three near-identical `handle*Complete` onComplete handlers, inlined `sourceType` validators, and duplicate `finalizeJob`/`finalizeJobIfDone` are the highest-leverage DRY targets. Barrel `index.ts` leaks internal functions; report-builder logic belongs in `lib/extraction/`, not mutations.ts.

## 1. God-file splits

### 1a. `convex/extraction/mutations.ts` (2288 lines, 35 exports) → split

```
convex/extraction/mutations/
├── jobs.ts          (lifecycle of a job: start, cancel, duplicate, delete)
├── papers.ts        (per-paper state transitions)
├── results.ts       (result writes + review state)
├── templates.ts     (workflow templates save/delete)
├── savedViews.ts    (saved views)
├── reports.ts       (snapshots + diffs)
├── evidence.ts      (replacePaperEvidenceUnits and helpers)
├── internal/
│   ├── lifecycle.ts (createJobDirect, createQuestionDirect, setJobWorkflowId, enqueuePaperProcessing)
│   ├── onComplete.ts (handleDownloadAndIndexComplete, handleExtractionComplete, handlePaperFetchComplete)
│   └── admin.ts     (cleanupFailedPaperStorage, cleanupOldPdfs, backfillJobStats, deleteExtractionInternal)
```

Concrete function → file map (by current line number in `mutations.ts`):

- **`mutations/jobs.ts`**: `startExtraction` (112), `cancelExtraction` (241), `duplicateExtraction` (288), `deleteExtraction` (1040), `startExtractionFromTemplate` (450)
- **`mutations/papers.ts`**: `createPaperRecords` (1330), `updatePaperStatus` (1420), `updatePaperProcessable` (1460), `setPaperStorage` (1474), `setPaperWorkId` (1501), `markPaperIndexed` (1515)
- **`mutations/results.ts`**: `setResultReviewState` (361), `saveExtractionResultsAndComplete` (2098), `updateJobStatus` (1390)
- **`mutations/templates.ts`**: `saveWorkflowTemplateFromJob` (581), `saveWorkflowTemplate` (639), `deleteWorkflowTemplate` (748)
- **`mutations/savedViews.ts`**: `saveExtractionSavedView` (512), `deleteExtractionSavedView` (565)
- **`mutations/reports.ts`**: `createExtractionReportSnapshot` (764), `createExtractionRunDiff` (970)
- **`mutations/evidence.ts`**: `replacePaperEvidenceUnits` (2244)
- **`mutations/internal/lifecycle.ts`**: `createJobDirect` (1677), `createQuestionDirect` (1750), `setJobWorkflowId` (1773), `enqueuePaperProcessing` (1786), `finalizeJob` (1536), `finalizeJobIfDone` (1619)
- **`mutations/internal/onComplete.ts`**: `handleDownloadAndIndexComplete` (1853), `handleExtractionComplete` (1951), `handlePaperFetchComplete` (2031), `getUserIdFromJob` (2016)
- **`mutations/internal/admin.ts`**: `cleanupFailedPaperStorage` (1203), `cleanupOldPdfs` (1578), `backfillJobStats` (1234), `deleteExtractionInternal` (1058)

Helpers currently at file top (`assertJobOwnership` 37, `loadJobDataForReporting` 49, `toInsightEntry` 91) → move `assertJobOwnership` to `lib/auth.ts` (merged with `resolveOwnedJob`, see §2c), move `loadJobDataForReporting` + `toInsightEntry` to `lib/extraction/report-builder.ts`.

### 1b. `convex/extraction/queries.ts` (1659 lines, 25 exports) → mirror split

```
convex/extraction/queries/
├── jobs.ts     (getMyJobs, getJobDetails, subscribeToJobProgress)
├── papers.ts   (getPaperResults, getPaperPdfUrl)
├── results.ts  (getJobResults, getJobResultsPaginated)
├── insights.ts (getJobInsights, getQuestionInsights, getQuestionDisagreements)
├── reviews.ts  (getReviewQueue)
├── views.ts    (getSavedViews)
├── templates.ts (getWorkflowTemplates)
├── reports.ts  (getReportSnapshots, getRunDiff)
└── internal.ts (all `*Internal` queries)
```

Internal queries currently mixed into the file: lines 424, 435, 1415, 1442, 1454, 1470, 1477, 1487, 1648. Pull them into a sibling `queries/internal.ts` so the barrel can distinguish public vs internal cleanly.

### 1c. `convex/extraction/workpoolActions.ts` (1191 lines) → pure helpers out, actions split

Pure functions at lines 267-387 (`normalizeExtractionOutputForQuestion`, `validateSupportEvidenceIds`, `applyEvidencePolicy`, `isUsableAbstract`, `applyAbstractOnlyPolicy`) have no Convex dependencies — move to `lib/extraction/evidence-policy.ts`.

Retrieval helpers (`parseDenseScores`, `runDenseSearch`, `buildCitations`, `toEvidenceContext`, `resolvePdfBlob`, `buildEvidenceUnitsFromPdf`) → `lib/extraction/retrieval.ts`. Leave only the two actions:

```
convex/extraction/actions/
├── downloadAndIndex.ts   (was downloadAndIndexPdfAction @772)
└── waitAndExtract.ts     (was waitAndExtractAction @918)
```

This also removes the duplicated `ARRAY_GENERIC_TERMS` declaration (workpoolActions.ts:117).

## 2. DRY violations (file:line cited)

### 2a. `GENERIC_ARRAY_TERMS` — triplicated
- `lib/extraction/insights.ts` (canonical)
- `convex/extraction/workpoolActions.ts:117` (`ARRAY_GENERIC_TERMS`, locally renamed copy)
- `convex/extraction/debug_job_citations.ts:11` (`GENERIC_ARRAY_TERMS` plus its own copies of `normalizeArrayEntity`, `isGenericArrayEntity`)

**Fix:** single export from `lib/extraction/insights.ts`; delete the other two.

### 2b. `deleteExtractionInternal` 8-step cascade — `mutations.ts:1058-1201`
Eight near-identical blocks: iterate-index → collect → delete-by-id with batch size 100. Extract to:
```ts
// lib/convex-helpers/cascade.ts
async function batchDeleteByIndex(ctx, table, indexName, fieldName, value) { ... }
```
Then `deleteExtractionInternal` becomes a 10-line orchestration.

### 2c. Ownership assertion helpers duplicated
- `mutations.ts:37` `assertJobOwnership`
- `queries.ts` `resolveOwnedJob` / `resolveOwnedPaper`

Unify under `lib/auth.ts` exports: `assertJobOwnership`, `resolveOwnedJob`, `resolveOwnedPaper`.

### 2d. Three onComplete handlers with identical branching — `mutations.ts:1853, 1951, 2031`
`handleDownloadAndIndexComplete`, `handleExtractionComplete`, `handlePaperFetchComplete` all have:
```
switch (result.kind) {
  case "success": ...
  case "failed": ...
  case "canceled": ...
}
```
Extract a helper `handleWorkpoolResult({ onSuccess, onFailed, onCanceled })` in `lib/convex-helpers/workpool.ts`; each handler becomes 3 small arrow fns.

### 2e. `finalizeJob` (1536) vs `finalizeJobIfDone` (1619) — duplicate paper-counting
Both fetch papers-by-job, bucket by status, update counts. `finalizeJobIfDone` is `finalizeJob` plus an early-exit guard. Merge to a single `finalizeJobIfDone`; delete `finalizeJob` or make it call the same private helper `computeJobTermination(ctx, jobId)`.

### 2f. `sourceType` literal validator inlined ~5 times
Same `v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"))` inlined in mutations/queries. `validators.ts` already defines most source types — add `sourceTypeValidator` there and use it.

### 2g. `debugRecentPapers` duplicated
- `convex/extraction/queries.ts:1422`
- `convex/debug.ts:5`

Keep one (prefer extraction-scoped with auth-gated internalQuery); delete the other.

### 2h. `debug_papers.ts` subsumed by `debug_errors.ts`
`debug_papers.ts:getPaperErrorsInternal` (30 lines) is a strict subset of `debug_errors.ts:getFailedPapersDebug`. Delete `debug_papers.ts`.

### 2i. Inline workflow template validator
`queries.ts:1315` `getWorkflowTemplates` re-declares a validator already exported from `validators.ts`. Import instead.

### 2j. `getCurrentUserInternal` (`queries.ts:1648`) is a wrapper over `lib/auth.getCurrentUser`
Delete; call the lib helper directly.

### 2k. Test fixtures — 6 near-identical files
- `testActions.ts` (createTestJob, sourceType history, 1 question)
- `test_runner.ts` (createAndRunTestJob, 3 questions)
- `test_automation.ts` (runPdfTestNow "use node")
- `test_automation_internal.ts` (getFirstUserId, createTestJob, getJobStatus, getJobResults)
- `create_test_job.ts` (createTestJobForFix)
- `testWorkflow.ts` (testSimpleWorkflow, line 1-51)

All build the same shape of job + questions + sources. Consolidate into `convex/extraction/tests/fixtures.ts` with one `createTestJob({ questions, source, pdfOnly })` helper + `getTestJobStatus` + `getTestJobResults`. `testSimpleWorkflow` is a trivial smoke test (just calls 1-paper happy path) — delete entirely or fold into an integration test.

## 3. Dead / vestigial code to delete

| Path | Lines | Status | Action |
|---|---|---|---|
| `convex/extraction/guard.ts` | 4 | Comment-only stub: `// Feature flag guards moved to convex/featureFlags/guard.ts` | **Delete file** |
| `convex/extraction/chunking.ts` — `extractAndChunkPdf`, `formatChunkWithMetadata`, `prepareChunksForRag` | ~70L of 275 | No external callers | **Delete exports** (keep `extractTextByPages`, `chunkPagesWithMetadata`) |
| `convex/extraction/prompts.ts:118` `detectQuestionType` | ~20 | No callers | **Delete** |
| `convex/extraction/test_helpers.ts` | 80 | Unreferenced outside `_generated/api.d.ts` | **Delete file** |
| `convex/extraction/debug_papers.ts` | 30 | Subset of `debug_errors.ts` | **Delete file** |
| `convex/extraction/testWorkflow.ts` | 51 | `testSimpleWorkflow` smoke test not wired to any runner | **Delete file** |
| `convex/extraction/queries.ts:1648` `getCurrentUserInternal` | ~10 | Trivial wrapper | **Delete** |
| `convex/extraction/queries.ts:1422` **or** `convex/debug.ts:5` `debugRecentPapers` | ~20 | Duplicate | **Delete one copy** |
| Schema fields `sourceHistoryId`, `sourceZoteroCollection` (legacy pre-multi-source) | — | Superseded by `sourceHistoryEntries` / `sourceZoteroSelection` (workflow.ts:65-69 still reads `sourceHistoryId` as fallback) | **Remove legacy fallback path (workflow.ts:65-69) + schema field** (per user rule 3 — no legacy) |

## 4. Public API surface (`convex/extraction/index.ts`)

- Barrel re-exports internal-only mutations (e.g. `createJobDirect`, `createQuestionDirect`, `setJobWorkflowId`) through the public surface. Put internal functions behind an `internal.ts` barrel and consume via `internal.extraction.*` only.
- Debug/test exports should not be in the production barrel at all — they're reachable via `internal.extraction.debug*` already and shouldn't pollute `index.ts`. Create `convex/extraction/debug/index.ts` and `convex/extraction/tests/index.ts`.
- Duplicate sub-exports (`storage` re-export of uploads.generateUploadUrl) can be unified.

**Risk:** `index.ts` currently exposes `createPaperRecords`, `updateJobStatus`, `updatePaperStatus`, etc. as public — these are internal contract between workflow ↔ mutations. Mark them `internalMutation` and remove from public surface.

## 5. Module boundary leaks

- **`lib/extraction/insights.ts`** logic duplicated inside `convex/extraction/workpoolActions.ts` (array-generic gate) and `convex/extraction/debug_job_citations.ts`. `convex/` files should *consume* `lib/`, not re-implement.
- **Report-builder**: `createExtractionReportSnapshot` (`mutations.ts:764-968`, ~204 lines) is pure data-shaping over loaded entities. Move the shaping to `lib/extraction/report-builder.ts`; keep only the transactional write inside the mutation.
- **OpenAlex fetch**: `convex/extraction/actions.ts` contains OpenAlex-specific pagination logic. That is a network concern — belongs next to `lib/openalex/` (the project already has `lib/openalex`). Move pagination + URL building there; keep only the thin Convex action wrapper.
- **Evidence policy pure functions (workpoolActions.ts:267-387)** are import-safe from anywhere — currently they are trapped behind a `"use node"` file, meaning no non-node code can reuse them. This is a real boundary leak, not just cosmetic.
- **`workflow.ts:65-69`** reads both the legacy `sourceHistoryId`+`searchFilters` shape and the new `sourceHistoryEntries`. Job-source normalization belongs in a `lib/extraction/sources.ts#normalizeJobSources(job)` helper, not inline inside the workflow.

## 6. Naming & organization

- `actions.ts` (OpenAlex fetch) vs `workpoolActions.ts` (PDF processing) vs `testActions.ts` (test fixture) — three files named `*actions*` with no semantic relation. Rename to `openAlexFetch.ts`, and domain-named action files (see §1c).
- `debug_errors.ts` / `debug_papers.ts` / `debug_paper_results.ts` / `debug_job_content.ts` / `debug_job_citations.ts` — inconsistent underscore+ordering. After consolidation, a single `debug/` folder with `papers.ts`, `jobs.ts`, `citations.ts` reads far better.
- `test_runner.ts` / `test_automation.ts` / `test_automation_internal.ts` / `testActions.ts` / `testWorkflow.ts` / `create_test_job.ts` — mixed snake and camel, no axis. Fold into `tests/fixtures.ts` + `tests/runners.ts`.
- `finalizeJob` vs `finalizeJobIfDone` — confusing pair; after merge call it `maybeFinalizeJob`.
- `getPapersByOpenAlexIds` vs `getPaperInternal` vs `getPaperPdfUrl` vs `getPaperResults` vs `getPaperResultsInternal` — group under `queries/papers.ts` and shorten to `byOpenAlexIds`, `byId`, `pdfUrl`, `results`.

## 7. Positive observations

- `validators.ts` (372L) is well-organized: zero logic, only schema vocabulary, reused widely. Keep as-is.
- `evidence_units.ts` (575L) cleanly separated, single responsibility, rich tests.
- `content.ts` (16L) and `dedupe.ts` (30L) are exemplary single-purpose helpers — the rest of the module should aspire to this granularity.
- `queries.ts` introduced shared helpers (`loadJobPapersAndResults`, `resolveOwnedJob`, `attachReviewMetadata`, `buildQuestionInfoByKey`) — good DRY within that file; propagate the pattern into mutations.
- `workflow.ts` (245L) keeps orchestration in one place and delegates data work to mutations/actions — right shape, just the job-source normalization should move out.
- Existing test coverage (`tests/cascade-delete.test.ts`, `tests/job-stats.test.ts`, `tests/debug-internal.test.ts`) gives a safety net for the proposed refactors.
- Workpool + Workflow separation is correctly applied; each paper is durably retried via `pdfProcessingPool`, and the workflow only enqueues — a clean pattern.
