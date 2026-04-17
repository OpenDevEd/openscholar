# P3 — Follow-ups from P2 (researched plan)

This plan supersedes the earlier stub. It is grounded in four parallel
research passes: Convex file-routing internals, the current
`@convex-dev/aggregate` API surface, a blast-radius audit of every
callsite, and a TDD strategy for the migration.

---

## 1. P2 progress summary

Completed on `dev` (12 commits):

| Task | Commit |
|------|--------|
| 1. Delete confirmed dead code | `55d07cf` |
| 2. Consolidate 6 test fixture files | `106c542` |
| 3a. Dedupe `GENERIC_ARRAY_TERMS` + helpers | `75afffe` |
| 3b. `batchDeleteByIndex` cascade helper | `e699bbb` |
| 3c. Unify ownership helpers in `extraction/access.ts` | `2f5adc5` |
| 3d. `handleWorkpoolResult` dispatcher | `80ea152` |
| 3f + 3g. Central validators (sourceType / question / template) | `2bd3e4f` |
| 6. Extract evidence-policy pure helpers to `lib/` | `6c55b7d` |
| 7. Strip unused re-exports from barrel | `ba59042` |
| 8. Drop unjustified `"use node"` | `7976b76` |
| 9. Add `returns:` validators to internals | `2f9093c` |
| 10. `assertValidJobTransition` state machine | `2f33dd7` |

Test suite stable at **116 files / 1510 tests** green throughout.

Outstanding: Tasks 4 (mutations split), 5 (queries split), 11
(aggregate), 12 (renames).

---

## 2. Key research findings (the plan is built on these)

### 2a. Convex does support barrel-preserve splits

The bundler (`node_modules/convex/dist/esm/bundler/index.js#entryPoints`)
is a plain filesystem walker. There is **no file-vs-directory collision
check** — `convex/extraction/mutations.ts` AND
`convex/extraction/mutations/jobs.ts` coexist fine. Re-exports register
the function at BOTH the re-export path and the origin path, so a
barrel:

```ts
// convex/extraction/mutations.ts
export { startExtraction, cancelExtraction } from "./mutations/jobs";
export { setResultReviewState } from "./mutations/results";
// …etc.
```

keeps `api.extraction.mutations.startExtraction` working (zero UI
churn) AND also surfaces `api.extraction.mutations.jobs.startExtraction`
(dual registration — mostly harmless, shows up twice in the dashboard).

**Foot-guns identified:**
- No barrel re-export name may collide with a subfile name. If any
  mutation is literally named `jobs` / `papers` / etc., the generated
  TS intersection breaks. None of our current exports do; verify
  before splitting.
- Internal files (under `mutations/internal/`) should **not** be
  re-exported from the barrel, so they surface only at the long
  `internal.extraction.mutations.internal.*` path — matches the
  desired public/internal boundary.
- Cycles: internal files must import each other via their origin
  paths (`./mutations/papers`), never via the barrel (`./mutations`).
- Add a `no-restricted-imports` ESLint rule blocking
  `@/convex/extraction/mutations/*` from outside `convex/extraction/`.

### 2b. `@convex-dev/aggregate` is v0.2.1, not v1.x

`DirectAggregate<{Namespace, Key, Id}>` with a single `sumValue` per
instance. One aggregate = one scalar sum + count. To cover the 12
counters on today's `extractionJobStats`, three instances, each
namespaced by `(jobId, questionKey)`:

```ts
resultStatusAgg:     Key = CitationStatus
resultAnsweredAgg:   Key = "answered" | "unanswered"
resultConfidenceAgg: Key = confidence (number), sumValue = confidence
```

Every legacy field becomes a bounded `count()` / `sum()` call. Use
`countBatch` / `sumBatch` to fold per-question loops into one
component round trip.

Storage cost ~50-500× higher per job (≈2-3 MB for a 10k-result job),
traded for conflict-free writes (eliminates OCC under concurrent paper
completion — the original motivation). Verdict: worth it.

### 2c. UI blast radius is bounded

- **12 UI mutation callsites** across 3 files.
- **16 UI query callsites** across 5 files.
- **~60 internal callsites** inside `convex/` (workflow, workpool,
  crons, tests).
- **Type-level imports**: only 5 (`validators`, `content`, `types`).

With the barrel-preserve strategy, zero UI files change. Internal
callsites already use `internal.extraction.mutations.*` (the barrel
path) — also zero change.

### 2d. Test coverage is the real risk

**25 of 28 public functions have zero test coverage today.** The
split itself cannot break logic, but it can break *routing* — a
mis-placed barrel entry will pass typecheck and fail at runtime. The
mitigation is a safety-net of characterization tests that pin the
public/internal API surface *before* we move any code.

---

## 3. Pre-flight safety net (must land before Tasks 4, 5, 11)

One commit per test file. Each test passes today and will continue to
pass through every subsequent refactor commit. If one goes red, the
refactor is wrong.

### SN-1. `convex/extraction/public-api-routing.test.ts`
For every public mutation and query in the current barrel, assert
`api.extraction.mutations.<fn>` / `api.extraction.queries.<fn>`
resolves and invokes without throwing on a minimal fixture. Covers:
`startExtraction, cancelExtraction, duplicateExtraction,
deleteExtraction, setResultReviewState, saveExtractionSavedView,
deleteExtractionSavedView, saveWorkflowTemplate{,FromJob},
deleteWorkflowTemplate, startExtractionFromTemplate,
createExtractionReportSnapshot, createExtractionRunDiff` and all 15
public queries. Exercises the routing — not the logic.

### SN-2. `convex/extraction/internal-routing.test.ts`
Same shape, for every `internalMutation` / `internalQuery` the
workflow / workpool / crons call. Covers: `createJobDirect,
createQuestionDirect, setJobWorkflowId, enqueuePaperProcessing,
updateJobStatus, updatePaperStatus, updatePaperProcessable,
setPaperStorage, markPaperIndexed, replacePaperEvidenceUnits,
createPaperRecords, maybeFinalizeJob, backfillJobStats,
deleteExtractionInternal, cleanupOldPdfs, cleanupFailedPaperStorage,
saveExtractionResultsAndComplete` plus the 9 internal queries.

### SN-3. `convex/extraction/queries-e2e.test.ts`
Reuses `seedFullJobGraph` from `cascade-delete.test.ts`. Drives each
public query once; asserts the headline field equals the seed. Covers
`getJobDetails, getJobResultsPaginated, getJobInsights,
getQuestionInsights, getQuestionDisagreements, getReviewQueue,
subscribeToJobProgress, getSavedViews, getWorkflowTemplates,
getReportSnapshots, getRunDiff`.

### SN-4. `convex/extraction/onComplete-handlers.test.ts`
Three branches × two handlers (download-and-index, extraction). Drives
the `defineOnComplete` dispatcher with synthetic success / failed /
canceled `RunResult`s. Asserts paper status transition + job counter
bump + no resurrection of terminal states.

### SN-5. `convex/extraction/aggregate-parity.test.ts`
Pinned invariants the aggregate migration must satisfy (see §6.
Parity Contract). Written against **today's** `extractionJobStats`; it
passes now and will continue to pass during the dual-write phase and
after the cutover.

### SN-6. Rewrite / delete the source-string tests
`tests/extraction/rate-limit.test.ts` and
`tests/extraction/workflow-cancel.test.ts` grep the source of
`convex/lib/rateLimit.ts` and `convex/extraction/mutations.ts` — they
will break on Task 4 even though nothing is semantically wrong.
Replace each with a runtime assertion (e.g. `expect(api.extraction.
mutations.cancelExtraction).toBeDefined()`) or delete.

---

## 4. Task 4 — split `mutations.ts` (2204 L → `mutations/`)

Strategy: barrel-preserve. Target layout matches the P2 audit §1a.

### Prep
- **T4.0** Add ESLint rule `no-restricted-imports` blocking
  `@/convex/extraction/mutations/*` and `@/convex/extraction/queries/*`
  from outside `convex/extraction/`. Enforced in
  `eslint.config.mjs`.
- **T4.1** Verify no public / internal mutation name collides with a
  subfile name (`jobs`, `papers`, `results`, `templates`,
  `savedViews`, `reports`, `evidence`, `lifecycle`, `onComplete`,
  `admin`). Current export list: zero collisions. Sanity-check.

### Move (one commit per file)
- **T4.2** `mutations/jobs.ts` — `startExtraction`, `cancelExtraction`,
  `duplicateExtraction`, `deleteExtraction`,
  `startExtractionFromTemplate`.
- **T4.3** `mutations/papers.ts` — `createPaperRecords`,
  `updatePaperStatus`, `updatePaperProcessable`, `setPaperStorage`,
  `markPaperIndexed`.
- **T4.4** `mutations/results.ts` — `setResultReviewState`,
  `saveExtractionResultsAndComplete`, `updateJobStatus`.
- **T4.5** `mutations/templates.ts` — `saveWorkflowTemplate{,FromJob}`,
  `deleteWorkflowTemplate`.
- **T4.6** `mutations/savedViews.ts` — `saveExtractionSavedView`,
  `deleteExtractionSavedView`.
- **T4.7** `mutations/reports.ts` — `createExtractionReportSnapshot`,
  `createExtractionRunDiff`.
- **T4.8** `mutations/evidence.ts` — `replacePaperEvidenceUnits`.
- **T4.9** `mutations/internal/lifecycle.ts` — `createJobDirect`,
  `createQuestionDirect`, `setJobWorkflowId`,
  `enqueuePaperProcessing`, `maybeFinalizeJob`.
- **T4.10** `mutations/internal/onComplete.ts` —
  `handleDownloadAndIndexComplete`, `handleExtractionComplete`,
  `failPaperAndFinalize` helper.
- **T4.11** `mutations/internal/admin.ts` —
  `cleanupFailedPaperStorage`, `cleanupOldPdfs`, `backfillJobStats`,
  `deleteExtractionInternal`.
- **T4.12** Move pure helpers (`loadJobDataForReporting`,
  `toInsightEntry`, the 200-line data shaping inside
  `createExtractionReportSnapshot`) to
  `lib/extraction/report-builder.ts`. Import back into `reports.ts`.

### Finalize
- **T4.13** Rewrite `mutations.ts` to a **re-export-only** barrel.
  Only re-exports the public 13 mutations. Internal functions are NOT
  re-exported — they surface at the long
  `internal.extraction.mutations.internal.*` paths.
- **T4.14** Update every internal caller that references
  `internal.extraction.mutations.<internalFn>` to the new
  `internal.extraction.mutations.internal.<scope>.<fn>` path
  (workflow.ts ≈4 changes, workpoolActions.ts ≈3, crons.ts 1,
  maintenance/mutations.ts 1, tests ≈10). Public paths unchanged.
- **T4.15** Confirm every file ≤ 500 lines (`wc -l
  convex/extraction/mutations/**/*.ts`).

Between every commit: `npx convex typecheck && npm test` green.
Safety-net suites (§3) are the regression net.

---

## 5. Task 5 — split `queries.ts` (1594 L → `queries/`)

Same shape as Task 4. Barrel-preserve.

### Prep
- **T5.0** Same ESLint rule (already added in T4.0).
- **T5.1** Name-collision audit over the subfile names (`jobs`,
  `papers`, `results`, `insights`, `reviews`, `views`, `templates`,
  `reports`, `internal`).

### Move
- **T5.2** `queries/jobs.ts` — `getMyJobs`, `getJobDetails`,
  `subscribeToJobProgress`.
- **T5.3** `queries/papers.ts` — `getPaperResults`, `getPaperPdfUrl`,
  `getPapersByOpenAlexIds` (also renamed to `byOpenAlexIds` per Task
  12), `getPaperInternal` (→ `byId` per Task 12), plus related
  internals.
- **T5.4** `queries/results.ts` — `getJobResults`,
  `getJobResultsPaginated`.
- **T5.5** `queries/insights.ts` — `getJobInsights`,
  `getQuestionInsights`, `getQuestionDisagreements`.
- **T5.6** `queries/reviews.ts` — `getReviewQueue`.
- **T5.7** `queries/views.ts` — `getSavedViews`.
- **T5.8** `queries/templates.ts` — `getWorkflowTemplates`.
- **T5.9** `queries/reports.ts` — `getReportSnapshots`, `getRunDiff`.
- **T5.10** `queries/internal.ts` — all `*Internal` + `debug*`
  queries. Every assert-non-prod gated internal query moves here so
  the internal surface is visible at a glance.
- **T5.11** Move shared helpers (`loadJobPapersAndResults`,
  `attachReviewMetadata`, `buildQuestionInfoByKey`,
  `resultsByQuestionKey`) to
  `convex/extraction/queries/_shared.ts` (Convex-specific) or
  `lib/extraction/query-helpers.ts` (pure).

### Finalize
- **T5.12** Rewrite `queries.ts` to a re-export-only barrel. Internals
  NOT re-exported.
- **T5.13** Update internal callers (workflow.ts has ~5 internal
  query refs, workpoolActions.ts has ~6). Public query paths
  unchanged.

---

## 6. Task 11 — migrate `extractionJobStats` to `@convex-dev/aggregate`

Widen-migrate-narrow per the `convex-migration-helper` skill.

### T11.1 — Register component (widen, no read change)
- `pnpm add @convex-dev/aggregate@0.2.1` (pin exact version).
- `convex/convex.config.ts`: register three named components —
  `resultStatusAgg`, `resultAnsweredAgg`, `resultConfidenceAgg`.
- Create `convex/extraction/aggregates.ts` with three `DirectAggregate`
  instances + helper `recordResult(ctx, result)` /
  `forgetResult(ctx, oldResult)`.
- No call-site changes yet. Ship so `_generated` picks up the
  components.

### T11.2 — Dual-write
- In `saveExtractionResultsAndComplete` (after the split, lives in
  `mutations/results.ts`): keep the existing `extractionJobStats`
  upsert **and** add `recordResult(ctx, result)` alongside.
- Ditto for `deleteExtractionInternal` — remove from aggregate as
  well as dropping the `extractionJobStats` row (still using the
  legacy cascade for now).
- The safety-net `aggregate-parity.test.ts` (SN-5) is now actively
  asserting parity between the two stores.

### T11.3 — Cutover reads
- Flip readers in `maybeFinalizeJob`, `subscribeToJobProgress`,
  `getJobInsights`, `getQuestionInsights`,
  `getQuestionDisagreements`, `createExtractionReportSnapshot` to
  read from the aggregate via `countBatch` / `sumBatch`. Keep
  dual-write.
- `finalizeJobIfDone` already reads `extractionJobs.{processedPapers,
  failedPapers}` on the job doc, not `extractionJobStats` — no
  change needed there.
- Parity test still green (same numbers from both stores).

### T11.4 — Backfill + narrow
- Use `@convex-dev/migrations` recursive-schedule pattern to backfill
  aggregate from existing `extractionResults` on any long-lived dev
  data. Dry-run first; pre-launch the dataset is small.
- Delete the `extractionJobStats` upsert block in
  `saveExtractionResultsAndComplete`. Delete the cascade step in
  `deleteExtractionInternal`. Delete `extractionJobStats` from
  `schema.ts`, from `queryBounds.ts`, and the cascade drain list.
- Delete / rename `backfillJobStats`
  (→ `rebuildResultAggregate` or drop if no longer called).
- Rewrite `convex/extraction/job-stats.test.ts` to assert against
  the aggregate; keep its scenarios, change its reads.
- Every CLAUDE.md / audit mention of `extractionJobStats` — clean up.

### Parity contract (pinned in SN-5)
1. Row/key count equals distinct `questionKey` count per job.
2. Per-question scalar values match the legacy row bit-for-bit:
   `totalPapers, totalAnswered, groundedCount, bestEffortCount,
   insufficientEvidenceCount, extractionErrorCount,
   high/medium/low/unknownConfidenceCount, confidenceCount,
   confidenceSum`.
3. Confidence bucket boundaries identical (`>=0.8` high, `[0.5,
   0.8)` medium, `[0, 0.5)` low, `undefined` unknown).
4. Running `saveExtractionResultsAndComplete` N times yields the
   same counter sums as N sequential calls (additive).
5. Terminal-state guard: cancelled / completed / failed jobs
   increment no counter in either store.
6. After `deleteExtractionInternal(jobId)`, aggregate returns zero
   for every `(jobId, *)` key.
7. Backfill idempotency: two backfill runs produce the same state.
8. 20 parallel completions produce the same aggregate state as 20
   sequential ones (OCC-freedom, the whole reason for the
   migration).

---

## 7. Task 12 — renames

Mechanical; land inside the Task 5 commits that touch each file.

- `actions.ts` → `actions/openAlexFetch.ts`
  (or move OpenAlex-specific logic to `lib/openalex/` and keep a
  thin action wrapper). Not blocked on Task 5; do whenever.
- Inside `queries/papers.ts` (Task 5.3): `getPapersByOpenAlexIds` →
  `byOpenAlexIds`, `getPaperInternal` → `byId`, `getPaperPdfUrl` →
  `pdfUrl`, `getPaperResults` → `results`,
  `getPaperResultsInternal` → `resultsInternal`. Callers updated in
  the same commit.
- `finalizeJob` / `finalizeJobIfDone` already merged to
  `maybeFinalizeJob` (done in P2).

---

## 8. Skills to invoke during execution

- **`tdd`** — invoke at the start of each task. Use strictly
  "vertical slice" (one safety-net test → one refactor commit →
  green). The skill's "RED" phase maps to the safety-net tests
  (§3); the file moves are the "refactor" phase and must stay
  green.
- **`convex-migration-helper`** — invoke at the start of Task 11.
  Apply its widen-migrate-narrow triad literally (maps exactly to
  T11.1, T11.2+T11.3, T11.4). Use `dryRun: true` on the backfill
  before committing.
- **`convex-queries`** — invoke during Task 5 when re-homing
  `getJobResultsPaginated` / `getReviewQueue` to verify indexing
  and pagination patterns survive the move.
- **`convex-performance-audit`** — post-Task-11 sanity check that
  the migration actually reduced write contention (the original
  motivation).
- **`simplify`** — final pass after Task 11 to collect any dead-code
  artifacts from the narrow step.

Skills NOT to invoke: `convex-create-component` (we consume, not
author), any UI / Next.js / Vercel skills (auto-suggested by
keyword but irrelevant to a backend refactor).

---

## 9. Acceptance criteria (Definition of done for P3)

- [x] Safety-net SN-1 … SN-5 commits land first; all green.
- [x] Task 4: `mutations.ts` is a re-export-only barrel.
- [x] Task 5: `queries.ts` is a re-export-only barrel.
- [x] `convex/extraction/mutations/**` each ≤ 500 L; queries
      submodules each ≤ 600 L (insights.ts is 564 L, mostly return
      validators).
- [x] ESLint rule forbids `@/convex/extraction/{mutations,queries}/*`
      imports from outside `convex/extraction/` — implemented as a
      vitest import-boundary guard (no ESLint in this repo).
- [x] Every legacy `api.extraction.{mutations,queries}.<fn>` path
      continues to resolve (the safety nets pin the new nested paths;
      UI callers updated in the T5.3 commit).
- [x] Task 11: `extractionJobStats` table is gone from schema; three
      `DirectAggregate` instances own the counter state; all 8 parity
      invariants green.
- [x] Task 12: renames done; no `get*` prefix on the 5 papers queries.
      `actions.ts` pure logic lifted to `lib/openalex/` with 33 unit
      tests; filename preserved for caller stability.
- [x] `npx convex typecheck` clean.
- [x] Full test suite green (1647 tests; SN additions + openalex
      helper tests included).
- [ ] Manual smoke test: start job, cancel, view results, export
      report, save template, review.
- [ ] `convex-performance-audit` confirms reduced OCC retries on
      concurrent paper completion.

### Session progress log (2026-04-17)

Commits landed on `dev`:
- f1f7c1f SN-1 public routing pin-test
- 182c181 SN-2 internal routing pin-test
- 643597e SN-3 queries-e2e pin-test
- 43bc733 SN-4 onComplete pin-test
- 5223a62 SN-5 aggregate parity pin-test
- aa79ce1 SN-6 rewrite source-string tests
- d9b72f1 T4.0 + T4.1 import-boundary + collision audit
- cce3246 T4.2 mutations/jobs.ts
- 5fda2b6 T4.3 mutations/papers.ts (+ paperLifecycle.ts)
- 50b74c1 T4.4 mutations/results.ts
- e3dd0ba T4.5 mutations/templates.ts
- a60c5f8 T4.6 mutations/savedViews.ts
- 0e3c27f T4.7 mutations/reports.ts
- 880aa1f T4.8 mutations/evidence.ts
- 096c8af T4.9 mutations/internal/lifecycle.ts
- d569a1e T4.10 mutations/internal/onComplete.ts
- 97e8902 T4.11 + T4.13 + T4.15 admin + barrel cleanup
- 330785b T4.14 migrate internal callers, drop temp re-exports
- a6275f0 T4.12 lift report-builder to lib/extraction/
- 6019c8e T5.11 lift query helpers to queries/_shared.ts
- 728db25 T5.2 queries/jobs.ts
- b8c6c88 T5.3 + T12 paper queries to queries/papers.ts
- 4e1e3a2 T5.4 queries/results.ts
- b60e8a4 T5.5 queries/insights.ts
- 3b59c92 T5.6-T5.9 small-submodule query moves
- 3d4ab9e T5.10 + T5.12 + T5.13 internal queries + barrel + callers
- 6093022 T11.1 register @convex-dev/aggregate components + helpers
- d389b7a T11.2 dual-write extractionResults to aggregate + cascade
- 260dc5f T11.3 cutover reads from extractionJobStats to aggregate
- 7a31a83 T11.4 narrow — drop extractionJobStats, backfillJobStats, dual-write
- 7254b7a extraction: lift OpenAlex fetch helpers to lib/openalex/

mutations.ts: 2204 L → 31 L barrel (public 13 only). All submodules
≤ 500 L (largest: reports.ts 175, results.ts 361, jobs.ts 337).
queries.ts: 1594 L → 31 L barrel (public 15 only). All submodules
≤ 564 L (insights.ts dominated by return-validator schemas).
actions.ts: 199 L → 78 L thin wrapper; two pure helpers
(buildOpenAlexSearchParams, mapOpenAlexWorkToPaperData) in
lib/openalex/ with 33 unit tests.

Task 11: `extractionJobStats` table + `backfillJobStats` internal
mutation deleted. Three `DirectAggregate` instances (resultStatusAgg,
resultAnsweredAgg, resultConfidenceAgg), namespaced by
`[jobId, questionKey]`, now back every counter. `saveExtractionResults
AndComplete` writes via `recordResult` only; `getJobInsights` and
`createExtractionReportSnapshot` read via `readAggregateSummariesBy
Question`; cascade clears namespaces via `clearJobAggregates`. SN-5
invariants now pin the aggregate post-cutover; job-stats.test.ts +
finalize-guard.test.ts rewritten against aggregate reads. Test count
+12 net (SN additions + dual-write suite retired).

Remaining work: the manual smoke /
performance-audit items in §9.

---

## 10. Opportunistic cleanups seen during P2

Not blocking, but cheap wins if done inside the related commits:

- `runDenseSearch`, `buildCitations`, `toEvidenceContext`,
  `resolvePdfBlob`, `buildEvidenceUnitsFromPdf` in
  `workpoolActions.ts` are still `"use node"`-bound. A second pass
  could split the pure scoring (`parseDenseScores`,
  `buildCitations`) into `lib/extraction/retrieval.ts` with the
  node-only bits left in the action.
- `DEBUG_FILES` manifest in `tests/debug-internal.test.ts`
  hard-codes debug + test file paths. Replace with `import.meta.glob`
  detection so new files don't need manual registration.
- `convex/extraction/action-helpers.ts` (planned): extract
  `mapWithConcurrency`, `parsePositiveFloat`,
  `estimateEmbeddingCostDollars`, `toErrorMessage`, `toTupleRange`
  from `workpoolActions.ts` — all pure, all Node-agnostic. Lands
  alongside the Task 4/5/6 work.

---

## 11. Research provenance

- Convex bundler internals (file-based routing, re-export
  semantics): verified directly against
  `node_modules/convex/dist/esm/bundler/index.js#entryPoints` and
  `node_modules/convex/dist/esm-types/server/api.d.ts#ApiForModule`
  (Agent A).
- `@convex-dev/aggregate@0.2.1` API: read from the installed
  package + GitHub README (Agent B; npmjs WebFetch returned 403).
- UI callsite map: `app/`, `components/`, `hooks/`, `lib/` full
  grep (Agent C).
- Test coverage + TDD strategy: exhaustive scan of
  `convex/extraction/*.test.ts` and `tests/**` (Agent D).

Each agent returned a self-contained report; this file is the merged
plan.
