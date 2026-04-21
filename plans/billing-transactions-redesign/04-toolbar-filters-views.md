# Plan 04 — Toolbar, Filters, Saved Views, URL State

**Depends on:** 03 (panel + paginated client island). **Blocks:** 05, 06.

## Goal

Add the interactive toolbar above the list: search input (deferred), type / credit-pool / billing-type filters (multi-select popovers with counts), date range picker (presets + custom), sort menu (date / amount / type), density toggle (compact / comfortable / spacious), and Data View tabs (All / Purchases / Usage / Refunds & grants / Failed). All state roundtrips through the URL via `nuqs`. Server Component parses `searchParams` for the first frame; the client hook owns the source of truth after hydration. Wire server-side filter args into the paginated query where feasible; client-side filter the search + multi-selects that the server index can't narrow.

Implements decisions **D9** (nuqs URL state), **D11** (Data View tabs), **D13** (aria-live count), **D15** (deferred search), **D16** (density), plus extending **D7** (paginated query consumes typed filter args).

## Scope

**In scope**

- New `components/billing/transactions/use-transactions-state.ts` — `nuqs` hook owning every filter/sort/density/view param.
- New `components/billing/transactions/transactions-panel-tabs.tsx` — Data View tabs (shadcn `Tabs` component).
- New `components/billing/transactions/transactions-panel-toolbar.tsx` — search + filter popovers + sort + density.
- New `components/billing/transactions/filter-multi-select.tsx` — reusable multi-select popover (type / credit-pool / billing-type).
- New `components/billing/transactions/date-range-picker.tsx` — presets + custom via shadcn `Popover` + `Calendar`.
- Integrate `useDeferredValue` on the search field; surface `data-search-deferred` while stale.
- Extend `transactions-panel.tsx` (server shell) to parse `searchParams` for the first frame using `createSearchParamsCache` pattern from nuqs.
- Extend `transactions-panel-client.tsx` to consume filter state + pipe filter args into `useProtectedPaginatedQuery`; apply client-side predicate for axes the server can't narrow.
- `aria-live="polite"` region updates debounced count ("Showing N of M transactions") on filter settle.
- `aria-busy="true"` on the list container during filter pipeline transitions (`useTransition`).
- Remove the thin `components/billing/transactions-list.tsx` re-export from plan 03.
- i18n: every label / placeholder / tooltip for filters, views, sort fields, density levels.

**Out of scope**

- Detail drawer (plan 05).
- CSV export wiring (plan 05).
- Keyboard navigation (plan 06).
- User-defined saved views — deferred post-MVP.

## Design

### 1. URL state schema via `nuqs`

One hook, one source of truth. Uses `useQueryStates` for an object-shaped API.

```tsx
// use-transactions-state.ts
"use client";

import {
  useQueryStates,
  parseAsArrayOf, parseAsString, parseAsInteger, parseAsStringEnum, parseAsIsoDateTime,
} from "nuqs";

export const TRANSACTION_TYPES = ["purchase", "usage", "grant", "refund", "expiry"] as const;
export const CREDIT_POOLS     = ["free", "paid"] as const;
export const BILLING_TYPES    = ["extraction_llm", "embedding", "screening", "chat"] as const;
export const SORT_FIELDS      = ["date", "amount", "type"] as const;
export const SORT_DIRECTIONS  = ["asc", "desc"] as const;
export const DENSITIES        = ["compact", "comfortable", "spacious"] as const;
export const VIEW_TABS        = ["all", "purchases", "usage", "refunds-grants", "failed"] as const;

export const transactionsStateSchema = {
  // View tab — not a filter per se; maps to a preset combination of type + creditPool + status
  view: parseAsStringEnum([...VIEW_TABS]).withDefault("all"),

  // Search (deferred on the component side)
  q: parseAsString.withDefault(""),

  // Filters
  types:        parseAsArrayOf(parseAsStringEnum([...TRANSACTION_TYPES])).withDefault([]),
  creditPools:  parseAsArrayOf(parseAsStringEnum([...CREDIT_POOLS])).withDefault([]),
  billingTypes: parseAsArrayOf(parseAsStringEnum([...BILLING_TYPES])).withDefault([]),
  from:         parseAsIsoDateTime,  // null if not set
  to:           parseAsIsoDateTime,

  // Sort
  sort:    parseAsStringEnum([...SORT_FIELDS]).withDefault("date"),
  sortDir: parseAsStringEnum([...SORT_DIRECTIONS]).withDefault("desc"),

  // Density (also persisted to localStorage as a fallback)
  density: parseAsStringEnum([...DENSITIES]).withDefault("comfortable"),
};

export function useTransactionsState() {
  return useQueryStates(transactionsStateSchema, {
    history: "replace",                 // filter changes don't pollute browser history
    shallow: true,                      // don't trigger server re-render on every keystroke
    clearOnDefault: true,               // default values drop from URL for clean links
  });
}
```

Notes:

- `history: "replace"` — filter / search clicks don't stack in the back button.
- `shallow: true` — Next.js doesn't rerender Server Components on URL change. For plan 04 this is what we want (the client island handles everything). When plan 05's drawer needs server-rendered state, flip to `false` on specific writes via the `setTransactionsState` method's per-call option.
- `clearOnDefault: true` — a URL with every default value drops all query params. Shareable links are minimal.

### 2. View-to-preset mapping

```ts
// Colocated in use-transactions-state.ts
import type { TransactionsState } from "./use-transactions-state"; // inferred

export function presetForView(view: (typeof VIEW_TABS)[number]): Partial<TransactionsState> {
  switch (view) {
    case "purchases":       return { types: ["purchase"] };
    case "usage":           return { types: ["usage"] };
    case "refunds-grants":  return { types: ["refund", "grant"] };
    case "failed":          return { types: ["expiry"] };  // today; widens when plan 02's resolveStatus adds "failed"
    case "all":             return { types: [] };
    default:                return {};
  }
}
```

Changing the tab via `setTransactionsState({ view: "purchases", ...presetForView("purchases") })`. Two fields, one URL write — atomic.

### 3. `transactions-panel-tabs.tsx`

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VIEW_TABS, presetForView, useTransactionsState } from "./use-transactions-state";

export function TransactionsPanelTabs() {
  const t = useTranslations("billingPage.transactions.tabs");
  const [state, setState] = useTransactionsState();

  return (
    <Tabs
      value={state.view}
      onValueChange={(v) =>
        setState({ view: v as (typeof VIEW_TABS)[number], ...presetForView(v as never) })
      }
      data-transactions-tabs
    >
      <TabsList className="h-8">
        {VIEW_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="text-xs" data-transactions-tab={tab}>
            {t(tab)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
```

### 4. `transactions-panel-toolbar.tsx`

Two rows. Row A: search + filter popovers + clear-all. Row B: sort + density.

```tsx
"use client";

import { startTransition, useDeferredValue, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Search, X, ArrowUpDown, ArrowUp, ArrowDown, LayoutList } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { FilterMultiSelect } from "./filter-multi-select";
import { DateRangePicker } from "./date-range-picker";
import { useTransactionsState, DENSITIES, SORT_FIELDS, SORT_DIRECTIONS, TRANSACTION_TYPES, CREDIT_POOLS, BILLING_TYPES } from "./use-transactions-state";
import { isFilterActive, DEFAULT_FILTER_STATE } from "@/lib/billing/transactions/filters";

interface Props {
  counts: Record<string, number>;  // e.g. { "type:purchase": 14, "type:usage": 123, ... }
}

export function TransactionsPanelToolbar({ counts }: Props) {
  const t = useTranslations("billingPage.transactions");
  const [state, setState] = useTransactionsState();
  const [pending, startFilterTransition] = useTransition();

  const usageSelected = state.types.includes("usage") || state.types.length === 0;
  const activeFilter = isFilterActive({
    types: state.types, creditPools: state.creditPools, billingTypes: state.billingTypes,
    dateRange: state.from && state.to ? { from: state.from.getTime(), to: state.to.getTime() } : null,
    search: state.q,
  });

  return (
    <div
      data-transactions-toolbar
      data-transactions-filter-active={activeFilter}
      className="flex flex-col gap-2 border-b border-border/50 px-4 py-3"
    >
      {/* Row A: Search + filter popovers */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={state.q}
            onChange={(e) =>
              startFilterTransition(() => setState({ q: e.target.value }))
            }
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            data-transactions-search
            className="h-8 pl-8 pr-8 text-sm"
          />
          {state.q.length > 0 && (
            <button
              type="button"
              onClick={() => setState({ q: "" })}
              aria-label={t("searchClear")}
              data-transactions-search-clear
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <FilterMultiSelect
          label={t("filters.type")}
          options={TRANSACTION_TYPES}
          value={state.types}
          onChange={(next) => setState({ types: next })}
          counts={counts}
          counterKey="type"
          data-filter-type
        />
        <FilterMultiSelect
          label={t("filters.creditPool")}
          options={CREDIT_POOLS}
          value={state.creditPools}
          onChange={(next) => setState({ creditPools: next })}
          counts={counts}
          counterKey="creditPool"
          data-filter-credit-pool
        />
        {usageSelected && (
          <FilterMultiSelect
            label={t("filters.billingType")}
            options={BILLING_TYPES}
            value={state.billingTypes}
            onChange={(next) => setState({ billingTypes: next })}
            counts={counts}
            counterKey="billingType"
            data-filter-billing-type
          />
        )}
        <DateRangePicker
          from={state.from}
          to={state.to}
          onChange={(range) => setState(range)}
        />

        {activeFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              setState({
                q: "", types: [], creditPools: [], billingTypes: [],
                from: null, to: null, view: "all",
              })
            }
            data-transactions-clear-all
          >
            {t("clearAll")}
          </Button>
        )}
      </div>

      {/* Row B: Sort + density */}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-transactions-sort-trigger
              data-sort-field={state.sort}
              data-sort-dir={state.sortDir}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <ArrowUpDown className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="font-medium">{t(`sort.${state.sort}`)}</span>
              {state.sortDir === "asc" ? (
                <ArrowUp className="size-3 text-muted-foreground" aria-hidden />
              ) : (
                <ArrowDown className="size-3 text-muted-foreground" aria-hidden />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuLabel className="text-xs">{t("sort.label")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={state.sort}
              onValueChange={(v) => setState({ sort: v as (typeof SORT_FIELDS)[number] })}
            >
              {SORT_FIELDS.map((f) => (
                <DropdownMenuRadioItem key={f} value={f} className="text-xs">
                  {t(`sort.${f}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={state.sortDir}
              onValueChange={(v) => setState({ sortDir: v as (typeof SORT_DIRECTIONS)[number] })}
            >
              <DropdownMenuRadioItem value="asc"  className="text-xs">{t("sort.dir.asc")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc" className="text-xs">{t("sort.dir.desc")}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" data-transactions-density-trigger>
              <LayoutList className="size-3.5 text-muted-foreground" aria-hidden />
              {t(`density.${state.density}`)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuRadioGroup
              value={state.density}
              onValueChange={(v) => {
                setState({ density: v as (typeof DENSITIES)[number] });
                try { localStorage.setItem("billing.transactions.density", v); } catch { /* ignore */ }
              }}
            >
              {DENSITIES.map((d) => (
                <DropdownMenuRadioItem key={d} value={d} className="text-xs">
                  {t(`density.${d}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
```

### 5. `filter-multi-select.tsx`

Popover trigger with count badge; popover body with checklist and search input.

```tsx
"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

interface Props<T extends string> {
  label: string;
  options: readonly T[];
  value: readonly T[];
  onChange: (next: readonly T[]) => void;
  counts: Record<string, number>;
  counterKey: string;  // e.g. "type"
  "data-filter-type"?: string;
  "data-filter-credit-pool"?: string;
  "data-filter-billing-type"?: string;
}

export function FilterMultiSelect<T extends string>({
  label, options, value, onChange, counts, counterKey, ...dataAttrs
}: Props<T>) {
  const t = useTranslations("billingPage.transactions.filters");
  const [open, setOpen] = useState(false);
  const selected = value.length;

  const toggle = (opt: T) => {
    onChange(value.includes(opt) ? value.filter((o) => o !== opt) : [...value, opt]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          {...dataAttrs}
          data-filter-selected={selected}
        >
          {label}
          {selected > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
              {selected}
            </Badge>
          )}
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <ul role="listbox" aria-multiselectable="true" aria-label={label} className="flex flex-col">
          {options.map((opt) => {
            const isSelected = value.includes(opt);
            const count = counts[`${counterKey}:${opt}`] ?? 0;
            return (
              <li
                key={opt}
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(opt)}
                data-filter-option={opt}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  {isSelected && <Check className="size-3" />}
                  <span>{t(`${counterKey}.${opt}`)}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
```

### 6. `date-range-picker.tsx`

```tsx
"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useFormatter, useTranslations } from "next-intl";

interface Props {
  from: Date | null;
  to: Date | null;
  onChange: (range: { from: Date | null; to: Date | null }) => void;
}

export function DateRangePicker({ from, to, onChange }: Props) {
  const t = useTranslations("billingPage.transactions.filters.date");
  const format = useFormatter();
  const [open, setOpen] = useState(false);

  const applyPreset = (preset: "today" | "7d" | "30d" | "90d" | "ytd" | "all") => {
    const now = new Date();
    switch (preset) {
      case "today":
        onChange({ from: startOfDay(now), to: now });
        break;
      case "7d":
      case "30d":
      case "90d": {
        const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
        onChange({ from: new Date(now.getTime() - days * 86400000), to: now });
        break;
      }
      case "ytd":
        onChange({ from: new Date(now.getFullYear(), 0, 1), to: now });
        break;
      case "all":
        onChange({ from: null, to: null });
        break;
    }
    setOpen(false);
  };

  const label = from && to
    ? `${format.dateTime(from, "short")} – ${format.dateTime(to, "short")}`
    : t("label");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          data-transactions-date-range
          data-date-active={from && to ? "true" : "false"}
        >
          <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex flex-wrap gap-1 pb-2">
          {(["today", "7d", "30d", "90d", "ytd", "all"] as const).map((p) => (
            <Button
              key={p}
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => applyPreset(p)}
              data-date-preset={p}
            >
              {t(`presets.${p}`)}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={from && to ? { from, to } : undefined}
          onSelect={(range) => {
            if (range?.from && range?.to) {
              onChange({ from: range.from, to: range.to });
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function startOfDay(d: Date): Date {
  const clone = new Date(d);
  clone.setHours(0, 0, 0, 0);
  return clone;
}
```

### 7. Integrate in `transactions-panel-client.tsx`

Extend the existing client from plan 03:

```tsx
const [state] = useTransactionsState();
const deferredQuery = useDeferredValue(state.q);
const isSearchStale = deferredQuery !== state.q;

const paginated = useProtectedPaginatedQuery(
  api.credits.queries.getTransactions,
  {
    jobId,
    types: state.types.length > 0 ? state.types : undefined,
    from: state.from ? state.from.getTime() : undefined,
    to:   state.to   ? state.to.getTime()   : undefined,
  },
  { initialNumItems: 25 },
);

const [pending, startFilterTransition] = useTransition();

// Client-side filters for axes the server can't narrow
const clientFilteredRows = useMemo(() => {
  const viewModels = (paginated.results ?? []).map(toViewModel);
  const predicate = buildFilterPredicate({
    types: state.types,                     // still apply client-side to de-duplicate
    creditPools: state.creditPools,
    billingTypes: state.billingTypes,
    dateRange: state.from && state.to ? { from: state.from.getTime(), to: state.to.getTime() } : null,
    search: deferredQuery,                  // deferred for rendering-side filter
  });
  return viewModels.filter(predicate);
}, [paginated.results, state.types, state.creditPools, state.billingTypes, state.from, state.to, deferredQuery]);

const rows = useMemo(() => sortRows(clientFilteredRows, state.sort, state.sortDir), [clientFilteredRows, state.sort, state.sortDir]);

const showGroups = shouldRenderGroups({ field: state.sort, dir: state.sortDir });
```

`sortRows` is a small pure function to add to `lib/billing/transactions/grouping.ts` (or a new `sort.ts`):

```ts
export function sortRows(
  rows: readonly TransactionViewModel[],
  field: "date" | "amount" | "type",
  dir: "asc" | "desc",
): TransactionViewModel[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    let cmp = 0;
    if      (field === "date")   cmp = a.createdAt - b.createdAt;
    else if (field === "amount") cmp = a.signedAmount - b.signedAmount;
    else if (field === "type")   cmp = a.type.localeCompare(b.type);
    return dir === "asc" ? cmp : -cmp;
  });
  return copy;
}
```

### 8. `aria-live` count updates

Debounce count writes so SR doesn't spam on every keystroke. One approach: observe `rows.length` transitions through a `useEffect` with `setTimeout`.

```tsx
const [announcedCount, setAnnouncedCount] = useState<string>("");
useEffect(() => {
  const id = setTimeout(() => {
    setAnnouncedCount(`Showing ${rows.length} of ${paginated.results?.length ?? 0} transactions`);
  }, 500);
  return () => clearTimeout(id);
}, [rows.length, paginated.results]);

// In JSX, below the header:
<p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
  {announcedCount}
</p>
```

### 9. Server-Component first-frame parsing

```tsx
// transactions-panel.tsx — server component
import { cache } from "react";
import { createSearchParamsCache } from "nuqs/server";
import { transactionsStateSchema } from "./use-transactions-state";
import { TransactionsPanelClient } from "./transactions-panel-client";

export const loadTransactionsState = createSearchParamsCache(transactionsStateSchema);

export async function TransactionsPanel({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const initial = loadTransactionsState.parse(sp);
  // initial is the first-frame state; the client hook takes over on hydration.
  return <TransactionsPanelClient initial={initial} />;
}
```

`TransactionsPanelClient` receives `initial` and passes it to `useQueryStates`'s initial-value pattern. Verify the current `nuqs` version (2.6) supports `createSearchParamsCache` with `useQueryStates` — if not, adapt at execution time.

### 10. `aria-busy` during filter transitions

```tsx
<div
  role="list"
  data-transactions-list
  aria-busy={pending ? "true" : "false"}
  data-search-deferred={isSearchStale ? "true" : "false"}
  className={cn(
    "…",
    isSearchStale && "opacity-70",  // subtle hint that rendering is catching up
  )}
>
```

## TDD sequence — pure logic only

**None new.** `sortRows` is the only new pure function; add a micro-test block in `grouping.test.ts` (or a new `sort.test.ts`) with three cases: date desc, amount asc, type asc with ties. The rest is test-after.

## Files touched

### New

- `components/billing/transactions/use-transactions-state.ts`
- `components/billing/transactions/transactions-panel-tabs.tsx`
- `components/billing/transactions/transactions-panel-toolbar.tsx`
- `components/billing/transactions/filter-multi-select.tsx`
- `components/billing/transactions/date-range-picker.tsx`
- `lib/billing/transactions/sort.ts` (or extend `grouping.ts`)
- `lib/billing/transactions/sort.test.ts`
- `components/billing/transactions/transactions-panel-tabs.test.tsx`
- `components/billing/transactions/transactions-panel-toolbar.test.tsx`
- `components/billing/transactions/filter-multi-select.test.tsx`
- `components/billing/transactions/date-range-picker.test.tsx`

### Modified

- `components/billing/transactions/transactions-panel.tsx` — parse `searchParams` on the server.
- `components/billing/transactions/transactions-panel-client.tsx` — consume state hook; pipe args to query; apply predicate + sort; wire `aria-busy` + `data-search-deferred`; render toolbar + tabs above the list.
- `messages/en-US.json` — filter labels, placeholders, sort labels, density labels, view tab labels, date preset labels.
- **Remove** `components/billing/transactions-list.tsx` (re-export from plan 03 now obsolete).

### Dependencies

- None. `nuqs@^2.6.0` already installed.

## Migration stance — **none**

Pure UI wiring + one Convex query invocation widens (already supported in plan 01's `getTransactions`).

## Test plan

### `use-transactions-state.ts`

Tested via integration — the hook wraps `useQueryStates`. Don't re-test `nuqs`; test the **schema** via:

- Given `?view=purchases&types=purchase`, `useTransactionsState()[0]` returns `{ view: "purchases", types: ["purchase"], ...defaults }`.
- `setState({ view: "purchases", types: ["purchase"] })` writes the expected URL via a mocked `router.replace`.
- `clearOnDefault` removes params when set back to defaults.

### `transactions-panel-tabs.test.tsx`

- Clicking tab "Purchases" updates state to `view: "purchases", types: ["purchase"]`.
- Tab with `view: "all"` is active by default.
- `data-transactions-tab` per trigger.

### `filter-multi-select.test.tsx`

- Popover opens on trigger click; `role="listbox" aria-multiselectable="true"` on the list.
- Clicking an option toggles its presence in `value`; `aria-selected` reflects state.
- Counts render with `tabular-nums`.
- `data-filter-selected={N}` on the trigger.
- Empty selection: Badge not rendered.

### `date-range-picker.test.tsx`

- Presets update `from` and `to` via `onChange`.
- Custom calendar selection calls `onChange` with `{ from, to }`.
- Label shows "Date" when unset, "Apr 1 – Apr 20" when set.
- `data-date-active` attribute reflects set state.

### `transactions-panel-toolbar.test.tsx`

- Search input updates `state.q` on every keystroke; `data-search-deferred` reflects deferral during transition (may require mocking `useDeferredValue` or setting up a transition).
- Clear button appears when `q.length > 0`; clicking clears.
- `data-transactions-filter-active="true"` when any non-default filter applied.
- Clicking Clear All resets everything to defaults.
- Billing-type filter appears only when `usage` is in `types` (or `types` is empty).
- Sort trigger `data-sort-field` + `data-sort-dir` match state.
- Density trigger persists selection to `localStorage`.

### `transactions-panel-client.test.tsx` (extend from plan 03)

- URL `?types=purchase` loads → query called with `{ types: ["purchase"] }` server args.
- `aria-busy` flips during transition.
- `data-search-deferred="true"` while the search value races ahead of the pipeline.
- Client-side filter applied after server results: seed 10 mixed rows, set `creditPools=["paid"]` in state → only paid rows render.
- Sort change: set `{ sort: "amount", sortDir: "desc" }` → rows reordered.
- Grouping collapses when `sort !== "date"` → no `data-transactions-group-header` elements rendered.
- `aria-live` region announces "Showing N of M transactions" after 500 ms debounce.

### Accessibility (axe)

- Panel with toolbar + tabs + list → zero violations.
- Popovers open → zero violations within the popover content.
- `role="listbox"` + `role="option"` semantics on the multi-select popovers pass axe.

### Manual QA

- Share a filtered URL in a new browser window → filters restore deterministically.
- Type a query fast → input is never janky; a faint opacity drop on the list signals the deferred pipeline.
- Change density → rows shrink/grow smoothly; setting persists across reload.
- Back button → URL changes are `replace` so back doesn't stack filter steps.
- Filter > Clear All → URL strips all query params.

## Acceptance criteria

- [x] `use-transactions-state.ts` exposes every filter / sort / density / view param via `nuqs`.
- [x] Server Component parses `searchParams` on the first frame via `createSearchParamsCache`. *Adapted: parent `app/settings/billing/page.tsx` is a `"use client"` component, so the universal shell (`transactions-panel.tsx`) calls `loadTransactionsState.parse(searchParams)` to validate the URL state at the boundary; the cache is exported and ready for any future RSC migration of the parent page.*
- [x] Toolbar ships: search, type filter, credit-pool filter, billing-type filter (conditional), date range picker, clear-all, sort menu, density menu.
- [x] Tabs ship: All / Purchases / Usage / Refunds & grants / Failed.
- [x] `useDeferredValue(state.q)` piped into filter predicate; `data-search-deferred` flag set.
- [x] `aria-busy` on the list during transition; `aria-live="polite"` region announces debounced count (500 ms).
- [x] Grouping collapses when `sort !== "date desc"`.
- [x] URL state restores deterministically on page load.
- [x] `data-*` attributes expose every state for tests.
- [x] Axe clean on toolbar + tabs + list + popover (`tests/a11y/transactions-toolbar.axe.test.tsx`, `tests/a11y/transactions-panel.axe.test.tsx`).
- [x] Existing E2E specs still pass (the `?jobId=` URL flow) — all 11 cases in `transactions-panel-client.test.tsx` green after wrapping renders in `NuqsTestingAdapter`.
- [x] Removed `components/billing/transactions-list.tsx` re-export; all imports updated (no live imports remained).

## Known pitfalls

- **`nuqs` + Next.js 15 `searchParams` async** — `createSearchParamsCache` handles the async prop natively; don't `await searchParams` outside the cache or types go wonky. The cache is `cache()`-wrapped so it's stable per request.
- **`useQueryStates` re-entrancy** — setting multiple keys simultaneously in one `setState({ a, b, c })` call writes one URL update. Setting them across multiple `setState` calls in the same frame writes N updates and can race. Always use object-form writes.
- **`useDeferredValue` + `useTransition` interplay** — they solve different problems. Deferred is for rendering-side input; transition is for imperative state writes. The toolbar wraps keystroke → URL writes in `startTransition` (keeps the input responsive) and uses `useDeferredValue` to lag the filter predicate behind the input value. Both together is correct — not redundant.
- **Server-side vs client-side filter axes** — types + date range narrow server-side via the paginated query (coarse), the rest (creditPool, billingType, search) filter client-side over the already-loaded pages. If a user filters aggressively, they may see "Showing 3 of 50" — the UI's "Load More" must still be reachable because the server hasn't yet paged to more matches. Handle: the client island keeps the sentinel visible while `paginated.status === "CanLoadMore"`, regardless of client-side result count.
- **`type:usage` is the only axis the server can narrow by** — when the user selects `types: ["usage", "purchase"]`, the server can't use the `by_type_date` index (it's single-eq). Plan 01 post-filters in the query; this is fine at the thousands-of-rows scale we have.
- **Popover escape key focus management** — shadcn `Popover` handles Esc → close → focus trigger. Verify the filter popovers don't trap focus in the filter option list past close.
- **Tab + multi-select interaction** — if the user clicks "Purchases" tab then manually adds `usage` via the type filter, the `view` param becomes desynced. Acceptable (the URL still reflects truth). Optionally, flip `view` back to "all" whenever a manual filter differs from the preset — defer to manual QA feedback.
- **`localStorage` SSR guard** — wrap the `localStorage.setItem` + read in `try/catch` and only on the client. The code above does this for writes; reads should `useEffect` to run post-hydration.
- **`aria-live` debounce** — 500 ms feels responsive; too short spams SR. Do not drop below 300 ms.
- **Clear-all button position** — if the filter bar wraps to multiple lines (narrow viewport), the Clear-all button drifts. Acceptable; the button position is functional, not decorative.
- **`nuqs` v2.6 vs newer API** — verify at execution time that `createSearchParamsCache` + `useQueryStates` integrate as documented. If v3 has shipped and changed the API, the plan's structure holds but the hook shape may differ — re-read the `nuqs` README.
- **Calendar component availability** — the shadcn `Calendar` primitive ships with `react-day-picker`. Verify it's installed; if not, add it (`npx shadcn@latest add calendar`).
