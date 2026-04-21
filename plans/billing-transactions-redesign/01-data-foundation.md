# Plan 01 — Data Foundation: Pure Logic + Paginated Query

**Depends on:** nothing. **Blocks:** 02, 03, 04, 05, 06.

## Goal

Lay down the pure-logic backbone — presentation (type → icon/tint/label), formatting (amount/balance/relative time), grouping (date bucket classification), filtering (predicate builder), and a view-model projection — all TDD-first. Extend `api.credits.queries.getTransactions` with pagination + typed filter args while keeping the existing call path compatible. No UI changes yet. This plan is the invisible groundwork that makes plans 02-06 small and focused.

Implements decisions **D2** (pure logic TDD), **D3** (icon/tint mapping), **D5** (money-in/money-out/failed color roles), **D6** (tabular-nums formatting), **D7** (paginated query + filter args), **D20** (testing doctrine).

## Scope

**In scope**

- `lib/billing/transactions/presentation.ts` — type → lucide icon, type → CSS var name, type → i18n key; billing-type → secondary icon.
- `lib/billing/transactions/formatters.ts` — signed amount, balance-after, credit-pool label, relative time (Today 3:45 PM / Yesterday / 3 days ago / 2026-03-14).
- `lib/billing/transactions/grouping.ts` — `createdAt` (ms) + timezone → bucket key (`"today" | "yesterday" | "this-week" | "last-week" | "YYYY-MM"`); bucket → i18n key; collision-safe on DST transitions.
- `lib/billing/transactions/filters.ts` — build a predicate from filter state (`types[], creditPools[], billingTypes[], dateRange, search`); compose with `Array.prototype.filter`.
- `lib/billing/transactions/transaction-view-model.ts` — pure projection from raw Convex doc → `TransactionViewModel` consumed by every UI component.
- **Convex query migration**: extend `convex/credits/queries.ts:getTransactions` to accept `paginationOpts` + typed filter args; use `by_type_date` index when filtering by type. Preserve the existing unpaginated array-return path **as a parallel branch** (selected when `paginationOpts` is absent) so the current caller keeps working until plan 03 migrates it.
- Unit tests for every module above.
- Agent-assisted grep confirming `getTransactions` has exactly one external caller.

**Out of scope**

- Any React component changes (plan 02+).
- Filter state URL-wiring (plan 04).
- Detail drawer view-model (plan 05 extends view-model with Stripe fields — already present in the type but not yet projected).
- Any CSS.

## Design

### 1. `lib/billing/transactions/presentation.ts`

```ts
import type { LucideIcon } from "lucide-react";
import {
  CreditCard, Gift, Undo2, Zap, Hourglass,
  Sparkles, Network, ListChecks, MessageSquare,
} from "lucide-react";

export type TransactionType = "purchase" | "usage" | "grant" | "refund" | "expiry";
export type CreditType = "free" | "paid";
export type BillingType = "extraction_llm" | "embedding" | "screening" | "chat";

export interface TypePresentation {
  icon: LucideIcon;
  colorVar: CssVar;        // e.g. "--chart-2"
  i18nKey: string;         // e.g. "type.purchase"
  direction: "in" | "out";
}

type CssVar =
  | "--chart-1" | "--chart-2" | "--chart-3" | "--chart-4" | "--chart-5"
  | "--muted-foreground" | "--destructive";

export const TYPE_PRESENTATION: Readonly<Record<TransactionType, TypePresentation>> = {
  purchase: { icon: CreditCard, colorVar: "--chart-2", i18nKey: "type.purchase", direction: "in" },
  grant:    { icon: Gift,       colorVar: "--chart-3", i18nKey: "type.grant",    direction: "in" },
  refund:   { icon: Undo2,      colorVar: "--chart-1", i18nKey: "type.refund",   direction: "in" },
  usage:    { icon: Zap,        colorVar: "--muted-foreground", i18nKey: "type.usage",   direction: "out" },
  expiry:   { icon: Hourglass,  colorVar: "--destructive",      i18nKey: "type.expiry",  direction: "out" },
};

export const BILLING_TYPE_ICON: Readonly<Record<BillingType, LucideIcon>> = {
  extraction_llm: Sparkles,
  embedding:      Network,
  screening:      ListChecks,
  chat:           MessageSquare,
};

export function presentationFor(type: TransactionType): TypePresentation {
  return TYPE_PRESENTATION[type];
}
```

Hue check against `app/globals.css:69-73` (oklch values in parentheses):

- `--chart-1` H=54 → orange/amber → refund (money back)
- `--chart-2` H=200 → blue/cyan → purchase (money-in primary)
- `--chart-3` H=140 → green → grant (free credits)
- `--chart-4` H=330 → magenta/pink → unused (reserved for future: dispute / subscription renewal)
- `--chart-5` H=280 → purple → unused (reserved for future: adjustment)

### 2. `lib/billing/transactions/formatters.ts`

```ts
import type { CreditType, TransactionType } from "./presentation";

/** Produces the display string for an amount with direction-appropriate sign + thousands separators. */
export function formatSignedAmount(amount: number, direction: "in" | "out"): string {
  // amount is the absolute integer credit count; direction is derived upstream from the sign.
  const abs = Math.abs(amount);
  const separated = abs.toLocaleString("en-US");  // locale swap handled by caller via next-intl useFormatter
  return direction === "in" ? `+${separated}` : `−${separated}`;
  // Unicode minus (U+2212), not ASCII hyphen — aligns better in tabular-nums.
}

/** Produces the credit-pool label — "Free" or "Paid". */
export function creditPoolLabel(creditType: CreditType): string {
  return creditType === "free" ? "Free" : "Paid";  // actual label via i18n in component
}

/** Relative-time bucket key for display. Pure function; consumer formats via next-intl. */
export function relativeTimeBucket(
  ts: number,
  now: number,
  tz: string,
): "today" | "yesterday" | "this-week" | "older" {
  // Implementation uses `Intl.DateTimeFormat(undefined, { timeZone: tz }).formatToParts`
  // to derive calendar-day, then compares day-index offsets.
}

/** Format running balance for the drawer (never displayed on the row unless density=spacious). */
export function formatBalance(balance: number): string {
  return balance.toLocaleString("en-US");
}
```

### 3. `lib/billing/transactions/grouping.ts`

```ts
export type GroupKey =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | `month-${number}-${number}`;  // e.g. "month-2026-03" for March 2026

export function groupKeyFor(ts: number, now: number, tz: string): GroupKey { /* ... */ }

export function groupLabel(key: GroupKey): { i18nKey: string; params?: Record<string, string | number> } {
  // "today" → { i18nKey: "group.today" }
  // "month-2026-03" → { i18nKey: "group.month", params: { year: 2026, month: 3 } }
}

/**
 * Partition rows into ordered [GroupKey, Row[]] tuples preserving row order.
 * Assumes rows are already sorted by createdAt desc.
 */
export function partitionByGroup<T extends { createdAt: number }>(
  rows: readonly T[],
  now: number,
  tz: string,
): ReadonlyArray<readonly [GroupKey, readonly T[]]> { /* ... */ }

/**
 * Whether grouping should be rendered. Returns false when the active sort is
 * not "date desc" — grouped-sorted lists lie (Ramp rule, D10).
 */
export function shouldRenderGroups(sort: { field: string; dir: "asc" | "desc" }): boolean {
  return sort.field === "date" && sort.dir === "desc";
}
```

### 4. `lib/billing/transactions/filters.ts`

```ts
import type { TransactionType, CreditType, BillingType } from "./presentation";

export interface FilterState {
  types: readonly TransactionType[];        // empty = all
  creditPools: readonly CreditType[];       // empty = both
  billingTypes: readonly BillingType[];     // empty = all (only relevant when usage is included)
  dateRange: { from: number; to: number } | null;  // ms epoch; null = all time
  search: string;                           // empty = no filter
}

export const DEFAULT_FILTER_STATE: FilterState = {
  types: [],
  creditPools: [],
  billingTypes: [],
  dateRange: null,
  search: "",
};

/** Is any filter active (non-default)? Drives the "Clear all" affordance visibility. */
export function isFilterActive(state: FilterState): boolean { /* ... */ }

/**
 * Build a predicate for client-side filtering.
 * Server already narrowed by `types[]` and `dateRange`; client applies search + credit-pool + billing-type.
 */
export function buildFilterPredicate(state: FilterState): (row: TransactionViewModel) => boolean {
  /* ... */
}

/** Project filter state → Convex server-side args (coarse filtering for index path). */
export function toServerFilterArgs(state: FilterState): {
  types?: readonly TransactionType[];
  from?: number;
  to?: number;
} { /* ... */ }
```

### 5. `lib/billing/transactions/transaction-view-model.ts`

```ts
import type { Doc } from "@/convex/_generated/dataModel";

export interface TransactionViewModel {
  id: string;
  type: TransactionType;
  creditType: CreditType;
  billingType: BillingType | null;

  direction: "in" | "out";       // derived from sign of raw amount
  amount: number;                // always positive; for display
  signedAmount: number;          // original signed value; for aria-label
  balanceAfter: number;

  description: string | null;
  createdAt: number;

  jobId: string | null;
  paperId: string | null;
  resultId: string | null;

  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeCheckoutSessionId: string | null;

  metadata: Record<string, string>;
  hasStripe: boolean;            // derived; any non-null stripe*
}

export function toViewModel(doc: Doc<"creditTransactions">): TransactionViewModel {
  const direction: "in" | "out" = doc.amount >= 0 ? "in" : "out";
  return {
    id: doc._id,
    type: doc.type,
    creditType: doc.creditType,
    billingType: doc.billingType ?? null,
    direction,
    amount: Math.abs(doc.amount),
    signedAmount: doc.amount,
    balanceAfter: doc.balanceAfter,
    description: doc.description ?? null,
    createdAt: doc.createdAt,
    jobId: doc.jobId ?? null,
    paperId: doc.paperId ?? null,
    resultId: doc.resultId ?? null,
    stripeInvoiceId: doc.stripeInvoiceId ?? null,
    stripePaymentIntentId: doc.stripePaymentIntentId ?? null,
    stripeChargeId: doc.stripeChargeId ?? null,
    stripeCheckoutSessionId: doc.stripeCheckoutSessionId ?? null,
    metadata: doc.metadata ?? {},
    hasStripe:
      doc.stripeInvoiceId != null ||
      doc.stripePaymentIntentId != null ||
      doc.stripeChargeId != null ||
      doc.stripeCheckoutSessionId != null,
  };
}
```

### 6. Convex query migration — `convex/credits/queries.ts:getTransactions`

Widen in backwards-compatible shape. Existing `{ limit, jobId }` path preserved as the "unpaginated, return array" branch. New path: when `paginationOpts` is passed, the query uses `by_type_date` (if `types.length === 1`) or `by_credits` (default) and returns `PaginationResult<CreditTransaction>`.

```ts
import { paginationOptsValidator } from "convex/server";

export const getTransactions = query({
  args: {
    // Unpaginated path (deprecated, kept for current caller until plan 03 lands)
    limit: v.optional(v.number()),
    jobId: v.optional(v.id("extractionJobs")),

    // New paginated path
    paginationOpts: v.optional(paginationOptsValidator),
    types: v.optional(v.array(v.union(
      v.literal("purchase"), v.literal("usage"), v.literal("grant"),
      v.literal("refund"),   v.literal("expiry"),
    ))),
    from: v.optional(v.number()),   // ms epoch
    to:   v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      if (args.paginationOpts) {
        return { page: [], isDone: true, continueCursor: "" };
      }
      return [];
    }
    // ... (credits lookup preserved)

    // Unpaginated branch — unchanged from today.
    if (!args.paginationOpts) {
      // existing implementation verbatim
    }

    // Paginated branch — new.
    const { paginationOpts, types, from, to, jobId } = args;

    let q;
    if (jobId) {
      q = ctx.db.query("creditTransactions").withIndex("by_job", (ix) => ix.eq("jobId", jobId));
    } else if (types && types.length === 1) {
      q = ctx.db.query("creditTransactions")
        .withIndex("by_type_date", (ix) => ix.eq("creditsId", credits._id).eq("type", types[0]));
    } else {
      q = ctx.db.query("creditTransactions").withIndex("by_credits", (ix) => ix.eq("creditsId", credits._id));
    }

    let result = await q.order("desc").paginate(paginationOpts);

    // Post-filter for the axes the server index can't narrow by (multi-type, from/to range, creditsId on by_job).
    result = {
      ...result,
      page: result.page.filter((row) => {
        if (jobId && row.creditsId !== credits._id) return false;
        if (types && types.length > 1 && !types.includes(row.type)) return false;
        if (from != null && row.createdAt < from) return false;
        if (to   != null && row.createdAt > to  ) return false;
        return true;
      }),
    };

    return result;
  },
});
```

**Important caveat**: post-filtering inside a paginated query can create empty or short pages. This is tolerated per Convex's pin-endpoints model — the UI treats `page.length < paginationOpts.numItems` as normal, not as "end of data". End-of-data is signalled by `isDone`.

The `returns` validator changes shape based on which branch — Convex supports a union return validator (`v.union(v.array(...), v.object({ page: ..., ... }))`). If the type machinery is painful, ship as two queries: `getTransactions` (existing, unpaginated) kept intact, and `listTransactionsPaginated` (new). Decide at TDD-commit time; both are acceptable.

### 7. Validation — caller inventory

Delegate an `Explore` agent:

> Grep the repo for every caller of `api.credits.queries.getTransactions`. Return file + line for each consumer. The plan assumes exactly one external consumer (`components/billing/transactions-list.tsx:37`). If you find more, stop and report.

Only proceed with the widening once confirmed.

## TDD sequence — pure logic

Commit after each green. Prefix messages `feat(billing-txn): [plan-01] <module> — <test case>`.

### `presentation.ts`

1. RED: `presentationFor("purchase")` returns icon `CreditCard`, colorVar `"--chart-2"`, direction `"in"`.
2. RED: `presentationFor("usage")` returns icon `Zap`, direction `"out"`.
3. RED: `presentationFor("expiry")` returns colorVar `"--destructive"`, direction `"out"`.
4. RED: `BILLING_TYPE_ICON.extraction_llm` is `Sparkles`.
5. GREEN: implement lookup tables.

### `formatters.ts`

6. RED: `formatSignedAmount(1234, "in")` → `"+1,234"`.
7. RED: `formatSignedAmount(500, "out")` → `"−500"` (Unicode minus U+2212).
8. RED: `formatSignedAmount(0, "in")` → `"+0"`.
9. RED: `relativeTimeBucket(now, now, "UTC")` → `"today"`.
10. RED: `relativeTimeBucket(now - 25*3600*1000, now, "UTC")` → `"yesterday"` (handles the 24h→25h boundary correctly; not just `diff < 86400000`).
11. RED: `relativeTimeBucket(now - 8*86400*1000, now, "UTC")` → `"older"`.
12. RED: DST boundary — for a `tz` that observes DST, crossing the spring-forward does not double-bucket.

### `grouping.ts`

13. RED: `groupKeyFor(now, now, "UTC")` → `"today"`.
14. RED: `groupKeyFor(now - 2*86400*1000, now, "UTC")` → `"this-week"` (assuming mid-week "now").
15. RED: `groupKeyFor(new Date("2026-03-14").getTime(), new Date("2026-04-20").getTime(), "UTC")` → `"month-2026-03"`.
16. RED: `partitionByGroup([r1, r2, r3], now, tz)` preserves input order within each group.
17. RED: `shouldRenderGroups({ field: "date", dir: "desc" })` → `true`.
18. RED: `shouldRenderGroups({ field: "amount", dir: "desc" })` → `false`.

### `filters.ts`

19. RED: `isFilterActive(DEFAULT_FILTER_STATE)` → `false`.
20. RED: `isFilterActive({ ...DEFAULT, search: "foo" })` → `true`.
21. RED: `buildFilterPredicate({ types: ["purchase"], ...DEFAULT })` matches a purchase row, rejects a usage row.
22. RED: `buildFilterPredicate({ search: "stripe", ...DEFAULT })` matches case-insensitively on `description`.
23. RED: `toServerFilterArgs({ types: ["purchase"], dateRange: { from: 1, to: 2 }, ...DEFAULT })` → `{ types: ["purchase"], from: 1, to: 2 }`.

### `transaction-view-model.ts`

24. RED: `toViewModel(doc)` projects direction `"out"` for `amount: -500`.
25. RED: `hasStripe: true` when any `stripe*` field is set.
26. RED: `hasStripe: false` when none are set.

All green → commit → proceed to Convex migration (test-after for the query; see Test plan below).

## Files touched

### New

- `lib/billing/transactions/presentation.ts`
- `lib/billing/transactions/formatters.ts`
- `lib/billing/transactions/grouping.ts`
- `lib/billing/transactions/filters.ts`
- `lib/billing/transactions/transaction-view-model.ts`
- `lib/billing/transactions/presentation.test.ts`
- `lib/billing/transactions/formatters.test.ts`
- `lib/billing/transactions/grouping.test.ts`
- `lib/billing/transactions/filters.test.ts`
- `lib/billing/transactions/transaction-view-model.test.ts`

### Modified

- `convex/credits/queries.ts` — extend `getTransactions` with paginated branch; keep unpaginated branch unchanged. Add `listTransactionsPaginated` as alternative if the union return type is painful.

### Dependencies

- None. Every module listed uses already-installed deps.

## Migration stance — **none**

Additive query args. Existing caller passes `{ jobId, limit: 200 }` or `{ limit: 50 }` and continues to work. Plan 03 migrates the caller to the paginated branch; plan 01 doesn't touch the consumer.

## Test plan

### Pure logic

See TDD sequence above — every `.test.ts` file covers the enumerated cases. Run via `npm test -- lib/billing/transactions/`.

### Convex query (test-after)

Via `convex-test` harness (project convention — see existing tests in `convex/**/*.test.ts`):

- **backwards-compat**: calling `getTransactions({ limit: 50 })` returns an array (not a pagination result). Existing caller shape preserved.
- **paginated happy path**: calling `getTransactions({ paginationOpts: { numItems: 10, cursor: null } })` returns `{ page: TransactionDoc[], isDone: boolean, continueCursor: string }`.
- **type filter — index path**: `{ paginationOpts, types: ["purchase"] }` uses `by_type_date`; result contains only purchases.
- **type filter — multi-type post-filter**: `{ paginationOpts, types: ["purchase", "grant"] }` uses `by_credits` and post-filters; result contains both types, no others.
- **date range**: `{ paginationOpts, from, to }` post-filters the page accordingly.
- **ownership enforced**: user A's rows never appear in user B's query.
- **empty user**: a user with no `credits` row gets `{ page: [], isDone: true, continueCursor: "" }`.

### Integration smoke

No UI work in this plan. A quick manual check: run `convex dev`, invoke `getTransactions` from the dashboard's Functions tab with `{ paginationOpts: { numItems: 5, cursor: null } }`, confirm the result shape.

## Acceptance criteria

- [ ] `lib/billing/transactions/presentation.ts` committed + green tests cover every type + every billing-type.
- [ ] `lib/billing/transactions/formatters.ts` committed + green tests cover sign, Unicode minus, day boundaries, DST.
- [ ] `lib/billing/transactions/grouping.ts` committed + green tests cover today/yesterday/this-week/older/month buckets + `shouldRenderGroups`.
- [ ] `lib/billing/transactions/filters.ts` committed + green tests cover state-active predicate + client predicate + server-arg projection.
- [ ] `lib/billing/transactions/transaction-view-model.ts` committed + green tests cover direction derivation + `hasStripe` derivation.
- [ ] `convex/credits/queries.ts:getTransactions` accepts `paginationOpts`, `types`, `from`, `to`; returns `PaginationResult` when paginated, array otherwise.
- [ ] `convex-test` tests green: backwards-compat, paginated happy path, type filter, date range, ownership, empty user.
- [ ] Single external caller of `getTransactions` confirmed via agent-delegated grep (still just `components/billing/transactions-list.tsx:37`).
- [ ] No UI changes shipped. The billing page looks identical to pre-plan-01.

## Known pitfalls

- **Convex union return validators** — if the TypeScript inference over `v.union(v.array(...), v.object({ ... }))` is painful for callers, split into two queries (`getTransactions` old + `listTransactionsPaginated` new) and phase the deprecation of the old one in plan 03. Don't over-engineer the validator; the result matters, not the symmetry.
- **`by_type_date` index availability** — confirmed present per the audit (`convex/schema.ts:125-170`), but verify the exact key shape at execution — `eq("creditsId", …).eq("type", …)` should compile; if it doesn't, add the composite index (no migration needed, Convex adds on save).
- **Post-filtering empty pages** — a page of 10 items with a type filter might post-filter to 3 items. UI (plan 03) must interpret `page.length < numItems` as "fetch more", not "end of list". End-of-list is `isDone === true`.
- **Unicode minus in tabular-nums** — verified to align correctly in common sans-serif fallbacks. If a specific theme font misaligns, fall back to ASCII hyphen-minus and accept the half-pixel shift.
- **Timezone handling** — all bucketing uses the user's locale via `Intl.DateTimeFormat(undefined, { timeZone: tz })`. Derive `tz` from the component via `Intl.DateTimeFormat().resolvedOptions().timeZone` and pass it into pure functions. Don't hard-code `"UTC"` except in tests.
- **React Server Component boundary** — pure logic modules are client-safe. Importing `lucide-react` icons pulls a client-only dependency chain. If any Server Component needs `presentation.ts`, either isolate the icon map into a separate `presentation-icons.ts` or mark the shell a Client Component. Defer the call until plan 02 surfaces the need.
- **`description` is optional** — half of `usage` rows may have no description (raw spec not nullable-checked everywhere). View-model coerces `undefined → null`; plan 02's row component must display a fallback (`type` label as title) when `description === null`.
- **`metadata` can be empty object** — treat `{}` as "no metadata" and don't render the drawer's metadata section.
