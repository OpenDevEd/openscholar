---
phase: 102-entry-points-counter-ux
verified: 2026-04-16T12:35:00Z
status: human_needed
score: 5/5
overrides_applied: 0
deferred:
  - truth: "ExtractionCounter rendered on /extraction/new selector page"
    addressed_in: "Phase 103"
    evidence: "Phase 103 SC 1: 'User navigates to /extraction/new and sees a selector page with 4 tabs and a sticky X / 1000 counter' -- the /extraction/new page itself is a Phase 103 deliverable"
  - truth: "All remaining add checkboxes in every source tab disabled with tooltip when basket full"
    addressed_in: "Phase 103"
    evidence: "Phase 103 builds the /extraction/new selector tabs (Library, Collections, Search Results, Manual IDs); Phase 102 delivers the cap-disabled AddToExtractionButton component that those tabs will consume"
  - truth: "AddToExtractionButton mounted in bookmarks command center"
    addressed_in: "N/A -- intentional exclusion"
    evidence: "RESEARCH.md D-09: 'No bookmarks mount -- bookmarks are keyword bookmarks, not per-paper.' Bookmarks in this codebase save search queries, not individual papers, making AddToExtractionButton incompatible."
human_verification:
  - test: "Open the extraction basket drawer and verify the ExtractionCounter shows 'X / 1000 papers' with a working progress bar"
    expected: "Progress bar fills proportionally. Below 80% it uses the default primary color. At 80%+ it turns amber. At 100% it turns destructive red."
    why_human: "Visual color thresholds and progress bar rendering cannot be verified programmatically"
  - test: "Click AddToExtractionButton on a paper in the library page and in search results"
    expected: "Paper is added to basket without page navigation. Icon toggles from Plus to Check. Clicking again removes the paper. Tooltip updates between states."
    why_human: "Interactive toggle behavior, tooltip rendering, and absence of navigation require live browser interaction"
  - test: "Add papers until the basket reaches the cap (1000), then observe AddToExtractionButton on non-basket papers"
    expected: "Button shows disabled state with 'Basket full -- remove papers to continue' tooltip. Papers already in basket remain toggleable for removal."
    why_human: "Cap-disabled UX state with 1000 papers requires populated store and live interaction"
  - test: "Check sidebar Extraction nav item badge updates in real time as papers are added/removed"
    expected: "Badge appears when count > 0, shows exact number for 1-9, shows '9+' for 10+, disappears at 0"
    why_human: "Real-time reactivity of Zustand store driving sidebar badge requires live browser observation"
---

# Phase 102: Entry Points & Counter UX Verification Report

**Phase Goal:** Surface the basket from every command center in the app (library, search, bookmarks) with an "X / 1000" counter and cap-disabled checkboxes that make the hard limit discoverable long before the user hits submit.
**Verified:** 2026-04-16T12:35:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User sees an always-visible "X / 1000 papers" counter with progress bar (yellow at 80%, red at 100%) in basket drawer | VERIFIED | `ExtractionCounter` at `components/extraction/extraction-counter.tsx` renders `t("label", { count, limit })` with 3-state Progress bar. Ratio computed from `count / limit` (not hardcoded). Amber at `ratio >= 0.8`, destructive at `ratio >= 1`. Mounted in `extraction-basket-drawer.tsx` line 72. |
| 2 | Counter also rendered on `/extraction/new` selector page | DEFERRED | The `/extraction/new` page is a Phase 103 deliverable. ExtractionCounter component is created and ready for consumption. Phase 103 SC 1 explicitly includes "sticky X / 1000 counter". |
| 3 | When basket reaches cap, all AddToExtractionButton instances for non-basket papers show disabled with tooltip | VERIFIED | `add-to-extraction-button.tsx` line 56: `isAtCap = count >= limit`, line 93: `disabled={isAtCap && !inBasket}`, line 80-84: tooltip shows `t("basketFull")` when `isAtCap && !inBasket`. |
| 4 | "Every source tab" checkboxes disabled at cap | DEFERRED | Source tabs are Phase 103 deliverables. Phase 102 provides the cap-disabled button component; Phase 103 will mount it in selector tabs. |
| 5 | Bulk-paste excess dropped with toast stating how many papers were dropped | VERIFIED | `use-add-to-basket.ts` `computeCapAwareBatch()` returns `{ added, dropped }` with first-N-fit truncation. `add-to-extraction-button.tsx` lines 70-73: `if (result.dropped > 0) toast.info(t("dropped", { added, dropped }))`. Toast message: "Added {added} papers; {dropped} dropped -- basket limit reached". |
| 6 | AddToExtractionButton mounted in library page | VERIFIED | `library-item-shared.tsx` line 13: imports `AddToExtractionButton`, line 36-43: mounts with `rawId: item.openalexId` (correct lowercase), `source="library"`, `doi: item.doi ?? null`. |
| 7 | AddToExtractionButton mounted in search results (all 3 card variants) | VERIFIED | `paper-card-list-simple.tsx` line 25 + lines 151-158; `paper-card-list-detail.tsx` line 41 + lines 339-346 (mobile) and 419-426 (desktop); `paper-card-grid.tsx` line 25 + lines 99-106. All use `source="search"`, `rawId: result.id`, `title: result.title ?? ""`, `doi: result.doi ?? null`. |
| 8 | AddToExtractionButton mounted in bookmarks command center | N/A (intentional exclusion) | RESEARCH.md D-09: "No bookmarks mount -- bookmarks are keyword bookmarks, not per-paper." Bookmarks in this codebase are saved search queries (keyword bookmarks), not individual paper bookmarks. AddToExtractionButton adds individual papers, which is incompatible. |
| 9 | Sidebar nav "Extraction" item displays live badge count from Zustand store | VERIFIED | `app-sidebar.tsx` line 58: imports `useExtractionBasketStore`, line 479: `basketCount = useExtractionBasketStore((s) => s.papers.size)`, line 635: `badge={basketCount > 0 ? basketCount : undefined}` on the Extraction NavItem. Existing badge renderer at line 147 handles `> 9 ? "9+" : badge`. |
| 10 | Basket drawer header shows ExtractionCounter progress bar instead of plain count | VERIFIED | `extraction-basket-drawer.tsx` line 21: imports `ExtractionCounter`, line 72: `<ExtractionCounter className="pt-1" />` in SheetHeader. Old `<span>` pattern removed. `SheetDescription` kept as `sr-only` for accessibility (line 69-71). |

**Score:** 5/5 truths verified (2 deferred to Phase 103, 1 intentional exclusion -- all non-blocking)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | ExtractionCounter on `/extraction/new` page | Phase 103 | Phase 103 SC 1: "User navigates to /extraction/new and sees a selector page with 4 tabs and a sticky X / 1000 counter" |
| 2 | Source tab checkboxes disabled at cap | Phase 103 | Phase 103 builds the selector page tabs; Phase 102 delivers the cap-disabled component |
| 3 | Bookmarks command center mount | N/A | Intentional exclusion -- bookmarks are keyword bookmarks, not per-paper (RESEARCH.md D-09) |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `components/extraction/extraction-counter.tsx` | ExtractionCounter self-contained component | VERIFIED | 59 lines. Exports `ExtractionCounter`. Reads own count (Zustand) and limit (Convex query). 3-state progress bar. |
| `lib/hooks/use-add-to-basket.ts` | Cap-aware addToBasket returning { added, dropped } | VERIFIED | 129 lines. Exports `useAddToBasket`, `AddToBasketInput`, `AddToBasketResult`, `computeCapAwareBatch`. Returns `{ addToBasket, removeFromBasket, isInBasket, basketCount, limit }`. |
| `tests/extraction-basket-cap.test.ts` | Unit tests for cap enforcement logic | VERIFIED | 148 lines. 5 test cases covering batch truncation, empty basket, full basket rejection, deduplication, and invalid ID filtering. All 5 pass. |
| `messages/en-US.json` | extraction.counter.* and extraction.addButton.* i18n keys | VERIFIED | 3 counter keys (label, limitReached, limitWarning) + 5 addButton keys (add, remove, inBasket, basketFull, dropped) = 8 keys. |
| `components/extraction/add-to-extraction-button.tsx` | AddToExtractionButton standalone icon button with 3 visual states | VERIFIED | 107 lines. Exports `AddToExtractionButton`. 3 states: default (Plus), in-basket (Check, text-primary), cap-disabled (disabled + basketFull tooltip). Fires toast on batch truncation. |
| `components/extraction/extraction-basket-drawer.tsx` | Drawer header replaced with ExtractionCounter | VERIFIED | ExtractionCounter imported and rendered in SheetHeader. sr-only SheetDescription kept for a11y. |
| `components/app-sidebar.tsx` | Sidebar badge on Extraction NavItem | VERIFIED | `useExtractionBasketStore` import, `basketCount` selector, `badge={basketCount > 0 ? basketCount : undefined}` on Extraction NavItem. |
| `components/library/library-item-shared.tsx` | AddToExtractionButton mount in LibraryItemActions | VERIFIED | Import + mount with `rawId: item.openalexId` (correct lowercase), `source="library"`, `doi: item.doi ?? null`. |
| `components/paper-card/paper-card-list-simple.tsx` | AddToExtractionButton mount in list-simple quick actions | VERIFIED | Import + mount with `rawId: result.id`, `source="search"`, `title: result.title ?? ""`. |
| `components/paper-card/paper-card-list-detail.tsx` | AddToExtractionButton mount in list-detail desktop and mobile actions | VERIFIED | Import + 2 mount points: mobile (line 339) and desktop (line 419). Both use `source="search"`. |
| `components/paper-card/paper-card-grid.tsx` | AddToExtractionButton mount in grid header actions | VERIFIED | Import + mount in header actions group with `source="search"`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `extraction-counter.tsx` | `extraction-basket.ts` | `useExtractionBasketStore(s => s.papers.size)` | WIRED | Line 23: reactive selector for count |
| `extraction-counter.tsx` | `convex/extraction/queries.ts` | `useProtectedQuery(api.extraction.queries.getExtractionLimit, {})` | WIRED | Lines 24-27: fetches limit from backend |
| `use-add-to-basket.ts` | `convex/extraction/queries.ts` | `useProtectedQuery` for limit | WIRED | Lines 93-96: same pattern, `limitData.data?.limit ?? 1000` |
| `add-to-extraction-button.tsx` | `use-add-to-basket.ts` | `useAddToBasket` hook | WIRED | Line 44: destructures `{ addToBasket, removeFromBasket, limit }` |
| `add-to-extraction-button.tsx` | `extraction-basket.ts` | `useExtractionBasketStore` for has() and papers.size | WIRED | Line 45: count selector, lines 52-54: reactive `inBasket` via `s.papers.has(normalizedId)` |
| `app-sidebar.tsx` | `extraction-basket.ts` | `useExtractionBasketStore(s => s.papers.size)` for badge | WIRED | Line 479: selector, line 635: badge prop |
| `extraction-basket-drawer.tsx` | `extraction-counter.tsx` | `ExtractionCounter` component | WIRED | Line 21: import, line 72: rendered in SheetHeader |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `extraction-counter.tsx` | `count` | `useExtractionBasketStore(s => s.papers.size)` | Yes -- Zustand store backed by sessionStorage, populated by user actions | FLOWING |
| `extraction-counter.tsx` | `limitData` | `useProtectedQuery(api.extraction.queries.getExtractionLimit)` | Yes -- Convex query at line 689 reads user plan via `getExtractionLimitForUser` with DB query | FLOWING |
| `add-to-extraction-button.tsx` | `inBasket` | `useExtractionBasketStore(s => s.papers.has(normalizedId))` | Yes -- reactive selector on live Map | FLOWING |
| `app-sidebar.tsx` | `basketCount` | `useExtractionBasketStore(s => s.papers.size)` | Yes -- same store, reactive | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Cap enforcement tests pass | `npx vitest run tests/extraction-basket-cap.test.ts` | 5/5 tests pass (3ms) | PASS |
| i18n keys in all 6 locales | Python JSON parse of all locale files | All 6 files: 3 counter + 5 addButton = 8 keys each | PASS |
| No TODO/FIXME/placeholder in key files | grep across all new/modified files | 0 matches | PASS |
| No console.log in key files | grep across all new/modified files | 0 matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-----------|-------------|--------|----------|
| LIM-04 | 102-01 | User sees "X / 1000 papers" counter with progress bar (yellow at 80%, red at 100%) in basket drawer and /extraction/new | SATISFIED (partial) | Counter component created and mounted in drawer. /extraction/new mount deferred to Phase 103 (the page itself is Phase 103). |
| LIM-05 | 102-02 | When basket reaches cap, all "add" checkboxes disabled with tooltip | SATISFIED (partial) | AddToExtractionButton has cap-disabled state. "Every source tab" is Phase 103 scope. |
| LIM-06 | 102-01, 102-02 | Bulk-paste excess dropped with toast stating how many papers were dropped | SATISFIED | `computeCapAwareBatch` returns `{ added, dropped }`. Toast fires via `toast.info(t("dropped", ...))` in AddToExtractionButton. |
| SEL-11 | 102-02 | AddToExtractionButton mounted in library, search, bookmarks | SATISFIED | Mounted in library (1 site) and search (5 sites across 3 card variants). Bookmarks intentionally excluded (keyword bookmarks, not per-paper). |
| SEL-12 | 102-02 | Sidebar nav badge displays live basket count | SATISFIED | `app-sidebar.tsx` reads `papers.size` from Zustand store, passes as `badge` prop on Extraction NavItem. Hidden at 0, "9+" at >9. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | No anti-patterns found in any key files |

### Human Verification Required

### 1. ExtractionCounter Visual States

**Test:** Open the extraction basket drawer with varying paper counts (0, 500, 800, 1000).
**Expected:** Progress bar fills proportionally. Below 80% uses default primary color. At 80%+ turns amber with "Approaching basket limit" text. At 100% turns destructive red with "Basket limit reached" text.
**Why human:** Visual color transitions and progress bar proportional rendering require browser observation.

### 2. AddToExtractionButton Toggle Behavior

**Test:** Click AddToExtractionButton on a paper in the library page and in search results (all card layouts).
**Expected:** Paper is added to basket without page navigation. Icon toggles from Plus to Check with text-primary color. Clicking again removes the paper (Check back to Plus). Tooltip updates between "Add to extraction basket" / "Already in basket".
**Why human:** Interactive toggle behavior, tooltip rendering, icon state transitions, and absence of navigation require live browser interaction.

### 3. Cap-Disabled UX State

**Test:** Add papers until the basket reaches the cap (1000), then observe AddToExtractionButton on non-basket papers.
**Expected:** Button shows disabled state (grayed out). Tooltip shows "Basket full -- remove papers to continue". Papers already in basket remain toggleable for removal (not disabled).
**Why human:** Testing with 1000 papers in the store requires populated state and live interaction to verify the disabled/enabled split behavior.

### 4. Sidebar Badge Reactivity

**Test:** Add and remove papers from the basket while observing the sidebar "Extraction" nav item.
**Expected:** Badge appears when count > 0, shows exact number for 1-9, shows "9+" for 10+, disappears when count returns to 0. Updates happen in real time without page reload.
**Why human:** Real-time Zustand reactivity driving a sidebar UI element requires live browser observation.

### Gaps Summary

No gaps found. All 5 roadmap success criteria are met by the code delivered in Phase 102. Two aspects of SC 1 and SC 2 (counter on `/extraction/new` and source tab checkboxes) are naturally deferred to Phase 103 because the `/extraction/new` page is a Phase 103 deliverable. The bookmarks mount point (mentioned in SC 4 / SEL-11) is intentionally excluded per research finding D-09 because bookmarks in this codebase are keyword bookmarks, not per-paper bookmarks.

All automated checks pass: 5/5 unit tests, 8/8 i18n keys across 6 locales, zero anti-patterns, all key links wired, all data flows verified.

---

_Verified: 2026-04-16T12:35:00Z_
_Verifier: Claude (gsd-verifier)_
