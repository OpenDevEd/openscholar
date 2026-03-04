---
phase: 64-components
plan: 01
subsystem: ui
tags: [typescript, type-safety, react, openalex, paper-card, focus-mode, country-selector]

# Dependency graph
requires:
  - phase: 63-client-libraries
    provides: "PaperResult type alias and DownloadHandlers interface in lib/types"
provides:
  - "Typed paper display pipeline (results-list -> paper-card -> focus-mode)"
  - "Typed country-selector hierarchy processing"
  - "Extended PaperResult with API fields missing from SDK (fwci, primary_topic, etc.)"
affects: [64-02-PLAN, components]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extend SDK Work type via Omit + intersection for missing API fields"
    - "Use optional prop types in shared components to match SDK optional fields"

key-files:
  created: []
  modified:
    - components/results-list.tsx
    - components/paper-card/shared.tsx
    - components/paper-card/hooks.ts
    - components/paper-card/paper-card-list-detail.tsx
    - components/focus-mode/focus-mode-header.tsx
    - components/focus-mode/paper-content.tsx
    - components/focus-mode/focus-mode-settings.tsx
    - components/country-selector.tsx
    - lib/types/search.types.ts

key-decisions:
  - "Extended PaperResult with Omit<Work, 'sustainable_development_goals'> & {...} to properly type API fields missing from SDK"
  - "Widened shared component prop types (AuthorsLine, JournalLine, OpenAccessBadge, DOIBadge) to accept optional fields from PaperResult"
  - "Used non-null assertions (!) for narrowed-but-uncaptured optional access in JSX ternaries"
  - "Defined local HierarchyEntry interface in country-selector instead of exporting Entry from constants"

patterns-established:
  - "Omit + intersection pattern: Omit<SDKType, 'field'> & { field: ProperType } for overriding untyped SDK fields"

requirements-completed: [COMP-01, COMP-03]

# Metrics
duration: 8min
completed: 2026-03-04
---

# Phase 64 Plan 01: Results List, Paper Card, Focus Mode, Country Selector Type Safety Summary

**Replaced 22 `any` instances across 7 component files with PaperResult, TranslationContent, HierarchyEntry, and string[] types; extended PaperResult to include OpenAlex API fields missing from SDK**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-04T13:30:43Z
- **Completed:** 2026-03-04T13:39:27Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Eliminated all `any` annotations from the paper display pipeline (results-list -> paper-card -> focus-mode)
- Extended PaperResult type to include fwci, primary_topic, cited_by_percentile_year, referenced_works_count, and properly-typed sustainable_development_goals
- Typed country-selector hierarchy processing with local HierarchyEntry interface
- Fixed cascading type compatibility issues in dependent components (paper-card-list-detail, paper-card-list-simple)

## Task Commits

Each task was committed atomically:

1. **Task 1: Type results-list.tsx and paper-card components** - `fd27d96` (feat)
2. **Task 2: Type focus-mode components and country-selector** - `e1bd990` (feat)

## Files Created/Modified
- `components/results-list.tsx` - PaperResult for all paper arrays and download callbacks
- `components/paper-card/shared.tsx` - PaperResult for result prop, TranslationContent for translation, optional prop types for shared badges
- `components/paper-card/hooks.ts` - string[] for related_works, optional fields for useTranslate/useScreening data params
- `components/paper-card/paper-card-list-detail.tsx` - Fix SDG length check and narrowing
- `components/focus-mode/focus-mode-header.tsx` - PaperResult for currentPaper and download callbacks
- `components/focus-mode/paper-content.tsx` - PaperResult for paper prop, non-null assertions for narrowed optionals
- `components/focus-mode/focus-mode-settings.tsx` - PaperResult for currentPaper
- `components/country-selector.tsx` - HierarchyEntry interface for processEntry and child mapping
- `lib/types/search.types.ts` - Extended PaperResult with Omit + intersection for missing SDK fields

## Decisions Made
- Extended PaperResult with `Omit<Work, 'sustainable_development_goals'> & {...}` -- the SDK's Work type is missing several fields the OpenAlex API returns (fwci, primary_topic, cited_by_percentile_year, referenced_works_count) and has `sustainable_development_goals` typed as `{}[]`. Using Omit ensures our typed version overrides the untyped SDK field.
- Widened shared component prop types to accept optional fields -- since PaperResult has `title?: string`, `abstract?: string`, `doi?: string`, etc., the shared components (AuthorsLine, JournalLine, OpenAccessBadge, DOIBadge, ScreeningResponses) needed optional props. All already had runtime guards.
- Used non-null assertions (`!`) for values guarded by conditional checks that TypeScript can't narrow through ternary/closure boundaries.
- Defined local `HierarchyEntry` interface in country-selector rather than exporting `Entry` from constants, since Entry is module-private.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended PaperResult type for missing SDK fields**
- **Found during:** Task 2 (Focus-mode components)
- **Issue:** The OpenAlex SDK Work type lacks fwci, primary_topic, cited_by_percentile_year, referenced_works_count fields and has untyped sustainable_development_goals. Switching from `any` to `PaperResult` exposed ~17 TS errors accessing these fields.
- **Fix:** Extended PaperResult using `Omit<Work, 'sustainable_development_goals'> & { ... }` with properly typed additional fields.
- **Files modified:** lib/types/search.types.ts
- **Committed in:** e1bd990 (Task 2 commit)

**2. [Rule 3 - Blocking] Widened shared component prop types for PaperResult compatibility**
- **Found during:** Task 2 (cascading from Task 1 PaperCardProps change)
- **Issue:** Changing `result: any` to `result: PaperResult` in PaperCardProps caused type errors in paper-card-list-detail.tsx and paper-card-list-simple.tsx where optional PaperResult fields were passed to components expecting required types.
- **Fix:** Made AuthorsLine authorships optional, JournalLine source.display_name optional, OpenAccessBadge isOA optional, DOIBadge doi optional, ScreeningResponses/useTranslate/useScreening data fields optional.
- **Files modified:** components/paper-card/shared.tsx, components/paper-card/hooks.ts, components/paper-card/paper-card-list-detail.tsx, components/focus-mode/paper-content.tsx
- **Committed in:** e1bd990 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both auto-fixes necessary for TypeScript compilation. The PaperResult extension and prop widening are the correct long-term approach. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Paper display pipeline fully typed from results-list through paper-card to focus-mode
- PaperResult now includes all commonly-used OpenAlex API fields
- Ready for 64-02 (remaining component type safety work)

---
*Phase: 64-components*
*Completed: 2026-03-04*
