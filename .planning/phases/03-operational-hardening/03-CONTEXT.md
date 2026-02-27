# Phase 3: Operational Hardening - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the billing system observable, self-correcting for stale state, globally idempotent, and document the TOCTOU credit deduction race with clear trigger criteria. This phase does NOT add new billing features — it hardens what Phases 1 and 2 built.

</domain>

<decisions>
## Implementation Decisions

### Corrective Action Behavior
- Auto-correct divergences silently + log the correction (no human in the loop — Stripe is source of truth)
- Scheduled cron, runs every hour
- Fix subscription state only — do NOT cascade corrections to credits (the credit reconciliation cron from Phase 2 handles that independently)
- No notification channel needed — corrections are logged to Convex function logs

### Alert/Monitoring Strategy
- Failed event alerts via console log + Convex dashboard (no external integrations like Slack or email)
- 1-hour threshold: if a Stripe event in stripeEventLogs has `failed` status for >1 hour, flag it
- Flag only — do NOT auto-retry failed events (they may have failed for a reason; manual investigation is safer)
- Track failed status only — no latency monitoring (keep it focused)

### Idempotency Verification Scope
- Verify + document existing idempotency contracts (audit each handler, prove it's already idempotent, document the contract)
- Focus on financial events only: invoice.paid, charge.refunded, checkout.session.completed (subscription updates already hardened in Phase 1)
- Documentation as inline JSDoc on each handler (same pattern as the dedup contract from Phase 2)
- If a handler is found NOT to be idempotent, fix it (follow Phase 1/2 patterns) — don't just flag it

### TOCTOU Documentation
- Conceptual document + trigger criteria (not implementation-ready code)
- Trigger: observed incident (real double-deduction in production) — not a user count threshold
- Documentation lives inline in the credit deduction code as a JSDoc block (same pattern as Phase 2 dedup contract)
- Include the recommended mitigation approach (likely leveraging Convex OCC guarantees) so the path forward is clear when the trigger hits

### Claude's Discretion
- Exact cron implementation details (Convex cron syntax, scheduling)
- Which specific fields to compare when detecting subscription divergence
- Ordering and structure of the idempotency audit
- TOCTOU mitigation approach specifics (OCC vs optimistic locking vs other)

</decisions>

<specifics>
## Specific Ideas

- Follow the Phase 2 dedup contract pattern for inline JSDoc documentation — same style, same level of detail
- The subscription status check cron should query only active subscriptions (not all historical records)
- The failed event monitoring should use the existing stripeEventLogs table (no new tables needed for monitoring)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-operational-hardening*
*Context gathered: 2026-02-27*
