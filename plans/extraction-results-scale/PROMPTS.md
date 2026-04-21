# Extraction Results Correctness + Reactive Scale — Execution Prompts

One copy-paste prompt per plan, designed for a fresh session.

---

## Plan 01 — Truthful Counts + Server Page Query Foundation

```text
Execute `plans/extraction-results-scale/01-truthful-counts-and-page-query.md` top to bottom.

Start with tests:
- extend `app/extraction/[jobId]/__tests__/page.test.tsx` to lock the `200 of 293` bug and page-2 behavior
- add the Convex query test for `getJobResultsPage`

Then implement:
- `getJobResultsPage`
- remove `useProtectedPaginatedQuery` for the results surface
- remove the `loadMore(200)` effect
- thread authoritative totals into `ResultsToolbar` and `SmartPagination`

Acceptance criteria are in the plan file. Do not leave any code path that still treats `papersWithResults.length` as the total corpus size.
```

---

## Plan 02 — Add Paper List Projection Fields + Write-Side Maintenance

```text
Execute `plans/extraction-results-scale/02-paper-list-projection.md`.

Order:
1. Add the optional projection fields + search index to `extractionPapers`.
2. Create the shared `recomputePaperListProjection(ctx, paperId)` helper.
3. Wire it into:
   - `recordOneAnswer`
   - `recordOneAnswerFailure`
   - `setResultReviewState`
   - paper lifecycle / paper status mutations
4. Add focused tests proving projection maintenance works.

Do not add lazy read-time projection computation. This plan is write-side only.
```

---

## Plan 03 — Server Filters/Sort + Page UI Cutover

```text
Execute `plans/extraction-results-scale/03-server-filters-sort-and-page-ui.md`.

Order:
1. Expand `getJobResultsPage` to take `filters` and `sortBy`.
2. Implement full-corpus filtering/sorting over the bounded paper projections.
3. Load full result/review rows only for the visible page.
4. Delete the old client full-corpus filter/sort pipeline from `app/extraction/[jobId]/page.tsx`.
5. Update page/query tests.

Non-negotiable: filters must be full-corpus correct even when page size is 25 and the browser only has one page mounted.
```

---

## Plan 04 — Export-All, Cleanup, Repair Hook, Final Verification

```text
Execute `plans/extraction-results-scale/04-export-cleanup-and-tests.md`.

Order:
1. Add the server export query/action for the full filtered corpus.
2. Update `ExportDialog` / page wiring so export-all no longer depends on the current page rows.
3. Add the bounded internal repair helper for pre-plan jobs.
4. Delete dead results-list code.
5. Run the final query/page verification sweep and do a manual smoke on a >200-paper job.

Do not keep any legacy runtime fallback path after cleanup.
```

