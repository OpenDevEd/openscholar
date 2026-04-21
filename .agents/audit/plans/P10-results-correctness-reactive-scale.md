# P10 — Extraction Results Correctness + Reactive Scale

**Intended reader:** an autonomous coding agent picking this up cold. You have not seen the conversation. Everything you need is linked below.

---

## 1. Mission

Fix the extraction job detail page so it is both **truthful** and **scalable** at the real product ceiling of **1000 papers × 50 questions**.

The concrete bugs are already known:

1. The results table silently stops at 200 papers on a 293-paper job.
2. The toolbar lies and says `200 of 200 papers` because it uses the clamped client array as the denominator.

The deeper architectural problem is more serious:

- The page pretends to paginate papers, but the query still batch-loads **all** `extractionResults` and **all** `extractionResultReviews` for the whole job on every page fetch (`convex/extraction/queries/results.ts`, `convex/extraction/queries/_shared.ts`).
- The toolbar filters and sorts the **loaded client array**, which means correctness depends on how many rows the browser happened to load.

This plan replaces that with a design that:

1. Keeps the **job header / progress bar / totals** on a cheap reactive query that only depends on `extractionJobs`.
2. Moves the **results list** to a dedicated server-side page query with **full-corpus filter/sort semantics**.
3. Shrinks the reactive read set for the list from **whole-job results** to:
   - bounded per-paper projection rows across the job, and
   - full result/review rows for the **visible page only**.
4. Preserves export correctness by moving "export all filtered papers" to the server as well.

Explicitly in scope:

1. Truthful denominator in toolbar and pagination summary.
2. Removal of the 200-row ceiling bug.
3. Replacement of faux-pagination with a page query that returns any page from the full result set.
4. Server-side filtering and sorting so filters work against the whole job at all times.
5. Additive schema/index changes only; no mandatory data migration for the live dev deployment.
6. Test coverage based on text / ARIA / `data-*`, never Tailwind class strings.

Explicitly out of scope:

1. Review queue perf (`convex/extraction/queries/reviews.ts`) — it still full-loads the job, but it is a separate surface and separate query contract.
2. Insights / report-builder query perf — same reason.
3. Redesign of table/cards/split layouts beyond whatever is required to consume the new query shape.
4. Virtualization. With server-side paging, the page no longer needs to render 1000 rows at once. Do not add `react-window`; if any view still needs virtualization later, reuse the existing `@tanstack/react-virtual` pattern already present in `components/extraction/chat/sources-panel/sources-panel-list.tsx`.

---

## 2. Hard rules (from `CLAUDE.md` + user directives)

1. **DRY.** Reuse existing patterns before inventing new ones:
   - Cheap job-level progress query: `convex/extraction/queries/jobs.ts:130-149`
   - Existing TanStack Virtual pattern: `components/extraction/chat/sources-panel/sources-panel-list.tsx`
   - Existing behavior-first testing doctrine: root `AGENTS.md` + `CLAUDE.md`
   - Existing export helpers: `lib/extraction/export.ts`
2. **No legacy compatibility layer.** This is pre-release. Do not keep both the old client-only filter pipeline and the new server-side one. Delete the dead path in the same commit that replaces it.
3. **No dead code.** When the page stops using `useProtectedPaginatedQuery` for results, remove the 200-item auto-load effect and any now-dead client filtering/preprocessing helpers or narrow them to the surfaces that still use them.
4. **Convex docs override memory.** Read the live docs before touching the query shape:
   - https://docs.convex.dev/database/pagination
   - https://docs.convex.dev/database/reading-data
   - https://docs.convex.dev/functions/query-functions
   - https://docs.convex.dev/components
   - https://docs.convex.dev/understanding/best-practices
5. **Bound every query.** No unbounded `.collect()` on full result sets. If a query must scan the job corpus, it is bounded by the enforced job cap `PAPER_LIMIT_MAX` / `PAPER_LIMIT_BY_PLAN` and it must avoid loading all child result rows.
6. **Behavioral tests only.** Assert on:
   - visible text (`293 of 293 papers`, etc.)
   - `role="progressbar"` / `aria-valuenow` / `aria-valuemax`
   - stable `data-*` hooks such as `data-results-scope`, `data-total-papers`, `data-filtered-papers`
   Never assert on class names or Tailwind tokens.
7. **Destructive mindset.** If a public query signature changes, co-migrate every caller immediately. Do not leave a deprecated alias.

---

## 3. Required reading (before touching code)

Read in this order:

1. `CLAUDE.md` and the repo-root `AGENTS.md` instructions.
2. `convex/_generated/ai/guidelines.md`
3. `app/extraction/[jobId]/page.tsx`
   - pagination hook + 200 guard: `176-223`
   - client filter/sort pipeline: `240-310`
   - progress source selection: `483-500`
   - results toolbar wiring: `1009-1029`
   - pagination wiring: `1107-1117`
   - export wiring: `1129-1143`
4. `components/extraction/results-toolbar.tsx`
5. `components/extraction/smart-pagination.tsx`
6. `components/extraction/export-dialog.tsx`
7. `lib/extraction/filtering.ts`
8. `convex/extraction/queries/results.ts`
9. `convex/extraction/queries/_shared.ts`
10. `convex/extraction/queries/jobs.ts`
11. `convex/extraction/mutations/results.ts`
12. `convex/extraction/paperLifecycle.ts`
13. `convex/extraction/mutations/papers.ts`
14. `convex/schema.ts`
   - `extractionPapers`: `559-625`
   - `extractionResults`: `676-754`
   - `extractionResultReviews`: `759-782`
15. `convex/extraction/bucket/limits.ts`
16. `convex/extraction/validators.ts`
17. `app/extraction/[jobId]/__tests__/page.test.tsx`

Upstream docs to cite in implementation notes / PR summary:

1. Convex query caching/reactivity/consistency: `https://docs.convex.dev/functions/query-functions`
2. Convex paginated query semantics and status values: `https://docs.convex.dev/database/pagination`
3. Convex best practice on avoiding large `.collect()` reads / reruns: `https://docs.convex.dev/understanding/best-practices`

---

## 4. Research summary (what the audit found)

### 4a. The user-visible bug is exactly where reported

- `app/extraction/[jobId]/page.tsx:200-203` mounts `useProtectedPaginatedQuery(..., { initialNumItems: 200 })`.
- `app/extraction/[jobId]/page.tsx:214-223` auto-calls `loadMore(200)` only while `allPapers.length < 200`.
- Result: a 293-paper job never fetches page 2.

### 4b. The denominator lie is also exactly where reported

- `app/extraction/[jobId]/page.tsx:1018` passes `totalCount={papersWithResults.length}` into `<ResultsToolbar>`.
- `components/extraction/results-toolbar.tsx:234-235` renders `filteredOfTotal(filteredCount, totalCount)`.
- `app/extraction/[jobId]/page.tsx:1114` passes the same client-clamped `totalCount` into `<SmartPagination>`.
- Meanwhile the progress bar uses the authoritative job counters via `subscribeToJobProgress` / `getJobDetails.progress` (`page.tsx:483-500`), which is why it correctly shows 293.

### 4c. The current "paginated" query is not actually cheap

`convex/extraction/queries/results.ts:121-146` paginates `extractionPapers`, but then immediately calls:

- `loadReviewsByJob(ctx, jobId)` from `_shared.ts:105-116`
- `loadResultsByJob(ctx, jobId)` from `_shared.ts:163-179`

Those helpers read the whole job:

- up to `MAX_REVIEWS_PER_JOB = 50_000` reviews (`convex/lib/queryBounds.ts:17-21`)
- up to `PAPER_LIMIT_MAX * MAX_QUESTIONS_PER_JOB` results = `1000 * 50 = 50_000` (`_shared.ts:156-170`, `validators.ts:53`)

So one answer change can currently invalidate a query that depends on the full child-row set for the job.

### 4d. The page does whole-array CPU work after every reactive update

`app/extraction/[jobId]/page.tsx:240-280`:

1. memo-casts all loaded rows
2. preprocesses every loaded paper
3. filters every loaded paper
4. sorts every loaded paper
5. slices the current page in JS

This makes render cost track the size of the loaded array instead of the visible page.

### 4e. The existing client export path is tied to the loaded array

`app/extraction/[jobId]/page.tsx:1132` passes `sortedPapers` into `<ExportDialog>` for "all".
That is only correct if the browser has the full filtered corpus. Under the new architecture, export must move to a server query/action that applies the same filters.

### 4f. Convex docs support the chosen split

The live docs state:

1. Queries are cached and reactive based on their read set.
2. Paginated queries are fully reactive.
3. Large result sets should avoid whole-result `.collect()` reads; if any document in the result changes, the query reruns.

That means the real optimization target is the **read set**, not just the DOM node count.

### 4g. `extractionPapers` already changes during active extraction

`convex/extraction/mutations/results.ts:307-313` patches `extractionPapers.creditsUsed` on every successful answer.
`convex/extraction/paperLifecycle.ts:113` patches `extractionPapers` on terminal transitions.

So adding small, additive projection fields to `extractionPapers` does **not** create a brand-new hot document; the row already participates in the write path.

---

## 5. Architectural decisions (locked)

### 5a. Split summary reactivity from list reactivity

Keep:

- `getJobDetails` for static-ish job metadata + question list
- `subscribeToJobProgress` for cheap, authoritative job counters

The results table / cards / split view no longer derive truth from the size of the loaded client array.

### 5b. Replace client-side full-corpus filtering with a server page query

The page stops using `useProtectedPaginatedQuery` for results.
Instead it uses a new protected query:

```ts
api.extraction.queries.getJobResultsPage({
  jobId,
  page,
  pageSize,
  filters,
  sortBy,
})
```

It returns:

```ts
{
  status: "ok",
  totalAll: number,        // authoritative total papers in corpus
  totalFiltered: number,   // full-corpus count after filters
  totalPages: number,
  page,
  pageSize,
  items: PaperWithResults[],
}
```

This is a deliberate public signature change. Call sites to co-migrate:

1. `app/extraction/[jobId]/page.tsx`
2. `app/extraction/[jobId]/__tests__/page.test.tsx`
3. any query-routing tests that enumerate public exports (`convex/extraction/queries.ts`, `public-api-routing.test.ts`, `queries-e2e.test.ts`)

### 5c. Add bounded per-paper list projection fields to `extractionPapers`

Additive optional fields on `extractionPapers`, maintained by write-side helpers:

- `sortTitle: string`
- `avgConfidence: number`
- `reviewedCount: number`
- `needsFollowupCount: number`
- `hasErrors: boolean`
- `hasPdfSource: boolean`
- `questionAnswerTokens: string[]`
- `searchText: string`

Also add a search index on `searchText` filtered by `jobId`.

Rationale:

1. Full-corpus filter/sort must work even when only one page is visible.
2. Reading all 50k `extractionResults` rows on every list update is the wrong tradeoff.
3. Reading at most 1000 compact paper projection rows, then loading full result/review rows only for the visible page, is the right tradeoff under the enforced job cap.

### 5d. Projection maintenance lives on the write path, not the read path

Create a shared helper such as:

```ts
recomputePaperListProjection(ctx, paperId)
```

It reads:

- one `extractionPapers` row
- up to 50 `extractionResults` rows for that paper
- up to 50 `extractionResultReviews` rows for that paper

and patches the additive projection fields on the paper row.

Call it from:

1. `recordOneAnswer`
2. `recordOneAnswerFailure`
3. `setResultReviewState`
4. paper-status mutations that alter `status`, PDF/source availability, or error state (`paperLifecycle.ts`, `mutations/papers.ts`)

Do **not** build projection state lazily inside the read query.

### 5e. The new list query reads the full corpus cheaply, then hydrates the visible page richly

`getJobResultsPage` does this:

1. Read the candidate paper corpus:
   - search index when `filters.searchQuery` is non-empty
   - otherwise `by_job_processable`
2. Apply the remaining filters/sort in code over the bounded paper projection rows.
3. Slice the requested page.
4. Load `extractionResults.by_paper` and `extractionResultReviews.by_paper` only for the visible paper IDs.
5. Return rich `PaperWithResults[]` only for the visible page.

This is the core optimization. The query may still reread up to 1000 compact projection rows on each change, but it no longer depends on all 50k child rows.

### 5f. Export moves server-side

Keep the existing client file-generation helpers (`exportToCSV`, `exportToJSON`, `exportToExcel`) but stop feeding them `sortedPapers` from the page.

New flow:

1. Dialog keeps format/options UI client-side.
2. "Export all filtered" calls a dedicated server query/action with the same `filters` / `sortBy`.
3. The client receives the full filtered paper set and hands it to the existing export helpers.

Selected-row export can stay client-side because selected rows are already concrete and bounded.

### 5g. No virtualization in P10

Once paging is server-side and page size is bounded (`25/50/100/200`), the page no longer needs to render 1000 rows at once.

Do not introduce list virtualization in this plan.

---

## 6. Task list

Ordered. Later tasks depend on earlier. Each is an atomic commit with a green test suite. Commit message prefix `T10.<n>`.

### Task 1 — Lock the regression with truthful-count tests

**Why.** The bug needs to be reproducible in tests before the architecture changes.

**Test first.** Extend `app/extraction/[jobId]/__tests__/page.test.tsx`:

1. Seed a job with `job.totalPapers = 293`.
2. Mock the results source so only 200 rows are currently present.
3. Assert:
   - toolbar renders `200 of 293 papers` (or equivalent localized text)
   - progressbar keeps `aria-valuemax="293"`
   - page exposes a stable partial/full hook such as `data-results-scope="partial"`

No class assertions.

**Implementation.**

1. Stop passing `papersWithResults.length` as the authoritative total.
2. Thread `resolvedProgress.total` / `job.totalPapers` through the toolbar and pagination summary.
3. Add a stable `data-results-scope` / `data-total-papers` hook on the shell or toolbar badge.

**Done when.** The test fails before the change and passes after it.

---

### Task 2 — Replace faux pagination with a page query that loads all papers but only page-local child rows

**Why.** This removes the 200-row correctness bug and immediately collapses the read set from whole-job results/reviews to page-local results/reviews.

**Implementation.**

1. Add `getJobResultsPage` in `convex/extraction/queries/results.ts`.
2. Initial version:
   - reads all processable papers for the job via `by_job_processable.take(limit)`
   - sorts by corpus order
   - slices `{ page, pageSize }`
   - loads `results` + `reviews` **only for the sliced paper IDs**
3. Update `convex/extraction/queries.ts` exports and validators.
4. Replace the page’s results hook in `app/extraction/[jobId]/page.tsx`:
   - remove `useProtectedPaginatedQuery`
   - remove the `loadMore(200)` effect
   - derive displayed rows directly from query response rather than slicing the loaded array in the client

**Tests.**

1. New Convex query test: page 2 of a 293-paper job returns rows 201-293.
2. Page test: navigating to page 2 shows the remaining rows instead of a hard stop at 200.

**Done when.** The visible missing-rows bug is gone without yet changing filter/sort semantics.

---

### Task 3 — Add additive paper-list projection fields + write-side recompute helper

**Why.** Full-corpus filters cannot depend on 50k child rows. The list query needs compact per-paper filter/sort state.

**Schema changes (additive only).**

In `convex/schema.ts`, add optional fields to `extractionPapers`:

1. `sortTitle`
2. `avgConfidence`
3. `reviewedCount`
4. `needsFollowupCount`
5. `hasErrors`
6. `hasPdfSource`
7. `questionAnswerTokens`
8. `searchText`

And add a search index, e.g.:

```ts
.searchIndex("search_by_job_text", {
  searchField: "searchText",
  filterFields: ["jobId", "processable"],
})
```

These are additive optional fields, so the deployment does **not** need a schema migration.

**Implementation.**

1. Create a shared helper module, e.g. `convex/extraction/listProjection.ts`.
2. Implement:
   - answer normalization for `questionAnswerTokens`
   - capped search-text builder
   - `recomputePaperListProjection(ctx, paperId)`
3. Call the helper from:
   - `recordOneAnswer`
   - `recordOneAnswerFailure`
   - `setResultReviewState`
   - `markPaperTerminalTx` or the paper mutation layer when paper error/PDF/source state changes

**Tests.**

1. New mutation-level tests proving:
   - successful answer updates `avgConfidence`, `questionAnswerTokens`, `searchText`
   - failed answer updates `hasErrors`
   - review mutation updates `reviewedCount` / `needsFollowupCount`

**Done when.** Each relevant write path leaves the paper row queryable for list filtering without reading whole-job results.

---

### Task 4 — Move full-corpus filter/sort semantics to Convex

**Why.** The user requirement is explicit: filters must work all the time, not only after the client has loaded every row.

**Implementation.**

Expand `getJobResultsPage` args to include:

1. `filters`
2. `sortBy`

Algorithm:

1. Candidate set:
   - search index when search text exists
   - otherwise `by_job_processable`
2. In-code filters over bounded paper projections:
   - confidence range via `avgConfidence`
   - status flags via `hasPdfSource`, `hasErrors`, `pdfContentUsed`, `isOpenAccess`, `reviewedCount`, `needsFollowupCount`
   - question equality via `questionAnswerTokens`
3. In-code sort:
   - default corpus order
   - `title-asc` / `title-desc` via `sortTitle`
   - `confidence-high` / `confidence-low` via `avgConfidence`
4. Slice requested page.
5. Load full result/review rows only for that slice.

`app/extraction/[jobId]/page.tsx` then deletes the client full-corpus pipeline:

- remove `preprocessPapers(...)`
- remove `filterPapers(...)`
- remove client confidence/title sort over the loaded array
- keep only page-local selection / view-mode / citation-panel logic

**Tests.**

1. Convex query tests for:
   - search
   - confidence range
   - reviewed / needs-followup
   - question filter
   - title/confidence sort
2. Page tests proving the visible filtered count comes from the server and stays correct even when only one page is mounted.

**Done when.** Toolbar semantics are full-corpus and no longer depend on browser-loaded rows.

---

### Task 5 — Move “export all filtered” to the server

**Why.** Once list paging is server-driven, the client no longer owns the full filtered dataset.

**Implementation.**

1. Add `getJobResultsForExport({ jobId, filters, sortBy })` or equivalent.
2. It reuses the same projection-driven filtering/sorting path as `getJobResultsPage`, but returns the full filtered set.
3. Update `ExportDialog` so:
   - selected export still receives concrete client rows
   - all-filtered export fetches from Convex before calling `exportToCSV` / `exportToJSON` / `exportToExcel`

**Tests.**

1. Dialog test or page test that “export all” no longer relies on the current page rows.
2. Convex query test that export count matches `totalFiltered`.

**Done when.** “Export all” means the full filtered corpus, not “whatever page rows happen to be mounted”.

---

### Task 6 — Cleanup, dead-code deletion, and dev repair hook

**Why.** The old architecture leaves dead helpers behind unless explicitly removed.

**Implementation.**

1. Remove dead code:
   - 200-row auto-load effect
   - any now-unused client preprocessing/filter helpers
   - obsolete paginated results tests/mocks
2. Add an internal/dev-only repair helper for pre-plan jobs, e.g.:

```ts
internal.extraction.mutations.internal.admin.rebuildJobListProjection({ jobId })
```

This is **not** a migration. It is a bounded repair utility for existing dev fixtures/jobs created before the projection fields existed.

**Done when.** No dead list path remains, and old dev jobs can be repaired without keeping a legacy read fallback.

---

## 7. Migration & destructiveness checklist

1. Schema changes are additive only:
   - optional fields on `extractionPapers`
   - one new search index on `extractionPapers`
2. No data migration is required for the live dev deployment.
3. Existing pre-plan jobs may have missing projection fields.
   - Do **not** add a permanent runtime fallback query path.
   - Use the internal repair helper or regenerate the job in dev.
4. Public query signature change:
   - `getJobResultsPaginated` is replaced by `getJobResultsPage` or its signature is changed materially.
   - Co-migrate every call site in the same commit.
5. Delete dead exports from `convex/extraction/queries.ts` as soon as callers move.

---

## 8. Files inventory

Expected touch list:

1. `app/extraction/[jobId]/page.tsx`
2. `app/extraction/[jobId]/__tests__/page.test.tsx`
3. `components/extraction/results-toolbar.tsx`
4. `components/extraction/smart-pagination.tsx`
5. `components/extraction/export-dialog.tsx`
6. `lib/extraction/filtering.ts`
7. `convex/schema.ts`
8. `convex/extraction/queries/results.ts`
9. `convex/extraction/queries/_shared.ts`
10. `convex/extraction/queries.ts`
11. `convex/extraction/validators.ts`
12. `convex/extraction/mutations/results.ts`
13. `convex/extraction/paperLifecycle.ts`
14. `convex/extraction/mutations/papers.ts`
15. `convex/extraction/mutations/internal/admin.ts`
16. new helper module for list projection (`convex/extraction/listProjection.ts` or similar)
17. new Convex tests for list-page / projection behavior

Potentially touched if types are shared:

1. `lib/extraction/types.ts`
2. `lib/extraction/export.ts`
3. `convex/extraction/public-api-routing.test.ts`
4. `convex/extraction/queries-e2e.test.ts`

---

## 9. Test strategy

### UI

1. `app/extraction/[jobId]/__tests__/page.test.tsx`
   - truthful `filtered of total`
   - partial/full results-scope hooks
   - correct page navigation beyond 200
   - export-all path does not assume mounted rows

### Convex query correctness

1. New tests for `getJobResultsPage`
   - page slicing
   - total counts
   - filter correctness
   - sort correctness
2. New tests for `getJobResultsForExport`
   - export size equals `totalFiltered`

### Convex write-side projection maintenance

1. `recordOneAnswer`
2. `recordOneAnswerFailure`
3. `setResultReviewState`
4. paper terminal/error transitions

### Verification notes

1. Never assert on class strings.
2. Prefer visible text, ARIA, and `data-*`.
3. Run the page against an active extraction in dev and verify:
   - progress counters tick without the results query reading all 50k child rows
   - page 2+ works on jobs over 200 papers
   - filters stay correct even when page size is 25

---

## 10. Open items (flag to user before starting)

1. None required to start. The product requirement is already locked:
   - filters must work against the full job at all times
   - correctness beats the old client-loaded-array semantics
2. Implementation note only:
   - if `searchText` threatens to become too large from reasoning + citation quotes, cap it deterministically in the projection builder rather than falling back to whole-result reads.

