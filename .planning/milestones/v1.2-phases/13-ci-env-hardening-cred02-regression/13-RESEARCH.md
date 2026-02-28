# Phase 13: CI Env Hardening & CRED-02 Regression Test - Research

**Researched:** 2026-02-28
**Domain:** GitHub Actions CI environment configuration, Playwright E2E test design
**Confidence:** HIGH

## Summary

Phase 13 closes two non-blocking tech debt items identified in the v1.2 milestone audit: `CLERK_PUBLISHABLE_KEY_ALIAS` (CI env fragility) and `CRED-02_IMPLICIT_COVERAGE` (missing dedicated credit-grant regression test). Both items are well-scoped, low-risk, and build directly on infrastructure established in Phases 7-12.

**Item 1 (CI env hardening):** The three billing CI jobs (`billing-live`, `billing-live-extended`, `billing-live-extended-nightly`) set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` but NOT the explicit `CLERK_PUBLISHABLE_KEY`. This works today because `playwright.config.ts` (line 27-30) and `global.setup.ts` (`normalizeClerkTestingEnv`) both contain fallback normalizers that copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to `CLERK_PUBLISHABLE_KEY`. If either normalizer is removed or modified, billing E2E tests would break silently. The `e2e-auth` job already sets the explicit alias (ci.yml line 42). The fix is a single line addition to each of the three billing job env blocks.

**Item 2 (CRED-02 regression test):** CRED-02 (monthly subscription credit grants: 3,000 for Go, 15,000 for Pro) has no dedicated test. Coverage is implicit within `subscribe.spec.ts`, which asserts `credits >= 5,000` (Go) and `credits >= 17,000` (Pro). These assertions include the 2,000 free signup credits, and the `>=` comparison means the test would pass even if credit grants were wrong (e.g., a Go user with only free credits of 5,000+ from a previous test run). A dedicated test should assert the credit grant amounts independently with tighter bounds.

**Primary recommendation:** Add `CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}` to all three billing CI job env blocks, and create a new `credit-grants.spec.ts` (or add a `describe` block to `credits.spec.ts`) with two tests that subscribe to Go and Pro respectively and assert credit balance with exact expected amounts (5,000 and 17,000) rather than `>=` comparisons.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRED-02 (hardening) | User receives correct monthly credits on subscription (3,000 Go / 15,000 Pro) | Dedicated regression test asserting exact credit amounts independently of subscribe happy-path tests. Uses existing `createSubscriptionBypass`, `WebhookWaiter.waitForCreditBalance`, and `BillingPage.getCreditBalance` infrastructure from Phases 7-8. |
| INFRA-02 (hardening) | Fresh Clerk test user created and deleted per test scenario via `@clerk/backend` API | Adding explicit `CLERK_PUBLISHABLE_KEY` to billing CI env blocks removes dependency on normalizer fallback in `playwright.config.ts` and `global.setup.ts`. Existing `e2e-auth` job pattern at ci.yml line 42 provides the exact template. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | `^1.58.2` (installed) | E2E test framework | Already used in all billing specs; billing project configured in `playwright.config.ts` |
| `@clerk/testing` | (installed) | Clerk test mode integration | Already used by `global.setup.ts` and billing fixtures for `clerkSetup()` and `clerk.signIn()` |
| `stripe` | `v20.3.0` (installed) | Stripe API client | Already used by `stripe-helpers.ts` for checkout-bypass pattern |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@clerk/backend` | (installed) | Server-side Clerk user management | Already used by billing fixture for per-test user creation/deletion |
| GitHub Actions | N/A | CI orchestration | Target platform for env var additions |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `credit-grants.spec.ts` file | Add tests inside existing `credits.spec.ts` | Separate file provides clearer CRED-02 semantic isolation; however, adding inside `credits.spec.ts` under a new `describe` block is simpler and keeps credit-related tests co-located. Either approach satisfies the requirement. |
| Exact credit balance assertion (`toBe(5_000)`) | Threshold assertion (`toBeGreaterThanOrEqual(5_000)`) | Exact assertion is more precise but requires understanding that total = free (2,000) + plan grant (3,000). Using `toBe` is preferred for a regression test since any drift should be caught. |

**Installation:** None required. All dependencies already present.

## Architecture Patterns

### Current CI env block pattern (billing-live, MISSING explicit key)

```yaml
# ci.yml billing-live job env block (current state)
env:
  # ... Stripe/Convex vars ...
  CLERK_SECRET_KEY: ${{ secrets.CLERK_SECRET_KEY }}
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
  # MISSING: CLERK_PUBLISHABLE_KEY <-- the gap
```

### Reference pattern (e2e-auth job, HAS explicit key)

```yaml
# ci.yml e2e-auth job env block (reference pattern at lines 41-42)
env:
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
  CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
```

### Target CI env block pattern (all three billing jobs)

```yaml
env:
  # ... existing vars unchanged ...
  CLERK_SECRET_KEY: ${{ secrets.CLERK_SECRET_KEY }}
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
  CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}  # NEW
```

### Pattern: CRED-02 dedicated regression test

The test should follow the exact same pattern as the existing subscribe tests in `subscribe.spec.ts` but with tighter, semantically-named assertions focused on credit grant amounts. The key difference from the subscribe tests is the assertion style:

**Current implicit coverage (subscribe.spec.ts):**
```typescript
// Asserts >= 5,000 (loose, bundled with subscribe happy-path)
const credits = await billingPage.getCreditBalance();
expect(credits).toBeGreaterThanOrEqual(5_000); // 2,000 free + 3,000 Go
```

**Dedicated CRED-02 regression test (target):**
```typescript
// Asserts exact expected total (tight, dedicated credit-grant semantic)
const credits = await billingPage.getCreditBalance();
expect(credits).toBe(5_000); // 2,000 free signup + 3,000 Go monthly grant
```

The test uses the same infrastructure: `createSubscriptionBypass` for checkout-bypass, `webhookWaiter.waitForCreditBalance` for convergence, `billingPage.getCreditBalance` for UI assertion.

### Where to put the dedicated test

Two valid options:

1. **New `credit-grants.spec.ts` file** in `e2e/billing/specs/` -- clearest semantic separation, makes CRED-02 coverage immediately identifiable.

2. **New `describe("CRED-02: Monthly Credit Grants")` block** in existing `credits.spec.ts` -- keeps all credit tests co-located, avoids adding a new file.

**Recommendation:** Option 1 (new file) for clearest traceability. The audit specifically calls out that CRED-02 has "no dedicated test" and "no test with explicit CRED-02 semantic". A separate file named `credit-grants.spec.ts` makes the coverage unambiguous.

### Test structure for CRED-02

```
credit-grants.spec.ts
  describe("CRED-02: Monthly Credit Grants")
    test("Go subscription grants 3,000 monthly credits")
      1. createSubscriptionBypass (Go price)
      2. webhookWaiter.waitForSubscriptionPlan("go")
      3. webhookWaiter.waitForCreditBalance(total => total >= 5_000)
      4. billingPage.goto()
      5. Assert billingPage.getCreditBalance() === 5_000  (2,000 free + 3,000 Go)
      6. cleanupStripeCustomer

    test("Pro subscription grants 15,000 monthly credits")
      1. createSubscriptionBypass (Pro price)
      2. webhookWaiter.waitForSubscriptionPlan("pro")
      3. webhookWaiter.waitForCreditBalance(total => total >= 17_000)
      4. billingPage.goto()
      5. Assert billingPage.getCreditBalance() === 17_000  (2,000 free + 15,000 Pro)
      6. cleanupStripeCustomer
```

### Anti-Patterns to Avoid

- **Don't modify the existing subscribe.spec.ts tests:** The subscribe tests are about the subscription happy-path (SUB-01, SUB-02). Tightening their credit assertions would conflate two requirements. Keep them as-is.
- **Don't use `>=` for the CRED-02 regression test:** The whole point of a dedicated credit-grant test is to catch drift. Use `toBe` for exact match.
- **Don't add CLERK_PUBLISHABLE_KEY to the validate-secrets step:** The normalizer fallback still works; adding to validation would make it a hard failure instead of a hardening measure. Only add the env var itself.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subscription creation in tests | Custom API calls to Stripe | `createSubscriptionBypass()` from `stripe-helpers.ts` | Already handles customer creation, payment method, metadata, and returns all needed IDs |
| Waiting for webhook processing | Custom polling loops | `WebhookWaiter` from `webhook-waiter.ts` | Already has `waitForSubscriptionPlan()` and `waitForCreditBalance()` with configurable timeout |
| UI credit balance reading | Raw page selectors | `BillingPage.getCreditBalance()` from `billing-page.ts` | Already handles text parsing, non-digit stripping, and missing-element edge case |
| Test user lifecycle | Manual Clerk API calls | `clerkUser` fixture from `fixtures.ts` | Already creates unique user, signs in, navigates to billing, cleans up on teardown |
| Stripe cleanup | Manual subscription cancellation | `cleanupStripeCustomer()` from `stripe-helpers.ts` | Already cancels all subscriptions and deletes customer |

**Key insight:** Phase 13 requires ZERO new infrastructure. Every building block needed for the CRED-02 test already exists from Phases 7-9. The test is essentially a recombination of existing primitives with tighter assertions.

## Common Pitfalls

### Pitfall 1: Placing CLERK_PUBLISHABLE_KEY in wrong position within env block

**What goes wrong:** Adding the env var after the Clerk block but separated from `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, making it hard to see they are related.
**Why it happens:** YAML env blocks have no enforced grouping; it's easy to append at the end.
**How to avoid:** Place `CLERK_PUBLISHABLE_KEY` immediately after `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in each env block, matching the pattern used in the `e2e-auth` job (ci.yml lines 41-42).
**Warning signs:** Code review shows the two Clerk publishable key vars separated by unrelated vars.

### Pitfall 2: Using toBe for credit assertions when free credits may vary

**What goes wrong:** If the free signup credit grant amount changes (currently 2,000 in `FREE_SIGNUP_CREDIT_GRANT`), the exact `toBe(5_000)` assertion breaks.
**Why it happens:** The expected total (5,000) is hardcoded as `FREE_SIGNUP_CREDIT_GRANT (2,000) + Go monthly (3,000)`.
**How to avoid:** This is actually desirable for a regression test -- any change to credit constants should trigger test failure so it can be reviewed. Document the formula in a comment: `// 2,000 free signup + 3,000 Go monthly grant = 5,000 total`.
**Warning signs:** None -- this is the correct behavior for a regression test.

### Pitfall 3: Race condition between subscribe and credit grant webhooks

**What goes wrong:** The test asserts credit balance before the `invoice.paid` webhook (which triggers the monthly credit grant) has been processed by Convex.
**Why it happens:** Stripe sends multiple webhooks (`customer.subscription.created`, `invoice.payment_succeeded`, `invoice.paid`) and Convex processes them asynchronously. The credit grant happens on `invoice.paid`.
**How to avoid:** Use `webhookWaiter.waitForCreditBalance()` with the full expected amount before navigating to the billing page. This is already the pattern used in `subscribe.spec.ts` and must be replicated in the new test.
**Warning signs:** Flaky test that sometimes sees only 2,000 (free credits) instead of 5,000.

### Pitfall 4: Forgetting to update billing-nightly.yml

**What goes wrong:** The `CLERK_PUBLISHABLE_KEY` env var is added to `billing-live` and `billing-live-extended` in `ci.yml` but not to `billing-live-extended-nightly` in `billing-nightly.yml`.
**Why it happens:** The three jobs are defined across two files (`ci.yml` and `billing-nightly.yml`).
**How to avoid:** Check both workflow files. There are exactly three places to add the env var -- one in `billing-nightly.yml` and two in `ci.yml`.
**Warning signs:** `grep -c 'CLERK_PUBLISHABLE_KEY' .github/workflows/billing-nightly.yml` returns 1 instead of 2 (NEXT_PUBLIC_ + explicit).

### Pitfall 5: Creating a test that duplicates subscribe.spec.ts instead of being independent

**What goes wrong:** The CRED-02 test becomes a copy-paste of the subscribe test, asserting plan name and status badge alongside credits, making it redundant rather than complementary.
**Why it happens:** Following the subscribe test pattern too literally.
**How to avoid:** The CRED-02 test should focus ONLY on credit balance assertions. It may verify the subscription plan arrived (via `webhookWaiter.waitForSubscriptionPlan`) as a precondition, but its primary assertions should be about credit amounts. Skip plan name UI assertions, pricing page badge checks, etc.
**Warning signs:** The test has more than 2-3 `expect` statements beyond the credit balance assertion.

## Code Examples

### CI env var addition (verified pattern from e2e-auth job)

```yaml
# Source: .github/workflows/ci.yml lines 41-42 (e2e-auth job)
# This exact pattern should be replicated in all three billing job env blocks
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
CLERK_PUBLISHABLE_KEY: ${{ secrets.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
```

### CRED-02 Go credit grant test (based on subscribe.spec.ts pattern)

```typescript
// Source: Adapted from e2e/billing/specs/subscribe.spec.ts (Phase 8)
import { test, expect } from "../fixtures";
import {
  createSubscriptionBypass,
  cleanupStripeCustomer,
} from "../stripe-helpers";

test.describe("CRED-02: Monthly Credit Grants", () => {
  test("Go subscription grants 3,000 monthly credits (total 5,000)", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // 1. Subscribe via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: goPriceId,
    });

    // 2. Wait for subscription and credit grant webhooks
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance((total) => total >= 5_000);

    // 3. Assert exact credit balance on billing page
    await billingPage.goto();
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBe(5_000); // 2,000 free signup + 3,000 Go monthly grant

    // 4. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });

  test("Pro subscription grants 15,000 monthly credits (total 17,000)", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
  }) => {
    const proPriceId = process.env.STRIPE_PRO_PRICE_ID!;

    // 1. Subscribe via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: proPriceId,
    });

    // 2. Wait for subscription and credit grant webhooks
    await webhookWaiter.waitForSubscriptionPlan("pro");
    await webhookWaiter.waitForCreditBalance((total) => total >= 17_000);

    // 3. Assert exact credit balance on billing page
    await billingPage.goto();
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBe(17_000); // 2,000 free signup + 15,000 Pro monthly grant

    // 4. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
```

### Credit amounts reference (from Convex constants)

```typescript
// Source: convex/lib/constants.ts lines 13-18
export const FREE_SIGNUP_CREDIT_GRANT = 2_000;

export const PLAN_CONFIG = {
  free: { creditsPerMonth: 0, tier: 0, freeCreditCap: FREE_SIGNUP_CREDIT_GRANT },
  go: { creditsPerMonth: 3_000, tier: 10, freeCreditCap: 6_000 },
  pro: { creditsPerMonth: 15_000, tier: 20, freeCreditCap: 30_000 },
  enterprise: { creditsPerMonth: 150_000, tier: 30, freeCreditCap: 300_000 },
} as const;
```

Expected totals after initial subscription:
- Go: `FREE_SIGNUP_CREDIT_GRANT (2,000) + creditsPerMonth (3,000) = 5,000`
- Pro: `FREE_SIGNUP_CREDIT_GRANT (2,000) + creditsPerMonth (15,000) = 17,000`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Rely on normalizer fallback for CLERK_PUBLISHABLE_KEY | Set both NEXT_PUBLIC_ and non-prefixed explicitly in CI | Phase 13 (this phase) | Eliminates fragile dependency on `playwright.config.ts` and `global.setup.ts` normalizers |
| Implicit CRED-02 coverage within SUB-01/SUB-02 subscribe tests | Dedicated CRED-02 regression test with exact assertions | Phase 13 (this phase) | Catches credit grant regressions independently of subscription flow changes |

## Open Questions

1. **Should the CRED-02 test also validate `creditsPerMonth` on the WebhookWaiter snapshot?**
   - What we know: The `BillingSnapshot` type includes `creditsPerMonth` on subscription records. The `subscribe.spec.ts` tests only check UI credit balance.
   - What's unclear: Whether the phase success criteria require backend-level assertions or UI-only.
   - Recommendation: Stick with UI-level assertions only. The success criteria states "A dedicated test asserts monthly credit grants (3,000 for Go, 15,000 for Pro)" which is satisfied by asserting the correct balance on the billing page. Backend assertions are in the domain of the live-billing Vitest suite.

2. **Should the CRED-02 test live in its own file or inside `credits.spec.ts`?**
   - What we know: The audit specifically notes "No test with explicit CRED-02 semantic." The current `credits.spec.ts` handles CRED-01 (signup credits), CRED-03 (pro-rata), CRED-04 (topup), and CRED-05 (cap banner).
   - What's unclear: Whether co-location or separation better serves the audit finding.
   - Recommendation: New file `credit-grants.spec.ts` for clearest CRED-02 traceability. The describe block should be named to explicitly reference CRED-02.

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection:
  - `.github/workflows/ci.yml` -- current billing job env blocks (lines 113-130, 199-216), e2e-auth job env block (lines 40-51) showing the explicit CLERK_PUBLISHABLE_KEY pattern
  - `.github/workflows/billing-nightly.yml` -- nightly job env block (lines 15-32) confirming same gap
  - `playwright.config.ts` -- CLERK_PUBLISHABLE_KEY normalizer fallback (lines 26-31)
  - `e2e/global.setup.ts` -- `normalizeClerkTestingEnv()` fallback (lines 27-39)
  - `e2e/billing/specs/subscribe.spec.ts` -- current implicit CRED-02 coverage with `>=` assertions
  - `e2e/billing/specs/credits.spec.ts` -- existing credit test structure
  - `e2e/billing/stripe-helpers.ts` -- `createSubscriptionBypass` and `cleanupStripeCustomer` APIs
  - `e2e/billing/webhook-waiter.ts` -- `waitForSubscriptionPlan` and `waitForCreditBalance` APIs
  - `e2e/billing/pages/billing-page.ts` -- `getCreditBalance()` method
  - `convex/lib/constants.ts` -- `PLAN_CONFIG` with `creditsPerMonth` values (3,000 Go, 15,000 Pro) and `FREE_SIGNUP_CREDIT_GRANT` (2,000)

- Project planning documents:
  - `.planning/v1.2-MILESTONE-AUDIT.md` -- identifies `CLERK_PUBLISHABLE_KEY_ALIAS` and `CRED-02_IMPLICIT_COVERAGE` gaps
  - `.planning/ROADMAP.md` -- Phase 13 success criteria
  - `.planning/REQUIREMENTS.md` -- CRED-02 and INFRA-02 requirement definitions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and used; zero new dependencies
- Architecture: HIGH - Patterns directly verified from existing codebase; new test is a recombination of existing infrastructure
- Pitfalls: HIGH - Race conditions and CI env patterns verified from Phase 7-12 implementation history

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable CI/test config -- unlikely to change)
