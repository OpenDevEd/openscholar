# Phase 99: Selection Basket Core - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 7 (new/modified files)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/store/extraction-basket.ts` | store | CRUD | `lib/store.ts` (`createSidebarStore` at line 1070, `useRatingsStore` at line 148) | exact |
| `lib/openalex/normalize.ts` | utility | transform | `lib/openalex/reconstruct-abstract.ts` | exact |
| `lib/hooks/use-add-to-basket.ts` | hook | request-response | `lib/hooks/use-cooldown.ts` | role-match |
| `components/extraction/extraction-basket-drawer.tsx` | component | CRUD | `components/ui/focus-mode.tsx` (Sheet usage at line 448) | role-match |
| `tests/normalize-openalex-id.test.ts` | test | transform | `tests/filter-predicates.test.ts` | exact |
| `tests/extraction-basket-store.test.ts` | test | CRUD | `tests/store-migrations.test.ts` | exact |
| `messages/*.json` (6 locale files) | config | n/a | `messages/en-US.json` (`"extraction"` key at line 1464) | exact |

## Pattern Assignments

### `lib/store/extraction-basket.ts` (store, CRUD)

**Analog:** `lib/store.ts` -- two patterns combined: `createSidebarStore` factory (lines 1070-1095) for persist boilerplate, and `useRatingsStore` (lines 148-176) for CRUD-in-store actions.

**IMPORTANT:** The `lib/store/` directory does NOT exist (deleted in prior teardown). Plan must create it.

**Imports pattern** (`lib/store.ts` lines 0-1):
```typescript
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
```

**NOTE:** This store uses a custom `PersistStorage` instead of `createJSONStorage` because `JSON.stringify(new Map())` produces `"{}"`. Import `PersistStorage` and `StorageValue` types from `zustand/middleware` instead.

**Persist middleware boilerplate** (`lib/store.ts` lines 1070-1095 -- `createSidebarStore`):
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

**Key adaptations for basket store:**
1. Replace `createJSONStorage(() => localStorage)` with a custom `PersistStorage<T>` that converts `Map <-> [key, value][]` array via `sessionStorage`.
2. `_hasHydrated` and `setHasHydrated` pattern copies directly.
3. `partialize` should only persist `papers` (the Map), excluding functions and `_hasHydrated`.
4. `version: 1` and `migrate` pattern copies directly (reset to empty Map on version mismatch).

**CRUD action pattern** (`lib/store.ts` lines 148-176 -- `useRatingsStore`):
```typescript
export const useRatingsStore = create<RatingsState>()(
  persist(
    (set) => ({
      ratings: {},
      setRating: (paperId: string, rating: number | null) =>
        set((state) => {
          if (rating === null) {
            const { [paperId]: _, ...rest } = state.ratings
            return { ratings: rest }
          }
          return {
            ratings: {
              ...state.ratings,
              [paperId]: rating,
            },
          }
        }),
      clearRatings: () => set({ ratings: {} }),
    }),
    {
      name: 'paper-ratings-store',
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        if (version < 1) return { ratings: {} };
        return persistedState;
      },
    }
  )
)
```

**Key pattern:** Immutable state updates inside `set()` -- create a new Map copy, mutate the copy, return it. The `clearRatings: () => set({ ratings: {} })` pattern maps to `clear: () => set({ papers: new Map() })`.

**Store naming convention** (`lib/store.ts` lines 148, 186, 474, 575, 1110):
```
useRatingsStore, useSearchHistoryStore, useUIStore, useFocusModeSettingsStore, useLibrarySidebarStore
```
All follow `useXxxStore` pattern. Basket store exports as `useExtractionBasketStore`.

---

### `lib/openalex/normalize.ts` (utility, transform)

**Analog:** `lib/openalex/reconstruct-abstract.ts`

**Full file pattern** (lines 1-27):
```typescript
/**
 * Reconstruct an abstract from an OpenAlex inverted index.
 *
 * OpenAlex stores abstracts as an inverted index mapping each word
 * to an array of positions. This function reverses that mapping to
 * produce the original plain-text abstract.
 *
 * Pure function -- works in both client and server contexts.
 */
export function reconstructAbstract(
  invertedIndex: Record<string, number[]>
): string {
  if (!invertedIndex || Object.keys(invertedIndex).length === 0) {
    return "";
  }

  const positionMap: Map<number, string> = new Map();

  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      positionMap.set(pos, word);
    }
  }

  const sortedPositions = Array.from(positionMap.keys()).sort((a, b) => a - b);
  return sortedPositions.map((pos) => positionMap.get(pos)).join(" ");
}
```

**Key patterns to replicate:**
1. JSDoc block with description, parameter explanation, and "Pure function" annotation.
2. Named export (not default export).
3. Guard clause at top for invalid input returning empty/null.
4. Pure function with no side effects, no imports -- works in both client and server contexts.
5. Single-responsibility: one function per file.

---

### `lib/hooks/use-add-to-basket.ts` (hook, request-response)

**Analog:** `lib/hooks/use-cooldown.ts` (for file structure and hook export pattern)

**Hook structure pattern** (`lib/hooks/use-cooldown.ts` lines 1-36):
```typescript
import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * Returns a boolean that flips to `true` for `ms` milliseconds
 * after `trigger()` is called. Calling `trigger()` again resets the timer.
 */
export function useCooldown(ms = 2000) {
  // ... implementation ...

  return [isCoolingDown, trigger] as const;
}
```

**Key patterns to replicate:**
1. Import React hooks at top level from `"react"`.
2. JSDoc describing hook purpose and return value.
3. Named function export (not `const useXxx = () =>`).
4. `useCallback` for stable function references (see `use-selection.ts` lines 20-30 for the callback wrapping pattern).
5. Return object with destructurable API: `{ addToBasket, removeFromBasket, isInBasket, basketCount }`.

**Secondary analog for callback pattern** (`lib/hooks/use-selection.ts` lines 20-30):
```typescript
const toggleSelect = useCallback((id: T) => {
  setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
}, []);
```

**Key pattern:** `useCallback` with empty deps for store-driven functions (store actions are stable references). The hook wraps `normalizeOpenAlexId` + store action as a single boundary.

---

### `components/extraction/extraction-basket-drawer.tsx` (component, CRUD)

**Analog:** `components/ui/focus-mode.tsx` (Sheet drawer usage)

**Imports pattern** (`components/ui/focus-mode.tsx` lines 0-17):
```typescript
"use client";

import React, { useCallback, useEffect, useState, useRef } from "react";
import { motion, AnimatePresence, PanInfo } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  useRatingsStore,
  useFocusModeSettingsStore,
  useUIStore,
} from "@/lib/store";
import { useTranslations } from "next-intl";
```

**Component signature pattern** (`components/ui/focus-mode.tsx` lines 32-46):
```typescript
interface FocusModeProps {
  isOpen: boolean;
  onClose: () => void;
  papers: PaperResult[];
  onDownloadItem: (item: PaperResult, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: PaperResult, format: "json" | "csv") => void;
}

export function FocusMode({
  isOpen,
  onClose,
  papers,
  onDownloadItem,
  onDownloadEssentialItem,
}: FocusModeProps) {
```

**Sheet JSX pattern** (`components/ui/focus-mode.tsx` lines 447-453):
```typescript
return (
  <Sheet open={isOpen} onOpenChange={onClose}>
    <SheetContent
      side="right"
      className="w-full sm:max-w-none p-0 overflow-hidden !outline-none"
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        {/* Main Content */}
        {/* Footer */}
      </div>
    </SheetContent>
  </Sheet>
);
```

**Key adaptations for basket drawer:**
1. `side="right"` with appropriate width (not full-width like focus mode -- use `sm:max-w-sm` default).
2. Use `SheetHeader`, `SheetTitle`, `SheetFooter` from the Sheet component for semantic structure.
3. Zustand store selectors instead of props for data (the drawer reads directly from `useExtractionBasketStore`).
4. `useTranslations` for all user-facing strings.

**Accordion for collapsible sections** (`components/ui/accordion.tsx` lines 1-66):
```typescript
import { Accordion as AccordionPrimitive } from "radix-ui"

// Usage for per-source sections:
<Accordion type="multiple" defaultValue={["library", "search"]}>
  <AccordionItem value="library">
    <AccordionTrigger>Library (count)</AccordionTrigger>
    <AccordionContent>
      {/* paper rows */}
    </AccordionContent>
  </AccordionItem>
</Accordion>
```

**Badge for source tags** (`components/ui/badge.tsx` lines 7-27):
```typescript
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium ...",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground ...",
        secondary: "bg-secondary text-secondary-foreground ...",
        outline: "border-border text-foreground ...",
      },
    },
  }
)
```

Use `<Badge variant="secondary">` for source tags (library, search, manual, etc.).

**i18n pattern** (`components/extraction/extraction-dialog.tsx` line 50):
```typescript
const t = useTranslations("extraction");
```

All user-facing text uses `useTranslations` with a namespace key. The basket drawer should use a new namespace (e.g., `"extractionBasket"` or nest under `"extraction"`).

---

### `tests/normalize-openalex-id.test.ts` (test, transform)

**Analog:** `tests/filter-predicates.test.ts`

**Test file structure** (`tests/filter-predicates.test.ts` lines 0-39):
```typescript
import { describe, expect, it } from "vitest";
import {
  isDateFilterActive,
  isRatingFilterActive,
  isCountryFilterActive,
  isCountryFocusActive,
  isCitesFilterActive,
  isCitedByFilterActive,
  isRelatedToFilterActive,
  isReviewFilterActive,
} from "../lib/utils";

describe("isDateFilterActive", () => {
  it("returns false for year filter when not enabled", () => {
    expect(
      isDateFilterActive(undefined, [2020, 2025], "year", false)
    ).toBe(false);
  });

  it("returns true for year filter when enabled", () => {
    expect(
      isDateFilterActive(undefined, [2020, 2025], "year", true)
    ).toBe(true);
  });
```

**Key patterns to replicate:**
1. Imports: `{ describe, expect, it }` from `"vitest"`.
2. Import function under test from relative path `"../lib/openalex/normalize"`.
3. `describe` block per function, `it` blocks per behavior.
4. Descriptive `it` messages: `"returns X for Y when Z"`.
5. Simple `expect(...).toBe(...)` or `.toEqual(...)` assertions.
6. No `beforeEach`/`afterEach` needed for pure function tests.
7. Test environment: `node` (default in `vitest.config.ts`).

---

### `tests/extraction-basket-store.test.ts` (test, CRUD)

**Analog:** `tests/store-migrations.test.ts`

**Store test pattern** (`tests/store-migrations.test.ts` lines 0-25):
```typescript
import { describe, it, expect } from "vitest";
import { migrateSearchHistoryState } from "../lib/store";

describe("migrateSearchHistoryState (collapsed)", () => {
  it("version 0 returns fresh default state", () => {
    const result = migrateSearchHistoryState({ searchHistory: [{ query: "old" }] }, 0);
    expect(result).toEqual({ searchHistory: [] });
  });

  it("version < 1 returns fresh default state regardless of input shape", () => {
    const result = migrateSearchHistoryState("garbage", 0);
    expect(result).toEqual({ searchHistory: [] });
  });

  it("version 1 passes through state unchanged", () => {
    const state = { searchHistory: [{ query: "test", createdAt: "2026-01-01" }] };
    const result = migrateSearchHistoryState(state, 1);
    expect(result).toBe(state); // Same reference -- passthrough
  });
});
```

**Key patterns to replicate:**
1. Export the `migrate` function separately from the store for unit testability.
2. Test migration logic independently of Zustand persist middleware.
3. Test the custom `PersistStorage` `getItem`/`setItem` methods independently (serialize Map -> parse -> verify roundtrip).
4. For store action tests, use `useExtractionBasketStore.getState()` and `useExtractionBasketStore.setState()` directly (no React rendering needed).

---

### `messages/*.json` (6 locale files)

**Analog:** `messages/en-US.json` -- `"extraction"` namespace at line 1464.

Add a new key block (e.g., `"extractionBasket"`) at the same level as `"extraction"`. All 6 files must be updated: `en-US.json`, `en-GB.json`, `fr.json`, `ja.json`, `zh.json`, `hi.json`.

---

## Shared Patterns

### Zustand Persist with Hydration Tracking
**Source:** `lib/store.ts` lines 1070-1095 (`createSidebarStore`)
**Apply to:** `lib/store/extraction-basket.ts`
```typescript
// _hasHydrated pattern -- gate UI rendering on hydration
_hasHydrated: false,
setHasHydrated: (state) => set({ _hasHydrated: state }),
// ...
onRehydrateStorage: () => (state) => {
  state?.setHasHydrated(true);
},
```

### cn() Utility for Class Merging
**Source:** `lib/utils.ts` line 0
**Apply to:** All component files (`extraction-basket-drawer.tsx`)
```typescript
import { cn } from "@/lib/utils"
```

### useTranslations for i18n
**Source:** `components/extraction/extraction-dialog.tsx` line 50, `components/ui/focus-mode.tsx` line 17
**Apply to:** `extraction-basket-drawer.tsx`
```typescript
import { useTranslations } from "next-intl";
const t = useTranslations("extractionBasket");
```

### Vitest Test Structure
**Source:** `vitest.config.ts`
**Apply to:** All test files
```typescript
// Test config: environment: "node" by default
// Test location: tests/ directory
// Include pattern: tests/**/*.test.ts
// Pure function tests: node environment (default)
// Store tests that exercise persist: node environment (default)
```

### Animation Presets
**Source:** `lib/animation-config.ts` lines 18-26 (`commandCenterSpring`)
**Apply to:** `extraction-basket-drawer.tsx` (if custom animation is added to drawer content transitions)
```typescript
import { commandCenterSpring } from "@/lib/animation-config";
// Best fit for modal/panel animations
export const commandCenterSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 35,
  mass: 0.9,
};
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All 7 files have analogs in the codebase |

## Metadata

**Analog search scope:** `lib/`, `components/`, `tests/`, `messages/`
**Files scanned:** 25+ files read, 52 files matched in Sheet grep, 76 test files discovered
**Pattern extraction date:** 2026-04-15
