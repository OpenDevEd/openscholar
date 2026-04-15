---
phase: 94-crash-prevention-sweep
plan: 01
subsystem: ui
tags: [error-boundary, nextjs, clerk, sonner, toast, visibilitychange, vitest, i18n]

# Dependency graph
requires:
  - phase: none
    provides: existing app/error.tsx template, existing retryUserSync in convex-provider, existing sonner toast system
provides:
  - Route-segment error boundaries for results and settings routes
  - Clerk auth visibility-change retry with 5s cooldown
  - Mutation rejection toast routing for 3 call sites
  - Grep-backed useQuery destructuring lint test
affects: [97-extraction-ui-polish, future error boundary work]

# Tech tracking
tech-stack:
  added: []
  patterns: [unstable_retry error boundary prop, visibilitychange auth retry, mutation-to-toast routing]

key-files:
  created:
    - app/results/error.tsx
    - app/settings/error.tsx
    - tests/crash-prevention/usequery-guard.test.ts
  modified:
    - app/error.tsx
    - components/providers/convex-provider.tsx
    - components/rating-selector.tsx
    - components/ui/focus-mode.tsx
    - app/settings/connections/page.tsx
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json

key-decisions:
  - "Used unstable_retry instead of reset for all error boundaries (Next.js 16.2+ preferred prop)"
  - "Used toast.error with i18n keys instead of resolveToastError for mutation failures (simpler, consistent with plan direction)"
  - "Visibility change lastRetryTimestamp initialized to Date.now() to skip initial page-load fire"

patterns-established:
  - "Error boundary pattern: use client, unstable_retry prop, role=alert, auto-focus heading, i18n via useTranslations"
  - "Mutation toast pattern: .catch with console.error + toast.error(t(key))"
  - "Grep-backed lint test pattern: execSync + grep in vitest for codebase-wide invariants"

requirements-completed: [CRASH-01, CRASH-02, CRASH-03, CRASH-04]

# Metrics
duration: 3min
completed: 2026-04-15
---

# Phase 94 Plan 01: Crash Prevention - Error Boundaries, Auth Retry, and Mutation Toasts Summary

**Route-segment error boundaries for results/settings, Clerk visibility-change auth retry with 5s cooldown, mutation-to-toast routing for 3 call sites, and grep-backed useQuery lint test**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-15T07:02:00Z
- **Completed:** 2026-04-15T07:05:35Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments
- Route-segment error boundaries at app/results/error.tsx and app/settings/error.tsx with recovery UI (retry + go-home), role="alert" accessibility, auto-focus heading, and i18n
- Root app/error.tsx updated from legacy reset prop to unstable_retry (Next.js 16.2+)
- Clerk auth visibility-change retry in convex-provider.tsx with 5-second cooldown prevents stale-tab auth breakage
- Mutation rejections in rating-selector, focus-mode, and connections page now surface toast notifications instead of silent console.error
- Grep-backed lint test prevents regression of bare useQuery destructuring (CRASH-02)
- i18n keys added to all 6 locale files for toast error messages

## Task Commits

Each task was committed atomically:

1. **Task 1: Route-segment error boundaries and root boundary update** - `11d5c36` (feat)
2. **Task 2: Clerk visibility retry and mutation toast routing** - `f8f798b` (feat)
3. **Task 3: Grep-backed useQuery destructuring lint test** - `7598dee` (test)

## Files Created/Modified
- `app/results/error.tsx` - Route-segment error boundary for results route with unstable_retry
- `app/settings/error.tsx` - Route-segment error boundary for settings route with unstable_retry
- `app/error.tsx` - Root error boundary updated to unstable_retry prop
- `components/providers/convex-provider.tsx` - Added visibilitychange listener with 5s cooldown calling retryUserSync
- `components/rating-selector.tsx` - Added toast.error for saveToLibrary and removeFromLibrary catch blocks
- `components/ui/focus-mode.tsx` - Added toast.error for saveToLibrary and removeFromLibrary catch blocks
- `app/settings/connections/page.tsx` - Added catch block with toast.error for revokeKey
- `tests/crash-prevention/usequery-guard.test.ts` - Grep-backed lint test asserting zero bare useQuery destructuring
- `messages/{en-US,en-GB,fr,hi,ja,zh}.json` - Added saveToLibraryError, removeFromLibraryError, revokeKeyError i18n keys

## Decisions Made
- Used `unstable_retry` instead of `reset` for all three error boundaries -- Next.js 16.2+ preferred prop, aligns with CLAUDE.md "no legacy" principle
- Used simple `toast.error(t(key))` pattern instead of the full `resolveToastError` pipeline -- the plan specified this simpler approach and these are fire-and-forget mutations where the raw Convex error message is not user-useful
- Initialized `lastRetryTimestamp` to `Date.now()` (not 0) per RESEARCH.md Pitfall 3 -- prevents spurious retry on initial page load
- Focus-mode uses `tFocus` (focusMode namespace) for toast keys since the component uses that namespace for all its translations
- Added `role="alert"` and auto-focus heading ref to all three error boundaries for accessibility per 94-UI-SPEC.md

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added role="alert" and auto-focus to root error boundary**
- **Found during:** Task 1
- **Issue:** Plan specified role="alert" and auto-focus for new error boundaries but the root app/error.tsx also lacked these accessibility features
- **Fix:** Added role="alert", headingRef with tabIndex={-1}, and auto-focus to root error boundary too
- **Files modified:** app/error.tsx
- **Committed in:** 11d5c36

**2. [Rule 3 - Blocking] Locale files differ from plan expectation**
- **Found during:** Task 2
- **Issue:** Plan expected en, fr, es, de, ar, zh locale files but actual locale files are en-US, en-GB, fr, hi, ja, zh
- **Fix:** Applied i18n keys to actual locale files (en-US.json, en-GB.json, fr.json, hi.json, ja.json, zh.json)
- **Files modified:** All 6 messages/*.json files
- **Committed in:** f8f798b

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Error boundary pattern established for future route segments (Phase 97 extraction UI can clone this pattern)
- Visibility-change retry is active -- stale tabs will auto-recover auth
- All mutation toast routing complete for known gaps
- useQuery lint test running in CI to prevent future regression

---
*Phase: 94-crash-prevention-sweep*
*Completed: 2026-04-15*
