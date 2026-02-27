# Phase 1: Subscription Lifecycle Correctness - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix three critical billing bugs (upgrade proration not charged immediately, out-of-order webhook state corruption, cancellation orphan records) and harden subscription state transitions against edge cases (downgrade schedule survival, schedule leak on re-upgrade, payment failure handling). Requirements: SUB-01 through SUB-06.

</domain>

<decisions>
## Implementation Decisions

### Webhook conflict resolution
- Always re-fetch current subscription state from Stripe API on every `customer.subscription.*` event — Stripe is the source of truth, not the event payload
- Apply re-fetch to ALL subscription events, not just a subset — consistent behavior, no allowlist maintenance
- On Stripe API failure (network error, rate limit): return HTTP 500 so Stripe retries the webhook (up to ~16 times over 72 hours)
- Log divergences when event payload disagrees with the re-fetched state — useful for monitoring and validates the fix is working; Phase 3 can build on this

### Payment failure experience
- Grace period matches Stripe's retry window (~7 days) — let Stripe's retry logic resolve it naturally before taking action
- During `past_due`: show a persistent banner ("Payment failed — update payment method") but keep ALL features fully accessible
- Banner includes an "Update payment" button linking to Stripe's customer portal — no custom payment form UI
- After grace period expires (all retries exhausted): automatically downgrade to free plan — user keeps account and data, loses paid features, can re-subscribe anytime

### Charge failure on upgrade
- If the immediate proration charge fails (card declined): block the upgrade, user stays on current plan — no ambiguous state where user has paid features without paying
- Show actionable error: "Upgrade failed — your card was declined. Update payment method." with link to Stripe portal
- Manual retry only — user must click "Upgrade" again after fixing payment. No automatic retries for user-initiated actions
- Show proration amount preview before user confirms the upgrade — "You'll be charged $X today for the remainder of this billing cycle." Use Stripe's proration preview API

### Schedule cleanup on re-upgrade
- On re-upgrade after scheduled downgrade: release the schedule via Stripe API, then verify `subscription.schedule === null`. If verification fails, log warning for investigation
- If schedule release fails (API error): block the upgrade entirely — prevents conflicting state where user is on Pro but a downgrade schedule fires at period end
- Check for orphaned schedules only during the upgrade flow — no background scanning. Phase 3 reconciliation cron is the appropriate place for broader checks
- Show pending downgrade indicator on billing page: "Your plan will change to Starter on [date]" — prevents surprise plan changes and lets user cancel the downgrade if they changed their mind

### Claude's Discretion
- Exact banner component design and styling
- Stripe proration preview API integration details
- Error retry/backoff logic for Stripe API calls within the re-fetch flow
- Log format and storage mechanism for divergence tracking

</decisions>

<specifics>
## Specific Ideas

- Stripe customer portal for all payment-related user actions (no custom payment forms)
- Proration preview before upgrade confirmation (similar to how Stripe checkout shows amounts)
- Divergence logging as groundwork for Phase 3 monitoring

</specifics>

<deferred>
## Deferred Ideas

- Background scanning for orphaned schedules via reconciliation cron — Phase 3 (Operational Hardening)
- Failed event alerting/monitoring — Phase 3 (INFRA-02)
- Degraded access mode during past_due — not needed now, could revisit if free-rider abuse is observed

</deferred>

---

*Phase: 01-subscription-lifecycle-correctness*
*Context gathered: 2026-02-27*
