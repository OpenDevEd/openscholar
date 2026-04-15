---
phase: 99-selection-basket-core
reviewed: 2026-04-15T12:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - components/extraction/basket-empty-state.tsx
  - components/extraction/basket-paper-row.tsx
  - components/extraction/basket-source-section.tsx
  - components/extraction/basket-trigger-button.tsx
  - components/extraction/extraction-basket-drawer.tsx
  - lib/hooks/use-add-to-basket.ts
  - lib/openalex/normalize.ts
  - lib/store/extraction-basket.ts
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 99: Code Review Report

**Reviewed:** 2026-04-15T12:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The selection basket feature is well-structured: clean component decomposition, proper Zustand persist setup with custom Map serialization, solid ID normalization with good test coverage, and appropriate use of `useCallback`/`useMemo` for referential stability. The code follows project conventions (next-intl for i18n, Radix-based UI primitives, proper `"use client"` directives).

Four issues require attention: one critical bug where `isInBasket` will not trigger React re-renders, missing error handling in session storage operations that can crash the app, and a stale `defaultValue` that prevents accordion sections from auto-expanding when new sources are added.

## Critical Issues

### CR-01: `isInBasket` is non-reactive -- will not trigger re-renders

**File:** `lib/hooks/use-add-to-basket.ts:61-65`
**Issue:** The `isInBasket` function calls `useExtractionBasketStore.getState()` inside a `useCallback` with an empty dependency array. This reads a snapshot of the store at call time, meaning any component that uses `isInBasket(id)` to conditionally render (e.g., toggling an "Add" vs "Remove" button) will never re-render when the basket changes. The function itself returns the correct value when called, but React has no way to know the return value changed because no subscription exists.

This is a correctness bug: buttons using `isInBasket` to show added/not-added state will appear stuck after the first render.

**Fix:** Expose a reactive selector instead of an imperative getter. The consumer should subscribe to store state changes:
```typescript
const isInBasket = useCallback(
  (rawId: string) => {
    const normalized = normalizeOpenAlexId(rawId);
    if (!normalized) return false;
    return useExtractionBasketStore.getState().has(normalized);
  },
  [],
);
```
Replace with a reactive approach. Two options:

Option A -- Return a selector factory that consumers use with `useExtractionBasketStore`:
```typescript
const createIsInBasketSelector = useCallback(
  (rawId: string) => {
    const normalized = normalizeOpenAlexId(rawId);
    if (!normalized) return () => false;
    return (state: { papers: Map<string, BasketEntry> }) =>
      state.papers.has(normalized);
  },
  [],
);

// Consumer usage:
// const isIn = useExtractionBasketStore(createIsInBasketSelector(rawId));
```

Option B -- Subscribe to the papers Map and check reactively:
```typescript
const papers = useExtractionBasketStore((s) => s.papers);

const isInBasket = useCallback(
  (rawId: string) => {
    const normalized = normalizeOpenAlexId(rawId);
    if (!normalized) return false;
    return papers.has(normalized);
  },
  [papers],
);
```

Option B is simpler but causes the hook to re-render on every basket change. Option A is more targeted. Choose based on how many components consume `isInBasket` simultaneously.

## Warnings

### WR-01: `basketStorage.getItem` will crash on corrupted sessionStorage data

**File:** `lib/store/extraction-basket.ts:68-79`
**Issue:** `JSON.parse(str)` on line 72 will throw if sessionStorage contains corrupted or non-JSON data for the `extraction-basket` key. This can happen if another script writes to the same key, if the browser truncates storage, or if a user manually edits sessionStorage. The crash would prevent the entire store from initializing, blocking all basket functionality.

Similarly, accessing `parsed.state.papers` on line 77 will throw a TypeError if the parsed JSON has an unexpected shape (e.g., `state` is null or `papers` is missing).

**Fix:** Wrap deserialization in a try-catch and return `null` on failure (Zustand persist treats `null` as "no persisted state" and falls back to defaults):
```typescript
getItem: (name: string) => {
  try {
    const str = sessionStorage.getItem(name);
    if (!str) return null;
    const parsed: StorageValue<{ papers: [string, BasketEntry][] }> =
      JSON.parse(str);
    return {
      ...parsed,
      state: {
        ...parsed.state,
        papers: new Map(parsed.state.papers),
      },
    };
  } catch {
    sessionStorage.removeItem(name);
    return null;
  }
},
```

### WR-02: Accordion `defaultValue` is stale -- new source groups will not auto-expand

**File:** `components/extraction/extraction-basket-drawer.tsx:48-51, 79`
**Issue:** `expandedSources` is computed via `useMemo` and passed as `defaultValue` to `<Accordion>`. In React, `defaultValue` is only read on mount. If a user adds papers from a new source (e.g., "zotero") while the drawer is open, the new accordion section will render collapsed because the Accordion was already mounted with the previous `defaultValue`. The `expandedSources` memo will recompute, but the Accordion ignores changes to `defaultValue` after initial mount.

**Fix:** Switch from uncontrolled (`defaultValue`) to controlled (`value` + `onValueChange`) to ensure new source groups are always expanded:
```typescript
const [expandedSources, setExpandedSources] = useState<string[]>([]);

// Auto-expand all sources whenever the grouping changes
useEffect(() => {
  setExpandedSources(Array.from(entriesBySource.keys()));
}, [entriesBySource]);

// In JSX:
<Accordion
  type="multiple"
  value={expandedSources}
  onValueChange={setExpandedSources}
>
```

### WR-03: `migrateBasketState` uses unsafe cast for version >= 1

**File:** `lib/store/extraction-basket.ts:52-58`
**Issue:** When `version >= 1`, the function casts `persistedState` directly to `{ papers: Map<string, BasketEntry> }` without any validation. If a future version 2 changes the shape (or if persisted data is corrupted), this cast silently produces a malformed state that will cause runtime errors downstream (e.g., calling `.has()` on a non-Map).

Combined with WR-01 (no try-catch in storage), corrupted data flows straight through the migration into the store.

**Fix:** Add defensive validation:
```typescript
export function migrateBasketState(
  persistedState: unknown,
  version: number,
): { papers: Map<string, BasketEntry> } {
  if (version < 1) return { papers: new Map() };
  const state = persistedState as Record<string, unknown>;
  if (state?.papers instanceof Map) {
    return { papers: state.papers };
  }
  return { papers: new Map() };
}
```

## Info

### IN-01: `addToBasket` silently drops entries with invalid IDs

**File:** `lib/hooks/use-add-to-basket.ts:31-49`
**Issue:** When `normalizeOpenAlexId` returns `null` for an item in the batch, that item is silently skipped. If a caller passes a batch of 10 papers and 3 have malformed IDs, only 7 are added with no feedback. For an academic research tool where "missing a relevant paper has real consequences" (per CLAUDE.md), silent data loss is worth surfacing.

**Fix:** Consider returning a result object from `addToBasket` so callers can inform the user:
```typescript
interface AddToBasketResult {
  added: number;
  skipped: number;
}
```
Alternatively, log a warning in development mode for debugging purposes.

---

_Reviewed: 2026-04-15T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
