# Phase 3: Operational Hardening - Research

**Researched:** 2026-02-27
**Domain:** Convex cron scheduling, Stripe webhook idempotency, OCC-based race condition mitigation, observability patterns
**Confidence:** HIGH

## Summary

Phase 3 hardens the existing billing system built in Phases 1 and 2 without adding new billing features. The four requirements divide into two implementation tasks (corrective subscription sync cron, failed event monitoring cron), one audit-and-fix task (idempotency verification of financial webhook handlers), and one documentation task (TOCTOU credit deduction race mitigation strategy).

The codebase is well-positioned for this phase. The `checkSubscriptionStatus` cron already exists in `convex/maintenance/internal.ts` but only handles past-due grace period expiry and logs warnings for active subscriptions past their period end -- it does not re-fetch from Stripe or correct divergences. The `stripeEventLogs` table already tracks event status (`received`, `processed`, `retrying`, `failed`, `ignored`) with indexed fields suitable for monitoring queries. The financial webhook handlers (`invoice.paid`, `charge.refunded`, `checkout.session.completed`, `payment_intent.succeeded`) already have dedup mechanisms but need formal audit and JSDoc contracts. The `deductCredits` mutation in `convex/credits/internal.ts` is the TOCTOU candidate -- it reads the balance, checks sufficiency, then writes -- but Convex OCC serializable transactions inherently prevent the classic TOCTOU within a single mutation.

**Primary recommendation:** Extend `checkSubscriptionStatus` to re-fetch from Stripe API for active subscriptions with stale `currentPeriodEnd`, add a new `monitorFailedStripeEvents` cron for alerting, audit each financial handler's idempotency contract with inline JSDoc, and document the TOCTOU mitigation as a JSDoc block on `deductCredits`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Corrective Action Behavior**: Auto-correct divergences silently + log the correction (no human in the loop -- Stripe is source of truth). Scheduled cron, runs every hour. Fix subscription state only -- do NOT cascade corrections to credits (the credit reconciliation cron from Phase 2 handles that independently). No notification channel needed -- corrections are logged to Convex function logs.
- **Alert/Monitoring Strategy**: Failed event alerts via console log + Convex dashboard (no external integrations like Slack or email). 1-hour threshold: if a Stripe event in stripeEventLogs has `failed` status for >1 hour, flag it. Flag only -- do NOT auto-retry failed events (they may have failed for a reason; manual investigation is safer). Track failed status only -- no latency monitoring (keep it focused).
- **Idempotency Verification Scope**: Verify + document existing idempotency contracts (audit each handler, prove it's already idempotent, document the contract). Focus on financial events only: invoice.paid, charge.refunded, checkout.session.completed (subscription updates already hardened in Phase 1). Documentation as inline JSDoc on each handler (same pattern as the dedup contract from Phase 2). If a handler is found NOT to be idempotent, fix it (follow Phase 1/2 patterns) -- don't just flag it.
- **TOCTOU Documentation**: Conceptual document + trigger criteria (not implementation-ready code). Trigger: observed incident (real double-deduction in production) -- not a user count threshold. Documentation lives inline in the credit deduction code as a JSDoc block (same pattern as Phase 2 dedup contract). Include the recommended mitigation approach (likely leveraging Convex OCC guarantees) so the path forward is clear when the trigger hits.

### Claude's Discretion
- Exact cron implementation details (Convex cron syntax, scheduling)
- Which specific fields to compare when detecting subscription divergence
- Ordering and structure of the idempotency audit
- TOCTOU mitigation approach specifics (OCC vs optimistic locking vs other)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | `checkSubscriptionStatus` cron takes corrective action on stale/expired subscriptions (not just log warnings) | Extend the existing `checkSubscriptionStatus` in `convex/maintenance/internal.ts`. Convert it from `internalMutation` to `internalAction` (needs Stripe API access). Re-fetch active subscriptions from Stripe, compare `status` and `currentPeriodEnd`, patch local record on divergence. Change cron interval from 24h to 1h per locked decision. |
| INFRA-02 | Failed Stripe events (`stripeEventLogs` with `failed` status) trigger monitoring/alerting if unresolved within N hours | New `monitorFailedStripeEvents` internalMutation in `convex/maintenance/internal.ts`. Query `stripeEventLogs` using `by_status_next_retry` index with `status === "failed"`. Filter where `updatedAt < Date.now() - 1 hour`. Log flagged events with `console.error` for Convex dashboard visibility. Add to `crons.ts` on 1-hour interval. |
| INFRA-03 | All webhook handlers are idempotent -- reprocessing the same event produces identical outcomes | Audit `invoice.paid` (dedup via `stripeInvoiceId` on `creditTransactions` -- already idempotent), `charge.refunded` (dedup via cumulative reversal delta calculation -- already idempotent), `checkout.session.completed` (triggers reconciliation which is idempotent), `payment_intent.succeeded` (dedup via `stripePaymentIntentId` on `creditTransactions` -- already idempotent). Document each with inline JSDoc. Fix any gaps found. |
| INFRA-04 | TOCTOU credit deduction race condition is documented with mitigation strategy for scale | Document on `deductCredits` in `convex/credits/internal.ts`. Convex OCC provides serializable transactions within a single mutation, which already prevents the classic TOCTOU. The real risk is at the action level: check balance (query) then deduct (mutation) with a gap between. Document the current protection (OCC retries on conflict), the theoretical risk window (concurrent actions checking before either deducts), and the mitigation path (move balance check inside the mutation, or use workpool with `maxParallelism: 1`). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | (project version) | Backend framework: crons, mutations, actions, OCC | Already the entire backend stack; cron scheduling and OCC are built-in |
| stripe | (project version) | Stripe API client for subscription re-fetch | Already used in `convex/subscriptions/actions.ts`; API version `2026-01-28.clover` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex/server `cronJobs` | built-in | Cron job scheduling | For `checkSubscriptionStatus` interval change and new `monitorFailedStripeEvents` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Console log alerting | External service (Slack, PagerDuty) | Per locked decision: console log + dashboard only. No external integrations. |
| Hourly cron monitoring | Real-time query on dashboard | Cron is simpler, fires automatically, no UI to build |

**Installation:**
No new packages required. This phase uses only existing dependencies.

## Architecture Patterns

### Recommended Changes to Existing Structure
```
convex/
├── maintenance/
│   └── internal.ts        # Extend checkSubscriptionStatus, add monitorFailedStripeEvents
├── crons.ts               # Change interval for subscription check, add monitoring cron
├── credits/
│   └── internal.ts        # Add TOCTOU JSDoc on deductCredits
└── http.ts                # Add idempotency JSDoc contracts on financial handlers
```

### Pattern 1: Corrective Sync Cron (INFRA-01)
**What:** Convert `checkSubscriptionStatus` to an `internalAction` so it can call the Stripe API, then call `syncSubscription` mutation to correct local state.
**When to use:** Detecting subscription state divergence between local DB and Stripe.
**Key consideration:** The current function is an `internalMutation` and cannot make HTTP calls to Stripe. It must become an `internalAction` that queries local subscriptions, re-fetches from Stripe, and calls `syncSubscription` via `ctx.runMutation`.

```typescript
// Pattern: action queries local state, re-fetches from Stripe, patches divergence
export const checkSubscriptionStatus = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // 1. Query active subscriptions from local DB
    const activeSubscriptions = await ctx.runQuery(
      internal.subscriptions.internal.listActiveSubscriptions
    );

    // 2. For each, re-fetch from Stripe API
    for (const sub of activeSubscriptions) {
      const fresh = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

      // 3. Compare fields: status, currentPeriodEnd, plan/priceId
      if (isDiverged(sub, fresh)) {
        // 4. Sync from Stripe (source of truth)
        await syncLocalSubscriptionFromStripe(ctx, fresh);
        console.log(`[checkSubscriptionStatus] Corrected divergence`, { ... });
      }
    }
  },
});
```

**Fields to compare for divergence detection:**
- `status` (local vs Stripe `subscription.status`)
- `currentPeriodEnd` (local vs Stripe `subscription.current_period_end * 1000`)
- `plan` derived from `priceId` (local plan vs Stripe `items.data[0].price.id` mapped through `getPlanFromPriceId`)
- `cancelAtPeriodEnd` (local vs Stripe)

### Pattern 2: Failed Event Monitor (INFRA-02)
**What:** A cron that queries `stripeEventLogs` for events in `failed` status older than 1 hour and logs them prominently.
**When to use:** Alerting on webhook processing failures that need manual investigation.

```typescript
// Pattern: query failed events, log alerts for stale failures
export const monitorFailedStripeEvents = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    // Use by_status_next_retry index (status field)
    const failedEvents = await ctx.db
      .query("stripeEventLogs")
      .withIndex("by_status_next_retry", (q) => q.eq("status", "failed"))
      .collect();

    const staleFailures = failedEvents.filter(e => e.updatedAt < oneHourAgo);

    for (const event of staleFailures) {
      console.error(`[ALERT] Stale failed Stripe event`, {
        stripeEventId: event.stripeEventId,
        eventType: event.eventType,
        lastError: event.lastError,
        failedAt: event.updatedAt,
        ageMinutes: Math.floor((Date.now() - event.updatedAt) / 60_000),
      });
    }

    if (staleFailures.length > 0) {
      console.error(`[ALERT] ${staleFailures.length} Stripe events failed >1 hour ago`);
    }
  },
});
```

**Note:** This is correctly an `internalMutation` (not action) because it only reads the local database -- no external API calls needed.

### Pattern 3: Idempotency Audit JSDoc (INFRA-03)
**What:** Inline JSDoc documenting the idempotency contract for each financial webhook handler.
**When to use:** On each handler in `http.ts` and the mutations they call.

```typescript
/**
 * IDEMPOTENCY CONTRACT (INFRA-03):
 *
 * This handler is idempotent. Replaying the same event produces identical outcomes:
 *
 * - Dedup gate: [describe the specific mechanism]
 * - On replay: [describe what happens when event is replayed]
 * - Side effects: [list any side effects and how they're guarded]
 * - Verified: [date]
 */
```

### Pattern 4: TOCTOU Documentation JSDoc (INFRA-04)
**What:** JSDoc block on `deductCredits` documenting the race condition, current protection, and mitigation path.
**When to use:** On the `deductCredits` mutation in `convex/credits/internal.ts`.

Following the same JSDoc pattern as the DEDUP CONTRACT on `grantMonthlyCredits` (Phase 2 CRED-01).

### Anti-Patterns to Avoid
- **Auto-retrying failed events in the monitor cron:** Per locked decision, flag only. Failed events may have failed for a reason; manual investigation is safer.
- **Cascading credit corrections from subscription sync:** Per locked decision, the credit reconciliation cron handles credits independently. The subscription sync cron fixes subscription state only.
- **Making the monitoring cron an action:** It only reads local DB. Keep it as `internalMutation` for simplicity and OCC protection.
- **Building external notification integrations:** Per locked decision, console log + Convex dashboard only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe subscription state re-fetch | Custom HTTP client for Stripe | `stripe.subscriptions.retrieve()` | Already used in `handleSubscriptionWebhook`; same pattern |
| Local subscription sync | Custom field-by-field patching | `syncLocalSubscriptionFromStripe()` helper | Already exists in `convex/subscriptions/actions.ts`, handles all field mapping |
| Cron scheduling | `ctx.scheduler.runAfter` loops | `crons.interval()` in `crons.ts` | Built-in cron is self-managing, visible in dashboard |
| OCC-based atomicity | Manual locking or version checks | Convex's built-in OCC | Automatic retry with serializable isolation; up to 32 retries with exponential backoff |

**Key insight:** This phase adds no new external dependencies. Every capability needed (Stripe re-fetch, cron scheduling, event log querying, OCC) is already in the codebase or Convex built-in. The work is extending existing patterns, not introducing new ones.

## Common Pitfalls

### Pitfall 1: internalMutation Cannot Call Stripe API
**What goes wrong:** Attempting to use `stripe.subscriptions.retrieve()` inside an `internalMutation` fails because Convex mutations run in a sandboxed deterministic runtime that blocks HTTP calls.
**Why it happens:** Convex enforces determinism for OCC safety -- mutations cannot have external side effects.
**How to avoid:** Convert `checkSubscriptionStatus` to `internalAction`. Use `ctx.runQuery` to read local data, then call Stripe API, then `ctx.runMutation` to write corrections.
**Warning signs:** Runtime error "Cannot use fetch in mutations" or similar.

### Pitfall 2: Cron Concurrency Overlap
**What goes wrong:** If `checkSubscriptionStatus` takes longer than 1 hour (many subscriptions, Stripe rate limits), the next cron invocation is skipped.
**Why it happens:** Convex crons enforce "at most one run of each cron job can be executing at any moment."
**How to avoid:** Batch subscriptions (process N at a time with early exit). Log warnings if approaching time limits. The current codebase already uses batching patterns (see `cleanupDeletedUsers` with BATCH_SIZE).
**Warning signs:** Dashboard shows skipped cron runs.

### Pitfall 3: Stripe API Rate Limiting in Cron
**What goes wrong:** Calling `stripe.subscriptions.retrieve()` for every active subscription in a single cron run hits Stripe's rate limit (25 requests/second in test mode, 100 in live mode).
**Why it happens:** Linear iteration over all subscriptions without throttling.
**How to avoid:** Process subscriptions in batches. Add early-exit heuristics (skip subscriptions updated within the last hour -- they were likely just synced by a webhook). Consider processing only subscriptions whose `currentPeriodEnd` is stale (past or approaching).
**Warning signs:** Stripe `429 Too Many Requests` errors in logs.

### Pitfall 4: Confusing OCC Protection Scope
**What goes wrong:** Assuming Convex OCC prevents ALL race conditions, including the check-then-act pattern across an action and a mutation.
**Why it happens:** OCC protects within a single mutation transaction. But the pattern `query(checkBalance) -> ... -> mutation(deductCredits)` has a gap where another action could also pass the check.
**How to avoid:** Document this clearly in the TOCTOU JSDoc. The `deductCredits` mutation itself re-reads the balance and throws `INSUFFICIENT_CREDITS` if insufficient -- this IS the OCC protection. Two concurrent deductions will serialize: one succeeds, the other either succeeds (if balance is sufficient for both) or throws.
**Warning signs:** Users report negative credit balances (which would indicate the check inside the mutation is bypassed -- currently it is NOT bypassed).

### Pitfall 5: Query Index Mismatch for Failed Events
**What goes wrong:** Attempting to query `stripeEventLogs` by `status` + `updatedAt` but no composite index exists for that combination.
**Why it happens:** The `by_status_next_retry` index is on `["status", "nextRetryAt"]`, not `["status", "updatedAt"]`.
**How to avoid:** Query using `by_status_next_retry` with `eq("status", "failed")`, then filter `updatedAt < threshold` in JavaScript. The failed event set should be small (failures are exceptional), so in-memory filtering is acceptable.
**Warning signs:** Slow queries or missing results.

## Code Examples

### Existing Cron Configuration (current state)
```typescript
// Source: convex/crons.ts
crons.interval(
  "check subscription status",
  { hours: 24 },  // Currently 24h, needs to change to 1h
  internal.maintenance.internal.checkSubscriptionStatus
);
```

### Existing checkSubscriptionStatus (current state)
```typescript
// Source: convex/maintenance/internal.ts
// Currently: internalMutation that handles past-due grace period only
// Logs warnings for active subs past period end but takes no corrective action
// Needs to: become internalAction, re-fetch from Stripe, auto-correct divergences
```

### Existing Dedup Contract Pattern (Phase 2 model to follow)
```typescript
// Source: convex/credits/internal.ts - grantMonthlyCredits
/**
 * DEDUP CONTRACT (CRED-01):
 * Credit grants are deduplicated at the INVOICE ID level, not the event ID level.
 * This is the canonical dedup gate -- both the invoice.paid webhook path and the
 * reconciliation cron path converge on this mutation. The same invoice can arrive
 * via different event IDs (webhook: evt_xxx, cron: reconcile.pull:in_xxx), so
 * event-ID dedup would fail. Invoice-ID dedup catches both.
 *
 * Concurrency safety: Convex mutations are serializable (OCC). Two concurrent
 * mutations attempting to write creditTransactions for the same stripeInvoiceId
 * will conflict -- one succeeds, the other retries and finds the existing record.
 */
```

### Existing syncLocalSubscriptionFromStripe Helper
```typescript
// Source: convex/subscriptions/actions.ts (lines 112-151)
// This helper already: extracts item/price/customer from Stripe response,
// normalizes status, calculates period bounds, calls syncSubscription mutation.
// Reusable directly for the corrective sync cron.
```

### stripeEventLogs Schema (relevant fields)
```typescript
// Source: convex/schema.ts
stripeEventLogs: defineTable({
  stripeEventId: v.string(),
  eventType: v.string(),
  status: v.union(
    v.literal("received"),
    v.literal("processed"),
    v.literal("retrying"),
    v.literal("failed"),
    v.literal("ignored")
  ),
  attemptCount: v.number(),
  lastError: v.optional(v.string()),
  updatedAt: v.number(),
  // ...
})
  .index("by_status_next_retry", ["status", "nextRetryAt"])
  // No index on ["status", "updatedAt"] -- filter in JS after querying by status
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual OCC/locking in application code | Convex built-in OCC with automatic 32 retries | Convex platform built-in | No manual lock management needed |
| External cron services (AWS Lambda, etc.) | Convex `cronJobs()` built-in | Convex v1+ | Dashboard visibility, guaranteed at-most-once execution |
| `stripe.invoices.retrieveUpcoming()` | `stripe.invoices.createPreview()` | Stripe API 2026-01-28.clover | Already updated in Phase 1 |

**Deprecated/outdated:**
- None relevant to this phase. All APIs and patterns used are current.

## Open Questions

1. **Subscription batch size for corrective sync**
   - What we know: The cron processes all active subscriptions. Stripe rate limit is ~100 req/sec in live mode.
   - What's unclear: Current subscription count in production. At scale, a single hourly cron might not finish.
   - Recommendation: Start unbounded (process all). Add batch-and-reschedule pattern (same as `cleanupDeletedUsers`) if volume exceeds ~500 active subscriptions. Log processing time so we can detect when batching becomes necessary.

2. **Whether `by_status_next_retry` index works efficiently for monitoring query**
   - What we know: The index covers `["status", "nextRetryAt"]`. For failed events, `nextRetryAt` is likely undefined (failed events don't have a retry scheduled).
   - What's unclear: How Convex handles `eq("status", "failed")` on a compound index when the second field varies.
   - Recommendation: Convex compound indexes support prefix queries. `eq("status", "failed")` uses only the first field, which is valid. Filter `updatedAt` in JS. If performance is a concern, the set of failed events should be very small.

## Sources

### Primary (HIGH confidence)
- [Convex OCC and Atomicity](https://docs.convex.dev/database/advanced/occ) - Serializable isolation, automatic retry, 32 retries max, exponential backoff
- [Convex Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs) - Interval syntax, at-most-once execution, UTC timezone
- Codebase files: `convex/maintenance/internal.ts`, `convex/crons.ts`, `convex/http.ts`, `convex/credits/internal.ts`, `convex/subscriptions/actions.ts`, `convex/schema.ts`

### Secondary (MEDIUM confidence)
- [Convex Scheduling Overview](https://docs.convex.dev/scheduling) - Scheduling patterns
- [How Convex Works](https://stack.convex.dev/how-convex-works) - OCC implementation details

### Tertiary (LOW confidence)
- None. All findings verified against official docs and codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; all capabilities are existing Convex built-ins and project patterns
- Architecture: HIGH - Patterns directly extend existing codebase patterns (cron structure, JSDoc contracts, `syncLocalSubscriptionFromStripe` reuse)
- Pitfalls: HIGH - Verified against Convex official docs (mutation vs action runtime constraints, OCC scope, cron concurrency behavior)

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable domain, no fast-moving dependencies)
