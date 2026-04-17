# Phase 102: Entry Points & Counter UX - Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 14 (2 new, 6 modified source, 6 modified locale)
**Analogs found:** 8 / 8 (source files only; locale files use flat JSON convention)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `components/extraction/extraction-counter.tsx` | component | request-response (Convex query + Zustand selector) | `components/extraction/extraction-basket-drawer.tsx` | exact |
| `components/extraction/add-to-extraction-button.tsx` | component | request-response (Zustand read/write + tooltip) | `components/paper-card/shared.tsx` (`OpenAccessBadge` compact variant) | role-match |
| `lib/hooks/use-add-to-basket.ts` | hook | transform (normalize + cap-truncate) | `lib/hooks/use-add-to-basket.ts` (self -- extending existing) | exact |
| `components/extraction/extraction-basket-drawer.tsx` | component | request-response | self (replacing plain count with `<ExtractionCounter>`) | exact |
| `components/app-sidebar.tsx` | component | request-response (Zustand selector for badge) | self (badge pattern already at lines 140-148, 165-185, 227-233) | exact |
| `components/library/library-item-shared.tsx` | component | request-response | self (adding button to existing action group) | exact |
| `components/paper-card/paper-card-list-simple.tsx` | component | request-response | self (adding button to quick actions group) | exact |
| `components/paper-card/paper-card-list-detail.tsx` | component | request-response | self (adding button to desktop action bar) | exact |
| `components/paper-card/paper-card-grid.tsx` | component | request-response | self (adding button to header actions group) | exact |
| `messages/en-US.json` | config | N/A | self (extending `extraction` namespace) | exact |
| `messages/en-GB.json` | config | N/A | `messages/en-US.json` | exact |
| `messages/fr.json` | config | N/A | `messages/en-US.json` | exact |
| `messages/ja.json` | config | N/A | `messages/en-US.json` | exact |
| `messages/zh.json` | config | N/A | `messages/en-US.json` | exact |
| `messages/hi.json` | config | N/A | `messages/en-US.json` | exact |

## Pattern Assignments

### `components/extraction/extraction-counter.tsx` (NEW component, Zustand + Convex query)

**Analog:** `components/extraction/extraction-basket-drawer.tsx`

**Imports pattern** (lines 1-20):
```typescript
"use client";

import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
```

**Zustand selector pattern** (extraction-basket-drawer.tsx lines 33-36):
```typescript
const hasHydrated = useExtractionBasketStore((s) => s._hasHydrated);
const papers = useExtractionBasketStore((s) => s.papers);
const count = useExtractionBasketStore((s) => s.papers.size);
```

**Convex reactive query pattern** (use-auth-query.ts lines 49-52):
```typescript
// useProtectedQuery defers until auth is ready, returns undefined while loading
export function useProtectedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: Query["_args"] | "skip",
): { data: Query["_returnType"] | undefined } & QueryHookMetadata {
```

**Usage in new component:**
```typescript
const limitData = useProtectedQuery(api.extraction.queries.getExtractionLimit, {});
const limit = limitData?.limit ?? 1000;
```

**Progress primitive pattern** (components/ui/progress.tsx lines 8-29):
```typescript
// Progress accepts `value` (0-100) and `className` on the Root
// Indicator is nested with data-slot="progress-indicator"
// To style the indicator fill, use descendant selector:
//   [&>[data-slot=progress-indicator]]:bg-destructive
<ProgressPrimitive.Root
  data-slot="progress"
  className={cn("bg-primary/20 relative h-2 w-full overflow-hidden rounded-full", className)}
>
  <ProgressPrimitive.Indicator
    data-slot="progress-indicator"
    className="bg-primary h-full w-full flex-1 transition-all"
    style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
  />
</ProgressPrimitive.Root>
```

**i18n pattern** (extraction-basket-drawer.tsx line 31):
```typescript
const t = useTranslations("extraction.counter");
// Use ICU format: t("label", { count, limit })
```

**cn() class merging for conditional styling** (paper-card/shared.tsx lines 392-401 -- ScreeningBadge uses a stateClasses map):
```typescript
const stateClasses = {
  checked: "bg-green-50 border-green-200 text-green-800 ...",
  crossed: "bg-red-50 border-red-200 text-red-800 ...",
};
// Applied via: cn(baseClasses, stateClasses[displayState])
```

---

### `components/extraction/add-to-extraction-button.tsx` (NEW component, tooltip-wrapped icon button)

**Analog:** `components/paper-card/shared.tsx` (OpenAccessBadge compact variant, lines 472-503) + `components/library/library-item-shared.tsx` (icon button at lines 35-45)

**Imports pattern:**
```typescript
"use client";

import { useCallback } from "react";
import { Plus, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import type { BasketSource } from "@/lib/store/extraction-basket";
```

**Icon button pattern** (library-item-shared.tsx lines 36-45):
```typescript
// Ghost icon button with h-9 w-9, muted foreground, hover states
<a
  href={doiUrl}
  target="_blank"
  rel="noopener noreferrer"
  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
>
  <ExternalLink className="h-4 w-4" />
  <span className="sr-only">{t("viewFullPaper")}</span>
</a>
```

**Tooltip wrapping pattern** (app-sidebar.tsx lines 201-239):
```typescript
// Radix Tooltip with asChild on trigger wrapping a focusable element
<Tooltip delayDuration={0}>
  <TooltipTrigger asChild>
    {/* MUST wrap a focusable element (Button) for keyboard accessibility */}
    <Button variant="ghost" size="icon" ...>
      <Icon className="h-4 w-4" />
    </Button>
  </TooltipTrigger>
  <TooltipContent side="right" className="flex items-center gap-2">
    {label}
  </TooltipContent>
</Tooltip>
```

**Compact action button in paper card** (paper-card/shared.tsx OpenAccessBadge compact, lines 484-502):
```typescript
// Compact icon-only button with tooltip via title attribute
// Phase 102 upgrades this to Radix Tooltip for keyboard accessibility
<div
  role="button"
  tabIndex={0}
  onClick={() => window.open(oaUrl, "_blank")}
  onKeyDown={(e) => e.key === "Enter" && window.open(oaUrl, "_blank")}
  className="flex items-center justify-center p-1.5 rounded-md text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/50 transition-colors cursor-pointer"
  title={tc("openAccessPdf")}
>
  <FileText className="h-4 w-4" />
</div>
```

**Props interface pattern** (paper-card/shared.tsx lines 27-33):
```typescript
export interface PaperCardProps {
  result: PaperResult;
  resultIndex: number;
  onDownloadItem: (item: PaperResult, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: PaperResult, format: "json" | "csv") => void;
  viewMode?: "list-simple" | "list-detail" | "grid-2" | "grid-3";
}
```

---

### `lib/hooks/use-add-to-basket.ts` (MODIFIED hook, cap-aware batch truncation)

**Analog:** Self (extending existing code)

**Current hook structure** (use-add-to-basket.ts lines 1-68, complete file):
```typescript
import { useCallback } from "react";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { normalizeOpenAlexId } from "@/lib/openalex/normalize";
import type { BasketEntry, BasketSource } from "@/lib/store/extraction-basket";

export interface AddToBasketInput {
  rawId: string;
  title: string;
  doi: string | null;
  source: BasketSource;
}

export function useAddToBasket() {
  const add = useExtractionBasketStore((s) => s.add);
  const remove = useExtractionBasketStore((s) => s.remove);
  const count = useExtractionBasketStore((s) => s.papers.size);

  const addToBasket = useCallback(
    (input: AddToBasketInput | AddToBasketInput[]) => {
      const inputs = Array.isArray(input) ? input : [input];
      const entries: BasketEntry[] = [];
      for (const item of inputs) {
        const normalized = normalizeOpenAlexId(item.rawId);
        if (normalized) {
          entries.push({
            openAlexId: normalized,
            title: item.title,
            doi: item.doi,
            source: item.source,
            addedAt: Date.now(),
          });
        }
      }
      if (entries.length > 0) {
        add(entries);
      }
    },
    [add],
  );

  // ... removeFromBasket, isInBasket ...

  return { addToBasket, removeFromBasket, isInBasket, basketCount: count };
}
```

**Synchronous state read pattern** (use-add-to-basket.ts line 64):
```typescript
// CRITICAL: Use getState() for synchronous reads inside callbacks
// to avoid stale values from the last render cycle.
return useExtractionBasketStore.getState().has(normalized);
```

**Cap enforcement extension point** -- The `addToBasket` callback (lines 30-49) must be extended to:
1. Accept a `limit` parameter (from `getExtractionLimit` query)
2. Read current size via `useExtractionBasketStore.getState().papers.size` (NOT the reactive `count`)
3. Truncate entries array to `remaining = Math.max(0, limit - currentSize)`
4. Filter out duplicates before counting against capacity
5. Return `{ added: number; dropped: number }` instead of `void`

**Convex query for limit** -- Hook must call `useProtectedQuery` (use-auth-query.ts lines 49-52):
```typescript
const limitData = useProtectedQuery(api.extraction.queries.getExtractionLimit, {});
const limit = limitData?.limit ?? 1000;
```

---

### `components/extraction/extraction-basket-drawer.tsx` (MODIFIED, replace plain count)

**Analog:** Self

**Current count display** (lines 67-71):
```typescript
<SheetHeader className="border-b p-4">
  <SheetTitle>{t("title")}</SheetTitle>
  <SheetDescription>
    <span className="font-semibold text-primary">{count}</span>{" "}
    {t("description", { count })}
  </SheetDescription>
</SheetHeader>
```

**Modification:** Replace the `<SheetDescription>` block with `<ExtractionCounter />` component. The counter is self-contained (reads its own data), so no props are needed.

---

### `components/app-sidebar.tsx` (MODIFIED, wire badge on Extraction NavItem)

**Analog:** Self (existing badge infrastructure)

**Import addition point** (line 7-8 area):
```typescript
// Add alongside existing store imports:
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
```

**Store read pattern** (already used for other stores, lines 7-8, 29-32):
```typescript
import { useSidebarStore, getSidebarDimensions } from "@/lib/store";
import {
  useSearchHistoryStore,
  useSearchHistoryUIStore,
  useCurrentQueryStore,
  useKeywordExpansionStore,
} from "@/lib/store";
```

**Badge wiring at Extraction NavItem** (lines 627-635):
```typescript
// CURRENT (no badge):
<NavItem
  href="/extraction"
  icon={FlaskConical}
  label={ts("extraction")}
  isActive={currentPageValue === "extraction"}
  isCollapsed={isCollapsed && !isMobile}
  onClick={handleNavClick}
  index={4}
/>

// MODIFIED (with badge):
// 1. Near top of component function, add:
//    const basketCount = useExtractionBasketStore((s) => s.papers.size);
// 2. Add badge prop:
//    badge={basketCount > 0 ? basketCount : undefined}
```

**Existing badge rendering** (lines 140-148 collapsed overlay):
```typescript
{isCollapsed && badge !== undefined && badge > 0 && (
  <motion.span
    initial={{ scale: 0.95, opacity: 0 }}
    animate={{ scale: 1 }}
    className="absolute -top-1.5 -right-1.5 h-4 w-4 flex items-center justify-center text-[10px] font-bold bg-gradient-to-r from-[oklch(0.75_0.15_55)] to-[oklch(0.62_0.16_52)] text-white rounded-full"
  >
    {badge > 9 ? "9+" : badge}
  </motion.span>
)}
```

**Expanded badge rendering** (lines 165-185):
```typescript
{badge !== undefined && badge > 0 && (
  <motion.span
    initial={{ scale: 0.6, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    whileHover={{ scale: 1.1 }}
    transition={{
      delay: 0.1 + index * staggerDelay,
      type: "spring",
      stiffness: 400,
      damping: 20,
    }}
    className={cn(
      "text-xs px-2 py-0.5 rounded-full font-medium badge-glow",
      isActive
        ? "bg-gradient-to-r from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)] text-white shadow-md"
        : "bg-muted text-muted-foreground",
    )}
  >
    {badge}
  </motion.span>
)}
```

**Tooltip badge rendering** (lines 227-233):
```typescript
{badge !== undefined && badge > 0 && (
  <motion.span
    initial={{ scale: 0.95, opacity: 0 }}
    animate={{ scale: 1 }}
    className="text-xs bg-gradient-to-r from-[oklch(0.75_0.15_55)] to-[oklch(0.62_0.16_52)] text-white px-1.5 py-0.5 rounded-full"
  >
    {badge}
  </motion.span>
)}
```

---

### `components/library/library-item-shared.tsx` (MODIFIED, add button to LibraryItemActions)

**Analog:** Self

**Action group container** (lines 33-34):
```typescript
<div className="flex items-center gap-1 rounded-lg bg-background/90 shadow-sm backdrop-blur-sm">
```

**Mount point** (line 35, before the DOI link):
```typescript
// INSERT <AddToExtractionButton> here, before the existing external link
// Props: paper={{ rawId: item.openAlexId, title: item.title, doi: item.doi ?? null }} source="library"
```

**Type context** (line 14):
```typescript
type LibraryItem = Doc<"libraryItems">;
// The component receives `item: LibraryItem` which has openAlexId, title, doi fields
```

---

### `components/paper-card/paper-card-list-simple.tsx` (MODIFIED, add button to quick actions)

**Analog:** Self

**Quick actions group** (lines 143-169):
```typescript
{/* Quick actions */}
<div
  role="group"
  className="hidden @md/card:flex items-center gap-1 flex-shrink-0"
  onClick={(e) => e.stopPropagation()}
  onKeyDown={(e) => e.stopPropagation()}
>
  {/* INSERT <AddToExtractionButton> here, first in the group */}
  {/* Props: paper={{ rawId: result.id, title: result.title, doi: result.doi ?? null }} source="search" */}
  <TranslationToggle ... />
  <OpenAccessBadge ... />
  <DOIBadge ... />
  <DownloadMenuCompact ... />
</div>
```

---

### `components/paper-card/paper-card-grid.tsx` (MODIFIED, add button to header actions)

**Analog:** Self

**Header actions group** (lines 92-117):
```typescript
<div
  role="group"
  className="flex items-center gap-1"
  onClick={(e) => e.stopPropagation()}
  onKeyDown={(e) => e.stopPropagation()}
>
  {/* INSERT <AddToExtractionButton> here, first in the group */}
  {/* Props: paper={{ rawId: result.id, title: result.title, doi: result.doi ?? null }} source="search" */}
  <TranslationToggle ... />
  <OpenAccessBadge ... />
  <DOIBadge ... />
  <DownloadMenuCompact ... />
</div>
```

---

### `components/paper-card/paper-card-list-detail.tsx` (MODIFIED, add button to desktop action bar)

**Analog:** Self

**Desktop action bar** (lines 402-426):
```typescript
{/* Desktop Layout */}
<div className="flex items-center justify-between gap-4 flex-wrap pt-3 border-t border-border/50">
  <div className="flex items-center gap-3">
    <RatingSelector paperId={result.id} paperResult={result} variant="compact" />
  </div>

  <div className="flex items-center gap-2">
    {/* INSERT <AddToExtractionButton> here, first in the group */}
    {/* Props: paper={{ rawId: result.id, title: result.title, doi: result.doi ?? null }} source="search" */}
    <OpenAccessBadge ... />
    <DOIBadge ... />
    <DownloadMenu ... />
  </div>
  ...
```

**Mobile action bar** (lines 332-355):
```typescript
{/* Mobile Layout */}
<div className="space-y-3 pt-3 border-t border-border/50">
  <div className="flex items-center justify-between">
    <RatingSelector ... />
    <div className="flex items-center gap-2">
      {/* INSERT <AddToExtractionButton> here, first in the group */}
      <DownloadMenu ... />
      <OpenAccessBadge ... />
      <DOIBadge ... />
    </div>
  </div>
```

---

### `messages/*.json` (MODIFIED, i18n key seeding -- all 6 locale files)

**Analog:** Existing `extraction.basket` namespace (en-US.json lines 1559-1569)

**Existing namespace structure:**
```json
{
  "extraction": {
    "basket": {
      "title": "Extraction basket",
      "description": "{count, plural, one {paper} other {papers}}",
      "cta": "Review & start extraction",
      "emptyHeading": "No papers selected",
      "emptyBody": "Add papers from your library, search results, or paste OpenAlex IDs to start an extraction job.",
      "removeTooltip": "Remove from basket",
      "removeAriaLabel": "Remove {title} from basket",
      "triggerTooltip": "Open extraction basket",
      "triggerAriaLabel": "Open extraction basket, {count} papers",
      "alreadyInBasket": "Already in your extraction basket"
    }
  }
}
```

**New namespaces to add** (as siblings of `extraction.basket`):
```json
{
  "extraction": {
    "counter": {
      "label": "{count} / {limit} papers",
      "limitReached": "Basket limit reached",
      "limitWarning": "Approaching basket limit"
    },
    "addButton": {
      "add": "Add to extraction basket",
      "remove": "Remove from basket",
      "inBasket": "Already in basket",
      "basketFull": "Basket full \u2014 remove papers to continue",
      "dropped": "Added {added} papers; {dropped} dropped \u2014 basket limit reached"
    }
  }
}
```

---

## Shared Patterns

### Zustand Selector (single source of truth for count)
**Source:** `lib/store/extraction-basket.ts` (lines 108-151)
**Apply to:** `extraction-counter.tsx`, `add-to-extraction-button.tsx`, `app-sidebar.tsx`
```typescript
// Reactive selector (triggers re-render on change):
const count = useExtractionBasketStore((s) => s.papers.size);

// Synchronous read inside callback (no stale value):
const currentSize = useExtractionBasketStore.getState().papers.size;
const inBasket = useExtractionBasketStore.getState().has(normalizedId);
```

### useProtectedQuery for Convex reactive queries
**Source:** `lib/auth/use-auth-query.ts` (lines 49-60)
**Apply to:** `extraction-counter.tsx`, `use-add-to-basket.ts`
```typescript
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";

// Defers query until auth is ready; returns undefined while loading
const limitData = useProtectedQuery(api.extraction.queries.getExtractionLimit, {});
```

### i18n with next-intl
**Source:** `components/extraction/extraction-basket-drawer.tsx` (line 31)
**Apply to:** All new components
```typescript
import { useTranslations } from "next-intl";

// Namespace-scoped translations
const t = useTranslations("extraction.counter");
// ICU message format with named params:
t("label", { count, limit }) // => "42 / 1000 papers"
```

### Toast notification
**Source:** `components/screening/screening-dialog.tsx` (line 306)
**Apply to:** Caller of `useAddToBasket.addToBasket()` when `dropped > 0`
```typescript
import { toast } from "sonner";

// Direct sonner toast (not the custom showStyledToast which only supports "error"):
toast.success(t("submitSuccess"), { duration: 3000 });

// For Phase 102, use toast.info() for the drop notification:
toast.info(t("dropped", { added, dropped }));
```

### cn() utility for conditional classes
**Source:** `lib/utils.ts` (re-exported as `cn`)
**Apply to:** All new components
```typescript
import { cn } from "@/lib/utils";

// Conditional class merging (clsx + tailwind-merge):
className={cn(
  "h-2",
  ratio >= 1 && "[&>[data-slot=progress-indicator]]:bg-destructive",
  ratio >= 0.8 && ratio < 1 && "[&>[data-slot=progress-indicator]]:bg-amber-500 dark:[&>[data-slot=progress-indicator]]:bg-amber-400",
)}
```

### "use client" directive
**Source:** Every interactive component (extraction-basket-drawer.tsx line 1, library-item-shared.tsx line 1, etc.)
**Apply to:** `extraction-counter.tsx`, `add-to-extraction-button.tsx`
```typescript
"use client";
// Required at top of file for components that use hooks (useState, useCallback, Zustand, etc.)
```

---

## Test Pattern

### Zustand store test pattern
**Source:** `tests/extraction-basket-store.test.ts` (complete file, 186 lines)
**Apply to:** `tests/extraction-basket-cap.test.ts` (new)
```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock sessionStorage BEFORE store import
const sessionStore: Record<string, string> = {};
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => sessionStore[key] ?? null,
  setItem: (key: string, value: string) => { sessionStore[key] = value; },
  removeItem: (key: string) => { delete sessionStore[key]; },
});

import { useExtractionBasketStore } from "../lib/store/extraction-basket";

function makeEntry(overrides: Partial<BasketEntry> = {}): BasketEntry {
  return {
    openAlexId: "W111111111",
    title: "Test Paper",
    doi: "10.1234/test",
    source: "search",
    addedAt: Date.now(),
    ...overrides,
  };
}

describe("cap enforcement", () => {
  beforeEach(() => {
    useExtractionBasketStore.setState({ papers: new Map() });
  });

  it("description of behavior", () => {
    // Direct store manipulation via getState()
    useExtractionBasketStore.getState().add(entry);
    expect(useExtractionBasketStore.getState().papers.size).toBe(1);
  });
});
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All files have close analogs in the existing codebase |

## Metadata

**Analog search scope:** `components/extraction/`, `components/paper-card/`, `components/library/`, `components/app-sidebar.tsx`, `components/ui/`, `lib/hooks/`, `lib/store/`, `lib/auth/`, `messages/`, `tests/`, `convex/extraction/`
**Files scanned:** 18 analog files read
**Pattern extraction date:** 2026-04-16
