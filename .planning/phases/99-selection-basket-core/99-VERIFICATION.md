---
phase: 99-selection-basket-core
verified: 2026-04-15T18:22:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "Open the basket trigger button and verify the Sheet drawer slides in from the right with paper count, per-source Accordion breakdown, and CTA"
    expected: "Drawer opens showing total count in header, collapsible per-source groups with paper rows (title, DOI, source badge, remove button), and a sticky footer with 'Review & start extraction' CTA disabled when empty"
    why_human: "Visual layout, animation, sticky header/footer positioning, and Accordion expand/collapse behavior cannot be verified programmatically"
  - test: "Add papers via different sources, verify per-source breakdown groups correctly and remove button works"
    expected: "Clicking X on a paper row removes it from the basket; the count updates in header and badge; Accordion section counts update"
    why_human: "Interactive state mutation with visual feedback requires browser rendering and user interaction"
  - test: "Verify the empty state illustration when basket has zero papers"
    expected: "FlaskConical icon at size-12 with muted foreground, heading 'No papers selected', and guidance body copy"
    why_human: "Visual appearance and icon rendering cannot be confirmed programmatically"
  - test: "Verify the trigger button count badge shows correct count, '9+' for >9, and hides before hydration"
    expected: "Badge overlay shows count, transitions to '9+' above 9, and does not flash 0 on initial SSR load"
    why_human: "Hydration timing and SSR flash-of-content requires browser rendering to verify"
  - test: "Verify sessionStorage persistence across client-side navigation"
    expected: "Add papers, navigate away, navigate back -- basket count and contents persist within same browser tab"
    why_human: "sessionStorage persistence across navigation requires a running browser session"
---

# Phase 99: Selection Basket Core Verification Report

**Phase Goal:** A tab-scoped, dedupe-safe paper basket that survives in-app navigation and can be peeked from anywhere via a drawer -- with zero backend dependency so it can ship in parallel with phases 100 and 101.
**Verified:** 2026-04-15T18:22:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User adds papers in one tab, navigates away, basket count is still correct (sessionStorage-backed Zustand store) -- SEL-07 | VERIFIED | `lib/store/extraction-basket.ts` uses custom `basketStorage` PersistStorage with `sessionStorage.getItem/setItem/removeItem`; store name `"extraction-basket"`, version 1; `_hasHydrated` + `onRehydrateStorage` for hydration tracking; 14 passing tests confirm CRUD, dedupe, serialization round-trip, and migration |
| 2 | User adds same paper via W123, URL, and openalex: prefix -- basket shows exactly one entry -- SEL-08 | VERIFIED | `lib/openalex/normalize.ts` contains regex `/^(?:https?:\/\/openalex\.org\/)?(?:openalex:)?(W\d+)/i`; `useAddToBasket` hook normalizes via `normalizeOpenAlexId` before calling `store.add`; store dedupes via Map key; 15 passing normalize tests + store dedupe tests confirm behavior |
| 3 | User clicks Extraction basket icon, Sheet drawer opens showing global count, per-source breakdown, and "Review & start extraction" CTA -- SEL-09 | VERIFIED | `ExtractionBasketDrawer` uses `Sheet` with `side="right"`, header with count via `useExtractionBasketStore(s => s.papers.size)`, `Accordion type="multiple"` with `BasketSourceSection` for per-source groups, `ScrollArea` body, sticky footer with `Button disabled={count === 0}` that calls `router.push("/extraction/new")`; `BasketTriggerButton` with FlaskConical icon and count badge overlay |
| 4 | User removes individual paper from basket drawer, and sees "already in basket" indicator -- SEL-10 | VERIFIED | `BasketPaperRow` has remove button calling `onRemove(entry.openAlexId)` wired to store's `remove` action; `useAddToBasket.isInBasket(rawId)` uses `getState().has(normalized)` for O(1) non-reactive lookup; `alreadyInBasket` i18n key present in all 6 locales; indicator rendering deferred to Phase 102/103 which consumes the hook |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/openalex/normalize.ts` | normalizeOpenAlexId pure utility | VERIFIED | 27 lines; exports `normalizeOpenAlexId(input: string): string | null`; pure function, zero deps, no `any` types |
| `lib/store/extraction-basket.ts` | Zustand store with sessionStorage persistence and Map-backed dedupe | VERIFIED | 152 lines; exports `useExtractionBasketStore`, `BasketEntry`, `BasketSource`, `migrateBasketState`, `basketStorage`; custom PersistStorage, partialize, hydration tracking |
| `lib/hooks/use-add-to-basket.ts` | Public hook API for downstream phases | VERIFIED | 68 lines; exports `useAddToBasket`, `AddToBasketInput`; uses `useCallback` for stable refs, `getState().has()` for non-reactive `isInBasket`, `Date.now()` for `addedAt` |
| `tests/normalize-openalex-id.test.ts` | Unit tests for normalize utility | VERIFIED | 15 test cases, all passing (bare, URL, prefix, whitespace, query params, fragments, DOI, PMID, non-work entity) |
| `tests/extraction-basket-store.test.ts` | Unit tests for store CRUD, dedupe, migration | VERIFIED | 14 test cases, all passing (add, dedupe, batch, remove, has, clear, migration v0/v1, serialization round-trip, entriesBySource grouping) |
| `components/extraction/extraction-basket-drawer.tsx` | Sheet drawer shell with header, ScrollArea body, and footer | VERIFIED | 107 lines; exports `ExtractionBasketDrawer`; Sheet side="right", sticky header/footer, ScrollArea body, Accordion per-source, hydration gate, i18n via `useTranslations("extraction.basket")` |
| `components/extraction/basket-trigger-button.tsx` | Icon button with count badge overlay | VERIFIED | 48 lines; exports `BasketTriggerButton`; FlaskConical icon, Badge count overlay ("9+" for >9), hydration gate prevents flash |
| `components/extraction/basket-paper-row.tsx` | Individual paper row with title, DOI, source badge, remove button | VERIFIED | 51 lines; exports `BasketPaperRow`; truncated title, conditional DOI, secondary Badge for source, ghost remove button with hover:text-destructive and Tooltip |
| `components/extraction/basket-source-section.tsx` | Collapsible per-source group using Accordion | VERIFIED | 44 lines; exports `BasketSourceSection`; AccordionItem with trigger showing source label + count, content renders BasketPaperRow list |
| `components/extraction/basket-empty-state.tsx` | Empty state with FlaskConical icon | VERIFIED | 19 lines; exports `BasketEmptyState`; FlaskConical size-12 with muted foreground, heading + body guidance copy via i18n |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `lib/hooks/use-add-to-basket.ts` | `lib/openalex/normalize.ts` | `import normalizeOpenAlexId` | WIRED | Line 3: `import { normalizeOpenAlexId } from "@/lib/openalex/normalize"` |
| `lib/hooks/use-add-to-basket.ts` | `lib/store/extraction-basket.ts` | `import useExtractionBasketStore` | WIRED | Line 2: `import { useExtractionBasketStore } from "@/lib/store/extraction-basket"` |
| `lib/store/extraction-basket.ts` | `sessionStorage` | custom PersistStorage adapter | WIRED | Lines 69, 85, 96: `sessionStorage.getItem/setItem/removeItem` in `basketStorage` |
| `components/extraction/extraction-basket-drawer.tsx` | `lib/store/extraction-basket.ts` | `useExtractionBasketStore` selectors | WIRED | Lines 33-36: selectors for `_hasHydrated`, `papers`, `papers.size`, `remove` |
| `components/extraction/extraction-basket-drawer.tsx` | `components/ui/sheet.tsx` | Sheet components | WIRED | Line 13: `from "@/components/ui/sheet"` (Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription) |
| `components/extraction/basket-paper-row.tsx` | `lib/store/extraction-basket.ts` | store.remove via prop drilling | WIRED | Row receives `onRemove` prop from drawer which holds store's `remove` action |
| `messages/en-US.json` | `components/extraction/extraction-basket-drawer.tsx` | `useTranslations('extraction.basket')` | WIRED | Line 31: `const t = useTranslations("extraction.basket")`; en-US has 11 keys + 5 sourceLabel sub-keys |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `extraction-basket-drawer.tsx` | `papers`, `count` | `useExtractionBasketStore` selectors | Yes -- Zustand store with Map, populated by `add()` action | FLOWING |
| `basket-trigger-button.tsx` | `count`, `hasHydrated` | `useExtractionBasketStore` selectors | Yes -- same store, `papers.size` selector | FLOWING |
| `basket-source-section.tsx` | `entries` | prop from drawer (derived from store) | Yes -- `entriesBySource` groups Map values by source | FLOWING |
| `basket-paper-row.tsx` | `entry` | prop from source section (originated from store) | Yes -- each `BasketEntry` from Map | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| normalizeOpenAlexId passes all 15 tests | `npx vitest run tests/normalize-openalex-id.test.ts` | 15/15 pass | PASS |
| Basket store passes all 14 tests | `npx vitest run tests/extraction-basket-store.test.ts` | 14/14 pass | PASS |
| TypeScript compiles with zero errors for phase 99 files | `npx tsc --noEmit` | 0 errors on phase 99 files | PASS |
| No `createJSONStorage(() => sessionStorage)` used | `grep -rn "createJSONStorage.*sessionStorage" lib/store/` | 0 matches | PASS |
| No ES getter for count | `grep "get count()" lib/store/extraction-basket.ts` | 0 matches | PASS |
| No `any` type violations | grep for `: any` and `as any` | 0 matches across all 8 files | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEL-07 | 99-01 | Selection basket persists via sessionStorage-backed Zustand store | SATISFIED | `useExtractionBasketStore` with custom `basketStorage` using `sessionStorage`; `_hasHydrated` + `onRehydrateStorage`; partialize for papers only |
| SEL-08 | 99-01 | Basket dedupes via normalizeOpenAlexId (W123, URL, openalex: prefix) | SATISFIED | `normalizeOpenAlexId` regex handles all 3 formats; store uses Map-key dedupe; 15 + 2 dedupe tests confirm |
| SEL-09 | 99-01, 99-02 | Sheet drawer with count, per-source breakdown, CTA | SATISFIED | `ExtractionBasketDrawer` with Sheet side="right", Accordion per-source, sticky header count, footer CTA to `/extraction/new`; `BasketTriggerButton` with badge overlay |
| SEL-10 | 99-01, 99-02 | Remove individual papers + "already in basket" indicator | SATISFIED | `BasketPaperRow` remove button wired to store's `remove`; `useAddToBasket.isInBasket()` provides O(1) lookup; `alreadyInBasket` i18n key in all 6 locales; visual indicator rendering by Phase 102/103 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | -- | -- | -- | No anti-patterns detected across all 8 phase files |

### Human Verification Required

### 1. Drawer Visual Layout and Interaction

**Test:** Open the basket trigger button and verify the Sheet drawer slides in from the right with paper count, per-source Accordion breakdown, and CTA. Add papers from different sources, verify grouping. Click remove on a paper row.
**Expected:** Drawer opens with sticky header showing count, scrollable body with collapsible per-source Accordion sections, each showing source label + count + paper rows (title, DOI, source badge, remove button), and sticky footer with "Review & start extraction" CTA disabled when empty.
**Why human:** Visual layout, animation, sticky positioning, and Accordion expand/collapse behavior cannot be verified programmatically.

### 2. Trigger Button Badge and Hydration

**Test:** Load a page with the trigger button mounted. Verify count badge shows correct number, transitions to "9+" above 9, and does not flash 0 on initial SSR load.
**Expected:** Badge overlay appears only after hydration with correct count; no layout shift or flash-of-zero.
**Why human:** Hydration timing and SSR flash-of-content requires a running browser to verify.

### 3. SessionStorage Persistence Across Navigation

**Test:** Add papers to the basket, navigate to a different page within the app, navigate back.
**Expected:** Basket count and contents persist within the same browser tab.
**Why human:** sessionStorage persistence across client-side navigation requires a running browser session.

### 4. Empty State Rendering

**Test:** Open the drawer with zero papers in the basket.
**Expected:** FlaskConical icon at size-12 with muted foreground, "No papers selected" heading, and guidance body copy.
**Why human:** Visual appearance of the empty state illustration requires browser rendering.

### 5. I18n Locale Switching

**Test:** Switch locale to fr, ja, zh, hi and verify drawer strings are translated correctly.
**Expected:** All 11 extraction.basket.* keys and 5 sourceLabel sub-keys render in the selected locale.
**Why human:** Translation accuracy and locale-specific formatting (French diacritics, CJK characters, Hindi script) require visual inspection.

### Gaps Summary

No automated gaps found. All 4 roadmap success criteria are verified at the code level. All 4 requirements (SEL-07, SEL-08, SEL-09, SEL-10) are satisfied. All 10 artifacts exist, are substantive, and are correctly wired. All 29 tests pass. TypeScript compiles cleanly with zero errors on phase 99 files. No anti-patterns detected.

5 items require human verification: drawer visual layout/interaction, trigger button hydration behavior, sessionStorage persistence across navigation, empty state rendering, and i18n locale switching.

---

_Verified: 2026-04-15T18:22:00Z_
_Verifier: Claude (gsd-verifier)_
