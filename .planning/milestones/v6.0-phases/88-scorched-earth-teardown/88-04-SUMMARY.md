---
phase: 88-scorched-earth-teardown
plan: 04
subsystem: teardown
tags: [deletion, extraction, cleanup, config, i18n, dependencies, verification]

# Dependency graph
requires: [88-03]
provides:
  - "@convex-dev/rag removed from convex.config.ts and package.json"
  - "pdfProcessingPool removed from convex/workpool.ts, screeningPool preserved"
  - "Zero extraction i18n keys or string values in any locale file"
  - "tsc --noEmit passes with zero errors"
  - "All 5 ROADMAP Phase 88 success criteria verified"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - convex/convex.config.ts
    - convex/workpool.ts
    - convex/_generated/api.d.ts
    - lib/toast/error-resolver.ts
    - components/Pricing.tsx
    - convex/credits/actions.ts
    - convex/lib/stripeCustomer.ts
    - convex/maintenance/internal.ts
    - convex/subscriptions/actions.ts
    - tests/live-billing/support.ts
    - tests/toast-error-resolver.test.ts
    - tests/toast-action-routing.test.ts
    - messages/en-US.json
    - messages/en-GB.json
    - messages/zh.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json

key-decisions:
  - "Removed rag and default workpool component blocks from convex/_generated/api.d.ts manually since convex codegen requires deployment unavailable in worktree"
  - "Updated Stripe apiVersion from 2026-01-28.clover to 2026-02-25.clover after pnpm lockfile regeneration pulled updated Stripe types"
  - "Removed extractionPlanRequired from ToastErrorMessageKey type, PLAN_UPGRADE_CODES set, and MESSAGE_KEY_BY_CODE map"
  - "Updated extraction string VALUES in locale files (pricing.proDescription, errorPages.signInToView, errorPages.noAccess, pdfViewer.noResultsDescription, confirmations.deleteJobDescription)"
  - "Deleted jobStatus.statusExtracting key from all 6 locale files"
  - "Removed t('proFeature2') from Pricing.tsx feature list after key deletion"

patterns-established: []

requirements-completed: [TEAR-04, TEAR-05, TEAR-08, TEAR-10]

# Metrics
duration: 13min
completed: 2026-04-15
---

# Phase 88 Plan 04: Config Cleanup, i18n Purge, and Phase Gate Verification Summary

**Removed RAG component and default workpool from Convex config, uninstalled 2 dead dependencies, purged all extraction i18n keys and string values from 6 locale files, fixed dangling code references, and verified tsc --noEmit passes with zero errors**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-14T23:31:02Z
- **Completed:** 2026-04-14T23:44:13Z
- **Tasks:** 3
- **Files modified:** 22 (4 config/deps + 6 locale files + 12 code/test fixes)

## Accomplishments
- Removed `@convex-dev/rag` import and `app.use(rag)` from `convex/convex.config.ts`
- Removed default `workpool` import and `app.use(workpool)` from `convex/convex.config.ts` (backed deleted `pdfProcessingPool`)
- Preserved `screeningWorkpool` component registration per D-03/D-04
- Removed `pdfProcessingPool` constant from `convex/workpool.ts`, preserved `screeningPool`
- Uninstalled `@convex-dev/rag` and `pdfjs-dist` from `package.json`
- Removed entire top-level `extraction` object (~183 keys) from all 6 locale files
- Removed entire top-level `extractionView` object (14 keys) from all 6 locale files
- Removed 8 scattered extraction keys from all 6 locale files (common.extraction, common.extractionError, toast.extractionPlanRequired, errorPages.extractionUnavailable, errorPages.extractionErrorDescription, jobStatus.extractionProgress, jobStatus.loadingExtractionResults, pricing.proFeature2)
- Deleted `jobStatus.statusExtracting` key from all 6 locale files
- Updated 5 extraction string VALUES to remove extraction mentions (pricing, errorPages, pdfViewer, confirmations)
- `tsc --noEmit` passes with zero errors
- All 5 ROADMAP Phase 88 success criteria verified

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove RAG and workpool from config, uninstall dead dependencies** - `3949099` (chore) -- convex.config.ts, workpool.ts, package.json, pnpm-lock.yaml
2. **Task 2: Clean extraction i18n keys from all 6 locale files** - `737da2d` (chore) -- 6 locale files, 1,254 lines removed
3. **Task 3: Final compilation and test verification** - `668d99d` (fix) -- 16 files (generated types, toast resolver, pricing component, Stripe API version, locale value updates, test fixes)

## Files Created/Modified
- `convex/convex.config.ts` -- Removed rag import/use and default workpool import/use; kept stripe, workflow, screeningWorkpool
- `convex/workpool.ts` -- Removed pdfProcessingPool; kept screeningPool with updated comment
- `package.json` -- Uninstalled @convex-dev/rag and pdfjs-dist
- `pnpm-lock.yaml` -- Regenerated after dependency removal
- `convex/_generated/api.d.ts` -- Removed rag component block (lines 654-1054) and default workpool component block (lines 1571-1668)
- `lib/toast/error-resolver.ts` -- Removed extractionPlanRequired from type, code map, and plan upgrade codes set
- `components/Pricing.tsx` -- Removed t("proFeature2") from pro features array
- `convex/credits/actions.ts` -- Updated Stripe apiVersion to 2026-02-25.clover
- `convex/lib/stripeCustomer.ts` -- Updated Stripe apiVersion to 2026-02-25.clover
- `convex/maintenance/internal.ts` -- Updated Stripe apiVersion to 2026-02-25.clover
- `convex/subscriptions/actions.ts` -- Updated Stripe apiVersion to 2026-02-25.clover
- `tests/live-billing/support.ts` -- Updated Stripe apiVersion to 2026-02-25.clover
- `tests/toast-error-resolver.test.ts` -- Removed extraction plan required test block
- `tests/toast-action-routing.test.ts` -- Removed EXTRACTION_PLAN_REQUIRED assertion
- `messages/{en-US,en-GB,zh,fr,hi,ja}.json` -- All extraction keys/sections removed, extraction string values updated, JSON validated

## Decisions Made
- Updated Stripe apiVersion from 2026-01-28.clover to 2026-02-25.clover across 5 files: the pnpm lockfile regeneration (from `pnpm remove`) pulled updated Stripe SDK types that expect the newer API version. This is a blocking fix required for tsc --noEmit to pass.
- Manually removed rag and default workpool component blocks from convex/_generated/api.d.ts since `npx convex codegen` requires a Convex deployment not available in the worktree context.
- Updated extraction string VALUES (not just keys) in locale files to ensure `grep -rl "extraction" messages/` returns zero files per acceptance criteria.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed dangling extractionPlanRequired references**
- **Found during:** Task 3
- **Issue:** Removing `toast.extractionPlanRequired` from locale files caused tsc errors in `lib/toast/error-resolver.ts`, `app/settings/billing/page.tsx`, `lib/toast/use-app-toast.ts`
- **Fix:** Removed `extractionPlanRequired` from ToastErrorMessageKey type union, MESSAGE_KEY_BY_CODE map, and PLAN_UPGRADE_CODES set. Removed extraction test assertions.
- **Files modified:** lib/toast/error-resolver.ts, tests/toast-error-resolver.test.ts, tests/toast-action-routing.test.ts
- **Commit:** 668d99d

**2. [Rule 3 - Blocking] Updated Stripe apiVersion after lockfile regeneration**
- **Found during:** Task 3
- **Issue:** `pnpm remove` regenerated lockfile pulling Stripe SDK types expecting apiVersion "2026-02-25.clover", but code had "2026-01-28.clover"
- **Fix:** Updated apiVersion string in all 5 Stripe initialization sites
- **Files modified:** convex/credits/actions.ts, convex/lib/stripeCustomer.ts, convex/maintenance/internal.ts, convex/subscriptions/actions.ts, tests/live-billing/support.ts
- **Commit:** 668d99d

**3. [Rule 1 - Bug] Removed t("proFeature2") from Pricing.tsx**
- **Found during:** Task 3
- **Issue:** pricing.proFeature2 key deleted from locale files but still referenced in component
- **Fix:** Removed t("proFeature2") from pro features array
- **Files modified:** components/Pricing.tsx
- **Commit:** 668d99d

**4. [Rule 2 - Missing] Cleaned extraction string VALUES from locale files**
- **Found during:** Task 3
- **Issue:** Locale files had extraction references in string values (not keys), causing `grep -rl "extraction" messages/` to still match files
- **Fix:** Updated 5 string values and deleted jobStatus.statusExtracting key across all 6 locale files
- **Files modified:** messages/{en-US,en-GB,zh,fr,hi,ja}.json
- **Commit:** 668d99d

## Phase 88 Success Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| convex/extraction/ and lib/extraction/ directories deleted | PASS | `test ! -d` passes |
| Zero extraction tables in convex/schema.ts | PASS | `grep -c` returns 0 |
| @convex-dev/rag absent from config and package | PASS | `grep -c` returns 0 for both files |
| tsc --noEmit zero errors | PASS | Exit code 0 |
| Zero extraction i18n keys in locale files | PASS | `grep -rl "extraction" messages/` returns no files |

## Test Suite Status

- **932 tests passing** (70 test files)
- **169 tests failing** -- ALL from single root cause: `convex-test` cannot find `_generated` directory in git worktree (requires `npx convex codegen` with Convex deployment)
- **Zero extraction-related test failures** -- all extraction tests were deleted in Plan 01
- **Zero failures caused by teardown changes** -- confirmed by checking unique failure reasons

## Self-Check: PASSED
