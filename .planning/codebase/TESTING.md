# Testing Patterns

**Analysis Date:** 2026-02-27

## Test Framework

**Runner:**
- Vitest 3.x
- Standard config: `vitest.config.ts`
- Live billing config: `vitest.live.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`)

**Run Commands:**
```bash
npm test                          # Run all unit tests (excludes live-billing)
npm run test:billing:live         # Live billing required regressions
npm run test:billing:extended     # Live billing extended scenarios
npm run test:e2e:auth             # Playwright E2E auth tests
npm run test:ci                   # Full CI: unit tests + build + E2E
```

## Test File Organization

**Location:**
- Unit/integration tests: flat `tests/` directory at project root
- Live billing tests: `tests/live-billing/` subdirectory
- E2E tests: `e2e/` directory
- No co-located test files (tests are not placed alongside source files)

**Naming:**
- Unit tests: `kebab-case.test.ts` (e.g., `clerk-webhook-handler.test.ts`, `free-credit-cap-policy.test.ts`)
- Some tests use underscores matching domain conventions: `grant_diagnostics_user_scope.test.ts`, `invoice_hydration_resolution.test.ts`
- E2E tests: `kebab-case.spec.ts` (e.g., `auth.spec.ts`)
- Shared support: `support.ts` (in `tests/live-billing/support.ts`)

**Structure:**
```
tests/
├── *.test.ts                  # Unit/integration tests (vitest.config.ts)
└── live-billing/
    ├── required.test.ts       # Required billing regressions (vitest.live.config.ts)
    ├── extended.test.ts       # Extended billing scenarios
    └── support.ts             # Shared billing test infrastructure

e2e/
├── auth.spec.ts               # Playwright E2E auth flows
└── global.setup.ts            # Global test setup (Clerk user provisioning)
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it } from "vitest";
import { myFunction } from "../path/to/module";

describe("domain or feature name", () => {
  it("describes the behavior in plain English", () => {
    const result = myFunction(input);
    expect(result).toBe(expected);
  });
});
```

**Describe naming convention:**
- Use plain descriptive names matching feature area: `"AI credit billing helpers"`, `"toast error resolver"`, `"locale detection"`, `"subscription cancellation policy"`
- No deep nesting — one level of `describe` with flat `it` blocks

**Test naming convention:**
- `it("returns X when Y")` — outcome-first language
- `it("dispatches X to Y")` — behavior descriptions
- `it("X remains idempotent for Y")` — property-based descriptions

**Patterns:**
- Arrange-Act-Assert (no explicit labels, but consistent structure)
- Pure function tests: call function, assert on return value
- No test setup/teardown unless testing env-variable-dependent behavior

## Mocking

**Framework:** `vi` from vitest

**Patterns:**

Dependency injection via function arguments (preferred pattern — avoids `vi.mock`):
```typescript
const runMutation = vi
  .fn()
  .mockImplementation(async (mutation: unknown, _args: unknown) => {
    if (mutation !== mutationRefs.upsertUserFromClerk) {
      throw new Error("expected upsertUserFromClerk mutation");
    }
    return null;
  });

const outcome = await processClerkWebhookEvent({
  eventId: "evt_1",
  eventType: "user.created",
  data: { ... },
  runMutation,
  mutationRefs,
});
```

Environment variable mocking via `vi.resetModules()` + dynamic import:
```typescript
async function loadModule() {
  vi.resetModules();
  return import("../convex/lib/creditTopups");
}

afterEach(() => {
  // Restore original env values
  if (ORIGINAL_VALUE === undefined) {
    delete process.env.MY_ENV_VAR;
  } else {
    process.env.MY_ENV_VAR = ORIGINAL_VALUE;
  }
});

it("reads env var at module load time", async () => {
  process.env.MY_ENV_VAR = "false";
  const module = await loadModule();
  expect(module.someFunction()).toBe(false);
});
```

Symbol-based mutation reference tracking (for Convex webhook tests):
```typescript
const mutationRefs = {
  upsertUserFromClerk: Symbol("upsertUserFromClerk"),
  markUserDeletedFromClerk: Symbol("markUserDeletedFromClerk"),
};
```

**What to Mock:**
- External services injected as function parameters (Convex `runMutation`, Stripe client)
- Environment variables that control module behavior at load time (feature flags, config values)

**What NOT to Mock:**
- Pure utility functions — test them directly
- Internal module logic — restructure code to be testable via DI instead

## Fixtures and Factories

**Test Data — inline literals (most common pattern):**
```typescript
const evidencePool = [
  {
    unit: {
      evidenceId: "ev_2_120_280_abc123",
      page: 2,
      charRange: [120, 280] as [number, number],
      text: "The assessment identified approximately 650 studies...",
      section: "methods",
      tokens: ["assessment", "identified", "650", "studies"],
      anchorConfidence: 1,
      source: "pdfjs_chunks",
    },
    denseScore: 0.72,
    lexicalScore: 1.46,
    fusedScore: 0.031,
  },
];
```

**Live billing fixtures — factory functions from `tests/live-billing/support.ts`:**
```typescript
const { clockId, customerId } = await createClockedCustomer({ stripe, testUserEmail, userId, subjectMarker });
const paymentMethodId = await attachDefaultVisaPaymentMethod({ stripe, customerId });
const { subscriptionId, invoiceId } = await createGoSubscription({ stripe, customerId, ... });
```

**Location:**
- Inline within test files for unit tests
- `tests/live-billing/support.ts` for live billing shared infrastructure

## Coverage

**Requirements:** None enforced — no coverage threshold configured in `vitest.config.ts`

**View Coverage:**
```bash
# Not configured — would need to add --coverage flag
npx vitest run --coverage
```

## Test Types

**Unit Tests (`tests/*.test.ts`):**
- Test pure functions and business logic in isolation
- No network calls, no database, no external services
- Import directly from `convex/` and `lib/` source files
- Fast execution — run via `npm test` in CI

**Integration Tests (pattern within `tests/`):**
- Some tests exercise multiple collaborating functions (e.g., `extraction-v3-integration.test.ts` tests `validateSupportEvidenceIds` + `applyEvidencePolicy` together)
- Still no external dependencies — all pure function composition

**Live Billing Tests (`tests/live-billing/*.test.ts`):**
- Require real Stripe test keys and a live Convex deployment
- Excluded from standard `npm test` run — use `vitest.live.config.ts`
- Use `describe.sequential` to enforce ordered test execution
- `beforeAll` / `beforeEach` / `afterAll` hooks manage billing state and cleanup
- Poll for webhook delivery via `waitForCondition()` with configurable timeout (default 180s per condition)
- Artifacts written to `test-results/billing-live/` for CI inspection
- Separate env loading via `loadBillingLiveEnv()` from support module

**E2E Tests (`e2e/*.spec.ts`):**
- Playwright with `@clerk/testing/playwright` for auth flows
- Global setup in `e2e/global.setup.ts` provisions a real Clerk test user
- Tests run against a built and running Next.js server
- Uses `clerk.signIn()` / `clerk.signOut()` helpers for auth state management
- CI: retries=2, workers=1, sequential; local: no retries
- Artifacts: trace, screenshot, and video on failure

## Common Patterns

**Async Testing:**
```typescript
it("dispatches user.created to upsert mutation", async () => {
  const runMutation = vi.fn().mockResolvedValue(null);
  const outcome = await processClerkWebhookEvent({ ... });
  expect(outcome).toEqual({ status: 200, body: "OK" });
});
```

**Error/Edge Case Testing:**
```typescript
it("returns 400 for malformed user payload", async () => {
  const outcome = await processClerkWebhookEvent({
    eventType: "user.updated",
    data: { foo: "bar" },  // Invalid payload
    runMutation,
  });
  expect(outcome).toEqual({ status: 400, body: "Invalid user payload" });
  expect(runMutation).not.toHaveBeenCalled();
});
```

**Boundary/Threshold Testing:**
```typescript
it("clamps under-cap additions at the tier cap", () => {
  const result = applyTierFreeCreditCap({ plan: "go", currentFreeBalance: 2_900, amountToAdd: 300 });
  expect(result.newFreeBalance).toBe(3_000);
  expect(result.actualAdded).toBe(100);
});
```

**Polling for async state (live tests only):**
```typescript
const snapshot = await waitForCondition({
  description: `subscription sync + invoice grant for ${subscriptionId}`,
  timeoutMs: env.webhookWaitTimeoutMs,
  check: async () => {
    const current = await getBillingSnapshotForUser(userId);
    return hasSubscription && grantCount === 1 ? current : null;
  },
});
```

**Idempotency Verification:**
```typescript
// Call the same operation twice and verify only one effect occurred
const replayOne = await runConvexFunction({ functionPath: "credits/actions:processInvoiceForGrant", payload: { ... } });
const replayTwo = await runConvexFunction({ functionPath: "credits/actions:processInvoiceForGrant", payload: { ... } });
expect(replayOne.outcome).toBe("already_granted");
expect(replayTwo.outcome).toBe("already_granted");
expect(countGrantTransactionsByInvoice(snapshot, invoiceId)).toBe(1);
```

---

*Testing analysis: 2026-02-27*
