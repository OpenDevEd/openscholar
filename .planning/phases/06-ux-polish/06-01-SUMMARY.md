---
phase: 06-ux-polish
plan: 01
subsystem: ui
tags: [stripe, react, radix-dialog, proration, i18n]

# Dependency graph
requires:
  - phase: 04-upgrade-flow-fix
    provides: "Upgrade confirmation dialog with proration preview"
provides:
  - "Payment method display (card brand + last 4) in upgrade dialog"
  - "Proration line item breakdown from Stripe preview.lines.data"
  - "Dismiss guard preventing dialog close during upgrade processing"
  - "lineItems field in getUpgradePreview action return type"
affects: [06-02-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Radix dialog dismiss prevention via onEscapeKeyDown/onPointerDownOutside/onInteractOutside"
    - "Stripe invoice preview line items extraction for UI display"

key-files:
  created: []
  modified:
    - convex/subscriptions/actions.ts
    - components/billing/upgrade-confirmation-dialog.tsx
    - components/Pricing.tsx
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json

key-decisions:
  - "Used HTML entities for card dots instead of Unicode bullet to avoid encoding issues"
  - "Added totalCharge i18n key in this plan rather than deferring to Plan 02 to prevent runtime error"

patterns-established:
  - "Dismiss guard pattern: onEscapeKeyDown + onPointerDownOutside + onInteractOutside + showCloseButton={false}"
  - "Line item display pattern: map Stripe preview.lines.data with green styling for negative (credit) amounts"

requirements-completed: [UXPL-01, UXPL-02, UXPL-03]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 06 Plan 01: Upgrade Dialog UX Polish Summary

**Payment method display, proration line-item breakdown, and dismiss guard for upgrade confirmation dialog**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T14:22:51Z
- **Completed:** 2026-02-27T14:26:40Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Extended getUpgradePreview action to return proration line items from Stripe preview
- Added payment method display (card brand + last 4 digits) to upgrade confirmation dialog
- Replaced single proration charge display with detailed line-item breakdown with credit amounts in green
- Implemented dismiss guard preventing dialog close during processing via Escape, click-outside, or X button

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend getUpgradePreview action to return proration line items** - `18e2846` (feat)
2. **Task 2: Update dialog with payment method, line items, and dismiss guard** - `133d06d` (feat)

## Files Created/Modified
- `convex/subscriptions/actions.ts` - Added lineItems to return validator and extracted from Stripe preview.lines.data
- `components/billing/upgrade-confirmation-dialog.tsx` - Added CreditCard import, lineItems to type, cardBrand/cardLast4 props, dismiss guard handlers, payment method display, line item breakdown
- `components/Pricing.tsx` - Passes cardBrand and cardLast4 from subscriptionDetails to dialog
- `messages/en-US.json` - Added totalCharge key
- `messages/en-GB.json` - Added totalCharge key
- `messages/fr.json` - Added totalCharge key (French)
- `messages/hi.json` - Added totalCharge key (Hindi)
- `messages/ja.json` - Added totalCharge key (Japanese)
- `messages/zh.json` - Added totalCharge key (Chinese)

## Decisions Made
- Used HTML entities (`&bull;`) for card number masking dots instead of Unicode bullet character to avoid encoding issues across different environments
- Added the `totalCharge` i18n key to all 6 locale files in this plan rather than waiting for Plan 02, since using `t("totalCharge")` without the key would cause a runtime error

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added totalCharge i18n key to all locale files**
- **Found during:** Task 2 (Dialog update)
- **Issue:** Plan specified using `t("totalCharge")` for the line items total row, but the i18n key was not yet defined in any locale file. Plan 02 was supposed to add i18n keys, but without the key present, the dialog would show a raw key string at runtime.
- **Fix:** Added `"totalCharge": "Total"` (and localized equivalents) to all 6 locale files (en-US, en-GB, fr, hi, ja, zh)
- **Files modified:** messages/en-US.json, messages/en-GB.json, messages/fr.json, messages/hi.json, messages/ja.json, messages/zh.json
- **Verification:** TypeScript compilation passes, Convex typecheck passes
- **Committed in:** 133d06d (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for correctness -- dialog would display raw i18n key without this fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dialog component fully updated with all three UX polish features (UXPL-01, UXPL-02, UXPL-03)
- Plan 02 can proceed with any remaining i18n keys or additional UX polish work
- Pre-existing TypeScript errors in test files (unrelated to this plan) remain

## Self-Check: PASSED

All files verified present. All commits (18e2846, 133d06d) verified in git log.

---
*Phase: 06-ux-polish*
*Completed: 2026-02-27*
