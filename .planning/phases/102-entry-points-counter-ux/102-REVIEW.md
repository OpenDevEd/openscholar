---
phase: 102-entry-points-counter-ux
reviewed: 2026-04-16T12:45:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - components/app-sidebar.tsx
  - components/extraction/add-to-extraction-button.tsx
  - components/extraction/extraction-basket-drawer.tsx
  - components/extraction/extraction-counter.tsx
  - components/library/library-item-shared.tsx
  - components/paper-card/paper-card-grid.tsx
  - components/paper-card/paper-card-list-detail.tsx
  - components/paper-card/paper-card-list-simple.tsx
  - lib/hooks/use-add-to-basket.ts
  - messages/en-US.json
  - messages/fr.json
  - tests/extraction-basket-cap.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 102: Code Review Report

**Reviewed:** 2026-04-16T12:45:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

This review covers Phase 102 (Entry Points & Counter UX) which adds extraction basket buttons to paper cards, library items, and the sidebar; a counter/progress bar component in the basket drawer; and the cap-aware hook logic for adding papers. The core extraction flow is well-structured with clean separation of concerns: the Zustand store handles state, `computeCapAwareBatch` handles cap logic as a pure function, and the `useAddToBasket` hook composes them. Tests are thorough for the cap logic.

Three warnings were identified: a potential runtime error from accessing `.data?.limit` on an unresolved Convex query during initial load, a stale-closure risk in `computeCapAwareBatch`, and a significant block of untranslated French locale strings. Three informational items note minor quality opportunities.

## Warnings

### WR-01: Duplicate `getExtractionLimit` queries -- divergent fallback creates silent inconsistency

**File:** `components/extraction/extraction-counter.tsx:24-28` and `lib/hooks/use-add-to-basket.ts:93-97`
**Issue:** Both `ExtractionCounter` and `useAddToBasket` independently call `useProtectedQuery(api.extraction.queries.getExtractionLimit, {})` and apply an identical `?? 1000` fallback. If these queries resolve at different times (e.g., the counter renders before the hook in a paper card), or if the backend default changes, the two consumers can momentarily (or permanently, if one query is skipped) disagree on what the limit is. This is not catastrophic, but it means the progress bar could show "at cap" while the button still allows adding, or vice versa. A more resilient pattern would be to read the limit from a single source (e.g., a context provider or centralized store selector).
**Fix:** Extract the limit fetch into a shared hook or context so both components derive from the same reactive value:
```ts
// lib/hooks/use-extraction-limit.ts
export function useExtractionLimit(): number {
  const { data } = useProtectedQuery(
    api.extraction.queries.getExtractionLimit,
    {},
  );
  return data?.limit ?? 1000;
}
```
Then consume `useExtractionLimit()` in both `ExtractionCounter` and `useAddToBasket` instead of duplicating the query call.

### WR-02: `computeCapAwareBatch` couples a "pure" function to Zustand store via `getState()`

**File:** `lib/hooks/use-add-to-basket.ts:41-78`
**Issue:** The doc comment calls `computeCapAwareBatch` a "pure function," but it reads global mutable state via `useExtractionBasketStore.getState()` on line 45. This is intentional (the comment says "reads store state synchronously"), but it means the function is not pure -- its output depends on external state. More importantly, when called from the `useCallback` in `addToBasket` (line 99-110), the `limit` value is captured in the closure but `computeCapAwareBatch` reads `papers` from the live store, so there is a subtle race: if two rapid clicks fire before re-render, the second call reads the un-updated store (since `add(entries)` on line 105 triggers a Zustand `set` that hasn't propagated yet for `getState()`). In practice Zustand `set` is synchronous so `getState()` will see the update, but the pattern is fragile.
**Fix:** Pass the current papers map and size as explicit parameters to make the function truly pure and testable without mocking the store:
```ts
export function computeCapAwareBatch(
  inputs: AddToBasketInput[],
  limit: number,
  currentPapers: Map<string, BasketEntry>,
): AddToBasketResult & { entries: BasketEntry[] } {
  const currentSize = currentPapers.size;
  const remaining = Math.max(0, limit - currentSize);
  // ... use currentPapers.has(normalized) instead of store.has(normalized)
}
```
This also eliminates the need for the `sessionStorage` mock in tests just to import the function.

### WR-03: French locale has 40+ untranslated English strings in extraction section

**File:** `messages/fr.json:1499-1558`
**Issue:** The `extraction.jobsDialogTitle`, `extraction.jobsDialogDescription`, and the entire `extraction.jobCreation`, `extraction.progress`, `extraction.results`, and `extraction.export` subsections are still in English. French-speaking users will see a jarring mix of French and English in the extraction workflow. This is a significant i18n gap for a shipped feature.
**Fix:** Translate the remaining ~40 keys in `messages/fr.json` under `extraction.jobsDialogTitle` through `extraction.export`. For example:
```json
"jobsDialogTitle": "Taches d'extraction",
"jobsDialogDescription": "Suivre les taches d'extraction actives et terminees",
"jobCreation": {
  "title": "Nouvelle tache d'extraction",
  ...
}
```

## Info

### IN-01: `animate` prop on collapsed badge omits `opacity: 1`

**File:** `components/app-sidebar.tsx:143-144`
**Issue:** The badge `<motion.span>` on collapsed nav items sets `initial={{ scale: 0.95, opacity: 0 }}` but `animate={{ scale: 1 }}` without explicitly including `opacity: 1`. Motion will interpolate opacity from 0 to the last known value, which typically resolves correctly, but explicitly setting `animate={{ scale: 1, opacity: 1 }}` is clearer and avoids any edge-case flash.
**Fix:** Add `opacity: 1` to the animate prop:
```tsx
animate={{ scale: 1, opacity: 1 }}
```

### IN-02: `handleToggle` dependency array includes the entire `paper` object

**File:** `components/extraction/add-to-extraction-button.tsx:77`
**Issue:** The `useCallback` for `handleToggle` lists `paper` in its dependency array. Since `paper` is an object prop, a new reference on every parent render will invalidate this callback even when the paper data has not changed. This is a minor optimization concern -- the callback is lightweight so the impact is negligible -- but using the individual fields (`paper.rawId`, `paper.title`, `paper.doi`) would be more precise.
**Fix:** Destructure the paper fields into the dependency array or memoize the paper prop in the parent:
```ts
[inBasket, addToBasket, removeFromBasket, paper.rawId, paper.title, paper.doi, source, t]
```

### IN-03: `onClose` used as `onOpenChange` handler creates ambiguous Sheet behavior

**File:** `components/extraction/extraction-basket-drawer.tsx:65`
**Issue:** `<Sheet open={isOpen} onOpenChange={onClose}>` passes `onClose` (a void function) as the `onOpenChange` handler, which receives a boolean parameter. When Sheet calls `onOpenChange(true)` (which can happen if the sheet is programmatically opened), `onClose` will fire and close the drawer instead. This is unlikely given the current usage (the drawer is externally controlled), but the type mismatch is worth noting. The pattern works because `onClose` ignores its argument, but it is semantically incorrect.
**Fix:** Wrap with an explicit handler:
```tsx
onOpenChange={(open) => { if (!open) onClose(); }}
```

---

_Reviewed: 2026-04-16T12:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
