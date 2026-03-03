# Phase 53: TypeScript Compile Fix - Research

**Researched:** 2026-03-03
**Domain:** TypeScript strict compilation / Stripe SDK v20 type changes
**Confidence:** HIGH

## Summary

Phase 53 addresses 32 TypeScript compile errors across 8 files that emerged from Phase 48's stricter typing (TYPE-01) combined with Stripe SDK v20's breaking type changes. The errors fall into 5 distinct categories: (1) Stripe v20 removed `current_period_end` / `current_period_start` from `Subscription` (moved to `SubscriptionItem`), (2) Stripe v20 removed top-level `subscription` from `Invoice` (moved to `invoice.parent.subscription_details.subscription`), (3) optional `refs` parameter creates `undefined` flow in `stripeWebhookHandlers.ts`, (4) Stripe v20 changed `Event` from a single interface to a discriminated union of ~260 event types (breaking test helpers), and (5) a new untracked `results-table.tsx` imports 4 non-existent modules.

All errors are type-level only -- the runtime behavior is correct (Stripe API still returns these fields, they're just typed differently now). The fixes are straightforward: access period fields via `SubscriptionItem`, access subscription ID via `invoice.parent`, add null guards for optional refs, update test helpers to work with the new `Event` union, and either delete or fix the orphaned `results-table.tsx`.

**Primary recommendation:** Fix all 32 errors by adapting to Stripe v20's new type shapes -- no library changes, no runtime behavior changes, purely type-level corrections.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stripe | ^20.3.0 (installed: 20.3.1) | Stripe API client + types | Already installed; v20 is the current major |
| typescript | (project tsconfig strict: true) | Type checking | Already configured with strict mode |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | (installed) | Test runner | Existing tests that need type fixes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stripe v20 types | Downgrade to Stripe v17 | Would revert Phase 48 TYPE-01 work; not viable |
| Strict `as` casts | `@ts-expect-error` | Suppresses errors instead of fixing them; bad practice |

**Installation:** No new packages needed.

## Architecture Patterns

### Pattern 1: Accessing Subscription Period Fields in Stripe v20
**What:** In Stripe SDK v20, `current_period_end` and `current_period_start` were removed from `Stripe.Subscription` and moved to `Stripe.SubscriptionItem`. The subscription's items are at `subscription.items.data[0]`.
**When to use:** Every place that reads `subscription.current_period_end` or `subscription.current_period_start`.
**Example:**
```typescript
// OLD (Stripe v17): subscription.current_period_end
// NEW (Stripe v20): get from the first subscription item
const item = subscription.items.data[0];
const periodEnd = item.current_period_end;
const periodStart = item.current_period_start;
```
**Confidence:** HIGH -- verified directly against `node_modules/stripe/types/SubscriptionItems.d.ts` (lines 53, 58) and confirmed `Subscriptions.d.ts` has no `current_period` fields.

**Note:** The codebase already has a fallback pattern: `subscription.current_period_end ?? item.current_period_end`. The fix is to simply remove the `subscription.current_period_end ??` prefix and go directly to `item.current_period_end`. This applies to both `Subscription` and `Response<Subscription>` (which is just `Subscription & { lastResponse }` per `lib.d.ts:176`).

### Pattern 2: Accessing Invoice Subscription in Stripe v20
**What:** In Stripe v20, `Invoice.subscription` was removed. The subscription is now at `invoice.parent?.subscription_details?.subscription`.
**When to use:** `convex/http.ts` line 258-260 where `invoice.subscription` is accessed.
**Example:**
```typescript
// OLD: invoice.subscription
// NEW: invoice.parent?.subscription_details?.subscription
const subRef = invoice.parent?.subscription_details?.subscription;
const subscriptionId = typeof subRef === "string" ? subRef : subRef?.id;
```
**Confidence:** HIGH -- verified against `node_modules/stripe/types/Invoices.d.ts` (line 336: `parent: Invoice.Parent | null`, line 1038: `subscription_details`, line 1064: `subscription: string | Stripe.Subscription`).

### Pattern 3: Non-optional Function References
**What:** `stripeWebhookHandlers.ts` accepts `refs?` as optional parameter, then passes `refs?.markStripeEventProcessed` to functions that expect non-optional `FunctionReference`. The `ctx.runMutation()` and `ctx.scheduler.runAfter()` also don't accept `undefined`.
**When to use:** The 5 errors in `stripeWebhookHandlers.ts` (lines 57, 69, 96, 102, 114).
**Example:**
```typescript
// Option A: Make refs required (since all callers pass refs)
export async function runAuditedStripeHandler(
  ctx: GenericActionCtx<any>,
  event: Stripe.Event,
  handler: () => Promise<void>,
  refs: {  // Remove the '?' -- make required
    markStripeEventProcessed: FunctionReference<"mutation", "internal">;
    markStripeEventFailed: FunctionReference<"mutation", "internal">;
  },
): Promise<void> { ... }

// Option B: Add null guards inside the function
if (refs?.markStripeEventProcessed) {
  await ctx.runMutation(refs.markStripeEventProcessed, { ... });
}
```
**Confidence:** HIGH -- direct code inspection shows all callers (in `convex/http.ts`) pass the refs.

### Pattern 4: Test Helpers for Stripe v20 Event Union
**What:** In Stripe v20, `Stripe.Event` is a discriminated union of ~260 specific event types (e.g., `InvoicePaidEvent`, `CustomerSubscriptionCreatedEvent`). Creating a `Partial<Stripe.Event>` and casting no longer works cleanly because TypeScript can't resolve which union member you mean.
**When to use:** `tests/stripe-webhook-handler.test.ts` (lines 55, 64, 73 -- `ReceivedDebit` errors) and lines 165, 183, 202 (Invoice errors).
**Example:**
```typescript
// OLD: casting partial objects to Stripe.Event.Data.Object
// doesn't work because Event is now a union and Data.Object
// resolves to the last union member (ReceivedDebit)

// FIX: Use 'as unknown as Stripe.Event' for test mock helpers
// or use specific event types:
function makeStripeEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_test_123",
    type: "invoice.paid",
    api_version: "2024-12-18.acacia",
    data: {
      object: { id: "obj_abc" },
    },
    ...overrides,
  } as unknown as Stripe.Event;
}

// For invoice mocks: cast as Stripe.Invoice
const invoice = { id: "inv_001" } as unknown as Stripe.Invoice;
```
**Confidence:** HIGH -- verified `Event` is a union type in `EventTypes.d.ts` (line 5-258), and `TreasuryReceivedDebitCreatedEvent` is the last member (line 258).

### Pattern 5: Convex Id Type in Test Files
**What:** `tests/credit_grant_missing_credits_row.test.ts` passes string `"user_123"` where `Id<"users">` is expected. Convex `Id` is a branded type (`string & { __tableName: "users" }`).
**When to use:** Line 7 of `credit_grant_missing_credits_row.test.ts`.
**Example:**
```typescript
// FIX: Cast the string to the branded Id type
import type { Id } from "../convex/_generated/dataModel";
const row = buildInitialCreditsRecord({
  userId: "user_123" as unknown as Id<"users">,
  now: 1_700_000_000_000,
});
```
**Confidence:** HIGH -- verified `buildInitialCreditsRecord` expects `Doc<"users">["_id"]` which is `Id<"users">` (convex/credits/internal.ts line 107).

### Pattern 6: Orphaned results-table.tsx
**What:** `components/extraction/results-table.tsx` is an untracked file (shown in `git status` as `??`) that imports 4 modules that don't exist anywhere in the codebase: `pdf-citation-drawer`, `shared/status-badges`, `shared/confidence-badge`, `shared/citation-status-badge`.
**When to use:** 4 `TS2307: Cannot find module` errors.
**Example:**
```typescript
// The file imports:
// @/components/extraction/pdf-citation-drawer -- does NOT exist
// @/components/extraction/shared/status-badges -- does NOT exist
// @/components/extraction/shared/confidence-badge -- does NOT exist
// @/components/extraction/shared/citation-status-badge -- does NOT exist

// The existing codebase has:
// components/extraction/results-views/table-view.tsx (uses getConfidenceColor)
// components/extraction/results-views/card-view.tsx (uses getConfidenceColor)
// These import from different paths that DO exist
```
**Confidence:** HIGH -- verified via `grep` and `glob` that none of the 4 imported modules exist. The file is untracked and likely an abandoned draft or artifact. Simplest fix: delete the file.

### Anti-Patterns to Avoid
- **`@ts-ignore` / `@ts-expect-error` to suppress:** These hide real type issues. Fix the types instead.
- **Reverting to `as any` casts:** Would undo Phase 48's TYPE-01 work.
- **Pinning Stripe types to an old version:** `@types/stripe` doesn't exist for v20+ (types are bundled). Can't decouple.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe type assertions | Custom type guards for every Stripe type | `as unknown as Stripe.X` cast in test files | Test mocks don't need runtime type safety |
| Period field access helper | Utility function that checks both old and new locations | Direct `item.current_period_end` access | The old location doesn't exist in v20 types |

**Key insight:** These are all type-level fixes. No runtime behavior changes needed. The Stripe API responses haven't changed -- only the TypeScript type definitions have.

## Common Pitfalls

### Pitfall 1: Assuming subscription.current_period_end Still Exists at Runtime
**What goes wrong:** Devs might think the field was truly removed from the API response.
**Why it happens:** Stripe SDK v20 removed it from the TYPE, but the API may still return it for backward compat.
**How to avoid:** Use `item.current_period_end` which is both type-safe AND guaranteed by the API. Don't rely on untyped runtime fields.
**Warning signs:** Using `(subscription as any).current_period_end` -- this works but defeats strict typing.

### Pitfall 2: Breaking Test Helpers with Overly Specific Event Types
**What goes wrong:** Trying to make `makeStripeEvent` return a specific event type like `Stripe.InvoicePaidEvent` forces all test data to match that exact shape.
**Why it happens:** Stripe v20's discriminated union is very strict.
**How to avoid:** Keep using `as unknown as Stripe.Event` for the test helper. The tests verify behavior, not types. Use `as unknown as Stripe.Invoice` for invoice mocks.
**Warning signs:** Tests requiring 60+ mandatory fields just to create a mock object.

### Pitfall 3: Optional Refs Causing Runtime Errors
**What goes wrong:** Making refs required in the function signature could break if any caller doesn't provide them.
**Why it happens:** The `refs?` was originally optional for testability.
**How to avoid:** Check all callers before changing the signature. In this codebase, all callers pass refs, so making them required is safe. Alternatively, add null guards inside the functions.
**Warning signs:** `ctx.runMutation(undefined, ...)` at runtime throws a Convex error.

### Pitfall 4: Forgetting Response<Subscription> is Subscription & {...}
**What goes wrong:** Treating `Response<Subscription>` as a different type from `Subscription`.
**Why it happens:** The error messages say "Property does not exist on type 'Response<Subscription>'" which looks different from "on type 'Subscription'".
**How to avoid:** Understand that `Response<T> = T & { lastResponse }`. The fix for `Subscription` applies identically to `Response<Subscription>`.

## Code Examples

### Fix: Subscription Period Access (13 occurrences in subscriptions/actions.ts)
```typescript
// Source: verified against node_modules/stripe/types/SubscriptionItems.d.ts

// BEFORE (broken in v20):
const currentPeriodEndSec = subscription.current_period_end ?? item.current_period_end ?? fallback;
const currentPeriodStartSec = subscription.current_period_start ?? item.current_period_start ?? fallback;

// AFTER (v20 compatible):
const currentPeriodEndSec = item.current_period_end ?? fallback;
const currentPeriodStartSec = item.current_period_start ?? fallback;

// For Response<Subscription> from stripe.subscriptions.retrieve():
const stripeSub = await stripe.subscriptions.retrieve(id, { expand: [...] });
const item = stripeSub.items.data[0];
const periodEnd = item.current_period_end;
```

### Fix: Invoice Subscription Access (3 occurrences in http.ts)
```typescript
// Source: verified against node_modules/stripe/types/Invoices.d.ts

// BEFORE (broken in v20):
const failedSubscriptionId =
  typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id;

// AFTER (v20 compatible):
const subRef = invoice.parent?.subscription_details?.subscription;
const failedSubscriptionId =
  typeof subRef === "string" ? subRef : subRef?.id;
```

### Fix: Optional Refs (5 occurrences in stripeWebhookHandlers.ts)
```typescript
// Source: direct code inspection

// APPROACH: Make refs required (all callers provide them)
export async function runAuditedStripeHandler(
  ctx: GenericActionCtx<any>,
  event: Stripe.Event,
  handler: () => Promise<void>,
  refs: {  // was: refs?:
    markStripeEventProcessed: FunctionReference<"mutation", "internal">;
    markStripeEventFailed: FunctionReference<"mutation", "internal">;
  },
): Promise<void> {
  // Now refs.markStripeEventProcessed is guaranteed non-undefined
  await ctx.runMutation(refs.markStripeEventProcessed, { ... });
}

// Same for processInvoiceForGrantNonBlocking and recordStripeEventFailure
```

### Fix: Test Event Helper (6 occurrences in stripe-webhook-handler.test.ts)
```typescript
// Source: verified Event is union in EventTypes.d.ts

// BEFORE (broken -- Partial<Stripe.Event> can't resolve union):
const event = makeStripeEvent({
  data: {
    object: { id: "sub_abc123" } as unknown as Stripe.Event.Data.Object,
  },
});

// AFTER (works with v20 union):
// Keep makeStripeEvent using `as unknown as Stripe.Event`
// For data overrides, structure the override the same way:
const event = makeStripeEvent({
  data: {
    object: { id: "sub_abc123" },
  } as Stripe.Event["data"],
});

// For invoice mocks:
const invoice = { id: "inv_001" } as unknown as Stripe.Invoice;
```

### Fix: Convex Id in Test (1 occurrence in credit_grant_missing_credits_row.test.ts)
```typescript
// Source: convex/credits/internal.ts line 107

import type { Id } from "../convex/_generated/dataModel";

const row = buildInitialCreditsRecord({
  userId: "user_123" as unknown as Id<"users">,
  now: 1_700_000_000_000,
});
```

### Fix: Orphaned results-table.tsx (4 module-not-found errors)
```bash
# The file is untracked (git status shows '??') and imports non-existent modules.
# Simplest fix: delete it.
rm components/extraction/results-table.tsx
```

## State of the Art

| Old Approach (Stripe v17) | Current Approach (Stripe v20) | When Changed | Impact |
|---------------------------|-------------------------------|--------------|--------|
| `subscription.current_period_end` | `item.current_period_end` | Stripe SDK v20 | Period fields moved to SubscriptionItem |
| `invoice.subscription` | `invoice.parent.subscription_details.subscription` | Stripe SDK v20 | Invoice subscription access restructured |
| `Stripe.Event` (single interface) | `Stripe.Event` (discriminated union of ~260 types) | Stripe SDK v20 | Test helpers need `as unknown as` casts |
| `Stripe.Event.Data.Object` (empty interface) | Specific typed objects per event | Stripe SDK v20 | Can't use generic `Data.Object` casts |

**Deprecated/outdated:**
- `Subscription.current_period_end`: Removed in v20; use `SubscriptionItem.current_period_end`
- `Subscription.current_period_start`: Removed in v20; use `SubscriptionItem.current_period_start`
- `Invoice.subscription`: Removed in v20; use `Invoice.parent.subscription_details.subscription`

## Open Questions

1. **Should results-table.tsx be deleted or fixed?**
   - What we know: It's an untracked file importing 4 non-existent modules. No other file imports from it. The existing `results-views/table-view.tsx` appears to serve the same purpose.
   - What's unclear: Whether the user intentionally created this file for future use.
   - Recommendation: Delete it. If needed later, it can be recreated properly. Keeping a broken file in the tree adds noise.

2. **Should stripeWebhookHandlers refs be made required or guarded?**
   - What we know: All current callers in `convex/http.ts` pass the refs. The `refs?` optional was added during Phase 48 for test isolation.
   - What's unclear: Whether future callers might omit refs.
   - Recommendation: Make refs required. Tests can provide mock refs. This is safer than null guards that silently skip audit logging.

## Error Inventory

| # | File | Error | Category | Fix |
|---|------|-------|----------|-----|
| 1-4 | components/extraction/results-table.tsx | TS2307: Cannot find module (x4) | Missing modules | Delete orphaned file |
| 5-7 | convex/http.ts | TS2339: Property 'subscription' does not exist on Invoice (x3) | Stripe v20 Invoice | Use `invoice.parent.subscription_details.subscription` |
| 8-12 | convex/lib/stripeWebhookHandlers.ts | TS2345: `undefined` not assignable to FunctionReference (x5) | Optional refs | Make refs required |
| 13-24 | convex/subscriptions/actions.ts | TS2339: `current_period_end`/`current_period_start` on Subscription/Response<Subscription> (x12) | Stripe v20 Subscription | Use `item.current_period_end` |
| 25 | tests/credit_grant_missing_credits_row.test.ts | TS2322: string not assignable to Id<"users"> | Convex branded type | Cast `as unknown as Id<"users">` |
| 26-27 | tests/live-billing/*.test.ts | TS2339: `current_period_end` on Response<Subscription> (x2) | Stripe v20 Subscription | Use `item.current_period_end` |
| 28-30 | tests/stripe-webhook-handler.test.ts | TS2740: Type 'Object' missing ReceivedDebit properties (x3) | Stripe v20 Event union | Fix test helper casting |
| 31-32 | tests/stripe-webhook-handler.test.ts | TS2345: `{ id: string }` not assignable to Invoice (x3) | Stripe v20 Invoice | Cast `as unknown as Stripe.Invoice` |

**Total: 32 errors across 8 files, 5 categories.**

## Sources

### Primary (HIGH confidence)
- `node_modules/stripe/types/Subscriptions.d.ts` -- Verified `current_period_end`/`current_period_start` absent from Subscription interface
- `node_modules/stripe/types/SubscriptionItems.d.ts` lines 53, 58 -- Verified `current_period_end`/`current_period_start` present on SubscriptionItem
- `node_modules/stripe/types/Invoices.d.ts` lines 336, 1038, 1064 -- Verified `parent.subscription_details.subscription` path
- `node_modules/stripe/types/EventTypes.d.ts` lines 5-258 -- Verified Event is discriminated union
- `node_modules/stripe/types/lib.d.ts` line 176 -- Verified `Response<T> = T & { lastResponse }`
- `node_modules/stripe/package.json` -- Confirmed version 20.3.1
- Direct `npx tsc --noEmit` output -- All 32 errors verified first-hand

### Secondary (MEDIUM confidence)
- None needed -- all findings verified against installed type definitions

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all fixes use existing installed packages
- Architecture: HIGH -- all patterns verified against actual type definition files in node_modules
- Pitfalls: HIGH -- based on direct analysis of the error messages and type definitions

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable -- Stripe v20 types won't change within a patch)
