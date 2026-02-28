# Project Research Summary

**Project:** OpenAlex Count — v2.0 TDD & Test Coverage Backfill
**Domain:** Unit and integration testing for Next.js + Convex + AI application
**Researched:** 2026-02-28
**Confidence:** HIGH

## Executive Summary

This milestone adds structured test coverage across six untested domains in an existing Next.js + Convex + AI application that already has 43 Vitest unit tests and 11 Playwright E2E tests. The core pattern throughout the codebase is the same: extract pure functions, import them directly, assert against business-specification-derived expected values. The six domains to cover are search parameter building and filter logic, AI prompt construction and structured output schemas, batch processing with fail-soft patterns, auth state machine transitions, plan-based feature gating, and data export (CSV/JSON/Excel). All six domains are primarily covered by direct-import pure function tests in the existing `node` environment — no new testing tier or test runner changes are needed for the bulk of the work.

The recommended approach adds exactly 7 new devDependencies (`convex-test`, `@edge-runtime/vm`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react`) and updates `vitest.config.ts` to route test files to three environments via `environmentMatchGlobs`. Critically, several testing capabilities that might appear to require new packages are already available: `ai/test` exports `MockLanguageModelV3` from the installed `ai@6.0.91`, and `nuqs/adapters/testing` exports `withNuqsTestingAdapter` from the installed `nuqs@2.8.8`. The 43 existing tests remain completely unchanged — all new tests are additive in the flat `tests/` directory.

The key risk is the boundary between what can be unit-tested and what requires a live Convex backend. The `convex-test` library has a confirmed open bug (issue #50, open as of February 2026) where `ctx.auth.getUserIdentity()` fails inside queries and mutations, blocking auth-gated code from being tested end-to-end through `convex-test`. The mitigation is already established in the codebase: extract pure decision logic from Convex handlers and test that directly. A secondary risk is backfill tests encoding existing bugs as correct behavior — guard against this by deriving expected values from the business specification, not from running the implementation.

## Key Findings

### Recommended Stack

The existing testing stack (Vitest `^3.2.4`, Playwright `^1.58.2`) needs only targeted additions to unlock the five missing testing capabilities. The installed `ai@6.0.91` and `nuqs@2.8.8` already expose their respective testing utilities as subpath exports. The critical infrastructure addition is `convex-test@^0.0.41` + `@edge-runtime/vm@^5.0.0` for in-memory Convex backend isolation, and `@testing-library/react@^16.3.2` + `jsdom@^28.1.0` for React hook testing. The vitest config change enables three environments via `environmentMatchGlobs`: `edge-runtime` for `convex/**/*.test.ts`, `jsdom` for `tests/hooks/**/*.test.ts`, and `node` for everything else (preserving existing behavior).

**Core technologies:**
- `convex-test@^0.0.41`: In-memory Convex backend for mutation/query/action isolation — the only way to test Convex functions without a live backend; peer-compatible with installed `convex@1.31.7`
- `@edge-runtime/vm@^5.0.0`: Required peer dependency of `convex-test`; provides the edge-runtime Vitest environment
- `@testing-library/react@^16.3.2`: `renderHook` + `act` for React hooks; React 19 compatible; ships `renderHook` directly (no deprecated `@testing-library/react-hooks` needed)
- `MockLanguageModelV3` (from `ai/test`, already installed): Deterministic LLM mock for AI operation tests; use `mockValues()` to stage failure responses for retry/repair testing
- `withNuqsTestingAdapter` (from `nuqs/adapters/testing`, already installed): Required wrapper for any hook or component using `useQueryState`; without it, URL mutations silently no-op

**Version compatibility confirmed:** RTL 16 with React 19, `convex-test` with `convex@1.31.7`, `@testing-library/jest-dom/vitest` (not `/jest`) for Vitest matcher compatibility.

### Expected Features

The research identifies a clear P1/P2/P3 priority breakdown based on risk, extraction effort, and dependencies. The v2.0 launch set covers the 16 highest-risk test targets with the lowest extraction cost. See `.planning/research/FEATURES.md` for the complete per-domain breakdown with table stakes, differentiators, and anti-features.

**Must have — v2.0 table stakes (P1):**
- Search param round-trip (`paramsToSearchResult` + `searchResultToParams`) — URL sharing regressions are user-visible immediately
- Region encoding bijectivity (`encodeRegions`/`decodeRegions`) — all 30+ INTERNAL_TO_URL_CODE entries, both directions
- Filter active predicates (`isDateFilterActive`, `isRatingFilterActive`) — wrong predicates send spurious or missing constraints to OpenAlex API
- `buildFilterData` section assembly — drives filter badge display; wrong sections mislead users about active filters
- CSV escape and `jsonToCSV` — corrupt exports permanently damage user trust in downloaded data
- `formatAnswerForCSV` / `formatAnswerForExcel` — all answer types including null, boolean, number, array
- AI prompt structural invariants — operator preservation, abstract-only mode, evidence ID format
- Zod schema parse contracts — `queryEnhancementSchema`, `screeningQuestionsSchema`, dynamic `createScreeningResponsesSchema`
- `validateQuery` balanced parentheses and trailing operator detection
- `encodeQuestionKey` / `decodeQuestionKey` round-trip with special characters
- Batch fail-soft: all-success, all-fail, partial failure, empty batch, single item
- Auth state machine: `assertActiveUser` for active, suspended, and deleted states
- `PLAN_CONFIG` shape contract — credit amounts and tier values are load-bearing constants
- `getPlanTypeFromMetadata` — all four plan strings plus unknown input
- `subscriptionsFeatureFlags.enabled` env var (with `vi.resetModules()` pattern)
- `generateMissingScreeningCombinationsByPaper` — missing detection correctness

**Should have — v2.x (P2):**
- `createSearchParameters` API params shape — full filter-to-OpenAlex-API translation correctness
- `getScreeningQuestionsConfig` deduplication post-process — requires logic extraction before testing
- `repairJSON` / `repairSingleField` malformed AI response recovery paths
- `applyTierFreeCreditCap` all plan caps — cap enforcement for all four plan tiers
- `syncProfileFromSession` no-overwrite guard — profile field retention on re-login
- `exportToCSV` column inclusion/exclusion by `ExportOptions` flags — requires DOM separation refactor

**Defer to v3+:**
- Integration tests for cross-cutting flows (auth check to plan gate to credit deduction to result) — requires Convex test environment or full mock context
- `exportToExcel` worksheet cell type validation — requires sheet-data builder extraction from DOM download wrapper
- TDD workflow integration tests for features added after v2.0

### Architecture Approach

The project already has a well-established two-tier architecture (Playwright E2E + Vitest unit) with a separate live-billing layer. New v2.0 tests slot into the existing Vitest unit tier — no new directories, no new configs for the bulk of the work. The flat `tests/` convention (40+ files, one-per-module naming) is the established law; all new files follow `[domain]-[module].test.ts` naming. Six architecture patterns handle all test scenarios across the six domains. See `.planning/research/ARCHITECTURE.md` for full pattern implementations and data flow diagrams.

**Major components:**
1. `vitest.config.ts` (updated) — `environmentMatchGlobs` routes `convex/**` to `edge-runtime`, `tests/hooks/**` to `jsdom`, all else stays `node`; also adds `plugins: [react()]` and `server.deps.inline: ["convex-test"]`
2. `tests/setup.ts` (new) — global `@testing-library/jest-dom/vitest` import + RTL `cleanup` in `afterEach`
3. `convex/test.setup.ts` (new) — Vite `import.meta.glob` for `convex-test` module discovery
4. 21 new test files in `tests/` — flat directory, one per source module, following the established `[domain]-[module].test.ts` naming convention

**Six test patterns by use case:**
- Pattern 1 (Direct Import): Pure functions — no mocks; covers ~80% of all test targets
- Pattern 2 (Env Var Gate): Feature flags — `vi.resetModules()` + dynamic `import()` per test
- Pattern 3 (Injected Mock Context): Convex mutations/queries — `makeCtx()` with `vi.fn()` stubs
- Pattern 4 (Mock runMutation Injection): Webhook dispatchers — inject `vi.fn()` as `runMutation` arg
- Pattern 5 (AI Model Mock): LLM orchestration — `MockLanguageModelV3` from `ai/test`
- Pattern 6 (Source-Code Assertion): Structural contracts — `readFileSync` assertions; use sparingly

### Critical Pitfalls

1. **`convex-test` getUserIdentity bug blocks auth-gated mutation/query testing** — Do not test `requireAuth`-gated functions end-to-end through `convex-test`. The `asyncSyscall does not support: 1.0/getUserIdentity` error is a confirmed open bug (issue #50, February 2026). Extract pure business logic (state checks, field merge logic) into standalone functions and test those directly with Pattern 3 (injected mock context).

2. **Encoding existing bugs as test assertions during backfill** — Never derive expected values by running the implementation and copying output. Derive from the business specification: for credit billing, compute from documented pricing (`$0.25/1M tokens at 40x markup = X credits`). Any assertion whose expected value adjusts automatically when the implementation changes is encoding a bug, not specifying correct behavior.

3. **`MockLanguageModelV3` imported outside test files crashes production** — Gate all `from 'ai/test'` imports strictly to `*.test.ts` files. Importing `ai/test` in server code or startup scripts throws `"Vitest failed to access its internal state"` at runtime (confirmed ai@5.0.27+ regression, GitHub issue #8356).

4. **`Promise.allSettled` batch tests covering only the all-success path** — Require three scenarios for every batch processor test: all-success, all-fail, and partial-failure (item[1] fails, items[0] and [2] succeed). The fail-soft guarantee is the critical correctness property of the batch processor; it is invisible to tests that configure a uniformly successful mock model.

5. **Feature flag module cache — env mutations after import have no effect** — Modules that read `process.env` at import time cache the value. Always combine env mutation with `vi.resetModules()` and dynamic `import()` in each test case. The exact pattern is already established in `tests/extraction-filtering.test.ts` — replicate exactly for every feature flag test file.

## Implications for Roadmap

Based on combined research, suggest four phases following the dependency order established in ARCHITECTURE.md. The build order is driven by three factors: module dependency chains, risk (highest-value coverage first), and TDD red-green-refactor (tests must be writable before the target code changes).

### Phase 1: Test Infrastructure and Pure Function Foundations

**Rationale:** Install the 7 new packages, update `vitest.config.ts` with `environmentMatchGlobs`, create `tests/setup.ts` and `convex/test.setup.ts`. Establish which code is testable via direct import vs. `convex-test` vs. local backend. Write the fastest, zero-dependency tests first: AI errors, AI validate, question key codec, AI cost, feature flag guards, plan enforcement constants, filter config. These have no mocks and validate the infrastructure is working correctly before writing more complex tests.

**Delivers:** Working multi-environment Vitest config that preserves all 43 existing tests, 7 new test files covering zero-dependency pure utility functions, documented testability boundaries for Convex code.

**Addresses:** Feature flag env var guard, plan constants snapshot, `validateQuery`, `encodeQuestionKey`/`decodeQuestionKey`, AI error hierarchy, feature flag guards, plan tier cap enforcement.

**Avoids:** Pitfall 10 (feature flag module cache) — establish `vi.resetModules()` utility pattern on the first feature flag test. Pitfall 3 (`MockLanguageModelV3` in production) — establish import discipline from day one. Pitfall 4 (encoding bugs) — establish the expected-value-from-spec rule in code review.

**Research flag:** Standard patterns, all fully specified. Skip `gsd:research-phase` — the `environmentMatchGlobs` config and `tests/setup.ts` content are specified in STACK.md with exact code. Validate existing 43 tests still pass after config change before adding new tests.

### Phase 2: AI and Batch Processing Tests

**Rationale:** With Phase 1 foundations in place, add the AI domain tests that depend on the error/validate layer from Phase 1. The AI batch processor's `Promise.allSettled` fail-soft pattern is the highest credit-risk code path in the application — a partial failure that silently loses results would cause incorrect credit charges. This phase also establishes `MockLanguageModelV3` as the team standard before any other developer writes an AI mock.

**Delivers:** 7 new test files covering `executeAIOperation` retry/repair/usage, `processBatch` all three scenarios, AI prompt builders structural invariants, Zod schema parse contracts, question key codec, and `generateMissingScreeningCombinationsByPaper`.

**Uses:** `MockLanguageModelV3` from `ai/test` (already installed — no new package required).

**Avoids:** Pitfall 3 (wrong `generateObject` mocking — use `MockLanguageModelV3` not `vi.mock('ai', ...)`), Pitfall 5 (`withAuthAndCreditsBatch` testing through full stack — test constituent pure functions instead), Pitfall 9 (only happy path for `Promise.allSettled` — enforce three-scenario rule).

**Research flag:** Standard patterns fully documented. Skip `gsd:research-phase`. The `MockLanguageModelV3` usage pattern and `processBatch` mock structure are specified in detail in STACK.md and ARCHITECTURE.md.

### Phase 3: Search Parameter, Filter, and Export Tests

**Rationale:** Search param and export tests are pure function tests with no mocks — highest-value per line of test code. The region codec bijectivity test (both directions, all 30+ entries) is the first test to write in this phase to catch URL sharing regressions. Export tests require extracting column-building logic from DOM-dependent download functions before testing — this refactor is a positive side effect that makes the production code more testable.

**Delivers:** 7 new test files covering search param round-trips, region codec bijectivity, filter builder section assembly, filter active predicates, CSV escaping, `jsonToCSV` header derivation and row generation, `formatAnswerForCSV`/`formatAnswerForExcel` all answer types.

**Avoids:** Pitfall 6 (one-directional codec tests — require both `parse(serialize(x)) === x` and `serialize(parse(s)) === s` for every INTERNAL_TO_URL_CODE entry), Pitfall 7 (missing `withNuqsTestingAdapter` — note: nuqs hook integration tests requiring jsdom are deferred to v2.x; this phase covers all pure serialization logic in node environment).

**Research flag:** All targets are pure functions with direct imports. Skip `gsd:research-phase`. One gap: `exportToCSV` column-building logic is currently coupled to `downloadFile` (DOM). Assess the extraction scope at the start of this phase — the refactor may reveal unexpected dependencies.

### Phase 4: User Management and Auth State Machine Tests

**Rationale:** Auth tests come last because they require the most care around testability boundaries and layer separation. The Convex identity system (`convex-test` getUserIdentity bug) and the Clerk client identity system (`useAuth()` mocks) must not be conflated in the same test file. Establishing this boundary explicitly before writing the tests prevents the most expensive rework of the milestone.

**Delivers:** 5 new test files covering `assertActiveUser` for all three states, `createUserWithDefaults` initial state correctness, `getPlanTypeFromMetadata` all plan strings, `ensureUser` create vs. update path, and two integration tests wiring credit billing to balance enforcement and filter state to export shape.

**Implements:** Injected mock context pattern (Pattern 3) for Convex functions; integration test data flow (two modules composed in sequence).

**Avoids:** Pitfall 1 (`convex-test` getUserIdentity bug — test pure extracted logic via injected mock context instead), Pitfall 8 (conflating Clerk client identity with Convex server identity — each test file must document which auth layer it tests), Pitfall 4 (encoding suspended-user bug as correct behavior — derive expected FORBIDDEN error from the documented state machine spec).

**Research flag:** Needs targeted assessment at phase kickoff. Determine per-function whether `ensureUser` can be tested via injected mock context or requires pure function extraction first. Check convex-test issue #50 status — if fixed, some tests can use `convex-test` end-to-end instead of mock context.

### Phase Ordering Rationale

- Infrastructure before feature tests: `vitest.config.ts` changes affect all subsequent tests; validate existing tests still pass before adding new ones.
- AI before search/export: the AI batch processor is the highest credit-risk code path; cover it before lower-risk pure functions.
- Search/export before user management: search and export are the simplest pure-function tests; build team confidence with the patterns before tackling the more complex Convex auth boundary decisions.
- Integration tests at the end of each domain: they wire already-tested modules together and cannot be written meaningfully before the individual modules are understood.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (infrastructure):** The `environmentMatchGlobs` config interacts with the existing 43 test file paths. Validate that all existing tests still pass after the config change before proceeding.
- **Phase 4 (auth state machine):** The testability boundary for `ensureUser` (mock context vs. pure extraction) must be assessed function-by-function before test planning. Check convex-test issue #50 at phase kickoff.

Phases with standard patterns (skip research-phase):
- **Phase 2 (AI tests):** `MockLanguageModelV3` is fully documented with official examples. `processBatch` structure is well-understood from codebase inspection.
- **Phase 3 (search/export tests):** All targets are pure functions with direct imports. No novel testing infrastructure required.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified via `npm show`; `ai/test` and `nuqs/adapters/testing` verified by direct `node_modules` inspection of installed packages |
| Features | HIGH | Direct codebase inspection of all 6 domain source files + all 43 existing test files; gaps are clearly identified with implementation notes |
| Architecture | HIGH | All six test patterns drawn from existing tests in the repository; no speculative patterns introduced; build order validated against module dependency graph |
| Pitfalls | HIGH | Critical pitfalls verified against official docs, confirmed open GitHub issues (convex-test #50, ai issue #8356), and direct codebase analysis |

**Overall confidence:** HIGH

### Gaps to Address

- **`ensureUser` testability boundary:** Whether `convex/users/mutations.ts:ensureUser` can be tested via injected mock context or requires further pure function extraction is not yet confirmed. Assess at the start of Phase 4 before writing Phase 4 tests.
- **`exportToCSV` column logic coupling:** The column-building logic in `exportToCSV` is currently coupled to `downloadFile` (DOM-dependent). Extracting it is a required refactor before Phase 3 column-inclusion tests can be written. The refactor scope may reveal unexpected dependencies — assess at Phase 3 kickoff.
- **convex-test issue #50 resolution timeline:** If the `getUserIdentity` bug is fixed before Phase 4 begins, some auth tests can shift from the injected mock context pattern to `convex-test` end-to-end tests. Check the GitHub issue status at Phase 4 kickoff.

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection: `tests/*.test.ts` (43 files), `vitest.config.ts`, `package.json`, `node_modules/ai/package.json`, `node_modules/nuqs/package.json`, all 6 domain source files — confirmed package versions, subpath exports, existing test patterns
- [convex-test official docs](https://docs.convex.dev/testing/convex-test) — `environmentMatchGlobs` config, `modules` glob pattern, `convexTest()` usage, documented limitations
- [AI SDK Core Testing docs](https://ai-sdk.dev/docs/ai-sdk-core/testing) — `MockLanguageModelV3`, `mockValues()`, `simulateReadableStream`, import from `ai/test`
- [nuqs Testing Documentation](https://nuqs.dev/docs/testing) — `withNuqsTestingAdapter`, `hasMemory`, `onUrlUpdate`, bijectivity test helpers
- [convex-test GitHub issue #50](https://github.com/get-convex/convex-test/issues/50) — `getUserIdentity` fails in queries/mutations via `asyncSyscall`; confirmed open February 2026
- [ai@5.0.27+ runtime issue #8356](https://github.com/vercel/ai/issues/8356) — `MockLanguageModelV3` imported outside Vitest worker crashes production with "Vitest failed to access its internal state"
- `npm show convex-test`, `npm show @edge-runtime/vm`, `npm show @testing-library/react`, `npm show @testing-library/user-event`, `npm show @testing-library/jest-dom`, `npm show jsdom`, `npm show @vitejs/plugin-react` — all versions verified

### Secondary (MEDIUM confidence)

- [Testing React Components with Convex](https://stack.convex.dev/testing-react-components-with-convex) — `vi.mock("convex/react")` pattern, `ConvexReactClientFake`
- [Backfilling Tests — professorbeekums.com](https://blog.professorbeekums.com/backfilling-tests/) — encoding existing bugs as correct behavior risk during backfill
- [TDD anti-patterns chapter 1 — codurance.com](https://www.codurance.com/publications/tdd-anti-patterns-chapter-1) — over-mocking, testing mocks not behavior
- [nuqs GitHub discussion #259](https://github.com/47ng/nuqs/issues/259) — community testing patterns and missing adapter gotchas
- [Clerk Next.js Testing Guide](https://clerk.com/blog/testing-clerk-nextjs) — mock `@clerk/nextjs` hooks; layer boundary discipline

### Tertiary (LOW confidence)

- None — all critical findings are HIGH or MEDIUM confidence from official or directly verified sources.

---
*Research completed: 2026-02-28*
*Ready for roadmap: yes*
