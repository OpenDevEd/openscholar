# Testing Patterns

**Analysis Date:** 2026-03-03

## Test Framework

**Runner:**
- Vitest 3.x
- Config: `vitest.config.ts` (standard tests), `vitest.live.config.ts` (live billing tests)

**Assertion Library:**
- Vitest built-in `expect` (Vitest 3 uses a Jest-compatible API)
- `@testing-library/jest-dom` matchers extended via `tests/setup.ts` — `toBeInTheDocument`, `toHaveLength`, etc.

**Run Commands:**
```bash
npm test                                       # Run all unit/integration tests (excludes live-billing)
vitest run --config vitest.live.config.ts      # Live billing tests
npm run test:billing:live                      # Required live billing suite
npm run test:billing:extended                  # Extended live billing suite
npm run test:e2e:auth                          # Auth E2E with Playwright
npm run test:ci                                # CI: unit tests + build + E2E auth
```

## Test File Organization

**Location:**
- Unit and integration tests: `tests/` directory (flat, co-located by feature not by source path)
- Convex function tests: `convex/` alongside source — `convex/library/queries.test.ts`, `convex/library/collections.test.ts`, `convex/extraction/cascade-delete.test.ts`
- E2E tests: `e2e/` directory — `e2e/auth.spec.ts`, `e2e/billing/`
- Live billing integration tests: `tests/live-billing/` — `required.test.ts`, `extended.test.ts`
- Shared test helpers: `tests/live-billing/support.ts`

**Naming:**
- `[feature-name].test.ts` — `filter-builder.test.ts`, `ai-cost.test.ts`, `user-creation.test.ts`
- `[domain]-[concern].test.ts` — `clerk-webhook-handler.test.ts`, `subscription-cancellation-policy.test.ts`
- E2E: `[feature].spec.ts` — `auth.spec.ts`

**Structure:**
```
tests/
├── setup.ts                         # Global test setup (jest-dom + cleanup)
├── filter-builder.test.ts           # Pure function tests
├── ai-cost.test.ts                  # Pure function tests
├── user-creation.test.ts            # Mock-based Convex mutation tests
├── clerk-webhook-handler.test.ts    # Dependency-injected handler tests
├── ai-batch.test.ts                 # vi.mock + vi.mocked pattern
├── live-billing/
│   ├── support.ts                   # Shared helpers (Stripe, Convex CLI, polling)
│   ├── required.test.ts             # Required live billing scenarios
│   └── extended.test.ts             # Extended scenarios (subscription schedule, etc.)
convex/
├── library/queries.test.ts          # convex-test integration tests
├── library/collections.test.ts      # convex-test integration tests
└── extraction/cascade-delete.test.ts
e2e/
├── global.setup.ts
├── auth.spec.ts
└── billing/
```

## Test Environments

Vitest supports multiple environments via `environmentMatchGlobs` in `vitest.config.ts`:
- `convex/**/*.test.ts` → `edge-runtime` (required by `convex-test` for Convex function isolation)
- `tests/hooks/**/*.test.ts` → `jsdom` (DOM APIs for React hook tests)
- `tests/components/**/*.test.tsx` → `jsdom`
- All other tests → `node` (default)

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("featureName", () => {
  // Optional: shared fixtures at describe scope
  const fixedInput = { ... };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does X when Y", () => {
    const result = functionUnderTest(fixedInput);
    expect(result).toEqual(expectedValue);
  });

  describe("edge case group", () => {
    it("handles Z correctly", () => { ... });
  });
});
```

**Patterns:**
- Setup: `beforeEach` for timer/mock resets; shared fixture constants at `describe` scope
- Teardown: `afterEach` restores real timers (`vi.useRealTimers()`)
- Assertion pattern: single `expect` per behavior; multiple expects per test when verifying object shape
- Descriptive it-strings: `"returns X for Y"`, `"does NOT return items belonging to other users"`

## Mocking

**Framework:** Vitest's built-in `vi` object

**Module mock pattern (hoisted):**
```typescript
// MUST appear before the import of code that uses the module
vi.mock("../lib/ai/core/execute", () => ({
  executeAIOperation: vi.fn(),
}));

import { executeAIOperation } from "../lib/ai/core/execute";
const mockExecute = vi.mocked(executeAIOperation);

beforeEach(() => {
  mockExecute.mockReset();
});

// In tests:
mockExecute
  .mockResolvedValueOnce({ output: { value: "result1" }, usage: usage1 })
  .mockRejectedValueOnce(new Error("API rate limit exceeded"));
```
See: `tests/ai-batch.test.ts`

**Manual mock object pattern (dependency injection):**
```typescript
function createMockMutationCtx() {
  const inserts: Array<{ table: string; doc: any }> = [];
  return {
    ctx: {
      db: {
        insert: vi.fn(async (table: string, doc: any) => {
          inserts.push({ table, doc });
          return `mock_${table}_id`;
        }),
      },
    },
    inserts,
  };
}
```
See: `tests/user-creation.test.ts`

**Symbol-based mutation refs pattern:**
```typescript
const mutationRefs = {
  upsertUserFromClerk: Symbol("upsertUserFromClerk"),
  markUserDeletedFromClerk: Symbol("markUserDeletedFromClerk"),
};
const runMutation = vi.fn().mockImplementation(async (mutation, _args) => {
  if (mutation !== mutationRefs.upsertUserFromClerk) {
    throw new Error("expected upsertUserFromClerk mutation");
  }
  return null;
});
```
See: `tests/clerk-webhook-handler.test.ts`

**What to Mock:**
- External I/O: database calls, AI provider calls (`executeAIOperation`), Stripe API calls
- Time: `vi.useFakeTimers()` + `vi.setSystemTime()` when testing timestamp logic
- Convex mutations passed as dependencies (use Symbol refs or `vi.fn()`)

**What NOT to Mock:**
- Pure functions being tested (the whole point is to exercise the real implementation)
- Convex queries/mutations in `convex-test` integration tests (use real schema + in-memory DB)

## Fixtures and Factories

**Test Data Factories:**
```typescript
// Inline factory functions in test files
function createPaper(id: string, title = `Paper ${id}`, abstract = `Abstract for ${id}`): BatchPaper {
  return { id, title, abstract };
}

function createUsage(input = 100, output = 50): Usage {
  return { promptTokens: input, completionTokens: output, inputTokens: input, outputTokens: output };
}

// Fixed time constant for timestamp assertions
const FIXED_TIME = new Date("2026-01-15T12:00:00Z").getTime();
```

**Convex seed helpers (in `convex-test` tests):**
```typescript
async function seedUser(t: ReturnType<typeof convexTest>, clerkId: string, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId, email, state: "active" as const, ... });
    return await ctx.db.get(userId);
  });
}
```
See: `convex/library/queries.test.ts`

**Location:** Factory functions defined inline in each test file — no shared fixture files (except `tests/live-billing/support.ts` for live tests)

## Convex-Test Integration Tests

Tests for Convex functions use `convex-test` (`convexTest` from `"convex-test"`):

```typescript
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";

it("does X", async () => {
  const t = convexTest(schema);

  // Seed data directly in the mock DB
  const user = await seedUser(t, "clerk_user1", "user1@test.com");

  // Run as authenticated user
  const asUser = t.withIdentity({ subject: "clerk_user1" });

  // Call real Convex query/mutation
  const result = await asUser.query(api.library.queries.browseLibrary, {
    sortBy: "savedAt",
    sortOrder: "desc",
    paginationOpts: { numItems: 10, cursor: null },
  });

  expect(result.page).toHaveLength(3);
});
```

**Scheduled function testing:**
```typescript
vi.useFakeTimers();
await t.mutation(internal.extraction.mutations.deleteExtractionInternal, { jobId });
await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
vi.useRealTimers();
```
See: `convex/extraction/cascade-delete.test.ts`

**Setup file for Convex module discovery:** `convex/test.setup.ts`

## Coverage

**Requirements:** Not enforced — no coverage threshold configured

**View Coverage:**
```bash
vitest run --coverage    # (coverage reporter not configured by default)
```

## Test Types

**Unit Tests:**
- Scope: Pure functions, business logic, data transformation
- Location: `tests/*.test.ts`
- Approach: Direct import + assertion, no external dependencies
- Examples: `tests/filter-builder.test.ts`, `tests/ai-cost.test.ts`, `tests/subscription-cancellation-policy.test.ts`

**Integration Tests (Convex):**
- Scope: Convex queries/mutations/actions against in-memory DB
- Location: `convex/**/*.test.ts`
- Approach: `convex-test` with real schema, seed helpers, identity simulation
- Environment: `edge-runtime`
- Examples: `convex/library/queries.test.ts`, `convex/extraction/cascade-delete.test.ts`

**Integration Tests (Live Billing):**
- Scope: Full Stripe + Convex webhook round-trips
- Location: `tests/live-billing/`
- Approach: Real Stripe test-mode API + real Convex deployment + polling helpers
- Config: `vitest.live.config.ts` (5-minute timeout)
- Requires: Live env vars (`STRIPE_SECRET_KEY`, `BILLING_TEST_USER_EMAIL`, etc.)

**E2E Tests:**
- Framework: Playwright 1.x
- Config: `playwright.config.ts`
- Location: `e2e/`
- Approach: Real browser, Clerk test utilities (`@clerk/testing/playwright`)
- Requires: Running Next.js server, `E2E_CLERK_USER_EMAIL` env var

## Common Patterns

**Parameterised tests:**
```typescript
const providerCases = [
  { provider: "openai" as AIProvider, modelId: "gpt-5-nano", inputPrice: 0.05, outputPrice: 0.4 },
  { provider: "anthropic" as AIProvider, modelId: "claude-3-haiku", inputPrice: 0.25, outputPrice: 1.25 },
];

it.each(providerCases)(
  "returns correct cost for $provider / $modelId",
  ({ provider, modelId, inputPrice, outputPrice }) => { ... }
);
```
See: `tests/ai-cost.test.ts`

**Async Testing:**
```typescript
it("resolves when condition met", async () => {
  const result = await asUser.query(api.library.queries.browseLibrary, { ... });
  expect(result.page).toHaveLength(3);
});
```

**Error Testing:**
```typescript
// ConvexError throws
await expect(
  asUser.mutation(api.library.mutations.removeFromLibrary, { itemId: otherItem!._id })
).rejects.toThrow();

// Return value error testing
expect(outcome).toEqual({ status: 400, body: "Invalid user payload" });
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
// Then assert timestamps equal FIXED_TIME constant
```

**Polling/waiting (live billing tests):**
```typescript
await waitForCondition({
  description: "subscription to be active",
  timeoutMs: env.webhookWaitTimeoutMs,
  check: async () => {
    const snapshot = await getBillingSnapshotForUser(userId);
    return snapshot.subscriptions.find(s => s.plan === "go") ?? null;
  },
});
```

---

*Testing analysis: 2026-03-03*
