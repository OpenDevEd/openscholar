# Plan 06 — Keyboard, States, A11y, E2E, Perf Benchmarks

**Depends on:** 05 (drawer + export). **Blocks:** none.

## Goal

Ship the polish layer: keyboard navigation between rows with `aria-activedescendant`, improved empty / loading / error states (skeleton rows, inline error banner, clear-filter CTA, buy-credits CTA), `prefers-reduced-motion` audit pass, a comprehensive axe pass at every density and filter state, E2E specs that exercise the full redesigned surface, and a perf-benchmark file that gates future regressions. After this plan the surface is production-ready.

Implements decisions **D13** (aria-live + aria-busy finalized), **D14** (keyboard contract), **D16** (density UX complete), **D19** (memoization audit), **D20** (test coverage).

## Scope

**In scope**

- New `components/billing/transactions/use-transactions-keyboard.ts` — listbox keyboard contract: `/` focus search, `↑/↓` move active descendant, `Enter` open drawer, `Esc` close drawer → clear search → blur, `Cmd+E` open export menu.
- New `components/billing/transactions/transactions-list-skeleton.tsx` (if not shipped in plan 03) — 6 skeleton rows mirroring real layout.
- New `components/billing/transactions/transactions-error-banner.tsx` — inline retriable error inside the panel region.
- New `components/billing/transactions/transactions-empty-state.tsx` — tuned for no-data vs no-matches cases.
- Extend `transaction-row.tsx` with `aria-activedescendant` target hookup, focus-visible ring, and `data-txn-active` attribute.
- Extend `transactions-panel-client.tsx` to mount the keyboard hook, own `activeId` local state, and wire the Enter-to-drawer path.
- Audit every new component for `prefers-reduced-motion` compliance.
- Axe test: panel × three densities × four filter states × drawer open → zero violations per combination.
- E2E: extend `e2e/billing/*.spec.ts` (or add `e2e/billing/transactions.spec.ts`) to cover: filtered-URL roundtrip, row click → drawer → Escape → focus returns, CSV export, keyboard nav.
- `tests/perf/billing-transactions.bench.ts` — Vitest `bench` cases for filter pipeline at 500 rows + 1,000 rows (regression gate, not CI-blocking).
- Remove any stale code: old inline empty-state text in `transactions-panel-client.tsx`, stub props, dead comments.
- Final walkthrough of every `data-*` attribute: document the contract in a top-of-file JSDoc in `transactions-panel-client.tsx`.

**Out of scope**

- Bulk selection + bulk actions (post-MVP).
- Saved user views (post-MVP).
- Cmd+K command palette (post-MVP).
- Admin-scope transactions view (out of scope).

## Design

### 1. `use-transactions-keyboard.ts`

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface UseTransactionsKeyboardOpts {
  rows: readonly { id: string }[];
  listRef: RefObject<HTMLElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  onActivateRow: (rowId: string) => void;
  onClearSearch: () => void;
  onOpenExport: () => void;
  isDrawerOpen: boolean;
  onCloseDrawer: () => void;
}

export function useTransactionsKeyboard(opts: UseTransactionsKeyboardOpts) {
  const { rows, listRef, searchRef, onActivateRow, onClearSearch, onOpenExport, isDrawerOpen, onCloseDrawer } = opts;
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = activeId ? rows.findIndex((r) => r.id === activeId) : -1;

  // Reset active descendant when rows change (filter / sort / pagination)
  useEffect(() => {
    if (activeId && !rows.find((r) => r.id === activeId)) {
      setActiveId(null);
    }
  }, [rows, activeId]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") {
      if (e.key === "Escape") {
        if ((e.target as HTMLInputElement).value) {
          e.preventDefault();
          onClearSearch();
        } else {
          (e.target as HTMLInputElement).blur();
        }
      }
      return; // do not intercept anything else while typing
    }

    // Global shortcuts
    if (modifier && e.key.toLowerCase() === "e") {
      e.preventDefault();
      onOpenExport();
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (e.key === "Escape") {
      if (isDrawerOpen) {
        e.preventDefault();
        onCloseDrawer();
      }
      return;
    }

    // List-scoped shortcuts: require focus in/under the list
    const list = listRef.current;
    if (!list || !list.contains(e.target as Node)) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(activeIndex + 1, rows.length - 1);
      if (rows[next]) {
        setActiveId(rows[next].id);
        const el = document.getElementById(`txn-row-${rows[next].id}`);
        el?.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(activeIndex - 1, 0);
      if (rows[next]) {
        setActiveId(rows[next].id);
        const el = document.getElementById(`txn-row-${rows[next].id}`);
        el?.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (e.key === "Enter") {
      if (activeId) {
        e.preventDefault();
        onActivateRow(activeId);
      }
      return;
    }
  }, [rows, listRef, searchRef, activeId, activeIndex, onActivateRow, onClearSearch, onOpenExport, isDrawerOpen, onCloseDrawer]);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return { activeId, setActiveId };
}
```

Consumer wiring in `transactions-panel-client.tsx`:

```tsx
const listRef = useRef<HTMLDivElement>(null);
const searchRef = useRef<HTMLInputElement>(null);
const [exportMenuOpen, setExportMenuOpen] = useState(false);

const { activeId, setActiveId } = useTransactionsKeyboard({
  rows,
  listRef,
  searchRef,
  onActivateRow: (id) => {
    const row = rows.find((r) => r.id === id);
    if (row) setDetailRow(row);
  },
  onClearSearch: () => setState({ q: "" }),
  onOpenExport: () => setExportMenuOpen(true),
  isDrawerOpen: detailRow != null,
  onCloseDrawer: () => setDetailRow(null),
});

// List container:
<div
  ref={listRef}
  role="list"
  aria-activedescendant={activeId ? `txn-row-${activeId}` : undefined}
  data-transactions-list
  tabIndex={0}
  ...
>
```

Pass `activeId` into each row: `<TransactionRow row={row} density={state.density} isActive={row.id === activeId} onClick={setDetailRow} />`. Row's `data-txn-active` attribute flips accordingly.

### 2. `transactions-list-skeleton.tsx`

6 rows matching comfortable density (60px). If plan 03 shipped a simpler variant, replace here.

```tsx
"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function TransactionsListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div data-transactions-skeleton className="flex flex-col divide-y divide-border/40">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5" aria-hidden>
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-[60%]" />
            <Skeleton className="h-2.5 w-[40%]" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
```

### 3. `transactions-error-banner.tsx`

```tsx
"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface Props {
  onRetry: () => void;
  message?: string;
}

export function TransactionsErrorBanner({ onRetry, message }: Props) {
  const t = useTranslations("billingPage.transactions.error");
  return (
    <div
      role="alert"
      data-transactions-error
      className="m-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold">{t("title")}</p>
        <p className="text-xs text-muted-foreground">{message ?? t("message")}</p>
      </div>
      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onRetry}>
        <RefreshCw className="size-3" aria-hidden />
        {t("retry")}
      </Button>
    </div>
  );
}
```

Wire: in `transactions-panel-client.tsx`, catch a query error via a Convex error boundary or by observing `paginated.status === undefined`. Convex throws on error rather than returning a status; wrap the client in an `<ErrorBoundary>` that renders `<TransactionsErrorBanner onRetry={reset} />`.

### 4. `transactions-empty-state.tsx`

```tsx
"use client";

import Link from "next/link";
import { Wallet, Filter } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface Props {
  kind: "no-data" | "no-matches";
  onClearFilters?: () => void;
}

export function TransactionsEmptyState({ kind, onClearFilters }: Props) {
  const t = useTranslations("billingPage.transactions.empty");
  const Icon = kind === "no-data" ? Wallet : Filter;

  return (
    <div
      data-transactions-empty={kind}
      role="status"
      className="flex flex-col items-center gap-3 p-8 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{t(`${kind}.title`)}</p>
        <p className="max-w-[320px] text-xs text-muted-foreground">{t(`${kind}.description`)}</p>
      </div>
      {kind === "no-data" && (
        <Button asChild variant="default" size="sm">
          <Link href="/settings/billing#topup">{t("no-data.cta")}</Link>
        </Button>
      )}
      {kind === "no-matches" && onClearFilters && (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          {t("no-matches.cta")}
        </Button>
      )}
    </div>
  );
}
```

### 5. Extend `transaction-row.tsx`

Add `isActive` prop already designed in plan 02 but rewire: when `isActive`, add an inset focus ring and scroll-into-view hook (handled by the keyboard hook). Also add `id="txn-row-{id}"` (already in plan 02) and ensure focus-visible styles remain subtle.

### 6. Reduced-motion audit

Inventory every motion/transition shipped across plans 02–05:

| Location | Motion | Reduced-motion handling |
|---|---|---|
| `.txn-pulse` (status pill) | CSS keyframe `txn-pulse 1.6s infinite` | `@media (prefers-reduced-motion)` override — **done in plan 02**. |
| Row hover `transition-colors` | CSS transition | Always subtle; skip as no motion-safety issue. |
| Progress bar `transition-[width]` | 300ms | Add `@media (prefers-reduced-motion)` override to `transition: none`. |
| shadcn `Sheet` drawer | Built-in CSS transition | Respects `prefers-reduced-motion` by default. |
| shadcn `Popover`/`DropdownMenu` | Built-in CSS | Same. |
| Table row insertion (realtime append) | If plan 02/03 added a CSS keyframe, wrap in reduced-motion guard. | Likely none; verify. |

Add these once to `app/globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  [data-transactions-progress] > div { transition: none !important; }
  .txn-pulse { animation: none !important; }
}
```

### 7. `data-*` contract document

Add JSDoc at the top of `transactions-panel-client.tsx`:

```tsx
/**
 * TransactionsPanelClient — client-owned billing-transactions surface.
 *
 * Test contract (assert on these, never on CSS classes):
 *   - Region: [data-transactions-panel]
 *   - Filter scope: [data-transactions-filter={jobId|"none"}]
 *   - Paginated status: [data-transactions-status="LoadingFirstPage"|"CanLoadMore"|"LoadingMore"|"Exhausted"]
 *   - Filter-active: [data-transactions-filter-active="true"|"false"]
 *   - Search deferred: [data-search-deferred="true"|"false"]
 *   - Empty: [data-transactions-empty="no-data"|"no-matches"]
 *   - Exhausted: [data-transactions-exhausted="true"]
 *   - Group header: [data-transactions-group-header="today"|"yesterday"|"this-week"|"last-week"|"month-YYYY-MM"]
 *   - Row: [data-txn-row] [data-txn-id] [data-txn-type] [data-txn-direction]
 *           [data-txn-credit-type] [data-txn-billing-type] [data-txn-status] [data-txn-density]
 *           [data-txn-active] (when keyboard-active)
 *   - Drawer: [data-transaction-drawer] [data-drawer-section="amount"|"badges"|"linked"|"stripe"|"metadata"]
 *   - Export: [data-transactions-export-trigger] [data-export-mode="current"|"all"]
 *
 * Keyboard contract (implemented in use-transactions-keyboard):
 *   /            → focus search
 *   ArrowUp/Down → move active row; scrollIntoView nearest
 *   Enter        → open detail drawer for active row
 *   Escape       → close drawer → clear search → blur
 *   Cmd/Ctrl+E   → open export menu
 */
```

### 8. Perf benchmarks — `tests/perf/billing-transactions.bench.ts`

```ts
import { bench, describe } from "vitest";
import { toViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { buildFilterPredicate, DEFAULT_FILTER_STATE } from "@/lib/billing/transactions/filters";
import { partitionByGroup } from "@/lib/billing/transactions/grouping";
import { toCsv } from "@/lib/billing/transactions/export-csv";
import { generateFixture } from "./fixtures/transactions";

describe("transactions pipeline @ 500 rows", () => {
  const docs = generateFixture(500);
  const viewModels = docs.map(toViewModel);
  const filterState = { ...DEFAULT_FILTER_STATE, types: ["purchase", "usage"] };
  const predicate = buildFilterPredicate(filterState);
  const now = Date.now();

  bench("toViewModel", () => { docs.map(toViewModel); });
  bench("filter", () => { viewModels.filter(predicate); });
  bench("partition by group", () => { partitionByGroup(viewModels, now, "UTC"); });
  bench("toCsv", () => { toCsv(viewModels); });
});

describe("transactions pipeline @ 1000 rows", () => {
  const docs = generateFixture(1000);
  const viewModels = docs.map(toViewModel);
  bench("toViewModel", () => { docs.map(toViewModel); });
  bench("filter", () => { viewModels.filter(buildFilterPredicate(DEFAULT_FILTER_STATE)); });
});
```

Not part of `npm test`. Run via `npm run bench:transactions`. Fixture in `tests/perf/fixtures/transactions.ts` generates synthetic docs with realistic distribution (70% usage, 20% purchase, 5% grant, 4% refund, 1% expiry).

Target thresholds (from research):

- `toViewModel` at 500: < 1ms.
- `filter` at 500: < 2ms.
- `partition by group` at 500: < 3ms.
- `toCsv` at 500: < 5ms.
- All above at 1000: < 2× the 500-row value.

If exceeded, flag as regression — profile and optimize.

### 9. E2E — `e2e/billing/transactions.spec.ts`

Follow the project's Playwright patterns (check existing `e2e/billing/*.spec.ts` for conventions). Each scenario:

- **URL-state roundtrip**: visit `/settings/billing?view=purchases&types=purchase`, assert `data-transactions-tab="purchases"` is active and rows carry `data-txn-type="purchase"`.
- **Row click → drawer**: click the first row, assert `[data-transaction-drawer]` is visible with `[data-drawer-section="amount"]`. Press Escape, assert drawer closed and focus returned.
- **CSV export — current view**: click Export → "Current view", assert a download triggered (file saved to test-artifacts). Open the CSV, parse headers, assert `CSV_COLUMNS` order.
- **Keyboard nav**: focus the list, press Down × 3, press Enter, assert drawer opens for the 4th row.
- **Filter + clear**: apply a type filter, assert row count drops, click Clear All, assert row count restored and URL params stripped.
- **Empty state**: mock a user with zero transactions, assert the `no-data` empty state with the "Buy credits" CTA.
- **Reduced motion**: set `prefers-reduced-motion: reduce` via `page.emulateMedia`, click a pending-status row → assert `.txn-pulse` has no animation (via `getComputedStyle`).

### 10. Axe test matrix

A single `e2e/billing/transactions.axe.spec.ts` iterates combinations:

- `densities = ["compact", "comfortable", "spacious"]`
- `filters = ["none", "view=purchases", "search=abc", "types=purchase,usage"]`
- `drawerStates = ["closed", "open"]`

For each combination, navigate, inject axe-core, assert zero violations. Skip combinations that don't render any rows (empty case). 3×4×2 = 24 combinations; total test time ~40s.

## TDD sequence — pure logic only

**None new.** All pure logic from plans 01 + 05 already green.

## Files touched

### New

- `components/billing/transactions/use-transactions-keyboard.ts`
- `components/billing/transactions/transactions-list-skeleton.tsx` (if not shipped in plan 03)
- `components/billing/transactions/transactions-error-banner.tsx`
- `components/billing/transactions/transactions-empty-state.tsx`
- `components/billing/transactions/use-transactions-keyboard.test.tsx`
- `components/billing/transactions/transactions-error-banner.test.tsx`
- `components/billing/transactions/transactions-empty-state.test.tsx`
- `tests/perf/billing-transactions.bench.ts`
- `tests/perf/fixtures/transactions.ts`
- `e2e/billing/transactions.spec.ts`
- `e2e/billing/transactions.axe.spec.ts`

### Modified

- `components/billing/transactions/transactions-panel-client.tsx` — mount keyboard hook, pass `activeId` / `isActive` to rows, render error banner / empty states via helpers, add top-of-file `data-*` contract JSDoc.
- `components/billing/transactions/transaction-row.tsx` — confirm `isActive` + `data-txn-active` wired; add inset focus-visible ring.
- `app/globals.css` — reduced-motion overrides for the progress bar + pulse.
- `messages/en-US.json` — empty-state, error-banner strings.
- `package.json` — add `"bench:transactions": "vitest bench tests/perf/billing-transactions.bench.ts"` script.

### Dependencies

- None.

## Migration stance — **none**

Pure polish. No schema, no query, no mutation changes.

## Test plan

### `use-transactions-keyboard.test.tsx`

- `/` focuses the search input.
- `ArrowDown` from no active → first row becomes active; `data-txn-active="true"`.
- `ArrowDown` past end → clamped to last row.
- `ArrowUp` from first → stays at first.
- `Enter` with active → `onActivateRow(id)` called.
- `Escape` with drawer open → `onCloseDrawer` called.
- `Escape` on search input with value → `onClearSearch` called.
- `Cmd+E` on Mac, `Ctrl+E` on non-Mac → `onOpenExport` called.
- Rows change (filter reduces set) → `activeId` reset if no longer in list.

### `transactions-error-banner.test.tsx`

- Renders `role="alert"` + message.
- Retry button click → `onRetry` called.

### `transactions-empty-state.test.tsx`

- `kind="no-data"` → renders `Wallet` icon + "Buy credits" CTA link to `/settings/billing#topup`.
- `kind="no-matches"` → renders `Filter` icon + "Clear filters" button that calls `onClearFilters`.
- `data-transactions-empty` reflects the kind.

### `transactions-panel-client.test.tsx` (extend)

- Error thrown in query → `<TransactionsErrorBanner>` visible with `role="alert"`.
- No data → `<TransactionsEmptyState kind="no-data">`.
- Active filter + no matches → `<TransactionsEmptyState kind="no-matches">`.
- Keyboard: focus list, ArrowDown, Enter → drawer opens.
- `data-txn-active` flips with arrow nav.

### E2E

See § 9 above. Each scenario gets its own `test()` block.

### Axe

See § 10. One test iterates the matrix.

### Perf bench

Run `npm run bench:transactions`; no hard assertion in CI. Commit the baseline numbers to `tests/perf/BASELINES.md` for reference.

## Acceptance criteria

- [ ] Keyboard: `/`, `↑/↓`, `Enter`, `Esc`, `Cmd+E` all work as documented.
- [ ] `aria-activedescendant` updates on arrow nav; `data-txn-active` on the active row.
- [ ] Error banner appears inside the panel on query failure; retry works.
- [ ] Empty state: "no-data" + "no-matches" variants both render with correct CTA.
- [ ] Skeleton rows render during first-page load.
- [ ] `prefers-reduced-motion` disables progress-bar transition, pulse animation, and (by default) drawer + popover animations.
- [ ] E2E specs pass locally + in CI.
- [ ] Axe matrix (24 combinations) zero violations.
- [ ] Perf bench produces numbers within target thresholds; baselines committed.
- [ ] `data-*` contract documented in JSDoc.
- [ ] No dead code; no stubs left over.

## Known pitfalls

- **Global `keydown` listener + input fields** — the keyboard hook intercepts keys globally and branches on `e.target.tagName === "INPUT"`. If the user is typing in the search field and presses `/`, we must NOT intercept — the hook already guards this. Verify by typing `/` in search: expected behavior = `/` character is inserted, not search-refocus (we're already there).
- **`scrollIntoView({ block: "nearest" })` + sticky headers** — sticky headers overlap the top of the scroll container, so `block: "nearest"` may leave the active row hidden beneath a sticky header. Workaround: adjust the scroll by `-32px` (header height) after the built-in scroll. Defer unless QA surfaces it.
- **`window.addEventListener("keydown")` + modals** — shadcn `Sheet` + `DropdownMenu` + `Popover` all call `preventDefault` on their own Esc handlers. Our Esc handler runs first due to the bubble phase. Use `capture: false` (default) so their internal handlers run before ours; if duplicate-close issues arise, add `if (e.defaultPrevented) return;` at the top of our handler.
- **`Cmd+E` conflict** — browsers don't bind `Cmd+E` by default. Chrome uses it for "search engine quick switch" only in the address bar, not on the page. Safe to claim.
- **Focus returns to row after drawer close** — shadcn `Sheet` returns focus to its `SheetTrigger` prop. Because we open the drawer by setting React state (not via a trigger button), focus lands on `body`. Workaround: in `onCloseDrawer`, `document.getElementById(\`txn-row-${lastActiveId}\`)?.focus()`. Needs `tabindex={-1}` on the row so it's programmatically focusable without polluting tab order.
- **`activeId` reset on filter change** — the hook handles this. But if a user scrolls past the active row, then filters, `activeId` becomes null and the focus ring disappears without warning. Acceptable; optional improvement: flash a toast "Active row no longer matches filter".
- **Error boundary + Convex errors** — Convex doesn't throw on query errors reliably (it returns `undefined` while unsettled). For a genuine error path, the safest bet is `useProtectedPaginatedQuery` exposing a `status === "error"` — verify in `lib/auth/use-auth-query.ts:117`'s implementation; if not, wire a try/catch around the fetch and use an external error state. Delegate an Explore agent: "Read lib/auth/use-auth-query.ts and report the error surface of `useProtectedPaginatedQuery`."
- **Axe false positives on sticky headers** — axe's `list` rule sometimes flags `role="list" > role="listitem"` with non-listitem children (group headers). Use `role="presentation"` on the group headers (plan 03 already did) — verify still the case.
- **Perf bench on CI** — don't gate CI on bench; benchmarks are flaky under container load. Run locally or on a dedicated perf-monitoring job.
- **Fixture data generator** — use a seeded PRNG (`mulberry32(1)` or similar) so bench numbers are reproducible. Document the seed.
- **`prefers-reduced-motion` detection in tests** — jsdom supports `matchMedia` in modern Vitest; set via `Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: true, ... }) })`. Alternatively, detect `useReducedMotion()` by mocking it.
- **`data-*` JSDoc drift** — over time the contract changes. Link the JSDoc to this plan file (`plans/billing-transactions-redesign/06-polish-a11y-tests.md`) so future readers find the canonical reference.
