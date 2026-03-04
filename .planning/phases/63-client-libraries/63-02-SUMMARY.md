---
phase: 63-client-libraries
plan: 02
subsystem: ui
tags: [typescript, type-safety, extraction, search, pdf, openalex]

# Dependency graph
requires:
  - phase: 63-01
    provides: "Type-safe component library files"
provides:
  - "Type-safe extraction export/citations/reviews libraries"
  - "Type-safe search-actions with PaperResult types"
  - "Type-safe search initializer and provider without as any casts"
  - "Type-safe PDF download with ZoteroAttachment interface"
affects: [63-03-client-libraries, 64-hooks-context, type-safety-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ExtractionResultLike/ReviewResultLike minimal interfaces for typed function params"
    - "Record<string, unknown> cast pattern for unknown-to-object property access"
    - "Partial<SearchResult> explicit annotation to replace as any in converters"
    - "ZoteroAttachment interface for typed Zotero API responses"
    - "metadata as unknown as Parameters<typeof fn>[N] for cross-module type bridge"

key-files:
  created: []
  modified:
    - "lib/extraction/export.ts"
    - "lib/extraction/citations.ts"
    - "lib/extraction/reviews.ts"
    - "lib/search-actions.ts"
    - "lib/search/initializer.tsx"
    - "lib/search/provider.tsx"
    - "lib/pdf/download.ts"

key-decisions:
  - "Used ExtractionResultLike minimal interface instead of importing full ExtractionResultRow for citation helpers"
  - "Cast toCitationEvidence candidate as Record<string, unknown> after object guard for property access"
  - "Bridge metadata type through unknown for downloadWithMetadata cross-module compatibility"
  - "Used Partial<typeof urlParams> instead of as any for nuqs setUrlParams type mismatch"

patterns-established:
  - "Minimal interface pattern: define small typed shapes for function params instead of full model import"
  - "unknown + Record<string, unknown> for safe property access on validated runtime objects"

requirements-completed: [LIB-04]

# Metrics
duration: 15min
completed: 2026-03-04
---

# Phase 63 Plan 02: Client Libraries Type Safety Summary

**Eliminated 18 any annotations across 7 extraction/search/PDF library files using union types, minimal interfaces, and typed casts**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-04T12:56:16Z
- **Completed:** 2026-03-04T13:11:35Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Zero any annotations in lib/extraction/export.ts (4 instances replaced with union types)
- Zero any annotations in lib/extraction/citations.ts (5 instances replaced with ExtractionResultLike interface and unknown)
- Zero any annotations in lib/extraction/reviews.ts (2 instances replaced with ReviewResultLike interface)
- Zero any annotations in lib/search-actions.ts (4 instances replaced with PaperResult type)
- Zero any annotations in lib/search/initializer.tsx (1 as-any cast removed with Partial<SearchResult>)
- Zero any annotations in lib/search/provider.tsx (1 as-any cast replaced with Partial<typeof urlParams>)
- Zero any annotations in lib/pdf/download.ts (2 instances: ZoteroAttachment interface + catch unknown)

## Task Commits

Each task was committed atomically:

1. **Task 1: Type extraction libraries** - `d29737f` (feat)
2. **Task 2: Type search-actions, search, and PDF libraries** - `7f4300f` (feat)

**Plan metadata:** `pending` (docs: complete plan)

## Files Created/Modified
- `lib/extraction/export.ts` - Union types for formatAnswerForCSV/Excel, typed ExcelJS module import, typed row array
- `lib/extraction/citations.ts` - ExtractionResultLike interface, unknown candidate with Record cast, typed citation helpers
- `lib/extraction/reviews.ts` - ReviewResultLike interface, typed review state helpers
- `lib/search-actions.ts` - PaperResult type for all download/export functions, title fallback for undefined
- `lib/search/initializer.tsx` - Explicit Partial<SearchResult> annotation replacing as any cast
- `lib/search/provider.tsx` - Partial<typeof urlParams> replacing as any for nuqs setter
- `lib/pdf/download.ts` - ZoteroAttachment interface for typed attachment filtering, catch (e: unknown) with instanceof guard

## Decisions Made
- Used ExtractionResultLike minimal interface (citations + citationStatus fields only) instead of importing full ExtractionResultRow -- keeps citation helpers decoupled from full model
- Cast toCitationEvidence candidate as Record<string, unknown> after runtime object check -- TypeScript cannot narrow unknown to object-with-properties even after typeof check
- Used `metadata as unknown as Parameters<typeof downloadWithMetadata>[3]` bridge pattern for cross-module type compatibility where createSearchMetadata return type contains OpenAlexSearchParams (with Record<string, unknown>) that doesn't structurally match the local JsonValue type in utils.ts
- Used Partial<typeof urlParams> for nuqs setUrlParams -- more specific than any, matches the actual expected shape

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed item.title undefined for PaperResult type**
- **Found during:** Task 2 (search-actions.ts)
- **Issue:** PaperResult (Work from OpenAlex SDK) has title as string | undefined, but generateFilename expects string
- **Fix:** Added `item.title || ''` fallback in downloadItem and downloadEssentialItem
- **Files modified:** lib/search-actions.ts
- **Verification:** tsc --noEmit passes with zero errors
- **Committed in:** 7f4300f (Task 2 commit)

**2. [Rule 1 - Bug] Fixed metadata type mismatch for downloadWithMetadata**
- **Found during:** Task 2 (search-actions.ts)
- **Issue:** createSearchMetadata returns object containing OpenAlexSearchParams with Record<string, unknown>, which doesn't overlap with local JsonValue type used by downloadWithMetadata
- **Fix:** Used `as unknown as Parameters<typeof downloadWithMetadata>[3]` bridge cast at 3 call sites
- **Files modified:** lib/search-actions.ts
- **Verification:** tsc --noEmit passes with zero errors
- **Committed in:** 7f4300f (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs revealed by removing any)
**Impact on plan:** Both auto-fixes necessary for type correctness. Pre-existing type mismatches were hidden by any. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 7 target files have zero any annotations
- TypeScript compilation passes with no errors in modified files
- Ready for 63-03 (remaining client library typing)

---
*Phase: 63-client-libraries*
*Completed: 2026-03-04*
