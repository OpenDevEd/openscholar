# Phase 4: Upgrade Correctness - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix three correctness bugs in the upgrade flow: proration date drift between preview and execution, credit grant failure messaging, and success toast accuracy. Users must get correct charges and accurate feedback every time they upgrade.

</domain>

<decisions>
## Implementation Decisions

### Success & failure toasts
- **Credits granted (happy path):** Toast shows actual credits from server response — e.g. "Upgraded to Pro — 1,234 credits added". Never use the preview estimate.
- **Credits processing (grant failed but plan changed):** Toast shows "Upgraded to Pro — credits are being processed" with an info-level tone (not error). No fake credit count.
- **Complete failure (Stripe charge failed):** Error toast with actionable message — e.g. "Upgrade failed — your card was declined. Update your payment method and try again."
- Toast duration: success/processing = 5s auto-dismiss, error = persistent until dismissed

### Credit balance during processing
- Show the real current balance (not an estimate) — the credit display should never show a number that hasn't been confirmed by the server
- No special "processing" indicator in the credit balance itself; the toast is sufficient to communicate the state
- Credits will arrive via the webhook backup path (Phase 5) or manual reconciliation — no need for a persistent banner in Phase 4

### Proration preview confidence
- Pin the proration_date at preview time and pass it through to the changePlan execution so Stripe uses the same timestamp for both
- Store the pinned timestamp alongside the preview data in the dialog state
- No user-facing disclaimer needed — the pinning eliminates the drift problem entirely
- No preview expiration timeout — the pinned date ensures correctness regardless of how long the user takes

### Error recovery UX
- Card declined: error toast with "Update your payment method" guidance, dialog closes, user can retry
- Generic Stripe error: error toast with "Please try again" message, dialog closes
- No automatic retry — user manually retries by clicking upgrade again
- Dialog returns to non-confirming state on error so the user can dismiss or retry

### Claude's Discretion
- Exact toast copy and i18n key naming
- Whether to log credit processing events to console for debugging
- Internal error boundary patterns for the changePlan response handling

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User deferred all decisions to Claude's recommended approach.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-upgrade-flow-fix*
*Context gathered: 2026-02-27*
