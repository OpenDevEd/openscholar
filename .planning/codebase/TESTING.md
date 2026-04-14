# Testing Patterns

**Analysis Date:** 2026-04-14

## Test Framework

**Runner:**
- Vitest `^3.2.4`
- Configs:
  - `vitest.config.ts` — primary config for unit, integration, and Convex tests
  - `vitest.live.config.ts` — separate config for long-running live billing tests (300s timeouts)
- Playwright `^1.58.2` for browser-based end-to-end tests
  - Config: `playwright.config.ts`
  - Test directory: `e2e/`
  - Two named projects: `default` and `billing` (the latter is serial, longer-timeout, locale-pinned)

**Assertion Library:**
- Built-in Vitest expect (Jest-compatible matchers)
- `@testing-library/jest-dom` matchers extended via `tests/setup.ts` (`import "@testing-library/jest-dom/vitest"`)

**Run Commands:**
```bash
npm run test                          # Run all unit/integration tests (vitest run)
npm run test:billing:preflight        # Validate Stripe/Convex env before live billing
npm run test:billing:live             # Run required live billing regressions
npm run test:billing:extended         # Run extended live billing scenarios
npm run test:billing:e2e              # Playwright billing E2E project
npm run test:e2e:auth                 # Playwright auth flow only (e2e/auth.spec.ts)
npm run test:ci                       # Full unit + build + auth E2E (CI gate)
npm run test:all                      # CI gate + billing E2E
```

## Test File Organization

**Location pattern (mixed):**
- Co-located unit tests next to source for Convex modules (e.g., `convex/library/queries.test.ts`, `convex/wallet/wallet.test.ts`, `convex/credits/deduct-credits.test.ts`)
- Centralized `tests/` directory for application-level unit and integration tests (97 files at the time of analysis)
- Subdirectories inside `tests/` for grouping:
  - `tests/components/` — React component unit tests (jsdom)
  - `tests/extraction/` — extraction-specific integration tests
  - `tests/library/` — library helper tests
  - `tests/factories/` — shared test factories (not test files themselves)
  - `tests/live-billing/` — long-running Stripe/Convex live regression tests
- Playwright specs live under `e2e/` (`e2e/auth.spec.ts`, `e2e/billing/specs/*`)

**Naming:**
- Vitest tests use `*.test.ts` / `*.test.tsx`
- Playwright tests use `*.spec.ts`

**Structure:**
```
tests/
├── setup.ts                          # Jest-DOM extension + RTL cleanup hook
├── factories/                        # Reusable mock builders
│   ├── index.ts
│   ├── convex-context.ts
│   ├── convex-ids.ts
│   └── stripe-events.ts
├── components/                       # React component tests (jsdom)
│   └── grouped-answer-row.test.tsx
├── extraction/                       # Feature-area integration
├── library/                          # Library helpers
├── live-billing/                     # Long-running live billing regressions
│   ├── required.test.ts
│   ├── extended.test.ts
│   └── support.ts
├── auth-state-machine.test.ts        # Mocked unit tests
├── credit-grant-policy.test.ts
├── ai-cost.test.ts
└── ... (97 files total)
convex/
├── library/queries.test.ts           # Co-located Convex test (convexTest)
├── wallet/wallet.test.ts
├── credits/deduct-credits.test.ts
└── extraction/job-stats.test.ts
e2e/
├── auth.spec.ts                      # Playwright clerk auth flows
├── global.setup.ts                   # Clerk user provisioning
└── billing/                          # Billing E2E flows
    ├── fixtures.ts
    ├── pages/
    ├── specs/
    ├── stripe-helpers.ts
    └── webhook-waiter.ts
```

## Vitest Environment Routing

`vitest.config.ts` selects environment per file glob via `environmentMatchGlobs`:

| Glob | Environment | Reason |
|---|---|---|
| `convex/**/*.test.ts` | `edge-runtime` | Required by `convex-test` |
| `tests/hooks/**/*.test.ts(x)` | `jsdom` | DOM APIs for React hooks |
| `tests/components/**/*.test.tsx` | `jsdom` | RTL component rendering |
| `tests/*.test.tsx` (root level) | `jsdom` | Top-level component test files |
| Everything else | `node` | Pure logic & policy tests |

Notes:
- `convex-test` is force-inlined via `server.deps.inline: ["convex-test"]`
- Live billing tests excluded from default config: `exclude: ["tests/live-billing/**/*.test.ts"]`
- Path alias `@/*` mirrored from `tsconfig.json`

## Test Setup

`tests/setup.ts`:
```ts
// Extend Vitest expect with jest-dom matchers (safe everywhere)
import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";

// Cleanup React Testing Library renders after each test
afterEach(async () => {
  if (typeof globalThis.document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
```

## Test Structure

**Suite organization:**
```ts
import { describe, it, expect, vi } from "vitest";
import { processClerkWebhookEvent } from "../convex/webhooks/clerk";

describe("clerk webhook handler", () => {
  it("dispatches user.created to upsert mutation", async () => {
    const mutationRefs = {
      upsertUserFromClerk: Symbol("upsertUserFromClerk"),
      markUserDeletedFromClerk: Symbol("markUserDeletedFromClerk"),
    };
    const runMutation = vi.fn().mockImplementation(...);

    const outcome = await processClerkWebhookEvent({ ... });

    expect(outcome).toEqual({ status: 200, body: "OK" });
    expect(runMutation).toHaveBeenCalledTimes(1);
  });
});
```

**Patterns observed:**
- Single top-level `describe` per behavior under test, with nested `describe` blocks for grouped scenarios (see `convex/credits/deduct-credits.test.ts` which nests `describe("single deduction")` inside `describe("deductCredits")`)
- Test names start with a verb describing observable behavior ("returns", "throws", "dispatches", "renders", "rejects")
- `it.each(pricingCases)` for parameterized tests (`tests/ai-cost.test.ts`)
- For sequenced live tests: `describe.sequential(...)` with `beforeAll` / `beforeEach` / `afterAll` lifecycle hooks (`tests/live-billing/required.test.ts`)

**Async error testing:**
```ts
try {
  await requireAuth(ctx);
  expect.fail("Should have thrown");
} catch (err) {
  expect(err).toBeInstanceOf(ConvexError);
  const convexErr = err as ConvexError<{ code: string; message: string }>;
  expect(convexErr.data.code).toBe("FORBIDDEN");
}
```
(See `tests/auth-state-machine.test.ts` for the canonical example.)

## Mocking

**Framework:** Vitest `vi.fn()`, `vi.mock()`, `vi.spyOn()`

**Module mocks (top of file):**
```ts
// Mock i18n — return key as value
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock icons
vi.mock("lucide-react", () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
}));

// Mock heavy children to avoid deep-render chains in component tests
vi.mock("../components/extraction/bar-visualization", () => ({
  BarVisualization: ({ answers }: { answers: unknown[] }) => (
    <div data-testid="bar-visualization-mock" data-answer-count={answers.length} />
  ),
}));
```
(See `tests/components/grouped-answer-row.test.tsx`, `tests/extraction-insights-overview.test.tsx`, `tests/extraction-insights-question-panel.test.tsx`.)

**Function-reference mocks (Convex):**
```ts
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
Symbols are used as opaque function-reference stand-ins so the handler can identify which Convex internal it dispatched to without importing the real `internal.*` ref.

**What to Mock:**
- External SDKs (`next-intl`, `lucide-react`, dynamic imports like `BarVisualization`)
- Auth identity (`createMockIdentity`)
- Convex contexts (`createMockQueryCtx`, `createMockMutationCtx`, `createMockActionCtx` from `tests/factories/convex-context.ts`)
- Heavy/expensive child components in component tests
- Convex function references via `Symbol` placeholders for unit-level dispatch tests

**What NOT to Mock:**
- Logic under test
- Pure functions (test directly with literal inputs)
- The Convex DB layer in tests using `convexTest()` — use real seeded data via `t.run(...)` instead

## Fixtures and Factories

**Centralized factories:** `tests/factories/`

**Convex context factories (`tests/factories/convex-context.ts`):**
- `createMockQueryCtx(overrides?)` — returns a `QueryCtx` with mocked `db.query(...).withIndex(...).unique()` and `auth.getUserIdentity()`
- `createMockMutationCtx(overrides?)` — extends QueryCtx with `db.insert/patch/delete/replace` and `scheduler.runAfter/runAt`
- `createMockActionCtx(overrides?)` — has `runMutation`, `runAction`, `scheduler`, `auth`
- All factories accept a `DeepPartial<T>` overrides argument and use a `deepMerge` helper (overrides win, no array merging)
- `createMockIdentity(overrides?)` — stub Clerk identity object

**Branded ID and Doc factories (`tests/factories/convex-ids.ts`):**
```ts
export function mockId<T extends TableNames | SystemTableNames>(table: T, suffix = "1"): Id<T> {
  return `mock_${table}_${suffix}` as unknown as Id<T>;
}

export function createMockUser(overrides?: UserOverrides): Doc<"users"> { ... }
export function createMockSubscription(overrides?: SubscriptionOverrides): Doc<"subscriptions"> { ... }
```

**Stripe factories (`tests/factories/stripe-events.ts`):**
- `createMockStripeEvent`, `createMockStripeInvoice`
- `createMockMutationRefs()` and `createMockGrantRefs()` for typed `FunctionReference<"mutation" | "action", "internal">` placeholders

**Seed helpers (per-test-file pattern for Convex tests):**
Files using `convex-test` define local `seedUser`, `seedUserWithCredits`, `seedWalletKey`, `seedJobWithPapers` helpers. These run inside `t.run(async (ctx) => ctx.db.insert(...))` so they exercise the real schema. Each test file owns its own seeds rather than importing them globally — keeps tests close to the schema they verify.

## Coverage

**Requirements:**
- No coverage threshold enforced in `vitest.config.ts`
- CI gate is `npm run test:ci` (unit + build + auth E2E) — coverage is informational only

**View Coverage:**
```bash
npx vitest run --coverage
```

## Test Types

**Unit tests:**
- Pure logic (`tests/ai-cost.test.ts`, `tests/credit-grant-policy.test.ts`, `tests/extraction-i18n-coverage.test.ts`)
- React components in jsdom (`tests/components/grouped-answer-row.test.tsx`, `tests/extraction-insights-overview.test.tsx`)
- Convex handlers with mocked context (`tests/auth-state-machine.test.ts`, `tests/clerk-webhook-handler.test.ts`)

**Integration tests:**
- Convex modules using real schema via `convexTest(schema)` (`convex/library/queries.test.ts`, `convex/credits/deduct-credits.test.ts`, `convex/wallet/wallet.test.ts`, `convex/extraction/job-stats.test.ts`)
- Use `t.run(async ctx => ...)` to seed data and `t.mutation(internal.X.Y, args)` / `t.query(api.X.Y, args)` to invoke
- Use `t.withIdentity({ subject: "clerk_user1" })` to simulate authenticated requests
- Some "integration" tests verify source code shape via `readFileSync` and regex checks (`tests/extraction/rate-limit.test.ts`, `tests/credit-grant-policy.test.ts`) — useful for enforcing structural invariants without runtime instantiation

**Source-shape tests:**
Pattern: read a `.ts` source file with `node:fs` and assert against its text content. Used to lock in:
- Validator argument shape (e.g., `convex/lib/rateLimit.ts` must use `v.union(v.literal(...))` for the `consume` mutation `name` arg)
- Cross-file enforcement (e.g., `convex/credits/internal.ts` must reference `classifyMonthlyCreditInvoice` and `markStripeEventFailed`)
- "No `as any`" budget enforcement

**Live billing tests (`tests/live-billing/`):**
- Real Stripe API + real Convex deployment
- Uses Stripe test clocks, customers, payment methods (`createClockedCustomer`, `attachDefaultVisaPaymentMethod`)
- 300-second test/hook timeouts via `vitest.live.config.ts`
- Sequenced via `describe.sequential(...)`
- Persistent artifact logging (`appendBillingArtifactLog`, `writeBillingArtifactJson`)
- Per-test cleanup via `cleanupStripeForTestUser` and `resetBillingStateForUser`
- Optional Convex code push gated by `BILLING_LIVE_PUSH_CONVEX=true`

**E2E tests (`e2e/`):**
- Playwright + `@clerk/testing/playwright`
- Global setup (`e2e/global.setup.ts`):
  - Loads `.env.local` / `.env` via `process.loadEnvFile`
  - Calls `clerkSetup()`
  - Provisions a disposable Clerk user via `createClerkClient(...).users.{getUserList,createUser,updateUser,deleteUser}` to ensure deterministic state
  - Cleans up duplicate test users
- Playwright config:
  - `webServer` runs `npm run build && npm run start -- --port 3000` (override via `PLAYWRIGHT_WEB_SERVER_COMMAND`)
  - `baseURL` from `E2E_BASE_URL` (default `http://127.0.0.1:3000`)
  - CI: 2 retries, single worker, `github` reporter
  - Trace `retain-on-failure`, screenshot `only-on-failure`, video `retain-on-failure`
- Two projects:
  - `default` — ignores `**/billing/**`
  - `billing` — only `e2e/billing/`, serial workers, longer timeout, `en-US` locale

## Common Patterns

**Async testing:**
```ts
it("returns paginated results for authenticated user", async () => {
  const t = convexTest(schema);
  const user = await seedUser(t, "clerk_user1", "user1@test.com");
  const asUser = t.withIdentity({ subject: "clerk_user1" });

  await seedLibraryItem(t, user!._id, { title: "Paper A", savedAt: 1000 });

  const result = await asUser.query(api.library.queries.browseLibrary, { ... });
  expect(result.items).toHaveLength(1);
});
```

**Error testing (ConvexError discriminated codes):**
```ts
try {
  await requireAuth(ctx);
  expect.fail("Should have thrown");
} catch (err) {
  expect(err).toBeInstanceOf(ConvexError);
  const convexErr = err as ConvexError<{ code: string; message: string }>;
  expect(convexErr.data.code).toBe("FORBIDDEN");
  expect(convexErr.data.message).toBe("Account suspended");
}
```

**Component interaction:**
```ts
import { render, screen, fireEvent } from "@testing-library/react";

render(<GroupedAnswerRow group={multiVariantGroup} />);
fireEvent.click(screen.getByRole("button"));
expect(screen.getByText("True")).toBeTruthy();
```

**Source-shape assertion:**
```ts
const source = fs.readFileSync(path.resolve(process.cwd(), "convex/lib/rateLimit.ts"), "utf-8");
expect(source).toContain('v.literal("start-extraction")');
expect(source).not.toMatch(/name:\s*v\.string\(\)/);
```

**Parameterized cases:**
```ts
const pricingCases = [
  { label: "cheap model", pricing: { input: 0.05, output: 0.4 } },
  { label: "mid-range model", pricing: { input: 0.25, output: 1.25 } },
];

it.each(pricingCases)("returns correct cost for $label", ({ pricing }) => {
  const cost = calculateCostInDollars({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, pricing);
  expect(cost).toBeCloseTo(pricing.input + pricing.output, 6);
});
```

**Live test lifecycle:**
```ts
describe.sequential("live billing required regressions", () => {
  let userId: string;

  beforeAll(async () => {
    resetBillingArtifacts();
    const ensured = await ensureBillingTestUser({ env, push: env.shouldPushConvexCode });
    userId = ensured.userId;
  });

  beforeEach(async () => {
    await cleanupStripeForTestUser({ stripe, ... });
    await resetBillingStateForUser(userId);
  });

  afterAll(async () => {
    const finalSnapshot = await getBillingSnapshotForUser(userId);
    writeBillingArtifactJson("final-snapshot.json", finalSnapshot);
  });
});
```

## Test Counts (snapshot)

- 97 Vitest test files under `tests/`
- 13 co-located Convex test files under `convex/`
- 1 auth E2E spec (`e2e/auth.spec.ts`) plus billing specs under `e2e/billing/specs/`
- 2 live-billing test files (`tests/live-billing/required.test.ts`, `tests/live-billing/extended.test.ts`)

---

*Testing analysis: 2026-04-14*
