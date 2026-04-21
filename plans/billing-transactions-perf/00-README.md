# Billing Transactions — Performance Plan Set

Three-plan follow-up to `plans/billing-transactions-redesign/` that closes every data-side performance hole in the transactions surface uncovered by a 4-agent audit on 2026-04-21. The redesign plan set shipped the UX; this plan set makes the data layer scale. No UX regressions, no schema renames, no new UI concepts — purely backend hygiene + one client subscription rewire.

Audit-motivated scope: the facet-count badges in `FilterMultiSelect` grow as the user infinite-scrolls (they count page-local rows, not the ledger); `creditPool`, `billingType`, and `search` are 100% client-filtered with zero server narrowing so narrow filters fetch 400+ pages to surface 25 matches; and the CSV "Export all" loop re-enriches papers/jobs per page with no cross-page cache, inflating read count ~20× on large exports.

---

## Motivation

Empirical state of the transactions data path as of 2026-04-21 (file:line citations, verified against source, not speculation):

1. **Facet counts grow with scroll.** `components/billing/transactions/transactions-panel-client.tsx:316-324` computes `counts` by iterating `baseRows`, which is `paginated.results` — i.e. only the pages already fetched. `useTransactionsLoadMore` fires `loadMore(25)` as the sentinel enters the viewport, `baseRows` grows, the counts climb. User-visible symptom: "Purchase (3)" on first paint, "Purchase (42)" after scrolling. The three `FilterMultiSelect` dropdowns (`type`, `creditPool`, `billingType`) all consume these drifting numbers.

2. **`.collect().length` is forbidden.** `convex/_generated/ai/guidelines.md` explicitly: *"Never use `.collect().length` to count rows. Convex has no built-in count operator, so if you need a count that stays efficient at scale, maintain a denormalized counter in a separate document and update it in your mutations."* The naive "just count server-side" fix is ruled out by project doctrine. The sanctioned mechanism is the `@convex-dev/aggregate` component, which the project **already uses** in 4 instances (`convex/convex.config.ts:22-29`: `resultStatusAgg`, `resultAnsweredAgg`, `resultConfidenceAgg`, `creditsAgg`). None are user-scoped; all are `jobId`-namespaced for extraction analytics.

3. **Server-side filter coverage has severe gaps.** Matrix from the audit:

   | Dimension | Server? | Client? | Worst-case impact |
   |-----------|---------|---------|-------------------|
   | `types[]` (single) | `by_credits_type` index ✓ | redundant | OK |
   | `types[]` (multi) | `by_credits` + `filter()` post-predicate | redundant | Scans ~5× `numItems` per page per audit |
   | `creditPools[]` | ✗ **no index** | 100% client | Narrow filter → ~1 visible row per 25-row server page |
   | `billingTypes[]` | ✗ **no index** | 100% client | Same — `embedding=1% of usage` → ~1/page |
   | `dateRange` | in-scan post-filter | redundant | OK at typical ranges; no index for range narrowing |
   | `search` | ✗ **no index** | `description.toLowerCase().includes` | 10k × string compare per keystroke; no search-index |
   | `jobId` | `by_job` index ✓ | — | OK |

   Concrete bad path: user filters `creditPools=[free]` + `billingTypes=[embedding]` on a 10k-row ledger where both facets select ~5% of rows. Server returns 25 rows per `listTransactionsPaginated` page; client post-filter drops to ~1 visible row. The IntersectionObserver fires when the sentinel (below the *filtered* list) enters the viewport — so the user must load ~2,500 server rows (100 fetches) before the visible list has 25 matches. Multiply that by every keystroke in the search box, which **does not reset** the pagination cursor (search is client-only), so at least that isn't a second-order problem — but `types`/`from`/`to` changes do invalidate the cursor and refetch from scratch.

4. **Per-page enrichment, no cross-page cache.** `enrichRowsWithPaperAndJob` (`convex/credits/queries.ts:419-476`) batches paper + job fetches *within* a page via `Promise.all`, but cache scope is one page. A job name or paper title appearing across 5 pages is fetched 5 times. The `fetchAll` export loop (`components/billing/transactions/transactions-panel-client.tsx:281-298`) calls `listTransactionsPaginated` with `numItems: 500` in a client-side `while (!isDone)` — for 10k rows that's 20 iterations × ~4 queries (base + 3 enrichment batches) = 80 server queries where a cross-page cache would reduce it to ~20–24.

5. **`convex-helpers/server/filter` does not refill the page.** Verified in `node_modules/convex-helpers/server/filter.ts`: `paginate()` applies the predicate *after* `q.paginate(opts)` returns and hands back a page shorter than `numItems` when the predicate drops rows. `listTransactionsPaginated`'s multi-type / date-range branches rely on this filter — pages arrive variable-sized. UI handles this correctly (`isDone` is the source of truth, not `page.length < numItems`) but the net effect is that the effective payload is unpredictable and the single page can scan more from the index than it returns.

6. **Export loop ignores user filters.** `fetchAll` (client) passes only `{ jobId }` to the server, never the current `types/creditPools/billingTypes/from/to/q` state. "Export current view" is actually "export everything in the jobId scope, then filter client-side in the export menu" — which is hidden behavior and loads orders of magnitude more data than the user expects.

7. **No AbortController on export.** `fetchAll` continues the while-loop after the user navigates away. The in-flight queries complete server-side, results accumulate into an unreferenced array, and the `.finally(setLoading(false))` fires on a dead component. Resource leak; not a correctness bug.

8. **Redundant `buildFilterPredicate` pass.** The client filter re-applies every dimension after the server has already narrowed by `types` + `from` + `to`. Cheap, but dead code.

Meanwhile, reasons to be calm: the 4 existing aggregate instances are functioning, `creditsAgg` in particular is the closest structural analog to what we need. The project's aggregate-integration pattern is established — we follow it. Zero schema destruction. Zero migration of existing user data (existing rows are preserved; a backfill adds counter entries idempotently via `insertIfDoesNotExist`).

---

## Design decisions (locked via 4-agent audit, 2026-04-21)

| # | Decision | Source |
|---|---|---|
| **D1** | **Introduce three new `DirectAggregate` instances — `txnTypeAgg`, `txnCreditPoolAgg`, `txnBillingTypeAgg` — each namespaced by `Id<"credits">`.** Mirrors the existing project pattern in `convex/extraction/aggregates.ts` which uses `DirectAggregate` + helper functions called explicitly from each write site. We deliberately do **not** use `TableAggregate` + `Triggers.wrapDB` even though it requires fewer call-site changes: the project has made the call-site-explicit choice already, and maintaining one pattern is worth more than saving ~11 boilerplate lines. | DRY audit — matches `convex/extraction/aggregates.ts`. |
| **D2** | **SortKey is `[dimensionValue, createdAt]`; namespace is `creditsId`.** Range-count a single bucket (`bounds: { lower: [v, from], upper: [v, to] }`) is O(log n). Per-user isolation guarantees no cross-user OCC contention. `createdAt` trailing the composite key (never leading) avoids the "write hotspot on the tree tail" the aggregate README explicitly calls out for monotonic keys. | `@convex-dev/aggregate@0.2.1` README §Namespacing + §Lazy-aggregation. |
| **D3** | **`billingType` is optional on the row; skip writing to `txnBillingTypeAgg` when undefined.** The read path's `countBatch` still enumerates the 7 literal values — a value with no stored rows returns 0, which renders as disabled "(0)" in the UI, not hidden. | Schema audit: `billingType` is `v.optional(...)`. UX memo: count=0 renders disabled. |
| **D4** | **Counts are `{tab, date} -respected, other-facets-ignored`.** This is convention A from the UX memo (simpler) — NOT the disjunctive exclude-self convention B (Algolia-style). Reasoning: the user's complaint is "counts grow with scroll" — convention A fixes that 100%. B's exclude-self adds namespace cardinality (would multiply 3× to 16× depending on topology) and UI complexity that the user didn't ask for. Leave a note at the bottom of plan 01 for a future upgrade if user research shows people combine multi-select facets heavily. | UX memo §2. User's stated problem. |
| **D5** | **Backfill via `@convex-dev/migrations` + `insertIfDoesNotExist`.** The component is already installed (`convex/migrations/backfillBillingTypes.ts` uses it). Single migration function, per-row, iterates in paginated batches respecting the 8MB/4096-doc transaction limit. Idempotent by construction — re-running is a no-op. | Aggregate README §Backfill. Pattern used in `backfillBillingTypes.ts`. |
| **D6** | **New public query `getTransactionFacetCounts` in `convex/credits/queries.ts`.** Returns `{ type: Record<TransactionType,number>, creditPool: Record<CreditType,number>, billingType: Record<BillingType,number> }`. Three `countBatch` calls in parallel, one per aggregate. Accepts optional `from`/`to` epochs for date-range bounds. Reactive — the client subscribes and the badges update live as new transactions stream in. | Aggregate README §countBatch. |
| **D7** | **Client rewire: remove the `counts` useMemo, the `bumpCount` helper, and pass the new subscription's result straight into `TransactionsPanelToolbar.counts`.** No shape change to the downstream contract — the toolbar keeps its `Record<string, number>` prop. | Minimal-diff principle. |
| **D8** | **Add three composite indexes to `creditTransactions`:** `by_credits_creditType` (`[creditsId, creditType, createdAt]`), `by_credits_billingType` (`[creditsId, billingType, createdAt]`), `by_credits_createdAt` (`[creditsId, createdAt]`). The first two unlock server-side narrowing for `creditPools`/`billingTypes` single-select filters. The third supports date-range narrowing without a type filter. Index cost on a 100k-row user ≈ 200 KB each. | Server-vs-client filter audit. Convex docs: composite indexes are cheap. |
| **D9** | **Add a search index `search_transactions`** on a computed `searchableText` field (`description + metadata.model + billingType + type`) with filter fields `[creditsId, type, billingType, creditType]`. Replaces the client-side `description.toLowerCase().includes(q)` scan. Works with Convex's full-text search (prefix + token matching). Server-side search eliminates the "10k string compares per keystroke" client work. | Server-vs-client audit §3. Mirrors `libraryItems.search_library` pattern (`convex/schema.ts:1042-1045`). |
| **D10** | **Extend `listTransactionsPaginated` to accept `creditPools`, `billingTypes`, `q`** and route them through the new indexes / search-index. Multi-select remains post-filter via `convex-helpers/server/filter` (matches the existing single-type approach). When `q` is present, the query switches to `.withSearchIndex(...)` and the sort drops to search-relevance (Convex search-indexes sort by their own score). | D8 + D9 wiring. |
| **D11** | **Cross-page enrichment cache in the export loop.** Client-side `Map<Id,string>` for papers + jobs, populated in `fetchAll` as pages stream. Each new page only enriches the *novel* IDs. Cuts read count for 10k-row exports from ~80 queries to ~20–24 (depending on id overlap across pages). | N+1 audit §4. |
| **D12** | **Apply UI filters to the export `fetchAll`.** Pass `types/from/to/creditPools/billingTypes/q` to the server call (the same shape `listTransactionsPaginated` accepts post-D10). "Export current view" becomes truthful to its label — previously it was a misnomer. Keep "Export all" as an explicit menu entry that passes no filters. | Export audit §1. |
| **D13** | **Wire AbortController to export.** `fetchAll` accepts a `signal: AbortSignal`, the component passes a signal created in a ref, and the export-menu cancels on unmount. In-flight queries from `convex.query()` don't strictly abort server-side work, but the client-side loop breaks and the result array is discarded, preventing the dead-component `setLoading` call path. | Export audit §1. |
| **D14** | **No `Triggers.wrapDB` rollout.** We do not migrate the 11 write sites to `customMutation(rawMutation, customCtx(triggers.wrapDB))`. The call-site-explicit pattern matches the project; plan 01's helper (`recordTransactionCounters(ctx, doc)`) gets one call added per write site. This is ~11 lines of diff total, acceptable vs. the cost of introducing a second write-through mechanism. | DRY audit; code style consistency. |
| **D15** | **`getLatestGrantStatus` stays as-is.** Audit flagged ~55 reads worst-case but it's only invoked on the /settings/billing page load (not the transactions panel), guarded by try/catch, and the heavy part is the `stripeEventLogs.by_object_created` loop which already uses an index. Out of scope for this plan set — revisit if it becomes a hot path. | Hot-path audit §5. |
| **D16** | **Testing doctrine (inherited from project).** Assert on behavior, `data-*`, ARIA. No CSS-class assertions. Pure logic TDD-first; aggregate helpers unit-tested via `convex-test` mirroring `convex/credits/listTransactionsPaginated.test.ts`. | Project `CLAUDE.md`. |

---

## Plan files

```
plans/billing-transactions-perf/
├── 00-README.md                        (this file)
├── 01-faceted-counts.md                (3 aggregates + getTransactionFacetCounts + client rewire)
├── 02-server-filter-indexes.md         (creditPool/billingType/date-range indexes + search index)
├── 03-enrichment-cache-export.md       (cross-page enrichment cache + export filter + AbortController)
└── PROMPTS.md                          (one copy-paste execution prompt per plan)
```

## Dependency graph

```
01 faceted-counts ──────────► (independent; user's primary complaint)
02 server-filter-indexes ───► (independent; unlocks 400-scroll bug)
03 enrichment-export ───────► (independent; cleans up export path)
```

All three plans are independent of each other. Ship in any order; I recommend `01 → 02 → 03` because:

1. 01 is the user's visible complaint — highest impact per LOC.
2. 02 has the largest invisible-performance win (unblocks creditPool/billingType/search narrow filters).
3. 03 polishes export, mostly matters for power users.

---

## Reuse (DRY)

These plans lean on primitives the codebase already ships. Primary donors:

- **`convex/extraction/aggregates.ts`** — reference implementation of `DirectAggregate` + helper pattern. Plan 01's `convex/credits/aggregates.ts` mirrors its shape (register, record, forget, clear helpers; `countBatch` reads).
- **`convex/convex.config.ts:22-29`** — four `app.use(aggregate, { name: ... })` registrations show exactly how to add three more.
- **`@convex-dev/migrations`** — already installed; `convex/migrations/backfillBillingTypes.ts` is the template for plan 01's `backfillTransactionCounters`.
- **`libraryItems.search_library`** (`convex/schema.ts:1042-1045`) — the project's only search-index precedent. Plan 02 follows its filter-fields + searchField shape.
- **`convex-helpers/server/filter`** — already imported in `listTransactionsPaginated`. Plan 02 extends its predicate, doesn't replace it.
- **`useProtectedPaginatedQuery`** — no change; plan 02's server-side narrowing happens below it.
- **`components/billing/transactions/transactions-export-menu.tsx`** — plan 03's AbortController and filter-aware `fetchAll` attach here; no UI redesign.

No new deps. No schema destruction. No change to the `data-*` contract established by the redesign plan.

---

## Testing doctrine

Inherits the redesign plan's doctrine verbatim (`CLAUDE.md`):

- Assert on behavior, ARIA, `data-*` attributes, semantic state.
- Pure logic tested in `lib/**.test.ts`.
- Aggregate helpers + queries tested via `convex-test` (`convex/credits/aggregates.test.ts`, extended `convex/credits/listTransactionsPaginated.test.ts`).
- Component tests via RTL; prefer `getByRole` / `getByText`.
- No CSS-class assertions.

### TDD policy — pure logic + Convex helpers

| Plan | Modules under TDD |
|---|---|
| **01** | `convex/credits/aggregates.ts` helper functions (via convex-test harness). Client-side: test `getTransactionFacetCounts`'s return-shape contract once the query is implemented. |
| **02** | `convex/credits/listTransactionsPaginated.test.ts` extended with new server-narrowing cases. `lib/billing/transactions/search-text.ts` (new; computes `searchableText`). |
| **03** | `lib/billing/transactions/enrichment-cache.ts` (new; pure LRU-ish map helpers, TDD-first). |

Components + wiring are test-after. Behavior tests follow the existing pattern in `tests/components/billing/transactions/`.

---

## Migration stance

**Additive only**. No schema drops, no field renames. Write sites keep writing `creditTransactions` via `ctx.db.insert` exactly as before; after each insert, the mutation calls one helper that records the new entry in the three aggregates. Existing data is preserved; the backfill migration populates aggregate entries for every historical row idempotently.

Dev data is disposable per project doctrine (`plans/extraction-recovery/00-README.md` § Migration stance). In environments where aggregates are rebuilt from scratch, run the migration once; in environments where the app has been partly running with the new write path, the migration's `insertIfDoesNotExist` tolerates already-written entries.

---

## Delegation policy — protect the main session's context

Same as the redesign plan. Any investigation needing more than ~3 reads / ~3 greps → spawn a subagent. Parallelize independent searches in a single tool-call message.

**What to delegate (high value, for this plan set specifically):**

- "Read `@convex-dev/aggregate@0.2.1` source at `node_modules/@convex-dev/aggregate/src/client/index.ts` for the `DirectAggregate` class signature; confirm `Namespace` + `Key` + `Id` + `sumValue` option shape and `countBatch` signature."
- "Grep every mutation that calls `ctx.db.insert(\"creditTransactions\", ...)`. Return a punch list of 11 sites so the plan-01 executor can tick them off."
- "Read `convex/migrations/backfillBillingTypes.ts` and distill the idempotent-chunk pattern in ≤150 words; plan 01's backfill should match exactly."
- "Read `libraryItems.search_library` usage in the codebase — every query that consumes it. Plan 02 follows that pattern; confirm the signature."
- "Read `useProtectedPaginatedQuery`'s cursor-invalidation behavior on arg change in `lib/auth/use-auth-query.ts`; confirm plan 02's split of server-args vs. client-args keeps the cursor stable across search keystrokes (because `q` still goes to the server under plan 02 — the search path uses the search-index — and keystroke-invalidation is acceptable since `useDeferredValue` already debounces at the React level)."

**What to keep in the main session:**

- TDD red → green cycles on aggregate helpers.
- Commits (one per green).
- Acceptance-criteria verification.

---

## Convex patterns referenced across plans

- **`@convex-dev/aggregate@0.2.1`** — `DirectAggregate`, `insertIfDoesNotExist`, `deleteIfExists`, `clear`, `count`, `countBatch`, `sum`. Imported from `@convex-dev/aggregate`.
- **`@convex-dev/migrations`** — already installed; one migration file per plan that needs a backfill. Runner pattern: `migrations.runner(internal.credits.aggregates.backfillTransactionCounters)`.
- **`paginationOptsValidator`** — unchanged from current use.
- **`convex-helpers/server/filter`** — unchanged pattern; plan 02 tightens the predicate scope.
- **Search indexes** — plan 02 adds `creditTransactions.search_transactions` following the `libraryItems.search_library` shape. Uses `.withSearchIndex(...)`.
- **Composite indexes** — plan 02 adds three; `by_credits_creditType`, `by_credits_billingType`, `by_credits_createdAt`.

---

## Sources

- **Current code audit** — `components/billing/transactions/transactions-panel-client.tsx:281-346`, `convex/credits/queries.ts:334-476`, `convex/credits/internal.ts:1460-1630`, `convex/schema.ts:125-175`, `convex/convex.config.ts:22-29`, `convex/extraction/aggregates.ts:27-377`.
- **Agent audit reports (2026-04-21)** — DRY sweep (aggregate reuse verdict), aggregate docs research (`@convex-dev/aggregate@0.2.1` source + examples), write-site catalog (11 insert sites, 0 update/delete sites), UX-semantics memo (convention A vs B), N+1 enrichment audit (20× export cost gap), server-vs-client filter audit (creditPool/billingType/search unindexed), export + unbounded-path audit.
- **Official references** — `@convex-dev/aggregate` README §Grouping / Namespacing / Read-dependencies / Lazy-aggregation / Backfill. `convex/_generated/ai/guidelines.md` §Query guidelines (no `.collect().length`). Convex Stack: "Efficient COUNT/SUM/MAX with the Aggregate Component".
- **Project conventions** — root `CLAUDE.md` (testing philosophy), `plans/billing-transactions-redesign/00-README.md` (pattern reference).
