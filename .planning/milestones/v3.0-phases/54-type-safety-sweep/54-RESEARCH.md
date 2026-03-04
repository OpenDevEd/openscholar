# Phase 54: Type Safety Sweep - Research

**Researched:** 2026-03-03
**Domain:** TypeScript type safety, Convex validators, module hygiene, dead code removal
**Confidence:** HIGH

## Summary

Phase 54 eliminates every `as any` cast in the codebase and resolves module boundary violations, dead code, and orphaned files. The phase touches 8 distinct areas across 6 files, plus 2 new test files. Every fix follows established patterns already present in the codebase -- no new libraries, no architectural changes.

The core technique is straightforward: derive TypeScript types from Convex validators using `Infer<typeof validator>`, replace runtime `as any` casts with proper type narrowing (`typeof` checks, union validators), and clean up dead code and misplaced modules. The `extractionResultWithReviewValidator` already exists in `convex/extraction/validators.ts` with every field the export/filtering code needs -- the type just needs to be derived and threaded through.

**Primary recommendation:** Address each `as any` site individually -- each is a small, self-contained fix with a clear pattern. The riskiest change is TYPE-03 (rate limiter validator union) because it changes the runtime argument validation shape; test it first.

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TYPE-01 | Derive `ExtractionResultWithReview` type from validator, thread through export/filtering, eliminate `result as any` | Validator exists at `convex/extraction/validators.ts:260-281`. Use `Infer<typeof extractionResultWithReviewValidator>` from `convex/values`. 7 `as any` casts across 2 files to replace. |
| TYPE-02 | Replace `(fresh.customer as any)?.id` with `typeof` narrowing in maintenance cron | Pattern already used in `convex/http.ts`. Single cast at line 103 of `convex/maintenance/internal.ts`. Also note line 51 declares `fresh: any` for the full subscription -- narrowing customer alone leaves the broader `any`. |
| TYPE-03 | Replace `name: args.name as any` in rate limiter `consume` mutation with union validator | `defineRateLimits` returns typed functions where `Name extends keyof Limits & string`. Use `v.union(v.literal("start-extraction"), v.literal("api-key-save"), v.literal("checkout-session"))` for the `name` arg. |
| TYPE-04 | Replace `job.workflowId as any` with properly typed `WorkflowId` in workflow cancel | `WorkflowId` is a branded string: `string & { __isWorkflowId: true }`. Exported from `@convex-dev/workflow` as type and `vWorkflowId` as validator. Schema stores `workflowId` as `v.optional(v.string())`. Cast `as WorkflowId` is the correct fix. |
| TYPE-05 | Delete unused `components/library/library-filters.tsx` | File is 407 lines, confirmed dead code (not imported anywhere). Knip already flagged it. |
| TYPE-06 | Move `getProviderModel` from `lib/ai/client/providers` to `lib/ai/server/` or `lib/ai/core/` | Two importers: `convex/ai/helpers.ts` and `lib/ai/client/executor.ts`. Must update both imports. No `lib/ai/server/` directory exists yet -- need to create it, or place in existing `lib/ai/core/`. |
| TYPE-07 | Verify `convex/test.setup.ts` purpose and resolve orphan status | File exports `modules` glob for `convex-test` module discovery. `vitest.config.ts` does NOT reference it. Convex tests in `convex/**/*.test.ts` use `convex-test` but import `schema` directly, not `modules`. Check if any test imports this file. |
| TYPE-08 | Migrate upgrade metadata reading from Stripe to Convex subscription record | Convex schema already has `pendingFromPlan`, `pendingToPlan`, `pendingChangeTimestamp` fields. `processInvoiceForGrant` in `convex/credits/actions.ts` reads from `subscription.metadata` instead. Also has `(subscription as any).current_period_start` casts. |
| TEST-03 | Add test for rate limiter with invalid name string verifying rejection | Requires `convex-test` edge-runtime test (same pattern as `cascade-delete.test.ts`). Call `consume` mutation with a name not in the `defineRateLimits` config. |
| TEST-04 | Add test for workflow cancel path | Existing cascade-delete test covers delete but not cancel. Need a test that calls `cancelExtraction` mutation with a job that has a `workflowId`. Cannot easily test actual workflow cancellation in `convex-test` -- test should verify the mutation path runs without error. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | (installed) | Convex `Infer<typeof validator>` for deriving TS types from validators | First-party Convex utility -- the official way to get types from validators |
| convex/values | (installed) | `Infer` type export | Already in project deps |
| @convex-dev/workflow | (installed) | `WorkflowId` type + `vWorkflowId` validator | Already in project deps; provides branded type for TYPE-04 |
| convex-helpers | (installed) | `defineRateLimits` typed return | Already in project deps; provides typed rate limit names |
| vitest | (installed) | Test framework | Already configured in `vitest.config.ts` |
| convex-test | (installed) | Convex function testing | Already configured; edge-runtime environment for Convex tests |

### Supporting
No new libraries required. Every fix uses existing project dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Infer<typeof validator>` | Manual interface definition | Validator and type drift apart; `Infer` keeps them in sync |
| `v.union(v.literal(...))` for rate limit names | `z.enum()` Zod validation | Convex validators are the standard for Convex functions; Zod adds unnecessary dependency |
| `as WorkflowId` cast | Storing workflowId as `vWorkflowId` in schema | Schema migration required; cast is safe because workflow IDs come from the workflow manager |

## Architecture Patterns

### Recommended Project Structure
```
convex/extraction/validators.ts    # Source of truth for extraction types
lib/extraction/types.ts            # Re-export derived types for client use (NEW)
lib/extraction/export.ts           # Uses derived type instead of `as any`
lib/extraction/filtering.ts        # Uses derived type instead of `as any`
lib/ai/server/providers.ts         # Moved from lib/ai/client/providers.ts (NEW location)
```

### Pattern 1: Deriving Types from Convex Validators
**What:** Use `Infer<typeof validator>` to get a TypeScript type from a Convex validator object
**When to use:** Any time you need a TypeScript type that matches a Convex document shape defined by a validator
**Example:**
```typescript
// Source: convex/values documentation
import type { Infer } from "convex/values";
import { extractionResultWithReviewValidator } from "@/convex/extraction/validators";

export type ExtractionResultWithReview = Infer<typeof extractionResultWithReviewValidator>;
```

### Pattern 2: Stripe Customer ID Narrowing
**What:** Use `typeof` narrowing to handle Stripe's string-or-expanded-object union
**When to use:** Any Stripe API response where a related object can be expanded or a string ID
**Example:**
```typescript
// Source: already used in convex/http.ts in this codebase
const stripeCustomerId =
  typeof fresh.customer === "string"
    ? fresh.customer
    : fresh.customer?.id;
```

### Pattern 3: Branded Type Cast for Workflow IDs
**What:** Cast a plain string to `WorkflowId` (branded type from `@convex-dev/workflow`)
**When to use:** When retrieving a workflow ID stored as `v.string()` and passing it to workflow manager methods that expect `WorkflowId`
**Example:**
```typescript
import type { WorkflowId } from "@convex-dev/workflow";

// workflowId is stored as v.string() in schema
await workflow.cancel(ctx, job.workflowId as WorkflowId);
```

### Pattern 4: Convex Union Validator for Rate Limit Names
**What:** Replace `v.string()` with `v.union(v.literal(...))` to get compile-time and runtime type safety
**When to use:** When a Convex mutation argument must be one of a known set of string values
**Example:**
```typescript
// Source: convex-helpers defineRateLimits pattern
const RATE_LIMIT_NAMES = ["start-extraction", "api-key-save", "checkout-session"] as const;

export const consume = internalMutation({
  args: {
    name: v.union(
      v.literal("start-extraction"),
      v.literal("api-key-save"),
      v.literal("checkout-session")
    ),
    key: v.string(),
    count: v.optional(v.number()),
  },
  // ...
});
```

### Anti-Patterns to Avoid
- **`as any` to bypass type errors:** Always find the correct type or use type narrowing instead. Each `as any` hides potential runtime bugs.
- **Duplicate type definitions:** Use `Infer<typeof validator>` to derive types from validators, never hand-write a parallel interface.
- **Module boundary violations:** Do not import from `client/` in server code or vice versa. If a function is used by both, put it in `core/` or `server/`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript type from Convex validator | Manual interface duplicating validator fields | `Infer<typeof validator>` from `convex/values` | Keeps type and validator in sync automatically |
| Rate limit name validation | Manual `if (name !== "x" && name !== "y")` check | `v.union(v.literal(...))` in Convex args validator | Convex rejects invalid args before handler runs |
| Stripe customer ID extraction | `(obj as any)?.id` | `typeof obj === "string" ? obj : obj?.id` | Type-safe, handles both Stripe shapes correctly |

**Key insight:** Every `as any` in this codebase exists because of a missing type derivation or narrowing pattern. The fixes are all mechanical -- apply the right pattern and the cast becomes unnecessary.

## Common Pitfalls

### Pitfall 1: Forgetting to Update All Import Sites When Moving a Module
**What goes wrong:** Moving `getProviderModel` to a new location but missing one of its import sites causes a build break.
**Why it happens:** The function is imported in 2 files (`convex/ai/helpers.ts` and `lib/ai/client/executor.ts`).
**How to avoid:** Run `tsc --noEmit` after the move to catch any broken imports. Search for all occurrences of the old import path.
**Warning signs:** Build failure mentioning "Cannot find module."

### Pitfall 2: Rate Limiter Validator Breaking Existing Callers
**What goes wrong:** Changing the `name` arg from `v.string()` to `v.union(v.literal(...))` causes callers that pass a dynamic string to fail.
**Why it happens:** The union validator rejects any string not in the literal set.
**How to avoid:** Search for all callers of `consume` mutation (`internal.lib.rateLimit.consume`) and verify they pass literal rate limit names. All current callers in this codebase pass literal strings.
**Warning signs:** Runtime ConvexError with argument validation failure.

### Pitfall 3: `Infer` Producing Overly Complex Types
**What goes wrong:** Using `Infer` on a large validator produces a type that's hard to read in IDE tooltips.
**Why it happens:** `Infer` recursively resolves all nested validators.
**How to avoid:** Export a named type alias: `export type ExtractionResultWithReview = Infer<typeof extractionResultWithReviewValidator>`. This gives a clean name in IDE tooltips.
**Warning signs:** IDE showing massive inline type on hover.

### Pitfall 4: TYPE-02 Partial Fix Leaves Broader `any`
**What goes wrong:** The entire `fresh` variable is typed as `any` (line 51: `const fresh: any = ...`). Fixing only the `customer` narrowing still leaves all other `fresh.*` accesses untyped.
**Why it happens:** The Stripe subscription retrieve call returns `Stripe.Subscription` but the handler declares it as `any`.
**How to avoid:** Remove the `: any` annotation on `fresh` and let TypeScript infer `Stripe.Subscription`. Then the customer narrowing becomes the natural next step.
**Warning signs:** Other `fresh.*` accesses still bypassing type checks.

### Pitfall 5: TYPE-08 Convex Record May Lack Pending Fields
**What goes wrong:** Reading `pendingFromPlan` / `pendingToPlan` from the Convex subscription record but these fields are `undefined` for subscriptions created before BILL-02.
**Why it happens:** These fields are `v.optional(...)` in the schema -- existing records don't have them.
**How to avoid:** Keep the Stripe metadata as a fallback path, or only use the Convex fields and accept that pre-migration subscriptions won't have upgrade metadata. The TODO in the code says "once all existing Stripe metadata has been migrated."
**Warning signs:** `undefined` values for `pendingFromPlan` when processing older subscriptions.

### Pitfall 6: TYPE-08 Period Boundaries Still Needed from Stripe
**What goes wrong:** Even after migrating upgrade metadata to Convex, the `current_period_start` and `current_period_end` are read from the Stripe subscription object with `as any` casts.
**Why it happens:** `Stripe.Subscription` has these as `number` properties, but the `as any` cast obscures this.
**How to avoid:** Remove the `as any` casts -- `subscription.current_period_start` and `subscription.current_period_end` are properly typed `number` fields on `Stripe.Subscription`. The Convex `subRecord` has `currentPeriodStart` and `currentPeriodEnd` as alternatives.
**Warning signs:** Both Stripe and Convex period boundaries exist -- must pick one consistently.

## Code Examples

### Deriving ExtractionResultWithReview Type (TYPE-01)
```typescript
// In lib/extraction/types.ts (or directly in filtering.ts)
import type { Infer } from "convex/values";
import { extractionResultWithReviewValidator } from "@/convex/extraction/validators";

export type ExtractionResultWithReview = Infer<typeof extractionResultWithReviewValidator>;
```

### Using Derived Type in Export (TYPE-01)
```typescript
// In lib/extraction/export.ts -- replace `(result as any)?.correctedAnswer`
import type { ExtractionResultWithReview } from "./types";

// In PaperWithResults interface, change results type:
export interface PaperWithResults extends Doc<"extractionPapers"> {
  results: Array<ExtractionResultWithReview>;
}

// Then access fields directly -- no cast needed:
const answer = result?.correctedAnswer ?? result?.answer;
const citations = result?.citations ?? [];
const citationStatus = result?.citationStatus;
const reviewState = result?.reviewState;
```

### Stripe Customer Narrowing (TYPE-02)
```typescript
// Replace line 103 in convex/maintenance/internal.ts
// Before: (fresh.customer as any)?.id
// After:
const stripeCustomerId =
  typeof fresh.customer === "string"
    ? fresh.customer
    : fresh.customer?.id;
```

### Rate Limiter Union Validator (TYPE-03)
```typescript
// In convex/lib/rateLimit.ts
export const consume = internalMutation({
  args: {
    name: v.union(
      v.literal("start-extraction"),
      v.literal("api-key-save"),
      v.literal("checkout-session")
    ),
    key: v.string(),
    count: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await rateLimit(ctx, {
      name: args.name,  // No `as any` needed -- type matches
      key: args.key,
      count: args.count,
      throws: true,
    });
    return null;
  },
});
```

### Workflow ID Branded Cast (TYPE-04)
```typescript
// In convex/extraction/mutations.ts
import type { WorkflowId } from "@convex-dev/workflow";

// Replace: workflow.cancel(ctx, job.workflowId as any)
await workflow.cancel(ctx, job.workflowId as WorkflowId);
```

### TYPE-08 Upgrade Metadata from Convex
```typescript
// In convex/credits/actions.ts -- read from subRecord instead of Stripe metadata
const upgradeFromPlan = subRecord.pendingFromPlan;
const upgradeToPlan = subRecord.pendingToPlan;
const upgradeTimestamp = subRecord.pendingChangeTimestamp
  ? String(subRecord.pendingChangeTimestamp)
  : undefined;

// Period boundaries from Convex (or keep Stripe as source of truth)
const periodStartMs = subRecord.currentPeriodStart ?? 0;
const periodEndMs = subRecord.currentPeriodEnd ?? 0;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual TypeScript interfaces for Convex docs | `Infer<typeof validator>` derived types | Convex values stable | Types stay in sync with validators automatically |
| `as any` for Stripe expanded objects | `typeof` narrowing (union discrimination) | TypeScript 2.0+ | Proper type narrowing at zero runtime cost |
| `v.string()` for known string enums | `v.union(v.literal(...))` | Convex validators stable | Runtime + compile-time validation |
| Plain string for workflow IDs | Branded `WorkflowId` type | @convex-dev/workflow | Type-safe workflow operations |

## Open Questions

1. **TYPE-07: Is `convex/test.setup.ts` actually used by any test?**
   - What we know: The file exports a `modules` glob for `convex-test` module discovery. `vitest.config.ts` references `tests/setup.ts`, NOT `convex/test.setup.ts`. No `convex/**/*.test.ts` file imports it.
   - What's unclear: Whether `convex-test` auto-discovers it, or if it truly is orphaned.
   - Recommendation: Search all test files for imports of `test.setup`. If no imports found, delete it. The existing `convex-test` tests in `convex/extraction/cascade-delete.test.ts` work without it (they import `schema` directly).

2. **TYPE-08: Are all existing subscriptions migrated to Convex pending fields?**
   - What we know: The code has a TODO saying "once all existing Stripe metadata has been migrated." The Convex schema has `pendingFromPlan`, `pendingToPlan`, `pendingChangeTimestamp` fields. The `setPendingPlanChange` mutation writes these fields.
   - What's unclear: Whether ALL Stripe subscriptions with upgrade metadata have been migrated to the Convex fields.
   - Recommendation: Query Convex for subscriptions with non-null `pendingFromPlan` to verify migration completeness. If migration is incomplete, implement a dual-read: try Convex first, fall back to Stripe metadata.

3. **TYPE-02: Should the entire `fresh` variable be properly typed?**
   - What we know: Line 51 declares `const fresh: any = await getStripe().subscriptions.retrieve(...)`. This makes the ENTIRE subscription object untyped, not just the customer field.
   - What's unclear: Whether removing `: any` from `fresh` causes cascading type errors in the rest of the function.
   - Recommendation: Remove `: any` annotation. `getStripe().subscriptions.retrieve()` returns `Stripe.Subscription` which has proper types for all fields used (`status`, `items`, `customer`, `current_period_end`, etc.).

## Sources

### Primary (HIGH confidence)
- `convex/extraction/validators.ts` (lines 260-281) -- `extractionResultWithReviewValidator` already exists with all needed fields
- `node_modules/@convex-dev/workflow/dist/types.d.ts` -- `WorkflowId` is `string & { __isWorkflowId: true }`, `vWorkflowId` exported
- `node_modules/@convex-dev/workflow/dist/client/index.d.ts` (line 109) -- `cancel(ctx, workflowId: WorkflowId)` signature confirmed
- `node_modules/convex-helpers/server/rateLimit.d.ts` (line 119) -- `defineRateLimits` returns typed functions where `Name extends keyof Limits & string`
- `node_modules/convex/src/values/validator.ts` (line 476) -- `Infer<T>` type extracts TypeScript type from validator
- `convex/schema.ts` (lines 104-106) -- `pendingFromPlan`, `pendingToPlan`, `pendingChangeTimestamp` fields exist on subscriptions table

### Secondary (MEDIUM confidence)
- Codebase grep for import sites of `getProviderModel` -- 3 files reference it (including the planning docs)
- Codebase grep for `as any` patterns -- 7 casts in export.ts, 2 in filtering.ts, 1 in rateLimit.ts, 1 in mutations.ts, 2 in maintenance/internal.ts, 2 in credits/actions.ts

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed and in use
- Architecture: HIGH - patterns already established in the codebase; each fix follows existing conventions
- Pitfalls: HIGH - every pitfall identified from direct code inspection of actual source files

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable -- no external dependencies changing)
