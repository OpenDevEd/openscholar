# Billing Transactions Performance — Execution Prompts

One copy-paste prompt per plan, designed to be pasted into a fresh `/clear`'d Claude Code session. Each prompt is self-contained: the agent doesn't need to have seen the planning conversation.

**Before any prompt:** ensure you're on `dev` branch with a clean working tree; `git log -1` to confirm the previous plan's commits landed if chaining.

---

## Plan 01 — Faceted Counts: Aggregate-Backed Filter Badges

```
Execute `plans/billing-transactions-perf/01-faceted-counts.md` from top to bottom. The user-visible bug is: the filter-dropdown count badges in the transactions panel (components/billing/transactions/transactions-panel-client.tsx:316-324) count the paginated-loaded rows, so they grow as the user infinite-scrolls. Fix: three DirectAggregate instances namespaced by credits._id, keyed on [dimensionValue, createdAt], populated at each insert site + backfilled for existing rows, read by a new getTransactionFacetCounts query, subscribed from the client.

Order of operations:

1. Pre-work — delegate one Explore agent to grep every `ctx.db.insert\s*\(\s*"creditTransactions"` call in the codebase; return a punch list confirming the 9 expected sites in convex/credits/internal.ts (and no others, or flag additions since the audit).
2. Append three `app.use(aggregate, { name: ... })` registrations to convex/convex.config.ts for txnTypeAgg, txnCreditPoolAgg, txnBillingTypeAgg.
3. Create convex/credits/aggregates.ts mirroring convex/extraction/aggregates.ts structure — three DirectAggregate instances, helpers `recordTransactionCounters`, `forgetTransactionCounters`, `clearUserTransactionCounters`, `readTransactionFacetCounts`. TDD per plan §TDD sequence cases 1–9 in convex/credits/aggregates.test.ts.
4. Add `getTransactionFacetCounts` public query to convex/credits/queries.ts. TDD cases 10–14 in convex/credits/getTransactionFacetCounts.test.ts.
5. Hook all 9 insert sites in convex/credits/internal.ts: after each `ctx.db.insert("creditTransactions", ...)`, read the just-inserted doc with ctx.db.get and pass to `recordTransactionCounters`.
6. Create convex/migrations/backfillTransactionCounters.ts per plan §5, mirroring convex/migrations/backfillBillingTypes.ts.
7. Run the backfill in a dev/staging environment: `npx convex run migrations/backfillTransactionCounters:runBackfillTransactionCounters`.
8. Rewire components/billing/transactions/transactions-panel-client.tsx: remove the `counts` useMemo and the `bumpCount` helper; subscribe to `api.credits.queries.getTransactionFacetCounts`; derive the Record<string,number> shape expected by TransactionsPanelToolbar from the response.
9. Extend tests/components/billing/transactions/transactions-panel-client.test.tsx (or add coverage) to assert counts come from the subscription and do NOT drift when more pages load.

Delegation rules:
- BEFORE step 3: spawn one general-purpose agent to read @convex-dev/aggregate@0.2.1 source at node_modules/@convex-dev/aggregate/src/client/index.ts and confirm the DirectAggregate constructor option shape + countBatch signature the plan references.
- BEFORE step 6: spawn one Explore agent to read convex/migrations/backfillBillingTypes.ts end-to-end and return the exact Migrations-component wiring pattern in ≤150 words; plan 01's backfill must follow that pattern exactly.
- IF a single-PR rollout is mandated by the repo CI: confirm step 8 can ship in the same PR as steps 2–7 without leaving the panel with empty counts for an extended window. Acceptable failure mode: counts read 0 for the duration of the backfill (minutes in a test env, hours in production with a large table).

Acceptance criteria are explicit in §Acceptance — tick every box before concluding.

Testing doctrine: assert on behavior / data-* / ARIA / getByRole. Never assert on className or Tailwind strings (per root CLAUDE.md).

Commit discipline: one commit per TDD green for the aggregate helpers, one per write-site hook (batch into 2–3 commits max), one for backfill migration, one for client rewire. Prefix: `feat(billing-txn-perf): [plan-01] <what>`.

Main-session protection: spawn subagents for anything beyond 3 reads / 3 greps.

Final manual smoke: open /settings/billing with a seeded user who has ≥60 transactions. Verify:
- Filter dropdown counts are stable as you scroll the list.
- Applying a date range updates counts reactively.
- Clearing the date range returns counts to lifetime totals.
- Selecting creditPools=[free] does NOT reduce the "type" counts (convention A is deliberate — see 00-README §D4).
```

---

## Plan 02 — Server-Side Filter Coverage: Indexes + Search

```
Execute `plans/billing-transactions-perf/02-server-filter-indexes.md` top to bottom. Plan 02 is independent of plans 01 and 03 — no prerequisites beyond a clean `dev` branch.

The problem: creditPools, billingTypes, and search are 100% client-filtered today. On a 10k-row ledger with a narrow filter (e.g. billingType=embedding ~5%), the infinite-scroll loop must load ~100 pages to surface 25 visible rows. Fix: three composite indexes (by_credits_creditType, by_credits_billingType, by_credits_createdAt), one search index (search_transactions) on a computed searchableText field, and routing in listTransactionsPaginated to use each.

Order of operations:

1. Pre-work — delegate one Explore agent to verify `libraryItems.search_library` in convex/schema.ts and the queries that consume it (.withSearchIndex("search_library", ...)); extract the exact pattern for the search-index declaration and usage.
2. Create lib/billing/transactions/search-text.ts + test per §TDD cases 1–7. Exported function: `computeSearchableText({ description, metadata, billingType, type }): string`.
3. Extend convex/schema.ts:creditTransactions — add three composite indexes + searchableText field + search_transactions searchIndex. Widen to `v.optional(v.string())` initially (for migration window).
4. Hook all 9 insert sites in convex/credits/internal.ts: compute `searchableText` from the same fields already being written, include in the insert object.
5. Create convex/migrations/backfillSearchableText.ts mirroring convex/migrations/backfillBillingTypes.ts. Run it in dev/staging.
6. AFTER backfill completes: narrow searchableText to `v.string()` (required) in convex/schema.ts. If ship model is single-PR, tolerate a brief window where live inserts pass but backfill is racing.
7. Extend convex/credits/queries.ts:listTransactionsPaginated — accept `creditPools`, `billingTypes`, `q` args; implement the routing decision table from §4 Design; fall back to existing by_credits + filter() for multi-select or unindexed combos.
8. Extend lib/billing/transactions/filters.ts:toServerFilterArgs to emit the new dimensions.
9. Update components/billing/transactions/transactions-panel-client.tsx to pipe creditPools/billingTypes/q (via useDeferredValue) into useProtectedPaginatedQuery args. Retain buildFilterPredicate as client-side safety net.
10. Extend convex/credits/listTransactionsPaginated.test.ts with TDD cases 8–15: narrowing per index, search happy path, search + filter-field narrowing, multi-select fallback.

Delegation rules:
- BEFORE step 1: spawn one general-purpose agent to read the Convex docs on search indexes and filter-fields cap (commonly 16; the plan assumes 4 is fine). Confirm at https://docs.convex.dev/database/text-search or equivalent.
- BEFORE step 3: spawn one Explore agent to grep all current `ctx.db.insert\s*\(\s*"creditTransactions"` sites; confirm the 9 sites match the audit punch list.
- BEFORE step 9: spawn one Explore agent to confirm `useProtectedPaginatedQuery` in lib/auth/use-auth-query.ts handles arg-change cursor invalidation the way the plan documents. If `q` in args ends up triggering excessive re-subscription, consider adding a client-side debounce layer on top of useDeferredValue.

Acceptance criteria in §Acceptance. Most important behavioral assertion: seed a user with 10k rows and filter to billingType=embedding — the visible list must reach 25 rows within 3 fetches (from ~100 today).

Testing doctrine: same as plan 01. Assert on behavior / data-* / ARIA. Never CSS.

Commit discipline: TDD commits for search-text, one for schema, one for write-site hooks, one for migration, one for listTransactionsPaginated routing, one for client wiring, one for the schema-narrow step (if split). Prefix: `feat(billing-txn-perf): [plan-02] <what>`.

Known pitfall: search-indexed queries sort by relevance, not date. The shouldRenderGroups logic already hides date buckets when sort !== "date", but if the user has date sort active while search is non-empty, the visible list will NOT be in date order. Acceptable for plan 02; future UX polish may add a "Sorted by relevance" chip.
```

---

## Plan 03 — Enrichment Cache + Export Polish

```
Execute `plans/billing-transactions-perf/03-enrichment-cache-export.md` top to bottom. Plan 03 is independent of plans 01 and 02 — no prerequisites beyond a clean `dev` branch.

Three fixes:
1. Cross-page enrichment cache — export loop currently re-fetches the same papers/jobs across pages. Cut read count ~80 → ~25 on a 10k-row export.
2. Filter-aware "Export current view" — today `fetchAll` ignores UI filter state; pass it through so the label is truthful.
3. AbortController on export — stop dead-component setLoading after navigate-away.

Order of operations:

1. Create lib/billing/transactions/enrichment-cache.ts + test per §TDD cases 1–8. Pure logic, no Convex import.
2. Add two new queries to convex/credits/queries.ts: `listTransactionsPaginatedRaw` (same as listTransactionsPaginated but no enrichment join) and `resolveTransactionEnrichments` (batch-resolves arrays of paperIds/openalexIds/jobIds to titles/names, with job ownership check). TDD cases 9–14.
3. Rewrite `fetchAll` in components/billing/transactions/transactions-panel-client.tsx per §3 Design: accepts `{ signal, applyCurrentFilters }`, iterates with the shared cache, calls listTransactionsPaginatedRaw + resolveTransactionEnrichments per page (enrichment only for novel ids).
4. Update components/billing/transactions/transactions-export-menu.tsx per §4 Design: AbortController in a ref, three menu items (`current` = in-memory rows; `filtered` = fetchAll with UI filters; `all` = fetchAll without filters). Abort on unmount.
5. Add i18n keys for the new menu items.
6. Extend tests/components/billing/transactions/transactions-export-menu.test.tsx with TDD cases 15–17.

Delegation rules:
- BEFORE step 2: spawn one Explore agent to locate every current consumer of listTransactionsPaginated — confirm the new Raw variant doesn't accidentally become a drop-in replacement that removes enrichment from the live panel subscription.
- BEFORE step 3: confirm via a quick reads whether `convex.query` in the version installed accepts a signal option. If not, the AbortController only guards the while-loop, not in-flight requests; document this in the PR.
- IF the existing listTransactionsPaginated has grown new args since the audit (plan 02 may have added some), `listTransactionsPaginatedRaw` must accept the same set — copy the args block verbatim.

Acceptance criteria in §Acceptance. Manual perf smoke is the most important: Chrome DevTools Network tab on a 10k-row export — pre-plan ~80 Convex queries, post-plan ≤ ~25.

Testing doctrine: same as plans 01/02.

Commit discipline: TDD commits for enrichment-cache; one for each new query; one for fetchAll rewrite; one for export-menu wiring; one for i18n. Prefix: `feat(billing-txn-perf): [plan-03] <what>`.

Known pitfall: the paper-ownership model isn't changed here — resolveTransactionEnrichments only gates jobs (job.userId === user._id). Papers leak titles by id; if paper-title sensitivity matters later, extend the ownership check through paper.jobId → job.userId. Out of scope for plan 03; document in PR if discovered during review.
```

---

## Resumption cheatsheet

If a session crashes or grows stale mid-plan, here's how to resume without re-reading the entire conversation:

1. `git log --oneline dev | head -10` — what's landed?
2. `cat plans/billing-transactions-perf/<current-plan>.md | head -100` — re-orient.
3. Paste the current plan's prompt from this file.
4. The agent picks up at the first unchecked acceptance criterion.

Plans are resumable because:
- TDD commits are per-test-case.
- UI commits are per-component.
- Acceptance criteria are checklists.
- Schema changes + backfills are idempotent — re-running is a no-op.
