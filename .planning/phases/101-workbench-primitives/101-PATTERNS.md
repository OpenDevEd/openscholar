# Phase 101: Workbench Primitives - Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 10 new/modified files
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/store/extraction-results-view.ts` | store | CRUD | `lib/store/extraction-basket.ts` | exact |
| `lib/extraction/workbench-columns.tsx` | utility | transform | `lib/extraction/export.ts` | role-match |
| `components/extraction/workbench-shell.tsx` | component | request-response | `app/extraction/[jobId]/extraction-results-client.tsx` | exact |
| `components/extraction/workbench-toolbar.tsx` | component | event-driven | `components/shared/filter-sidebar.tsx` | role-match |
| `components/extraction/workbench-data-table.tsx` | component | transform | `components/extraction/paper-result-card.tsx` | role-match |
| `components/extraction/view-switcher.tsx` | component | event-driven | `components/extraction/tier-selector.tsx` | exact |
| `components/extraction/column-visibility-toggle.tsx` | component | event-driven | `components/extraction/extraction-basket-drawer.tsx` | role-match |
| `tests/extraction-results-view-store.test.ts` | test | CRUD | `tests/extraction-basket-store.test.ts` | exact |
| `tests/workbench-columns.test.ts` | test | transform | `tests/export-csv-json.test.ts` | role-match |
| `tests/components/workbench-toolbar.test.tsx` | test | event-driven | `tests/extraction-basket-store.test.ts` | partial |

## Pattern Assignments

### `lib/store/extraction-results-view.ts` (store, CRUD)

**Analog:** `lib/store/extraction-basket.ts`

**Imports pattern** (lines 1-3):
```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistStorage, StorageValue } from "zustand/middleware";
```

Note: The new store uses `localStorage` (not `sessionStorage`), so it can use `createJSONStorage(() => localStorage)` from `zustand/middleware` instead of the custom `basketStorage` adapter. No Map serialization needed -- all values are plain objects (`Record<string, boolean>` and `string`).

**Store creation pattern** (lines 108-151):
```typescript
export const useExtractionBasketStore = create<ExtractionBasketState>()(
  persist(
    (set, get) => ({
      papers: new Map<string, BasketEntry>(),
      _hasHydrated: false,

      // ... action methods ...

      setHasHydrated: (hydrated: boolean) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: "extraction-basket",
      version: 1,
      storage: basketStorage,
      partialize: (state) => ({ papers: state.papers }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      migrate: migrateBasketState,
    },
  ),
);
```

**Key differences for the new store:**
- Replace `basketStorage` with `createJSONStorage(() => localStorage)` (import from `zustand/middleware`)
- Replace `Map<string, BasketEntry>` with `Record<string, boolean>` for `columnVisibility`
- Add `activeView: "table" | "card" | "split"` to state shape
- Export the `migrate` function separately for unit testability (same pattern as `migrateBasketState` at line 52)

**Also reference `lib/store.ts` `createSidebarStore`** (lines 1070-1095) for the `localStorage` + `createJSONStorage` + `migrate` + `partialize` + `onRehydrateStorage` combination:
```typescript
export function createSidebarStore(persistKey: string) {
  return create<FilterSidebarState>()(
    persist(
      (set) => ({
        isCollapsed: false,
        _hasHydrated: false,
        setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
        toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
        setHasHydrated: (state) => set({ _hasHydrated: state }),
      }),
      {
        name: persistKey,
        version: 1,
        migrate: (persistedState: unknown, version: number) => {
          if (version < 1) return { isCollapsed: false };
          return persistedState;
        },
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({ isCollapsed: state.isCollapsed }),
        onRehydrateStorage: () => (state) => {
          state?.setHasHydrated(true);
        },
      }
    )
  );
}
```

---

### `lib/extraction/workbench-columns.tsx` (utility, transform)

**Analog:** `lib/extraction/export.ts` (module-level type definitions + pure function pattern)

**Imports pattern** (lines 1-6 of export.ts):
```typescript
/**
 * Extraction export functions - pure formatting for CSV, JSON, and XLSX.
 * These receive already-fetched ExtractionExportData and produce downloadable files.
 *
 * Pattern cloned from lib/screening/export.ts (D-17, D-18).
 */
```

**Type definition pattern** (lines 16-40 of export.ts):
```typescript
export interface ExtractionExportData {
  job: {
    _id: string;
    status: string;
    questions: Array<{ key: string; question: string }>;
    totalPapers: number;
    createdAt: number;
    completedAt?: number;
  };
  results: Array<{
    paperTitle: string;
    openalexId: string;
    doi?: string;
    // ...
  }>;
}
```

**Cell renderer pattern from `components/extraction/confidence-badge.tsx`** (lines 1-54):
```typescript
"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, AlertCircle, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ConfidenceBadgeProps {
  confidence: "high" | "medium" | "low";
  className?: string;
}

const confidenceConfig = {
  high: {
    i18nKey: "confidenceHigh" as const,
    icon: CheckCircle2,
    classes: "bg-[oklch(0.95_0.08_145/0.15)] ...",
  },
  // ...
} as const;

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const t = useTranslations("extraction");
  const config = confidenceConfig[confidence];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn("rounded-full text-xs font-semibold gap-1", config.classes, className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(config.i18nKey)}
    </Badge>
  );
}
```

**Cell renderer pattern from `components/extraction/status-badge.tsx`** (lines 1-75):
```typescript
type PaperStatus = "pending" | "parsing" | "extracting" | "completed" | "failed" | "cancelled";

const statusConfig = {
  pending: { i18nKey: "progress.statusPending" as const, classes: "...", pulse: false },
  parsing: { i18nKey: "progress.statusParsing" as const, classes: "...", pulse: true },
  // ...
} as const;

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const t = useTranslations("extraction");
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={cn("rounded-full text-xs font-semibold gap-1", config.classes, config.pulse && "animate-pulse", className)}>
      {t(config.i18nKey)}
    </Badge>
  );
}
```

**Data shape from `convex/extraction/queries.ts`** (lines 484-522) -- defines the row type:
```typescript
papers: v.array(
  v.object({
    _id: v.id("extractionPapers"),
    title: v.string(),
    openalexId: v.string(),
    doi: v.optional(v.string()),
    status: extractionPaperStatusValidator,
    parsingSource: v.optional(parsingSourceValidator),
    results: v.array(
      v.object({
        questionId: v.string(),
        answer: v.union(v.string(), v.null()),
        confidence: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
        evidenceStartChar: v.optional(v.number()),
        evidenceEndChar: v.optional(v.number()),
        reasoning: v.optional(v.string()),
        modelUsed: v.optional(v.string()),
        criticVerdict: v.optional(v.string()),
      })
    ),
  })
),
```

**Question shape from `convex/extraction/validators.ts`** (lines 49-53):
```typescript
export const extractionQuestionValidator = v.object({
  key: v.string(),
  question: v.string(),
  expectedType: v.optional(v.string()),
});
```

---

### `components/extraction/workbench-shell.tsx` (component, request-response)

**Analog:** `app/extraction/[jobId]/extraction-results-client.tsx`

**Imports pattern** (lines 1-27):
```typescript
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useConvex } from "convex/react";
import { AlertTriangle, ArrowLeft, Download, Loader2 } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Button } from "@/components/ui/button";
```

**Data fetching + loading skeleton pattern** (lines 39-86):
```typescript
const { data } = useProtectedQuery(
  api.extraction.queries.getExtractionResults,
  { jobId: jobId as Id<"extractionJobs"> },
);

// Loading state: skeleton shimmer
if (data === undefined) {
  return (
    <div className="container mx-auto max-w-4xl py-8 px-4 space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="h-32 animate-pulse rounded-xl bg-muted" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border p-6">
          <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// Not found state
if (data === null) {
  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg text-center">
        <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
        <h1 className="mb-2 text-xl font-semibold">{t("results.jobNotFound")}</h1>
      </div>
    </div>
  );
}
```

**Component props pattern from `PaperResultCard`** (lines 45-50 of paper-result-card.tsx):
```typescript
interface PaperResultCardProps {
  paper: PaperResult;
  questions: Array<{ key: string; question: string }>;
  index: number;
  className?: string;
}
```

**Hydration guard pattern from `ExtractionBasketDrawer`** (lines 33-34 of extraction-basket-drawer.tsx):
```typescript
const hasHydrated = useExtractionBasketStore((s) => s._hasHydrated);
const papers = useExtractionBasketStore((s) => s.papers);
```

---

### `components/extraction/workbench-toolbar.tsx` (component, event-driven)

**Analog:** `components/shared/filter-sidebar.tsx` (structural chrome) + `components/shared/filter-section.tsx` (filter group wrapper)

**FilterSection API** (lines 10-18 of filter-section.tsx):
```typescript
export interface FilterSectionProps {
  title: string;
  icon: React.ElementType;
  isActive: boolean;
  children: React.ReactNode;
  onClear?: () => void;
  headerAction?: React.ReactNode;
}
```

**FilterSection usage pattern** (lines 20-94 of filter-section.tsx):
```typescript
export const FilterSection = React.memo(function FilterSection({
  title, icon: Icon, isActive, children, onClear, headerAction,
}: FilterSectionProps) {
  const tc = useTranslations("common");
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "relative rounded-xl overflow-hidden transition-all duration-200",
        "border",
        isActive
          ? "bg-sidebar-accent/80 border-border/60"
          : "bg-card/50 dark:bg-card/40 border-border/40 hover:border-border/60"
      )}
    >
      {/* Active indicator - left gradient bar */}
      {isActive && (
        <motion.div
          initial={false}
          animate={{ scaleY: 1 }}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] rounded-r-sm bg-gradient-to-b from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)]"
        />
      )}
      {/* Header + Content */}
    </motion.div>
  );
});
```

**FilterSidebar keyboard shortcut pattern** (lines 69-82 of filter-sidebar.tsx):
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      toggle();
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [toggle]);
```

**i18n pattern** (used across all extraction components):
```typescript
const t = useTranslations("extraction");
```

---

### `components/extraction/workbench-data-table.tsx` (component, transform)

**Analog:** `components/extraction/paper-result-card.tsx`

**Imports pattern** (lines 1-19 of paper-result-card.tsx):
```typescript
"use client";

import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { cardEntrance, cardEntranceTransition } from "@/lib/animation-config";
import { ConfidenceBadge } from "@/components/extraction/confidence-badge";
import { StatusBadge } from "@/components/extraction/status-badge";
```

**shadcn Table primitives from `components/ui/table.tsx`** (lines 1-117):
```typescript
// Available exports (all accept className + spread props):
Table           // Wraps <table> in overflow-x container
TableHeader     // <thead> with border-b on child rows
TableBody       // <tbody> with no border on last child
TableRow        // <tr> with hover:bg-muted/50, data-[state=selected]:bg-muted, border-b
TableHead       // <th> h-10 px-2 text-left font-medium whitespace-nowrap
TableCell       // <td> p-2 whitespace-nowrap
TableCaption    // <caption>
TableFooter     // <tfoot>
```

**Reduced-motion pattern from `paper-result-card.tsx`** (lines 58-69):
```typescript
const shouldReduceMotion = useReducedMotion();

// ... build card content ...

if (shouldReduceMotion) {
  return cardContent;
}

return (
  <motion.div {...cardEntrance} transition={cardEntranceTransition(index * 0.05)}>
    {cardContent}
  </motion.div>
);
```

---

### `components/extraction/view-switcher.tsx` (component, event-driven)

**Analog:** `components/extraction/tier-selector.tsx`

**Imports + segmented control pattern** (lines 1-25 of tier-selector.tsx):
```typescript
"use client";

import { useTranslations } from "next-intl";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ModelTier = "auto" | "cheap" | "accurate";

interface TierSelectorProps {
  value: ModelTier;
  onChange: (tier: ModelTier) => void;
  className?: string;
}

export function TierSelector({ value, onChange, className }: TierSelectorProps) {
  const t = useTranslations("extraction");
  // ...
}
```

Note: The view switcher needs `ToggleGroup` (not installed) or a custom segmented control. The TierSelector uses RadioGroup, which is a structural match for the "one of N choices" pattern. If using shadcn `ToggleGroup`, install first: `npx shadcn@latest add toggle-group`.

---

### `components/extraction/column-visibility-toggle.tsx` (component, event-driven)

**Analog:** `components/extraction/extraction-basket-drawer.tsx` (popover with list of toggleable items)

**Imports pattern** (lines 1-20 of extraction-basket-drawer.tsx):
```typescript
"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
```

**Popover primitives from `components/ui/popover.tsx`** (lines 81-89):
```typescript
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
```

**Checkbox primitive from `components/ui/checkbox.tsx`** (lines 1-32):
```typescript
import { CheckIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn("peer border-input ... size-4 shrink-0 rounded-[4px] ...", className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center text-current transition-none">
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
```

---

### `tests/extraction-results-view-store.test.ts` (test, CRUD)

**Analog:** `tests/extraction-basket-store.test.ts`

**Storage mock pattern** (lines 1-13):
```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock sessionStorage before store import (node environment has no sessionStorage)
const sessionStore: Record<string, string> = {};
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => sessionStore[key] ?? null,
  setItem: (key: string, value: string) => { sessionStore[key] = value; },
  removeItem: (key: string) => { delete sessionStore[key]; },
});
```

Note: The new store uses `localStorage`, so mock `localStorage` instead of `sessionStorage`.

**Store state reset pattern** (lines 33-36):
```typescript
describe("useExtractionBasketStore", () => {
  beforeEach(() => {
    useExtractionBasketStore.setState({ papers: new Map() });
  });
```

**CRUD assertion pattern** (lines 38-103):
```typescript
it("add(entry) inserts a new entry", () => {
  const entry = makeEntry();
  useExtractionBasketStore.getState().add(entry);
  expect(useExtractionBasketStore.getState().papers.size).toBe(1);
});

it("clear() empties the Map", () => {
  useExtractionBasketStore.getState().add(makeEntry());
  useExtractionBasketStore.getState().clear();
  expect(useExtractionBasketStore.getState().papers.size).toBe(0);
});
```

**Migration test pattern** (lines 105-116):
```typescript
describe("migrateBasketState", () => {
  it("version 0 returns fresh state with empty Map", () => {
    const result = migrateBasketState({ papers: "garbage" }, 0);
    expect(result).toEqual({ papers: new Map() });
  });

  it("version 1 passes through state unchanged", () => {
    const state = { papers: new Map([["W1", makeEntry()]]) };
    const result = migrateBasketState(state, 1);
    expect(result).toBe(state);
  });
});
```

---

### `tests/workbench-columns.test.ts` (test, transform)

**Analog:** `tests/export-csv-json.test.ts` (pure function output assertions)

**Test environment:** `node` (default vitest environment -- column definitions are pure functions, no DOM needed)

**Test structure pattern** (from extraction-basket-store.test.ts):
```typescript
import { describe, it, expect } from "vitest";

describe("createWorkbenchColumns", () => {
  it("returns static columns for empty questions array", () => { /* ... */ });
  it("generates a dynamic column per question", () => { /* ... */ });
  it("each static column has the expected accessorKey", () => { /* ... */ });
  it("status column has filterFn 'equals'", () => { /* ... */ });
  it("question columns have filterFn 'includesString'", () => { /* ... */ });
});
```

---

## Shared Patterns

### i18n Convention
**Source:** All extraction components use `useTranslations("extraction")`
**Apply to:** All new component files (workbench-shell, workbench-toolbar, workbench-data-table, view-switcher, column-visibility-toggle)
```typescript
const t = useTranslations("extraction");
```

### "use client" Directive
**Source:** Every interactive component in `components/extraction/`
**Apply to:** All new component `.tsx` files
```typescript
"use client";
```
First line of every component file in this phase.

### cn() Class Composition
**Source:** `lib/utils.ts`, used in every component
**Apply to:** All new component files
```typescript
import { cn } from "@/lib/utils";
```

### Zustand Hydration Guard
**Source:** `components/extraction/extraction-basket-drawer.tsx` (lines 33-34) and `components/shared/filter-sidebar.tsx` (line 85)
**Apply to:** `workbench-shell.tsx` -- must wait for store hydration before rendering view-dependent content
```typescript
const hasHydrated = useExtractionResultsViewStore((s) => s._hasHydrated);

// Don't render view content until hydrated
if (!hasHydrated) return <SkeletonState />;
```

### Animation Presets
**Source:** `lib/animation-config.ts`
**Apply to:** `workbench-data-table.tsx`, `view-switcher.tsx`, `workbench-toolbar.tsx`
```typescript
import { subtleSpring, cardEntrance, cardEntranceTransition } from "@/lib/animation-config";
```

### Reduced Motion
**Source:** `components/extraction/paper-result-card.tsx` (lines 59-69)
**Apply to:** `workbench-data-table.tsx`, `view-switcher.tsx`
```typescript
import { useReducedMotion } from "motion/react";
const shouldReduceMotion = useReducedMotion();
```

### Props Interface Naming
**Source:** `CONVENTIONS.md` -- PascalCase `*Props` suffix
**Apply to:** All new components
```typescript
interface WorkbenchShellProps { /* ... */ }
interface WorkbenchToolbarProps { /* ... */ }
interface WorkbenchDataTableProps<T> { /* ... */ }
interface ViewSwitcherProps { /* ... */ }
interface ColumnVisibilityToggleProps { /* ... */ }
```

### Named Exports
**Source:** `CONVENTIONS.md` -- named exports preferred, no default-export bias
**Apply to:** All new files
```typescript
export function WorkbenchShell({ ... }: WorkbenchShellProps) { /* ... */ }
export function createWorkbenchColumns(...) { /* ... */ }
export const useExtractionResultsViewStore = create<...>()(...);
```

### File-Level JSDoc
**Source:** `CONVENTIONS.md` + `lib/extraction/export.ts` (lines 1-6)
**Apply to:** All new files
```typescript
/**
 * Workbench column definitions for TanStack React Table v8.
 * Hoisted at module level to prevent re-render storms (PITFALL 4).
 *
 * Phase 101: WB-01, WB-03.
 */
```

### Test File Location
**Source:** `STRUCTURE.md` -- tests under `tests/` (not colocated), domain subfolders for components
**Apply to:** All new test files
- Store tests: `tests/extraction-results-view-store.test.ts`
- Column tests: `tests/workbench-columns.test.ts`
- Component tests: `tests/components/workbench-toolbar.test.tsx` (jsdom environment, matched by `vitest.config.ts` glob `tests/components/**/*.test.tsx`)

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All 10 files have at least a role-match analog in the codebase |

Note: `components/ui/toggle-group.tsx` does not exist yet. It must be installed via `npx shadcn@latest add toggle-group` before implementing `view-switcher.tsx`, OR the view switcher can be built with a custom segmented control using existing primitives (`Button` + Tailwind classes), following the `TierSelector` RadioGroup pattern as structural reference.

## Metadata

**Analog search scope:** `components/extraction/`, `components/shared/`, `components/ui/`, `lib/store/`, `lib/extraction/`, `app/extraction/`, `tests/`, `convex/extraction/`
**Files scanned:** 38 extraction-related files + 72 test files + 20 UI primitives
**Pattern extraction date:** 2026-04-16
