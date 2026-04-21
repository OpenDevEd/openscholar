# Plan 03 — Enrichment Cache + Export Polish

**Depends on:** nothing. **Blocks:** nothing. (Independent of plans 01 and 02.)

## Goal

Three targeted fixes to the export-path data layer:

1. **Cross-page enrichment cache** — the `fetchAll` export loop re-fetches the same papers and jobs every time they appear on a page. For a 10k-row export with ~500 unique papers/jobs spread across 20 × 500-row pages, the cost is ~80 queries instead of the optimum ~24 (1 base + 3 enrichment batches per page, collapsed to 1 + lookups for only novel ids).
2. **Filter-aware "Export current view"** — the current `fetchAll` passes only `{ jobId }` to the server and post-filters on the client. "Export current view" is a misnomer. Pass the actual UI filter state to the server so the download reflects what the user sees.
3. **AbortController on export** — if the user navigates away mid-export, the loop keeps iterating, results pile into a dead array, and a stale `.finally(setLoading(false))` runs against an unmounted component. Wire a cancel signal.

Implements decisions **D11**, **D12**, **D13**.

## Scope

**In scope**

- New pure-logic module `lib/billing/transactions/enrichment-cache.ts` — `createEnrichmentCache()` returning an object with `getPaper(id)`, `getJob(id)`, `recordPaperResolved(id, title)`, `recordJobResolved(id, name)`, and a `selectUnresolved` helper. Unit-tested.
- `components/billing/transactions/transactions-panel-client.tsx:fetchAll` — accepts `AbortSignal`, passes current UI filter state, iterates with a cross-page cache.
- `components/billing/transactions/transactions-export-menu.tsx:exportAll` — creates an `AbortController` stored in a ref, aborts on unmount.
- New Convex query `api.credits.queries.listTransactionsPaginatedRaw` — same as `listTransactionsPaginated` but **without** enrichment. The client-side cache fans out enrichment separately, reusing resolved ids across pages.
- New Convex query `api.credits.queries.resolveTransactionEnrichments` — takes arrays of `paperIds` / `openalexIds` / `jobIds` and returns the titles/names. Single round-trip per export, called with only the novel ids per page.
- Tests: `enrichment-cache.test.ts` (pure logic); extended export menu test asserting abort behavior.

**Out of scope**

- Server-side streaming CSV HTTP action (future; current approach is acceptable up to ~100k rows).
- `getLatestGrantStatus` optimization (per `00-README.md` §D15 — out of plan-set scope).
- Any UI change to the export menu beyond the abort wiring.

## Design

### 1. `lib/billing/transactions/enrichment-cache.ts`

Pure logic. No Convex dependency. Two `Map<Id, string>` backing stores plus helpers.

```ts
import type { Id } from "@/convex/_generated/dataModel";

export interface EnrichmentCache {
  /** Returns null if unresolved, the cached title otherwise. */
  getPaperTitle(paperId: Id<"extractionPapers">): string | null | undefined;
  /** Returns null if unresolved, the cached title otherwise. */
  getPaperTitleByOpenalex(openalexId: string): string | null | undefined;
  /** Returns null if unresolved, the cached name otherwise. */
  getJobName(jobId: Id<"extractionJobs">): string | null | undefined;

  recordPaperResolved(id: Id<"extractionPapers">, title: string): void;
  recordPaperNotFound(id: Id<"extractionPapers">): void;
  recordPaperByOpenalexResolved(openalexId: string, title: string): void;
  recordPaperByOpenalexNotFound(openalexId: string): void;
  recordJobResolved(id: Id<"extractionJobs">, name: string): void;
  recordJobNotFound(id: Id<"extractionJobs">): void;

  /**
   * Given the ids visible in the next page, return only the ids that are
   * not yet resolved (neither as "found" nor "not found") — so we only
   * round-trip for novel ids.
   */
  selectUnresolved(args: {
    paperIds: Iterable<Id<"extractionPapers">>;
    openalexIds: Iterable<string>;
    jobIds: Iterable<Id<"extractionJobs">>;
  }): {
    paperIds: Id<"extractionPapers">[];
    openalexIds: string[];
    jobIds: Id<"extractionJobs">[];
  };
}

export function createEnrichmentCache(): EnrichmentCache;
```

Encoding: `undefined` = unknown, `null` = resolved-but-missing (paper/job deleted), `string` = resolved-with-value. The three states let us avoid re-querying something we already failed to find.

### 2. Convex queries

#### `api.credits.queries.listTransactionsPaginatedRaw`

Identical shape to `listTransactionsPaginated` — same args, same index routing — but returns `Doc<"creditTransactions">` (no `paperTitle`, `jobName` fields). Pulls the enrichment concerns out of the pagination query.

```ts
export const listTransactionsPaginatedRaw = query({
  args: { /* same as listTransactionsPaginated */ },
  handler: async (ctx, args) => {
    // ... same routing logic, same filter() ...
    const basePage = await ... .paginate(paginationOpts);
    return basePage;  // no enrichRowsWithPaperAndJob call
  },
});
```

Add this alongside `listTransactionsPaginated`; do not remove the existing query since the UI subscription (non-export) still benefits from server-side enrichment (it keeps the row props self-contained for display).

#### `api.credits.queries.resolveTransactionEnrichments`

Accepts the three id arrays, returns three maps.

```ts
export const resolveTransactionEnrichments = query({
  args: {
    paperIds: v.array(v.id("extractionPapers")),
    openalexIds: v.array(v.string()),
    jobIds: v.array(v.id("extractionJobs")),
  },
  returns: v.object({
    paperTitleById: v.record(v.string(), v.string()),
    paperTitleByOpenalex: v.record(v.string(), v.string()),
    jobNameById: v.record(v.string(), v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return { paperTitleById: {}, paperTitleByOpenalex: {}, jobNameById: {} };
    }
    // ownership check: only return titles for jobs owned by this user
    // (papers inherit ownership through job)

    const paperTitleById: Record<string, string> = {};
    const paperTitleByOpenalex: Record<string, string> = {};
    const jobNameById: Record<string, string> = {};

    await Promise.all(
      args.paperIds.map(async (id) => {
        const paper = await ctx.db.get(id);
        if (paper) paperTitleById[id] = paper.title;
      }),
    );

    await Promise.all(
      args.openalexIds.map(async (openalexId) => {
        const paper = await ctx.db
          .query("extractionPapers")
          .withIndex("by_openalex", (q) => q.eq("openalexId", openalexId))
          .first();
        if (paper) paperTitleByOpenalex[openalexId] = paper.title;
      }),
    );

    await Promise.all(
      args.jobIds.map(async (id) => {
        const job = await ctx.db.get(id);
        if (job && job.userId === user._id) jobNameById[id] = job.name;
      }),
    );

    return { paperTitleById, paperTitleByOpenalex, jobNameById };
  },
});
```

The ownership check on jobs is load-bearing (prevents a malicious caller from using this query as an "is this jobId I don't own a real job?" oracle). Papers are accessed by id without an ownership check because (a) they don't contain user-identifying data in `title`, and (b) the id format is unguessable; but jobs carry `job.name` which might be user-chosen. If paper ownership becomes a concern later, add `paper.jobId → job.userId` check.

### 3. Client `fetchAll` rewrite

```ts
const fetchAll = useCallback(async (
  opts: { signal?: AbortSignal; applyCurrentFilters: boolean },
): Promise<TransactionViewModel[]> => {
  const cache = createEnrichmentCache();
  const collected: TransactionViewModel[] = [];

  const filterArgs = opts.applyCurrentFilters
    ? {
        jobId,
        types: state.types.length > 0 ? state.types : undefined,
        creditPools: state.creditPools.length > 0 ? state.creditPools : undefined,
        billingTypes: state.billingTypes.length > 0 ? state.billingTypes : undefined,
        q: deferredQuery.trim().length > 0 ? deferredQuery.trim() : undefined,
        from: state.from ? state.from.getTime() : undefined,
        to: state.to ? state.to.getTime() : undefined,
      }
    : { jobId };  // "Export all" ignores UI filter state

  let cursor: string | null = null;
  while (true) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");

    const page = await convex.query(
      api.credits.queries.listTransactionsPaginatedRaw,
      { paginationOpts: { numItems: EXPORT_PAGE_SIZE, cursor }, ...filterArgs },
    );

    // Collect unresolved ids from this page
    const paperIdsOnPage = new Set<Id<"extractionPapers">>();
    const openalexIdsOnPage = new Set<string>();
    const jobIdsOnPage = new Set<Id<"extractionJobs">>();
    for (const row of page.page) {
      if (row.paperId) paperIdsOnPage.add(row.paperId);
      else if (row.metadata?.openalexId) openalexIdsOnPage.add(row.metadata.openalexId);
      if (row.jobId) jobIdsOnPage.add(row.jobId);
    }

    const unresolved = cache.selectUnresolved({
      paperIds: paperIdsOnPage,
      openalexIds: openalexIdsOnPage,
      jobIds: jobIdsOnPage,
    });

    if (
      unresolved.paperIds.length > 0 ||
      unresolved.openalexIds.length > 0 ||
      unresolved.jobIds.length > 0
    ) {
      const enrich = await convex.query(
        api.credits.queries.resolveTransactionEnrichments,
        unresolved,
      );
      for (const [id, title] of Object.entries(enrich.paperTitleById)) {
        cache.recordPaperResolved(id as Id<"extractionPapers">, title);
      }
      for (const id of unresolved.paperIds) {
        if (!(id in enrich.paperTitleById)) cache.recordPaperNotFound(id);
      }
      for (const [oid, title] of Object.entries(enrich.paperTitleByOpenalex)) {
        cache.recordPaperByOpenalexResolved(oid, title);
      }
      for (const oid of unresolved.openalexIds) {
        if (!(oid in enrich.paperTitleByOpenalex)) cache.recordPaperByOpenalexNotFound(oid);
      }
      for (const [id, name] of Object.entries(enrich.jobNameById)) {
        cache.recordJobResolved(id as Id<"extractionJobs">, name);
      }
      for (const id of unresolved.jobIds) {
        if (!(id in enrich.jobNameById)) cache.recordJobNotFound(id);
      }
    }

    // Project each row into a view model with cached enrichments
    for (const doc of page.page) {
      const paperTitle =
        (doc.paperId ? cache.getPaperTitle(doc.paperId) : null) ??
        (doc.metadata?.openalexId ? cache.getPaperTitleByOpenalex(doc.metadata.openalexId) : null) ??
        null;
      const jobName = doc.jobId ? (cache.getJobName(doc.jobId) ?? null) : null;
      collected.push(toViewModel({ ...doc, paperTitle, jobName }));
    }

    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  return collected;
}, [convex, jobId, state, deferredQuery]);
```

Read pattern per page:
- 1 query: `listTransactionsPaginatedRaw` (no enrichment join).
- 1 query: `resolveTransactionEnrichments` — but only for ids not already in the cache.

After the first page, the enrichment query shrinks to the novel-ids subset. For 10k rows with ~500 unique paper/job ids distributed across 20 pages, the cache hit rate is ~95% after page 4 — total reads ≈ 20 (pagination) + 4-5 (enrichment) = ~25 queries, vs. current ~80 (3 enrichment per page × 20 pages + 20 pagination).

### 4. Export menu wiring — `transactions-export-menu.tsx`

```ts
const abortRef = useRef<AbortController | null>(null);

useEffect(() => () => {
  abortRef.current?.abort();
}, []);

const exportAll = () => {
  if (loading) return;
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;

  setLoading(true);
  fetchAll({ signal: controller.signal, applyCurrentFilters: false })
    .then((all) => {
      if (controller.signal.aborted) return;
      downloadCsv(toCsv(all), `transactions-all-${isoDate()}.csv`);
    })
    .catch((err) => {
      if (err?.name !== "AbortError") {
        // swallow non-abort errors as before
      }
    })
    .finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
};

const exportCurrent = () => {
  // For "current view", the existing in-memory rows are enough — no fetchAll call.
  // Pass the already-fetched + filtered + sorted rows straight to toCsv.
  if (currentView.length === 0) return;
  downloadCsv(toCsv(currentView), `transactions-${isoDate()}.csv`);
};

// New: "Export filtered (all pages)" menu item — uses fetchAll with applyCurrentFilters: true.
const exportFiltered = () => {
  if (loading) return;
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;

  setLoading(true);
  fetchAll({ signal: controller.signal, applyCurrentFilters: true })
    .then((all) => {
      if (controller.signal.aborted) return;
      downloadCsv(toCsv(all), `transactions-filtered-${isoDate()}.csv`);
    })
    .catch((err) => {
      if (err?.name !== "AbortError") {
        // swallow
      }
    })
    .finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
};
```

Three menu items now:

1. **Export current page** (renamed from "Current view") — in-memory rows, no server fetch.
2. **Export filtered (all pages)** — new — drains all pages matching the current UI filter state.
3. **Export all transactions** — unchanged behavior, drains all pages ignoring UI filters.

`data-export-mode` attribute values: `"current"`, `"filtered"`, `"all"`. Add i18n keys `export.current`, `export.filtered`, `export.all`, `export.filteredHelp` if tooltip explanation is needed.

### 5. Deprecation of `listTransactionsPaginated` enrichment

The existing `listTransactionsPaginated` still runs `enrichRowsWithPaperAndJob`. That's fine for the realtime panel subscription (per-page cost is low, rows are rendered with titles immediately). The plan does NOT remove server-side enrichment from that query — the cost reduction is export-specific.

Optional follow-up: if the per-page enrichment on `listTransactionsPaginated` is ever measured as a latency bottleneck for the main panel subscription, migrate the panel to the raw + resolve split too. Not addressed here.

## TDD sequence

Commit after each green. Prefix: `feat(billing-txn-perf): [plan-03] <what>`.

### `lib/billing/transactions/enrichment-cache.test.ts`

1. RED: `createEnrichmentCache()` returns an object with 10 methods per interface.
2. RED: `cache.getPaperTitle(id)` returns `undefined` for unknown id.
3. RED: after `recordPaperResolved(id, "Title")`, `getPaperTitle(id)` returns `"Title"`.
4. RED: after `recordPaperNotFound(id)`, `getPaperTitle(id)` returns `null` (resolved-missing).
5. RED: `selectUnresolved({ paperIds: [a, b], ... })` with `a` already recorded returns `[b]` in `paperIds`.
6. RED: `selectUnresolved` de-duplicates inputs (calling with `[a, a, b]` treats the same as `[a, b]`).
7. RED: the three id types are tracked independently (paperIds, openalexIds, jobIds).
8. GREEN: implement.

### Convex query tests

9. RED: `listTransactionsPaginatedRaw` returns `Doc<"creditTransactions">[]` without `paperTitle` / `jobName` fields.
10. RED: `resolveTransactionEnrichments` with empty id arrays returns empty maps.
11. RED: `resolveTransactionEnrichments` with paperIds returns titles for existing papers; missing papers absent from the map (not `undefined`).
12. RED: `resolveTransactionEnrichments` with openalexIds resolves via `by_openalex` index.
13. RED: `resolveTransactionEnrichments` with a jobId owned by a different user does NOT return the job name (ownership enforced).
14. GREEN: implement.

### Export menu test

15. RED: clicking "Export filtered" calls `fetchAll({ applyCurrentFilters: true })`; the spy sees UI filter state passed through.
16. RED: clicking "Export all" calls `fetchAll({ applyCurrentFilters: false })`.
17. RED: unmounting during export aborts the in-flight `fetchAll`; no `downloadCsv` fires after unmount.
18. GREEN: implement wiring.

## Files touched

### New

- `lib/billing/transactions/enrichment-cache.ts`
- `lib/billing/transactions/enrichment-cache.test.ts`

### Modified

- `convex/credits/queries.ts` — add `listTransactionsPaginatedRaw`, `resolveTransactionEnrichments`.
- `components/billing/transactions/transactions-panel-client.tsx` — `fetchAll` rewrite with cache + signal + filter-aware branching.
- `components/billing/transactions/transactions-export-menu.tsx` — AbortController, three menu items, signal plumbing.
- `tests/components/billing/transactions/transactions-export-menu.test.tsx` — extend per TDD cases 15-17.
- i18n: `messages/*.json` — new keys `export.filtered` (+ any tooltip copy).

### Dependencies

None added.

## Migration stance

**None.** No schema change. Existing `listTransactionsPaginated` stays. New queries are additive. Client wiring is a drop-in replacement in `fetchAll`.

## Test plan

### Pure logic

TDD cases 1–8 cover the cache.

### Convex

TDD cases 9–14 via `convex-test`.

### Client

TDD cases 15–17 via RTL.

### Manual perf smoke

Seed a user with 10k transactions across ~500 unique papers and ~100 unique jobs. Open browser DevTools → Network tab.

- Click "Export all" → expect ≤ ~25 Convex query calls total (20 pagination + ~5 enrichment). Pre-plan baseline: ~80.
- Click "Export filtered" with `billingTypes=[embedding]` on the same seed → expect filtering to happen server-side (plan 02) so the pagination count drops proportionally; enrichment batches stay small (embedding rows share few paper ids).
- Click "Export all", then immediately navigate to `/extraction` mid-export → Network tab should show pagination stop; no `downloadCsv` triggered; no console errors.

## Acceptance criteria

- [ ] `enrichment-cache.ts` committed; 8 TDD cases green.
- [ ] `listTransactionsPaginatedRaw` and `resolveTransactionEnrichments` queries live in `convex/credits/queries.ts`.
- [ ] Convex query tests green (cases 9–14).
- [ ] `fetchAll` accepts `{ signal, applyCurrentFilters }`; cache used across pages.
- [ ] Export menu has three items: `current` / `filtered` / `all` with correct `data-export-mode` attributes.
- [ ] AbortController cancels in-flight export on unmount; no dead-component `setLoading` call.
- [ ] Extended RTL tests green (cases 15–17).
- [ ] Manual smoke: 10k-row export reduces query count to ~25 in the Network tab.

## Known pitfalls

- **Cache invalidation**: `createEnrichmentCache()` is scoped per-export-invocation. If the user changes a paper title between exports, the next export sees the fresh title. No cross-export cache retention — intentional; export is a one-shot op.
- **Paper ownership**: `resolveTransactionEnrichments` does NOT check paper ownership (only job ownership). Papers are accessed by opaque id or by OpenAlex id; paper `title` is the public metadata. Revisit if paper sensitivity ever changes.
- **`AbortSignal` on `convex.query`**: Convex's client query function accepts a signal in newer versions. Confirm support at execution; if missing, the abort only affects the client-side while-loop, and in-flight queries still complete server-side — bandwidth is wasted but no correctness issue.
- **Large memory footprint**: 100k rows at ~800 bytes each ≈ 80 MB client-side during `exportAll`. Acceptable on modern browsers (Chrome default heap ~2-4 GB) but not streaming-friendly. A server-side streaming CSV action is future work (see `00-README.md`).
- **Enrichment query scope**: when `applyCurrentFilters: true`, the server-side `listTransactionsPaginatedRaw` call already respects the filter. The enrichment query is independent and has no filter — it just resolves ids. No cross-contamination.
- **Missing papers/jobs render as empty cells in the CSV**: `resolveTransactionEnrichments` returns `{}` for missing ids; `toViewModel` coerces to `null`; `toCsv` should render empty string. Confirm in the existing `export-csv.ts` implementation.
- **`listTransactionsPaginatedRaw` validator**: Convex queries validate their return type. Either omit a `returns` validator (inferred) or use `v.object({ page: v.array(v.any()), isDone: v.boolean(), continueCursor: v.string() })` — match the pattern in the existing `listTransactionsPaginated`.

## Future enhancements (out of scope)

- Server-side streaming CSV via `httpAction` with `ReadableStream` — avoids client memory pressure on >100k row exports.
- Progressive enrichment: enrich rows in background while the CSV download is already triggered for the first N pages. UX win if users don't need the full file at once (Excel opens the first chunk while the rest downloads).
- Export schedule / notify-when-ready for >1M row exports — out of scope until signal from a real power user.
