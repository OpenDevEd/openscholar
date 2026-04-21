# Plan 01 — Truthful Counts + Server Page Query Foundation

**Depends on:** nothing. **Blocks:** 02, 03, 04.

## Goal

Kill the two user-visible bugs first:

1. the table must no longer stop at 200 papers,
2. the toolbar/pagination total must stop lying.

This plan also lays the new data-flow foundation by replacing the results hook with a page query that can address **any page** of the job while only loading full result/review rows for the visible page.

## Scope

**In scope**

- Add a new Convex public query: `api.extraction.queries.getJobResultsPage`.
- Replace `useProtectedPaginatedQuery` in `app/extraction/[jobId]/page.tsx` with `useProtectedQuery(getJobResultsPage, ...)`.
- Delete the `loadMore(200)` effect and the 200-row hard stop.
- Thread the authoritative total (`job.totalPapers` / `resolvedProgress.total`) through `<ResultsToolbar>` and `<SmartPagination>`.
- Add stable behavior hooks such as `data-results-scope`, `data-total-papers`, `data-filtered-papers`.
- Keep client-side filter/sort semantics temporarily; this plan is the foundation, not the final full-corpus filter implementation.

**Out of scope**

- Projection fields on `extractionPapers` (plan 02).
- Server-side filter/sort semantics (plan 03).
- Export-all correctness (plan 04).

## Design

### 1. New query contract

```ts
getJobResultsPage({
  jobId,
  page,
  pageSize,
})
```

Returns:

```ts
{
  status: "ok",
  totalAll: number,
  totalPages: number,
  page: number,
  pageSize: number,
  items: PaperWithResults[],
}
```

### 2. Query algorithm (foundation version)

1. Resolve/access-check the job.
2. Read all processable papers for the job via `by_job_processable.take(limit)`.
3. Slice the requested page in memory.
4. Load `extractionResults.by_paper` and `extractionResultReviews.by_paper` only for the sliced paper IDs.
5. Return rich page rows.

This is already a major improvement over the current query, because it removes whole-job result/review fan-out from the read set for the page query.

### 3. UI contract

- `<ResultsToolbar>` stops receiving the loaded-array length as "total".
- `<SmartPagination>` receives:
  - `totalCount` = authoritative corpus size
  - `filteredCount` = current displayed corpus size (temporarily same as total in plan 01)
  - `displayedCount` = current page length
- The page shell exposes `data-results-scope="full"` for the unfiltered baseline query so tests can assert truthfully.

## Files touched

- `convex/extraction/queries/results.ts`
- `convex/extraction/queries.ts`
- `convex/extraction/validators.ts`
- `app/extraction/[jobId]/page.tsx`
- `components/extraction/results-toolbar.tsx`
- `components/extraction/smart-pagination.tsx`
- `app/extraction/[jobId]/__tests__/page.test.tsx`
- query-routing/e2e tests if they enumerate exports

## Test plan

### Test-first

Extend `app/extraction/[jobId]/__tests__/page.test.tsx`:

1. Seed a 293-paper job with only 200 rows on the first page.
2. Assert the toolbar says `200 of 293 papers` (localized equivalent acceptable).
3. Assert `role="progressbar"` still reports `aria-valuemax="293"`.
4. Assert page navigation can reach the remaining rows.

### Test-after

Convex query test:

1. Seed >200 processable papers.
2. Call page 2.
3. Assert rows `201..N` are returned and `totalAll` is the full corpus size.

## Acceptance criteria

1. No `loadMore(200)` effect remains in `page.tsx`.
2. No results surface uses the loaded-array length as the authoritative total.
3. The page can render rows beyond 200.
4. The query no longer calls `loadResultsByJob` / `loadReviewsByJob` for the page surface.

