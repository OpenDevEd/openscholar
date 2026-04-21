# Plan 02 — Server-Side Filter Coverage: Indexes + Search

**Depends on:** nothing. **Blocks:** nothing. (Independent of plans 01 and 03.)

## Goal

Eliminate the "400-scroll bug": when the user filters by `creditPool` or `billingType` or types in the search box on a ledger where the match rate is narrow (<5%), `listTransactionsPaginated` currently returns 25 server rows where only ~1 matches client-side — forcing ~100 page-fetches to surface 25 visible rows. Add three composite indexes + one search index so the server narrows by the same dimensions the client UI filters by, and route those dimensions through `listTransactionsPaginated`'s query path.

Implements decisions **D8**, **D9**, **D10**, **D16**.

## Scope

**In scope**

- Schema additions to `convex/schema.ts:creditTransactions`:
  - `by_credits_creditType` — `[creditsId, creditType, createdAt]`
  - `by_credits_billingType` — `[creditsId, billingType, createdAt]`
  - `by_credits_createdAt` — `[creditsId, createdAt]`
  - New computed field `searchableText: v.string()` (non-optional; always set on insert).
  - `searchIndex("search_transactions", { searchField: "searchableText", filterFields: ["creditsId", "type", "billingType", "creditType"] })`.
- New pure-logic module `lib/billing/transactions/search-text.ts` — single function `computeSearchableText(input)` that produces the indexed string from `{ description, metadata, billingType, type }`. Unit-tested.
- Write-site hook: every `ctx.db.insert("creditTransactions", ...)` computes `searchableText` before insert. Backfill migration for existing rows.
- `convex/credits/queries.ts:listTransactionsPaginated` extended:
  - New args: `creditPools: v.optional(v.array(v.union(v.literal("free"), v.literal("paid"))))`.
  - New args: `billingTypes: v.optional(v.array(...))`.
  - New args: `q: v.optional(v.string())` (search query; trimmed empty = no search).
  - Query routing: when `q` is non-empty, use `.withSearchIndex("search_transactions", ...)` and apply filter-field narrowing inline; else route to the narrowest composite index available given the current filter state (single-type / single-pool / single-billing-type / date-range combos).
- Client `transactions-panel-client.tsx` updated: pass `creditPools`, `billingTypes`, `q` (debounced via existing `useDeferredValue`) to `useProtectedPaginatedQuery`. The local `buildFilterPredicate` is retained as a safety net but most dimensions are now satisfied server-side.
- `lib/billing/transactions/filters.ts:toServerFilterArgs` extended to include the new dimensions.
- Backfill migration `convex/migrations/backfillSearchableText.ts` — populates `searchableText` on existing rows.
- Tests: extend `convex/credits/listTransactionsPaginated.test.ts` with server-narrowing cases per index. Unit-test `search-text.ts`.

**Out of scope**

- Multi-select server-side narrowing (when `creditPools=[free, paid]`, fallback to `by_credits` + post-filter — same pattern as multi-type today). Single-select is the overwhelmingly common case; multi-select falls back to the current behavior.
- Exclude-self faceted counts (convention B; covered in plan 01's future-enhancement note).
- Any UI change to the filter widgets themselves.
- Sort change (search mode sorts by relevance; everything else unchanged).

## Design

### 1. Schema — `convex/schema.ts`

Add the three composite indexes + the search index to the `creditTransactions` table. `searchableText` becomes a required string field (empty string is valid; it just yields no search matches for that row).

```ts
creditTransactions: defineTable({
  // ... (existing fields) ...
  createdAt: v.number(),
  searchableText: v.string(),  // NEW: computed server-side; see lib/billing/transactions/search-text.ts
})
  .index("by_credits", ["creditsId"])
  .index("by_stripe_invoice", ["stripeInvoiceId"])
  .index("by_stripe_payment_intent", ["stripePaymentIntentId"])
  .index("by_stripe_charge", ["stripeChargeId"])
  .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"])
  .index("by_user", ["userId"])
  .index("by_type_date", ["type", "createdAt"])
  .index("by_job", ["jobId"])
  .index("by_credits_type", ["creditsId", "type"])
  // NEW: enable server-side narrowing for creditPool / billingType / date-only
  .index("by_credits_creditType", ["creditsId", "creditType", "createdAt"])
  .index("by_credits_billingType", ["creditsId", "billingType", "createdAt"])
  .index("by_credits_createdAt", ["creditsId", "createdAt"])
  // NEW: full-text search across description + model label + billingType + type literal
  .searchIndex("search_transactions", {
    searchField: "searchableText",
    filterFields: ["creditsId", "type", "billingType", "creditType"],
  }),
```

Rationale per index:

- **`by_credits_creditType`** — `creditPools=[free]` → `ix.eq("creditsId", ...).eq("creditType", "free")` narrows to O(user's free rows) from O(user's all rows). Trailing `createdAt` lets the same index serve `creditType + date-range` in one traversal.
- **`by_credits_billingType`** — same story for `billingTypes=[embedding]`.
- **`by_credits_createdAt`** — when only date is set, this avoids scanning the entire `by_credits` range and post-filtering.
- **`search_transactions`** — allows `ctx.db.query("creditTransactions").withSearchIndex("search_transactions", q => q.search("searchableText", searchText).eq("creditsId", creditsId).eq("type", "purchase"))`. Convex search-indexes narrow by exact-match filter-fields first, then rank by the search term.

**Cost estimate**: ~200 KB per index per 100k rows per user. For the expected scale (~2-3M rows/month across all users) total index storage stays well under 2 GB — negligible on Convex pricing.

### 2. `lib/billing/transactions/search-text.ts`

Pure, unit-testable, deterministic.

```ts
import type { BillingType, TransactionType } from "./presentation";

interface SearchTextInput {
  description: string | null | undefined;
  metadata: Record<string, string> | null | undefined;
  billingType: BillingType | null | undefined;
  type: TransactionType;
}

/**
 * Produce the indexed search string for a creditTransaction row.
 *
 * Tokens included:
 *   - `description` (free-form text from mutation)
 *   - `metadata.model` (LLM model id if present — drives "gpt-4o" / "claude-opus" style searches)
 *   - `metadata.openalexId` (so paper-id search works even without paperTitle enrichment)
 *   - `billingType` literal (so "embedding" / "screening" search works)
 *   - `type` literal (so "purchase" / "refund" search works)
 *
 * NOT included:
 *   - `paperTitle` / `jobName` — those live on other tables; indexing them here
 *     would require joining on every write and would drift if the parent renames.
 *     Search across those is a deliberate future enhancement.
 */
export function computeSearchableText(input: SearchTextInput): string {
  const parts: string[] = [];
  if (input.description) parts.push(input.description);
  const model = input.metadata?.model;
  if (model) parts.push(model);
  const openalexId = input.metadata?.openalexId;
  if (openalexId) parts.push(openalexId);
  if (input.billingType) parts.push(input.billingType);
  parts.push(input.type);
  return parts.join(" ").toLowerCase();
}
```

Every token pre-lowercased so the search is case-insensitive.

### 3. Write-site hook — computeSearchableText at insert

Every `ctx.db.insert("creditTransactions", { ... })` (same 9 sites as plan 01) adds one more line:

```ts
const searchableText = computeSearchableText({
  description: args.description,
  metadata: args.metadata,
  billingType: args.billingType,
  type: "usage",  // the literal for this write site
});
await ctx.db.insert("creditTransactions", {
  creditsId: credits._id,
  // ... existing fields ...
  searchableText,
});
```

This plan's schema change forces the field; writes that omit it fail at runtime.

### 4. `listTransactionsPaginated` routing

Extend the query to accept the new dimensions and route to the narrowest available index. Current implementation:

```ts
if (jobId) {
  // by_job
} else if (types && types.length === 1) {
  // by_credits_type
} else {
  // by_credits + filter() post-filter
}
```

New routing (decision table; order matters — narrower first):

```ts
if (q && q.trim().length > 0) {
  // search-index path — all filter-field narrowing happens inside the search clause
  base = ctx.db.query("creditTransactions").withSearchIndex("search_transactions", (sq) => {
    let s = sq.search("searchableText", q.trim().toLowerCase()).eq("creditsId", creditsId);
    if (types && types.length === 1) s = s.eq("type", types[0]);
    if (creditPools && creditPools.length === 1) s = s.eq("creditType", creditPools[0]);
    if (billingTypes && billingTypes.length === 1) s = s.eq("billingType", billingTypes[0]);
    return s;
  });
  // Note: search-index sorts by relevance; no .order("desc") here.
} else if (jobId) {
  // by_job — unchanged
} else if (types && types.length === 1) {
  // by_credits_type — unchanged
} else if (creditPools && creditPools.length === 1) {
  // by_credits_creditType
  base = ctx.db.query("creditTransactions")
    .withIndex("by_credits_creditType", (ix) =>
      ix.eq("creditsId", creditsId).eq("creditType", creditPools[0])
    ).order("desc");
} else if (billingTypes && billingTypes.length === 1) {
  // by_credits_billingType
  base = ctx.db.query("creditTransactions")
    .withIndex("by_credits_billingType", (ix) =>
      ix.eq("creditsId", creditsId).eq("billingType", billingTypes[0])
    ).order("desc");
} else if ((from != null || to != null)) {
  // by_credits_createdAt — covers date-only filters
  base = ctx.db.query("creditTransactions")
    .withIndex("by_credits_createdAt", (ix) => {
      let k = ix.eq("creditsId", creditsId);
      if (from != null) k = k.gte("createdAt", from);
      if (to != null) k = k.lte("createdAt", to);
      return k;
    }).order("desc");
} else {
  // by_credits — unchanged default
  base = ctx.db.query("creditTransactions")
    .withIndex("by_credits", (ix) => ix.eq("creditsId", creditsId))
    .order("desc");
}
```

For every branch, a post-predicate handles the remaining dimensions that the index couldn't narrow (multi-select types beyond 1, date bounds when index is `by_credits_creditType`, etc.). The existing `filter()` from `convex-helpers` is still the mechanism; it just now drops fewer rows because more are pre-narrowed.

**Important**: the search-index path does NOT call `.order("desc")` — Convex search-indexes are ranked by relevance score, not `createdAt`. The client UI must tolerate this (when `q` is non-empty, rows appear in relevance order, not date order; date grouping collapses per existing `shouldRenderGroups` logic which already triggers when `sort !== "date"`).

### 5. Client wiring — `transactions-panel-client.tsx`

Current call:

```ts
const paginated = useProtectedPaginatedQuery(
  api.credits.queries.listTransactionsPaginated,
  {
    jobId,
    types: state.types.length > 0 ? state.types : undefined,
    from: state.from ? state.from.getTime() : undefined,
    to: state.to ? state.to.getTime() : undefined,
  },
  { initialNumItems: 25 },
);
```

New call:

```ts
const paginated = useProtectedPaginatedQuery(
  api.credits.queries.listTransactionsPaginated,
  {
    jobId,
    types: state.types.length > 0 ? state.types : undefined,
    creditPools: state.creditPools.length > 0 ? state.creditPools : undefined,
    billingTypes: state.billingTypes.length > 0 ? state.billingTypes : undefined,
    q: deferredQuery.trim().length > 0 ? deferredQuery.trim() : undefined,
    from: state.from ? state.from.getTime() : undefined,
    to: state.to ? state.to.getTime() : undefined,
  },
  { initialNumItems: 25 },
);
```

`buildFilterPredicate` retained — every dimension it currently checks is now also narrowed server-side, so the predicate drops 0 rows on the single-select path. This is a safety net in case the server args and client state drift during transitions; pay the micro-cost to avoid a subtle bug class.

**Cursor-invalidation concern**: every change to query args invalidates the Convex pagination cursor. Adding `q` to the server args means every search keystroke resets pagination. This is acceptable because:
1. `useDeferredValue` already debounces the React-side commit.
2. The search-index path is server-side narrowing, so the first page carries the actual matches instantly — the user doesn't need to scroll through pagination to find them.
3. The current behavior (client-only search with stale cursor) silently loads more pages to find matches; that's already cursor-churn of a worse kind (loading-many-to-filter-few).

**Sort change when search active**: when `q !== ""`, the sort menu in the toolbar should visually disable or grey out the date/amount/type sort options (search sorts by relevance). Out of scope for this plan — future UX polish.

### 6. Backfill — `convex/migrations/backfillSearchableText.ts`

Two-phase rollout:

1. Deploy schema with `searchableText: v.optional(v.string())` (widened).
2. Run backfill migration: for each row, compute `searchableText` from the row's fields and patch.
3. Deploy schema change: `searchableText: v.string()` (narrowed).
4. New writes include `searchableText` from the start.

If the project convention is to drop schema-narrowing steps for dev environments (dev data is disposable per `plans/extraction-recovery/00-README.md` §Migration stance), collapse to one step: land the required field + write-site changes + migration in one PR and run the migration as part of the deploy.

Migration file:

```ts
import { migrations } from "./runner";
import { computeSearchableText } from "../../lib/billing/transactions/search-text";

export const backfillSearchableTextMigration = migrations.define({
  table: "creditTransactions",
  migrateOne: async (ctx, doc) => {
    if (doc.searchableText !== undefined && doc.searchableText.length > 0) return;
    const text = computeSearchableText({
      description: doc.description,
      metadata: doc.metadata,
      billingType: doc.billingType,
      type: doc.type,
    });
    await ctx.db.patch(doc._id, { searchableText: text });
  },
});
```

Idempotent: re-runs skip rows already populated.

## TDD sequence

Commit after each green. Prefix: `feat(billing-txn-perf): [plan-02] <what>`.

### `lib/billing/transactions/search-text.test.ts`

1. RED: `computeSearchableText({ description: "Stripe purchase", metadata: {}, billingType: null, type: "purchase" })` → `"stripe purchase purchase"`.
2. RED: includes `metadata.model` when present — `"...gpt-4o..."`.
3. RED: includes `metadata.openalexId` when present.
4. RED: `description === null` omitted, not stringified as "null".
5. RED: `billingType === null` omitted.
6. RED: output is lowercased.
7. GREEN: implement.

### `convex/credits/listTransactionsPaginated.test.ts` (extended)

8. RED: `{ creditPools: ["free"] }` uses `by_credits_creditType` — rows returned are all `creditType: "free"`.
9. RED: `{ billingTypes: ["embedding"] }` uses `by_credits_billingType` — rows returned are all `billingType: "embedding"`.
10. RED: `{ from, to }` without other filters uses `by_credits_createdAt` — rows are within range.
11. RED: `{ q: "stripe" }` on a ledger with 10 stripe-described rows + 90 others returns rows containing "stripe" in `searchableText`, ordered by search relevance.
12. RED: `{ q: "stripe", creditPools: ["free"] }` combines search + filter-field narrowing; only free-pool stripe rows.
13. RED: `{ types: ["purchase", "usage"] }` (multi-type) falls back to `by_credits` + post-filter — rows are purchase or usage, no others.
14. RED: `{ creditPools: ["free", "paid"] }` (multi) falls back to `by_credits` + post-filter — behavior unchanged from pre-plan state.
15. GREEN: extend routing implementation.

## Files touched

### New

- `lib/billing/transactions/search-text.ts`
- `lib/billing/transactions/search-text.test.ts`
- `convex/migrations/backfillSearchableText.ts`

### Modified

- `convex/schema.ts` — add 3 composite indexes, 1 search index, 1 required field on `creditTransactions`.
- `convex/credits/queries.ts:listTransactionsPaginated` — extend args (`creditPools`, `billingTypes`, `q`); add routing branches for new indexes and the search path.
- `convex/credits/internal.ts` — 9 insert sites compute and write `searchableText`.
- `convex/ai/actions.ts` / `convex/wallet/gateway/handler.ts` / `convex/ai/helpers.ts` — any helper that directly inserts into `creditTransactions` (transitively via `deductCredits` already covered, but double-check: grep `ctx.db.insert\s*\(\s*"creditTransactions"`).
- `lib/billing/transactions/filters.ts:toServerFilterArgs` — emit `creditPools`, `billingTypes`, `q`.
- `components/billing/transactions/transactions-panel-client.tsx` — pipe new args into `useProtectedPaginatedQuery`.
- `tests/components/billing/transactions/transactions-panel-client.test.tsx` — assert that narrow filters produce complete visible lists from page 1 (no scroll-to-fill).
- `convex/credits/listTransactionsPaginated.test.ts` — extend with routing cases above.

### Dependencies

None added.

## Migration stance

**Two migrations.**

1. `backfillSearchableText` — populates the new required field on existing rows. Must run before the schema narrows `searchableText` from optional to required, OR after the narrowing in a dev environment where stale rows are disposable.
2. No migration needed for the indexes themselves — Convex builds indexes lazily on save; existing rows are visible through new indexes automatically once the schema saves.

**Rollout**:

- **Step A** (one PR): widen `searchableText` to `v.optional(v.string())`, add indexes, add `computeSearchableText`, hook 9 write sites, add migration.
- **Step B** (deploy + backfill): `npx convex run migrations/backfillSearchableText:runBackfillSearchableText`.
- **Step C** (second PR): narrow `searchableText` to `v.string()`, update `listTransactionsPaginated` routing + client wiring.

If a single-PR flow is mandated (dev data disposable), collapse A+C into one commit and run B post-deploy; tolerate a brief window where live requests see stale rows without `searchableText` (search path would miss them until backfill catches up). Plan 02 prefers the three-step rollout for the production environment; dev can skip.

## Test plan

### Pure logic

TDD cases 1–7 (search-text module).

### Convex server

Extended `listTransactionsPaginated.test.ts`:

- All 8 routing cases from TDD sequence (cases 8–15).
- **Large-ledger perf case**: seed 10,000 rows across 5 types × 2 pools × 7 billing-types. Query with `{ creditPools: ["free"], billingTypes: ["embedding"] }` (multi-select → post-filter). Assert the returned page is ≤25 rows AND the time spent in the filter branch is bounded — not explicit latency assertion, but a `console.timeEnd` or `performance.now()` diff committed as a baseline.
- **Search-relevance**: query with `q: "OpenAlex"` against a seeded corpus where 3 rows have `"OpenAlex"` in description and 5 have `metadata.openalexId`. All 8 rows surface; description-match rows rank ahead of metadata-only rows (Convex default scoring).

### Client integration

- **Narrow-filter no-scroll**: mount panel, seed 10k rows with 1% embedding. Filter to embedding. Assert the visible list reaches 25 items after at most 2-3 fetches (down from ~40-100 today).
- **Search keystroke**: type "stripe" slowly. Assert:
  - `data-search-deferred="true"` flips during the keystroke (existing behavior).
  - After settle, visible rows contain "stripe" somewhere.
  - Pagination cursor resets (counted via `paginated.status === "LoadingFirstPage"` flash) — this is expected behavior, not a bug.

## Acceptance criteria

- [ ] 3 new composite indexes + 1 search index declared in `convex/schema.ts`.
- [ ] `searchableText` field (required) on `creditTransactions`.
- [ ] `lib/billing/transactions/search-text.ts` committed; 7 TDD cases green.
- [ ] 9 insert sites compute and write `searchableText`.
- [ ] `backfillSearchableText` migration committed + idempotent.
- [ ] `listTransactionsPaginated` accepts `creditPools`, `billingTypes`, `q`; routes through the correct index per decision table.
- [ ] Client `transactions-panel-client.tsx` passes the new args through to the paginated query.
- [ ] Extended convex-test cases 8-15 green.
- [ ] Browser smoke: filter by `billingType=embedding` on a ledger with ≥100 rows and <5% embedding — visible list reaches 25 rows within 3 fetches.
- [ ] Browser smoke: search for any token present in `description` — rows surface without scrolling through unfiltered pages.

## Known pitfalls

- **Schema narrow of optional → required**: Convex rejects documents at schema-validation time. The backfill must complete before narrowing. In production, use the 3-step rollout; in dev, a single-PR flow is acceptable if data is disposable.
- **Search sort vs date sort**: the search-index path ignores `.order("desc")`. If the user is searching AND has sort set to "date desc", the visible list orders by relevance, not date. The existing `shouldRenderGroups` hides date-bucket headers when `sort !== "date"` — but with search, `sort` is still "date" in URL state while the server orders differently. Decision: show an inline "Sorted by relevance" chip near the toolbar when `q !== ""`; implement as a 1-line conditional in `transactions-panel-toolbar.tsx`. Doc this under "future UX polish" if out-of-scope for this plan cycle.
- **Multi-select fallback**: `{ creditPools: ["free", "paid"] }` returns to the `by_credits` + post-filter path. That's identical to pre-plan behavior — no regression, just no improvement on that specific path. Single-select is the overwhelming common case; if product wants multi-select narrowing later, it's a follow-up.
- **`searchIndex` filter-fields cap**: Convex search indexes support a limited set of filter-fields (confirm at execution — the plan assumes 4 is fine). If the cap is reached, drop `billingType` from filter-fields and rely on the post-predicate instead.
- **Index-pick cost of `billingType` when null**: rows without `billingType` still get indexed under the null/undefined partition in `by_credits_billingType`. This means iterating that index without a `.eq("billingType", X)` is inefficient — but we never do that; we always narrow on the billingType equality. Acceptable.
- **Search tokenization expectations**: Convex's default text tokenizer is whitespace + basic normalization. `metadata.openalexId` is typically `W123456789` (no spaces) and will tokenize as a single token — good. `metadata.model` might be `gpt-4o-mini` with hyphens; tokenization may or may not split on `-`. If the project wants reliable model-name search, add a normalized version (`gpt 4o mini`) to `computeSearchableText`. Keep the default behavior for plan 02; iterate based on real usage.
- **`filter()` still there**: post-predicate handles residual multi-select narrowing. The plan does NOT remove `filter()` calls — it just reduces how much they drop. Preserving the filter-helper usage keeps the code resilient to future args being added without index coverage.
- **Cursor reset on keystroke**: adding `q` to server args invalidates the pagination cursor on every committed search change. With `useDeferredValue` debouncing, this produces at most one cursor reset per settled search term — acceptable.

## Future enhancements (out of scope)

- Index `paperTitle` and `jobName` in `searchableText` (requires join-on-write; defer until a product signal).
- Multi-select server-side narrowing via OR-union index scan (Convex doesn't natively support OR-indexes; would need multiple parallel paginated queries + client merge — complex; only worth it if multi-select usage spikes).
- "Sorted by relevance" chip in the toolbar when `q !== ""`; disable date/amount/type sort options.
