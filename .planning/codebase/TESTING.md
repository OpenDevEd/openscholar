# Testing Patterns

**Analysis Date:** 2026-03-06

## Test Framework

**Runner:**
- Vitest 3.x for unit and integration tests
- Config: `vitest.config.ts` (main), `vitest.live.config.ts` (live billing)
- Playwright 1.x for E2E tests
- Config: `playwright.config.ts`

**Assertion Library:**
- Vitest built-in `expect` with `@testing-library/jest-dom/vitest` matchers
- Playwright built-in `expect` with web-first assertions

**Run Commands:**
```bash
npm run test                    # Run all unit/integration tests (vitest run)
npm run test:billing:live       # Run live billing tests against real Stripe
npm run test:billing:live:ci    # Live billing with Convex deploy
npm run test:billing:extended   # Extended live billing suite
npm run test:billing:e2e        # Playwright billing E2E specs
npm run test:e2e:auth           # Playwright auth E2E specs
npm run test:ci                 # Unit tests + build + auth E2E
npm run test:all                # Full suite: test:ci + billing E2E
```

## Test File Organization

**Location:**
- Unit/integration tests: `tests/` directory (separate from source)
- Convex function tests: Co-located at `convex/**/*.test.ts`
- E2E tests: `e2e/` directory
- Live billing tests: `tests/live-billing/`

**Naming:**
- Unit/integration: `tests/{feature-name}.test.ts` (kebab-case)
- Convex function tests: `convex/{domain}/queries.test.ts`
- E2E specs: `e2e/{feature}.spec.ts` or `e2e/billing/specs/{scenario}.spec.ts`

**Structure:**
```
tests/
  setup.ts                          # Global test setup (jest-dom, cleanup)
  factories/                        # Shared test factories
    index.ts                        # Barrel export
    convex-context.ts               # Mock Convex ctx factories
    convex-ids.ts                   # ID generation helpers
    stripe-events.ts                # Mock Stripe event/invoice factories
  live-billing/
    support.ts                      # Live billing test utilities
    required.test.ts                # Required regression tests
    extended.test.ts                # Extended regression tests
  *.test.ts                         # Individual test files
convex/
  library/queries.test.ts           # Co-located Convex function tests
  library/collections.test.ts
e2e/
  global.setup.ts                   # Playwright global setup (Clerk user provisioning)
  auth.spec.ts                      # Auth flow E2E tests
  billing/
    fixtures.ts                     # Playwright fixture composition
    stripe-helpers.ts               # Stripe API helpers for E2E
    webhook-waiter.ts               # Polls Convex for webhook processing
    pages/                          # Page Object Models
      billing-page.ts
      pricing-page.ts
    specs/                          # Billing E2E specs
      subscribe.spec.ts
      upgrade.spec.ts
      downgrade.spec.ts
      cancel.spec.ts
      credits.spec.ts
      credit-grants.spec.ts
```

## Environment Configuration

**Vitest environments (per-glob matching in `vitest.config.ts`):**
- Default: `node` for pure logic tests
- `edge-runtime` for Convex function tests (`convex/**/*.test.ts`) -- required by `convex-test`
- `jsdom` for React hook/component tests (`tests/hooks/**`, `tests/components/**`)

**Setup file:** `tests/setup.ts`
```typescript
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

afterEach(async () => {
  if (typeof globalThis.document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
```

**Exclusions:** `tests/live-billing/**/*.test.ts` excluded from default `vitest run` (uses separate config with 300s timeout)

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it } from "vitest";

describe("functionUnderTest", () => {
  it("returns correct result for normal input", () => {
    const result = functionUnderTest(normalInput);
    expect(result).toEqual(expectedOutput);
  });

  it("handles edge case", () => {
    expect(functionUnderTest(edgeInput)).toBe(expectedEdge);
  });

  describe("nested group for sub-behavior", () => {
    it("does specific sub-thing", () => {
      // ...
    });
  });
});
```

**Patterns:**
- Flat `describe` blocks for each exported function
- Nested `describe` for logical sub-groups (e.g., filter sections)
- `it` descriptions start with verb: "returns", "creates", "throws", "handles"
- Use `it.each()` for parameterized tests (see `tests/ai-cost.test.ts`)
- No `beforeEach`/`afterEach` in pure unit tests -- setup inline
- `beforeEach` used for mock reset in tests with `vi.fn()` mocks

## Mocking

**Framework:** Vitest built-in `vi.fn()` and `vi.mock()`

**Patterns - Manual Mocks via Factory Functions:**
```typescript
// tests/factories/convex-context.ts
import { vi } from "vitest";

export function createMockActionCtx(overrides?: DeepPartial<ActionCtx>): ActionCtx {
  const base = {
    runMutation: vi.fn(),
    runAction: vi.fn(),
    scheduler: { runAfter: vi.fn(), runAt: vi.fn() },
    auth: { getUserIdentity: vi.fn().mockResolvedValue(null) },
  };
  return deepMerge(base, overrides) as unknown as ActionCtx;
}
```

```typescript
// tests/factories/stripe-events.ts
export function createMockStripeEvent(overrides?: Record<string, unknown>): Stripe.Event {
  const base = {
    id: "evt_test_123",
    type: "invoice.paid",
    api_version: "2024-12-18.acacia",
    // ...defaults
    ...overrides,
  };
  return base as unknown as Stripe.Event;
}
```

**Usage in tests:**
```typescript
import { createMockActionCtx, createMockStripeEvent } from "./factories";

const ctx = createMockActionCtx({
  runMutation: vi.fn().mockResolvedValue(undefined),
});
const event = createMockStripeEvent({ id: "evt_custom" });
```

**What to Mock:**
- Convex context objects (`QueryCtx`, `MutationCtx`, `ActionCtx`) via factory functions
- Stripe event/invoice objects via factory functions
- External API calls and side effects

**What NOT to Mock:**
- Pure business logic functions (test directly)
- Convex validators and schema (use `convex-test` instead)
- Data transformation utilities

## Convex Function Testing

**Framework:** `convex-test` package with real Convex schema

**Pattern:**
```typescript
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";

describe("browseLibrary", () => {
  it("returns paginated results for authenticated user", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, { title: "Paper A" });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
  });
});
```

**Key conventions for `convex-test`:**
- Create new `convexTest(schema)` instance per test (fresh DB)
- Seed data via `t.run(async (ctx) => { await ctx.db.insert(...) })`
- Authenticate with `t.withIdentity({ subject: "clerk_user1" })`
- Call functions via `asUser.query(api.module.fn, args)` or `asUser.mutation(...)`
- Requires `edge-runtime` environment (configured in `vitest.config.ts`)
- Helper seed functions defined at top of test file (e.g., `seedUser()`, `seedLibraryItem()`)

## E2E Testing

**Framework:** Playwright with Clerk testing integration

**Global Setup (`e2e/global.setup.ts`):**
- Loads env from `.env.local` / `.env`
- Normalizes Clerk env vars
- Calls `clerkSetup()` for Playwright Clerk integration
- Creates/updates disposable Clerk test user

**Fixture Composition (billing E2E):**
```typescript
// e2e/billing/fixtures.ts
export const test = base.extend<BillingFixtures>({
  clerkUser: async ({ page }, use) => {
    // Create fresh Clerk user, sign in, cleanup on teardown
  },
  stripeClient: async ({}, use) => {
    await use(createStripeClient());
  },
  webhookWaiter: async ({ clerkUser }, use) => {
    // Discover Convex userId, create WebhookWaiter
  },
  billingPage: async ({ page }, use) => {
    await use(new BillingPage(page));
  },
});
```

**Page Object Model Pattern:**
```typescript
// e2e/billing/pages/billing-page.ts
export class BillingPage {
  readonly planName: Locator;
  readonly statusBadge: Locator;

  constructor(page: Page) {
    this.planName = page.locator('[data-testid="billing-plan-name"]');
    this.statusBadge = page.locator('[data-testid="billing-status-badge"]');
  }

  async goto(): Promise<void> {
    await this.page.goto("/settings/billing");
    await this.planName.waitFor({ state: "visible", timeout: 30_000 });
  }
}
```

**E2E conventions:**
- Use `data-testid` attributes for element selection
- Page Object Models in `e2e/billing/pages/`
- Fixtures compose user lifecycle, API clients, and page objects
- Numbered step comments in test body: `// 1. Subscribe`, `// 2. Wait`, `// 3. Assert`
- Cleanup Stripe objects in test teardown
- `WebhookWaiter` polls Convex to confirm async webhook processing

**Playwright configuration highlights:**
- Timeout: 120s default, 180s for billing
- Retries: 2 in CI, 0 locally
- Workers: 1 in CI (sequential)
- Traces/screenshots/video on failure only
- Web server auto-started via `npm run build && npm run start`

## Live Billing Tests

**Purpose:** Integration tests against real Stripe test-mode API

**Config:** `vitest.live.config.ts` with 300s timeout

**Patterns:**
- `describe.sequential()` to enforce test ordering
- Real Stripe API calls via `createStripeClient()`
- Test clock manipulation for time-dependent billing logic
- Convex function calls via CLI (`npx convex run`)
- Artifact logging for debugging: `appendBillingArtifactLog()`
- `waitForCondition()` polling for async Stripe/Convex state
- Full setup/teardown lifecycle: create user, reset state, cleanup Stripe

## Fixtures and Factories

**Test Data (Unit tests):**
```typescript
// tests/factories/stripe-events.ts
export function createMockStripeEvent(overrides?) { /* ... */ }
export function createMockStripeInvoice(overrides?) { /* ... */ }
export function createMockMutationRefs() { /* ... */ }
export function createMockGrantRefs() { /* ... */ }

// tests/factories/convex-context.ts
export function createMockQueryCtx(overrides?) { /* ... */ }
export function createMockMutationCtx(overrides?) { /* ... */ }
export function createMockActionCtx(overrides?) { /* ... */ }
export function createMockIdentity(overrides?) { /* ... */ }
```

**Location:**
- Shared factories in `tests/factories/` with barrel export via `tests/factories/index.ts`
- Inline seed helpers in Convex test files (e.g., `seedUser()`, `seedLibraryItem()` in `convex/library/queries.test.ts`)
- E2E helpers in `e2e/billing/stripe-helpers.ts` and `e2e/billing/webhook-waiter.ts`

**Factory design pattern:**
- Accept optional `overrides` parameter for selective customization
- Return typed objects with sensible defaults
- Use `as unknown as Type` cast for partial mock objects
- Deep merge for nested override support (`createMockActionCtx`)

## Coverage

**Requirements:** None enforced (no coverage thresholds configured)

**View Coverage:**
```bash
npx vitest run --coverage       # Not configured by default but available
```

## Test Types

**Unit Tests (tests/*.test.ts):**
- Test pure functions, validators, and business logic
- No network calls or database access
- Direct import of source modules
- ~75 test files covering filters, AI, billing, auth, export, extraction

**Convex Function Tests (convex/**/*.test.ts):**
- Test Convex queries/mutations with `convex-test` mock database
- Validate auth requirements, data isolation, pagination, filtering
- Run in edge-runtime environment

**Live Integration Tests (tests/live-billing/*.test.ts):**
- Test against real Stripe test-mode API
- Verify webhook processing, credit grants, subscription lifecycle
- Sequential execution with long timeouts (300s)
- Separate vitest config to avoid running in normal test suite

**E2E Tests (e2e/*.spec.ts):**
- Full browser tests with Playwright
- Clerk auth integration for real sign-in/sign-out flows
- Stripe checkout bypass for billing scenarios
- Page Object Model for UI assertions

## Common Patterns

**Async Testing:**
```typescript
it("throws FORBIDDEN when trying to delete another user's item", async () => {
  const t = convexTest(schema);
  // ... setup ...
  await expect(
    asUser1.mutation(api.library.mutations.removeFromLibrary, { itemId })
  ).rejects.toThrow();
});
```

**Error Testing:**
```typescript
it("calls markStripeEventFailed and re-throws on handler error", async () => {
  const handler = vi.fn().mockRejectedValue(new Error("handler boom"));

  await expect(
    runAuditedStripeHandler(ctx, event, handler, mutationRefs),
  ).rejects.toThrow("handler boom");

  const runMutation = ctx.runMutation as ReturnType<typeof vi.fn>;
  expect(runMutation).toHaveBeenCalledTimes(1);
});
```

**Parameterized Testing:**
```typescript
it.each(providerCases)(
  "returns correct cost for $provider / $modelId",
  ({ provider, modelId, inputPrice, outputPrice }) => {
    const cost = calculateCostInDollars(usage, provider, modelId);
    expect(cost).toBeCloseTo(inputPrice + outputPrice, 6);
  }
);
```

**Source Code Verification (policy tests):**
```typescript
// Verify implementation uses the policy function
it("is enforced by monthly grant implementation", () => {
  const source = readFileSync(path.resolve(process.cwd(), "convex/credits/internal.ts"), "utf8");
  expect(source).toMatch(/classifyMonthlyCreditInvoice/);
});
```

**Convex auth testing:**
```typescript
// Test user isolation
it("does NOT return items belonging to other users", async () => {
  const t = convexTest(schema);
  const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
  const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
  const asUser1 = t.withIdentity({ subject: "clerk_user1" });

  await seedLibraryItem(t, user1!._id, { title: "User1 paper" });
  await seedLibraryItem(t, user2!._id, { title: "User2 paper" });

  const result = await asUser1.query(api.library.queries.browseLibrary, { /* ... */ });
  expect(result.page).toHaveLength(1);
  expect(result.page[0].title).toBe("User1 paper");
});
```

---

*Testing analysis: 2026-03-06*
