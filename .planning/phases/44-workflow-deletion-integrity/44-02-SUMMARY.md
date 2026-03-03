---
phase: 44-workflow-deletion-integrity
plan: 02
subsystem: extraction
tags: [convex, cascade-delete, gdpr, truncation, i18n]

# Dependency graph
requires:
  - phase: 44-01
    provides: "cancelExtraction mutation with workflow.cancel() and credit guards"
provides:
  - "Step 8b in deleteExtractionInternal for baseline diff cascade cleanup"
  - "Truncation metadata (isTruncated, totalChanges) on extractionRunDiffs"
  - "GDPR-compliant cleanupDeletedUsers with extraction job and Zotero connection deletion"
  - "Diff truncation UI banner in report-builder"
affects: [extraction, maintenance, gdpr]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Deferred user deletion: skip hard-delete when extraction jobs exceed batch size to ensure complete cascade"]

key-files:
  created: []
  modified:
    - convex/schema.ts
    - convex/extraction/mutations.ts
    - convex/extraction/cascade-delete.test.ts
    - convex/maintenance/mutations.ts
    - components/extraction/report-builder.tsx
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json

key-decisions:
  - "Truncation fields use v.optional() and conditional spread to only set when truncation actually occurs"
  - "cleanupDeletedUsers defers user hard-delete when extraction jobs hit batch limit, ensuring all jobs get scheduled for cascade delete"
  - "Deliberately preserving creditTransactions, credits, and subscriptions for financial audit trail"

patterns-established:
  - "Conditional schema field pattern: use v.optional() + spread for fields only relevant in specific cases"

requirements-completed: [BUG-03, BUG-04, SEC-03]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 44 Plan 02: Orphan Diff Cleanup, Truncation Metadata, and GDPR User Cascade Summary

**Step 8b cascade for baseline diffs, isTruncated/totalChanges metadata with UI banner, and extended GDPR cleanupDeletedUsers with extraction job and Zotero connection deletion**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T05:02:26Z
- **Completed:** 2026-03-03T05:05:34Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- deleteExtractionInternal Step 8b now cascade-deletes diffs where the deleted job is referenced as baselineJobId, preventing orphaned extractionRunDiffs
- createExtractionRunDiff records isTruncated and totalChanges when changes exceed 1000-entry cap
- cleanupDeletedUsers now schedules deleteExtractionInternal for each deleted user's extraction jobs and deletes Zotero connections
- Diff truncation banner shows "Showing X of Y changes" in the report-builder UI when a diff is truncated
- All 6 locale files (en-US, en-GB, fr, hi, ja, zh) have the diffTruncated i18n key

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix orphan diffs and add truncation metadata (schema + mutations + test)** - `5193a34` (feat)
2. **Task 2: Extend GDPR user cleanup and add UI truncation banner** - `5cf23c4` (feat)

## Files Created/Modified
- `convex/schema.ts` - Added isTruncated and totalChanges optional fields to extractionRunDiffs
- `convex/extraction/mutations.ts` - Added Step 8b for baseline diff deletion; added truncation metadata to createExtractionRunDiff
- `convex/extraction/cascade-delete.test.ts` - Added test verifying baseline diffs are cleaned up on job deletion
- `convex/maintenance/mutations.ts` - Extended cleanupDeletedUsers with extraction job cascade and Zotero connection cleanup
- `components/extraction/report-builder.tsx` - Added truncation banner when diff is truncated
- `messages/en-US.json` - Added diffTruncated i18n key
- `messages/en-GB.json` - Added diffTruncated i18n key
- `messages/fr.json` - Added diffTruncated i18n key
- `messages/hi.json` - Added diffTruncated i18n key
- `messages/ja.json` - Added diffTruncated i18n key
- `messages/zh.json` - Added diffTruncated i18n key

## Decisions Made
- Truncation fields use v.optional() and conditional spread to only set when truncation actually occurs, keeping existing documents consistent
- cleanupDeletedUsers defers user hard-delete when extraction jobs hit batch limit (BATCH_SIZE), continuing on next scheduled run to ensure all jobs are cascade-deleted
- Deliberately preserving creditTransactions, credits, and subscriptions for deleted users (financial audit trail requirement)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSX ternary needed fragment wrapper for multiple children**
- **Found during:** Task 2 (truncation banner in report-builder.tsx)
- **Issue:** Adding truncation banner as sibling of badges div inside ternary required a fragment wrapper
- **Fix:** Wrapped the truthy branch in `<>...</>` fragment to support multiple children
- **Files modified:** components/extraction/report-builder.tsx
- **Verification:** TypeScript compilation passes
- **Committed in:** 5cf23c4 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor JSX structural fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three data integrity issues from this plan are resolved
- Phase 44 is complete (both plans finished)
- Ready for Phase 45 (if applicable)

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 44-workflow-deletion-integrity*
*Completed: 2026-03-03*
