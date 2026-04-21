# Plan 03 — Header, Date Grouping, Paginated Loading

**Depends on:** 02 (rich row). **Blocks:** 04, 05, 06.

## Goal

Wrap the list in a panel with a summary-gauge header (mirroring the sources panel), insert sticky date-group subheaders between rows (collapse on non-date sort), migrate the query consumer from the fixed-50 `useProtectedQuery` path to `useProtectedPaginatedQuery` with IntersectionObserver-driven "Load More", and apply `content-visibility: auto` to rows for a near-free first-paint win. Still no filters or drawer — this plan is about scale, orientation on long scrollbacks, and shipping a baseline summary users can glance at.

Implements decisions **D7** (paginated query), **D8** (content-visibility over virtualization), **D10** (grouping + collapse-on-sort), **D13** (aria-live summary).

## Scope

**In scope**

- New `components/billing/transactions/transactions-panel.tsx` — Server Component shell; reads `searchParams` (jobId only at this stage); renders header + client island.
- New `components/billing/transactions/transactions-panel-client.tsx` — `'use client'` island owning the paginated query + IntersectionObserver hook + group partitioning.
- New `components/billing/transactions/transactions-panel-header.tsx` — title + period summary gauge + progress bar + `role="status" aria-live="polite"` count region + export placeholder button (wired in plan 05).
- New `components/billing/transactions/transactions-group-header.tsx` — sticky date-bucket subheader (`Today` / `Yesterday` / `This week` / `Last week` / `March 2026`).
- New `components/billing/transactions/use-transactions-load-more.ts` — IntersectionObserver hook; triggers `loadMore(25)` when the last row is ≤ 400 px from the viewport bottom.
- Migrate `app/settings/billing/page.tsx` (or wherever `<TransactionsList />` is mounted) to `<TransactionsPanel />`. Keep `TransactionsList` as a thin re-export for one plan cycle, then remove in plan 04.
- Apply `content-visibility: auto; contain-intrinsic-size: 0 60px` on every row via a class on the list container (CSS `& > [data-txn-row]` descendant selector).
- Extend i18n: `billingPage.transactions.{group.today, group.yesterday, group.thisWeek, group.lastWeek, group.month}`, `.summary.{shown, net, in, out}`, `.loadMore`.

**Out of scope**

- Filters / search / sort / tabs (plan 04).
- Detail drawer (plan 05).
- Keyboard navigation (plan 06).
- Export wiring (plan 05 + 06).
- Any Convex changes — plan 01 already extended `getTransactions`.

## Design

### 1. Component boundary — server shell + client island

```
TransactionsPanel (server)
├── reads searchParams.jobId (App Router async prop)
├── <Suspense fallback={<TransactionsPanelSkeleton />}>
│     └── <TransactionsPanelClient jobId={jobId} />
├── </Suspense>
```

The server shell doesn't do much today — it reads `jobId` and passes it down. The value exists because plan 04 will also read filter state from `searchParams` on the server, and having the boundary in place now keeps that migration a one-line change. Alternative (simpler, equally valid): keep the whole panel client-side and defer the server boundary to plan 04. Pick whichever makes the PR smaller at execution time — the decision rubric is "which shipped version needs the fewer changes in plan 04".

### 2. `transactions-panel-client.tsx` — paginated loading

```tsx
"use client";

import { useMemo, useRef } from "react";
import { useTranslations, useFormatter } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedPaginatedQuery } from "@/lib/auth/use-auth-query";
import { toViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { partitionByGroup, shouldRenderGroups } from "@/lib/billing/transactions/grouping";
import { TransactionsPanelHeader } from "./transactions-panel-header";
import { TransactionsGroupHeader } from "./transactions-group-header";
import { TransactionRow } from "./transaction-row";
import { useTransactionsLoadMore } from "./use-transactions-load-more";

interface Props {
  jobId?: Id<"extractionJobs">;
}

export function TransactionsPanelClient({ jobId }: Props) {
  const t = useTranslations("billingPage.transactions");

  // Plan 04 will widen these args. For now: paginate with jobId only.
  const paginated = useProtectedPaginatedQuery(
    api.credits.queries.getTransactions,
    { jobId },
    { initialNumItems: 25 },
  );

  const rows = useMemo(
    () => (paginated.results ?? []).map(toViewModel),
    [paginated.results],
  );

  // Plan 04 reads sort from URL state. Plan 03 hardcodes date-desc.
  const sort = { field: "date" as const, dir: "desc" as const };
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const now = useMemo(() => Date.now(), [rows.length]);  // stable within a data revision

  const renderGroups = shouldRenderGroups(sort);
  const partitioned = useMemo(
    () => (renderGroups ? partitionByGroup(rows, now, tz) : null),
    [renderGroups, rows, now, tz],
  );

  // Summary gauge counts (plan 04 will filter; plan 03 counts everything currently loaded)
  const summary = useMemo(() => summarize(rows), [rows]);

  // Intersection observer on last row → loadMore
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useTransactionsLoadMore({
    sentinelRef,
    scrollRef: scrollContainerRef,
    status: paginated.status,
    loadMore: paginated.loadMore,
    batchSize: 25,
  });

  return (
    <section
      role="region"
      aria-labelledby="transactions-heading"
      data-transactions-panel
      data-transactions-filter={jobId ?? "none"}
      data-transactions-status={paginated.status}
      className="flex h-full flex-col rounded-xl border border-border/40 bg-card/90 shadow-sm"
    >
      <TransactionsPanelHeader
        shownCount={rows.length}
        isLoadingMore={paginated.status === "LoadingMore"}
        summary={summary}
      />

      <div
        ref={scrollContainerRef}
        role="list"
        data-transactions-list
        className="relative max-h-[60vh] flex-1 overflow-auto [&>[data-txn-row]]:[content-visibility:auto] [&>[data-txn-row]]:[contain-intrinsic-size:0_60px]"
      >
        {paginated.status === "LoadingFirstPage" ? (
          <TransactionsListSkeleton count={6} />
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground" data-transactions-empty="true">
            {jobId ? t("emptyForJob") : t("empty")}
          </p>
        ) : renderGroups && partitioned ? (
          partitioned.map(([groupKey, groupRows]) => (
            <div key={groupKey} data-transactions-group={groupKey}>
              <TransactionsGroupHeader groupKey={groupKey} />
              {groupRows.map((row) => (
                <TransactionRow key={row.id} row={row} density="comfortable" />
              ))}
            </div>
          ))
        ) : (
          rows.map((row) => (
            <TransactionRow key={row.id} row={row} density="comfortable" />
          ))
        )}
        <div ref={sentinelRef} aria-hidden="true" data-transactions-sentinel />
        {paginated.status === "LoadingMore" && (
          <p className="py-3 text-center text-xs text-muted-foreground" role="status" aria-live="polite">
            {t("loadingMore")}
          </p>
        )}
        {paginated.status === "Exhausted" && rows.length > 0 && (
          <p className="py-3 text-center text-[11px] text-muted-foreground/70" data-transactions-exhausted="true">
            {t("exhausted")}
          </p>
        )}
      </div>
    </section>
  );
}
```

Key notes:

- `max-h-[60vh]` bounds the scroll container so the IntersectionObserver and `content-visibility` have something to work with. The billing page's parent layout determines the ultimate height; this constraint prevents a 1,000-row list from blowing out the viewport if someone removes the filter.
- `content-visibility: auto` + `contain-intrinsic-size: 0 60px` applied via an arbitrary-value Tailwind descendant selector. The value `60px` matches comfortable-density row height; revisit if plan 06 adds density toggle (then move to a CSS variable or class-per-density).
- `[data-transactions-status]` exposes the Convex paginated state machine (`LoadingFirstPage | CanLoadMore | LoadingMore | Exhausted`) for tests.
- `aria-live="polite"` on the "Loading more…" message is the canonical pattern — one announcement per new page.

### 3. `transactions-panel-header.tsx`

Mirrors `sources-panel-header.tsx` in structure. Title + right-aligned "net summary" stat + thin progress bar + (stubbed) export button.

```tsx
"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Summary {
  in: number;     // sum of positive amounts shown
  out: number;    // sum of absolute negative amounts shown
  net: number;    // in - out
}

interface Props {
  shownCount: number;
  isLoadingMore: boolean;
  summary: Summary;
}

export function TransactionsPanelHeader({ shownCount, isLoadingMore, summary }: Props) {
  const t = useTranslations("billingPage.transactions");
  const format = useFormatter();
  const progress = shownCount === 0 ? 0 : Math.min(100, (shownCount / Math.max(shownCount, 25)) * 100);

  return (
    <header
      data-transactions-header
      className="flex flex-col gap-1.5 border-b border-border/50 px-4 pb-3 pt-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="transactions-heading" className="text-base font-semibold tracking-tight">
          {t("title")}
        </h2>
        <div className="flex items-center gap-3">
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-transactions-summary
            className="text-xs tabular-nums text-muted-foreground"
          >
            <span className="text-emerald-600">+{format.number(summary.in)}</span>
            <span className="mx-1 text-muted-foreground/50">·</span>
            <span>−{format.number(summary.out)}</span>
            <span className="mx-1 text-muted-foreground/50">·</span>
            <span className={summary.net >= 0 ? "text-emerald-600" : "text-foreground"}>
              {t("summary.net")} {summary.net >= 0 ? "+" : "−"}{format.number(Math.abs(summary.net))}
            </span>
          </span>
          {/* Export button — plan 05 wires it */}
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled>
            <Download className="size-3.5" aria-hidden />
            {t("export.label")}
          </Button>
        </div>
      </div>
      <div
        role="presentation"
        aria-hidden="true"
        data-transactions-progress={Math.round(progress)}
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </header>
  );
}
```

Progress bar semantics for plan 03: a coarse "how many pages loaded" indicator. Plan 04 reframes this as "N of M matching filter" with a more meaningful denominator.

### 4. `transactions-group-header.tsx`

```tsx
"use client";

import { useTranslations } from "next-intl";
import type { GroupKey } from "@/lib/billing/transactions/grouping";

interface Props { groupKey: GroupKey; }

export function TransactionsGroupHeader({ groupKey }: Props) {
  const t = useTranslations("billingPage.transactions.group");

  let label: string;
  if (groupKey === "today")      label = t("today");
  else if (groupKey === "yesterday") label = t("yesterday");
  else if (groupKey === "this-week") label = t("thisWeek");
  else if (groupKey === "last-week") label = t("lastWeek");
  else {
    // "month-YYYY-MM"
    const [, year, month] = groupKey.split("-");
    label = t("month", { year, month });  // i18n formats e.g. "March 2026"
  }

  return (
    <div
      role="presentation"
      data-transactions-group-header={groupKey}
      className="sticky top-0 z-10 border-b border-border/40 bg-background/95 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur"
    >
      {label}
    </div>
  );
}
```

### 5. `use-transactions-load-more.ts`

```ts
"use client";

import { useEffect, type RefObject } from "react";

interface Opts {
  sentinelRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  loadMore: (numItems: number) => void;
  batchSize?: number;
  rootMargin?: string;
}

export function useTransactionsLoadMore({
  sentinelRef, scrollRef, status, loadMore,
  batchSize = 25, rootMargin = "0px 0px 400px 0px",
}: Opts) {
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    if (status !== "CanLoadMore") return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadMore(batchSize);
            break;
          }
        }
      },
      { root, rootMargin, threshold: 0 },
    );

    io.observe(sentinel);
    return () => io.disconnect();
  }, [sentinelRef, scrollRef, status, loadMore, batchSize, rootMargin]);
}
```

Guarded by `status === "CanLoadMore"`: no loadMore call while `LoadingMore` (would duplicate), while `LoadingFirstPage` (not ready), or while `Exhausted` (no-op).

### 6. i18n keys to add

```jsonc
"billingPage.transactions": {
  "group": {
    "today":     "Today",
    "yesterday": "Yesterday",
    "thisWeek":  "This week",
    "lastWeek":  "Last week",
    "month":     "{month, selectordinal, one {January} two {February} ...}"
    /* Or simpler: "{month} {year}" with month passed as a localized name. */
  },
  "summary": {
    "shown": "Showing {n}",
    "net":   "Net"
  },
  "export": { "label": "Export" },
  "loadingMore": "Loading more…",
  "exhausted":   "End of history"
}
```

Month names: prefer passing `new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(year, month - 1))` to i18n via `useFormatter`, rather than building ICU plural templates for 12 months. Refine at execution.

### 7. Billing page wiring

```tsx
// app/settings/billing/page.tsx — somewhere near the bottom
import { TransactionsPanel } from "@/components/billing/transactions/transactions-panel";

<TransactionsPanel searchParams={searchParams} />
```

Replace the existing `<TransactionsList />` call. Keep `components/billing/transactions-list.tsx` for one cycle as a thin re-export (`export { TransactionsPanelClient as TransactionsList } from "./transactions/transactions-panel-client"`). Plan 04 removes the re-export.

## TDD sequence — pure logic only

**None new.** `grouping.ts`, `transaction-view-model.ts`, and `formatters.ts` are already green from plan 01.

## Files touched

### New

- `components/billing/transactions/transactions-panel.tsx`
- `components/billing/transactions/transactions-panel-client.tsx`
- `components/billing/transactions/transactions-panel-header.tsx`
- `components/billing/transactions/transactions-group-header.tsx`
- `components/billing/transactions/use-transactions-load-more.ts`
- `components/billing/transactions/transactions-list-skeleton.tsx` (used by `transactions-panel-client`)
- `components/billing/transactions/transactions-panel-client.test.tsx`
- `components/billing/transactions/transactions-panel-header.test.tsx`
- `components/billing/transactions/transactions-group-header.test.tsx`
- `components/billing/transactions/use-transactions-load-more.test.ts`

### Modified

- `app/settings/billing/page.tsx` — replace `<TransactionsList />` with `<TransactionsPanel />`.
- `components/billing/transactions-list.tsx` — thin re-export; kept for one plan cycle.
- `messages/en-US.json` — group, summary, export labels, loadingMore/exhausted.

### Dependencies

- None.

## Migration stance — **none**

Consumer-side wiring only. Plan 01's Convex changes are additive.

## Test plan

### `transactions-panel-client.test.tsx`

- **renders loading skeleton while LoadingFirstPage**: mock `useProtectedPaginatedQuery` to return `status: "LoadingFirstPage"`; assert 6 skeleton rows rendered.
- **renders grouped list when sort=date desc**: seed 3 rows spanning today + yesterday + last month; assert `data-transactions-group-header="today"`, `data-transactions-group-header="yesterday"`, `data-transactions-group-header="month-YYYY-MM"` are all present.
- **groupings collapse when sort ≠ date (future)**: hardcoded to date-desc in plan 03, so this test is a placeholder — add an assertion once plan 04 adds sort state.
- **IntersectionObserver triggers loadMore**: mock IO to fire; assert `loadMore(25)` is called exactly once while `status: "CanLoadMore"`.
- **loadMore gated**: set `status: "LoadingMore"` → IO firing does NOT call `loadMore`.
- **Exhausted sentinel**: set `status: "Exhausted"` → asserts `data-transactions-exhausted="true"` rendered.
- **summary math**: render rows with amounts `[+100, +50, -30]` → header `data-transactions-summary` contains `"+150"`, `"−30"`, `"Net +120"`.
- **jobId URL preserved as data attribute**: render with `jobId="abc"` → `data-transactions-filter="abc"` on the region.

### `transactions-group-header.test.tsx`

- `groupKey="today"` renders i18n key `group.today`.
- `groupKey="month-2026-03"` renders formatted month (assert by text: "March 2026" in en-US).
- `data-transactions-group-header` attribute matches the input key.

### `use-transactions-load-more.test.ts`

- Mocks `IntersectionObserver`; asserts observer is created with `root === scrollRef.current` and `rootMargin === "0px 0px 400px 0px"`.
- Calling the observer's callback with `isIntersecting: true` while `status === "CanLoadMore"` triggers `loadMore`.
- Disconnects on unmount.
- Does not observe when `status === "LoadingFirstPage"`.

### Accessibility (axe)

- Panel at 10 rows → zero violations.
- Sticky group headers don't break row semantics (headers carry `role="presentation"` — axe ignores them).
- `role="status" aria-live="polite"` on the summary region — verify single region, not multiple.

### Manual QA

- Load 25 rows → scroll to bottom → observe next 25 fetched without a visible jump.
- Cross a date boundary while scrolling → sticky header swaps smoothly from "Today" to "Yesterday" to the oldest bucket present.
- Dev tools → Rendering → toggle `content-visibility: auto` highlight → verify offscreen rows are skipped.
- Lighthouse on the billing page → LCP ≤ 1.8s, CLS 0.

## Acceptance criteria

- [ ] `<TransactionsPanel />` mounted on `/settings/billing`; old `<TransactionsList />` replaced.
- [ ] Paginated query via `useProtectedPaginatedQuery`; `initialNumItems: 25`.
- [ ] IntersectionObserver triggers `loadMore(25)` when last row within 400px of viewport.
- [ ] `data-transactions-status` reflects the paginated state machine.
- [ ] Date-group sticky subheaders appear when the list is in date-desc order.
- [ ] `content-visibility: auto` + `contain-intrinsic-size: 0 60px` applied to rows.
- [ ] Header summary gauge renders `+in · −out · Net ±N` with tabular numerals.
- [ ] `role="status" aria-live="polite"` single region present for summary.
- [ ] Axe clean at 10 rows.
- [ ] Lighthouse LCP ≤ 1.8s, CLS 0 on the billing page.
- [ ] Existing billing E2E specs still pass (the `?jobId=` URL flow in particular).

## Known pitfalls

- **`content-visibility: auto` + sticky headers** — `content-visibility: auto` on a scroll container's children can interact poorly with `position: sticky` siblings. Verify the sticky group headers still paint during scroll. If they flicker, apply `content-visibility` only to `[data-txn-row]` (not to group-header elements) — the selector above already targets only rows, so this should be fine. Double-check in the dev server.
- **`contain-intrinsic-size`** — `0 60px` means "ignore intrinsic width, assume 60px height". If density changes or row content expands (e.g., plan 06 adds spacious density to 76px), update this value. Consider a CSS custom property per density.
- **`max-h-[60vh]` on the scroll container** — small viewports with on-screen keyboards can lose rows. Revisit at plan 06 with a responsive clamp like `min(60vh, 700px)`.
- **Convex paginated status machine edge cases** — when the user's credits row is missing, the query returns `{ page: [], isDone: true, continueCursor: "" }`; `status === "Exhausted"` and `rows.length === 0`. The empty state correctly renders. Verify via `convex-test`.
- **Page-size drift** — plan 01 flagged this. A `numItems: 25` request can return 22 or 27 items after post-filtering. UI rule: never assert `paginated.results.length === 25 * pagesLoaded`. Use `paginated.status === "Exhausted"` as the only end-of-list signal.
- **IntersectionObserver on offscreen containers** — if the billing page is in a route that's prerendered / cached, IO may not fire until after hydration. The observer effect runs in a `useEffect` so it's safe — hydration completes first. If first-page load feels slow, drop `rootMargin` to `0px 0px 200px 0px` to be less eager.
- **`now` memoization key** — the group-bucket computation uses `Date.now()`. Keying the `useMemo` on `rows.length` re-evaluates `now` only when rows change, which is correct for grouping stability (don't want the "Today" boundary to flip mid-interaction). If the user leaves the tab open past midnight and scrolls, buckets don't re-evaluate — acceptable for MVP; plan 06 could add a 1-minute interval tick.
- **`data-transactions-exhausted` placement** — outside the scroll container it doesn't matter; inside, make sure it's at the bottom so `content-visibility` doesn't hide it.
- **Sticky header z-index conflicts** — `z-10` on group headers. If the panel is inside a modal or another sticky context, raise to `z-20`. Don't use `z-50` blanket — test at execution time.
- **`TransactionsList` thin re-export** — if any storybook or test file imports it, the re-export keeps them working. Remove only in plan 04 once all imports are updated.
