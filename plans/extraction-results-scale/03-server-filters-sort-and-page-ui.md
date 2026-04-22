# Plan 03 — Server Filters/Sort + Page UI Cutover

**Depends on:** 01, 02. **Blocks:** 04.

## Goal

Make the results toolbar, pagination summary, and visible rows operate on the **full job corpus** at all times, not just the currently loaded browser array.

This is the plan that satisfies the product requirement:

> filters should work all the time

## Scope

**In scope**

- Expand `getJobResultsPage` to accept `filters` and `sortBy`.
- Implement full-corpus filter/sort over the bounded paper projection rows.
- Load full `results` only for the visible page slice.
- Delete the old client full-corpus preprocessing/filter/sort pipeline from `page.tsx`.
- Keep page-number pagination in the UI.

**Out of scope**

- Export-all path (plan 04).

## Design

### 1. Query contract

```ts
getJobResultsPage({
  jobId,
  page,
  pageSize,
  filters,
  sortBy,
})
```

Returns:

```ts
{
  status: "ok",
  totalAll: number,
  totalFiltered: number,
  totalPages: number,
  page: number,
  pageSize: number,
  items: PaperWithResults[],
}
```

This is a deliberate public API change. Co-migrate every caller immediately.

### 2. Query algorithm

1. Candidate papers:
   - when `searchQuery` exists: `extractionPapers.search_by_job_text`
   - otherwise: `extractionPapers.by_job_processable`
2. Filter over bounded paper projections:
   - confidence range via `avgConfidence`
   - status flags via projection booleans + existing paper fields
   - question equality via `questionAnswerTokens`
3. Sort:
   - default corpus order
   - title asc/desc via `sortTitle`
   - confidence high/low via `avgConfidence`
4. Slice requested page.
5. Load full result rows only for the sliced paper IDs.

### 3. UI cutover

In `app/extraction/[jobId]/page.tsx`:

- delete `preprocessPapers(...)`
- delete `filterPapers(...)`
- delete client title/confidence sorting over the full loaded array
- stop slicing `sortedPapers` in the browser
- bind toolbar + pagination directly to server counts

`lib/extraction/filtering.ts` should either:

1. be narrowed to page-local helpers only, or
2. be deleted if nothing real still uses it.

Do not leave the old client full-corpus path behind.

## Files touched

- `convex/extraction/queries/results.ts`
- `convex/extraction/queries.ts`
- `convex/extraction/validators.ts`
- `app/extraction/[jobId]/page.tsx`
- `components/extraction/results-toolbar.tsx`
- `components/extraction/smart-pagination.tsx`
- `lib/extraction/filtering.ts`
- page/query tests

## Test plan

### Test-first

New query tests for:

1. search
2. confidence range
3. question equality filters
4. title sort
5. confidence sort

### Test-after

Page-level behavior tests:

1. toolbar filtered-count reflects the server response
2. changing filters changes `totalFiltered` even on page 1 / page size 25
3. pagination summary remains truthful
4. `data-results-scope="full"` still indicates full-corpus correctness, not full client hydration

## Acceptance criteria

1. Filters operate against the whole job, not the mounted rows.
2. The page no longer recomputes full-corpus preprocessing/filter/sort in the browser.
3. The results query’s child-row reads are limited to the visible page.
4. Query signature changes are fully co-migrated.
