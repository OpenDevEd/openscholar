# Feature Research: TDD & Test Coverage Backfill (v2.0)

**Domain:** Unit and integration testing patterns for search/filter logic, AI/LLM features, batch processing, auth state machines, plan-based feature gating, and data export
**Researched:** 2026-02-28
**Confidence:** HIGH (direct codebase inspection of all six domains plus existing test patterns)

---

## Overview: Six Testing Domains

This milestone backfills test coverage across six distinct domains. Each domain has different table stakes, differentiators, and anti-patterns. The existing 43 Vitest unit test files establish a clear pattern: **pure function extraction → import → assert**, using no mocks unless boundary-forcing is required. All six domains follow this pattern with domain-specific adaptations.

**What already exists (do not duplicate):**
- Billing/Stripe/credit unit tests (43 files) — fully covered
- Billing E2E Playwright suite (11 tests) — fully covered
- `tests/extraction-v3-prompts.test.ts` — prompt builder tests exist (partial coverage)
- `tests/extraction-filtering.test.ts` — extraction filter tests exist (partial coverage)
- `tests/ai-mode-routing.test.ts` — AI mode routing tests exist
- `tests/ai-credit-billing.test.ts` — credit billing math covered
- `tests/clerk-webhook-handler.test.ts` — Clerk webhook dispatch covered
- `tests/subscription-entitlements.test.ts` — `isEntitledStatus` / `resolveEffectivePlan` covered
- `tests/search-actions-screening-export.test.ts` — screening export contract covered (source-level assertion pattern)

---

## Domain 1: Search Parameter Building and Filter Logic

**Source files:** `lib/search-params/parsers.ts`, `lib/search-params/converters.ts`, `lib/search-params/regions.ts`, `lib/filters/filter-builder.ts`, `lib/search-utils.ts`, `lib/utils.ts`

### Table Stakes

Features any serious search parameter test suite must verify. Missing these means filter logic can silently regress.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **URL param serialization round-trip** | `searchResultToParams` + `paramsToSearchResult` must be invertible — a search restored from URL must produce identical filter state. Any drift breaks shared links. | LOW | Pure function: no mocks. Test `paramsToSearchResult(searchResultToParams(entry))` equals original entry. |
| **Region encoding/decoding round-trip** | `encodeRegions`/`decodeRegions` is custom compact encoding. `'africa'` → `'AF'` → `'africa'`. Encoding errors produce broken API calls or URL corruption. | LOW | Pure function. Test all 30+ INTERNAL_TO_URL_CODE entries bidirectionally. |
| **`isDateFilterActive` predicate** | Controls whether date filters are sent to OpenAlex API. False positives add spurious date constraints to queries; false negatives drop user-set filters. | LOW | Pure function in `lib/utils.ts`. Cover all combinations of `filterType`, `yearRange`, `isYearRangeEnabled`, `dateRange`. |
| **`isRatingFilterActive` predicate** | Determines when rating range filter is applied. If wrong, rated-only toggle is ignored or always applied. | LOW | Pure function. Cover `onlyRated=false` always returns false regardless of range. |
| **`buildFilterData` section assembly** | `buildFilterData` assembles the structured filter badge data from `FilterParams`. Wrong sections cause wrong badges to appear in the UI history list. | MEDIUM | Pure function (with optional `t` param — pass `undefined` for unit tests). Cover: default field (omitted), non-default field (included), date section, geographic section, citation section. |
| **`countActiveFilters` and `getAllFilterItems`** | Drive the filter badge count on the search history card. Wrong count misleads users about how constrained their search is. | LOW | Pure functions wrapping `buildFilterData`. Cover zero-filter case returns 0, each filter type increments count. |
| **`hasActiveFilters` / `hasActiveFiltersFromResult`** | Used to show/hide the "Clear filters" button. False negative means users cannot clear filters; false positive means "Clear filters" appears on default state. | LOW | Pure function. Cover every independent filter type toggling the flag. |
| **`createSearchParameters` builds correct OpenAlex API params** | The `SearchFilters`→`OpenAlex API` translation is where wrong filters silently return wrong results. Date field mapping, sort mapping, filter type switching (year vs date) must all be correct. | MEDIUM | Pure function in `lib/utils.ts`. Test full filter objects with expected output shapes. |
| **`getFieldLabel` / `getSortLabel` label lookup** | Human-readable labels in filter badges. Wrong labels confuse users reading their search history. | LOW | Pure functions. Cover all FIELD_KEY_MAP entries, unknown field falls back to raw value. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Edge cases: empty string vs undefined params** | `cites: ''` and `cites: undefined` must both be treated as "no filter active" — the `isCitesFilterActive` guard must handle both. Regression risk from future param refactors. | LOW | Test `isCitesFilterActive('')`, `isCitesFilterActive(undefined)`, `isCitesFilterActive('W12345')` → false/false/true. |
| **`formatGeoSummary` internationalization boundary** | With `t=undefined`, produces English fallback strings. With `t` provided, uses translation keys. Test both paths to confirm no crash on missing translation function. | LOW | Pure function. Cover `t=undefined`, `t=mockFn`. |
| **Year range boundary: `filterType='year'` vs `'date'`** | When `filterType='date'`, the year range must be ignored even if set; when `filterType='year'`, date range ignored even if set. This mutual exclusion is easy to break. | MEDIUM | Test `createSearchParameters` with conflicting year+date filters — only the active type should appear in output. |
| **`DEFAULT_SEARCH_PARAMS` shape contract** | Any change to default param names or defaults breaks URL parsing and restoring from history. A test that asserts the exact shape acts as a canary. | LOW | Snapshot-style test: assert all keys and their default values. |

### Anti-Features

| Anti-Feature | Why Tempting | Why Avoid | Alternative |
|--------------|-------------|-----------|-------------|
| **Mocking `nuqs` parsers in tests** | "Let's mock the URL param library to control what the parser sees" | The parsers are configured objects, not imperative code. Mocking them tests the mock, not the logic. | Call `paramsToSearchResult` with plain objects that match `ParsedSearchParams` shape. The parsers are already tested by the nuqs library. |
| **Testing the `SearchProvider` component** | "Search context state management should be tested" | React context with hooks requires a rendering environment. The complex state lives in Zustand stores and pure converters — those are testable. | Extract converter logic to pure functions (already done). Test `submitNewSearch`, `searchResultToParams`, `paramsToSearchResult` directly. |
| **Testing the OpenAlex SDK call itself** | "We should verify the API call returns results" | This tests OpenAlex's infrastructure, not your code. Network-dependent tests are slow and flaky in CI. | Test `createSearchParameters` (pure function) produces the right params object. Trust the SDK maps those params to the correct API call. |

---

## Domain 2: AI Prompt Construction and Structured Output Schemas

**Source files:** `lib/ai/core/prompts.ts`, `lib/ai/core/schemas.ts`, `lib/ai/core/configs.ts`, `lib/ai/core/validate.ts`, `lib/ai/core/question-key-codec.ts`, `convex/extraction/prompts.ts`

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`buildEnhanceQueryPrompts` output shape** | System and user prompt must contain specific structural markers: JSON format instruction, operator rules (AND/OR/NOT must not be translated), retry preamble when `retryCount > 0`. Any regression silently degrades query enhancement quality. | LOW | Pure function. Assert `system` contains `"AND"/"OR"/"NOT"`, `prompt` contains the input query, `retryCount=1` appends retry warning. |
| **`buildScreeningQuestionsPrompts` language injection** | When `responseLanguage` is set, the prompt must include the language constraint. Missing this causes the AI to respond in the wrong language, breaking downstream parsing. | LOW | Pure function. Assert with and without `responseLanguage`. |
| **`buildTranslateQueryPrompts` operator preservation** | Translated queries must keep AND/OR/NOT untranslated. The system prompt must explicitly state this constraint. Without it, `AND` becomes `ET` in French, breaking OpenAlex syntax. | LOW | Pure function. Assert `system` contains operator-preservation instruction. |
| **`buildEnhancedExtractionPrompt` abstract-only mode** | When `evidence.length === 0`, the prompt must enter ABSTRACT-ONLY mode and instruct the model to return `supportEvidenceIds: []`. Without this, models hallucinate evidence IDs. | LOW | Already partially tested in `tests/extraction-v3-prompts.test.ts`. Cover: no abstract + no evidence, abstract only + no evidence, both present. |
| **`buildEnhancedExtractionPrompt` evidence ID embedding** | Each evidence item must appear as `[EVIDENCE {evidenceId}]` in the prompt. If the format changes, model citations break and cannot be validated against `evidencePool`. | LOW | Pure function. Assert exact format string for each evidence item. |
| **`createScreeningResponsesSchema` dynamic Zod schema** | The schema is built dynamically from question strings. Each question becomes a key with `z.union([z.boolean(), z.null()])`. A schema built from 0 questions, 1 question, and 5 questions must all produce valid Zod schemas without throwing. | MEDIUM | Pure function. Call `schema.safeParse(responses)` with valid and invalid data. Cover: missing key → invalid, extra key → invalid (strict), null → valid. |
| **`queryEnhancementSchema` / `screeningQuestionsSchema` parse contracts** | Zod schemas define the contract between the AI response parser and the app. Verify they accept valid responses and reject known bad shapes: missing fields, wrong types, empty arrays where min(1) applies. | LOW | Unit test each exported schema with `z.safeParse`. |
| **`validateQuery` balanced parentheses and no trailing operators** | Called on every enhanced query before use. Wrong validation lets bad queries reach OpenAlex. | LOW | Pure function. Cover: balanced → no throw, unbalanced → throws "unbalanced parentheses", trailing AND → throws. |
| **`encodeQuestionKey` / `decodeQuestionKey` round-trip** | Question keys in the response map are URL-encoded to handle question text as object keys. A round-trip failure corrupts the screening response map. | LOW | Pure function. Test with plain text, text with special chars, text with percent signs, empty string. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **`getScreeningQuestionsConfig` deduplication post-process** | The `postProcess` function filters questions already in `existingQuestions` using case-insensitive substring matching. Incorrect deduplication means duplicate questions appear to users. | MEDIUM | Pure function (extract and test `postProcess` separately). Cover: exact match removed, substring match removed (both directions), unrelated kept. |
| **`repairJSON` / `repairSingleField` recovery paths** | JSON repair determines whether a malformed AI response becomes a successful result or a hard error. Test the recovery path with known malformed JSON patterns. | MEDIUM | Pure async function. Cover: valid JSON passes through, truncated JSON repaired, non-JSON string wrapped in single-field object, null returned on unrepairable input. |
| **`STANDARD_PROVIDER_OPTIONS` shape contract** | Provider-specific options (`thinkingBudget: 0`, `reasoningEffort: 'minimal'`) prevent runaway inference costs. A change to these values silently increases per-call cost. | LOW | Snapshot assertion. Assert exact values for `google.thinkingConfig.thinkingBudget` and `openai.reasoningEffort`. |
| **Language name lookup (`getLanguageName`)** | Used to inject language name into prompts. An unknown language code must not throw — it should return a sensible fallback (or the raw code). | LOW | Pure function. Cover known codes (`'fr'` → `'French'`), unknown code (`'xx'` → fallback). |

### Anti-Features

| Anti-Feature | Why Tempting | Why Avoid | Alternative |
|--------------|-------------|-----------|-------------|
| **Calling `executeAIOperation` in unit tests** | "We should test the full AI operation end-to-end including retry logic" | `executeAIOperation` calls a live LLM (`generateObject` from the AI SDK). Unit tests cannot call LLMs — too slow, cost-incurring, and non-deterministic. | Test `buildPrompts` (pure function) separately from execution. Mock `generateObject` only in integration tests gated behind a separate CI job. |
| **Asserting exact prompt text character-for-character** | "Our prompt must contain exactly this sentence" | Prompts evolve. Brittle exact-match tests break on every prompt improvement. | Assert structural invariants: "system prompt contains operator constraint", "prompt contains input query", "retryCount=1 appends retry warning". Not byte-level equality. |
| **Testing Zod schema validation exhaustively for all wrong shapes** | "We should test every possible invalid shape for every schema" | Zod handles its own validation. Testing Zod's built-in behavior tests the library, not your code. | Test the specific shapes your app produces: the AI model's real output format. Cover 3-5 shapes: perfect response, missing required field, wrong type for a field, null where boolean expected. |

---

## Domain 3: Batch Processing with Promise.allSettled Fail-Soft Patterns

**Source files:** `lib/ai/core/batch.ts`, `lib/ai/core/batch-types.ts`, `convex/ai/actions.ts` (`processScreeningBatch`, `processTranslationBatch`), `lib/screening-utils.ts`

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **All-success batch: results populated, errors empty** | When all items succeed, `results` must contain all items, `errors` must be empty. The baseline case must work. | LOW | Pure function. Mock `executeAIOperation` to resolve for every item. Assert `Object.keys(results).length === items.length` and `errors.length === 0`. |
| **All-fail batch: errors populated, results empty** | When all items fail, `errors` must contain all items, `results` must be empty. The total-failure case must not throw — it must return a populated error list. | LOW | Mock `executeAIOperation` to reject for every item. Assert `errors.length === items.length` and `Object.keys(results).length === 0`. |
| **Partial failure: successful items in results, failed items in errors** | The core fail-soft guarantee: a single item failure must not abort remaining items. Results and errors are populated independently. This is the critical correctness property. | MEDIUM | Mock `executeAIOperation` to reject for item[1] and resolve for items [0,2]. Assert `results` has two entries, `errors` has one entry with `paperId === items[1].id`. |
| **Error message captured in `BatchError.error`** | The error message from a rejected promise must appear in the `BatchError` for that item. Without this, debugging partial failures is impossible. | LOW | Mock rejection with `new Error('rate limit exceeded')`. Assert `errors[0].error === 'rate limit exceeded'`. |
| **Non-Error rejection captured** | When a rejected promise contains a non-Error value (e.g., a string `'quota exceeded'`), it must be converted to a string in `BatchError.error`. | LOW | Mock rejection with string literal. Assert `errors[0].error === 'quota exceeded'`. |
| **`usageByItemId` maps each successful item to its usage** | Credit deduction uses `usageByItemId` to charge per item. Wrong mapping overcharges or undercharges. | MEDIUM | Mock usage with distinct token counts per item. Assert `usageByItemId[itemId].inputTokens` matches what the mock returned. |
| **`generateMissingScreeningCombinationsByPaper` correct missing detection** | Used to generate the batch of paper+question pairs to submit. Wrong missing detection either skips work or re-runs already-answered questions, wasting credits. | MEDIUM | Pure function in `lib/screening-utils.ts`. Cover: no existing responses → all combinations missing; one existing response → that pair excluded; all answered → empty result returned. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **`aggregateUsage` correct token sum** | Sums usage across all batch items for total cost tracking. Off-by-one or wrong aggregation causes credit ledger drift. | LOW | Pure function. Test with 3 usage objects: assert total `inputTokens` equals sum, total `outputTokens` equals sum. |
| **`usages` array preserves order of successes** | Callers may rely on usage ordering for correlation with results. Test that `usages` contains exactly as many entries as successful items, in settlement order. | LOW | Mock 3 items, 1 fails. Assert `usages.length === 2`. |
| **Empty batch returns valid empty result** | Calling `processBatch` with an empty items array must return `{ results: {}, errors: [], usages: [], usageByItemId: {} }` without throwing. | LOW | Edge case. No mocks needed — pass `[]`. |
| **Batch with single item** | One-item batches exercise the boundary between batch and single-call execution. Must not hit off-by-one in the `Promise.allSettled` loop. | LOW | Mock one item succeeds. Assert `results` has one entry. |

### Anti-Features

| Anti-Feature | Why Tempting | Why Avoid | Alternative |
|--------------|-------------|-----------|-------------|
| **Calling a real LLM inside batch tests** | "The batch processor should be tested with a real AI model to be realistic" | Calling LLMs in unit tests is slow (seconds per call), costs money, and is non-deterministic. A 10-item batch test would cost real credits. | Mock `executeAIOperation` at the module boundary. The batch processor's logic is entirely in the `Promise.allSettled` loop and the result aggregation — those are testable without an LLM. |
| **Testing `processScreeningBatch` / `processTranslationBatch` as Convex actions** | "We should test the Convex action endpoints for batch operations" | Convex actions require the Convex runtime (`ctx`, `ctx.auth`, etc.). They cannot be unit-tested without a live Convex deployment. The business logic in those actions is already extracted into pure functions. | Test the underlying pure functions (`processBatch`, `aggregateUsage`, `calculateServerCreditsToDeduct`). The Convex action wiring is integration-tested during actual use. |
| **Testing concurrency limits or rate limiting in unit tests** | "We should verify Promise.allSettled respects concurrent request limits" | `processBatch` intentionally sends ALL requests concurrently (no limit). Rate limiting is the responsibility of the LLM provider. Testing non-existent concurrency control tests nothing. | If rate limiting is added later, test the limiting function in isolation (e.g., a `chunkArray` utility). Not in the batch processor itself. |

---

## Domain 4: Auth State Machine (active/suspended/deleted)

**Source files:** `convex/lib/auth.ts`, `convex/users/mutations.ts`, `convex/lib/userCreation.ts`, `convex/webhooks/clerk.ts`

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`assertActiveUser` throws FORBIDDEN for suspended users** | Suspended accounts must be denied on every authenticated operation. If the check is missing or wrong, suspended users retain full access. | LOW | Pure function. Pass user objects with `state: 'suspended'` → assert throws with code `FORBIDDEN`. |
| **`assertActiveUser` throws FORBIDDEN for deleted users** | Deleted accounts must be denied. Same risk as suspended. | LOW | Same pattern as suspended. `state: 'deleted'` → assert throws. |
| **`assertActiveUser` passes for active users** | Active users must not be rejected. A bug that rejects all users would break the entire app. | LOW | Pass `state: 'active'` → assert no throw. |
| **`ensureUser` blocks suspended users at login** | The `ensureUser` mutation is called on every session. A suspended user who hits this must get FORBIDDEN, not be allowed in. | MEDIUM | Extract the state-check logic into a pure function or test the normalization path. The suspension check in `ensureUser` is duplicated from `assertActiveUser` — test both to catch divergence. |
| **`ensureUser` blocks deleted users at login** | Same as suspended — deleted users must not be allowed to log in through `ensureUser`. | MEDIUM | Same approach as suspended. |
| **`createUserWithDefaults` produces correct initial state** | New users start with `state: 'active'`, `freeBalance: signupFreeCredits`, `paidBalance: 0`, and a free subscription. Wrong initial state corrupts new user onboarding. | MEDIUM | Pure function (extract the `createUserWithDefaults` logic + `applyTierFreeCreditCap` into testable pure functions). Assert state fields on the returned insert args. |
| **`processClerkWebhookEvent` dispatches `user.created` → upsert** | Already tested in `tests/clerk-webhook-handler.test.ts`. Do not duplicate. | N/A | Skip — covered. |
| **`processClerkWebhookEvent` dispatches `user.deleted` → markDeleted** | `user.deleted` webhook must trigger `markUserDeletedFromClerk`. If dispatched to the wrong mutation, deletion has no effect. | LOW | Already partially tested. Verify the deleted case is covered explicitly. Extend `tests/clerk-webhook-handler.test.ts` if missing. |
| **Unknown Clerk event type returns 200 OK (no-op)** | Clerk sends many event types (organization events, session events). Unknown types must not throw — they should return 200 silently. | LOW | Test unknown `eventType` string → assert `{ status: 200, body: 'OK' }`. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **State transition: active → suspended is not reversible via `ensureUser`** | `ensureUser` only patches profile fields, not state. A suspended user who somehow calls `ensureUser` must remain FORBIDDEN (the state check happens before the patch). Verifying this prevents privilege escalation bugs. | MEDIUM | Verify the order of operations in `ensureUser`: state check BEFORE profile patch. Test with suspended user: should throw before reaching the patch code. |
| **`syncProfileFromSession` does not overwrite non-empty fields** | `syncProfileFromSession` only patches fields that are currently empty. If it overwrote existing values, users would lose profile edits on next login. | LOW | Extract the `if (!existing.field)` guard logic as a pure predicate. Test: populated email + new email → patch does not include email. |
| **`getCurrentUser` returns null for state !== 'active'** | `getCurrentUser` (used by queries) silently returns null for non-active users rather than throwing. This is intentional — queries should degrade gracefully. | LOW | Pure function logic. Verify `getCurrentUser` semantics vs `requireAuth` semantics: former returns null, latter throws. |

### Anti-Features

| Anti-Feature | Why Tempting | Why Avoid | Alternative |
|--------------|-------------|-----------|-------------|
| **Unit-testing Convex mutations directly** | "We should call `ensureUser` as a Convex mutation in tests to test the full flow" | Convex mutations require `ctx.db` (database), `ctx.auth` (identity), and the Convex runtime. These are not available in Vitest. Mocking the entire Convex context adds more mock code than production code. | Extract the pure decision logic (state checks, field merge logic) into standalone functions in `convex/lib/auth.ts` or a dedicated pure module. Test those. The Convex wiring is tested by use in the app. |
| **Mocking `ctx.auth.getUserIdentity`** | "Let's mock the identity to test requireAuth" | Mocking creates a parallel implementation that may diverge from reality. The real auth contract is between Clerk and Convex. | Test the extracted `assertActiveUser(user)` function directly with user objects. The Clerk-to-Convex identity flow is tested by the Clerk webhook handler tests and live E2E tests. |
| **Testing Clerk's JWT validation** | "We should verify that invalid tokens are rejected" | JWT validation is Clerk's responsibility, not yours. `ctx.auth.getUserIdentity()` returning null IS the rejection — you cannot simulate this in unit tests without the Convex runtime. | Test the application-level handling of `identity === null` by testing the code path that calls `createError("UNAUTHENTICATED", ...)`. |

---

## Domain 5: Plan-Based Feature Gating

**Source files:** `convex/ai/helpers.ts`, `convex/lib/constants.ts`, `lib/billing/entitlements.ts`, `lib/subscriptions/feature-flags.ts`, `lib/ai/client/mode-routing.ts`

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`getPlanTier` maps plan names to numeric tiers** | Tier numbers are used in `minPlanTier` guards. A wrong mapping grants features to the wrong plans. | LOW | Pure function from `convex/lib/constants.ts`. Assert `free→0`, `go→10`, `pro→20`, `enterprise→30`. Unknown plan must return 0 (most restrictive) or throw. |
| **Plan tier guard: `minPlanTier` in AI action config** | `translateQuery` has `{ minPlanTier: 10 }` (Go+ only). Free users who call it must get `AIPlanEntitlementError`. The guard in `withAuthAndCreditsBatch` / `createAIAction` must enforce this. | MEDIUM | Extract and test the plan tier comparison: `userTier >= minPlanTier`. Cover: free user (tier 0) + minPlanTier 10 → denied; go user (tier 10) + minPlanTier 10 → allowed; pro user (tier 20) + minPlanTier 10 → allowed. |
| **`isEntitledStatus` covers all subscription statuses** | Already tested in `tests/subscription-entitlements.test.ts`. Do not duplicate. | N/A | Skip — covered. |
| **`resolveEffectivePlan` collapses non-entitled to free** | Already tested in `tests/subscription-entitlements.test.ts`. Do not duplicate. | N/A | Skip — covered. |
| **`subscriptionsFeatureFlags.enabled` reads env var** | The feature flag controls whether billing/plan UI is shown. If the env var is not checked correctly, production shows wrong UI or disables billing in unexpected environments. | LOW | Module-level env var test using `vi.resetModules()` pattern (same as `tests/extraction-filtering.test.ts`). Assert `enabled=true` when var unset, `false` when var `==='false'`. |
| **`resolveModeConfigurability` for all three AI modes** | Already tested in `tests/ai-mode-routing.test.ts`. Do not duplicate. | N/A | Skip — covered. |
| **`PLAN_CONFIG` shape contract** | `creditsPerMonth`, `tier`, `freeCreditCap` for each plan are load-bearing constants used in credit grants, entitlements, and UI. A change to these values must be caught by a test. | LOW | Snapshot assertion. Assert exact values for all four plans: `free.creditsPerMonth === 0`, `go.creditsPerMonth === 3000`, `pro.creditsPerMonth === 15000`, `enterprise.creditsPerMonth === 150000`, etc. |
| **`getPlanTypeFromMetadata` recognizes all four plan strings** | Used in webhook handlers to classify Stripe subscription metadata. Wrong recognition means upgrades/downgrades apply the wrong plan. | LOW | Pure function. Assert `'go'→'go'`, `'pro'→'pro'`, `'free'→'free'`, `'enterprise'→'enterprise'`, `undefined→null`, `'premium'→null`. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **`applyTierFreeCreditCap` cap enforcement** | Free-tier users cannot accumulate free credits beyond their plan cap (2,000 for free, 6,000 for go). If the cap is wrong, free users get unlimited credits. | LOW | Pure function in `convex/lib/freeCredits.ts`. Test all four plan caps: adding below cap → accepted as-is, adding above cap → capped to plan limit, adding exactly at cap → no change. |
| **`calculateServerCreditsToDeduct` with AI cost markup** | Credits to deduct = `rawCost * AI_COST_MARKUP`. If markup is wrong, the platform loses margin or overcharges users. | LOW | Already covered by `tests/ai-credit-billing.test.ts`. Do not duplicate. Check if `AI_COST_MARKUP=1.3` is asserted. Add if missing. |
| **Consistency: `minPlanTier` values in action config match `PLAN_CONFIG.tier`** | If `PLAN_CONFIG.go.tier` changes from 10 to something else, but `minPlanTier: 10` hardcodes `10`, the guard breaks silently. A cross-reference test catches this. | LOW | Assert that all `minPlanTier` values used in action configs appear as `tier` values in `PLAN_CONFIG`. |

### Anti-Features

| Anti-Feature | Why Tempting | Why Avoid | Alternative |
|--------------|-------------|-----------|-------------|
| **Testing plan gating inside the Convex action handler** | "We should test that `translateQuery` action rejects free users end-to-end" | Requires live Convex runtime + auth. Too heavyweight for unit tests. | Extract and test `resolvePlanTierCheck(userPlan, minPlanTier)` as a pure predicate. Test the error-throwing path by calling `throwStructuredAIError` with a `AIPlanEntitlementError`. |
| **Mocking `process.env` without module reset** | "Let's set `process.env.NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED = 'false'` mid-test" | Module-level feature flags are evaluated at import time. Setting env vars after import has no effect. Tests will get the cached value. | Use `vi.resetModules()` and dynamic `import()` inside each test case, exactly as `tests/extraction-filtering.test.ts` does. |
| **Testing pricing page rendering for plan gating** | "We should Playwright-test that the Pro button is disabled for free users" | UI rendering of plan gates is a component test, not a unit test. The gating logic is pure and testable without rendering. | Test `resolveEffectivePlan`, `isEntitledStatus`, `resolveModeConfigurability` (already done). Rendering tests are out of scope for this milestone. |

---

## Domain 6: Data Export (CSV/JSON/Excel)

**Source files:** `lib/utils.ts` (`jsonToCSV`, `escapeCSVValue`, `downloadWithMetadata`, `generateFilename`, `createSearchParameters`), `lib/extraction/export.ts` (`exportToCSV`, `exportToExcel`, `exportToJSON`), `lib/search-actions.ts` (`downloadItem`, `downloadEssentialItem`, `downloadAll`)

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`escapeCSVValue` correctly escapes commas, quotes, and newlines** | CSV is whitespace-sensitive. Unescaped commas corrupt column alignment; unescaped quotes corrupt parsers; unescaped newlines corrupt row boundaries. These are the three causes of corrupt CSV downloads. | LOW | Pure function. Cover: plain string (no escape), string with comma, string with double-quote (→ doubled quote + wrapping), string with newline, empty string (→ `""`), number input (→ `String(number)`), object input (→ `JSON.stringify` + quote). |
| **`jsonToCSV` produces correct header row from mixed objects** | Headers are derived from the union of all object keys, sorted. If header derivation is wrong, columns appear in unpredictable order or columns from some objects are silently dropped. | MEDIUM | Pure function. Test: single object → headers match keys; array of objects with different keys → union of all keys, sorted; empty array → empty string. |
| **`jsonToCSV` handles values with special characters in all cells** | Every value in every row must go through `escapeCSVValue`. A value containing a comma in any column must not corrupt that row. | LOW | Test a 3-row dataset where row 2 has a comma in column 1 and a quote in column 2. Assert the output can be parsed back to the original data. |
| **`generateFilename` truncates and sanitizes to filesystem-safe name** | Filenames with slashes, colons, or other reserved chars crash downloads on Windows. Long titles produce unusable filenames. | LOW | Pure function. Test: normal title truncated to 30 chars; title with spaces and special chars replaced by `_`; suffix appended correctly; extension is `json` or `csv`. |
| **`formatAnswerForCSV` handles all answer types correctly** | Extraction results include `boolean`, `number`, `string`, and `array` types. Wrong type handling produces unreadable cells. | LOW | Pure function in `lib/extraction/export.ts`. Cover: `null` → `''`; `true` → `'Yes'`; `false` → `'No'`; `[1, 2, 3]` → `'1; 2; 3'`; plain string → unchanged. |
| **`formatAnswerForExcel` handles `number` type as number (not string)** | Excel cells with numbers stored as strings prevent arithmetic. The `number` branch must return `Number(answer)`, not `String(answer)`. | LOW | Pure function. Assert `typeof formatAnswerForExcel('42', 'number') === 'number'`. |
| **`withScreeningResults` attaches only for JSON format** | Already tested by contract test in `tests/search-actions-screening-export.test.ts` (source-level pattern check). Add a behavioral unit test. | LOW | Pure function. Pass `format='json'` with screening results → assert `screening_results` field present. Pass `format='csv'` → assert `screening_results` field absent. |
| **`ExportOptions` flags correctly include/exclude columns** | `includeMetadata`, `includeConfidence`, `includeReasoning`, `includeCitations` control which columns appear. A bug that ignores flags produces bloated or incomplete exports. | MEDIUM | Pure function path: call `exportToCSV` with `includeMetadata=false` → assert DOI/Year columns absent. Call with `includeConfidence=true` → assert confidence column present. Note: `exportToCSV` calls `downloadFile` (DOM-dependent). Extract column-building logic into a pure helper first. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **`jsonToCSV` round-trip** | Data exported to CSV then parsed back with a standard CSV parser must equal the original data (for simple cases without nested objects). This validates the entire CSV pipeline as a system. | MEDIUM | Test: generate CSV from array of `{ title, doi, year }` objects. Parse with a simple CSV parser (or manual split on newlines/commas). Assert round-trip equality. |
| **`exportToCSV` / `exportToJSON` / `exportToExcel` column ordering is deterministic** | Column ordering must not change between runs. Non-deterministic columns (from Set/Object.keys with unstable iteration) cause CI failures where column order differs between Node versions. | LOW | Run `exportToCSV` twice on the same data. Assert identical output. (Cannot test DOM `downloadFile` — test the column-generation path only.) |
| **`createSearchMetadata` produces correct filter summary** | Search metadata appears in downloaded JSON as context for the export. Wrong metadata misleads researchers about what filters produced the results. | LOW | Pure function in `lib/search-actions.ts`. Test with year range active, date range active, regions active. Assert the filters object in the returned metadata matches the input filters. |
| **Excel export uses correct cell types (XLSX)** | `formatAnswerForExcel` returns `Number(answer)` for number types, which `xlsx` stores as numeric cells. Verify the `XLSX.utils.aoa_to_sheet` sheet data contains actual numbers not strings in number columns. | HIGH | This requires the `xlsx` library to be available. Do NOT call `downloadFile` (DOM-dependent). Test the `sheetData` array construction in isolation by extracting it as a pure function. |

### Anti-Features

| Anti-Feature | Why Tempting | Why Avoid | Alternative |
|--------------|-------------|-----------|-------------|
| **Testing `downloadFile` / `URL.createObjectURL` / DOM link click** | "We should test that clicking download actually triggers a file download" | `URL.createObjectURL` and `document.createElement('a')` are DOM APIs unavailable in Vitest's Node environment. Mocking them tests the mock. | Test everything UP TO `downloadFile`. Extract the data-transformation logic (CSV string, XLSX worksheet, JSON string) into pure functions that return values. `downloadFile` is a thin DOM wrapper that can be tested in a browser environment if needed. |
| **Testing `downloadAll` as an async function with Zustand store** | "We should test that `downloadAll` correctly reads from the search history store and downloads all items" | `downloadAll` reads from `useSearchHistoryStore` (Zustand), calls `downloadWithMetadata` (DOM), and has no extractable pure logic. Testing it requires extensive mocking. | The pure functions it calls (`createSearchParameters`, `jsonToCSV`, `generateFilename`) are all individually tested. `downloadAll` itself is integration-tested by use. |
| **Using JSDOM to simulate file downloads** | "Let's configure Vitest to use JSDOM environment so we can test DOM APIs" | JSDOM's `URL.createObjectURL` is a stub that returns empty strings. The download never actually happens. The test passes but proves nothing about the actual download behavior. | Accept that DOM-dependent file download behavior is integration-tested by manual QA or browser-level tests. Focus unit tests on the pure data transformation pipeline. |

---

## Feature Dependencies

```
[Search Param Tests]
    |--depends-on--> [lib/search-params/parsers.ts] (pure, no deps)
    |--depends-on--> [lib/search-params/converters.ts] (pure, no deps)
    |--depends-on--> [lib/search-params/regions.ts] (pure, no deps)
    |--depends-on--> [lib/filters/filter-builder.ts] (pure, optional t() param)
    |--no-deps-on--> [React, Convex, Zustand]

[AI Prompt Tests]
    |--depends-on--> [lib/ai/core/prompts.ts] (pure, no deps)
    |--depends-on--> [lib/ai/core/schemas.ts] (pure, requires zod)
    |--depends-on--> [lib/ai/core/validate.ts] (pure, requires jsonrepair)
    |--depends-on--> [convex/extraction/prompts.ts] (pure, no deps)
    |--no-deps-on--> [LLM API calls, Convex runtime]

[Batch Processing Tests]
    |--depends-on--> [lib/ai/core/batch.ts] (requires mocking executeAIOperation)
    |--depends-on--> [lib/screening-utils.ts] (pure, no deps)
    |--mock-requires--> [lib/ai/core/execute.ts] (executeAIOperation)

[Auth State Machine Tests]
    |--depends-on--> [convex/lib/auth.ts] (extract assertActiveUser as standalone fn)
    |--depends-on--> [convex/webhooks/clerk.ts] (processClerkWebhookEvent already injectable)
    |--depends-on--> [convex/lib/userCreation.ts] (createUserWithDefaults needs ctx mock or extraction)
    |--no-deps-on--> [Live Convex runtime]

[Plan Gating Tests]
    |--depends-on--> [convex/lib/constants.ts] (pure, no deps)
    |--depends-on--> [lib/billing/entitlements.ts] (pure, no deps)
    |--depends-on--> [lib/subscriptions/feature-flags.ts] (env var — needs vi.resetModules())
    |--already-covered-by--> [tests/subscription-entitlements.test.ts]
    |--already-covered-by--> [tests/ai-mode-routing.test.ts]

[Export Tests]
    |--depends-on--> [lib/utils.ts] (escapeCSVValue, jsonToCSV — pure)
    |--depends-on--> [lib/extraction/export.ts] (formatAnswerForCSV/Excel — pure; exportToCSV calls DOM)
    |--extraction-requires--> [xlsx library] (already in package.json)
    |--dom-blocked--> [downloadFile, URL.createObjectURL, link.click]
```

### Dependency Notes

- **Auth state machine requires extraction:** `assertActiveUser` is currently inlined inside async functions that require `ctx`. To be unit-testable it needs to be a standalone exported function (already partially so in `convex/lib/auth.ts` — just export it directly).
- **Export tests require pure-function extraction:** `exportToCSV` builds the column data correctly but calls `downloadFile` at the end. The column-building logic must be extracted into a separate function that returns the data structure before downloading.
- **Batch tests require `executeAIOperation` mock:** `processBatch` calls `executeAIOperation` internally. Tests must mock this at the module boundary with `vi.mock('../lib/ai/core/execute', ...)`.
- **Feature flag tests require `vi.resetModules()`:** `lib/subscriptions/feature-flags.ts` reads `process.env` at module load time. Tests that set different env values must use `vi.resetModules()` + dynamic `import()`.

---

## MVP Definition (What to Build in This Milestone)

### Launch With (v2.0 table stakes)

Tests that cover the highest-risk code paths and lowest-effort extraction:

- [ ] **Search param round-trip** (`paramsToSearchResult` + `searchResultToParams`) — catches URL sharing regressions
- [ ] **Region encoding round-trip** (`encodeRegions`/`decodeRegions`) — all 30+ region codes
- [ ] **`buildFilterData` sections** — field, sort, date, geographic, rating, citation sections; default state emits no sections
- [ ] **`isDateFilterActive` / `isRatingFilterActive` predicates** — all combinations
- [ ] **`escapeCSVValue` all special character cases** — comma, quote, newline, empty string
- [ ] **`jsonToCSV` header derivation and row generation** — single object, array, mixed keys
- [ ] **`formatAnswerForCSV` / `formatAnswerForExcel`** — all answer types (null, bool, number, string, array)
- [ ] **AI prompt structural invariants** — `buildEnhanceQueryPrompts` operator constraint, `buildEnhancedExtractionPrompt` abstract-only mode (already partial)
- [ ] **Zod schema parse contracts** — `queryEnhancementSchema`, `screeningQuestionsSchema`, `createScreeningResponsesSchema` (dynamic)
- [ ] **`validateQuery` balanced parentheses** — balanced passes, unbalanced throws, trailing operator throws
- [ ] **`encodeQuestionKey` / `decodeQuestionKey` round-trip** — with special characters
- [ ] **Batch fail-soft: partial failure** — item[1] fails, items[0] and [2] succeed
- [ ] **Batch: all-success, all-fail, empty input, single item** — boundary cases
- [ ] **`assertActiveUser` for active/suspended/deleted** — three state assertions
- [ ] **`PLAN_CONFIG` shape contract** — snapshot of all tiers and their field values
- [ ] **`getPlanTypeFromMetadata`** — all four plan strings + unknown input
- [ ] **`subscriptionsFeatureFlags.enabled` env var** — with vi.resetModules()
- [ ] **`generateMissingScreeningCombinationsByPaper`** — no existing, partial, all existing

### Add After v2.0 Validation (v2.x)

- [ ] **`createSearchParameters` API params shape** — full filter-to-API translation correctness
- [ ] **`getScreeningQuestionsConfig` deduplication postProcess** — extract and test in isolation
- [ ] **`repairJSON` / `repairSingleField`** — malformed JSON recovery paths
- [ ] **`applyTierFreeCreditCap` all plan caps** — free/go/pro/enterprise cap enforcement
- [ ] **`syncProfileFromSession` no-overwrite guard** — existing field retained on update
- [ ] **`exportToCSV` column inclusion/exclusion by `ExportOptions`** — requires logic extraction
- [ ] **`createSearchMetadata` filter summary** — year range, date range, regions

### Future Consideration (v3+)

- [ ] **Integration tests for cross-cutting flows** — auth check → plan gate → credit deduction → result (requires Convex test environment or full mock context)
- [ ] **`exportToExcel` worksheet cell type validation** — requires pure extraction of sheet-data builder from the DOM download wrapper
- [ ] **TDD workflow integration tests** — tests written test-first for new features added after v2.0

---

## Feature Prioritization Matrix

| Domain | User Value | Implementation Cost | Priority |
|--------|------------|---------------------|----------|
| Search param round-trip | HIGH (breaks shared links if wrong) | LOW (pure functions, no mocks) | P1 |
| Region encoding round-trip | HIGH (breaks geographic filter) | LOW (pure functions) | P1 |
| Filter active predicates | HIGH (wrong filters reach API) | LOW (pure functions) | P1 |
| CSV escape / jsonToCSV | HIGH (corrupt exports lose trust) | LOW (pure functions) | P1 |
| AI prompt structural invariants | MEDIUM (degrades AI quality) | LOW (pure functions) | P1 |
| Zod schema parse contracts | MEDIUM (AI responses mishandled) | LOW (pure functions) | P1 |
| Batch fail-soft correctness | HIGH (wrong credit charges) | MEDIUM (mock required) | P1 |
| Auth state machine | HIGH (suspended users get access) | MEDIUM (extraction needed) | P1 |
| PLAN_CONFIG snapshot | MEDIUM (wrong credits/grants) | LOW (pure constants) | P1 |
| Feature flag env var | LOW (UI shows wrong billing UI) | LOW (vi.resetModules pattern) | P2 |
| createSearchParameters API params | HIGH (wrong API calls) | MEDIUM (complex function) | P2 |
| Deduplication postProcess | MEDIUM (duplicate questions shown) | MEDIUM (extraction) | P2 |
| Export column inclusion flags | MEDIUM (missing/extra columns) | HIGH (DOM extraction needed) | P2 |
| Integration cross-cutting flows | HIGH (end-to-end correctness) | HIGH (Convex runtime) | P3 |

---

## Sources

- Direct codebase inspection of all six domain source files (HIGH confidence): `lib/search-params/parsers.ts`, `lib/search-params/converters.ts`, `lib/search-params/regions.ts`, `lib/filters/filter-builder.ts`, `lib/utils.ts`, `lib/ai/core/batch.ts`, `lib/ai/core/prompts.ts`, `lib/ai/core/schemas.ts`, `lib/ai/core/configs.ts`, `lib/ai/core/validate.ts`, `lib/ai/core/question-key-codec.ts`, `convex/extraction/prompts.ts`, `convex/lib/auth.ts`, `convex/users/mutations.ts`, `convex/lib/userCreation.ts`, `convex/lib/constants.ts`, `lib/billing/entitlements.ts`, `lib/subscriptions/feature-flags.ts`, `lib/extraction/export.ts`, `lib/search-actions.ts`
- Direct inspection of all 43 existing test files for patterns and coverage gaps (HIGH confidence): `tests/ai-mode-routing.test.ts`, `tests/ai-credit-billing.test.ts`, `tests/clerk-webhook-handler.test.ts`, `tests/subscription-entitlements.test.ts`, `tests/search-actions-screening-export.test.ts`, `tests/extraction-v3-prompts.test.ts`, `tests/extraction-filtering.test.ts`, `tests/extraction-v3-integration.test.ts`
- Existing test pattern: pure function extraction → import → assert (vitest.config.ts, `environment: 'node'`)
- `vi.resetModules()` pattern for env var tests confirmed in `tests/extraction-filtering.test.ts`
- Injectable dependency pattern for Convex functions confirmed in `tests/clerk-webhook-handler.test.ts`

---
*Feature research for: TDD & Test Coverage Backfill (v2.0) — six testing domains*
*Researched: 2026-02-28*
