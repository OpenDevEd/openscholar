# Phase 101: Workbench Primitives - Research

**Researched:** 2026-04-16
**Domain:** TanStack React Table v8 headless primitives + Zustand persistence + filter toolbar composition
**Confidence:** HIGH

## Summary

Phase 101 installs `@tanstack/react-table@^8.21.3` as the sole net-new runtime dependency and builds the reusable headless primitives that Phase 103's 4-view workbench will consume. The work is purely primitives: a `WorkbenchShell` component owning a single `useReactTable` instance, a `WorkbenchToolbar` with sort/filter controls wrapped in the existing `FilterSection` chrome, a Zustand store for column visibility and active view persistence, and hoisted column definitions with memoized cell renderers.

The existing codebase already has the shadcn `<Table />` primitive at `components/ui/table.tsx`, the `FilterSection` component at `components/shared/filter-section.tsx`, badge renderers for confidence and status, and established Zustand persist patterns in both `lib/store.ts` and `lib/store/extraction-basket.ts`. The research confirms TanStack Table v8.21.3 is the current latest on npm, its peer dependency (`react >=16.8`) is compatible with the project's React 19.2.4, and the library's headless architecture directly supports the "one instance, multiple views" pattern required by the 4-view workbench.

**Primary recommendation:** Install `@tanstack/react-table@^8.21.3`, hoist column definitions at module level in `lib/extraction/workbench-columns.tsx`, create the Zustand store in `lib/store/extraction-results-view.ts` using the `create<T>()(persist(...))` pattern with `localStorage`, and compose the toolbar using `FilterSection` wrappers around shadcn `Select` and `Input` controls.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `WorkbenchShell` owns the single `useReactTable(...)` instance, passes `table` object to child views via props (not React context). Shell always mounted on `/extraction/[jobId]`, active view swapped beneath.
- **D-02:** `useReactTable` receives `data`, `columns`, `state`, `onStateChange` from the shell. Sorting and column filter state in shell local state. Column visibility from Zustand store (D-05). Never recompute options inline.
- **D-03:** Column definitions in `lib/extraction/workbench-columns.tsx`, hoisted at module level. Static columns: title, authors, year, DOI, status, confidence, parsingSource. Dynamic columns: one per extraction question. Cell renderers for expensive cells use `React.memo`.
- **D-04:** Column definition function: `createWorkbenchColumns(questions: ExtractionQuestion[])` returning `ColumnDef[]`. Shell calls once when questions loaded, memoized via `useMemo` keyed on `questions`.
- **D-05:** Zustand store in `lib/store/extraction-results-view.ts` using `create<T>()(persist(...))` pattern (NOT `createSidebarStore`). Shape: `{ columnVisibility: Record<string, boolean>, activeView: "table" | "card" | "split", setColumnVisibility, toggleColumn, setActiveView }`. Persist key: `extraction-results-view`. Storage: `localStorage`.
- **D-06:** `WorkbenchToolbar` in `components/extraction/workbench-toolbar.tsx`. Filter groups wrapped in `FilterSection` primitive (WB-10). Filter groups: status (dropdown), confidence (dropdown), year (range input), venue (text input), answer value (per-question text input).
- **D-07:** Toolbar is horizontal bar above all views (not sidebar). Includes view switcher (D-08), column visibility toggle (popover with checkboxes), sort controls, filter groups. All state changes update `useReactTable` via shell's `onStateChange`. Toolbar is view-agnostic.
- **D-08:** View switcher is segmented control (shadcn `ToggleGroup` or custom) with `table`, `card`, `split` options. Active view stored in Zustand store (D-05). View switches do NOT re-fetch data or re-create `useReactTable`.

### Claude's Discretion
- Exact Tailwind styling for toolbar layout and segmented control
- Whether filter dropdowns use shadcn `Select` or `Popover` + `Command`
- Internal naming for sub-components within the toolbar
- Test file organization for column definitions and toolbar interactions
- Whether to expose a `useWorkbenchStore` hook or import the store directly
- Animation transitions between views (use existing `lib/animation-config.ts` presets)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WB-01 | Table view with TanStack React Table + shadcn Table primitive | TanStack Table v8.21.3 verified on npm, peer deps compatible with React 19.2.4, `components/ui/table.tsx` already exists. Column definitions + `useReactTable` hook + `flexRender` pattern documented. |
| WB-02 | Column visibility persistence via Zustand store keyed `extraction-results-view` | Zustand v5.0.5 installed, `persist` middleware pattern documented from `extraction-basket.ts` and `lib/store.ts`. TanStack Table `onColumnVisibilityChange` + `state.columnVisibility` API confirmed. |
| WB-03 | Sort/filter toolbar for status, confidence, year, venue, answer value | TanStack Table `getSortedRowModel`, `getFilteredRowModel`, `ColumnFiltersState`, `SortingState` APIs confirmed. `FilterSection` component API (`title`, `icon`, `isActive`, `onClear`, `children`) documented. |
| WB-10 | Reuse v2.2 `FilterSection` primitive as outer chrome for all filter toggles | `FilterSection` at `components/shared/filter-section.tsx` confirmed: `React.memo` wrapped, accepts `title`, `icon`, `isActive`, `onClear`, `headerAction`, `children`. Already uses `motion/react` and `next-intl`. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Table instance (`useReactTable`) | Browser / Client | -- | Headless table state is purely client-side; no server involvement |
| Column definitions | Browser / Client | -- | Static module-level definitions consumed by client-side hook |
| Sort/filter state | Browser / Client | -- | Client-side TanStack Table state; does not modify server data |
| Column visibility persistence | Browser / Client | -- | `localStorage` via Zustand persist; no server round-trip |
| View switcher state | Browser / Client | -- | Client preference stored in Zustand; no backend involvement |
| Filter toolbar UI | Browser / Client | -- | React components composing existing shadcn/FilterSection primitives |
| Data fetching (`getExtractionResults`) | API / Backend | Browser / Client | Convex reactive query runs server-side; client consumes via `useProtectedQuery` (Phase 103 concern, not this phase) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@tanstack/react-table` | 8.21.3 | Headless table state management (sorting, filtering, column visibility, pagination) | [VERIFIED: npm registry] Only headless table library that supports sharing one instance across multiple view renderers. De facto standard for React data tables. |
| `zustand` | 5.0.5 (installed) | Column visibility + active view persistence | [VERIFIED: package.json] Already project standard for all client state. `persist` middleware with `localStorage` for cross-session preferences. |
| `react` | 19.2.4 (installed) | Component framework | [VERIFIED: package.json] Project uses React 19 with React Compiler enabled. |

### Supporting (already installed, no new deps)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `motion/react` | 12.23.12 | View transition animations | [VERIFIED: package.json] Use `subtleSpring` and `cardEntrance` from `lib/animation-config.ts` for view switcher transitions |
| `lucide-react` | 0.487.0 | Icons for toolbar controls | [VERIFIED: package.json] Filter, columns, layout icons |
| `next-intl` | 4.8.2 | i18n for toolbar labels and filter names | [VERIFIED: package.json] All user-facing strings go through `useTranslations("extraction")` |
| `radix-ui` | 1.4.3 | Underlying primitives for shadcn Select, Popover | [VERIFIED: package.json] Already powering existing UI components |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@tanstack/react-table` v8 | TanStack Table v9 alpha | v9 is still alpha (explicitly rejected in CONTEXT.md). Not production-ready. [VERIFIED: CONTEXT.md anti-features] |
| `@tanstack/react-table` | AG Grid Community | 500 KB bundle, enterprise skin clashes with Tailwind v4 tokens (explicitly rejected) [VERIFIED: CONTEXT.md anti-features] |
| `@tanstack/react-table` | shadcn `data-table` block | Monolithic component -- fights the 4-view architecture where one `useReactTable` instance must be shared (explicitly rejected) [VERIFIED: CONTEXT.md anti-features] |
| Custom Zustand store | `createSidebarStore` factory | Different shape -- sidebar stores have `isCollapsed/toggle`, workbench store has `columnVisibility/activeView` [VERIFIED: CONTEXT.md D-05] |

**Installation:**
```bash
npm install @tanstack/react-table@^8.21.3
```

**Version verification:**
- `@tanstack/react-table`: 8.21.3 is latest on npm [VERIFIED: npm registry 2026-04-16]
- Peer deps: `react >=16.8, react-dom >=16.8` -- compatible with project's React 19.2.4 [VERIFIED: npm registry]
- No shadcn `toggle-group` component exists yet -- must add via `npx shadcn@latest add toggle-group` if the segmented control uses it [VERIFIED: components/ui/ listing]

## Architecture Patterns

### System Architecture Diagram

```
                    Convex Backend
                         |
                  getExtractionResults
                  (reactive query)
                         |
                         v
              +--------------------+
              |   WorkbenchShell   |  <-- owns useReactTable instance
              |  (client component)|      receives data from useProtectedQuery
              +---------+----------+
                        |
          +-------------+-------------+
          |             |             |
     data, columns   state      onStateChange
          |             |             |
          v             v             v
  +-------+-----+ +----+------+ +----+-------+
  | useReactTable| | Zustand   | | Shell      |
  | (headless)   | | Store     | | local      |
  |              | | (col vis, | | state      |
  | columns      | |  active   | | (sorting,  |
  | data         | |  view)    | |  filters)  |
  | state        | | persist:  | |            |
  | row models   | | localStorage           |
  +-+----+----+--+ +-----------+ +------------+
    |    |    |
    v    v    v
  +---+ +---+ +----+
  | T | | C | | Sp |   <-- Phase 103 view components
  | a | | a | | li |       consume table instance via props
  | b | | r | | t  |
  | l | | d | |    |
  | e | |   | |    |
  +---+ +---+ +----+
    ^    ^    ^
    |    |    |
    +----+----+
         |
  WorkbenchToolbar
  (horizontal bar above views)
  [ViewSwitcher] [SortControls] [FilterGroups] [ColumnVisibility]
         |
  Each FilterGroup wrapped in FilterSection primitive (WB-10)
```

### Recommended Project Structure
```
lib/
├── extraction/
│   ├── export.ts                     # (existing) export helpers
│   └── workbench-columns.tsx         # NEW: createWorkbenchColumns() + cell renderers
├── store/
│   ├── extraction-basket.ts          # (existing) basket store
│   └── extraction-results-view.ts    # NEW: column visibility + active view store
components/
├── extraction/
│   ├── workbench-shell.tsx           # NEW: WorkbenchShell -- owns useReactTable
│   ├── workbench-toolbar.tsx         # NEW: WorkbenchToolbar -- filter/sort/view controls
│   ├── workbench-data-table.tsx      # NEW: DataTable renderer (shadcn Table + flexRender)
│   ├── view-switcher.tsx             # NEW: segmented control for table/card/split
│   ├── column-visibility-toggle.tsx  # NEW: popover with column checkboxes
│   ├── confidence-badge.tsx          # (existing) reused as cell renderer
│   └── status-badge.tsx              # (existing) reused as cell renderer
tests/
├── extraction-results-view-store.test.ts  # NEW: store unit tests
└── workbench-columns.test.ts              # NEW: column definition tests
```

### Pattern 1: Headless Table with Shared Instance
**What:** A single `useReactTable` instance created in a shell component, passed to multiple view renderers via props.
**When to use:** When multiple visual representations (table, card, split) need to share sorting, filtering, and visibility state.
**Example:**
```typescript
// Source: TanStack Table v8 docs (https://tanstack.com/table/latest/docs/framework/react/examples/column-visibility)
// + CONTEXT.md D-01, D-02
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";

// In WorkbenchShell:
const [sorting, setSorting] = useState<SortingState>([]);
const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

// Column visibility from Zustand store (D-05)
const { columnVisibility, setColumnVisibility } = useExtractionResultsViewStore();

const table = useReactTable({
  data,               // from useProtectedQuery
  columns,            // from createWorkbenchColumns (memoized)
  state: {
    sorting,
    columnFilters,
    columnVisibility,
  },
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  onColumnVisibilityChange: setColumnVisibility,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
});

// Pass table to active view
return (
  <>
    <WorkbenchToolbar table={table} />
    {activeView === "table" && <WorkbenchDataTable table={table} />}
    {activeView === "card" && <WorkbenchCardView table={table} />}
    {activeView === "split" && <WorkbenchSplitView table={table} />}
  </>
);
```

### Pattern 2: Hoisted Column Definitions with Memoized Cells
**What:** Column definitions defined at module level (outside any component) to prevent recreation on every render. Dynamic columns generated from a factory function.
**When to use:** When table has 1000+ rows and column-filter interactions would cause re-render storms.
**Example:**
```typescript
// Source: TanStack Table FAQ (https://tanstack.com/table/latest/docs/faq.md)
// + CONTEXT.md D-03, D-04
import { type ColumnDef } from "@tanstack/react-table";
import React from "react";

// Static columns hoisted at module level
const MemoizedConfidenceBadge = React.memo(ConfidenceBadge);
const MemoizedStatusBadge = React.memo(StatusBadge);

// Type for the row data shape from getExtractionResults
interface WorkbenchPaper {
  _id: string;
  title: string;
  openalexId: string;
  doi?: string;
  status: "pending" | "parsing" | "extracting" | "completed" | "failed" | "cancelled";
  parsingSource?: "pmc" | "arxiv" | "unpdf" | "gemini" | "abstract_only";
  results: Array<{
    questionId: string;
    answer: string | null;
    confidence?: "high" | "medium" | "low";
    // ... other fields
  }>;
}

interface ExtractionQuestion {
  key: string;
  question: string;
  expectedType?: string;
}

export function createWorkbenchColumns(
  questions: ExtractionQuestion[],
): ColumnDef<WorkbenchPaper>[] {
  const staticColumns: ColumnDef<WorkbenchPaper>[] = [
    {
      accessorKey: "title",
      header: "Title", // will use i18n in implementation
      cell: (info) => info.getValue(),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <MemoizedStatusBadge status={row.original.status} />,
      filterFn: "equals",
    },
    {
      id: "confidence",
      header: "Confidence",
      // Aggregated confidence from results
      cell: ({ row }) => {
        // Implementation will aggregate confidence from row.original.results
      },
      filterFn: "equals",
    },
    // ... doi, parsingSource columns
  ];

  const questionColumns: ColumnDef<WorkbenchPaper>[] = questions.map((q) => ({
    id: `question-${q.key}`,
    header: q.question,
    accessorFn: (row) =>
      row.results.find((r) => r.questionId === q.key)?.answer ?? null,
    filterFn: "includesString",
  }));

  return [...staticColumns, ...questionColumns];
}
```

### Pattern 3: Zustand Persist Store with localStorage
**What:** A Zustand store with `persist` middleware for cross-session user preferences.
**When to use:** For UI preferences that should survive page navigation and browser restarts (column visibility, active view).
**Example:**
```typescript
// Source: Existing pattern from lib/store.ts:1070-1095 + lib/store/extraction-basket.ts
// + CONTEXT.md D-05
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type ActiveView = "table" | "card" | "split";

interface ExtractionResultsViewState {
  columnVisibility: Record<string, boolean>;
  activeView: ActiveView;
  _hasHydrated: boolean;
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
  toggleColumn: (columnId: string) => void;
  setActiveView: (view: ActiveView) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useExtractionResultsViewStore = create<ExtractionResultsViewState>()(
  persist(
    (set, get) => ({
      columnVisibility: {},
      activeView: "table" as ActiveView,
      _hasHydrated: false,
      setColumnVisibility: (visibility) => set({ columnVisibility: visibility }),
      toggleColumn: (columnId) =>
        set((state) => ({
          columnVisibility: {
            ...state.columnVisibility,
            [columnId]: !(state.columnVisibility[columnId] ?? true),
          },
        })),
      setActiveView: (view) => set({ activeView: view }),
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: "extraction-results-view",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        columnVisibility: state.columnVisibility,
        activeView: state.activeView,
      }),
      migrate: (persistedState: unknown, version: number) => {
        if (version < 1) return { columnVisibility: {}, activeView: "table" };
        return persistedState;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
```

### Pattern 4: FilterSection Reuse for Toolbar Groups
**What:** Wrapping each filter group in the existing `FilterSection` component for consistent chrome.
**When to use:** WB-10 mandates reuse of `FilterSection` for all workbench filter toggles.
**Example:**
```typescript
// Source: components/shared/filter-section.tsx (existing codebase)
// + CONTEXT.md D-06, D-07
import { FilterSection } from "@/components/shared/filter-section";
import { Filter, BarChart3, Calendar, Building2 } from "lucide-react";

// Inside WorkbenchToolbar:
<FilterSection
  title={t("filters.status")}
  icon={Filter}
  isActive={hasActiveStatusFilter}
  onClear={clearStatusFilter}
>
  <Select value={statusFilter} onValueChange={onStatusFilterChange}>
    {/* status options */}
  </Select>
</FilterSection>

<FilterSection
  title={t("filters.confidence")}
  icon={BarChart3}
  isActive={hasActiveConfidenceFilter}
  onClear={clearConfidenceFilter}
>
  <Select value={confidenceFilter} onValueChange={onConfidenceFilterChange}>
    {/* confidence options */}
  </Select>
</FilterSection>
```

### Pattern 5: DataTable Renderer with shadcn Table
**What:** A thin rendering component that maps TanStack Table's `getHeaderGroups()` and `getRowModel()` to shadcn's `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` primitives using `flexRender`.
**When to use:** The table view (one of the three views in Phase 103).
**Example:**
```typescript
// Source: TanStack Table React examples + existing components/ui/table.tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { flexRender, type Table as TanStackTable } from "@tanstack/react-table";

interface WorkbenchDataTableProps<T> {
  table: TanStackTable<T>;
}

export function WorkbenchDataTable<T>({ table }: WorkbenchDataTableProps<T>) {
  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id}>
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

### Anti-Patterns to Avoid
- **Inline column definitions inside components:** Causes infinite re-render loop because TanStack Table detects reference changes on every render. Always hoist or `useMemo`. [VERIFIED: TanStack Table FAQ]
- **Inline `useReactTable` options:** Recomputing `getCoreRowModel()`, `getSortedRowModel()` etc. inside render creates new function references each time. Call them once and store. [VERIFIED: TanStack Table data guide]
- **React Context for table instance:** Propagates re-renders to all consumers on any state change. Pass via props instead (D-01). [VERIFIED: CONTEXT.md D-01]
- **Using shadcn `data-table` block:** Monolithic component that bundles rendering + state + toolbar. Incompatible with the multi-view architecture where one `useReactTable` feeds table/card/split views. [VERIFIED: CONTEXT.md anti-features]
- **Storing filter state in URL (nuqs):** Workbench filters are client-side only (TanStack Table state), not URL state. The search/library pages use nuqs for URL-state, but the workbench intentionally diverges. [VERIFIED: CONTEXT.md code_context]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Table sorting/filtering/visibility state | Custom state management with manual array operations | `@tanstack/react-table` `getSortedRowModel`, `getFilteredRowModel`, `onColumnVisibilityChange` | Handles edge cases (multi-sort, faceted filters, undefined values, stable sort) that custom code gets wrong. [VERIFIED: TanStack Table docs] |
| Column filter chrome | Custom filter container with active indicators | `FilterSection` from `components/shared/filter-section.tsx` | Already built with active state indicator (orange bar), clear button, motion animations, i18n support. Reuse mandated by WB-10. [VERIFIED: existing codebase] |
| Persistent user preferences | Custom localStorage wrapper with JSON parse/stringify | Zustand `persist` middleware with `createJSONStorage` | Handles hydration timing, version migrations, partial serialization. Project already uses this pattern everywhere. [VERIFIED: existing codebase] |
| Badge renderers for status/confidence | New badge components | `ConfidenceBadge` from `components/extraction/confidence-badge.tsx`, `StatusBadge` from `components/extraction/status-badge.tsx` | Already styled with OKLCH colors, i18n keys, pulse animations for active states. [VERIFIED: existing codebase] |

**Key insight:** This phase is integration, not invention. Every visual primitive except the view switcher segmented control already exists. The new code's job is to wire TanStack Table's headless state to existing UI components.

## Common Pitfalls

### Pitfall 1: Column Definition Re-render Storm (PITFALL 4 from phase description)
**What goes wrong:** At 1000 rows, inline column definitions or unstable `data` references cause TanStack Table to recompute its entire row model on every React render cycle. With debounced text filters triggering re-renders every keystroke, this creates visible jank.
**Why it happens:** TanStack Table uses referential equality to determine if it needs to recompute. `columns` or `data` defined inline create new array references every render.
**How to avoid:**
1. Hoist `createWorkbenchColumns()` at module level (D-03)
2. Memoize the result via `useMemo` keyed on `questions` (D-04)
3. Wrap expensive cell renderers (`ConfidenceBadge`, `StatusBadge`) in `React.memo`
4. Ensure `data` reference from `useProtectedQuery` is stable (Convex already memoizes query results)
**Warning signs:** Typing in a filter input causes the entire table to visibly re-render; React DevTools Profiler shows `useReactTable` recomputing on every keystroke.

### Pitfall 2: Zustand Hydration Flash
**What goes wrong:** On first render, Zustand's `persist` middleware hasn't loaded from `localStorage` yet, so `columnVisibility` is `{}` (all visible) and `activeView` is `"table"`. When hydration completes, the UI flashes as column visibility and view state snap to stored values.
**Why it happens:** `localStorage` is synchronous in browsers but Zustand's persist middleware defers hydration to avoid blocking the initial render.
**How to avoid:** Use the `_hasHydrated` pattern (already established in `extraction-basket.ts`): don't render view-dependent content until `_hasHydrated` is true. The shell can show a skeleton/loading state during the brief hydration gap.
**Warning signs:** Columns briefly flash as visible then disappear; view switches from table to card on page load.

### Pitfall 3: TanStack Table Type Inference with Dynamic Columns
**What goes wrong:** When mixing static `ColumnDef<WorkbenchPaper>[]` with dynamically generated question columns, TypeScript may lose type inference for `accessorFn` and `cell` render functions.
**Why it happens:** Dynamic columns use `accessorFn` instead of `accessorKey`, and the return type must be explicitly typed.
**How to avoid:** Explicitly type the `ColumnDef` generic parameter on the factory function return type: `ColumnDef<WorkbenchPaper, string | null>[]` for question columns where the accessor returns `string | null`.
**Warning signs:** TypeScript errors on `cell.getValue()` calls; `any` types leaking into column render functions.

### Pitfall 4: FilterSection isActive State Coordination
**What goes wrong:** The `FilterSection` component expects an `isActive` boolean prop. If this isn't correctly derived from TanStack Table's `columnFilters` state, the orange active indicator bar doesn't show when filters are applied.
**Why it happens:** `columnFilters` is an array of `{ id: string, value: unknown }` -- checking if a specific filter is active requires finding the entry by column ID and checking if its value is non-empty.
**How to avoid:** Create a utility function `isColumnFilterActive(columnFilters: ColumnFiltersState, columnId: string): boolean` that checks for both existence and non-empty value.
**Warning signs:** Filter sections don't show the orange active indicator even when filters are applied.

### Pitfall 5: shadcn ToggleGroup Not Installed
**What goes wrong:** D-08 mentions using shadcn `ToggleGroup` for the view switcher, but `components/ui/toggle-group.tsx` does not exist in the project.
**Why it happens:** The component was never installed via the shadcn CLI.
**How to avoid:** Run `npx shadcn@latest add toggle-group` before implementing the view switcher. Alternatively, build a custom segmented control from existing primitives (Button + Tailwind).
**Warning signs:** Import error for `@/components/ui/toggle-group`.

## Code Examples

### TanStack Table flexRender with shadcn Table Primitives
```typescript
// Source: TanStack Table React examples (https://tanstack.com/table/latest/docs/framework/react/examples/column-groups)
// Verified pattern for bridging TanStack Table's headless API with shadcn Table rendering

import { flexRender } from "@tanstack/react-table";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Headers with sort toggle
{table.getHeaderGroups().map((headerGroup) => (
  <TableRow key={headerGroup.id}>
    {headerGroup.headers.map((header) => (
      <TableHead
        key={header.id}
        onClick={header.column.getToggleSortingHandler()}
        className={header.column.getCanSort() ? "cursor-pointer select-none" : ""}
      >
        {header.isPlaceholder
          ? null
          : flexRender(header.column.columnDef.header, header.getContext())}
        {/* Sort direction indicator */}
        {{ asc: " ^", desc: " v" }[header.column.getIsSorted() as string] ?? null}
      </TableHead>
    ))}
  </TableRow>
))}
```

### Zustand Store with Persist + Hydration Guard
```typescript
// Source: Established project pattern from lib/store/extraction-basket.ts (lines 108-151)
// Adapted for localStorage (not sessionStorage) per D-05

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// No custom storage adapter needed -- localStorage natively supports
// Record<string, boolean> and string values (no Map serialization issue
// unlike the basket store's Map<string, BasketEntry>)
export const useExtractionResultsViewStore = create<ExtractionResultsViewState>()(
  persist(
    (set) => ({
      columnVisibility: {},
      activeView: "table" as const,
      _hasHydrated: false,
      // setColumnVisibility matches TanStack Table's onColumnVisibilityChange signature
      setColumnVisibility: (visibility) => set({ columnVisibility: visibility }),
      toggleColumn: (columnId) =>
        set((state) => ({
          columnVisibility: {
            ...state.columnVisibility,
            [columnId]: !(state.columnVisibility[columnId] ?? true),
          },
        })),
      setActiveView: (view) => set({ activeView: view }),
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: "extraction-results-view",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        columnVisibility: state.columnVisibility,
        activeView: state.activeView,
      }),
      migrate: (persistedState: unknown, version: number) => {
        if (version < 1) return { columnVisibility: {}, activeView: "table" };
        return persistedState;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
```

### Column Visibility Toggle Popover
```typescript
// Source: TanStack Table column visibility example
// (https://tanstack.com/table/latest/docs/framework/react/examples/column-visibility)

// Toggle all columns:
<Checkbox
  checked={table.getIsAllColumnsVisible()}
  onCheckedChange={(value) => table.toggleAllColumnsVisible(!!value)}
/>

// Toggle individual column:
{table.getAllLeafColumns().map((column) => (
  <div key={column.id} className="flex items-center gap-2">
    <Checkbox
      checked={column.getIsVisible()}
      onCheckedChange={(value) => column.toggleVisibility(!!value)}
      disabled={!column.getCanHide()}
    />
    <label>{column.id}</label>
  </div>
))}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TanStack Table v7 (`react-table`) | TanStack Table v8 (`@tanstack/react-table`) | 2022 | Fully headless, framework-agnostic core, tree-shakeable row models. v8 is the only supported version. [VERIFIED: npm registry] |
| Class-based column helpers | `createColumnHelper<T>()` type-safe builder | v8.0 | Optional but improves type inference for `accessorKey` columns. Alternative to raw `ColumnDef[]`. [VERIFIED: TanStack Table docs] |
| `useTable` hook | `useReactTable` hook | v8.0 | New hook name, accepts `getCoreRowModel()` and optional row model plugins. [VERIFIED: TanStack Table docs] |
| Built-in rendering | `flexRender` utility | v8.0 | Must explicitly call `flexRender(columnDef.cell, context)` to render cells. No automatic rendering. [VERIFIED: TanStack Table docs] |
| Zustand v4 `create()` | Zustand v5 `create<T>()()` (double invocation for middleware) | 2024 | Project already uses v5 pattern throughout. [VERIFIED: package.json + lib/store.ts] |

**Deprecated/outdated:**
- `react-table` v7 package: replaced by `@tanstack/react-table` v8. Different import path, different API surface. [VERIFIED: npm registry]
- `table.getHeaderGroups()` returning flat headers: v8 supports nested header groups for column grouping. Not needed for this phase but available. [VERIFIED: TanStack Table docs]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `useProtectedQuery` returns stable data references (Convex memoizes) so `data` passed to `useReactTable` won't cause unnecessary recomputes | Pitfall 1 | If Convex creates new array references on every reactive update, need to add explicit `useMemo` around data in the shell. LOW risk -- Convex reactive queries return stable references unless data changes. |
| A2 | The extraction `results` i18n namespace already contains or can be extended for workbench toolbar strings | Architecture Patterns | If the `extraction` namespace structure doesn't support toolbar keys, need to add i18n keys across all 6 locales. LOW risk -- adding keys is straightforward per project conventions. |
| A3 | `FilterSection` renders correctly in a horizontal toolbar layout (originally designed for vertical sidebar) | Pattern 4 | If `FilterSection`'s internal layout breaks when placed in a horizontal flex row, may need minor CSS overrides. MEDIUM risk -- worth verifying during implementation. |

## Open Questions

1. **Filter dropdowns: `Select` vs `Popover` + `Command`?**
   - What we know: Both components exist in the project (`components/ui/select.tsx` and `components/ui/popover.tsx`). The status and confidence filters have small option sets (5-6 values each).
   - What's unclear: Whether the simpler `Select` is sufficient or if `Popover` + `Command` is needed for search-within-dropdown on the answer value filter.
   - Recommendation: Use shadcn `Select` for status (6 options) and confidence (3 options) filters. Use `Input` for year range and venue text. Use `Input` for per-question answer value filter (debounced). The option counts are small enough that `Select` is simpler and more accessible than `Popover` + `Command`.

2. **shadcn `ToggleGroup` vs custom segmented control for view switcher?**
   - What we know: `toggle-group` is not installed. D-08 mentions either option.
   - What's unclear: Whether the shadcn `ToggleGroup` matches the desired visual style.
   - Recommendation: Install `toggle-group` via shadcn CLI. It's a thin Radix wrapper that supports single-value mode, which is exactly the view switcher pattern. Styling can be customized with Tailwind.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@tanstack/react-table` | WB-01 (table state) | Not installed | 8.21.3 (npm latest) | -- (must install) |
| `react` | All components | Installed | ^19.2.4 | -- |
| `zustand` | WB-02 (persistence) | Installed | ^5.0.5 | -- |
| shadcn `table` component | WB-01 (rendering) | Installed | -- | -- |
| shadcn `toggle-group` component | D-08 (view switcher) | Not installed | -- | Custom segmented control with Button + Tailwind |
| shadcn `select` component | D-06 (filter dropdowns) | Installed | -- | -- |
| shadcn `popover` component | D-07 (column visibility) | Installed | -- | -- |
| shadcn `checkbox` component | D-07 (column toggles) | Installed | -- | -- |

**Missing dependencies with no fallback:**
- `@tanstack/react-table@^8.21.3` -- must install via `npm install`

**Missing dependencies with fallback:**
- shadcn `toggle-group` -- can use `npx shadcn@latest add toggle-group` or build custom segmented control

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/extraction-results-view-store.test.ts tests/workbench-columns.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WB-01 | `createWorkbenchColumns` returns correct static + dynamic columns | unit | `npx vitest run tests/workbench-columns.test.ts -x` | Wave 0 |
| WB-01 | `WorkbenchDataTable` renders headers and cells via flexRender | unit (jsdom) | `npx vitest run tests/components/workbench-data-table.test.tsx -x` | Wave 0 |
| WB-02 | Store persists columnVisibility and activeView to localStorage | unit | `npx vitest run tests/extraction-results-view-store.test.ts -x` | Wave 0 |
| WB-02 | Store migration from version 0 returns defaults | unit | `npx vitest run tests/extraction-results-view-store.test.ts -x` | Wave 0 |
| WB-03 | Column definitions include correct `filterFn` for status, confidence, answer | unit | `npx vitest run tests/workbench-columns.test.ts -x` | Wave 0 |
| WB-10 | WorkbenchToolbar renders FilterSection wrappers around filter controls | unit (jsdom) | `npx vitest run tests/components/workbench-toolbar.test.tsx -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/extraction-results-view-store.test.ts tests/workbench-columns.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/extraction-results-view-store.test.ts` -- covers WB-02 (store CRUD, persistence, migration, hydration)
- [ ] `tests/workbench-columns.test.ts` -- covers WB-01, WB-03 (column factory output, filterFn presence, dynamic question columns)
- [ ] `tests/components/workbench-data-table.test.tsx` -- covers WB-01 (DataTable rendering with flexRender + shadcn Table)
- [ ] `tests/components/workbench-toolbar.test.tsx` -- covers WB-03, WB-10 (toolbar renders FilterSection wrappers, filter state changes propagate)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A -- phase is client-side primitives only, no auth changes |
| V3 Session Management | no | N/A -- localStorage preferences are non-sensitive |
| V4 Access Control | no | N/A -- data access controlled by Convex query (existing `getExtractionResults` checks `userId`) |
| V5 Input Validation | yes | Filter input values are strings passed to TanStack Table's built-in filter functions (not sent to backend). Text inputs should be sanitized for display (React's default JSX escaping handles XSS). |
| V6 Cryptography | no | N/A -- no secrets stored in the view preference store |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| localStorage data tampering | Tampering | Non-sensitive data only (column visibility booleans, view name string). Invalid values fall back to defaults via migration function. |
| XSS via filter input reflected in table | Tampering | React's JSX escaping prevents injection. TanStack Table's `flexRender` goes through React's createElement. No `dangerouslySetInnerHTML`. |

## Sources

### Primary (HIGH confidence)
- TanStack Table v8 docs via Context7 (`/websites/tanstack_table`) -- column definitions, `useReactTable` hook, sorting/filtering/visibility APIs, memoization guidance, `flexRender` rendering pattern
- npm registry -- `@tanstack/react-table@8.21.3` version and peer dependencies verified 2026-04-16
- Project codebase -- `components/ui/table.tsx`, `components/shared/filter-section.tsx`, `lib/store/extraction-basket.ts`, `lib/store.ts`, `convex/extraction/validators.ts`, `convex/extraction/queries.ts`

### Secondary (MEDIUM confidence)
- TanStack Table FAQ on stable references (https://tanstack.com/table/latest/docs/faq.md) -- via Context7

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- only one new dep (`@tanstack/react-table`), version verified on npm, peer deps confirmed compatible
- Architecture: HIGH -- all patterns documented in TanStack Table v8 official docs via Context7, existing codebase patterns thoroughly inspected
- Pitfalls: HIGH -- memoization requirements verified in official docs, hydration pattern already proven in project's basket store

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable -- TanStack Table v8 is mature, no breaking changes expected)
