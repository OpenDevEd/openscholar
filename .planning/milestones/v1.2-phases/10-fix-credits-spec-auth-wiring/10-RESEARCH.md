# Phase 10: Fix Credits Spec Authentication Wiring - Research

**Researched:** 2026-02-28
**Domain:** Playwright fixture dependency wiring / E2E test authentication
**Confidence:** HIGH

## Summary

Phase 10 is a surgical, single-file bug fix. The v1.2 milestone audit identified two tests in `e2e/billing/specs/credits.spec.ts` that fail because they omit `clerkUser` from their fixture destructuring. In Playwright's fixture system, `billingPage` depends only on `{ page }` -- it does not implicitly pull in `clerkUser`. Without `clerkUser` in the destructure list, the `clerkUser` fixture never runs, no Clerk session is created, and `billingPage.goto()` navigates to `/settings/billing` unauthenticated. The billing page then renders a perpetual loading skeleton (because `creditBalanceQuery.isDeferred` stays `true` without a Clerk identity), and `goto()` times out after 30 seconds waiting for `billing-plan-name` to become visible.

The fix is identical for both broken tests: change `async ({ billingPage })` to `async ({ clerkUser, billingPage })`. Playwright's fixture system is lazy but dependency-driven -- merely listing `clerkUser` in the destructure forces the fixture to execute and establish the authenticated session before `billingPage.goto()` runs. No changes to the fixture definitions, the BillingPage POM, or any other file are required.

Two other credits tests in the same file (`"upgrade Go to Pro grants pro-rata credits"` and `"credit topup increases balance"`) are already correctly wired -- they destructure `{ clerkUser, stripeClient, webhookWaiter, billingPage }` and serve as the canonical reference pattern for what fixed tests look like.

**Primary recommendation:** Add `clerkUser` to fixture destructuring on lines 9 and 131 of `e2e/billing/specs/credits.spec.ts`. That is the entire phase.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CRED-01 | User receives free signup credits on account creation and sees balance on billing page | Fix at line 9: adding `clerkUser` establishes authenticated session so `getCreditBalance()` resolves to 2,000 |
| CRED-05 | Free-tier user at credit cap sees cap banner on billing page | Fix at line 131: adding `clerkUser` establishes authenticated session so `creditCapBanner` becomes visible |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Playwright | (project-configured) | E2E test runner and fixture system | Already installed and configured via billing project |
| `@clerk/testing/playwright` | (project-configured) | Clerk sign-in helper for Playwright | Already used in `clerkUser` fixture in `fixtures.ts` |
| `@clerk/backend` | (project-configured) | Clerk Admin API for user lifecycle | Already used in `clerkUser` fixture in `fixtures.ts` |

### Supporting

No additional libraries required. This is a one-line-per-test change within the existing stack.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Adding `clerkUser` to destructure | Restructuring fixture dependencies | No restructuring needed -- Playwright's lazy fixture execution makes the destructure the only required change |

**Installation:** None required.

## Architecture Patterns

### How Playwright Fixture Dependency Resolution Works

**What:** Playwright resolves fixtures lazily based on what is destructured in each test function signature. A fixture only executes if it appears in the test's parameter list (or is a dependency of one that does).

**Critical insight for this phase:** `billingPage` depends only on `{ page }` (see `fixtures.ts` line 179). It does NOT depend on `clerkUser`. Therefore, if a test only destructures `{ billingPage }`, Playwright runs only `page` and `billingPage` -- the `clerkUser` fixture (which signs in via Clerk) never executes. The browser session remains unauthenticated.

```typescript
// fixtures.ts lines 179-181 -- billingPage only depends on { page }
billingPage: async ({ page }, use) => {
  await use(new BillingPage(page));
},

// fixtures.ts lines 51-101 -- clerkUser depends on { page } and performs sign-in
clerkUser: async ({ page }, use) => {
  // ... creates Clerk user, calls clerk.signIn(), navigates to trigger Convex user creation
  await use({ id: user.id, email, password });
  // ... teardown
},
```

**The correct pattern** (from the two working credits tests and all other billing specs):

```typescript
// CORRECT: clerkUser in destructure forces sign-in before billingPage.goto()
test("my test", async ({ clerkUser, billingPage }) => {
  await billingPage.goto(); // page is now authenticated
  // ...
});

// BROKEN (current state of lines 9 and 131):
test("free user sees 2,000 signup credits on billing page", async ({ billingPage }) => {
  await billingPage.goto(); // unauthenticated -- times out after 30s
  // ...
});
```

### Why `clerkUser` Is Not "Used" Even When Added

When `clerkUser` is added to the destructure but the test body does not reference `clerkUser` directly, that is intentional and correct. The fixture's side-effect (signing in to the browser session via `clerk.signIn()`) is what matters, not its return value. All other billing specs that only care about subscription state use `clerkUser` this way.

### Recommended File Structure (No Change)

```
e2e/billing/
├── fixtures.ts              # No changes
├── stripe-helpers.ts        # No changes
├── webhook-waiter.ts        # No changes
├── pages/
│   ├── billing-page.ts      # No changes
│   └── pricing-page.ts      # No changes
└── specs/
    ├── credits.spec.ts      # ONLY file to change (lines 9 and 131)
    ├── subscribe.spec.ts    # No changes
    ├── upgrade.spec.ts      # No changes
    ├── downgrade.spec.ts    # No changes
    └── cancel.spec.ts       # No changes
```

### Anti-Patterns to Avoid

- **Modifying fixture definitions:** The `billingPage` fixture does not need `clerkUser` as a dependency. Adding it there would force all tests (including those that legitimately skip auth setup) to create a Clerk user. The correct scoping is per-test via destructuring.
- **Adding a `beforeEach` to sign in:** The fixture system already handles this cleanly. A `beforeEach` would duplicate the logic and break teardown isolation.
- **Adding `webhookWaiter` unnecessarily:** CRED-01 and CRED-05 assert UI state only (credit balance, cap banner). They do not interact with Stripe and do not need `webhookWaiter`. Adding it would require Convex ID discovery overhead for no benefit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Forcing authenticated session | Custom auth setup in `beforeEach` | `clerkUser` fixture already handles sign-in and teardown | Fixture already tested, includes cleanup, handles Convex user creation side-effect |
| Verifying the fix works | Manual browser check | Run the two spec tests directly with `npx playwright test credits.spec.ts --grep "signup credits|cap banner"` | Deterministic, fast, already-wired test infrastructure |

**Key insight:** The fixture system's dependency graph already does everything needed. The only gap was the test not declaring the dependency it needed.

## Common Pitfalls

### Pitfall 1: Thinking Only One Test Is Broken

**What goes wrong:** Fixing line 9 (CRED-01) but missing line 131 (CRED-05) because the two tests are separated by two passing tests in the file.

**Why it happens:** The file has four tests; the broken ones are first and last, with the two working tests in between. A quick scan might not catch the second broken fixture.

**How to avoid:** Fix both tests in one edit pass. The audit is explicit: both lines 9 and 131 need the same change.

**Warning signs:** After fixing, running only the first test passes while the last test still times out.

### Pitfall 2: Assuming `clerkUser` Must Be Used in the Test Body

**What goes wrong:** Removing `clerkUser` from the destructure after noticing the test body doesn't reference it, thinking it's dead code.

**Why it happens:** Looks like an unused variable lint warning.

**How to avoid:** The ESLint config for tests should allow unused destructured fixture parameters (they exist for side effects). TypeScript won't error because the fixture system accepts any subset of the defined fixtures. If a lint warning appears for `clerkUser` being declared but not used, prefix with `_clerkUser` -- but check whether other specs follow this convention first (they don't: `cancel.spec.ts` line 9 destructures `clerkUser` without using it in the body, with no underscore prefix, and passes).

### Pitfall 3: NEXT_PUBLIC_CREDITS_ENABLED Environment Variable

**What goes wrong:** CRED-05 (`creditCapBanner`) passes locally but fails in CI because the credit cap banner is conditionally rendered based on `NEXT_PUBLIC_CREDITS_ENABLED !== 'false'`.

**Why it happens:** The tech debt from the v1.2 audit notes this secondary risk for CRED-05. If CI sets `NEXT_PUBLIC_CREDITS_ENABLED=false`, the banner will never render regardless of authenticated state.

**How to avoid:** Confirm in CI environment that `NEXT_PUBLIC_CREDITS_ENABLED` is absent or set to a non-`false` value before treating a CRED-05 failure as an auth-wiring problem.

**Warning signs:** CRED-01 (signup credits) passes after the fix but CRED-05 (cap banner) still fails.

## Code Examples

### The Two Lines That Need Changing

```typescript
// Source: e2e/billing/specs/credits.spec.ts

// --- CRED-01: Line 9 (BEFORE) ---
test("free user sees 2,000 signup credits on billing page", async ({
  billingPage,
}) => {

// --- CRED-01: Line 9 (AFTER) ---
test("free user sees 2,000 signup credits on billing page", async ({
  clerkUser,
  billingPage,
}) => {

// --- CRED-05: Line 131 (BEFORE) ---
test("free user at credit cap sees cap banner", async ({ billingPage }) => {

// --- CRED-05: Line 131 (AFTER) ---
test("free user at credit cap sees cap banner", async ({
  clerkUser,
  billingPage,
}) => {
```

### Reference Pattern (Working Tests in Same File)

```typescript
// Source: e2e/billing/specs/credits.spec.ts lines 18-23
// These two tests already correctly wire clerkUser:
test("upgrade Go to Pro grants pro-rata credits", async ({
  clerkUser,
  stripeClient,
  webhookWaiter,
  billingPage,
  pricingPage,
}) => {

test("credit topup increases balance", async ({
  clerkUser,
  stripeClient,
  webhookWaiter,
  billingPage,
}) => {
```

### Reference Pattern (cancel.spec.ts -- minimal auth-only wiring)

```typescript
// Source: e2e/billing/specs/cancel.spec.ts lines 8-13
// cancel.spec.ts uses clerkUser but the test is about Stripe state, not just auth
test("cancel subscription shows 'Expires on' instead of 'Renews on'", async ({
  clerkUser,
  stripeClient,
  webhookWaiter,
  billingPage,
}) => {
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tests without `clerkUser` | Tests with `clerkUser` in destructure | This phase (Phase 10) | Auth session established; billing page loads content instead of skeleton |

**Deprecated/outdated:**
- The broken fixture signature `async ({ billingPage })` on CRED-01 and CRED-05 tests: replaced by `async ({ clerkUser, billingPage })`.

## Open Questions

1. **Does `clerkUser` need to be referenced in the CRED-01 and CRED-05 test bodies?**
   - What we know: The other working tests that only need auth (not Stripe calls) still declare `clerkUser` in the destructure and leave it unused in the body. ESLint does not flag this in the existing codebase (cancel.spec.ts is proof).
   - What's unclear: Whether any future lint rule addition might flag the unused variable.
   - Recommendation: Follow the existing convention -- declare `clerkUser` in destructure without using it in the body. No underscore prefix needed unless lint complains.

2. **Should `clerkUser` be `_clerkUser` to signal intentional non-use?**
   - What we know: None of the existing specs use the underscore prefix convention.
   - What's unclear: Whether the project's ESLint config has `no-unused-vars` with `argsIgnorePattern`.
   - Recommendation: Use `clerkUser` (no underscore) to match all other specs consistently.

## Sources

### Primary (HIGH confidence)

- `e2e/billing/fixtures.ts` -- Fixture definitions confirming `billingPage` depends only on `{ page }`, not `clerkUser`
- `e2e/billing/specs/credits.spec.ts` -- The file with the two broken tests at lines 9 and 131
- `.planning/v1.2-MILESTONE-AUDIT.md` -- Audit report with precise file/line diagnosis and the exact fix

### Secondary (MEDIUM confidence)

- `e2e/billing/specs/cancel.spec.ts`, `downgrade.spec.ts` -- Reference patterns for how other specs correctly wire `clerkUser` alongside `billingPage`
- `e2e/billing/pages/billing-page.ts` -- Confirms `goto()` waits for `billing-plan-name` with 30s timeout (explaining the observed timeout behavior on unauthenticated pages)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use; no new dependencies
- Architecture: HIGH -- Playwright fixture system is well-understood; diagnosis confirmed by reading actual source files
- Pitfalls: HIGH -- primary pitfall (missing the second broken test) identified from direct file inspection; env var pitfall documented in the audit

**Research date:** 2026-02-28
**Valid until:** Indefinite -- this is a pure code reading / fix task with no external dependencies
