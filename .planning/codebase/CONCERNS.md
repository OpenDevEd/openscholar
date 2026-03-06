# Codebase Concerns

**Analysis Date:** 2026-03-06

## Tech Debt

**Oversized Backend Modules:**
- Issue: Several Convex modules exceed 1000 lines, concentrating too many responsibilities in single files. These are difficult to navigate, review, and test in isolation.
- Files:
  - `convex/extraction/mutations.ts` (2275 lines) - largest backend file; mixes job creation, cancellation, result saving, insight aggregation, cascade deletion, and stats computation
  - `convex/extraction/queries.ts` (1629 lines) - all extraction read queries in one module
  - `convex/credits/internal.ts` (1433 lines) - credit granting, reconciliation, retry logic, and refunds
  - `convex/extraction/workpoolActions.ts` (1153 lines) - PDF processing, RAG search, evidence extraction, AI calls
  - `convex/zotero/actions.ts` (1110 lines) - OAuth flow, collection fetching, item fetching, all in one file
  - `convex/subscriptions/actions.ts` (1021 lines) - Stripe checkout, plan changes, schedule management
- Impact: High cognitive load when modifying billing or extraction logic; merge conflicts likely when multiple contributors touch these files.
- Fix approach: Extract logical sub-modules (e.g., split `mutations.ts` into `job-lifecycle.ts`, `insight-aggregation.ts`, `cascade-delete.ts`; split `subscriptions/actions.ts` into `checkout.ts`, `plan-change.ts`).

**Oversized Frontend Page Component:**
- Issue: The extraction job detail page is a 1019-line single component with complex tab switching, filtering, pagination, and multiple sub-views.
- Files: `app/extraction/[jobId]/page.tsx`
- Impact: Hard to reason about state management; difficult to test individual tabs in isolation.
- Fix approach: Extract each tab (results, insights, review, report, schema) into separate route segments or dedicated components with their own state.

**Oversized Client-Side Store:**
- Issue: `lib/store.ts` (1275 lines) is a monolithic Zustand store handling search history, ratings, bookmarks, AI preferences, screening questions, keyword expansion, and more.
- Files: `lib/store.ts`
- Impact: Every consumer re-renders on any slice change unless selectors are used carefully. Growing surface area makes the store fragile.
- Fix approach: Split into domain-specific stores (e.g., `lib/stores/search-history.ts`, `lib/stores/ai-preferences.ts`, `lib/stores/ratings.ts`).

**Duplicated Stripe Client Initialization:**
- Issue: The `getStripe()` lazy-init pattern is duplicated identically in multiple files rather than being centralized.
- Files:
  - `convex/subscriptions/actions.ts` (line 37-49)
  - `convex/maintenance/internal.ts` (line 11-23)
  - `convex/credits/actions.ts` (line 29-35)
- Impact: If the Stripe API version or initialization changes, all three must be updated. Risk of drift.
- Fix approach: A single `convex/stripe.ts` already exists (imported in `subscriptions/actions.ts`). Consolidate all `getStripe()` usages to use that shared module.

**Loose `any` Type in Extraction Filtering:**
- Issue: `FilterState.questionFilters` is typed as `Map<string, any>`, losing type safety for filter values.
- Files: `lib/extraction/filtering.ts` (line 10)
- Impact: No compile-time checking on filter values; easy to introduce runtime bugs.
- Fix approach: Define a discriminated union for filter value types (boolean filter, range filter, text filter, etc.).

## Known Bugs

No explicit bugs identified (no TODO/FIXME/HACK comments exist in source code). The codebase is notably clean of inline bug markers.

## Security Considerations

**Encryption Key Dependency:**
- Risk: API key encryption/decryption relies on a single `ENCRYPTION_KEY` environment variable. If this key is lost or rotated without re-encrypting existing keys, all stored API keys and Zotero connections become unrecoverable.
- Files:
  - `convex/zotero/actions.ts` (line 35)
  - `convex/apiKeys/actions.ts` (lines 58, 99)
  - `convex/extraction/workpoolActions.ts` (line 713)
  - `convex/lib/crypto.ts`
- Current mitigation: Key prefix stored separately for display; encryption uses standard Node.js crypto.
- Recommendations: Document key rotation procedure; consider adding a key version field to encrypted records to support rotation.

**Environment Variable Sprawl:**
- Risk: Over 35 `process.env.*` references across the Convex backend with no centralized validation at startup beyond `convex/lib/env.ts` (which only validates `NEXT_PUBLIC_APP_URL`). Missing env vars fail at runtime, not at deploy time.
- Files: `convex/lib/env.ts`, `convex/lib/featureFlags.ts`, `convex/lib/constants.ts`, `convex/ai/config.ts`
- Current mitigation: Feature flag checks guard some paths; `assertPlanPriceConfig()` validates Stripe price IDs.
- Recommendations: Add a centralized env validation module that runs at Convex deploy/startup and fails fast with clear error messages for all required variables.

**Debug Endpoints in Production:**
- Risk: Multiple internal debug query functions exist (`convex/extraction/debug_job_citations.ts`, `convex/extraction/debug_errors.ts`, `convex/extraction/debug_papers.ts`). These are gated by `requirePublicDebugEnabled()` which checks an env var.
- Files:
  - `convex/extraction/debug_job_citations.ts`
  - `convex/extraction/debug_papers.ts`
  - `convex/extraction/debug_errors.ts`
  - `convex/lib/debug_gate.ts`
- Current mitigation: `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var must be set to `"true"` to enable.
- Recommendations: Ensure this env var is never set in production. Consider using Convex internal functions instead of public functions with a gate.

## Performance Bottlenecks

**Library Count Query Fetches Up to 10,000 Documents:**
- Problem: `getLibraryCount` fetches up to 10,000 library items just to return their count.
- Files: `convex/library/queries.ts` (lines 330-341)
- Cause: Convex does not have a native count aggregation; the query uses `.take(10_000)` and returns `items.length`.
- Improvement path: Use Convex aggregate component or maintain a pre-computed count field on the user/credits record. For users with large libraries this query is wasteful.

**Extraction Mutations Load All Papers Per Job:**
- Problem: `loadJobDataForReporting` and multiple other mutation handlers load up to `MAX_PAPERS_PER_JOB` (500) papers with their results and reviews in a single mutation call.
- Files: `convex/extraction/mutations.ts` (lines 48-85), `convex/extraction/queries.ts` (line 224)
- Cause: Insight aggregation and report generation require iterating over all papers. Bounded at 500 but still significant per-call memory.
- Improvement path: Consider pre-aggregating stats incrementally (partially done with `extractionJobStats` table) rather than recomputing from raw data.

**Client-Side Filtering of Extraction Results:**
- Problem: The extraction job detail page fetches all papers (up to 500) and filters/sorts client-side. This is visible in `preprocessPapers()` and `filterPapers()` being called in the page component.
- Files: `lib/extraction/filtering.ts`, `app/extraction/[jobId]/page.tsx`
- Cause: Complex filter combinations (confidence ranges, question-specific filters, search text) are easier to implement client-side.
- Improvement path: For jobs approaching 500 papers, consider server-side cursor-based pagination with filter pushdown.

**Unbounded `.collect()` Calls:**
- Problem: 124 total `.collect()` calls across Convex modules. While many are properly scoped by index, some lack explicit bounds.
- Files: Various across `convex/` (124 occurrences in 26 files)
- Cause: `.collect()` returns all matching documents; without `.take()` or narrow index filters this can be expensive.
- Improvement path: Audit high-traffic queries and add `.take()` bounds or pagination where missing.

## Fragile Areas

**Extraction Workflow Pipeline:**
- Files:
  - `convex/extraction/mutations.ts`
  - `convex/extraction/workpoolActions.ts`
  - `convex/extraction/workflow.ts`
  - `convex/extraction/evidence_units.ts`
- Why fragile: The extraction pipeline orchestrates Convex workflows, workpools, PDF downloads, RAG indexing, AI generation, evidence anchoring, and credit deduction across multiple async steps. Any step failure must be correctly propagated to update paper/job status.
- Safe modification: Always test with the existing Convex test suite (`convex/extraction/cascade-delete.test.ts`, `convex/extraction/job-stats.test.ts`). Use the workflow cancel test to verify cancellation behavior. Do not modify status transitions without updating all downstream handlers.
- Test coverage: Core cascade delete, job stats, and workflow cancel are tested. Individual workpool action steps (PDF download, RAG search, AI extraction) lack unit tests.

**Stripe Webhook Handler Chain:**
- Files:
  - `convex/http.ts` (lines 48-320)
  - `convex/lib/stripeWebhookHandlers.ts`
  - `convex/subscriptions/internal.ts`
  - `convex/credits/internal.ts`
- Why fragile: Webhook processing involves event deduplication, audit logging, subscription sync, credit granting, and retry scheduling. The handler chain spans 4 files with interleaved error handling and conditional branching.
- Safe modification: Run the full billing test suite (`tests/live-billing/required.test.ts`, `tests/live-billing/extended.test.ts`, `e2e/billing/specs/*.spec.ts`) after any changes. The stripe event log policy tests provide important regression coverage.
- Test coverage: Good unit test coverage for individual policies, but the end-to-end webhook-to-credit-grant flow relies on live Stripe tests.

**Subscription Plan Resolution:**
- Files:
  - `lib/billing/entitlements.ts`
  - `convex/subscriptions/lib/selectCanonicalSubscription.ts`
  - `convex/subscriptions/lib/schedulePlanning.ts`
- Why fragile: Plan resolution involves selecting a "canonical" subscription when multiple exist, handling pending plan changes, schedule phases, and entitlement checks. Edge cases around downgrade scheduling and past-due grace periods are complex.
- Safe modification: Run `tests/plan-enforcement.test.ts`, `tests/subscription-entitlements.test.ts`, `tests/subscription-schedule-planning.test.ts` after any changes.
- Test coverage: Good unit test coverage via dedicated test files.

## Scaling Limits

**Extraction Job Paper Limit:**
- Current capacity: 500 papers per extraction job (`MAX_PAPERS_PER_JOB` constant)
- Limit: Hard cap in both queries and mutations
- Scaling path: Implement cursor-based pagination in extraction queries; switch insight aggregation to use pre-computed `extractionJobStats` table exclusively.

**Library Items:**
- Current capacity: `.take(10_000)` used for library count query
- Limit: Users with >10,000 library items get incorrect counts
- Scaling path: Maintain a counter or use Convex aggregates.

## Dependencies at Risk

**Alpha SDK Dependency:**
- Risk: `@openrouter/ai-sdk-provider` is pinned at `^6.0.0-alpha.1` - an alpha release with no stability guarantees.
- Impact: Breaking changes in minor/patch releases could disrupt OpenRouter AI provider functionality.
- Migration plan: Monitor for stable release; pin to exact version in the interim.

**Convex Dev Dependencies:**
- Risk: Multiple `@convex-dev/*` packages (`rag`, `stripe`, `workflow`, `workpool`) are at early versions (0.x). These are community/experimental components, not core Convex.
- Impact: API changes in these packages require coordinated updates.
- Migration plan: Pin exact versions; monitor changelogs. Consider vendoring critical functionality if stability is needed.

## Missing Critical Features

**No Component-Level Tests:**
- Problem: Zero test files exist under `components/` (0 out of ~80+ component files have co-located or external tests).
- Blocks: No automated verification of UI behavior, accessibility, or rendering correctness.

**No Structured Logging Framework:**
- Problem: Backend uses 107 `console.log/warn/error` calls across 22 Convex files with no structured format. No log levels, no correlation IDs, no machine-parseable output.
- Blocks: Difficult to debug production issues; no ability to filter logs by severity or trace a request across function calls.

## Test Coverage Gaps

**Component/UI Layer:**
- What's not tested: All React components under `components/` - including critical flows like extraction job creation (`components/extraction/job-creator.tsx`), question builder (`components/extraction/question-builder.tsx`), billing page (`app/settings/billing/page.tsx`), and search UI.
- Files: All files under `components/`, `app/extraction/[jobId]/page.tsx`
- Risk: UI regressions go unnoticed; refactoring components is risky without test coverage.
- Priority: High

**Extraction Workpool Actions:**
- What's not tested: Individual steps in `convex/extraction/workpoolActions.ts` - PDF download, RAG search, evidence unit construction, AI extraction call, and credit deduction within the workpool handler.
- Files: `convex/extraction/workpoolActions.ts`
- Risk: The most complex backend module (1153 lines) with external API calls has no direct unit tests. Only tested indirectly through workflow integration.
- Priority: High

**Zotero Integration:**
- What's not tested: OAuth flow, collection fetching, item syncing in `convex/zotero/actions.ts` (1110 lines).
- Files: `convex/zotero/actions.ts`, `convex/zotero/mutations.ts`
- Risk: Zotero API changes or OAuth issues would not be caught before production.
- Priority: Medium

**Search Provider:**
- What's not tested: `lib/search/provider.tsx` (722 lines) - the central search state management context with SWR integration, URL sync, and PostHog analytics.
- Files: `lib/search/provider.tsx`, `lib/search/initializer.tsx`
- Risk: Search is the primary user flow; regressions in param serialization or fetch logic affect all users.
- Priority: Medium

---

*Concerns audit: 2026-03-06*
