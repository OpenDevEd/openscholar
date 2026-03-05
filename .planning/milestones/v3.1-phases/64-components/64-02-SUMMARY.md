---
phase: 64-components
plan: 02
subsystem: ui
tags: [typescript, react, convex, type-safety, extraction-components]

# Dependency graph
requires:
  - phase: 63-client-libraries
    provides: "Typed lib modules (search.types.ts, extraction.types.ts)"
provides:
  - "Zero any in all 7 extraction component files"
  - "Typed report builder with Convex Infer for saved view callbacks"
  - "Typed review queue with CitationLocation-compatible citations"
  - "Typed SWR infinite pagination for Zotero selector"
  - "Type predicate filtering for job creator history entries"
affects: [64-03, 65-remaining-components]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Convex Infer<typeof validator> for callback prop types when frontend interface differs from Convex return"
    - "Type predicate .filter((x): x is T => Boolean(x)) to replace as any[]"
    - "Remove redundant : any from .map() when source array is typed from Convex query"

key-files:
  created: []
  modified:
    - "components/extraction/report-builder.tsx"
    - "components/extraction/insights-question-panel.tsx"
    - "components/extraction/insights-overview.tsx"
    - "components/extraction/review-queue.tsx"
    - "components/extraction/zotero-selector.tsx"
    - "components/extraction/history-selector.tsx"
    - "components/extraction/job-creator.tsx"

key-decisions:
  - "Used Infer<typeof extractionSavedViewValidator> for onApplySavedView callback instead of ExtractionSavedView -- Convex return type has Id<> and number[] that differ from frontend interface"
  - "Cast charRange to [number, number] tuple in review-queue citations mapping -- Convex returns number[] but CitationLocation requires tuple"
  - "Converted DateRange dates to ISO strings in job-creator sourceHistoryEntries -- react-day-picker DateRange uses Date objects but Convex mutation expects strings"

patterns-established:
  - "Infer<typeof validator> pattern: Use Convex validator Infer for component props when Convex return types differ from frontend type aliases"

requirements-completed: [COMP-02]

# Metrics
duration: 7min
completed: 2026-03-04
---

# Phase 64 Plan 02: Extraction Components Type Safety Summary

**Eliminated ~18 any annotations across 7 extraction components using Convex query inference, type predicates, and Infer<typeof validator> for cross-boundary types**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-04T13:30:47Z
- **Completed:** 2026-03-04T13:38:29Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Removed all any annotations from 7 extraction component files (report-builder, insights-question-panel, insights-overview, review-queue, zotero-selector, history-selector, job-creator)
- Leveraged Convex query return type inference to remove redundant type annotations in .map() callbacks
- Used Convex Infer<typeof validator> pattern for callback prop types where frontend interfaces diverge from Convex return types
- Replaced unsafe `as any[]` with type predicate filter in job-creator

## Task Commits

Each task was committed atomically:

1. **Task 1: Type report-builder, insights-question-panel, and insights-overview** - `40d8c86` (feat)
2. **Task 2: Type review-queue, zotero-selector, history-selector, and job-creator** - `f0630cf` (feat)

## Files Created/Modified
- `components/extraction/report-builder.tsx` - Added ExtractionReportSnapshot import, Infer<typeof extractionSavedViewValidator> for callback, removed 7 any annotations
- `components/extraction/insights-question-panel.tsx` - Removed 2 any from entity/answer distribution maps
- `components/extraction/insights-overview.tsx` - Removed 2 any from diagnostics/question maps
- `components/extraction/review-queue.tsx` - Removed 2 any from item/citation maps, cast charRange to tuple
- `components/extraction/zotero-selector.tsx` - Typed SWR infinite previousPageData with inline page shape
- `components/extraction/history-selector.tsx` - Removed any from searchHistory.map (inferred from SearchResult[])
- `components/extraction/job-creator.tsx` - Added SearchResult import, type predicate filter, dateRange Date-to-string conversion

## Decisions Made
- Used `Infer<typeof extractionSavedViewValidator>` for `onApplySavedView` callback instead of `ExtractionSavedView` because the Convex validator return type has `Id<>` branded types and `number[]` for confidenceRange vs the frontend interface's `string` and `[number, number]` tuple
- Cast `charRange` to `[number, number]` in review-queue citation mapping since Convex validators return `number[]` but `CitationLocation` requires a tuple
- Converted `DateRange` dates to ISO strings in job-creator `sourceHistoryEntries` since react-day-picker `DateRange` uses `Date` objects but the Convex mutation expects string dates

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cast charRange to [number, number] tuple in review-queue**
- **Found during:** Task 2 (review-queue.tsx)
- **Issue:** Removing `: any` from citation mapping revealed that Convex returns `number[]` for charRange, but `CitationLocation` type requires `[number, number]` tuple
- **Fix:** Added `as [number, number]` cast on charRange in the citations useMemo mapping
- **Files modified:** components/extraction/review-queue.tsx
- **Verification:** npx tsc --noEmit shows no errors for review-queue.tsx
- **Committed in:** f0630cf (Task 2 commit)

**2. [Rule 1 - Bug] Convert DateRange dates to ISO strings in job-creator**
- **Found during:** Task 2 (job-creator.tsx)
- **Issue:** Removing `as any[]` revealed that `SearchResult.dateRange` uses react-day-picker `DateRange` with `Date` objects, but the Convex `startExtraction` mutation expects `{ from?: string, to?: string }`
- **Fix:** Added inline conversion `{ from: entry.dateRange.from?.toISOString(), to: entry.dateRange.to?.toISOString() }` for the dateRange property
- **Files modified:** components/extraction/job-creator.tsx
- **Verification:** npx tsc --noEmit shows no errors for job-creator.tsx
- **Committed in:** f0630cf (Task 2 commit)

**3. [Rule 3 - Blocking] Used Convex Infer instead of ExtractionSavedView for callback type**
- **Found during:** Task 1 (report-builder.tsx)
- **Issue:** `ExtractionSavedView` interface has `confidenceRange: [number, number]` but Convex query returns `number[]`, causing TS2345 when passing view to typed callback
- **Fix:** Used `Infer<typeof extractionSavedViewValidator>` from convex/values to match the actual Convex return type
- **Files modified:** components/extraction/report-builder.tsx
- **Verification:** npx tsc --noEmit shows no errors for report-builder.tsx
- **Committed in:** 40d8c86 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs revealed by type safety, 1 blocking type mismatch)
**Impact on plan:** All auto-fixes necessary for type correctness. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All extraction component files are now any-free
- Ready for remaining component type safety work in subsequent plans

## Self-Check: PASSED

- All 7 modified files exist
- Both task commits verified (40d8c86, f0630cf)
- Zero any instances across all extraction component files

---
*Phase: 64-components*
*Completed: 2026-03-04*
