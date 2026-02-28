# Requirements: OpenAlex Count -- v2.0 TDD & Test Coverage

**Defined:** 2026-02-28
**Core Value:** Every major code path in search, AI, and user management has tests -- and every new feature is built test-first using strict red-green-refactor TDD.

## v2.0 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Test Infrastructure

- [ ] **INFRA-01**: Vitest config updated with `environmentMatchGlobs` routing convex tests to edge-runtime, hook tests to jsdom, and all existing tests to node
- [ ] **INFRA-02**: 7 new devDependencies installed (`convex-test`, `@edge-runtime/vm`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react`)
- [ ] **INFRA-03**: Global test setup file (`tests/setup.ts`) with jest-dom matchers and RTL cleanup
- [ ] **INFRA-04**: Convex test setup module (`convex/test.setup.ts`) for convex-test module discovery
- [ ] **INFRA-05**: All 43 existing tests pass after infrastructure changes with zero modifications

### Search & Filters

- [ ] **SRCH-01**: `createSearchParameters` correctly translates all filter combinations (field, year range, date range, cites, citedBy, relatedTo, region, countryFocus, reviewOnly) to OpenAlex API params
- [ ] **SRCH-02**: Region codec (`encodeRegions`/`decodeRegions`) passes bijectivity test in both directions for all INTERNAL_TO_URL_CODE entries
- [ ] **SRCH-03**: `buildFilterData` assembles correct filter sections for each filter type (search, time, geographic, content, ratings, citations)
- [ ] **SRCH-04**: All filter active predicates (`isDateFilterActive`, `isRatingFilterActive`, `isCountryFilterActive`, `isCitesFilterActive`, `isCitedByFilterActive`, `isRelatedToFilterActive`, `isReviewFilterActive`) return correct boolean for active and inactive states
- [ ] **SRCH-05**: `validateAndExpandKeywords` detects invalid queries (single char, unbalanced operators) and expands keyword bookmarks correctly
- [ ] **SRCH-06**: URL param serialization (`serializeSearchParams`) round-trips correctly -- serialize then parse produces identical params

### Data Export

- [ ] **EXPRT-01**: `jsonToCSV` produces correct CSV with proper headers, row values, and special character escaping
- [ ] **EXPRT-02**: `exportToCSV` / `exportToJSON` include correct fields based on `ExportOptions` flags (includeMetadata, includeConfidence, includeReasoning, includeCitations)
- [ ] **EXPRT-03**: `formatAnswerForCSV` and `formatAnswerForExcel` handle all answer types correctly (null, boolean, number, string, array)
- [ ] **EXPRT-04**: `getStructuredCitations`, `getCitationStatus`, `getPrimaryCitation`, `getAllCitationLocations` return correct data and respect PDF feature flag gating
- [ ] **EXPRT-05**: `downloadAll` and `downloadItem` produce correct output for both JSON and CSV formats with search metadata

### AI Prompts & Schemas

- [ ] **AIPR-01**: All prompt builders (`buildEnhanceQueryPrompts`, `buildScreeningQuestionsPrompts`, `buildScreeningResponsesPrompts`, `buildTranslateQueryPrompts`, `buildTranslatePaperContentPrompts`, `buildExtractionQuestionsPrompts`) produce structurally correct prompts with required fields
- [ ] **AIPR-02**: `validateQuery` detects unbalanced parentheses and trailing Boolean operators
- [ ] **AIPR-03**: `repairJSON` and `repairSingleField` recover malformed AI responses for common failure patterns
- [ ] **AIPR-04**: All Zod schemas (`queryEnhancementSchema`, `screeningQuestionsSchema`, dynamic `createScreeningResponsesSchema`) accept valid inputs and reject invalid ones
- [ ] **AIPR-05**: `encodeQuestionKey` / `decodeQuestionKey` round-trip correctly for ASCII and non-ASCII question text
- [ ] **AIPR-06**: `encodeQuestionResponseMap` / `decodeQuestionResponseMap` preserve all key-value pairs through round-trip encoding

### AI Batch Processing

- [ ] **AIBP-01**: `processBatch` handles all-success scenario -- returns all results with correct `usageByItemId` accumulation
- [ ] **AIBP-02**: `processBatch` handles all-fail scenario -- returns empty results with all errors captured
- [ ] **AIBP-03**: `processBatch` handles partial-failure scenario -- returns successful results while capturing errors for failed items
- [ ] **AIBP-04**: `processScreeningBatch` maps papers to screening configs correctly and passes through question context
- [ ] **AIBP-05**: `processTranslationBatch` passes target language through to each translation call
- [ ] **AIBP-06**: `generateMissingScreeningCombinationsByPaper` correctly identifies which (paper, question) pairs lack responses

### AI Cost & Billing

- [ ] **AICB-01**: `calculateCostInDollars` returns correct cost for each provider's pricing model (OpenAI, Anthropic, Google, DeepSeek)
- [ ] **AICB-02**: `aggregateUsage` correctly sums token counts across multiple usage objects
- [ ] **AICB-03**: `getModelPricing` returns `{0, 0}` for unknown models and correct pricing for known models
- [ ] **AICB-04**: `getModelById`, `getModelsForProvider`, `getDefaultModelForProvider` return correct model configs

### User Auth & State Machine

- [ ] **AUTH-01**: `assertActiveUser` allows active users, throws FORBIDDEN for suspended users, throws FORBIDDEN for deleted users
- [ ] **AUTH-02**: `createUserWithDefaults` atomically creates user row, credits row (freeBalance=2000), and subscription row (plan=free, status=active)
- [ ] **AUTH-03**: `ensureUser` creates new user on first login and updates `lastLoginAt` on return visits without overwriting existing profile fields
- [ ] **AUTH-04**: `syncProfileFromSession` only patches blank profile fields and does not overwrite existing values

### Plan Enforcement & Feature Gating

- [ ] **PLAN-01**: `PLAN_CONFIG` shape contract -- correct credit amounts and tier values for all four plans (free, go, pro, enterprise)
- [ ] **PLAN-02**: `getPlanTier`, `getFreeCreditCapForPlan`, `getPlanFromPriceId` return correct values for all plan types
- [ ] **PLAN-03**: `requirePlanTier` throws `EXTRACTION_PLAN_REQUIRED` when user tier is below minimum
- [ ] **PLAN-04**: All server-side feature flag guards (`requireCreditsEnabled`, `requireCreditTopupsEnabled`, `requireSubscriptionsEnabled`) throw when disabled and pass when enabled
- [ ] **PLAN-05**: `selectCanonicalSubscription` returns correct subscription when multiple rows exist (priority ordering)

## v2.1 Requirements

Deferred to next iteration. Tracked but not in current roadmap.

### Integration Tests

- **INTG-01**: Auth check -> plan gate -> credit deduction -> result flow tested end-to-end
- **INTG-02**: Filter state -> search params -> API call -> export shape tested across modules
- **INTG-03**: `exportToExcel` worksheet cell type validation with sheet-data builder extraction

### React Hook Tests

- **HOOK-01**: `useSubscriptionState` returns correct state for each auth phase and entitlement combination
- **HOOK-02**: `useProtectedQuery` / `useOptionalAuthQuery` gate queries correctly based on auth readiness
- **HOOK-03**: `useSearch` SWR integration with nuqs URL params via `withNuqsTestingAdapter`

## Out of Scope

| Feature | Reason |
|---------|--------|
| E2E tests for search/extraction flows | Playwright search suite is a separate milestone -- this focuses on unit + integration |
| React component rendering tests | Component tests require extensive mock setup with diminishing returns vs E2E |
| `convex-test` end-to-end auth-gated functions | Blocked by convex-test issue #50 (`getUserIdentity` bug) |
| TDD for features not yet built | TDD workflow established but applied to future milestones, not retroactively |
| CI pipeline changes for new tests | New tests run under existing `vitest` command -- no CI changes needed |
| Visual regression tests | Separate concern, notoriously flaky |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 14 | Pending |
| INFRA-02 | Phase 14 | Pending |
| INFRA-03 | Phase 14 | Pending |
| INFRA-04 | Phase 14 | Pending |
| INFRA-05 | Phase 14 | Pending |
| SRCH-01 | Phase 18 | Pending |
| SRCH-02 | Phase 18 | Pending |
| SRCH-03 | Phase 18 | Pending |
| SRCH-04 | Phase 18 | Pending |
| SRCH-05 | Phase 18 | Pending |
| SRCH-06 | Phase 18 | Pending |
| EXPRT-01 | Phase 19 | Pending |
| EXPRT-02 | Phase 19 | Pending |
| EXPRT-03 | Phase 19 | Pending |
| EXPRT-04 | Phase 19 | Pending |
| EXPRT-05 | Phase 19 | Pending |
| AIPR-01 | Phase 15 | Pending |
| AIPR-02 | Phase 15 | Pending |
| AIPR-03 | Phase 15 | Pending |
| AIPR-04 | Phase 15 | Pending |
| AIPR-05 | Phase 15 | Pending |
| AIPR-06 | Phase 15 | Pending |
| AIBP-01 | Phase 16 | Pending |
| AIBP-02 | Phase 16 | Pending |
| AIBP-03 | Phase 16 | Pending |
| AIBP-04 | Phase 16 | Pending |
| AIBP-05 | Phase 16 | Pending |
| AIBP-06 | Phase 16 | Pending |
| AICB-01 | Phase 17 | Pending |
| AICB-02 | Phase 17 | Pending |
| AICB-03 | Phase 17 | Pending |
| AICB-04 | Phase 17 | Pending |
| AUTH-01 | Phase 20 | Pending |
| AUTH-02 | Phase 20 | Pending |
| AUTH-03 | Phase 20 | Pending |
| AUTH-04 | Phase 20 | Pending |
| PLAN-01 | Phase 21 | Pending |
| PLAN-02 | Phase 21 | Pending |
| PLAN-03 | Phase 21 | Pending |
| PLAN-04 | Phase 21 | Pending |
| PLAN-05 | Phase 21 | Pending |

**Coverage:**
- v2.0 requirements: 41 total
- Mapped to phases: 41
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after roadmap creation*
