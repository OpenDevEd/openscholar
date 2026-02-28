# Phase 21: Plan Enforcement & Feature Gating Tests - Research

**Researched:** 2026-02-28
**Domain:** Plan configuration contracts, tier enforcement, feature flag guards, subscription selection (pure function and env var isolation tests)
**Confidence:** HIGH

## Summary

Phase 21 tests five distinct functional areas: (1) `PLAN_CONFIG` shape contract - a static config object in `convex/lib/constants.ts` defining credit amounts and tier values for free/go/pro/enterprise, (2) plan utility functions (`getPlanTier`, `getFreeCreditCapForPlan`, `getPlanFromPriceId`) - all pure synchronous functions in the same file, (3) `requirePlanTier` - an async function in `convex/extraction/guard.ts` that queries subscriptions and throws `EXTRACTION_PLAN_REQUIRED` if tier is insufficient, (4) feature flag guards (`requireCreditsEnabled`, `requireCreditTopupsEnabled`, `requireSubscriptionsEnabled`) in `convex/lib/featureFlags.ts` - synchronous functions that check `process.env` and throw when features are disabled, (5) `selectCanonicalSubscription` - a pure function in `convex/subscriptions/lib/selectCanonicalSubscription.ts` implementing a 6-level priority selection.

**Key insight:** Most functions are pure (no DB, no async) and can be imported and tested directly. Only `requirePlanTier` needs ctx mocking (for `ctx.db.query`). Feature flag guards require `vi.resetModules()` for env var isolation since the functions read `process.env` at call time (not at module load time), so direct env mutation + reset works.

**Primary recommendation:** Two plans. Plan 01: PLAN_CONFIG shape + plan utility functions + feature flag guards (all pure/env-based). Plan 02: requirePlanTier tier enforcement + selectCanonicalSubscription priority ordering (ctx-mocking + pure priority logic).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation decisions are Claude's discretion.

### Claude's Discretion
- How to test PLAN_CONFIG correctness (snapshot vs explicit assertions per plan)
- How to isolate env vars for feature flag guard tests (vi.resetModules pattern)
- How to test requirePlanTier throw/pass behavior across tier combinations
- How to construct test data for selectCanonicalSubscription priority ordering
- Test organization (one file per function group vs grouped by concern)
- Edge case selection for unknown plan/priceId inputs

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLAN-01 | `PLAN_CONFIG` shape contract -- correct credit amounts and tier values for all four plans | Direct assertion on imported `PLAN_CONFIG` object properties |
| PLAN-02 | `getPlanTier`, `getFreeCreditCapForPlan`, `getPlanFromPriceId` return correct values | Pure function imports from `convex/lib/constants.ts`, parametric testing with `it.each` |
| PLAN-03 | `requirePlanTier` throws `EXTRACTION_PLAN_REQUIRED` when tier is below minimum | Mock `ctx.db.query` chain to return subscription list, uses `selectCanonicalSubscription` + `resolveEffectivePlan` + `getPlanTier` internally |
| PLAN-04 | Feature flag guards throw when disabled and pass when enabled | Direct env var manipulation with `vi.resetModules()` for isolation |
| PLAN-05 | `selectCanonicalSubscription` returns correct subscription with priority ordering | Pure function, test with constructed subscription arrays matching each priority level |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (project version) | Test runner + assertions | Already configured with multi-env support |
| vi.fn() / vi.mock() / vi.resetModules() | built-in | Mocking and module reset | Standard vitest patterns, used throughout all prior phases |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex/values (ConvexError) | project version | Error type checking | Verify EXTRACTION_PLAN_REQUIRED error from requirePlanTier |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct env mutation | vi.stubEnv() | vi.stubEnv is cleaner but process.env mutation + vi.resetModules is the pattern specified in success criteria |
| Snapshot tests for PLAN_CONFIG | Explicit assertions | Explicit assertions are more maintainable and document expected values |

## Architecture Patterns

### Source File Locations
```
convex/lib/constants.ts                          # PLAN_CONFIG, getPlanTier, getFreeCreditCapForPlan, getPlanFromPriceId
convex/lib/featureFlags.ts                       # requireCreditsEnabled, requireCreditTopupsEnabled, requireSubscriptionsEnabled
convex/lib/errors.ts                             # createError -> ConvexError<{code, message}>
convex/extraction/guard.ts                       # requirePlanTier, requireGoPlan, requireProPlan
convex/subscriptions/lib/selectCanonicalSubscription.ts  # selectCanonicalSubscription (pure function)
lib/billing/entitlements.ts                      # resolveEffectivePlan (used by requirePlanTier)
```

### Test File Location
```
tests/
  plan-config.test.ts                # PLAN-01: PLAN_CONFIG shape, PLAN-02: plan utilities, PLAN-04: feature flags
  plan-enforcement.test.ts           # PLAN-03: requirePlanTier, PLAN-05: selectCanonicalSubscription
```

### Pattern 1: Static Config Contract Testing (PLAN-01)
**What:** Assert PLAN_CONFIG has all four plans with correct credit amounts and tier values
**When to use:** Testing static config objects
**Example:**
```typescript
import { PLAN_CONFIG } from "../convex/lib/constants";

describe("PLAN_CONFIG shape contract", () => {
  it("has all four plans", () => {
    expect(Object.keys(PLAN_CONFIG)).toEqual(["free", "go", "pro", "enterprise"]);
  });

  it("free plan has tier 0 and 0 credits per month", () => {
    expect(PLAN_CONFIG.free).toEqual({
      creditsPerMonth: 0,
      tier: 0,
      freeCreditCap: 2000,
    });
  });
});
```

### Pattern 2: Parametric Pure Function Testing (PLAN-02)
**What:** Test plan utility functions with `it.each` for all plan types
**When to use:** Functions with small input domain that should be exhaustively tested
**Example:**
```typescript
import { getPlanTier, getFreeCreditCapForPlan, getPlanFromPriceId } from "../convex/lib/constants";

it.each([
  ["free", 0],
  ["go", 10],
  ["pro", 20],
  ["enterprise", 30],
] as const)("getPlanTier('%s') returns %d", (plan, expected) => {
  expect(getPlanTier(plan)).toBe(expected);
});
```

### Pattern 3: Env Var Isolation with vi.resetModules() (PLAN-04)
**What:** Test feature flag guards by manipulating process.env and re-importing modules
**When to use:** Functions that read process.env at call time
**Key observation:** The feature flag functions in `convex/lib/featureFlags.ts` read `process.env` at CALL TIME (not module load time) since they check `process.env.NEXT_PUBLIC_*` inside the function body. This means we can simply set `process.env` before each call without vi.resetModules(). However, the success criteria explicitly mentions `vi.resetModules()` for env var isolation, so we should use it for compliance.
**Example:**
```typescript
describe("requireCreditsEnabled", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_CREDITS_ENABLED;
  });

  it("passes when credits enabled (env not set)", async () => {
    const { requireCreditsEnabled } = await import("../convex/lib/featureFlags");
    expect(() => requireCreditsEnabled()).not.toThrow();
  });

  it("throws when credits disabled", async () => {
    process.env.NEXT_PUBLIC_CREDITS_ENABLED = "false";
    const { requireCreditsEnabled } = await import("../convex/lib/featureFlags");
    expect(() => requireCreditsEnabled()).toThrow("Credits feature is disabled");
  });
});
```

### Pattern 4: Ctx Mocking for requirePlanTier (PLAN-03)
**What:** Mock `ctx.db.query` chain to return subscription lists, verify throw/pass
**When to use:** Convex functions that query the database
**Example:**
```typescript
function createMockCtx(subscriptions: any[]) {
  return {
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            collect: vi.fn().mockResolvedValue(subscriptions),
          }),
        }),
      }),
    },
  };
}
```

### Pattern 5: Priority Selection Testing (PLAN-05)
**What:** Build subscription arrays where each priority level is testable
**When to use:** Functions with cascading priority logic
**Example:**
```typescript
function makeSub(overrides: Partial<any> = {}): any {
  return {
    _id: "sub1",
    _creationTime: 0,
    userId: "user1",
    plan: "free",
    status: "active",
    creditsPerMonth: 0,
    seats: 1,
    ...overrides,
  };
}

it("prioritizes non-canceled paid with Stripe ID over all others", () => {
  const subs = [
    makeSub({ plan: "free", status: "active" }),
    makeSub({ plan: "go", status: "active", stripeSubscriptionId: "sub_123" }),
  ];
  expect(selectCanonicalSubscription(subs)).toBe(subs[1]);
});
```

### Anti-Patterns to Avoid
- **Modifying production source files:** Phase scope is tests-only
- **Snapshot testing PLAN_CONFIG:** Brittle -- explicit assertions are better
- **Testing getPlanFromPriceId with real Stripe price IDs:** Price IDs come from env vars that default to empty strings; test with custom values via env setup
- **Forgetting to clean up process.env:** Always delete env vars in afterEach to prevent test pollution

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subscription mock objects | Inline object literals everywhere | Shared `makeSub(overrides)` helper | DRY, consistent test data |
| ConvexError assertion | Custom matchers | try/catch + check `.data.code` | Standard pattern from Phase 20 |
| Env cleanup | Manual per-test | `afterEach(() => { vi.resetModules(); delete process.env.X; })` | Prevents cross-test pollution |

## Common Pitfalls

### Pitfall 1: getPlanFromPriceId Depends on Env Vars
**What goes wrong:** `getPlanFromPriceId` compares against `GO_PRICE_ID`, `PRO_PRICE_ID`, `ENTERPRISE_PRICE_ID` which are set at MODULE LOAD TIME from `process.env`
**Why it happens:** `const GO_PRICE_ID = process.env.STRIPE_GO_PRICE_ID || ""` is evaluated when the module is first imported
**How to avoid:** Use `vi.resetModules()` + dynamic `import()` to re-evaluate the module with different env vars, OR test the fallback paths (the function has `priceId.includes("enterprise")` and `priceId.includes("pro")` fallbacks that don't depend on env vars)
**Warning signs:** Tests pass locally but fail in CI where env vars differ

### Pitfall 2: selectCanonicalSubscription Requires Correct Type Shape
**What goes wrong:** TypeScript errors when constructing test subscription objects
**Why it happens:** `selectCanonicalSubscription` expects `Doc<"subscriptions">` which includes `_id`, `_creationTime`, and all schema fields
**How to avoid:** Use `as any` cast on test objects, or build a complete mock factory with all required fields
**Warning signs:** TypeScript compilation errors in test file

### Pitfall 3: requirePlanTier Query Chain
**What goes wrong:** Mock doesn't match the actual query chain shape
**Why it happens:** `requirePlanTier` uses `.query("subscriptions").withIndex("by_user", q => ...).order("desc").collect()` -- a 4-step chain
**How to avoid:** Mock all 4 steps: `query -> withIndex -> order -> collect`
**Warning signs:** TypeError: undefined is not a function

### Pitfall 4: Feature Flag Functions Read Env at Call Time
**What goes wrong:** Tests may seem to need vi.resetModules() but env vars can be set directly
**Why it happens:** The feature flag functions check `process.env.NEXT_PUBLIC_*` inside the function body, not at module load
**How to avoid:** While direct env mutation works, use vi.resetModules() + dynamic import per the success criteria requirement. This also future-proofs against refactors that might cache env values.
**Warning signs:** Tests pass without vi.resetModules() but success criteria demands it

### Pitfall 5: PLAN_CONFIG freeCreditCap for Free Plan
**What goes wrong:** Expecting `freeCreditCap: 2000` as a magic number
**Why it happens:** `PLAN_CONFIG.free.freeCreditCap` is set to `FREE_SIGNUP_CREDIT_GRANT` which equals 2000
**How to avoid:** Import `FREE_SIGNUP_CREDIT_GRANT` and assert `PLAN_CONFIG.free.freeCreditCap === FREE_SIGNUP_CREDIT_GRANT`
**Warning signs:** Test breaks if constant value changes

## Open Questions

None -- all functions are fully inspected and patterns are well-established from prior phases.

## Sources

### Primary (HIGH confidence)
- `convex/lib/constants.ts` -- PLAN_CONFIG, getPlanTier, getFreeCreditCapForPlan, getPlanFromPriceId, price ID constants
- `convex/lib/featureFlags.ts` -- requireCreditsEnabled, requireCreditTopupsEnabled, requireSubscriptionsEnabled
- `convex/extraction/guard.ts` -- requirePlanTier, requireGoPlan, requireProPlan
- `convex/subscriptions/lib/selectCanonicalSubscription.ts` -- selectCanonicalSubscription with 6-level priority
- `lib/billing/entitlements.ts` -- resolveEffectivePlan used by requirePlanTier
- `convex/lib/errors.ts` -- createError/ConvexError pattern

### Secondary (MEDIUM confidence)
- Prior phase test patterns (tests/auth-state-machine.test.ts, tests/ai-cost.test.ts) -- vi.mock and vi.fn() patterns
- Phase 20 research -- ctx mocking pattern for Convex functions

## Validation Architecture

### Test Coverage Matrix

| Requirement | Functions Tested | Test Strategy | Expected Tests |
|-------------|-----------------|---------------|----------------|
| PLAN-01 | PLAN_CONFIG | Static assertion on all 4 plans | 5 (shape + 4 plans) |
| PLAN-02 | getPlanTier, getFreeCreditCapForPlan, getPlanFromPriceId | Parametric it.each for all plans + edge cases | 8-10 |
| PLAN-03 | requirePlanTier | Ctx mock with subscription lists at different tiers | 4-5 |
| PLAN-04 | requireCreditsEnabled, requireCreditTopupsEnabled, requireSubscriptionsEnabled | vi.resetModules() + env var toggle | 6 (2 per guard) |
| PLAN-05 | selectCanonicalSubscription | Constructed subscription arrays for each priority | 7-8 |

### Risk Assessment
- **LOW risk:** All target functions have clear contracts and small input domains
- **MEDIUM risk:** getPlanFromPriceId env var dependency requires careful module reset
- **NO risk:** selectCanonicalSubscription is a pure function with no external dependencies

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - vitest already configured, patterns well-established across 7 completed phases
- Architecture: HIGH - all source files inspected, function signatures and logic fully understood
- Pitfalls: HIGH - identified from direct code inspection (env var timing, query chain shape, type requirements)

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- testing pure functions against stable codebase)
