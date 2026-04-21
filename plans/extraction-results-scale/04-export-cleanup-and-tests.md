# Plan 04 — Export-All, Cleanup, Repair Hook, Final Verification

**Depends on:** 01, 02, 03.

## Goal

Finish the cutover by making export-all truthful, deleting the dead architecture, and adding a bounded repair path for pre-plan dev jobs.

## Scope

**In scope**

- New server export query/action for the full filtered corpus.
- Update `ExportDialog` / page wiring for export-all.
- Add an internal repair helper for pre-plan jobs missing projection fields.
- Delete dead results-list code.
- Final page/query test sweep.

**Out of scope**

- Any new UX redesign unrelated to correctness/perf.

## Design

### 1. Export-all path

Add a dedicated server path, e.g.:

```ts
getJobResultsForExport({
  jobId,
  filters,
  sortBy,
})
```

It reuses the same projection-based filtering/sorting path as `getJobResultsPage`, but returns the full filtered corpus.

Client flow:

1. user opens `ExportDialog`
2. "selected" export still uses concrete client rows
3. "all" export fetches the full filtered set from Convex
4. existing client export helpers generate CSV/JSON/XLSX

### 2. Repair helper

Add a bounded internal/dev helper such as:

```ts
internal.extraction.mutations.internal.admin.rebuildJobListProjection({ jobId })
```

This is not a migration. It is a dev convenience for jobs created before the projection fields existed.

### 3. Dead-code cleanup

Remove:

- now-dead client full-corpus filter/sort/preprocess helpers
- old paginated-query mocks and tests that only existed for the 200-row loading path
- any obsolete exports from `convex/extraction/queries.ts`

## Files touched

- `convex/extraction/queries/results.ts`
- `components/extraction/export-dialog.tsx`
- `app/extraction/[jobId]/page.tsx`
- `convex/extraction/mutations/internal/admin.ts`
- `lib/extraction/filtering.ts` or its remaining consumers
- final tests

## Test plan

### Test-first

1. page/dialog test: export-all no longer depends on the current page rows
2. query test: export count equals `totalFiltered`

### Test-after

1. run the page tests
2. run the query tests
3. manual smoke on a >200-paper job:
   - totals truthful
   - page 2+ works
   - filters stay full-corpus correct
   - export-all returns the filtered corpus

## Acceptance criteria

1. Export-all is full-corpus correct.
2. No dead results architecture remains.
3. Pre-plan dev jobs can be repaired without a runtime legacy fallback.
4. The full plan set leaves one canonical results data flow.

