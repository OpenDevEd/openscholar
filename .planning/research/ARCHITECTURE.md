# Architecture Research: TDD & Test Coverage Integration

**Domain:** TDD workflow and test coverage backfill for Next.js + Convex app
**Researched:** 2026-02-28
**Confidence:** HIGH (direct codebase analysis — all patterns drawn from existing tests/ and e2e/)

## System Overview

The existing test architecture has two distinct tiers that must remain separate. New v2.0 tests slot into the existing Vitest unit tier and extend it with a thin integration layer.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PLAYWRIGHT E2E LAYER (existing)                      │
│  e2e/auth.spec.ts          e2e/billing/*.spec.ts (7 specs)              │
│  e2e/global.setup.ts       e2e/billing/fixtures.ts                      │
│  Requires: live Clerk + Convex + Next.js + Stripe sandbox               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│               VITEST UNIT / INTEGRATION LAYER (43 files)                 │
│                                                                         │
│  ┌──────────────────┐  ┌────────────────────┐  ┌──────────────────┐    │
│  │  Search/Extract  │  │     AI / LLM       │  │ User Management  │    │
│  │  (lib/extraction │  │  (lib/ai/core/*    │  │ (convex/users/*  │    │
│  │   lib/filters/*  │  │   convex/ai/*      │  │  convex/lib/     │    │
│  │   lib/search/*   │  │   convex/extract/  │  │   auth.ts        │    │
│  │   lib/search-    │  │   prompts.ts)      │  │   userCreation   │    │
│  │   utils.ts)      │  │                    │  │   featureFlags)  │    │
│  └──────────────────┘  └────────────────────┘  └──────────────────┘    │
│                                                                         │
│  vitest.config.ts: environment=node, include=tests/**/*.test.ts         │
│  Excludes: tests/live-billing/**                                        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│              VITEST LIVE-BILLING LAYER (separate config)                 │
│  tests/live-billing/required.test.ts   extended.test.ts                 │
│  vitest.live.config.ts: 300s timeouts, requires Convex + Stripe         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | Test Approach |
|-----------|----------------|---------------|
| `lib/extraction/*` | Filtering, citation panel, feature flags, insights, PDF text | Direct import, env var manipulation via `vi.resetModules()` |
| `lib/filters/*` | Filter builder, filter config, filter types | Direct import, pure function unit tests |
| `lib/search/*`, `lib/search-utils.ts`, `lib/search-actions.ts` | URL-based search state, filter assembly, export logic | Direct import; source-code assertion pattern for export contracts |
| `lib/ai/core/*` | `executeAIOperation`, batch processor, prompt builders, validate, errors | Direct import; mock `LanguageModel` interface |
| `lib/ai/client/*` | Mode routing, providers, executor, hook-factory | Direct import; pure logic, no React |
| `convex/ai/*` | Server-side actions, helpers, credit billing | Direct import from `convex/ai/lib/creditBilling.ts` etc. |
| `convex/extraction/prompts.ts` | `buildEnhancedExtractionPrompt` | Direct import |
| `convex/extraction/workpoolActions.ts` | Evidence policy, abstract-only policy, validation | Direct import of exported pure functions |
| `convex/users/mutations.ts` | `ensureUser`, `updateProfile` | Mock `ctx` object pattern |
| `convex/lib/auth.ts` | `requireAuth`, `getCurrentUser` | Mock `ctx.auth` + `ctx.db` pattern |
| `convex/lib/userCreation.ts` | `createUserWithDefaults` | Mock `ctx.db.insert` |
| `convex/lib/featureFlags.ts` | `requireCreditsEnabled`, etc. | Direct import, env var manipulation |
| `convex/webhooks/clerk.ts` | `processClerkWebhookEvent` | Inject mock `runMutation` (existing pattern) |
| `convex/webhooks/clerk_mappers.ts` | `mapClerkUserToUpsertArgs` etc. | Direct import, pure function |

## Recommended Project Structure

The v2.0 milestone adds no new directories — all new tests go in `tests/` following existing conventions. No new fixture or helper files are needed for unit tests.

```
tests/
├── [existing 40 files — unchanged]
│
│ ── Search & Extraction domain (NEW files)
├── search-filter-builder.test.ts          # lib/filters/filter-builder.ts
├── search-filter-config.test.ts           # lib/filters/filter-config.ts
├── search-params-converters.test.ts       # lib/search-params/* URL parsing
├── search-utils.test.ts                   # lib/search-utils.ts (query building)
├── search-state-actions.test.ts           # lib/search/actions.ts (submitNewSearch)
├── extraction-export.test.ts              # lib/extraction/export.ts
├── extraction-reviews.test.ts             # lib/extraction/reviews.ts
│
│ ── AI / LLM domain (NEW files)
├── ai-execute-operation.test.ts           # lib/ai/core/execute.ts
├── ai-batch-processor.test.ts             # lib/ai/core/batch.ts
├── ai-prompts.test.ts                     # lib/ai/core/prompts.ts
├── ai-validate.test.ts                    # lib/ai/core/validate.ts
├── ai-errors.test.ts                      # lib/ai/core/errors.ts
├── ai-question-key-codec.test.ts          # lib/ai/core/question-key-codec.ts
├── ai-cost.test.ts                        # lib/ai/core/cost.ts
│
│ ── User Management domain (NEW files)
├── user-creation-with-defaults.test.ts    # convex/lib/userCreation.ts
├── user-auth-state-machine.test.ts        # convex/lib/auth.ts (requireAuth states)
├── user-feature-flag-guards.test.ts       # convex/lib/featureFlags.ts
├── user-plan-enforcement.test.ts          # convex/lib/freeCredits.ts + constants
├── user-ensure-user-mutation.test.ts      # convex/users/mutations.ts:ensureUser
│
│ ── Integration tests (NEW files)
├── integration-ai-credit-flow.test.ts     # AI call -> credit deduction -> balance
└── integration-search-export-format.test.ts  # Filter state -> export shape
│
tests/live-billing/                        # UNCHANGED — separate Vitest config
├── required.test.ts
├── extended.test.ts
└── support.ts
```

### Structure Rationale

- **Flat `tests/` directory:** Matches the existing 40-file convention. No subdirectory grouping exists and adding one now would split the test surface inconsistently. Prefix naming (`search-`, `ai-`, `user-`) provides enough grouping.
- **No new test helpers or fixtures:** Every existing test uses direct imports and inline mocks. Introducing a shared helpers file would be inconsistent with the established pattern and create a dependency that complicates TDD's red-green cycle.
- **Integration tests stay in `tests/`:** They run with the same `vitest run` command and same config. The distinction from unit tests is conceptual (they wire two modules together), not structural.

## Architectural Patterns

### Pattern 1: Direct Import Unit Test (primary pattern — use for all pure functions)

**What:** Import the module directly and call it with plain data. No framework. No mocks unless the module calls external I/O.

**When to use:** Any pure function in `lib/` or `convex/lib/` that takes data and returns data. Covers ~80% of v2.0 test targets.

**Trade-offs:** Fast, no setup overhead, easy to write in TDD style. Cannot test modules that call `ctx.db` or `ctx.auth` without the mock context pattern.

```typescript
// tests/ai-validate.test.ts
import { describe, expect, it } from "vitest";
import { validateQuery, repairJSON } from "../lib/ai/core/validate";

describe("validateQuery", () => {
  it("throws on unbalanced parentheses", () => {
    expect(() => validateQuery("(term AND other")).toThrow("unbalanced parentheses");
  });

  it("throws when query ends with operator", () => {
    expect(() => validateQuery("machine AND")).toThrow("incomplete operator");
  });

  it("passes a valid boolean query unchanged", () => {
    const q = "(machine OR deep) AND learning";
    expect(validateQuery(q)).toBe(q);
  });
});
```

### Pattern 2: Environment Variable Gate Test (for feature flags and env-dependent branches)

**What:** Manipulate `process.env.*` before import, use `vi.resetModules()` to force module re-evaluation, restore env in `afterEach`.

**When to use:** Any module whose behavior branches on `NEXT_PUBLIC_*` env vars. Established in `extraction-filtering.test.ts`, `extraction-citation-panel.test.ts`, `extraction-feature-flags.test.ts`.

**Trade-offs:** `vi.resetModules()` requires async dynamic imports per test case. Slightly verbose but completely reliable.

```typescript
// tests/user-feature-flag-guards.test.ts
import { afterEach, describe, expect, it } from "vitest";

const ORIG = process.env.NEXT_PUBLIC_CREDITS_ENABLED;

async function loadModule() {
  vi.resetModules();
  return import("../convex/lib/featureFlags");
}

afterEach(() => {
  if (ORIG === undefined) delete process.env.NEXT_PUBLIC_CREDITS_ENABLED;
  else process.env.NEXT_PUBLIC_CREDITS_ENABLED = ORIG;
});

describe("requireCreditsEnabled", () => {
  it("throws when NEXT_PUBLIC_CREDITS_ENABLED is 'false'", async () => {
    process.env.NEXT_PUBLIC_CREDITS_ENABLED = "false";
    const { requireCreditsEnabled } = await loadModule();
    expect(() => requireCreditsEnabled()).toThrow("disabled");
  });

  it("does not throw when NEXT_PUBLIC_CREDITS_ENABLED is unset", async () => {
    delete process.env.NEXT_PUBLIC_CREDITS_ENABLED;
    const { requireCreditsEnabled } = await loadModule();
    expect(() => requireCreditsEnabled()).not.toThrow();
  });
});
```

### Pattern 3: Injected Mock Context (for Convex mutations and queries)

**What:** Create a minimal `ctx` object that stubs only the methods the unit under test actually calls. Use `vi.fn()` for `ctx.db.insert`, `ctx.db.query`, `ctx.auth.getUserIdentity`.

**When to use:** Testing `convex/users/mutations.ts`, `convex/lib/auth.ts`, `convex/lib/userCreation.ts` — any function that takes a Convex context as its first argument.

**Trade-offs:** Tests the handler logic in isolation from the actual Convex runtime. Cannot catch schema validation errors or index mismatches — those require live integration tests. But covers the logical branches (suspended user, missing user, state transitions) cleanly.

```typescript
// tests/user-auth-state-machine.test.ts
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../convex/lib/auth";

function makeCtx(overrides: {
  identity?: object | null;
  user?: object | null;
}) {
  return {
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(
        overrides.identity !== undefined
          ? overrides.identity
          : { subject: "clerk_123" }
      ),
    },
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          unique: vi.fn().mockResolvedValue(overrides.user ?? null),
        }),
      }),
    },
  } as any;
}

describe("requireAuth", () => {
  it("throws UNAUTHENTICATED when no identity", async () => {
    const ctx = makeCtx({ identity: null });
    await expect(requireAuth(ctx)).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  it("throws FORBIDDEN when user is suspended", async () => {
    const ctx = makeCtx({ user: { state: "suspended", clerkId: "clerk_123" } });
    await expect(requireAuth(ctx)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  it("returns user when active", async () => {
    const user = { _id: "user_1", state: "active", clerkId: "clerk_123" };
    const ctx = makeCtx({ user });
    await expect(requireAuth(ctx)).resolves.toEqual(user);
  });
});
```

### Pattern 4: Mock runMutation Injection (for Convex webhook dispatchers)

**What:** Pass a `vi.fn()` mock as the `runMutation` argument. The handler is already extracted to a pure function (see `convex/webhooks/clerk.ts`). Verify which mutation was called with which args.

**When to use:** Already established for `clerk-webhook-handler.test.ts`. Apply the same pattern to any new webhook handler or action that accepts its dependencies as arguments.

**Trade-offs:** Requires that the production code accepts its dependencies as arguments (dependency injection) rather than importing them directly. This is a good design constraint that TDD enforces naturally.

```typescript
// Already established — reuse exactly this pattern
import { processClerkWebhookEvent } from "../convex/webhooks/clerk";
const runMutation = vi.fn().mockResolvedValue(null);
const outcome = await processClerkWebhookEvent({
  eventId: "evt_1", eventType: "user.created", data: { ... },
  runMutation, mutationRefs,
});
expect(runMutation).toHaveBeenCalledWith(mutationRefs.upsertUserFromClerk, { ... });
```

### Pattern 5: AI Model Mock (for AI core unit tests)

**What:** Create a minimal object satisfying the `LanguageModel` interface from the `ai` SDK. Return controlled `text` payloads from `doGenerate`. Verify that `executeAIOperation` parses the output, applies repair, and returns the expected schema.

**When to use:** Testing `lib/ai/core/execute.ts`, `lib/ai/core/batch.ts` — the orchestration logic around the AI SDK, not the AI model itself.

**Trade-offs:** Cannot test actual AI response quality. Tests the orchestration logic: retry on validation failure, repair strategy invocation, usage accumulation, fail-soft behavior in `Promise.allSettled`.

```typescript
// tests/ai-execute-operation.test.ts
import { describe, expect, it, vi } from "vitest";
import { executeAIOperation } from "../lib/ai/core/execute";
import { z } from "zod";

function makeModel(responses: string[]) {
  let call = 0;
  return {
    specificationVersion: "v1",
    modelId: "mock-model",
    provider: "mock",
    defaultObjectGenerationMode: "json",
    doGenerate: vi.fn().mockImplementation(async () => ({
      text: responses[call++] ?? "{}",
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: "stop",
      rawCall: { rawPrompt: "", rawSettings: {} },
    })),
  } as any;
}

describe("executeAIOperation", () => {
  it("returns parsed output on first success", async () => {
    const model = makeModel(['{"enhancedQuery": "machine AND learning"}']);
    const { output } = await executeAIOperation({
      model,
      schema: z.object({ enhancedQuery: z.string() }),
      buildPrompts: () => ({ system: "sys", prompt: "q" }),
      input: {},
      repairStrategy: { type: "full-json" },
      temperature: 0.1,
    });
    expect(output.enhancedQuery).toBe("machine AND learning");
  });
});
```

### Pattern 6: Source-Code Assertion (for contract/regression tests)

**What:** Use `readFileSync` to read a source file and assert specific patterns exist. Guards against regressions where a refactor silently breaks a contract.

**When to use:** Only for contracts that are hard to unit-test (e.g., the screening export format guaranteeing certain fields appear together). Already established in `search-actions-screening-export.test.ts`. Use sparingly — prefer behavioral tests.

**Trade-offs:** Brittle to refactors (whitespace changes, extractions). Valuable as a regression guard when the behavioral test would require too much setup. Never use as a substitute for a proper behavioral test.

## Data Flow

### Unit Test Data Flow (no I/O)

```
Test file
  ↓ import
Pure function (lib/* or convex/lib/*)
  ↓ call with plain data
Return value / thrown error
  ↓
expect() assertions
```

### Convex Context Mock Data Flow

```
Test file
  ↓ build ctx = { auth: vi.fn(), db: { query: vi.fn() } }
Convex handler (users/mutations.ts, convex/lib/auth.ts)
  ↓ calls ctx.auth.getUserIdentity()
  ↓ calls ctx.db.query(...)
Mock returns controlled value
  ↓
Handler returns result / throws structured error
  ↓
expect() assertions on result or error.data.code
```

### AI Operation Data Flow (mocked model)

```
Test file
  ↓ build mock LanguageModel (doGenerate returns controlled text)
lib/ai/core/execute.ts::executeAIOperation
  ↓ calls model.doGenerate
  ↓ parses text as JSON via zod schema
  ↓ repairs if invalid (calls repairJSON)
  ↓ retries on validation failure (up to maxRetries)
  ↓ accumulates usage tokens
Returns { output, usage }
  ↓
expect() on output shape + usage values
```

### Integration Test Data Flow (two modules wired together)

```
Test file
  ↓ compose Module A output → Module B input
Module A (e.g., credit billing calculation)
  ↓ returns credits amount
Module B (e.g., balance enforcement check)
  ↓ returns allow/deny decision
expect() on final decision
```

## Integration Points: New vs Existing

### New Test Files (build from scratch)

All are in `tests/` flat directory, no new subdirectories.

| File | Tests | Module Under Test |
|------|-------|------------------|
| `tests/search-filter-builder.test.ts` | Filter assembly from params | `lib/filters/filter-builder.ts` |
| `tests/search-filter-config.test.ts` | Section config, sort options | `lib/filters/filter-config.ts` |
| `tests/search-params-converters.test.ts` | URL serialization/parsing | `lib/search-params/*` |
| `tests/search-utils.test.ts` | Query building, date/country helpers | `lib/search-utils.ts` |
| `tests/search-state-actions.test.ts` | `submitNewSearch`, `restoreFromHistory` | `lib/search/actions.ts` |
| `tests/extraction-export.test.ts` | CSV/JSON export formatting | `lib/extraction/export.ts` |
| `tests/extraction-reviews.test.ts` | Review status logic | `lib/extraction/reviews.ts` |
| `tests/ai-execute-operation.test.ts` | Retry, repair, usage accumulation | `lib/ai/core/execute.ts` |
| `tests/ai-batch-processor.test.ts` | `Promise.allSettled` fail-soft, error collection | `lib/ai/core/batch.ts` |
| `tests/ai-prompts.test.ts` | Prompt builder outputs (enhance query, screening Q) | `lib/ai/core/prompts.ts` |
| `tests/ai-validate.test.ts` | `validateQuery`, `repairJSON`, `repairSingleField` | `lib/ai/core/validate.ts` |
| `tests/ai-errors.test.ts` | Error class hierarchy, code properties | `lib/ai/core/errors.ts` |
| `tests/ai-question-key-codec.test.ts` | Encode/decode question-response map | `lib/ai/core/question-key-codec.ts` |
| `tests/ai-cost.test.ts` | Token cost calculation | `lib/ai/core/cost.ts` |
| `tests/user-creation-with-defaults.test.ts` | Credit + subscription rows on new user | `convex/lib/userCreation.ts` |
| `tests/user-auth-state-machine.test.ts` | Active/suspended/deleted state branches | `convex/lib/auth.ts` |
| `tests/user-feature-flag-guards.test.ts` | Credits/subscriptions/topups enable/disable | `convex/lib/featureFlags.ts` |
| `tests/user-plan-enforcement.test.ts` | Free credit cap, tier cap amounts | `convex/lib/freeCredits.ts` |
| `tests/user-ensure-user-mutation.test.ts` | `ensureUser` creates vs returns existing | `convex/users/mutations.ts` |
| `tests/integration-ai-credit-flow.test.ts` | Usage → credits deducted → balance enforced | `convex/ai/lib/creditBilling.ts` + `convex/lib/freeCredits.ts` |
| `tests/integration-search-export-format.test.ts` | Filter state → export field presence | `lib/extraction/filtering.ts` + `lib/extraction/export.ts` |

### Existing Test Files (unchanged)

All 43 existing files in `tests/` continue running unchanged. The new tests are additive only.

### vitest.config.ts (no modification needed)

The existing config already covers all new test files:

```typescript
// vitest.config.ts — unchanged
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],       // picks up all new files automatically
    exclude: ["tests/live-billing/**/*.test.ts"],
  },
});
```

No config change is needed. New test files are picked up automatically.

### package.json (no modification needed)

`npm run test` already runs all unit tests via `vitest run`. No new script is needed for the v2.0 unit tests.

## Build Order (Optimal TDD Sequence)

Build order is driven by three factors: (1) dependency between modules, (2) risk — highest-value coverage first, (3) TDD red-green-refactor requires tests to fail before implementation exists.

```
PHASE 1: Pure Function Foundations (no deps on other modules, fastest to write)
├── tests/ai-errors.test.ts              → lib/ai/core/errors.ts
├── tests/ai-validate.test.ts            → lib/ai/core/validate.ts
├── tests/ai-question-key-codec.test.ts  → lib/ai/core/question-key-codec.ts
├── tests/ai-cost.test.ts                → lib/ai/core/cost.ts
├── tests/user-feature-flag-guards.test.ts → convex/lib/featureFlags.ts
├── tests/user-plan-enforcement.test.ts  → convex/lib/freeCredits.ts
└── tests/search-filter-config.test.ts  → lib/filters/filter-config.ts

PHASE 2: Core Logic (depends on Phase 1 types/errors)
├── tests/ai-prompts.test.ts             → lib/ai/core/prompts.ts
├── tests/ai-execute-operation.test.ts   → lib/ai/core/execute.ts (uses errors, validate)
├── tests/user-creation-with-defaults.test.ts → convex/lib/userCreation.ts (uses freeCredits)
├── tests/user-auth-state-machine.test.ts → convex/lib/auth.ts (uses userCreation)
├── tests/search-filter-builder.test.ts → lib/filters/filter-builder.ts
└── tests/search-params-converters.test.ts → lib/search-params/*

PHASE 3: Orchestration (depends on Phase 2 foundations)
├── tests/ai-batch-processor.test.ts     → lib/ai/core/batch.ts (uses execute)
├── tests/user-ensure-user-mutation.test.ts → convex/users/mutations.ts (uses auth + userCreation)
├── tests/search-utils.test.ts           → lib/search-utils.ts (uses filter-builder, params)
├── tests/search-state-actions.test.ts   → lib/search/actions.ts (uses search-params)
├── tests/extraction-export.test.ts      → lib/extraction/export.ts
└── tests/extraction-reviews.test.ts     → lib/extraction/reviews.ts

PHASE 4: Integration Tests (wire Phase 2 + 3 modules together)
├── tests/integration-ai-credit-flow.test.ts     → creditBilling + freeCredits
└── tests/integration-search-export-format.test.ts → filtering + export
```

**Rationale for this order:**
- AI errors and validate are depended on by `executeAIOperation` — test them first so the execute tests can be written against a stable contract.
- `userCreation` depends on `freeCredits` — `freeCredits` goes in Phase 1.
- `auth.ts` calls `userCreation` on user-not-found with `allowSyncing` — `userCreation` goes in Phase 2 so auth tests can set correct expectations.
- Integration tests go last because they import from two already-tested modules and verify the composition, not the individual functions.

## Anti-Patterns

### Anti-Pattern 1: Shared Test Helper Files

**What people do:** Create `tests/helpers/` or `tests/fixtures/` with shared factory functions, mock builders, and test data.

**Why it's wrong:** Every existing test in this codebase uses inline mocks and local helpers. Introducing a shared helpers module creates a dependency — a change in the helper can break unrelated tests, and the helper file itself becomes untested infrastructure. In TDD, each test should set up exactly what it needs, making the test self-describing.

**Do this instead:** Copy the `makeCtx()` helper inline per test file. For common data shapes (e.g., a minimal `ExtractionQuestion`), define them as constants at the top of the file that uses them. If three or more test files share identical setup, extract to a helper only then — and test the helper itself.

### Anti-Pattern 2: Testing Convex Actions via Convex CLI in Unit Tests

**What people do:** Use `convex run` via `child_process` in Vitest tests to test Convex actions end-to-end.

**Why it's wrong:** This is what `tests/live-billing/` does, and it runs under `vitest.live.config.ts` with 300s timeouts and a separate CI job. Mixing this pattern into the standard `vitest.config.ts` would make `npm run test` depend on a live Convex deployment, breaking offline development.

**Do this instead:** Unit-test the pure helper functions extracted from actions (e.g., `calculateCreditsToDeductFromUsage` from `convex/ai/lib/creditBilling.ts`). Reserve live Convex tests for the `tests/live-billing/` tier when behavioral coverage genuinely requires it.

### Anti-Pattern 3: Testing via the React Hook

**What people do:** Use `renderHook` from `@testing-library/react` to test hooks like `useProtectedQuery`, `useSearch`, `useSubscriptionState`.

**Why it's wrong:** All existing tests bypass React entirely — they import and call functions directly. React hook testing requires `jsdom` environment and adds significant setup complexity. The actual logic in these hooks is typically thin wiring between a Convex query and a returned value — the interesting logic lives in the underlying pure functions.

**Do this instead:** Test the pure functions that the hook delegates to. For `useSubscriptionState`, test `resolveEffectivePlan` (already done in `subscription-entitlements.test.ts`). For `useProtectedQuery`, test `getSettlementState` as a standalone function. If the hook itself has real logic, extract it to a pure function first (TDD red-green-refactor pushes this naturally).

### Anti-Pattern 4: Asserting `vi.fn()` Call Counts Instead of Return Values

**What people do:** Write `expect(mockFn).toHaveBeenCalledTimes(1)` as the primary assertion, without verifying what was passed or what the caller returned.

**Why it's wrong:** This tests implementation details (how many times a mock was called) rather than behavior (what the module produces). The existing pattern in `clerk-webhook-handler.test.ts` is correct: verify `runMutation.mock.calls[0]?.[1]` — the actual args passed — which is the behavioral contract.

**Do this instead:** Assert the return value of the module under test first. Then, if side-effect ordering matters (e.g., mutation called before second mutation), assert the call arguments in order.

### Anti-Pattern 5: One Test File Per Domain Instead of Per Module

**What people do:** Create `tests/ai.test.ts` with 50 tests covering all of `lib/ai/core/*`.

**Why it's wrong:** When one test fails, the failure message is ambiguous. A large file is harder to navigate during TDD (you're looking for the red test). All 43 existing tests are single-responsibility — one file per module or concept.

**Do this instead:** One test file per source module (or per distinct concept within a large module). The file name should mirror the source path: `lib/ai/core/validate.ts` → `tests/ai-validate.test.ts`.

## Sources

- Direct codebase analysis: `tests/*.test.ts` (40 files), `vitest.config.ts`, `vitest.live.config.ts`, `package.json`
- Pattern sources: `tests/extraction-filtering.test.ts` (env var gate pattern), `tests/clerk-webhook-handler.test.ts` (mock injection pattern), `tests/ai-credit-billing.test.ts` (direct import pattern), `tests/search-actions-screening-export.test.ts` (source-code assertion pattern)
- Module inventory: `lib/ai/core/`, `lib/extraction/`, `lib/filters/`, `convex/ai/`, `convex/users/`, `convex/lib/`, `convex/webhooks/`

---
*Architecture research for: TDD & Test Coverage backfill — v2.0 milestone*
*Researched: 2026-02-28*
