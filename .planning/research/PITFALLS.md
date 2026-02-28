# Pitfalls Research

**Domain:** Adding TDD & test coverage backfill to an existing Next.js + Convex + AI app
**Researched:** 2026-02-28
**Confidence:** HIGH (verified against Convex docs, convex-test GitHub issues, Vercel AI SDK docs, nuqs docs, Clerk docs, codebase analysis)

---

## Critical Pitfalls

### Pitfall 1: `ctx.auth.getUserIdentity()` Fails Inside convex-test for Queries and Mutations

**What goes wrong:**
Functions that call `ctx.auth.getUserIdentity()` inside Convex queries and mutations throw an `asyncSyscall does not support: 1.0/getUserIdentity` error in convex-test. Since most auth-gated code in this codebase flows through `requireAuth()` and `getCurrentUser()` in `convex/lib/auth.ts`, this blocks testing `ensureUser`, `updateProfile`, `requirePlanTier`, `requireExtractionEnabled`, and any mutation that calls those helpers. The convex-test library's `t.withIdentity()` sets an identity for actions via `actionFromPath`, but as of version 0.0.41 (confirmed open issue, February 2026), queries and mutations do NOT propagate this identity context when triggers execute nested functions.

**Why it happens:**
The `asyncSyscallImpl()` function in convex-test lacks a handler for the `"1.0/getUserIdentity"` syscall. Additionally, when trigger functions execute nested queries/mutations, the context creation overwrites the original auth context with `_userIdentity: null`. This is a known open bug in the convex-test library (GitHub issue #50, opened October 2025, still open February 2026).

**How to avoid:**
- **Do not try to test `requireAuth`-gated logic end-to-end through convex-test.** Instead, extract the business logic being tested into pure functions that take explicit parameters rather than a `ctx` with identity.
- For functions like `createUserWithDefaults`, `applyTierFreeCreditCap`, `selectCanonicalSubscription`, and `resolveEffectivePlan`, test them directly as pure functions — these are already extractable.
- For auth guard logic (`requireAuth`, `getCurrentUser`, `requirePlanTier`), use the **local OSS backend** approach (`convex dev --local`) for integration tests, OR test the guard's error throwing by constructing minimal fake ctx objects with `getUserIdentity` stubbed via `vi.fn()`.
- Use `convex-test` only for non-auth database operations where `t.withIdentity()` flows through an action (not a query/mutation).

**Warning signs:**
- `asyncSyscall does not support: 1.0/getUserIdentity` in test output
- Tests for Convex mutations that call `requireAuth` failing at the identity check, not the business logic

**Phase to address:** Phase 1 (Vitest infrastructure & pure function tests) — establish the boundary between "testable with convex-test" and "requires local backend or pure function extraction."

---

### Pitfall 2: Testing "use node" Actions Requires Vitest's Node Environment, Not Convex's Edge Runtime Mock

**What goes wrong:**
All Convex actions in this codebase marked `"use node"` (the entire `convex/ai/` directory, `convex/extraction/workpoolActions.ts`, etc.) use Node.js APIs. The `convex-test` library runs in Vitest's configured environment. But `convex-test` internally uses Vercel's Edge Runtime mock, which diverges from the actual Convex node runtime in important ways. The `AI_PROVIDER` and `AI_MODEL` env vars read in `convex/ai/config.ts`, the `generateObject` import from the `ai` package, and external API calls via `fetch` all behave differently under the edge mock vs. Node.

**Why it happens:**
The current `vitest.config.ts` sets `environment: "node"`, which is correct for the test runner itself, but `convex-test` internally wraps functions in a Vercel Edge Runtime mock regardless. This means `process.env` access in `"use node"` actions may behave differently, and global `fetch` mocking via `vi.stubGlobal("fetch", ...)` does NOT affect the `t.fetch()` call path used by HTTP actions.

**How to avoid:**
- For testing `"use node"` Convex actions that call LLMs: **do not run them through `convex-test` at all**. Import the underlying pure logic functions directly into Vitest and test them in isolation.
- The pattern already used in this codebase is correct: `createAIAction` wraps logic; test the inner `getEnhanceQueryConfig`, `processScreeningBatch`, `buildEnhancedExtractionPrompt`, etc. directly via import.
- For `getModel()` which reads `SERVER_AI_CONFIG` (env vars): stub the env before importing using `vi.stubEnv()` or `process.env` mutation followed by `vi.resetModules()` and dynamic import — exactly as `tests/extraction-feature-flags.test.ts` already does.

**Warning signs:**
- `fetch is not defined` in tests for Convex actions
- `process.env.AI_PROVIDER` returning `undefined` despite `vi.stubEnv()` being called before the module is imported
- convex-test throwing runtime errors for node-only APIs (e.g., `Buffer`, `stream`, `fs`)

**Phase to address:** Phase 1 (test infrastructure) — document which Convex code paths are testable via convex-test vs. direct import vs. local backend.

---

### Pitfall 3: Mocking `generateObject` from the Vercel AI SDK the Wrong Way

**What goes wrong:**
Developers trying to unit-test AI prompt builders and batch processors mock `generateObject` by importing it and wrapping it with `vi.mock('ai', ...)`. This breaks in two ways: (1) `ai/test` exports `MockLanguageModelV3` which is the official approach, but importing `ai/test` outside a Vitest worker context (e.g., in a startup script or server-side demo) causes `"Vitest failed to access its internal state"` since `ai@5.0.27`. (2) Mocking the module directly often misses the retry/repair path in `executeAIOperation` which calls `generateObject` multiple times on schema validation failures.

**Why it happens:**
The `executeAIOperation` function in `lib/ai/core/execute.ts` calls `generateObject` inside a retry loop with a `repairText` callback. A simple mock that returns a fixed response only covers the happy path — it cannot test that retry logic, the `repairJSON`/`repairSingleField` path, or `AIMaxRetriesExceededError` propagation.

**How to avoid:**
- Use `MockLanguageModelV3` from `ai/test` exclusively in Vitest test files. Never import it in production code or startup scripts.
- To test retry/repair behavior: configure `MockLanguageModelV3` to throw `AIValidationError` on the first call and return a valid response on the second. The `mockValues()` helper from `ai/test` supports this pattern.
- To test `processBatch` partial failures (`Promise.allSettled` behavior): configure some mock calls to reject and assert on the `errors` array — the batch processor already separates `results` and `errors`.
- Keep the `MockLanguageModelV3` import gated behind the test file boundary. Never export it from a shared module.

**Warning signs:**
- `"Vitest failed to access its internal state"` at runtime (not in tests)
- Tests that only test the happy path and never trigger retry logic
- Mocking `generateObject` directly with `vi.mock('ai', ...)` instead of passing a `MockLanguageModelV3` through the config

**Phase to address:** Phase 2 (AI/LLM unit tests) — establish the MockLanguageModelV3 pattern as the team standard before any AI tests are written.

---

### Pitfall 4: Encoding Existing Bugs as Tests During Backfill

**What goes wrong:**
When backfilling tests for code that already exists, it is easy to write a test that asserts the current (possibly wrong) behavior rather than the intended behavior. For example, if `calculateCreditsToDeductFromUsage` has an off-by-one in the markup multiplier, a backfilled test that directly inverts the implementation to produce the expected value will pass today and also pass when the bug is "fixed" by accident — because the test encoded the bug, not the spec.

**Why it happens:**
Backfill tests are written by reading the implementation, not the specification. The test author defaults to `expect(result).toBe(actualOutput)` rather than `expect(result).toBe(specifiedValue)`. The test becomes a mirror of the code rather than a constraint on it.

**How to avoid:**
- For every function being backfill-tested, write the expected value from the business specification, not from running the existing code. For `calculateCreditsToDeductFromUsage`, the expected value should be computed from documented pricing (e.g., `$0.25/1M input tokens at 40x markup = X credits`) — this is the pattern already used in `tests/ai-credit-billing.test.ts`.
- Before writing the test, ask: "If I delete this function's body and rewrite it from scratch, would this test catch a wrong implementation?" If no, the test encodes implementation details.
- For subscription state machine tests: derive expected states from the documented entitlement spec (`ENTITLED_SUBSCRIPTION_STATUSES`), not by checking what the current code returns. The existing `tests/subscription-entitlements.test.ts` does this correctly.

**Warning signs:**
- The test was written by running the existing function and copying its output as the assertion
- Expected values in tests match implementation constants exactly (e.g., `expect(credits).toBe(calculateCreditsToDeductFromUsage(usage))` — circular)
- No test catches a mutation to the function under test because the test value adjusts with the code

**Phase to address:** All phases — enforce in code review that expected values have documented business justification, not just "that's what the code returns."

---

### Pitfall 5: Testing `withAuthAndCreditsBatch` / `withAuthAndCredits` Through the Full Action Stack

**What goes wrong:**
The `withAuthAndCreditsBatch` helper in `convex/ai/helpers.ts` calls `ctx.runQuery(internal.users.internal.getCurrentUser)`, `ctx.runQuery(api.credits.queries.getMyBalance)`, `ctx.runMutation(internal.credits.internal.deductCredits)`, and external PostHog tracking. Trying to test this through `convex-test` requires mocking all of those internal references, which the convex-test library does not support natively (it doesn't intercept `internal.*` calls). Developers spend hours trying to make `t.action(ai.actions.screenPapers, ...)` work, only to discover the action can't run because `internal.users.internal.getCurrentUser` requires a real backend.

**Why it happens:**
The helper's auth + credits + analytics pipeline combines multiple Convex internal function calls with external I/O. This makes it essentially integration-test territory. But developers treat it as a unit test target because it is "just a function."

**How to avoid:**
- **Test the helper's constituent parts, not the helper itself:**
  - Test `calculateServerCreditsToDeduct` directly (pure function, already testable)
  - Test `throwStructuredAIError` by constructing various error types and asserting on the thrown ConvexError code
  - Test `isApiKeyMissingMessage` and `hasStructuredConvexCode` as pure boolean functions
  - Test the error classification table exhaustively (every `AIError` subtype maps to the right Convex error code)
- For integration testing `withAuthAndCreditsBatch` end-to-end: use a local Convex backend with seeded test data.
- Do not attempt to mock `ctx.runQuery` / `ctx.runMutation` inside convex-test — there is no supported injection point.

**Warning signs:**
- Test imports `internal` from `convex/_generated/api` and tries to pass it to `t.action()`
- Test fails with `Cannot find module 'convex/_generated/api'` because the generated file doesn't exist in test context
- Test requires more than 50 lines of setup mocking before the first `expect()`

**Phase to address:** Phase 2 (AI feature unit tests) — draw the unit test boundary at pure functions; integration test at the local backend level.

---

## Moderate Pitfalls

### Pitfall 6: nuqs Custom Parsers Tested for Round-Trip Correctness, Not Bijection

**What goes wrong:**
The custom `parseAsRegions` parser in `lib/search-params/parsers.ts` encodes arrays of region strings (like `['eastern_africa', 'ZA']`) into compact URL codes (`'AF_E,ZA'`). Tests often only check one direction: `expect(decodeRegions(encodeRegions(['africa']))).toEqual(['africa'])` (serialize then parse). They do not check the reverse: `expect(encodeRegions(decodeRegions('AF'))).toBe('AF')`. If the codec is not perfectly bijective — for example, if `encodeRegions(['africa'])` produces `'AF'` but `decodeRegions('AF')` produces `['africa']` while `encodeRegions(['africa'])` still produces `'AF_FULL'` — the URL round-trip silently drops or mutates filter state.

**Why it happens:**
Developers test the common path (known input → known output) but not the codec property that matters most for URL state: every URL string should survive a parse→serialize round-trip unchanged, and every in-memory value should survive a serialize→parse round-trip unchanged.

**How to avoid:**
- For `parseAsRegions` and all custom nuqs parsers, write bijectivity property tests:
  ```typescript
  // Test every INTERNAL_TO_URL_CODE entry for round-trip correctness
  for (const [internal, urlCode] of Object.entries(INTERNAL_TO_URL_CODE)) {
    expect(decodeRegions(encodeRegions([internal]))).toEqual([internal]);
    expect(encodeRegions(decodeRegions(urlCode))).toBe(urlCode);
  }
  ```
- Use nuqs's `testParseThenSerialize` and `testSerializeThenParse` helpers from `nuqs/testing` if available, or implement equivalent checks.
- The `clearOnDefault: false` setting on `serializeSearchParams` means empty arrays ARE written to the URL — test that `encodeRegions([])` returns `''` and `decodeRegions('')` returns `[]`.

**Warning signs:**
- Filter state is lost or changed when the user refreshes the page
- Tests pass with specific test cases but no property-based coverage over the entire codec table
- `parseAsRegions.parse(parseAsRegions.serialize(['africa']))` assertion not present in any test

**Phase to address:** Phase 3 (URL serialization tests) — write bijectivity tests before any other URL serialization tests.

---

### Pitfall 7: `nuqs` Testing Requires `withNuqsTestingAdapter` — Missing it Causes Silent No-Ops

**What goes wrong:**
Components and hooks that use `useQueryState` from nuqs cannot be rendered or tested in Vitest without wrapping them in `withNuqsTestingAdapter` from `nuqs/adapters/testing`. If the wrapper is omitted, the hook either throws a provider error or — worse — silently returns the default value with no URL interaction, making URL state assertions always pass regardless of the component's actual behavior.

**Why it happens:**
nuqs v2 is ESM-only. The adapter must be in scope. If developers copy a test from a pre-nuqs component, the wrapper is absent. The default value behavior can mask the missing wrapper: the test passes because the component renders with defaults, but URL updates are silently swallowed.

**How to avoid:**
- Every test file that touches a component or hook using `useQueryState` / `useQueryStates` MUST include `withNuqsTestingAdapter` as the `wrapper` option in `renderHook()` or `render()`.
- For URL update assertions, always pass an `onUrlUpdate` callback to `withNuqsTestingAdapter` and assert it was called: `expect(onUrlUpdate).toHaveBeenCalledOnce()`. If the mock is never called despite user interaction, the adapter is missing.
- Note the `hasMemory: false` default: the adapter does NOT accumulate URL updates between interactions within a test. To test a multi-step filter interaction (change query, then change sort, assert final URL state), set `hasMemory: true`.

**Warning signs:**
- `useQueryState` tests pass but never assert on URL changes
- `onUrlUpdate` callback not present in any nuqs test
- Missing `import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'`

**Phase to address:** Phase 3 (URL serialization tests) — establish the adapter pattern on the first test file.

---

### Pitfall 8: Auth State Machine Tests Conflate Convex Identity with Clerk Identity

**What goes wrong:**
The auth state in this app spans two systems: Clerk identity (session state, `useUser()`, `useAuth()`) on the client, and the Convex `users` table + `subscriptions` table on the server. A test for "unauthenticated user sees no extraction options" might mock Clerk's `useAuth()` returning `{ userId: null }` but leave the Convex query returning stale user data from a previous test's context. The test passes locally because Clerk mock wins, but the actual guard being exercised is `requireAuth(ctx)` which reads `ctx.auth.getUserIdentity()` on the Convex side — completely independent of the Clerk client mock.

**Why it happens:**
The two identity systems are easy to conflate: both carry "user is logged in" information, but they are separate layers. Client-side Clerk mocks (`vi.mock('@clerk/nextjs', ...)`) test client rendering. Server-side convex-test identity (`t.withIdentity()`) tests Convex function behavior. They do not compose into a single mock.

**How to avoid:**
- Identify which layer each test is exercising and mock only that layer:
  - For **client-side auth rendering** (plan badges, credit displays, feature gates in React): mock `@clerk/nextjs` hooks. Do not involve convex-test.
  - For **Convex-side auth guards** (`requireAuth`, `requirePlanTier`, `requireGoPlan`): test the pure logic directly (e.g., `resolveEffectivePlan`, `selectCanonicalSubscription`) or use local backend integration tests.
  - For **`resolveEffectivePlan` state machine**: the current `tests/subscription-entitlements.test.ts` already tests this correctly at the pure function level — follow this pattern.
- Never mix a Clerk mock and a convex-test mock in the same test file — the boundaries don't compose correctly.
- Document in the test file comment which auth layer is under test.

**Warning signs:**
- A test file imports both `@clerk/nextjs` mock and `convex-test`
- A "subscription status" test that stubs `useUser()` but also checks database behavior
- Missing tests for the `state: "suspended"` and `state: "deleted"` paths in `assertActiveUser()`

**Phase to address:** Phase 4 (User management unit tests) — define the auth layer boundary before writing any user management tests.

---

### Pitfall 9: `Promise.allSettled` Batch Tests That Only Cover the All-Success Path

**What goes wrong:**
`processBatch` in `lib/ai/core/batch.ts` uses `Promise.allSettled` precisely to provide fail-soft behavior: some papers succeed, some fail, and the caller gets both `results` and `errors`. Tests that only configure the mock model to succeed for all items never exercise the branch where `settled.status === 'rejected'`. More subtly, the `getItemId(items[i])` fallback to `'unknown'` on failure is only reached if the items array and the settled results are misaligned — this code path has never been tested.

**Why it happens:**
The `Promise.allSettled` pattern is robust in production but invisible to tests that mock a uniformly successful model. The error case requires deliberately configuring `MockLanguageModelV3` to reject for specific inputs, which is a non-obvious setup.

**How to avoid:**
- For every batch processor test: write at minimum three scenarios:
  1. All succeed: assert `results` has all N entries, `errors` is empty
  2. All fail: assert `results` is empty, `errors` has all N entries with meaningful error messages
  3. Partial failure (first item succeeds, second fails): assert `results` has 1 entry, `errors` has 1 entry, and the correct item IDs are in each
- Use `mockValues()` from `ai/test` to alternate success and failure responses across batch items.
- Specifically test the `error` field in `BatchError`: verify that `Error` instances serialize to `error.message`, not `[object Error]`.
- Vitest may emit "unhandled promise rejection" warnings for rejections inside `Promise.allSettled`. These are false positives — the rejections ARE handled by `allSettled`. Suppress with `expect.assertions(N)` or by verifying Vitest's config does not flag settled rejections.

**Warning signs:**
- Batch processor tests only have `it('processes all papers successfully', ...)` and no failure scenarios
- `errors` array never asserted on in any test
- Usage aggregation (`usages.push(usage)`) not verified to be empty when all items fail

**Phase to address:** Phase 2 (AI/LLM unit tests) — enforce the three-scenario test structure for every batch function.

---

### Pitfall 10: Feature Flag Tests Require Module Reset or Risk Cached Module State

**What goes wrong:**
Tests for feature flags like `NEXT_PUBLIC_EXTRACTION_PDF_ENABLED` or `NEXT_PUBLIC_EXTRACTION_ENABLED` that mutate `process.env` without resetting module cache will see stale values. The module reads `process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED` at module initialization time and caches the result. A test that sets the env var after the module is already loaded will not affect the module's computed value.

**Why it happens:**
ES modules are cached after their first import. If `convex/extraction/content.ts` reads `process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED` in its body (not in a function), the value is captured at import time. Subsequent `process.env` mutations within the same test run won't change the loaded module's behavior.

**How to avoid:**
- Follow the exact pattern from `tests/extraction-feature-flags.test.ts`: call `vi.resetModules()` before each dynamic `import(...)`. This forces re-evaluation of the module with the new env value.
- Restore the original env value in `afterEach` to prevent test order contamination.
- Document this pattern in the test helpers as a `loadModuleWithEnv(path, envOverrides)` utility to avoid boilerplate in every feature flag test file.
- For `convex/extraction/guard.ts` which checks `process.env.NEXT_PUBLIC_EXTRACTION_ENABLED` in a function body (not at module load time), the reset is not needed — the function reads the env at call time. Know which pattern each module uses before writing the test.

**Warning signs:**
- Feature flag tests all pass when run individually but fail in a specific order
- `process.env` mutation does not change the function's behavior in the test
- Test file lacks `vi.resetModules()` before dynamic `import()`

**Phase to address:** Phase 1 (infrastructure) and Phase 2/4 (wherever feature flag tests appear) — establish the module reset utility early.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Source-text assertions (`expect(source).toMatch(...)`) for logic tests | Fast to write, no need to import | Tests break on whitespace changes; don't catch logic errors | Only for truly structural contracts like export names or file organization — not for logic |
| Mocking `@clerk/nextjs` at module level for every test | Simple setup | Clerk mock bleeds across tests via hoisting; partial mock leaves hooks real | Acceptable if each test resets mock return values; not acceptable if tests share a static mock |
| Testing only the public `api.*` Convex functions, not `internal.*` | Avoids internal API surface | Internal functions containing complex logic go untested | Never — extract internal logic into pure lib functions and test those directly |
| Generating expected test values by running the implementation | Fast backfill | Encodes bugs as correct behavior | Never for business logic; acceptable only for snapshot-style output that humans review |
| Skipping `afterEach` cleanup for env mutations | Fewer lines | Env changes leak across test files when run in watch mode | Never — always restore env in afterEach |

---

## Integration Gotchas

Common mistakes when connecting to external services in tests.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Vercel AI SDK (`ai/test`) | Importing `MockLanguageModelV3` in non-test code (server components, scripts) | Strictly gate `from 'ai/test'` to `*.test.ts` files; lint rule to enforce |
| convex-test + auth | Calling `t.withIdentity()` then `t.mutation(users.mutations.ensureUser, {})` expecting auth to work | Actions propagate identity; queries/mutations do not — test mutations with explicit `userId` args via pure helpers |
| nuqs testing adapter | Forgetting `withNuqsTestingAdapter` wrapper in React Testing Library tests | Always wrap; assert on `onUrlUpdate` not just state |
| Clerk mock in Next.js | `vi.mock('@clerk/nextjs')` affects all hooks including ones not under test | Use `vi.mocked(useAuth).mockReturnValue(...)` per-test to scope mock behavior |
| Process.env in Vitest | Setting `process.env.X = 'value'` in `beforeAll` without `vi.resetModules()` when module reads env at import | Use `vi.stubEnv()` which restores automatically, or combine `process.env` mutation with `vi.resetModules()` and dynamic import |

---

## Performance Traps

Patterns that work at small scale but degrade as the test suite grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Running `convex-test` for all Convex function tests | Tests slow to 5–10s each due to convex-test initialization overhead | Use `convex-test` only for functions that genuinely need DB context; test pure logic directly | Once test suite grows beyond ~50 convex-test tests |
| Mocking `generateObject` with real delays | Batch processor tests take 30s+ because MockLanguageModelV3 uses real async timing | Pass `delay: 0` to `simulateReadableStream` or use synchronous mock responses | Immediately — every AI unit test should be sub-100ms |
| Source-text assertions reading full files with `readFileSync` | Fine for small files; for large files (like `lib/search-actions.ts`), file I/O adds up | Cache the read result in a `beforeAll` or use targeted regex that fails fast | Once there are many source-text tests targeting the same file |

---

## Security Mistakes

Domain-specific security issues to avoid in test code.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Committing real `AI_PROVIDER` / `AI_MODEL` API keys in test stubs | Key exposure via git history | Use placeholder strings (`"test-api-key-placeholder"`) in test env stubs; never real keys |
| Writing tests that exercise `runMutation(internal.credits.internal.deductCredits)` with a real Convex endpoint in CI | Accidental credit deduction on a live account if env var guard fails | Always check `process.env.BILLING_LIVE_CREDITS !== "false"` guard; the CI credits guard already enforces `"false"` means disabled |
| Mocking `requireAuth` to always return a user without testing the unauthenticated path | Auth bypass goes untested; regression risk if guard logic changes | Every test for an auth-gated function MUST include a "unauthenticated" test case that asserts the error code |

---

## "Looks Done But Isn't" Checklist

- [ ] **Convex auth guard tests:** `requireAuth` and `requirePlanTier` paths have tests for `null` identity, `state: "suspended"`, and `state: "deleted"` — not just the happy path
- [ ] **Batch processor tests:** `errors` array asserted non-empty in failure scenarios — not just `results` in success scenarios
- [ ] **Region codec bijectivity:** Both `parse(serialize(x)) === x` and `serialize(parse(s)) === s` verified for every entry in `INTERNAL_TO_URL_CODE`
- [ ] **AI credit billing:** Expected credit values derived from documented pricing spec, not from calling the implementation (circular)
- [ ] **Feature flag tests:** `vi.resetModules()` present before each dynamic import of a module that reads env at load time
- [ ] **nuqs URL tests:** `onUrlUpdate` callback asserted in every URL mutation test — not just state assertion
- [ ] **Subscription state machine:** All statuses in `ALL_SUBSCRIPTION_STATUSES` covered — both `ENTITLED` and `NON_ENTITLED` arrays tested exhaustively
- [ ] **Error classification:** Every `AIError` subtype (`AIApiKeyRequiredError`, `AIUnauthenticatedError`, `AIInsufficientCreditsError`, `AIPlanEntitlementError`, `AIValidationError`, `AIMaxRetriesExceededError`, `AIProviderError`) maps to a tested Convex error code in `throwStructuredAIError`
- [ ] **`withAuthAndCreditsBatch` contract:** Tests verify that zero-credit state blocks the operation (not just that `deductCredits` is called on success)

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| convex-test getUserIdentity bug blocks auth tests | MEDIUM | Extract business logic into pure functions; write those tests. Track upstream fix in convex-test; re-enable convex-test tests when issue #50 is closed. |
| Test suite encoding bugs as correct behavior | HIGH | Compare test assertions against business spec documents. Identify any assertion whose expected value was derived by running the implementation. Rewrite those assertions from spec. |
| nuqs adapter missing from tests — URL state never actually tested | LOW | Add `withNuqsTestingAdapter` wrapper; add `onUrlUpdate` assertion. If tests then fail, investigate real URL mutation bug. |
| MockLanguageModelV3 imported in server code, crashing production | LOW | Find the offending import with `grep -r "ai/test" --include="*.ts" --exclude="*.test.ts"`. Remove. The mock was never needed there. |
| Feature flag tests passing in wrong order — env mutation leaking | LOW | Add `afterEach` that restores original env value. Run tests in random order to expose remaining leaks (`vitest --sequence.shuffle`). |
| Batch processor tests cover only success — real partial failures undetected in prod | MEDIUM | Add failure scenario tests immediately. Audit prod logs for any `errors: []` assumptions in callers that now need to handle non-empty error arrays. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| getUserIdentity fails in convex-test (Pitfall 1) | Phase 1 (infra) — document testability boundary | No test file calls `t.mutation()` on an auth-gated function without a convex-test skip note |
| "use node" actions need direct import testing (Pitfall 2) | Phase 1 (infra) — establish import-vs-convex-test rule | All AI action tests import pure logic directly, no `t.action()` calls |
| Wrong way to mock generateObject (Pitfall 3) | Phase 2 (AI tests) — establish MockLanguageModelV3 pattern | All AI tests use `MockLanguageModelV3`, no `vi.mock('ai', ...)` calls |
| Encoding existing bugs as tests (Pitfall 4) | All phases — code review gate | Expected values have spec justification in test comments |
| Testing withAuthAndCreditsBatch through full stack (Pitfall 5) | Phase 2 (AI tests) — draw unit boundary | No test file imports `internal` from generated Convex API for mocking |
| Custom parser bijectivity not tested (Pitfall 6) | Phase 3 (URL tests) — bijectivity tests first | Both round-trip directions tested for every codec entry |
| Missing withNuqsTestingAdapter (Pitfall 7) | Phase 3 (URL tests) — adapter pattern on first file | Every nuqs test asserts on `onUrlUpdate`, not just state |
| Auth layers conflated in tests (Pitfall 8) | Phase 4 (user management) — auth layer decision before tests | No test file mixes `@clerk/nextjs` mock and convex-test |
| Promise.allSettled only tested happy path (Pitfall 9) | Phase 2 (AI tests) — three-scenario rule | Every batch test has all-success, all-fail, and partial-fail scenarios |
| Feature flag env mutation without module reset (Pitfall 10) | Phase 1 (infra) — `loadModuleWithEnv` utility | Feature flag tests pass when run in reverse order |

---

## Sources

- [convex-test getUserIdentity open issue #50](https://github.com/get-convex/convex-test/issues/50) — confirmed open February 2026; queries/mutations don't propagate identity from `t.withIdentity()`
- [Convex Testing Documentation](https://docs.convex.dev/testing/convex-test) — known limitations: no size/time enforcement, cron jobs not supported, text search without ranking, edge runtime mock divergence
- [Vercel AI SDK Testing Documentation](https://ai-sdk.dev/docs/ai-sdk-core/testing) — MockLanguageModelV3, mockValues(), simulateReadableStream patterns
- [ai@5.0.27 MockLanguageModelV2 runtime regression issue #8356](https://github.com/vercel/ai/issues/8356) — importing `ai/test` outside Vitest crashes with "Vitest failed to access its internal state"
- [nuqs Testing Documentation](https://nuqs.dev/docs/testing) — withNuqsTestingAdapter, hasMemory, onUrlUpdate, rateLimitFactor, bijectivity helpers
- [nuqs GitHub discussion #259: testing components with useQueryState](https://github.com/47ng/nuqs/issues/259) — community patterns and gotchas
- [Clerk Next.js Testing Guide](https://clerk.com/blog/testing-clerk-nextjs) — mock `@clerk/nextjs` hooks at module level; don't test Clerk internals
- [Clerk Testing Documentation](https://clerk.com/docs/testing/overview) — unit test mocking patterns vs. E2E testing token approach
- [Backfilling Tests — professorbeekums.com](https://blog.professorbeekums.com/backfilling-tests/) — encoding bugs as correct behavior risk; specify behavior before writing tests
- [TDD anti-patterns chapter 1 — codurance.com](https://www.codurance.com/publications/tdd-anti-patterns-chapter-1) — testing mocks not behavior; over-coverage anti-patterns
- Codebase analysis: `convex/ai/helpers.ts` (withAuthAndCreditsBatch dependency chain), `lib/ai/core/batch.ts` (Promise.allSettled usage), `lib/ai/core/execute.ts` (generateObject retry loop), `convex/lib/auth.ts` (getUserIdentity usage), `lib/search-params/parsers.ts` (custom nuqs parsers), `tests/extraction-feature-flags.test.ts` (vi.resetModules pattern), `tests/ai-credit-billing.test.ts` (spec-derived expected values pattern)

---
*Pitfalls research for: v2.0 TDD & Test Coverage — OpenAlex Count (Next.js + Convex + AI)*
*Researched: 2026-02-28*
