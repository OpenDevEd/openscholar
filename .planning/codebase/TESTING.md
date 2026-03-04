# Testing Patterns

**Analysis Date:** 2026-03-04

## Test Framework

**Runner:**
- Vitest 3.x
- Config: `vitest.config.ts` (main), `vitest.live.config.ts` (billing integration)

**Assertion Library:**
- Vitest built-in (`expect`) + `@testing-library/jest-dom` matchers via `tests/setup.ts`

**Mocking:**
- Vitest's `vi` module (`vi.mock`, `vi.fn`, `vi.spyOn`, `vi.mocked`, `vi.hoisted`, `vi.stubGlobal`)

**E2E:**
- Playwright (`@playwright/test`) with `@clerk/testing` for auth flows
- Config: `playwright.config.ts`

**Convex backend tests:**
- `convex-test` library (runs Convex mutations/queries in-process with edge-runtime)

**Run Commands:**
```bash
npm test                                      # Run all unit tests
npm run test:billing:live                    # Live Stripe billing integration tests
npm run test:billing:e2e                     # Playwright billing E2E
npm run test:e2e:auth                        # Playwright auth E2E
npm run test:ci                              # test + build + auth E2E
```

## Test File Organization

**Location:**
- Unit/integration tests: `tests/` directory at project root (flat, no mirroring)
- Convex backend tests: co-located alongside source in `convex/` (e.g., `convex/credits/deduct-credits.test.ts`)
- Live billing tests: `tests/live-billing/required.test.ts`, `tests/live-billing/extended.test.ts`
- E2E tests: `e2e/` directory

**Naming:**
- `[subject].test.ts` — mirrors the module name, not the file path
- Examples: `filter-builder.test.ts`, `ai-batch.test.ts`, `subscription-cancellation-policy.test.ts`

**Environment routing** (configured in `vitest.config.ts`):
- `convex/**/*.test.ts` → `edge-runtime` (required by `convex-test`)
- `tests/hooks/**/*.test.ts` → `jsdom`
- `tests/components/**/*.test.tsx` → `jsdom`
- All other tests → `node`

**Structure:**
```
tests/
├── *.test.ts                    # Unit tests for lib/*, convex/*
├── extraction/                  # Extraction-specific tests
├── library/                     # Library-specific tests
├── live-billing/
│   ├── required.test.ts         # Core billing integration (CI required)
│   ├── extended.test.ts         # Extended billing scenarios
│   └── support.ts               # Shared billing test utilities
└── setup.ts                     # Global test setup

convex/
├── credits/deduct-credits.test.ts
├── extraction/cascade-delete.test.ts
├── library/queries.test.ts
├── library/collections.test.ts
└── maintenance/check-subscription.test.ts

e2e/
├── auth.spec.ts
├── billing/
└── global.setup.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("functionName", () => {
  describe("category/scenario", () => {
    it("does something specific", () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

**Patterns:**
- `describe` nesting used for grouping: feature → scenario → behavior
- Test names follow: `"[verb] [subject] [condition]"` pattern
- `beforeEach` / `afterEach` for setup/teardown; always restore original state
- Timer mocking: `vi.useFakeTimers()` + `vi.setSystemTime()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`
- Environment variable manipulation uses save/restore pattern:

```typescript
const ORIGINAL_FLAG = process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = ORIGINAL_FLAG;
  }
});
```

## Mocking

**Framework:** `vi` (Vitest built-in)

**Module mocking — CRITICAL ORDER RULE:**
`vi.mock()` calls must appear BEFORE the module import. Use `vi.hoisted()` when mock values need to be referenced post-import:

```typescript
// Pattern 1: Simple mock (before import)
vi.mock("../lib/ai/core/execute", () => ({
  executeAIOperation: vi.fn(),
}));
import { executeAIOperation } from "../lib/ai/core/execute";
const mockExecute = vi.mocked(executeAIOperation);

// Pattern 2: vi.hoisted for cross-reference
const { mockDownloadWithMetadata } = vi.hoisted(() => ({
  mockDownloadWithMetadata: vi.fn(),
}));
vi.mock("../lib/utils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, downloadWithMetadata: mockDownloadWithMetadata };
});
```

**Global mocking:**
```typescript
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
// ... afterEach: vi.unstubAllGlobals()
```

**Zustand store mocking:**
```typescript
vi.mock("../lib/store", () => ({
  useKeywordExpansionStore: {
    getState: () => ({ expandQuery: (query: string) => ({ expandedQuery: query, warnings: [] }) }),
  },
}));
```

**Convex context mocking (for non-convex-test unit tests):**
```typescript
function createMockCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue(undefined),
    scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
  };
}

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

**What to Mock:**
- External dependencies with side effects: `fetch`, Stripe API, Convex internal functions
- Zustand stores when testing code that reads from them outside React context
- Modules with env-var-gated behavior (use `vi.resetModules()` + dynamic `import()` instead)
- `vi.fn()` on `db.insert`, `db.query`, etc. when NOT using `convex-test`

**What NOT to Mock:**
- Business logic under test
- Pure utility functions
- Zod schemas (test real parsing behavior)
- `convex-test` provides a real in-memory Convex runtime — do not mock `ctx.db` in convex tests

## Fixtures and Factories

**Test Data (factory functions pattern):**
```typescript
// Standalone factory functions at module level
function createPaper(id: string, title = `Paper ${id}`, abstract = `Abstract for ${id}`): BatchPaper {
  return { id, title, abstract };
}

function createUsage(input = 100, output = 50): Usage {
  return { promptTokens: input, completionTokens: output, inputTokens: input, outputTokens: output };
}

function makeSub(overrides: Partial<any> = {}): any {
  return { _id: "sub_default", plan: "free", status: "active", ...overrides };
}

function makeStripeEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return { id: "evt_test_123", type: "invoice.paid", ...overrides } as unknown as Stripe.Event;
}
```

**Convex seeding (using convex-test):**
```typescript
async function seedUserWithCredits(t: ReturnType<typeof convexTest>, freeBalance: number, paidBalance: number) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "clerk_credit_test", email: "credit@test.com", state: "active" as const, ... });
    const creditsId = await ctx.db.insert("credits", { userId, freeBalance, paidBalance, ... });
    return { userId, creditsId };
  });
}
```

**Location:**
- Factory helpers defined locally in each test file (no shared fixtures directory)
- `tests/live-billing/support.ts` is the exception — a large shared utility file for live billing tests

## Coverage

**Requirements:** None enforced (no coverage thresholds configured in `vitest.config.ts`)

**View Coverage:**
```bash
npx vitest run --coverage    # Generate coverage report (requires @vitest/coverage-v8)
```

## Test Types

**Unit Tests (`tests/*.test.ts`):**
- Pure function logic: filters, billing calculations, AI cost math, search param serialization
- Zod schema validation
- Environment variable gating (via `vi.resetModules()` + dynamic import)
- State machine behavior
- Error boundary conditions

**Convex Backend Tests (`convex/**/*.test.ts`):**
- Use `convex-test` library with real in-process Convex runtime
- Run in `edge-runtime` environment
- Test mutations, queries, and internal functions directly via `internal.path.to.function`
- Verify database state after operations with `t.run(async (ctx) => ctx.db.get(id))`
- Test concurrency and OCC invariants using `Promise.allSettled`

**Live Integration Tests (`tests/live-billing/*.test.ts`):**
- Excluded from default `npm test` run; require explicit `test:billing:live` command
- Use real Stripe test mode + real Convex deployment
- 300-second timeout configured
- Shared support utilities in `tests/live-billing/support.ts`

**E2E Tests (`e2e/*.spec.ts`):**
- Playwright with `@clerk/testing/playwright` for auth
- Test against running Next.js dev/production server
- Auth E2E: `e2e/auth.spec.ts` — sign-in/sign-out/redirect behavior

## Common Patterns

**Async Testing:**
```typescript
it("throws INSUFFICIENT_CREDITS when balance is insufficient", async () => {
  const t = convexTest(schema);
  const { userId } = await seedUserWithCredits(t, 10, 5);

  await expect(
    t.mutation(internal.credits.internal.deductCredits, { userId, amount: 20 })
  ).rejects.toThrow("INSUFFICIENT_CREDITS");
});
```

**Parameterized Tests (it.each):**
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

**Feature Flag / Env-Gated Module Testing:**
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

**Concurrent/OCC Testing (Convex):**
```typescript
it("OCC prevents negative balances under concurrent deductions", async () => {
  const promises = Array.from({ length: 8 }, (_, i) =>
    t.mutation(internal.credits.internal.deductCredits, { userId, amount: 30, description: `concurrent-${i}` })
  );
  const results = await Promise.allSettled(promises);
  const successes = results.filter((r) => r.status === "fulfilled");
  expect(successes.length).toBeLessThanOrEqual(3);
  // Verify balance never goes negative
  const credits = await t.run(async (ctx) => ctx.db.get(creditsId));
  expect(credits!.freeBalance).toBeGreaterThanOrEqual(0);
});
```

**XSS/Security Testing:**
```typescript
describe("XSS safety", () => {
  it("treats script tags as literal text, not executable HTML", () => {
    const result = splitTextByQuery('<script>alert("xss")</script>', "script");
    const allText = result.map((s) => s.text).join("");
    expect(allText).toBe('<script>alert("xss")</script>');
  });
});
```

**Spy/Call Verification:**
```typescript
expect(mockExecute).toHaveBeenCalledOnce();
expect(mockExecute).toHaveBeenCalledWith(
  expect.objectContaining({
    input: { title: "Paper p1", abstract: "Abstract for p1", questions: [...] },
  })
);
```

---

*Testing analysis: 2026-03-04*
