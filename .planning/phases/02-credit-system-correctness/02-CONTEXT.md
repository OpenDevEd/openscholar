# Phase 2: Credit System Correctness - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Credit grants, top-up purchases, and refund reversals produce correct credit balances under all event combinations. The free credit cap is communicated clearly to users. This phase fixes correctness bugs in the existing credit system — it does not add new credit features.

</domain>

<decisions>
## Implementation Decisions

### Credit Cap Messaging
- Banner on the billing page (similar pattern to Phase 1 payment failure banner)
- Informational tone — neutral, not pushy: "Your free credits are at the maximum. Use some credits to receive your full monthly grant."
- Simple explanation only — no detailed mechanic breakdown (no "grants are reduced proportionally" language)
- Banner persists as long as credits are at the cap — not dismissable, resolves automatically when balance drops below cap

### Top-Up Checkout Flow
- Stripe Checkout redirect (hosted page) — not embedded Stripe Elements
- After payment, wait for webhook confirmation before showing credits (no optimistic update)
- Show brief "Processing your purchase..." state on the return URL while waiting for webhook
- Toast notification when credits are granted: "X credits added to your balance"
- Buy Credits button in two locations: primary button on billing/credits page + subtle link near the credit balance display

### Credit Change Visibility
- Monthly free credit grants: silent balance update, no notification
- Refund credit deductions: silent balance decrease, no notification
- Credit balance updates reactively in real-time via Convex subscriptions
- No credit transaction history for now — just current balance (history is a separate feature)

### Error & Edge Case Handling
- Abandoned checkout: clean return to billing page, no stale state, user can immediately start a new purchase
- Payment failures during checkout: Stripe Checkout handles its own error/retry UI — no custom app-side error
- Refund below zero: allow negative credit balance — honest accounting, user sees debt until they purchase more

### Claude's Discretion
- Exact banner component styling and placement within billing page
- Processing state timeout duration and fallback behavior
- Toast notification library/component choice
- Deduplication implementation strategy (idempotency keys vs invoice ID tracking)
- Reconciliation cron pagination implementation details
- Refund proportional calculation approach

</decisions>

<specifics>
## Specific Ideas

- Credit cap banner should follow the same pattern as the Phase 1 payment failure banner (consistent billing page UX)
- The "processing" return state after Stripe Checkout should feel brief and transition naturally — not a full loading page

</specifics>

<deferred>
## Deferred Ideas

- Credit transaction history (grants, purchases, usage, refund deductions) — future feature
- Credit usage notifications — out of scope per requirements

</deferred>

---

*Phase: 02-credit-system-correctness*
*Context gathered: 2026-02-27*
