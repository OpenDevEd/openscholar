# Extraction Results Correctness + Reactive Scale — Plan Set

Four-plan rework of the extraction job detail results surface so it is:

1. **truthful** — no more `200 of 200` lies on a 293-paper job,
2. **complete** — page 2+ actually exists,
3. **full-corpus correct** — filters/sorts/export work against the whole job at all times,
4. **cheap enough** for the enforced ceiling of **1000 papers × 50 questions**.

---

## Motivation

Empirical state of the extraction results surface as of this plan set (verified against source, not speculation):

1. **Hard 200-row ceiling.** `app/extraction/[jobId]/page.tsx:200-223` mounts `useProtectedPaginatedQuery(..., { initialNumItems: 200 })` and then refuses to call `loadMore` once `allPapers.length >= 200`. A 293-paper job never loads page 2.
2. **Toolbar denominator lies.** `page.tsx:1018` passes `papersWithResults.length` into `<ResultsToolbar>`, and `components/extraction/results-toolbar.tsx:234-235` renders it as the total. The progress bar is correct because it uses job counters from `subscribeToJobProgress`.
3. **The "paginated" Convex query still reads the whole job's child rows.** `convex/extraction/queries/results.ts:121-146` paginates `extractionPapers`, then immediately calls `loadReviewsByJob` and `loadResultsByJob` from `convex/extraction/queries/_shared.ts`. Those helpers read up to **50k reviews** and **50k results** for the job.
4. **Client filters/sorts are only as correct as the loaded array.** `page.tsx:240-280` preprocesses, filters, and sorts the loaded rows in the browser. That is fundamentally incompatible with the product requirement that filters/export must work against the whole job all the time.
5. **"Export all" is also tied to the loaded client rows.** `page.tsx:1132` passes `sortedPapers` into `<ExportDialog>` for export-all. That is wrong as soon as the browser does not own the full filtered corpus.

## Design decisions (locked)

| # | Decision | Why |
|---|---|---|
| **D1** | **Split summary reactivity from list reactivity.** Keep `getJobDetails` / `subscribeToJobProgress` for header/progress/counts. | The job row is cheap and already authoritative. |
| **D2** | **Replace the results hook with a server page query.** The page stops using `useProtectedPaginatedQuery` for results. | Cursor-loading 200-paper chunks in the browser is the root of the lie. |
| **D3** | **Add additive per-paper projection fields on `extractionPapers`.** | Full-corpus filter/sort must not depend on rereading 50k child rows. |
| **D4** | **Projection maintenance happens on writes, not reads.** `recordOneAnswer`, `recordOneAnswerFailure`, `setResultReviewState`, and paper-status writes keep the projection current. | Reactivity cost is determined by the query read set. |
| **D5** | **`getJobResultsPage` scans bounded paper projections, then loads full result/review rows only for the visible page.** | This shrinks the read set from whole-job results to visible-page results. |
| **D6** | **Export-all moves server-side.** Client export helpers stay, but the full filtered dataset is fetched from Convex first. | Full-corpus correctness. |
| **D7** | **No virtualization in this plan set.** Server paging keeps the mounted row count bounded. | Virtualization would treat the symptom, not the Convex read set. |

## Plan files

```text
plans/extraction-results-scale/
├── 00-README.md
├── 01-truthful-counts-and-page-query.md
├── 02-paper-list-projection.md
├── 03-server-filters-sort-and-page-ui.md
├── 04-export-cleanup-and-tests.md
└── PROMPTS.md
```

## Dependency graph

```text
01 truthful-counts + page-query ─┬─► 02 paper-list-projection ─► 03 server filters/sort/page UI ─► 04 export + cleanup + tests
                                 └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Ship order recommendation: **01 → 02 → 03 → 04**.

## Reuse (DRY)

These plans deliberately reuse existing project primitives:

- `convex/extraction/queries/jobs.ts` — cheap authoritative progress counters.
- `convex/extraction/mutations/results.ts` / `paperLifecycle.ts` — the write paths that already know when paper/result state changes.
- `lib/extraction/export.ts` — file generation stays client-side.
- `app/extraction/[jobId]/__tests__/page.test.tsx` — the canonical page behavior test bed.
- `components/extraction/results-toolbar.tsx` + `components/extraction/smart-pagination.tsx` — keep the surfaces, fix the data contract.

## Testing doctrine

Follow the project testing rules:

- Assert on text, ARIA, and `data-*`.
- Never assert on Tailwind classes or inline styles.
- Push pure logic (projection builders / answer-token normalizers) into `lib/**.test.ts` or small focused Convex unit tests.

## Migration stance

- Schema changes are **additive only**.
- No mandatory data migration is required for deployment.
- Existing dev jobs created before the projection fields exist can be regenerated or repaired with a bounded internal helper added in plan 04.
- No legacy runtime fallback query path should remain after the plan set lands.

## Sources

- `app/extraction/[jobId]/page.tsx`
- `components/extraction/results-toolbar.tsx`
- `components/extraction/smart-pagination.tsx`
- `components/extraction/export-dialog.tsx`
- `lib/extraction/filtering.ts`
- `convex/extraction/queries/results.ts`
- `convex/extraction/queries/_shared.ts`
- `convex/extraction/queries/jobs.ts`
- `convex/extraction/mutations/results.ts`
- `convex/extraction/paperLifecycle.ts`
- `convex/schema.ts`
- Convex docs:
  - `https://docs.convex.dev/database/pagination`
  - `https://docs.convex.dev/database/reading-data`
  - `https://docs.convex.dev/functions/query-functions`
  - `https://docs.convex.dev/components`
  - `https://docs.convex.dev/understanding/best-practices`

