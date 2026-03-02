# Testing Patterns

**Analysis Date:** 2026-03-02

## Test Framework

**Runner:**
- Vitest 3.x
- Config: `vitest.config.ts` (unit/integration), `vitest.live.config.ts` (live billing)

**Assertion Library:**
- Vitest built-in `expect` with `@testing-library/jest-dom` matchers extended via `tests/setup.ts`

**Run Commands:**
```bash
npm test                                                    # Run all unit/integration tests
vitest run                                                  # Same as npm test
vitest run --config vitest.live.config.ts tests/live-billing/required.test.ts   # Live billing tests
npm run test:e2e:auth                                       # Playwright auth E2E tests
npm run test:billing:e2e                                    # Playwright billing E2E tests
npm run test:ci                                             # Full CI: test + build + e2e:auth
```

## Test File Organization

**Location:**
- Unit/integration tests: `tests/` directory at project root (flat structure, no subdirectories except `live-billing/` and `library/`)
- Convex backend tests: co-located in `convex/` subdirectories alongside source files
  - `convex/library/queries.test.ts`
  - `convex/library/collections.test.ts`
  - `convex/extraction/cascade-delete.test.ts`
- E2E tests: `e2e/` directory

**Naming:**
- `{feature-name}.test.ts` — maps directly to the module or feature being tested
- Examples: `filter-builder.test.ts`, `ai-credit-billing.test.ts`, `subscription-cancellation-policy.test.ts`

**Structure:**
```
tests/
├── setup.ts                          # Global test setup (jest-dom + cleanup)
├── filter-builder.test.ts            # lib/filters/filter-builder.ts
├── ai-credit-billing.test.ts         # convex/ai/lib/creditBilling.ts
├── store-migrations.test.ts          # lib/store.ts migrateSearchHistoryState
├── extraction-citation-panel.test.ts # lib/extraction/citation-panel.ts
├── live-billing/
│   ├── support.ts                    # Shared Stripe/Convex test utilities
│   ├── required.test.ts              # Live billing integration tests (requires real Stripe)
│   └── extended.test.ts             # Extended live billing tests
└── library/
    └── trim-paper-data.test.ts

convex/
├── library/
│   ├── queries.test.ts              # browseLibrary, searchLibrary, getLibraryCount
│   └── collections.test.ts         # Collection CRUD with auth checks
└── extraction/
    └── cascade-delete.test.ts       # deleteExtractionInternal cascade test

e2e/
├── auth.spec.ts                     # Clerk auth flows
├── global.setup.ts                  # Playwright global setup
└── billing/                         # Billing E2E tests
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("featureName", () => {
  // Optional: nested describes for sub-scenarios
  describe("sub-feature or scenario", () => {
    it("describes expected behavior in plain English", () => {
      // arrange
      const input = { ... };
      // act
      const result = doThing(input);
      // assert
      expect(result).toEqual(expected);
    });
  });

  it("returns zero for empty input", () => { ... });
  it("throws NOT_FOUND for non-existent item ID", () => { ... });
});
```

**Patterns:**
- Setup: `beforeEach` with `vi.useFakeTimers()` and `vi.setSystemTime(new Date(...))` for time-sensitive tests
- Teardown: `afterEach` with `vi.useRealTimers()` to restore timer state
- Environment flag tests: save original flag in module scope, restore in `afterEach`
- Test names are plain English statements of expected behavior, not "should" format

## Mocking

**Framework:** Vitest's `vi` module (built-in)

**Module mocking pattern:**
```typescript
// Use vi.hoisted for values referenced inside vi.mock factories
const { mockDownloadWithMetadata } = vi.hoisted(() => ({
  mockDownloadWithMetadata: vi.fn(),
}));

// Mock entire module
vi.mock("../lib/store", () => ({
  useRatingsStore: {
    getState: vi.fn(() => ({ ratings: {} })),
  },
}));

// Mock module but keep real implementations, override specific functions
vi.mock("../lib/utils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    downloadWithMetadata: mockDownloadWithMetadata,
  };
});
```

**Manual mock ctx for Convex mutations (when not using convex-test):**
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

**Timer mocking:**
```typescript
const FIXED_TIME = new Date("2026-01-15T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});
```

**Feature flag/env var mocking:**
```typescript
const ORIGINAL_FLAG = process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = ORIGINAL_FLAG;
  }
});

it("gates behavior on flag", async () => {
  process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";
  // Dynamic import AFTER setting env var because modules cache at import time
  vi.resetModules();
  const { buildCitationPanelPayload } = await import("../lib/extraction/citation-panel");
  expect(buildCitationPanelPayload(baseParams)).toBeNull();
});
```

**What to Mock:**
- External services: Stripe, PostHog, external HTTP calls
- Browser/Node globals not available in test environment
- Zustand stores when testing functions that call `getState()` directly
- Date/time via `vi.useFakeTimers()` for deterministic timestamps

**What NOT to Mock:**
- Pure utility functions — test them directly
- Convex backend via `convex-test` — use real in-memory Convex DB
- Constants and configuration values

## Fixtures and Factories

**Test Data (Convex tests - co-located seed helpers):**
```typescript
// Pattern: local async seed helpers at top of test file
async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email: string
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId, email, firstName: "Test", lastName: "User",
      state: "active" as const,
      createdAt: Date.now(), updatedAt: Date.now(), lastLoginAt: Date.now(),
    });
    return await ctx.db.get(userId);
  });
}

async function seedLibraryItem(
  t: ReturnType<typeof convexTest>,
  userId: any,
  overrides: Partial<LibraryItemFields> = {}
) { ... }
```

**Test Data (unit tests - inline or file-level const):**
```typescript
// File-level const fixtures for shared test data
const validCitation = {
  evidenceId: "ev_1",
  page: 5,
  charRange: [10, 50],
  quote: "This is evidence text",
  retrieval: { denseScore: 0.85, rerankScore: 0.92 },
  validated: true,
};

// Spread + override pattern for variations
const result = getStructuredCitations({
  citations: [{ ...validCitation, evidenceId: "" }], // invalid: empty id
});
```

**Location:**
- Seed helpers defined at top of each test file (no shared test fixtures directory)
- Live billing test utilities in `tests/live-billing/support.ts` (shared across billing tests)

## Coverage

**Requirements:** Not enforced (no coverage threshold configured)

**View Coverage:**
```bash
vitest run --coverage   # Generate coverage report (not in npm scripts by default)
```

## Test Types

**Unit Tests (`tests/`):**
- Test pure functions and business logic in isolation
- No real DB, no real HTTP, no React rendering
- Covers: filter builders, AI cost calculations, store migrations, export utilities, billing policies
- ~65 test files, ~7400 lines total

**Convex Backend Tests (`convex/**/*.test.ts`):**
- Use `convex-test` library with `edge-runtime` environment (required by convex-test)
- Real in-memory Convex DB seeded via `t.run(async (ctx) => {...})`
- Auth simulated via `t.withIdentity({ subject: "clerk_user_id" })`
- Scheduled functions advanced via `t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi))`
- Setup: `convex/test.setup.ts` discovers all Convex modules via `import.meta.glob`
- 3 test files covering library queries, collections, and extraction cascade delete

**Live Billing Integration Tests (`tests/live-billing/`):**
- Hit real Stripe API using test mode and test clocks
- Hit real Convex deployment via `convex run` CLI
- Excluded from normal `npm test` run; use `npm run test:billing:live`
- Separate config: `vitest.live.config.ts` (5-minute test/hook timeouts)
- Shared utilities in `tests/live-billing/support.ts`: `runConvexFunction`, `waitForCondition`, `createClockedCustomer`, etc.

**E2E Tests (`e2e/`):**
- Playwright with `@clerk/testing/playwright` for auth flows
- Configured in `playwright.config.ts`
- Two projects: `default` (auth flows) and `billing` (billing flows)
- Requires running app server (`npm run build && npm run start`)
- CI: 2 retries, 1 worker

## Common Patterns

**Async Testing:**
```typescript
it("async mutation test", async () => {
  const result = await createUserWithDefaults(ctx as any, {
    clerkId: "clerk_123",
    email: "test@example.com",
  });
  expect(result).toBe("mock_users_id");
});
```

**Error Testing (Convex):**
```typescript
await expect(
  asUser.mutation(api.library.mutations.removeFromLibrary, {
    itemId: item!._id,
  })
).rejects.toThrow();
```

**Parametric Tests with it.each:**
```typescript
const providerCases = [
  { provider: "openai" as AIProvider, modelId: "gpt-5-nano", inputPrice: 0.05, outputPrice: 0.4 },
  { provider: "anthropic" as AIProvider, modelId: "claude-3-haiku", inputPrice: 0.25, outputPrice: 1.25 },
];

it.each(providerCases)(
  "returns correct cost for $provider / $modelId",
  ({ provider, modelId, inputPrice, outputPrice }) => {
    const cost = calculateCostInDollars(usage, provider, modelId);
    expect(cost).toBeCloseTo(inputPrice + outputPrice, 6);
  }
);
```

**Dynamic import for env flag tests:**
```typescript
async function loadCitationPanelModule() {
  vi.resetModules();
  return import("../lib/extraction/citation-panel");
}

it("returns null when PDF feature is disabled", async () => {
  process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";
  const { buildCitationPanelPayload } = await loadCitationPanelModule();
  expect(buildCitationPanelPayload(baseParams)).toBeNull();
});
```

**Convex cascade/scheduled function test:**
```typescript
vi.useFakeTimers();  // MUST enable before triggering mutation with scheduled functions

await t.mutation(internal.extraction.mutations.deleteExtractionInternal, { jobId });

await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
vi.useRealTimers();

// Verify in t.run to access raw DB
await t.run(async (ctx) => {
  const job = await ctx.db.get(jobId);
  expect(job).toBeNull();
});
```

## Environment Setup

**Test environments (configured in `vitest.config.ts`):**
- Default: `node` (for all `tests/*.test.ts`)
- `edge-runtime`: for all `convex/**/*.test.ts` (required by `convex-test`)
- `jsdom`: for `tests/hooks/**/*.test.ts` and `tests/components/**/*.test.tsx`

**Global setup file:** `tests/setup.ts`
- Extends `expect` with `@testing-library/jest-dom` matchers
- Conditionally runs `cleanup()` after each test when DOM is present

---

*Testing analysis: 2026-03-02*
