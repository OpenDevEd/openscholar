# P3 — Follow-ups from P2

This file tracks work from `P2-refactor-modernize.md` that was **not**
completed in the initial pass, plus opportunistic follow-up items
captured while doing the refactor.

## P2 progress summary

Completed (commits on `dev`):

| Task | Commit |
|------|--------|
| 1. Delete confirmed dead code | `55d07cf` |
| 2. Consolidate 6 test fixture files into `tests/fixtures.ts` + `tests/runners.ts` | `106c542` |
| 3a. Dedupe `GENERIC_ARRAY_TERMS` + helpers | `75afffe` |
| 3b. `batchDeleteByIndex` helper for cascade delete | `e699bbb` |
| 3c. Unify ownership helpers in `extraction/access.ts` | `2f5adc5` |
| 3d. `handleWorkpoolResult` dispatcher | `80ea152` |
| 3f + 3g. Centralise sourceType / question / template validators | `2bd3e4f` |
| 6. Extract evidence-policy pure helpers to `lib/extraction/evidence-policy.ts` | `6c55b7d` |
| 7. Strip unused re-exports from extraction barrel | `ba59042` |
| 8. Drop unjustified `"use node"` directives | `7976b76` |
| 9. Add `returns:` validators to internal functions | `2f9093c` |
| 10. `assertValidJobTransition` state machine + tests | `2f33dd7` |

Outstanding (deferred to P3):

- **4. Split `mutations.ts` (2204 lines → multi-file).** Audit
  target is a `mutations/` directory with 7 public + 3 internal files.
  Blocker encountered: Convex's file-based routing means moving
  functions into `mutations/jobs.ts`, `mutations/papers.ts`, etc.
  rewrites the public API path from `api.extraction.mutations.<fn>` to
  `api.extraction.mutations.jobs.<fn>` — which breaks every UI
  callsite (≈15) and every internal callsite. Needs a dedicated
  session that plans the path migration atomically.
- **5. Split `queries.ts` (1594 lines).** Same blocker as Task 4.
- **11. Adopt `@convex-dev/aggregate` for the counter.** Requires a
  fresh read of the current component docs (training data is stale;
  per project rules #2). Migration also needs a strategy for the
  existing `extractionJobStats` denormalised counter — either
  swap-and-drop or parallel-maintain during rollout.
- **12. Renames for clarity.** Largely dependent on Tasks 4/5 landing
  first (`actions.ts` → `actions/openAlexFetch.ts`,
  `getPapersByOpenAlexIds` → `byOpenAlexIds` inside `queries/papers.ts`,
  etc.).

## P3 recommended approach

1. **Decide the path-migration strategy for Tasks 4 / 5 first.** The
   cleanest option is probably to accept the path change
   (`api.extraction.mutations.jobs.startExtraction` etc.) and update
   callers in one atomic commit. A gentler alternative keeps
   `mutations.ts` as a thin re-export barrel so the old paths still
   work alongside the new subdirectory paths during rollout. Pick one
   before opening files.

2. **Task 11 (aggregate) is independent.** It can land in parallel
   with 4/5. Start by reading
   <https://www.npmjs.com/package/@convex-dev/aggregate> via WebFetch
   + context7 — the write path for `extractionJobStats` is
   `saveExtractionResultsAndComplete` (mutations.ts, current ~lines
   2066-2119).

3. **Task 12 is mechanical once 4/5 land.** Keep it in the same PR as
   Task 4/5 to avoid churn.

## Opportunistic cleanup opportunities observed during P2

- `loadJobDataForReporting` + `toInsightEntry` (mutations.ts ~65, 106)
  and `createExtractionReportSnapshot`'s 200-line data shaping
  (mutations.ts ~764) are pure data transforms that belong in a new
  `lib/extraction/report-builder.ts`. Deferred with Task 4 since
  they'd normally move during the split.
- `runDenseSearch`, `buildCitations`, `toEvidenceContext`,
  `resolvePdfBlob`, `buildEvidenceUnitsFromPdf` in workpoolActions.ts
  are still "use node"-bound. A second pass could split the pure
  scoring (`parseDenseScores`, `buildCitations`) into
  `lib/extraction/retrieval.ts` with the node-only storage/pdfjs bits
  left in the action.
- The DEBUG_FILES manifest in `tests/debug-internal.test.ts` still
  hard-codes the set of debug + test files; any new test fixture
  added after P2 must be added there. Consider glob-based detection.
