---
phase: quick-1
plan: 01
subsystem: payments
tags: [credits, billing, batch-translation, ledger]

# Dependency graph
requires:
  - phase: v1.0
    provides: "withAuthAndCreditsBatch and usageBreakdown pattern"
provides:
  - "Per-paper credit deduction for batch translations"
affects: [billing, credits, translations]

# Tech tracking
tech-stack:
  added: []
  patterns: ["usageBreakdown pattern applied consistently to all batch actions"]

key-files:
  created: []
  modified:
    - convex/ai/actions.ts

key-decisions:
  - "Followed exact same usageBreakdown pattern from generateBatchScreeningResponses"

patterns-established:
  - "All batch AI actions must return usageBreakdown for per-item credit deduction"

requirements-completed: [QUICK-1]

# Metrics
duration: 46s
completed: 2026-02-28
---

# Quick Task 1: Per-Paper Credit Deduction for Batch Translations Summary

**Batch translations now deduct credits per paper with itemized ledger entries matching the screening pattern**

## Performance

- **Duration:** 46s
- **Started:** 2026-02-28T10:17:27Z
- **Completed:** 2026-02-28T10:18:13Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- `generateBatchTranslations` now destructures `usageByItemId` from `processTranslationBatch`
- Builds `usageBreakdown` array with per-paper entries, each containing paper ID and billing type metadata
- `withAuthAndCreditsBatch` receives the breakdown and deducts credits individually per paper instead of as a single lump sum
- Each ledger entry shows `AI: Batch translation ({paperId})` with `billingType: "batch_translation"` metadata

## Task Commits

Each task was committed atomically:

1. **Task 1: Add per-paper usageBreakdown to generateBatchTranslations** - `6f370cf` (fix)

## Files Created/Modified
- `convex/ai/actions.ts` - Added `usageByItemId` destructuring and `usageBreakdown` construction to `generateBatchTranslations`

## Decisions Made
- Followed exact same usageBreakdown pattern from `generateBatchScreeningResponses` for consistency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Self-Check: PASSED

- FOUND: convex/ai/actions.ts
- FOUND: 1-SUMMARY.md
- FOUND: commit 6f370cf

---
*Quick Task: 1-currently-screening-deducts-points-for-e*
*Completed: 2026-02-28*
