# Phase 103: Workbench Views + Selector Page - Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 22 (13 new, 9 modified)
**Analogs found:** 22 / 22

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `components/extraction/card-view.tsx` | component | transform | `components/results-list.tsx` (paginated card list) | role-match |
| `components/extraction/split-view.tsx` | component | request-response | `components/library/library-page-client.tsx` (list + detail pattern) | role-match |
| `components/extraction/split-view-row.tsx` | component | transform | `components/extraction/workbench-data-table.tsx` (table row rendering) | role-match |
| `components/extraction/evidence-drawer.tsx` | component | request-response | `components/extraction/extraction-basket-drawer.tsx` (Sheet right-side) | exact |
| `components/extraction/pagination-controls.tsx` | component | transform | `components/library/library-page-client.tsx` lines 564-611 (pagination UI) | exact |
| `app/extraction/new/page.tsx` | route | request-response | `app/extraction/page.tsx` (server component) | exact |
| `app/extraction/new/selector-page-client.tsx` | component | request-response | `app/extraction/extraction-list-client.tsx` (client wrapper) | role-match |
| `app/extraction/new/library-tab.tsx` | component | CRUD | `components/library/library-page-client.tsx` (library items listing) | exact |
| `app/extraction/new/collections-tab.tsx` | component | CRUD | `components/library/library-page-client.tsx` (collection filter usage) | role-match |
| `app/extraction/new/search-results-tab.tsx` | component | CRUD | `components/results-list.tsx` (search results rendering) | role-match |
| `app/extraction/new/manual-ids-tab.tsx` | component | request-response | `components/extraction/extraction-dialog.tsx` (textarea + submit pattern) | role-match |
| `components/extraction/workbench-shell.tsx` | component | transform | self (extend existing) | exact |
| `components/extraction/workbench-toolbar.tsx` | component | transform | self (extend existing) | exact |
| `components/extraction/evidence-quote.tsx` | component | request-response | self (1-line fix) | exact |
| `components/extraction/job-metrics-panel.tsx` | component | request-response | self (1-line fix) | exact |
| `components/extraction/extraction-dialog.tsx` | component | request-response | self (wire papers prop) | exact |
| `app/extraction/[jobId]/extraction-results-client.tsx` | component | request-response | self (refactor to WorkbenchShell) | exact |
| `lib/store/extraction-results-view.ts` | store | transform | `lib/store/extraction-basket.ts` (Zustand persist + migration) | exact |
| `convex/extraction/queries.ts` | query | CRUD | self (add optional paperIds param) | exact |
| `convex/library/queries.ts` | query | CRUD | self (may need getCollectionItems) | exact |
| `messages/en-US.json` | config | n/a | self (add keys) | exact |
| `messages/*.json` (5 other locales) | config | n/a | self (mirror en-US keys) | exact |

## Pattern Assignments

### `components/extraction/card-view.tsx` (component, transform) -- NEW

**Analog:** `components/extraction/workbench-shell.tsx` (motion pattern) + `components/extraction/paper-result-card.tsx` (card rendering)

**Imports pattern** (from workbench-shell.tsx lines 1-24):
```typescript
"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import type { Table as TanStackTable } from "@tanstack/react-table";
import { PaperResultCard } from "@/components/extraction/paper-result-card";
import type { WorkbenchPaper, ExtractionQuestion } from "@/lib/extraction/workbench-columns";
```

**Core virtualizer pattern** (from @tanstack/react-virtual docs, verified in RESEARCH.md Pattern 1):
```typescript
// Every virtual item wrapper MUST have data-index AND ref={virtualizer.measureElement}
// to prevent height misassignment (Pitfall 1 from RESEARCH.md)
<div
  key={virtualRow.key}
  data-index={virtualRow.index}
  ref={virtualizer.measureElement}
  style={{
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translateY(${virtualRow.start}px)`,
  }}
>
  <PaperResultCard
    paper={rows[virtualRow.index]}
    questions={questions}
    index={virtualRow.index}
  />
</div>
```

**Props interface pattern** (from workbench-shell.tsx lines 30-34):
```typescript
interface CardViewProps {
  table: TanStackTable<WorkbenchPaper>;
  questions: ExtractionQuestion[];
  onEvidenceClick: (props: EvidenceDrawerProps) => void;
}
```

---

### `components/extraction/split-view.tsx` (component, request-response) -- NEW

**Analog:** `components/library/library-page-client.tsx` (list + detail layout) + `components/extraction/workbench-data-table.tsx` (TanStack Table row rendering)

**Imports pattern:**
```typescript
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { Table as TanStackTable } from "@tanstack/react-table";
import { PaperResultCard } from "@/components/extraction/paper-result-card";
import { cn } from "@/lib/utils";
import type { WorkbenchPaper, ExtractionQuestion } from "@/lib/extraction/workbench-columns";
```

**Selection state pattern** (from extraction-dialog.tsx line 57-60, adapted):
```typescript
const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
```

**Mobile fallback pattern** (from library-page-client.tsx line 147-153):
```typescript
// Reuse existing useIsTablet hook from lib/hooks
import { useIsTablet } from "@/lib/hooks";
const isMobile = useIsTablet(); // Returns true for < 768px
// When isMobile, parent WorkbenchShell should render table view instead
```

**Pagination in left panel** (from library-page-client.tsx lines 262-283):
```typescript
const PAGE_SIZE = 10; // D-05: denser than full table view
const items = table.getRowModel().rows;
const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
const pageResults = items.slice(
  (currentPage - 1) * PAGE_SIZE,
  currentPage * PAGE_SIZE,
);
```

---

### `components/extraction/split-view-row.tsx` (component, transform) -- NEW

**Analog:** `components/extraction/workbench-data-table.tsx` lines 76-84 (table row rendering pattern)

**Row rendering pattern** (from workbench-data-table.tsx lines 76-84):
```typescript
// Compact row showing title + status badge + parsingSource badge
<div
  role="row"
  className={cn(
    "flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/40",
    isSelected && "bg-accent",
    "hover:bg-accent/50 transition-colors",
  )}
  onClick={() => onSelect(paper._id)}
>
  <StatusBadge status={paper.status} />
  {paper.parsingSource && (
    <Badge variant="secondary" className="text-xs">
      {paper.parsingSource}
    </Badge>
  )}
  <span className="text-sm truncate flex-1">{paper.title}</span>
</div>
```

---

### `components/extraction/evidence-drawer.tsx` (component, request-response) -- NEW

**Analog:** `components/extraction/extraction-basket-drawer.tsx` (Sheet right-side drawer)

**Imports pattern** (from extraction-basket-drawer.tsx lines 1-21):
```typescript
"use client";

import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { EvidenceQuote } from "@/components/extraction/evidence-quote";
import { ConfidenceBadge } from "@/components/extraction/confidence-badge";
import { CriticVerdictBadge } from "@/components/extraction/critic-verdict-badge";
```

**Sheet open/close pattern** (from extraction-basket-drawer.tsx lines 23-29, 64-66):
```typescript
interface EvidenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paperId: Id<"extractionPapers"> | null;
  startChar: number;
  endChar: number;
  questionText: string;
  parsingSource?: string;
  modelUsed?: string;
  criticVerdict?: string;
}

// Sheet usage follows exact basket drawer pattern:
<Sheet open={open} onOpenChange={onOpenChange}>
  <SheetContent side="right" className="flex flex-col p-0">
    <SheetHeader className="border-b p-4">
      <SheetTitle>{t("evidenceDrawer.title")}</SheetTitle>
      <SheetDescription className="sr-only">
        {t("evidenceDrawer.description")}
      </SheetDescription>
    </SheetHeader>
    <ScrollArea className="flex-1">
      {/* Content */}
    </ScrollArea>
  </SheetContent>
</Sheet>
```

**Drawer state in WorkbenchShell** (D-08, mounted once):
```typescript
// In WorkbenchShell -- single mount pattern (avoid per-row Sheet overhead)
const [drawerState, setDrawerState] = useState<{
  open: boolean;
  props: EvidenceDrawerProps | null;
}>({ open: false, props: null });

const openEvidence = useCallback((props: Omit<EvidenceDrawerProps, "open" | "onOpenChange">) => {
  setDrawerState({ open: true, props: { ...props, open: true, onOpenChange: () => {} } });
}, []);
```

---

### `components/extraction/pagination-controls.tsx` (component, transform) -- NEW

**Analog:** `components/library/library-page-client.tsx` lines 564-611 (pagination UI)

**Pagination UI pattern** (from library-page-client.tsx lines 564-611):
```typescript
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// The exact pagination pattern from the library page:
<div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
  <p className="text-sm text-muted-foreground">
    {t("showingRange", { start: rangeStart, end: rangeEnd, total: filteredTotal })}
  </p>
  {totalPages > 1 && (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => table.previousPage()}
        disabled={!table.getCanPreviousPage()}
        className="rounded-xl"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        {t("previousPage")}
      </Button>
      <span className="min-w-[110px] text-center text-sm text-muted-foreground">
        {pageIndex + 1} / {table.getPageCount()}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => table.nextPage()}
        disabled={!table.getCanNextPage()}
        className="rounded-xl"
      >
        {t("nextPage")}
        <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  )}
</div>
```

---

### `app/extraction/new/page.tsx` (route, request-response) -- NEW

**Analog:** `app/extraction/page.tsx` (server component pattern)

**Server component pattern** (from app/extraction/page.tsx lines 1-16):
```typescript
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SelectorPageClient } from "./selector-page-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("extractionNewTitle"),
  };
}

export default function ExtractionNewPage() {
  return <SelectorPageClient />;
}
```

---

### `app/extraction/new/selector-page-client.tsx` (component, request-response) -- NEW

**Analog:** `app/extraction/extraction-list-client.tsx` (client wrapper) + `components/ui/tabs.tsx` (Tabs composition)

**Client wrapper pattern** (from extraction-list-client.tsx lines 1-9):
```typescript
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ExtractionCounter } from "@/components/extraction/extraction-counter";
import { ExtractionBasketDrawer } from "@/components/extraction/extraction-basket-drawer";
import { ExtractionDialog } from "@/components/extraction/extraction-dialog";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
```

**Page layout pattern** (from extraction-list-client.tsx lines 14-39):
```typescript
// Page header with icon + title
<div className="mx-auto max-w-4xl px-4 py-8">
  <div className="flex items-center justify-between mb-8">
    <div className="flex items-center gap-3">
      <div className="rounded-lg bg-primary/10 p-2">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h1 className="text-xl font-semibold">{t("selector.title")}</h1>
    </div>
  </div>
  {/* Counter + Tabs + Footer */}
</div>
```

**Tabs composition** (from components/ui/tabs.tsx exports):
```typescript
<Tabs defaultValue="library">
  <TabsList>
    <TabsTrigger value="library">{t("selector.tabs.library")}</TabsTrigger>
    <TabsTrigger value="collections">{t("selector.tabs.collections")}</TabsTrigger>
    <TabsTrigger value="search">{t("selector.tabs.search")}</TabsTrigger>
    <TabsTrigger value="manual">{t("selector.tabs.manual")}</TabsTrigger>
    <TabsTrigger value="zotero" disabled>{t("selector.tabs.zotero")}</TabsTrigger>
  </TabsList>
  <TabsContent value="library"><LibraryTab /></TabsContent>
  {/* ... */}
</Tabs>
```

**Dialog wiring from basket** (D-13, from RESEARCH.md Code Examples):
```typescript
const basketPapers = useExtractionBasketStore((s) => s.papers);
const papersForDialog = useMemo(
  () =>
    Array.from(basketPapers.values()).map((entry) => ({
      openalexId: entry.openAlexId, // Note: casing difference (openAlexId -> openalexId)
      title: entry.title,
      doi: entry.doi ?? undefined,
    })),
  [basketPapers],
);
```

---

### `app/extraction/new/library-tab.tsx` (component, CRUD) -- NEW

**Analog:** `components/library/library-page-client.tsx` (library data fetching + rendering)

**Protected query pattern** (from library-page-client.tsx lines 103-142):
```typescript
"use client";

import { useTranslations } from "next-intl";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import { AddToExtractionButton } from "@/components/extraction/add-to-extraction-button";

// Query pattern:
const { data: items } = useProtectedQuery(
  api.library.queries.listLibrary,
  { sortBy: "savedAt", sortOrder: "desc" },
);
```

**AddToExtractionButton usage** (from add-to-extraction-button.tsx lines 19-26):
```typescript
// Per-row button usage in list items:
<AddToExtractionButton
  paper={{ rawId: item.openalexId, title: item.title, doi: item.doi ?? null }}
  source="library"
/>
```

---

### `app/extraction/new/collections-tab.tsx` (component, CRUD) -- NEW

**Analog:** `components/library/library-page-client.tsx` lines 103-106 (collections query)

**Collections query pattern** (from library-page-client.tsx lines 103-106):
```typescript
const { data: collectionsWithCounts } = useProtectedQuery(
  api.library.collections.getCollectionsWithCounts,
  {},
);
```

**Bulk add pattern** (from use-add-to-basket.ts lines 99-111):
```typescript
// Use addToBasket with array input for "Extract entire collection":
const { addToBasket } = useAddToBasket();
const result = addToBasket(
  collectionItems.map((item) => ({
    rawId: item.openalexId,
    title: item.title,
    doi: item.doi ?? null,
    source: "collection" as const,
  })),
);
if (result.dropped > 0) {
  toast.info(t("dropped", { added: result.added, dropped: result.dropped }));
}
```

---

### `app/extraction/new/manual-ids-tab.tsx` (component, request-response) -- NEW

**Analog:** `components/extraction/extraction-dialog.tsx` (textarea + submit pattern)

**Submit handler pattern** (from extraction-dialog.tsx lines 118-141):
```typescript
const [isResolving, setIsResolving] = useState(false);
const [idText, setIdText] = useState("");

const handleResolve = useCallback(async () => {
  setIsResolving(true);
  try {
    // Parse textarea lines, normalize each ID
    const ids = idText.split("\n").map((l) => l.trim()).filter(Boolean);
    // Call resolveManualIds from Phase 100
    // Then addToBasket with results
  } catch (error: unknown) {
    const resolved = resolveToastError(error, t("resolveError"));
    showStyledToast("error", resolved.message);
  } finally {
    setIsResolving(false);
  }
}, [idText]);
```

**Normalize utility** (from lib/openalex/normalize.ts, used in use-add-to-basket.ts line 5):
```typescript
import { normalizeOpenAlexId } from "@/lib/openalex/normalize";
```

---

### `components/extraction/workbench-shell.tsx` (component, transform) -- MODIFY

**Self-analog, extend lines 99-114 with pagination and global filter.**

**Current useReactTable call** (lines 100-114):
```typescript
const table = useReactTable({
  data,
  columns,
  state: {
    sorting,
    columnFilters,
    columnVisibility,
  },
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  onColumnVisibilityChange: handleColumnVisibilityChange,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
});
```

**Add these imports** (from @tanstack/react-table):
```typescript
import {
  getPaginationRowModel,
  type PaginationState,
} from "@tanstack/react-table";
```

**Add to state block:**
```typescript
const [globalFilter, setGlobalFilter] = useState("");
const [pagination, setPagination] = useState<PaginationState>({
  pageIndex: 0,
  pageSize: 25,
});

// In useReactTable config:
state: { sorting, columnFilters, columnVisibility, globalFilter, pagination },
onGlobalFilterChange: setGlobalFilter,
onPaginationChange: setPagination,
getPaginationRowModel: getPaginationRowModel(),
globalFilterFn: "includesString",
autoResetPageIndex: true, // D-18: reset page on filter change
```

**Evidence drawer state mount** (at end of component, D-08):
```typescript
// Single EvidenceDrawer mount inside WorkbenchShellInner return
<EvidenceDrawer
  open={drawerState.open}
  onOpenChange={(open) => setDrawerState((prev) => ({ ...prev, open }))}
  {...drawerState.props}
/>
```

---

### `components/extraction/workbench-toolbar.tsx` (component, transform) -- MODIFY

**Self-analog, extend with search input and export dropdown.**

**Search input pattern** (from library-page-client.tsx lines 70-71 + RESEARCH.md Pattern 5):
```typescript
import { useDeferredValue } from "react";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Search, X } from "lucide-react";

// In component:
const globalFilter = table.getState().globalFilter as string;
const [searchInput, setSearchInput] = useState(globalFilter);
const debouncedSearch = useDebouncedValue(searchInput, 300);
const deferredSearch = useDeferredValue(debouncedSearch);

useEffect(() => {
  table.setGlobalFilter(deferredSearch);
}, [deferredSearch, table]);
```

**Export dropdown pattern** (from extraction-results-client.tsx lines 137-166):
```typescript
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Loader2 } from "lucide-react";

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm" disabled={isExporting}>
      {isExporting ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {t("export.label")}
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={() => handleExport("csv")}>{t("export.csv")}</DropdownMenuItem>
    <DropdownMenuItem onClick={() => handleExport("json")}>{t("export.json")}</DropdownMenuItem>
    <DropdownMenuItem onClick={() => handleExport("xlsx")}>{t("export.xlsx")}</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

### `components/extraction/evidence-quote.tsx` (component, request-response) -- MODIFY (GAP-02)

**Self-analog, 2-line change.**

**Before** (lines 2-3):
```typescript
import { useQuery } from "convex/react";
```
**Line 24:**
```typescript
const paperData = useQuery(api.extraction.queries.getPaperBodyText, { paperId });
```

**After** (copy import pattern from extraction-results-client.tsx line 10):
```typescript
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
```
**Line 24:**
```typescript
const { data: paperData } = useProtectedQuery(
  api.extraction.queries.getPaperBodyText,
  { paperId },
);
```

---

### `components/extraction/job-metrics-panel.tsx` (component, request-response) -- MODIFY (GAP-02)

**Self-analog, 2-line change.**

**Before** (lines 3, 36-38):
```typescript
import { useQuery } from "convex/react";
// ...
const metrics = useQuery(
  api.extraction.queries.getExtractionJobMetrics,
  { jobId }
);
```

**After** (copy pattern from extraction-results-client.tsx line 10):
```typescript
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
// ...
const { data: metrics } = useProtectedQuery(
  api.extraction.queries.getExtractionJobMetrics,
  { jobId },
);
```

---

### `components/extraction/extraction-dialog.tsx` (component, request-response) -- MODIFY

**Self-analog. Wire papers prop from basket store.**

**Existing papers prop** (line 33):
```typescript
papers?: Array<{ openalexId: string; title: string; doi?: string }>;
```

No change to the dialog's interface. The wiring happens in `selector-page-client.tsx` where `papersForDialog` is passed via the existing `papers` prop. The dialog already accepts and uses it at line 119 and 126.

---

### `app/extraction/[jobId]/extraction-results-client.tsx` (component, request-response) -- MODIFY

**Self-analog. Replace lines 132-184 with WorkbenchShell.**

**Current results rendering** (lines 132-184):
```typescript
// Replace this entire section with:
import { WorkbenchShell } from "@/components/extraction/workbench-shell";

<WorkbenchShell data={data.papers} questions={data.job.questions} />
```

**Keep existing patterns** (lines 72-129 -- loading skeleton, not-found state, empty state):
```typescript
// These stay unchanged:
if (data === undefined) { /* loading skeleton */ }
if (data === null) { /* not found */ }
if (data.papers.length === 0) { /* empty state */ }
```

**Move export to WorkbenchToolbar** (D-24 -- remove lines 136-166 dropdown from page header):
```typescript
// The handleExport function and dropdown move into workbench-toolbar.tsx
// The toolbar receives convex client and jobId to invoke the export query
```

---

### `lib/store/extraction-results-view.ts` (store, transform) -- MODIFY

**Self-analog + `lib/store/extraction-basket.ts` (migration pattern).**

**Migration pattern** (from extraction-basket.ts lines 52-58):
```typescript
export function migrateViewState(
  persistedState: unknown,
  version: number,
): { columnVisibility: Record<string, boolean>; activeView: ActiveView; pageSize: number } {
  if (version < 1) return { columnVisibility: {}, activeView: "table", pageSize: 25 };
  if (version < 2) {
    const prev = persistedState as { columnVisibility: Record<string, boolean>; activeView: ActiveView };
    return { ...prev, pageSize: 25 };
  }
  return persistedState as { columnVisibility: Record<string, boolean>; activeView: ActiveView; pageSize: number };
}
```

**Version bump** (current version 1 at line 79, bump to 2):
```typescript
{
  name: "extraction-results-view",
  version: 2, // bumped from 1
  // ...
  partialize: (state) => ({
    columnVisibility: state.columnVisibility,
    activeView: state.activeView,
    pageSize: state.pageSize,
  }),
}
```

---

### `convex/extraction/queries.ts` (query, CRUD) -- MODIFY

**Self-analog. Add optional paperIds param to getExtractionResultsForExport.**

**Current args** (line 588):
```typescript
args: { jobId: v.id("extractionJobs") },
```

**New args:**
```typescript
args: {
  jobId: v.id("extractionJobs"),
  paperIds: v.optional(v.array(v.id("extractionPapers"))),
},
```

**Filter addition** (after line 629, before the loop):
```typescript
let papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_EXTRACTION_PAPERS_PER_JOB);

// NEW: filter to requested subset if paperIds provided (D-19)
if (args.paperIds) {
  const idSet = new Set(args.paperIds.map(String));
  papers = papers.filter((p) => idSet.has(String(p._id)));
}
```

**Import pattern** (lines 1-14 of the file remain unchanged):
```typescript
import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";
```

---

## Shared Patterns

### Authentication (useProtectedQuery)
**Source:** `lib/auth/use-auth-query.ts` lines 49-78
**Apply to:** All new components that fetch Convex data (library-tab, collections-tab, search-results-tab, evidence-drawer)
```typescript
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
const { data } = useProtectedQuery(api.some.query, { args });
```

### Error Handling (toast pattern)
**Source:** `components/extraction/extraction-dialog.tsx` lines 134-138
**Apply to:** manual-ids-tab (resolveManualIds), selector-page-client (createExtractionJob), export handlers
```typescript
import { resolveToastError, getToastMessageKeyForErrorCode } from "@/lib/toast/error-resolver";
import { showStyledToast } from "@/components/ui/sonner";

catch (error: unknown) {
  const resolved = resolveToastError(error, t("fallbackMessage"));
  const messageKey = getToastMessageKeyForErrorCode(resolved.code);
  showStyledToast("error", messageKey ? tToast(messageKey) : resolved.message);
}
```

### Basket Interaction (useAddToBasket)
**Source:** `lib/hooks/use-add-to-basket.ts` lines 89-128
**Apply to:** library-tab, collections-tab, search-results-tab, manual-ids-tab
```typescript
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
const { addToBasket, removeFromBasket, isInBasket, basketCount, limit } = useAddToBasket();

// Single add:
addToBasket({ rawId, title, doi, source: "library" });

// Bulk add with cap-aware feedback:
const result = addToBasket(items.map(i => ({ rawId: i.openalexId, title: i.title, doi: i.doi, source })));
if (result.dropped > 0) {
  toast.info(t("dropped", { added: result.added, dropped: result.dropped }));
}
```

### Internationalization (useTranslations)
**Source:** Every component in `components/extraction/` -- e.g., extraction-basket-drawer.tsx line 9
**Apply to:** All new components
```typescript
import { useTranslations } from "next-intl";
const t = useTranslations("extraction");
// or scoped: const t = useTranslations("extraction.selector");
```

### Animation (motion/react)
**Source:** `lib/animation-config.ts` + `components/extraction/workbench-shell.tsx` lines 122-165
**Apply to:** card-view (card entrance), split-view (panel transitions)
```typescript
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { subtleSpring, cardEntrance, cardEntranceTransition } from "@/lib/animation-config";

const shouldReduceMotion = useReducedMotion();
// Always check shouldReduceMotion before applying animations
```

### Class Composition (cn)
**Source:** `lib/utils.ts` -- used in every component
**Apply to:** All new components
```typescript
import { cn } from "@/lib/utils";
className={cn("base-classes", conditional && "conditional-classes", className)}
```

### Component Directive
**Source:** Every interactive component (extraction-basket-drawer.tsx line 1, etc.)
**Apply to:** All new components
```typescript
"use client";
// Must be the first line of every interactive component file
```

### Convex Backend Auth Check
**Source:** `convex/extraction/queries.ts` lines 620-624
**Apply to:** Any new/modified Convex queries
```typescript
const user = await getCurrentUser(ctx);
if (!user) return null;
const job = await ctx.db.get(args.jobId);
if (!job || job.userId !== user._id) return null;
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All files have close analogs in the codebase |

Every new file has at least a role-match analog. The codebase already has Sheet drawers, TanStack Table compositions, paginated lists with library data, Zustand persist stores with migration, and server-component page patterns. The only truly new pattern is `@tanstack/react-virtual` for card-view virtualization, but the API usage is documented in RESEARCH.md Pattern 1 with verified examples.

## Metadata

**Analog search scope:** `components/extraction/`, `components/library/`, `components/ui/`, `components/shared/`, `app/extraction/`, `lib/store/`, `lib/hooks/`, `lib/auth/`, `lib/extraction/`, `convex/extraction/`, `convex/library/`
**Files scanned:** 28 analog candidates read, 22 target files classified
**Pattern extraction date:** 2026-04-16
