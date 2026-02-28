# Roadmap: OpenAlex Count -- Stripe Billing

## Milestones

- v1.0 Stripe Integration Audit -- Phases 1-3 (shipped 2026-02-27)
- v1.1 Upgrade Flow -- Phases 4-6 (shipped 2026-02-27)
- v1.2 E2E Billing Tests -- Phases 7-13 (shipped 2026-02-28)
- v2.0 TDD & Test Coverage -- Phases 14-21 (in progress)

## Phases

<details>
<summary>v1.0 Stripe Integration Audit (Phases 1-3) -- SHIPPED 2026-02-27</summary>

- [x] Phase 1: Subscription Lifecycle Correctness (3/3 plans) -- completed 2026-02-27
- [x] Phase 2: Credit System Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 3: Operational Hardening (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>v1.1 Upgrade Flow (Phases 4-6) -- SHIPPED 2026-02-27</summary>

- [x] Phase 4: Upgrade Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 5: Upgrade Resilience (2/2 plans) -- completed 2026-02-27
- [x] Phase 6: UX Polish (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.1-ROADMAP.md`

</details>

<details>
<summary>v1.2 E2E Billing Tests (Phases 7-13) -- SHIPPED 2026-02-28</summary>

- [x] Phase 7: Test Infrastructure Foundation (3/3 plans) -- completed 2026-02-28
- [x] Phase 8: Subscription and Upgrade Specs (2/2 plans) -- completed 2026-02-28
- [x] Phase 9: Lifecycle and Credit Specs (2/2 plans) -- completed 2026-02-28
- [x] Phase 10: Fix Credits Spec Auth Wiring (1/1 plan) -- completed 2026-02-28
- [x] Phase 11: Tech Debt Cleanup (1/1 plan) -- completed 2026-02-28
- [x] Phase 12: Billing E2E CI Wiring (1/1 plan) -- completed 2026-02-28
- [x] Phase 13: CI Env Hardening & CRED-02 Regression (1/1 plan) -- completed 2026-02-28

Full details: `.planning/milestones/v1.2-ROADMAP.md`

</details>

### v2.0 TDD & Test Coverage (In Progress)

**Milestone Goal:** Backfill high test coverage across search & extraction, AI/LLM features, and user management with unit tests, establishing strict TDD as the standard for all future development.

- [x] **Phase 14: Test Infrastructure** - Multi-environment Vitest config, new dependencies, setup files, zero-regression validation (completed 2026-02-28)
- [x] **Phase 15: AI Prompts & Schema Tests** - Prompt builder structural invariants, Zod schema contracts, query validation, JSON repair (completed 2026-02-28)
- [ ] **Phase 16: AI Batch Processing Tests** - Fail-soft batch processing with all-success, all-fail, and partial-failure coverage
- [ ] **Phase 17: AI Cost & Billing Tests** - Provider pricing models, usage aggregation, model registry lookups
- [ ] **Phase 18: Search & Filter Tests** - Search param translation, region codec bijectivity, filter builders, URL serialization round-trips
- [ ] **Phase 19: Data Export Tests** - CSV/JSON export correctness, answer formatting, citation helpers, download output shape
- [ ] **Phase 20: User Auth & State Machine Tests** - Auth state transitions, user creation atomicity, profile sync guards
- [ ] **Phase 21: Plan Enforcement & Feature Gating Tests** - Plan config contracts, tier enforcement, feature flag guards, subscription selection

## Phase Details

### Phase 14: Test Infrastructure
**Goal**: Vitest supports three test environments (node, edge-runtime, jsdom) with all 43 existing tests passing unmodified
**Depends on**: Nothing (first phase of v2.0)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05
**Success Criteria** (what must be TRUE):
  1. Running `vitest run` executes all 43 existing tests and they pass with zero modifications to existing test files
  2. Vitest config routes `convex/**/*.test.ts` to edge-runtime, `tests/hooks/**/*.test.ts` to jsdom, and all other tests to node
  3. Global test setup file provides jest-dom matchers and RTL cleanup in afterEach
  4. Convex test setup module discovers all Convex modules for convex-test isolation
  5. All 7 new devDependencies (convex-test, @edge-runtime/vm, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, jsdom, @vitejs/plugin-react) are installed and importable
**Plans:** 1/1 plans complete
Plans:
- [ ] 14-01-PLAN.md -- Install dependencies, create setup files, update Vitest config with multi-environment routing

### Phase 15: AI Prompts & Schema Tests
**Goal**: Every AI prompt builder produces structurally correct output and every Zod schema enforces its contract
**Depends on**: Phase 14
**Requirements**: AIPR-01, AIPR-02, AIPR-03, AIPR-04, AIPR-05, AIPR-06
**Success Criteria** (what must be TRUE):
  1. Each prompt builder (enhance, screening questions, screening responses, translate query, translate paper, extraction questions) produces output containing all required structural fields
  2. `validateQuery` rejects unbalanced parentheses and trailing Boolean operators
  3. `repairJSON` and `repairSingleField` recover parseable output from common malformed AI response patterns
  4. All Zod schemas accept valid inputs and reject inputs with missing or wrong-typed fields
  5. `encodeQuestionKey`/`decodeQuestionKey` and `encodeQuestionResponseMap`/`decodeQuestionResponseMap` round-trip correctly for ASCII and non-ASCII text
**Plans**: 2 plans
Plans:
- [ ] 15-01-PLAN.md -- Prompt builder structural tests + validateQuery/repairJSON/repairSingleField tests
- [ ] 15-02-PLAN.md -- Zod schema accept/reject tests + question key codec round-trip tests

### Phase 16: AI Batch Processing Tests
**Goal**: Batch processors handle success, failure, and partial-failure scenarios with correct result accumulation and error capture
**Depends on**: Phase 15
**Requirements**: AIBP-01, AIBP-02, AIBP-03, AIBP-04, AIBP-05, AIBP-06
**Success Criteria** (what must be TRUE):
  1. `processBatch` with all items succeeding returns all results with correct per-item usage accumulation
  2. `processBatch` with all items failing returns empty results and captures every error
  3. `processBatch` with mixed outcomes returns successful results while capturing errors for failed items (fail-soft guarantee)
  4. `processScreeningBatch` and `processTranslationBatch` correctly pass domain-specific context (question config, target language) through to each item
  5. `generateMissingScreeningCombinationsByPaper` identifies exactly which (paper, question) pairs lack responses
**Plans**: TBD

### Phase 17: AI Cost & Billing Tests
**Goal**: Cost calculation and model registry return correct values for all supported providers and models
**Depends on**: Phase 14
**Requirements**: AICB-01, AICB-02, AICB-03, AICB-04
**Success Criteria** (what must be TRUE):
  1. `calculateCostInDollars` returns correct cost for each provider's pricing model (OpenAI, Anthropic, Google, DeepSeek)
  2. `aggregateUsage` correctly sums token counts across multiple usage objects including edge cases (empty array, single item)
  3. `getModelPricing` returns zero pricing for unknown models and correct pricing for every known model
  4. `getModelById`, `getModelsForProvider`, `getDefaultModelForProvider` return correct model configs and handle missing/unknown inputs gracefully
**Plans**: TBD

### Phase 18: Search & Filter Tests
**Goal**: Search parameter construction, region encoding, and filter logic produce correct OpenAlex API params from all input combinations
**Depends on**: Phase 14
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-05, SRCH-06
**Success Criteria** (what must be TRUE):
  1. `createSearchParameters` translates every filter type (field, year range, date range, cites, citedBy, relatedTo, region, countryFocus, reviewOnly) to correct OpenAlex API params
  2. Region codec passes bijectivity test: `decode(encode(x)) === x` AND `encode(decode(s)) === s` for every INTERNAL_TO_URL_CODE entry
  3. `buildFilterData` assembles correct filter sections for each filter type and filter active predicates return correct booleans
  4. `validateAndExpandKeywords` rejects invalid queries and expands keyword bookmarks correctly
  5. URL param serialization round-trips: `parse(serialize(params))` produces identical params
**Plans**: TBD

### Phase 19: Data Export Tests
**Goal**: CSV and JSON exports produce correct output with proper formatting, escaping, and field inclusion based on export options
**Depends on**: Phase 14
**Requirements**: EXPRT-01, EXPRT-02, EXPRT-03, EXPRT-04, EXPRT-05
**Success Criteria** (what must be TRUE):
  1. `jsonToCSV` produces correct CSV with proper headers, row values, and special character escaping (commas, quotes, newlines)
  2. `exportToCSV` and `exportToJSON` include or exclude fields correctly based on ExportOptions flags (includeMetadata, includeConfidence, includeReasoning, includeCitations)
  3. `formatAnswerForCSV` and `formatAnswerForExcel` handle all answer types correctly (null, boolean, number, string, array)
  4. Citation helpers (`getStructuredCitations`, `getCitationStatus`, `getPrimaryCitation`, `getAllCitationLocations`) return correct data and respect PDF feature flag gating
  5. `downloadAll` and `downloadItem` produce correct output for both JSON and CSV formats with search metadata included
**Plans**: TBD

### Phase 20: User Auth & State Machine Tests
**Goal**: Auth state machine enforces correct access control and user creation produces atomically correct initial state
**Depends on**: Phase 14
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):
  1. `assertActiveUser` allows active users through, throws FORBIDDEN for suspended users, and throws FORBIDDEN for deleted users
  2. `createUserWithDefaults` atomically creates a user row, a credits row (freeBalance=2000), and a subscription row (plan=free, status=active)
  3. `ensureUser` creates a new user on first login and updates only `lastLoginAt` on return visits without overwriting existing profile fields
  4. `syncProfileFromSession` patches only blank profile fields and preserves existing non-empty values
**Plans**: TBD

### Phase 21: Plan Enforcement & Feature Gating Tests
**Goal**: Plan configuration, tier enforcement, and feature flags correctly gate access to paid features
**Depends on**: Phase 14
**Requirements**: PLAN-01, PLAN-02, PLAN-03, PLAN-04, PLAN-05
**Success Criteria** (what must be TRUE):
  1. `PLAN_CONFIG` contains correct credit amounts and tier values for all four plans (free, go, pro, enterprise)
  2. `getPlanTier`, `getFreeCreditCapForPlan`, `getPlanFromPriceId` return correct values for all plan types and handle unknown inputs
  3. `requirePlanTier` throws `EXTRACTION_PLAN_REQUIRED` when user tier is below minimum and passes when tier is sufficient
  4. All server-side feature flag guards (`requireCreditsEnabled`, `requireCreditTopupsEnabled`, `requireSubscriptionsEnabled`) throw when disabled and pass when enabled, using `vi.resetModules()` for env var isolation
  5. `selectCanonicalSubscription` returns the correct subscription when multiple rows exist following priority ordering
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 14 -> 15 -> 16 -> 17 -> 18 -> 19 -> 20 -> 21

Note: Phases 17, 18, 19, 20, 21 all depend only on Phase 14 and can theoretically execute in any order after Phase 14 completes. Phase 16 depends on Phase 15. The listed order follows research-recommended priority (highest credit-risk AI code first, then search/export, then auth/plan enforcement).

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Subscription Lifecycle Correctness | v1.0 | 3/3 | Complete | 2026-02-27 |
| 2. Credit System Correctness | v1.0 | 2/2 | Complete | 2026-02-27 |
| 3. Operational Hardening | v1.0 | 2/2 | Complete | 2026-02-27 |
| 4. Upgrade Correctness | v1.1 | 2/2 | Complete | 2026-02-27 |
| 5. Upgrade Resilience | v1.1 | 2/2 | Complete | 2026-02-27 |
| 6. UX Polish | v1.1 | 2/2 | Complete | 2026-02-27 |
| 7. Test Infrastructure Foundation | v1.2 | 3/3 | Complete | 2026-02-28 |
| 8. Subscription and Upgrade Specs | v1.2 | 2/2 | Complete | 2026-02-28 |
| 9. Lifecycle and Credit Specs | v1.2 | 2/2 | Complete | 2026-02-28 |
| 10. Fix Credits Spec Auth Wiring | v1.2 | 1/1 | Complete | 2026-02-28 |
| 11. Tech Debt Cleanup | v1.2 | 1/1 | Complete | 2026-02-28 |
| 12. Billing E2E CI Wiring | v1.2 | 1/1 | Complete | 2026-02-28 |
| 13. CI Env Hardening & CRED-02 Regression | v1.2 | 1/1 | Complete | 2026-02-28 |
| 14. Test Infrastructure | 1/1 | Complete    | 2026-02-28 | - |
| 15. AI Prompts & Schema Tests | 2/2 | Complete   | 2026-02-28 | - |
| 16. AI Batch Processing Tests | v2.0 | 0/0 | Not started | - |
| 17. AI Cost & Billing Tests | v2.0 | 0/0 | Not started | - |
| 18. Search & Filter Tests | v2.0 | 0/0 | Not started | - |
| 19. Data Export Tests | v2.0 | 0/0 | Not started | - |
| 20. User Auth & State Machine Tests | v2.0 | 0/0 | Not started | - |
| 21. Plan Enforcement & Feature Gating Tests | v2.0 | 0/0 | Not started | - |
