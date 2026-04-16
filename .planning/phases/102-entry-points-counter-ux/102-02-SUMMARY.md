---
phase: 102-entry-points-counter-ux
plan: 02
subsystem: extraction-ui
tags: [zustand, tooltip, sidebar-badge, extraction-basket, paper-card]
dependency_graph:
  requires:
    - phase: 102-01
      provides: [extraction-counter-component, cap-aware-add-to-basket, i18n-counter-keys]
  provides:
    - AddToExtractionButton standalone component with 3 visual states
    - Sidebar extraction nav badge with live basket count
    - Drawer header ExtractionCounter with progress bar
    - Button mounted in library and all 3 search card variants
  affects: [extraction-new-page, extraction-dialog, paper-selector]
tech_stack:
  added: []
  patterns: [reactive-zustand-selector-for-inbasket, stopPropagation-on-card-actions]
key_files:
  created:
    - components/extraction/add-to-extraction-button.tsx
  modified:
    - components/app-sidebar.tsx
    - components/extraction/extraction-basket-drawer.tsx
    - components/library/library-item-shared.tsx
    - components/paper-card/paper-card-list-simple.tsx
    - components/paper-card/paper-card-list-detail.tsx
    - components/paper-card/paper-card-grid.tsx
key_decisions:
  - "Used reactive s.papers.has(normalizedId) selector instead of non-reactive getState().has() for inBasket check"
  - "Used result.title ?? empty-string fallback since OpenAlex result.title is string|undefined"
  - "Kept SheetDescription as sr-only for accessibility when replacing with ExtractionCounter"
patterns-established:
  - "AddToExtractionButton: standalone tooltip-wrapped icon button reusable across any paper surface"
  - "onClick stopPropagation on card-embedded actions to prevent parent card navigation"
requirements-completed: [LIM-05, SEL-11, SEL-12]
key_metrics:
  duration_seconds: 379
  completed: "2026-04-16T11:21:20Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 6
---

# Phase 102 Plan 02: AddToExtractionButton + Mount Points + Sidebar Badge Summary

AddToExtractionButton with 3 visual states (default/in-basket/cap-disabled) mounted in library actions and all 3 search card variants, sidebar extraction badge with live count, and drawer header replaced with ExtractionCounter progress bar.

## Performance

- **Duration:** 6 min 19s
- **Started:** 2026-04-16T11:15:01Z
- **Completed:** 2026-04-16T11:21:20Z
- **Tasks:** 3/3
- **Files modified:** 7

## Accomplishments
- Created AddToExtractionButton component with Plus/Check icon toggle, cap enforcement, and batch truncation toast
- Wired sidebar Extraction NavItem with live badge count (hidden at 0, "9+" for >9 via existing badge renderer)
- Replaced basket drawer SheetDescription with ExtractionCounter progress bar
- Mounted AddToExtractionButton in 5 locations: library actions, list-simple, list-detail (desktop+mobile), grid

## Task Commits

Each task was committed atomically:

1. **Task 1: Create AddToExtractionButton component** - `d58eb8e` (feat)
2. **Task 2: Wire sidebar badge + replace drawer header** - `655b226` (feat)
3. **Task 3: Mount in library and search card variants** - `807d851` (feat)

## Files Created/Modified
- `components/extraction/add-to-extraction-button.tsx` - Standalone tooltip-wrapped icon button with 3 visual states, cap enforcement, batch truncation toast
- `components/app-sidebar.tsx` - Added useExtractionBasketStore import, basketCount selector, badge prop on Extraction NavItem
- `components/extraction/extraction-basket-drawer.tsx` - Imported ExtractionCounter, replaced SheetDescription with ExtractionCounter (sr-only description kept for a11y)
- `components/library/library-item-shared.tsx` - AddToExtractionButton mounted with source="library", rawId=item.openalexId
- `components/paper-card/paper-card-list-simple.tsx` - AddToExtractionButton mounted with source="search" in quick actions
- `components/paper-card/paper-card-list-detail.tsx` - AddToExtractionButton mounted in both desktop and mobile action bars
- `components/paper-card/paper-card-grid.tsx` - AddToExtractionButton mounted in header actions group

## Decisions Made

1. **Reactive selector for inBasket** -- Used `useExtractionBasketStore((s) => normalizedId ? s.papers.has(normalizedId) : false)` instead of the non-reactive `getState().has()`. The selector approach triggers re-renders when the basket changes, ensuring the Check/Plus icon updates immediately on add/remove.

2. **result.title fallback** -- OpenAlex `result.title` type is `string | undefined` but `AddToBasketInput.title` requires `string`. Used `result.title ?? ""` at mount points rather than widening the prop type, since the store `BasketEntry.title` is `string` and an empty title is a harmless edge case for display in the drawer.

3. **sr-only SheetDescription** -- Kept `<SheetDescription className="sr-only">` in the drawer header for accessibility (screen reader announces the basket description) while visually replacing it with the ExtractionCounter progress bar.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed result.title type mismatch (string|undefined vs string)**
- **Found during:** Task 3 (Mount AddToExtractionButton in paper cards)
- **Issue:** OpenAlex result.title is typed as `string | undefined` but AddToExtractionButton.paper.title requires `string`, causing tsc errors in all 3 card variants (4 mount points total)
- **Fix:** Added `?? ""` fallback at each mount site: `title: result.title ?? ""`
- **Files modified:** paper-card-list-simple.tsx, paper-card-list-detail.tsx (2 sites), paper-card-grid.tsx
- **Verification:** `npx tsc --noEmit` passes with 0 new errors
- **Committed in:** 807d851 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Type mismatch required trivial fallback. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All extraction basket entry points are wired and functional
- ExtractionCounter progress bar visible in drawer header
- Sidebar badge provides at-a-glance basket awareness
- Ready for Phase 103 (extraction workbench views) which will consume basket contents

## Self-Check: PASSED

All 7 created/modified key files exist. All 3 commits (d58eb8e, 655b226, 807d851) verified in git log.

---
*Phase: 102-entry-points-counter-ux*
*Completed: 2026-04-16*
