---
phase: 02-credit-system-correctness
plan: 02
subsystem: ui
tags: [react, next-intl, convex, stripe-checkout, sonner-toast, credits]

# Dependency graph
requires:
  - phase: 01-subscription-lifecycle-correctness
    provides: "Payment failure banner pattern, billing page structure, toast infrastructure"
provides:
  - "Credit cap banner on billing page (non-dismissable, amber, resolves automatically)"
  - "Checkout return processing state with Convex-subscription-driven toast notification"
  - "30-second timeout fallback for stuck processing states"
  - "Abandoned checkout URL cleanup (no stale state)"
  - "Buy Credits link on billing page (scrolls to topup section)"
  - "Buy Credits link in auth button dropdown (navigates to billing#topup-section)"
affects: [credit-system-correctness, billing-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Convex reactive subscription for post-checkout credit arrival detection"
    - "useRef-based balance snapshot + comparison for change detection"
    - "30-second timeout fallback for processing states"
    - "sonner toast.success for positive feedback (bypassing AppToastApi which only has error)"

key-files:
  created: []
  modified:
    - "app/settings/billing/page.tsx"
    - "components/auth-button.tsx"
    - "messages/en-US.json"
    - "messages/en-GB.json"
    - "messages/fr.json"
    - "messages/zh.json"
    - "messages/ja.json"
    - "messages/hi.json"

key-decisions:
  - "Used sonner toast.success directly instead of AppToastApi (which only exposes error methods) for credit-added positive feedback"
  - "Placed credit cap banner above CreditBalanceCard for visibility, processing indicator between banner and card"
  - "Buy Credits link uses smooth scroll to #topup-section on billing page, direct navigation from auth dropdown"

patterns-established:
  - "Reactive checkout return: capture balance on return, watch Convex subscription for change, fire toast on delta"
  - "Timeout fallback pattern: 30s timeout clears processing state without showing error (payment may still process)"

requirements-completed: [CRED-03, CRED-04, CRED-05]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 02 Plan 02: Credit UX Improvements Summary

**Credit cap banner with amber non-dismissable warning, Stripe checkout return processing state with Convex-driven toast, and Buy Credits links in billing page and auth dropdown**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T10:46:46Z
- **Completed:** 2026-02-27T10:51:08Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Non-dismissable amber credit cap banner shows when free credits reach the cap, auto-resolves when balance drops
- Checkout return from Stripe triggers "Processing your purchase..." state that resolves to "X credits added" toast when Convex subscription delivers new balance
- 30-second timeout prevents stuck processing state; abandoned checkouts return cleanly with URL cleanup
- Buy Credits link in two locations: below CreditBalanceCard on billing page, and below credit balance in auth button dropdown

## Task Commits

Each task was committed atomically:

1. **Task 1: Add credit cap banner and processing return state with toast** - `81a3d6f` (feat)
2. **Task 2: Add Buy Credits link near credit balance in auth button dropdown** - `135b098` (feat)

## Files Created/Modified
- `app/settings/billing/page.tsx` - Credit cap banner, processing return state with toast, Buy Credits link, topup section wrapper
- `components/auth-button.tsx` - Buy Credits link below credit balance in dropdown
- `messages/en-US.json` - billingPage + common namespace i18n keys
- `messages/en-GB.json` - billingPage + common namespace i18n keys
- `messages/fr.json` - billingPage + common namespace i18n keys (French translations)
- `messages/zh.json` - billingPage + common namespace i18n keys (English defaults)
- `messages/ja.json` - billingPage + common namespace i18n keys (English defaults)
- `messages/hi.json` - billingPage + common namespace i18n keys (English defaults)

## Decisions Made
- Used `sonnerToast.success()` directly from the sonner library instead of `AppToastApi` because `AppToastApi` only exposes error-type toast methods. The success toast for "credits added" is a positive feedback pattern not covered by the existing error-focused toast API.
- Buy Credits link on billing page uses `document.getElementById("topup-section").scrollIntoView()` for smooth scroll, while auth dropdown link uses `router.push("/settings/billing#topup-section")` for cross-page navigation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed toast.success API mismatch**
- **Found during:** Task 1 (Processing return state with toast)
- **Issue:** Plan specified `toast.success(title, description)` but `AppToastApi` has no `success` method -- only `error`. TypeScript compilation failed with "Property 'success' does not exist on type 'AppToastApi'".
- **Fix:** Imported `toast as sonnerToast` from "sonner" directly and used `sonnerToast.success(title, { description })` which is the native sonner API for success toasts.
- **Files modified:** `app/settings/billing/page.tsx`
- **Verification:** TypeScript compilation passes (no errors in modified files)
- **Committed in:** `81a3d6f` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for API compatibility. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors exist in 3 test files (tests/credit_grant_missing_credits_row.test.ts, tests/live-billing/extended.test.ts, tests/live-billing/required.test.ts). These are unrelated to this plan's changes and were not addressed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Credit system UX improvements complete. All CRED-03, CRED-04, CRED-05 requirements addressed.
- Phase 02 plans complete (02-01 and 02-02 both done).
- Ready for Phase 03 if applicable.

## Self-Check: PASSED

All files and commits verified:
- app/settings/billing/page.tsx: FOUND
- components/auth-button.tsx: FOUND
- 02-02-SUMMARY.md: FOUND
- Commit 81a3d6f: FOUND
- Commit 135b098: FOUND

---
*Phase: 02-credit-system-correctness*
*Completed: 2026-02-27*
