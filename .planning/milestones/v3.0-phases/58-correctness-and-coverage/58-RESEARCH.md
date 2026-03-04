# Phase 58: Correctness and Coverage - Research

**Researched:** 2026-03-04
**Domain:** Convex OCC concurrency testing, env var validation, Stripe API mocking, HTTP fallback chains
**Confidence:** HIGH

## Summary

Phase 58 addresses four correctness and coverage gaps: (1) proving Convex OCC prevents negative credit balances under concurrency, (2) eliminating the silent `admin@example.com` fallback for OpenAlex API calls, (3) testing the subscription correction cron with both expanded and string Stripe customer objects, and (4) testing the GROBID URL discovery fallback chain.

All four targets are well-scoped with clear existing code to modify or test. The existing test infrastructure (`convex-test`, `vitest`, established mocking patterns) covers every case. The primary technical challenge is the subscription cron test -- `checkSubscriptionStatus` is an `internalAction` calling the Stripe API, requiring module-level Stripe mocking combined with `convex-test` DB operations.

**Primary recommendation:** Implement all four items using existing test patterns -- `convex-test` for concurrency and subscription tests, `vi.mock`/`vi.resetModules` for env-var-dependent GROBID and OpenAlex tests, and module-level Stripe mocking for the cron correction test.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **OpenAlex failure mode**: Throw and halt extraction when `OPENALEX_CONTACT_EMAIL` is absent. Validate at point of use (right before the API call), not at startup. Backend error only -- user sees generic extraction failure; admin sees real cause in Convex logs. Test uses `vi.resetModules()` + `process.env` manipulation + re-import.
- **Credit concurrency**: Fire 5-10 concurrent `deductCredits` mutations on same user via `convex-test`. Assert final balance never negative. If OCC proves sufficient, skip per-user workpool. Cover both sufficient-balance and insufficient-balance race scenarios. Add to existing `convex/credits/deduct-credits.test.ts` in new `describe('concurrency')` block.
- **GROBID fallback**: When all endpoints fail, throw descriptive error listing all attempted URLs and failures. Test uses mocked HTTP/fetch. Cover both failure path and happy path (first fails, second succeeds). Test file: `convex/extraction/grobid.test.ts`.
- **Subscription cron test**: Use `convex-test` with real Convex DB operations + mocked Stripe API response. Cover both expanded customer object and string customer ID shapes.

### Claude's Discretion
- Exact number of concurrent mutations in credit stress test (5-10 range)
- Specific error message wording for OpenAlex and GROBID failures
- Whether to extract subscription correction logic into a testable helper or test the full mutation

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CORR-01 | Add concurrency invariant test for credit deduction verifying Convex OCC prevents negative balances; implement per-user workpool only if test reveals gap | `convex-test` supports `Promise.allSettled` with mutations; existing `seedUserWithCredits` helper and `describe('sequential deductions')` block provide the foundation; `deductCredits` mutation has OCC documentation inline |
| CORR-02 | Fix OpenAlex polite pool fallback -- fail loudly or use validated env var instead of `admin@example.com` default | Single line change at `convex/extraction/actions.ts:141`; replace `?? "admin@example.com"` with validation throw; established `vi.resetModules` + env var pattern from `tests/env-validation.test.ts` |
| CORR-03 | Add test for `checkSubscriptionStatus` cron correction path covering both expanded and non-expanded Stripe customer objects | `checkSubscriptionStatus` is an `internalAction` at `convex/maintenance/internal.ts:36`; `convex-test` supports `t.action()`; Stripe must be mocked at module level; correction logic at lines 130-133 handles `typeof fresh.customer === "string"` |
| TEST-02 | Add test for GROBID URL discovery fallback chain when `GROBID_URL` env var is absent and Docker/localhost variants fail | `processFulltextDocumentWithGrobid` is a plain exported function at `convex/extraction/grobid.ts:130`; `resolveCandidateBaseUrls` builds the URL chain; global `fetch` can be mocked with `vi.fn()` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 3.x | Test runner and assertions | Already configured in `vitest.config.ts`; all existing tests use it |
| convex-test | latest | In-memory Convex DB for mutation/action testing | Used by all `convex/**/*.test.ts` files; supports `t.mutation()`, `t.action()`, `t.run()` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest vi.mock | built-in | Module-level mocking for Stripe, fetch | Subscription cron test needs Stripe mock; GROBID test needs fetch mock |
| vitest vi.resetModules | built-in | Re-import modules after env var changes | OpenAlex test needs fresh module import after setting/deleting `OPENALEX_CONTACT_EMAIL` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Testing full `checkSubscriptionStatus` action | Extracting correction logic into pure helper | Extraction creates cleaner tests but adds refactoring; full action test with mocked Stripe is viable and tests more of the real path |
| `convex/extraction/grobid.test.ts` (edge-runtime) | `tests/grobid.test.ts` (node environment) | The vitest config maps `convex/**/*.test.ts` to edge-runtime, but GROBID uses `cheerio` (Node module). Testing in `tests/` with node env avoids edge-runtime/cheerio incompatibility risk |

## Architecture Patterns

### Pattern 1: Concurrent Mutation Testing with convex-test
**What:** Fire multiple mutations via `Promise.allSettled` and verify DB invariants
**When to use:** Testing OCC behavior -- mutations that touch the same document
**Example:**
```typescript
// Source: existing deduct-credits.test.ts pattern + convex-test docs
describe("concurrency", () => {
  it("OCC prevents negative balances under concurrent deductions", async () => {
    const t = convexTest(schema);
    const { userId, creditsId } = await seedUserWithCredits(t, 100, 0);

    // Fire N concurrent deductions that would overdraw if not serialized
    const promises = Array.from({ length: 8 }, (_, i) =>
      t.mutation(internal.credits.internal.deductCredits, {
        userId,
        amount: 30,
        description: `concurrent-${i}`,
      })
    );
    const results = await Promise.allSettled(promises);

    // Some succeed, some fail with INSUFFICIENT_CREDITS
    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    // At most 3 can succeed (100 / 30 = 3.33)
    expect(successes.length).toBeLessThanOrEqual(3);
    expect(failures.length).toBeGreaterThanOrEqual(5);

    // Critical invariant: balance is NEVER negative
    const credits = await t.run(async (ctx) => ctx.db.get(creditsId));
    expect(credits!.freeBalance).toBeGreaterThanOrEqual(0);
    expect(credits!.paidBalance).toBeGreaterThanOrEqual(0);
  });
});
```

**Key insight:** `convex-test` serializes mutations touching the same document (mimicking OCC). `Promise.allSettled` fires all mutations, the test framework serializes them, and each mutation sees the committed state from the previous one. This proves the invariant holds under serialization -- which is exactly what Convex OCC provides in production.

### Pattern 2: Env Var Validation at Point of Use
**What:** Validate env var presence immediately before it is needed, throw if absent
**When to use:** When an env var is optional for the module but required for a specific code path
**Example:**
```typescript
// Source: existing pattern in convex/lib/constants.ts (assertPlanPriceConfig)
const contactEmail = process.env.OPENALEX_CONTACT_EMAIL;
if (!contactEmail) {
  throw new Error(
    "OPENALEX_CONTACT_EMAIL is not configured. Set this env var in the Convex dashboard."
  );
}
const response = await fetch(url, {
  headers: {
    "User-Agent": `OpenAlex-Count/1.0 (mailto:${contactEmail})`,
  },
});
```

### Pattern 3: Module-Level Stripe Mocking for Action Tests
**What:** Mock the Stripe SDK at module level so `convex-test` action calls use fake Stripe responses
**When to use:** Testing `internalAction` handlers that call Stripe API
**Example:**
```typescript
// Source: established vi.mock pattern from TESTING.md
const { mockRetrieve } = vi.hoisted(() => ({
  mockRetrieve: vi.fn(),
}));

vi.mock("stripe", () => {
  return {
    default: class MockStripe {
      subscriptions = { retrieve: mockRetrieve };
    },
  };
});

// In test:
mockRetrieve.mockResolvedValue({
  id: "sub_123",
  status: "active",
  customer: "cus_123", // string form
  items: { data: [{ price: { id: "price_go" }, current_period_end: 1234567890, current_period_start: 1234567800, quantity: 1 }] },
  cancel_at_period_end: false,
  cancel_at: null,
  metadata: {},
});
```

### Pattern 4: Fetch Mocking for GROBID Fallback Chain
**What:** Replace global `fetch` with `vi.fn()` to simulate network failures across multiple URLs
**When to use:** Testing HTTP fallback chains without real servers
**Example:**
```typescript
// Source: standard vitest pattern for global fetch mocking
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// All endpoints fail
mockFetch.mockRejectedValue(new Error("Connection refused"));

await expect(
  processFulltextDocumentWithGrobid(pdfBuffer)
).rejects.toThrow("GROBID parsing failed across");
```

### Anti-Patterns to Avoid
- **Testing OCC by literally racing threads:** `convex-test` does not simulate true parallel execution. It serializes mutations. The test proves the mutation logic is correct under serialization, which is what OCC guarantees. Do not expect `convex-test` to detect races that would only appear without OCC.
- **Mocking inside `t.run()` blocks:** Mocks must be set up before `convex-test` calls, not inside the `t.run()` callback. Module-level `vi.mock` or `beforeEach` setup is required.
- **Placing GROBID test in `convex/` directory:** The `vitest.config.ts` maps `convex/**/*.test.ts` to `edge-runtime`. The `grobid.ts` module uses `cheerio` (Node-only). A test in `convex/extraction/grobid.test.ts` may fail due to missing Node APIs in edge-runtime. Place in `tests/grobid-fallback.test.ts` instead, or adjust vitest config to exclude this specific file from edge-runtime.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrency simulation | Custom thread/worker spawning | `Promise.allSettled` with `t.mutation()` | `convex-test` serializes mutations correctly; custom concurrency adds complexity without value |
| Stripe API mocking | Custom HTTP interceptor | `vi.mock("stripe")` with `vi.hoisted` | Established pattern in codebase; clean, deterministic, no network calls |
| Fetch interception | `nock`, `msw`, or custom proxy | `vi.stubGlobal("fetch", vi.fn())` | GROBID test needs simple fetch replacement; no need for full HTTP interception library |
| Env var isolation | Manual save/restore boilerplate | `vi.resetModules()` + `process.env` manipulation | Existing pattern in `tests/env-validation.test.ts`; handles module-level `process.env` reads |

**Key insight:** Every test in this phase can use existing vitest primitives. No new libraries are needed.

## Common Pitfalls

### Pitfall 1: convex-test Promise.allSettled Serialization Surprise
**What goes wrong:** Developer expects `Promise.allSettled` to prove true concurrent races but `convex-test` serializes all mutations touching the same document.
**Why it happens:** `convex-test` mimics Convex OCC by serializing conflicting transactions. It does not simulate true parallelism.
**How to avoid:** Frame the test as "proving the mutation logic is correct under OCC serialization" not "proving OCC works." The test confirms: given serialized execution order, the invariant (no negative balances) holds.
**Warning signs:** All `Promise.allSettled` results resolve in order, not interleaved.

### Pitfall 2: Module-level process.env Read in grobid.ts
**What goes wrong:** The `DEFAULT_GROBID_URL` is computed at module load time (`const DEFAULT_GROBID_URL = process.env.GROBID_URL || "http://localhost:8070"`). Changing `process.env.GROBID_URL` after import has no effect.
**Why it happens:** JavaScript evaluates `const` at module load, not at function call time.
**How to avoid:** Use `vi.resetModules()` before re-importing `grobid.ts` when testing with different env var values. The `resolveCandidateBaseUrls` function also reads `process.env.GROBID_URL` directly (line 113), so both paths need coverage.
**Warning signs:** Test passes regardless of env var changes because the module cached the old value.

### Pitfall 3: Edge-Runtime Environment for convex/ Test Files
**What goes wrong:** Tests placed in `convex/**/*.test.ts` run in `edge-runtime` environment (per vitest config). Modules using Node-only APIs (`cheerio`, `crypto`, etc.) fail with missing globals.
**Why it happens:** The `environmentMatchGlobs` in `vitest.config.ts` maps all `convex/**/*.test.ts` to `edge-runtime`.
**How to avoid:** For testing plain Node functions from `convex/` (like `grobid.ts`), place the test in `tests/` directory (node environment) rather than `convex/`. The CONTEXT.md suggests `convex/extraction/grobid.test.ts` but this may conflict with edge-runtime. Alternative: the test can mock `cheerio` away since we are testing the fallback chain (fetch behavior), not the XML parsing.
**Warning signs:** `ReferenceError: require is not defined` or `Error: Cannot find module 'cheerio'` in test output.

### Pitfall 4: Stripe Mock Leaking Between Tests
**What goes wrong:** `mockRetrieve` return value from one test case leaks into the next, causing false passes.
**Why it happens:** `vi.mock` is module-level and persists across tests. `mockRetrieve.mockResolvedValue()` set in one test is still active in the next.
**How to avoid:** Use `beforeEach(() => { mockRetrieve.mockReset(); })` or set the mock value at the start of each test case.
**Warning signs:** Tests pass individually but fail when run together, or pass in a different order.

### Pitfall 5: checkSubscriptionStatus Calls assertPlanPriceConfig
**What goes wrong:** The action calls `assertPlanPriceConfig()` at line 46, which throws if `STRIPE_GO_PRICE_ID` or `STRIPE_PRO_PRICE_ID` env vars are not set.
**Why it happens:** The constants module reads env vars at module load time.
**How to avoid:** Set `process.env.STRIPE_GO_PRICE_ID` and `process.env.STRIPE_PRO_PRICE_ID` before importing the module, or mock the constants module.
**Warning signs:** Tests throw "Stripe price IDs are not configured" instead of running the actual test logic.

## Code Examples

Verified patterns from existing codebase:

### Existing seedUserWithCredits Helper
```typescript
// Source: convex/credits/deduct-credits.test.ts lines 11-39
async function seedUserWithCredits(
  t: ReturnType<typeof convexTest>,
  freeBalance: number,
  paidBalance: number
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { /* ... */ });
    const creditsId = await ctx.db.insert("credits", {
      userId, freeBalance, paidBalance, lifetimeUsed: 0, lastUpdatedAt: now,
    });
    return { userId, creditsId };
  });
}
```

### Existing Env Var Test Pattern
```typescript
// Source: tests/env-validation.test.ts lines 14-31
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of REQUIRED_ENV_VARS) {
    originalEnv[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of REQUIRED_ENV_VARS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
  vi.resetModules();
});
```

### OpenAlex Line to Modify
```typescript
// Source: convex/extraction/actions.ts line 141
// BEFORE (current):
"User-Agent": `OpenAlex-Count/1.0 (mailto:${process.env.OPENALEX_CONTACT_EMAIL ?? "admin@example.com"})`,

// AFTER (target):
// Validate before the fetch call:
const contactEmail = process.env.OPENALEX_CONTACT_EMAIL;
if (!contactEmail) {
  throw new Error("OPENALEX_CONTACT_EMAIL is not configured. Set this env var in the Convex dashboard.");
}
// Then use:
"User-Agent": `OpenAlex-Count/1.0 (mailto:${contactEmail})`,
```

### Subscription Customer Type Handling (Already Fixed in Code)
```typescript
// Source: convex/maintenance/internal.ts lines 130-133
// This is the TYPE-02 fix already in place -- test needs to cover both branches:
const stripeCustomerId =
  typeof fresh.customer === "string"
    ? fresh.customer
    : fresh.customer?.id;
```

### GROBID Fallback Chain
```typescript
// Source: convex/extraction/grobid.ts lines 103-123
function resolveCandidateBaseUrls(explicitBaseUrl?: string) {
  const ordered: string[] = [];
  const push = (value?: string) => { /* dedup + normalize */ };
  push(explicitBaseUrl);
  push(process.env.GROBID_URL);
  push(DOCKER_GROBID_URL);   // "http://grobid:8070"
  push(LOCAL_GROBID_URL);    // "http://localhost:8070"
  push(HOST_GROBID_URL);     // "http://host.docker.internal:8070"
  if (ordered.length === 0) push(DEFAULT_GROBID_URL);
  return ordered;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `(fresh.customer as any)?.id` | `typeof fresh.customer === "string" ? ... : ...` | Phase 54 (TYPE-02) | Customer ID extraction is now type-safe; test should cover both branches |
| Sequential deduction tests only | Concurrent via `Promise.allSettled` | Phase 58 (this phase) | Proves OCC invariant under concurrency, not just sequential access |
| Silent `admin@example.com` fallback | Throw on missing env var | Phase 58 (this phase) | Misconfiguration fails fast instead of silently degrading API performance |

## Open Questions

1. **GROBID test file location: `convex/extraction/grobid.test.ts` vs `tests/grobid-fallback.test.ts`**
   - What we know: CONTEXT.md specifies `convex/extraction/grobid.test.ts`. However, `vitest.config.ts` maps `convex/**/*.test.ts` to `edge-runtime`, and `grobid.ts` uses `cheerio` (Node module).
   - What's unclear: Whether `cheerio` works in `convex-test`'s edge-runtime. The GROBID function is NOT a Convex handler -- it's a plain exported function, so `convex-test` is not needed.
   - Recommendation: **Place in `tests/grobid-fallback.test.ts`** (node environment) to avoid edge-runtime issues. The test only needs `vi.stubGlobal("fetch")` and `vi.resetModules()` -- no `convex-test` required. If co-location is strongly preferred, add an override to `vitest.config.ts` `environmentMatchGlobs` for this specific file. This is a Claude's Discretion area for the planner to decide.

2. **checkSubscriptionStatus action test feasibility with convex-test**
   - What we know: `convex-test` supports `t.action()` per its TypeScript types. No existing tests in the codebase use `t.action()`. The action calls Stripe API + `ctx.runMutation` + `ctx.runQuery`.
   - What's unclear: Whether `t.action()` correctly executes `ctx.runMutation`/`ctx.runQuery` calls inside the action, and whether `vi.mock("stripe")` works in edge-runtime.
   - Recommendation: Two viable approaches -- (A) test the full action with `t.action()` + mocked Stripe, or (B) extract the divergence-detection and correction logic into a pure helper and unit-test that. Approach A tests more of the real path. If `t.action()` fails due to `"use node"` or Stripe mock issues, fall back to approach B. This is Claude's Discretion per CONTEXT.md.

## Sources

### Primary (HIGH confidence)
- Existing codebase source files: `convex/credits/internal.ts`, `convex/credits/deduct-credits.test.ts`, `convex/extraction/grobid.ts`, `convex/extraction/actions.ts`, `convex/maintenance/internal.ts`
- `vitest.config.ts` -- environment configuration for test files
- `.planning/codebase/TESTING.md` -- established test patterns and conventions
- `node_modules/convex-test/dist/index.d.ts` -- confirms `t.action()` API exists
- `node_modules/convex-test/dist/index.js:1103` -- confirms mutation serialization behavior ("Nested transactions are not isolated so if you `Promise.all` on multiple `ctx.runMutation` or `ctx.runQuery` calls, they won't be serialized")

### Secondary (MEDIUM confidence)
- `convex-test` concurrency behavior inferred from source code comment about serialization -- the exact behavior of `Promise.allSettled` with top-level `t.mutation()` calls (not nested `ctx.runMutation`) needs runtime verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all tools already in use, no new dependencies
- Architecture: HIGH - patterns directly from existing codebase tests
- Pitfalls: HIGH - identified from concrete vitest config analysis and module-level env var behavior
- GROBID test location: MEDIUM - edge-runtime vs node tradeoff needs runtime verification
- Subscription action test: MEDIUM - `t.action()` with `"use node"` modules untested in this codebase

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain, no external API changes expected)
