---
phase: 06-ux-polish
verified: 2026-02-27T14:40:48Z
status: human_needed
score: 5/5 automated must-haves verified
human_verification:
  - test: "Payment method display visible in upgrade dialog"
    expected: "After clicking Upgrade to Pro (from a Go subscription with card on file), the confirmation dialog shows the card brand and last 4 digits (e.g., 'visa •••• 4242') near the top"
    why_human: "Requires a live Stripe test account with an active subscription and payment method; cannot verify visual rendering programmatically"
  - test: "Proration line item breakdown in upgrade dialog"
    expected: "The dialog shows individual Stripe line items (unused time credit shown in green, new plan charge shown normally) with a 'Total due now' row at the bottom"
    why_human: "Requires a live Stripe invoice preview call; line item content depends on Stripe's API response which cannot be verified statically"
  - test: "Dismiss guard blocks dialog close during processing"
    expected: "While the upgrade spinner is visible (isConfirming=true), pressing Escape does not close the dialog, clicking outside does not close it, and the X button is not visible; after completion the dialog closes normally"
    why_human: "Runtime interaction behavior dependent on React state transitions and Radix UI event handling; cannot be verified from static code inspection alone"
---

# Phase 06: UX Polish Verification Report

**Phase Goal:** UX polish — payment method display, proration line items, dismiss guard
**Verified:** 2026-02-27T14:40:48Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User sees their payment method (card brand + last 4 digits) in the upgrade confirmation dialog | ? NEEDS HUMAN | Code verified: `cardLast4 && <CreditCard ... {cardBrand} &bull;&bull;&bull;&bull; {cardLast4}>` at line 88-98 of dialog; `cardBrand={subscriptionDetails?.cardBrand}` and `cardLast4={subscriptionDetails?.cardLast4}` passed from Pricing.tsx lines 729-730; `cardBrand` and `cardLast4` sourced from `getSubscriptionDetails` Stripe expansion at lines 510-511 of actions.ts |
| 2 | User sees proration line item breakdown (credit for unused time + charge for new plan) in the confirmation dialog | ? NEEDS HUMAN | Code verified: `preview.lineItems.map(...)` at lines 117-130 of dialog renders each line item; negative amounts styled with `text-green-600`; total row with `t("totalCharge")` at line 132; `lineItems` extracted from `preview.lines?.data` at lines 924-928 of actions.ts |
| 3 | User cannot dismiss the confirmation dialog via Escape key or click-outside while an upgrade is processing | ? NEEDS HUMAN | Code verified: `onEscapeKeyDown={(e) => { if (isConfirming) e.preventDefault(); }}` at lines 66-68; `onPointerDownOutside={(e) => { if (isConfirming) e.preventDefault(); }}` at lines 69-71; `onInteractOutside={(e) => { if (isConfirming) e.preventDefault(); }}` at lines 72-74; `showCloseButton={!isConfirming}` at line 75 of dialog |
| 4 | All new UI text in the upgrade dialog has i18n translations in all 6 locale files | VERIFIED | `totalCharge` and `paymentMethod` present in all 6 locale files (en-US, en-GB, fr, hi, ja, zh); all JSON files parse without errors; `t("totalCharge")` consumed in dialog at line 132 |
| 5 | Payment method label and line item labels are properly localized | VERIFIED | `totalCharge` translations: en "Total due now", fr "Total a payer maintenant", hi "अभी देय कुल राशि", ja "現在の請求合計", zh "现在应付总额"; Stripe line item descriptions are intentionally not localized (per research decision — they come from Stripe's API as-is) |

**Score:** 5/5 truths have passing automated evidence; 3/5 require human confirmation of runtime behavior

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/subscriptions/actions.ts` | getUpgradePreview returns lineItems array extracted from Stripe preview.lines.data | VERIFIED | Lines 869-873: `lineItems: v.array(v.object({ description: v.string(), amountCents: v.number(), currency: v.string() }))` in returns validator; lines 924-928: extraction from `preview.lines?.data` with `.map()`; line 955: `lineItems` in return object |
| `components/billing/upgrade-confirmation-dialog.tsx` | Dialog renders payment method, line item breakdown, and blocks dismissal during confirming | VERIFIED | Lines 26-31: `lineItems` in UpgradePreview type; lines 39-41: `cardBrand?` and `cardLast4?` props; lines 65-76: all three dismiss guard handlers + showCloseButton; lines 88-98: payment method render; lines 117-134: line item breakdown with total |
| `components/Pricing.tsx` | Parent passes cardBrand and cardLast4 props from subscriptionDetails to dialog | VERIFIED | Lines 729-730: `cardBrand={subscriptionDetails?.cardBrand}` and `cardLast4={subscriptionDetails?.cardLast4}` passed to `<UpgradeConfirmationDialog>` |
| `messages/en-US.json` | English (US) translations for new upgradeDialog keys | VERIFIED | `totalCharge: "Total due now"`, `paymentMethod: "Payment method"` present |
| `messages/en-GB.json` | English (GB) translations | VERIFIED | `totalCharge: "Total due now"`, `paymentMethod: "Payment method"` present |
| `messages/fr.json` | French translations | VERIFIED | `totalCharge: "Total a payer maintenant"`, `paymentMethod: "Moyen de paiement"` present |
| `messages/hi.json` | Hindi translations | VERIFIED | `totalCharge: "अभी देय कुल राशि"`, `paymentMethod: "भुगतान का तरीका"` present |
| `messages/ja.json` | Japanese translations | VERIFIED | `totalCharge: "現在の請求合計"`, `paymentMethod: "お支払い方法"` present |
| `messages/zh.json` | Chinese translations | VERIFIED | `totalCharge: "现在应付总额"`, `paymentMethod: "支付方式"` present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `convex/subscriptions/actions.ts` | `components/billing/upgrade-confirmation-dialog.tsx` | `lineItems` field in getUpgradePreview response consumed as UpgradePreview type | WIRED | `lineItems` in Convex returns validator (line 869); `lineItems` in UpgradePreview type (line 26-31); `preview.lineItems.map(...)` in render (line 117) |
| `components/Pricing.tsx` | `components/billing/upgrade-confirmation-dialog.tsx` | cardBrand and cardLast4 props passed from subscriptionDetails state | WIRED | `subscriptionDetails?.cardBrand` at line 729, `subscriptionDetails?.cardLast4` at line 730; received as `cardBrand` / `cardLast4` props in dialog at lines 49-50 |
| `components/billing/upgrade-confirmation-dialog.tsx` | `components/ui/dialog.tsx` | onEscapeKeyDown, onPointerDownOutside, onInteractOutside, showCloseButton props on DialogContent | WIRED | All four props present at lines 66-75 of dialog; `showCloseButton` supported by dialog.tsx (confirmed at lines 53, 56, 70, 96, 100, 112) |
| `messages/en-US.json` | `components/billing/upgrade-confirmation-dialog.tsx` | useTranslations('upgradeDialog') consuming totalCharge | WIRED | `t("totalCharge")` at dialog line 132; `totalCharge` key present in all 6 locale files |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UXPL-01 | 06-01-PLAN, 06-02-PLAN | User sees payment method (card brand + last 4 digits) in upgrade confirmation dialog | SATISFIED (pending human confirmation) | `cardBrand`/`cardLast4` flow: `getSubscriptionDetails` (Stripe expand) -> `subscriptionDetails` state in Pricing.tsx -> props to dialog -> conditional render with CreditCard icon |
| UXPL-02 | 06-01-PLAN, 06-02-PLAN | User sees proration line item breakdown (credit for unused time + charge for new plan) in confirmation dialog | SATISFIED (pending human confirmation) | `lineItems` flow: `getUpgradePreview` extracts from `preview.lines.data` -> `UpgradePreview` type -> rendered per-item with green credit styling + total row using `t("totalCharge")` |
| UXPL-03 | 06-01-PLAN | User cannot dismiss confirmation dialog via Escape key or click-outside while upgrade is processing | SATISFIED (pending human confirmation) | Dismiss guard: `onEscapeKeyDown` + `onPointerDownOutside` + `onInteractOutside` all call `e.preventDefault()` when `isConfirming`; `showCloseButton={!isConfirming}` hides X button |

All 3 UXPL requirements are covered by plans. No orphaned requirements found in REQUIREMENTS.md — UXPL-01, UXPL-02, UXPL-03 are the only Phase 6 requirements and all three are claimed by plans.

### Anti-Patterns Found

No anti-patterns found. Scan of `convex/subscriptions/actions.ts`, `components/billing/upgrade-confirmation-dialog.tsx`, and `components/Pricing.tsx` found zero TODO, FIXME, placeholder, stub, or `return null` / empty implementation patterns in the new code.

**Note on paymentMethod i18n key:** The `paymentMethod` key was added to all 6 locale files but is not currently consumed by `t("paymentMethod")` in the dialog component. The dialog renders the payment method section with an inline comment `{/* Payment method */}` and no translated label — the card display uses icon + brand + last4 directly. The plan stated this key was added "if needed as accessible text." This is a minor unused-key observation, not a gap — the payment method section does render correctly, and the key is available for future use (e.g., `aria-label`).

### Human Verification Required

### 1. Payment Method Display (UXPL-01)

**Test:** Sign in with a test account that has an active Go subscription with a payment method on file. Navigate to the pricing page and click "Upgrade to Pro."
**Expected:** The confirmation dialog shows a credit card icon, the card brand (e.g., "visa"), and the masked card number (e.g., "•••• 4242") near the top of the dialog, above the plan change section.
**Why human:** Requires a live Stripe test account with a payment method attached. Cannot verify visual rendering or Stripe API responses programmatically.

### 2. Proration Line Item Breakdown (UXPL-02)

**Test:** Same upgrade flow as above. Observe the confirmation dialog's charge breakdown section.
**Expected:** The dialog shows individual Stripe line items — a credit for unused time on the current plan (displayed in green, e.g., "Unused time on Go plan...") and a charge for the new plan period. A "Total due now" row appears at the bottom with the final amount.
**Why human:** Line item content comes from Stripe's invoice preview API (`preview.lines.data`). The quality and accuracy of line item descriptions depend on Stripe's response and cannot be verified statically.

### 3. Dismiss Guard During Processing (UXPL-03)

**Test:** In the upgrade dialog, click "Confirm upgrade." While the "Upgrading..." spinner is visible:
1. Press Escape — dialog must NOT close.
2. Click outside the dialog — dialog must NOT close.
3. Verify no X button is visible in the dialog header.
After the upgrade completes (or after canceling on a fresh attempt), verify the dialog closes normally via Cancel or Escape.
**Expected:** All three dismiss vectors are blocked during processing; dialog is dismissible when not processing.
**Why human:** Runtime state behavior (isConfirming state transitions, Radix UI event interception) cannot be verified from static code inspection alone.

### Gaps Summary

No gaps. All automated checks pass:
- `getUpgradePreview` returns `lineItems` extracted from `preview.lines.data` (Convex validator + handler + return object all consistent)
- `UpgradeConfirmationDialog` has all required props, dismiss guard handlers, payment method render, and line item breakdown with total
- `Pricing.tsx` passes `cardBrand` and `cardLast4` from `subscriptionDetails` to the dialog
- All 6 locale files contain `totalCharge` and `paymentMethod` keys with correct translations; all files parse as valid JSON
- Three commits (18e2846, 133d06d, 085b1e9) verified in git history

Awaiting human confirmation of runtime UX behavior for UXPL-01, UXPL-02, and UXPL-03.

---

_Verified: 2026-02-27T14:40:48Z_
_Verifier: Claude (gsd-verifier)_
