# Testing Patterns

**Analysis Date:** 2026-03-03

## Test Framework

**Runner:**
- Vitest 3.x (configured in `vitest.config.ts`)
- Separate live-billing config in `vitest.live.config.ts`
- Playwright 1.x for E2E tests (configured in `playwright.config.ts`)

**Assertion Library:**
- Vitest built-in `expect` with jest-dom matchers via `@testing-library/jest-dom/vitest` (registered in `tests/setup.ts`)

**Run Commands:**
```bash
npm test                                          # Run all unit tests (vitest run)
npx vitest                                        # Watch mode
npm run test:billing:live                         # Live billing integration tests
npm run test:billing:extended                     # Extended billing regressions
npm run test:e2e:auth                             # Auth E2E tests (Playwright)
npm run test:billing:e2e                          # Billing E2E tests (Playwright)
npm run test:ci                                   # CI: unit tests + build + e2e auth
```

## Test File Organization

**Location:**
- Main unit/integration tests: `tests/` directory (flat, not co-located)
- Convex-specific integration tests: co-located in `convex/` subdirectories (e.g., `convex/credits/deduct-credits.test.ts`, `convex/library/queries.test.ts`)
- Live billing integration tests: `tests/live-billing/` subdirectory
- E2E tests: `e2e/` directory with `e2e/billing/` subdirectory

**Naming:**
- Files: `<module-or-feature>.test.ts` matching the domain being tested
- E2E files: `<feature>.spec.ts` (Playwright convention)

**Structure:**
```
tests/
├── setup.ts                          # Global setup (jest-dom + cleanup)
├── filter-builder.test.ts            # Lib utility unit tests
├── ai-cost.test.ts                   # Pure function unit tests
├── user-creation.test.ts             # Convex handler unit tests (mock DB)
├── clerk-webhook-handler.test.ts     # Webhook logic unit tests
├── stripe-webhook-handler.test.ts    # Stripe handler unit tests
├── export-download.test.ts           # Module mock pattern tests
├── ensure-user.test.ts               # Mutation handler extraction tests
├── live-billing/
│   ├── support.ts                    # Live billing helpers and fixtures
│   ├── required.test.ts              # Required live regression tests
│   └── extended.test.ts             # Extended regression tests
convex/
├── credits/deduct-credits.test.ts    # convex-test OCC/mutation tests
├── library/queries.test.ts           # convex-test query tests
├── library/collections.test.ts       # convex-test collection tests
└── extraction/cascade-delete.test.ts
e2e/
├── auth.spec.ts                      # Playwright auth flows
├── billing/                          # Playwright billing flows
└── global.setup.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { functionUnderTest } from "../lib/module";

describe("functionUnderTest", () => {
  describe("specific scenario group", () => {
    it("does the expected thing when condition", () => {
      // Arrange
      const input = { ... };
      // Act
      const result = functionUnderTest(input);
      // Assert
      expect(result).toBe(expectedValue);
    });
  });
});
```

**Patterns:**
- `beforeEach`/`afterEach` used for timer mocking and mock cleanup
- `beforeAll`/`afterAll` used in live billing tests for expensive setup/teardown
- `describe.sequential` used in live billing tests to prevent parallel Stripe API conflicts
- Nested `describe` blocks for grouping by input scenario
- `it.each` for parameterized test cases (e.g., `ai-cost.test.ts` provider matrix)

## Mocking

**Framework:** Vitest `vi.*` APIs

**Patterns:**

**Module-level mocking (top of file):**
```typescript
// 1. Use vi.hoisted for cross-module mock references
const { mockFn } = vi.hoisted(() => ({
  mockFn: vi.fn(),
}));

// 2. vi.mock for module replacement
vi.mock("../lib/store", () => ({
  useRatingsStore: { getState: vi.fn(() => ({ ratings: {} })) },
}));

// 3. Partial mock preserving real exports
vi.mock("../lib/utils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, downloadWithMetadata: mockFn };
});
```

**Inline mock factories (preferred for Convex tests):**
```typescript
function createMockCtx() {
  return {
    db: {
      insert: vi.fn(async (table: string, doc: any) => `mock_${table}_id`),
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          unique: vi.fn().mockResolvedValue(existingDoc),
        }),
      }),
    },
    auth: { getUserIdentity: vi.fn().mockResolvedValue(identity) },
  };
}
```

**Timer mocking:**
```typescript
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});
```

**Module reset for env-var-dependent tests:**
```typescript
async function loadModuleUnderTest() {
  vi.resetModules();
  return import("../lib/extraction/citations");
}
// Set process.env before each import
process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
const { fn } = await loadModuleUnderTest();
```

**What to Mock:**
- External services (Stripe, Convex DB, Clerk auth)
- Environment-dependent modules (env var reading)
- Store dependencies in action handler tests
- Analytics/posthog calls
- Convex `_generated/server` when testing mutation handler logic directly

**What NOT to Mock:**
- Pure utility functions being tested (filter-builder, cost calculations)
- Convex function logic when using `convex-test` (use real schema + test runtime instead)
- Business logic in the module under test

## Fixtures and Factories

**Test Data:**
```typescript
// Inline factory functions in test files
function createMockMutationCtx() {
  const inserts: Array<{ table: string; doc: any }> = [];
  return {
    ctx: { db: { insert: vi.fn(async (table, doc) => { inserts.push({table, doc}); return `mock_${table}_id`; }) } },
    inserts,
  };
}

function createPaper(id: string, title = `Paper ${id}`, abstract = `Abstract for ${id}`): BatchPaper {
  return { id, title, abstract };
}

// convex-test seed helpers
async function seedUserWithCredits(t, freeBalance, paidBalance) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { ... });
    const creditsId = await ctx.db.insert("credits", { userId, freeBalance, ... });
    return { userId, creditsId };
  });
}
```

**Location:**
- Fixtures are defined inline in test files or in `tests/live-billing/support.ts` for live tests
- No shared fixtures directory — each test file is self-contained
- `tests/setup.ts` for global test setup only (jest-dom + DOM cleanup)

## Coverage

**Requirements:** Not enforced — no coverage thresholds configured in `vitest.config.ts`

**View Coverage:**
```bash
npx vitest run --coverage
```

## Test Types

**Unit Tests (`tests/*.test.ts`):**
- Pure function testing: business logic, cost calculations, filter builders, policy functions
- Handler extraction: Convex mutation handlers extracted and tested with mock contexts
- Module mock tests: search actions, download handlers with vi.mock for dependencies
- 71 test files covering pure logic, policies, webhook handlers, billing helpers, and more

**Convex Integration Tests (`convex/**/*.test.ts`):**
- Use `convex-test` library with real schema (`import schema from "../schema"`)
- Run in `edge-runtime` environment (configured via `environmentMatchGlobs` in `vitest.config.ts`)
- Create real in-memory Convex DB: `const t = convexTest(schema)`
- Call actual mutations/queries via `t.mutation(internal.credits.internal.deductCredits, args)`
- Seed data via `t.run(async (ctx) => ctx.db.insert(...))`
- 4 test files for critical Convex-side logic (credits, library, extraction cascade)

**Live Billing Integration Tests (`tests/live-billing/*.test.ts`):**
- Require real Stripe test environment and Convex deployment
- Use `describe.sequential` to prevent parallel Stripe API conflicts
- `beforeAll`/`beforeEach`/`afterAll` for full lifecycle management (cleanup → test → verify → cleanup)
- Uses Stripe Test Clocks to simulate time progression for subscription billing cycles
- Long timeouts: `testTimeout: 300_000` (5 minutes)
- Excluded from default `npm test` run; use `npm run test:billing:live`
- Support utilities in `tests/live-billing/support.ts`: `runConvexFunction`, `waitForCondition`, `getBillingSnapshotForUser`, etc.

**E2E Tests (`e2e/*.spec.ts`):**
- Playwright with `@clerk/testing/playwright` for authenticated flows
- `clerk.signIn()` / `clerk.signOut()` for auth state management
- Tests navigate via `page.goto()` and assert URLs with `expect(page).toHaveURL()`
- Configured retries on CI (`retries: 2`), sequential workers (`workers: 1`)

## Common Patterns

**Async Testing:**
```typescript
it("creates user on first login", async () => {
  const result = await mutationHandler(ctx, {});
  expect(result).toBe("new_user_id");
});
```

**Error Testing:**
```typescript
// ConvexError rejection
await expect(
  t.mutation(internal.credits.internal.deductCredits, { userId, amount: 20, description: "too much" })
).rejects.toThrow("INSUFFICIENT_CREDITS");

// Standard Error rejection
await expect(
  runAuditedStripeHandler(ctx, event, handler, mutationRefs)
).rejects.toThrow("handler boom");
```

**toMatchObject for partial assertion:**
```typescript
expect(inserts[0].doc).toMatchObject({
  clerkId: "clerk_123",
  email: "test@example.com",
  state: "active",
});
```

**Symbol stubs for Convex function references:**
```typescript
// Symbols stand in for Convex internal function references
const mutationRefs = {
  markStripeEventProcessed: Symbol("markStripeEventProcessed"),
  markStripeEventFailed: Symbol("markStripeEventFailed"),
};
```

**Inline describe sections for multi-function test files:**
```typescript
// ---------------------------------------------------------------------------
// getStripeObjectId
// ---------------------------------------------------------------------------
describe("getStripeObjectId", () => { ... });
```

---

*Testing analysis: 2026-03-03*
