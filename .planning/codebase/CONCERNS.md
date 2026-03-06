# Codebase Concerns

**Analysis Date:** 2026-03-06

## Tech Debt

**Monolithic Store File (1,275 lines, 22 Zustand stores):**
- Issue: `lib/store.ts` contains 22 separate Zustand stores in a single file, making it difficult to navigate and maintain
- Files: `lib/store.ts`
- Impact: Slow IDE performance, merge conflicts, hard to find specific store logic
- Fix approach: Split into per-domain store files (e.g., `lib/stores/search.ts`, `lib/stores/library.ts`, `lib/stores/extraction.ts`). Each store gets its own file with co-located types.

**Oversized Convex Modules:**
- Issue: Several Convex modules exceed 1,000 lines with multiple responsibilities mixed together
- Files: `convex/extraction/mutations.ts` (2,283 lines), `convex/extraction/queries.ts` (1,646 lines), `convex/credits/internal.ts` (1,441 lines), `convex/extraction/workpoolActions.ts` (1,153 lines), `convex/subscriptions/actions.ts` (1,021 lines)
- Impact: Hard to navigate, difficult to understand scope of individual functions, increased risk of merge conflicts
- Fix approach: Split by sub-domain (e.g., `mutations.ts` into `mutations/startExtraction.ts`, `mutations/rerun.ts`, `mutations/delete.ts`). Convex supports re-exporting from barrel files.

**Collection Counts Use N+1 Query Pattern:**
- Issue: `getCollectionsWithCounts` fetches all collections, then does a separate `.collect()` query per collection to count memberships. With 50 collections, this is 51 queries.
- Files: `convex/library/collections.ts` (lines 174-204)
- Impact: Slow response for users with many collections; each query reads all membership rows just to count them
- Fix approach: Add a denormalized `itemCount` field to the `collections` table (same pattern already used for `libraryItemCount` on users). Increment/decrement atomically in `addToCollection`/`removeFromCollection`.

**Verbose Console Logging in Zotero Actions:**
- Issue: `convex/zotero/actions.ts` contains 20+ `console.log` calls with detailed request/response stats that are leftover development debugging
- Files: `convex/zotero/actions.ts` (lines 254, 417, 669, 801, 821, 835, 848, 857, 876, 892, 897, 898, 916, 966)
- Impact: Noisy Convex dashboard logs in production; may contain collection keys and fetch parameters
- Fix approach: Remove or gate behind a debug flag. Keep only `console.error` for actual failures.

**NEXT_PUBLIC_ Env Vars Used in Convex Backend:**
- Issue: Feature flags in `convex/lib/featureFlags.ts` and `convex/extraction/guard.ts` reference `NEXT_PUBLIC_*` environment variables. These are Next.js conventions for client-side exposure, but they work in Convex only because they are manually duplicated as Convex env vars.
- Files: `convex/lib/featureFlags.ts`, `convex/extraction/guard.ts`, `convex/extraction/content.ts`, `convex/credits/queries.ts`
- Impact: Confusing naming -- implies these are client-side vars when they are server-side feature gates. If someone removes them from Convex env (thinking they are Next.js-only), features silently enable.
- Fix approach: Create Convex-specific env vars (e.g., `FEATURE_CREDITS_ENABLED`) or rename to drop the `NEXT_PUBLIC_` prefix in Convex config.

## Known Bugs

No explicit bugs identified. No TODO/FIXME/HACK comments exist in source code. The codebase is clean of inline bug markers.

## Security Considerations

**Encryption Key Stored as Single Env Var Without Rotation Support:**
- Risk: `ENCRYPTION_KEY` is used for AES-256-GCM encryption of API keys and Zotero tokens. No key rotation mechanism exists -- rotating the key would break all existing encrypted values.
- Files: `convex/lib/crypto.ts`, `convex/apiKeys/actions.ts` (line 58), `convex/zotero/actions.ts` (lines 35, 605)
- Current mitigation: Key is stored as Convex env var (not in code). AES-256-GCM with random IV per encryption.
- Recommendations: Add a `keyVersion` field to `apiKeys` and `zoteroConnections` tables. Support decrypt-with-old + re-encrypt-with-new during rotation. Add a migration script.

**Decryption Audit Logging is Minimal:**
- Risk: `decryptApiKey` logs only the purpose string via `console.log`, not the userId or which key was decrypted. The `audit` parameter contains `userId` and `purpose` but only `purpose` is logged.
- Files: `convex/lib/crypto.ts` (line 81)
- Current mitigation: Caller passes both userId and purpose in the audit object
- Recommendations: Log the full audit object (userId + purpose) or write to the `auditLogs` table for a persistent, queryable trail.

**Test Runner Bypasses Authentication:**
- Risk: `convex/extraction/test_runner.ts` creates extraction jobs using the first user in the database, bypassing all auth checks
- Files: `convex/extraction/test_runner.ts` (lines 23-27)
- Current mitigation: Uses `internalMutation` so it is not exposed in the public API
- Recommendations: Acceptable as-is since it is internal-only. No action needed.

## Performance Bottlenecks

**backfillJobStats Performs O(papers x questions) Individual Queries:**
- Problem: `backfillJobStats` iterates over every paper in a job and queries `extractionResults` for each paper separately. For a 500-paper job, this is 500 individual DB queries inside a single mutation.
- Files: `convex/extraction/mutations.ts` (lines 1240-1340)
- Cause: Sequential per-paper result queries inside a nested loop; no job-level index on `extractionResults`
- Improvement path: Add a `jobId` field and `by_job` index on `extractionResults` table, then load all results in one query and group in JS. Alternatively, batch papers into chunks.

**loadJobPapersAndResults Issues Parallel Per-Paper Queries:**
- Problem: Loads papers then issues `Promise.all` over up to 500 papers, each querying `extractionResults` by paper ID. While parallel, this creates up to 500 concurrent Convex queries per call.
- Files: `convex/extraction/queries.ts` (lines 220-250)
- Cause: No job-level index on `extractionResults`
- Improvement path: Same as above -- add `by_job` index on `extractionResults` to enable single-query loading.

**getJobInsights Loads Full Paper + Result Data Even When Pre-Aggregated Stats Exist:**
- Problem: `getJobInsights` always calls `loadJobPapersAndResults` (loading ALL papers and results) even when `extractionJobStats` records exist, because it needs raw data for disagreement clusters and other derived features.
- Files: `convex/extraction/queries.ts` (lines 692-720)
- Cause: Insight computation requires both aggregate stats and raw per-paper data for cluster analysis
- Improvement path: Split the query: use pre-aggregated stats for summary metrics, load full data only for cluster computation. Consider pre-computing clusters in the backfill mutation.

**Client-Side Filtering of Extraction Results:**
- Problem: The extraction job detail page fetches all papers (up to 500) and filters/sorts client-side via `preprocessPapers()` and `filterPapers()`.
- Files: `lib/extraction/filtering.ts`, `app/extraction/[jobId]/page.tsx`
- Cause: Complex filter combinations (confidence ranges, question-specific filters, search text) are easier to implement client-side
- Improvement path: For jobs approaching 500 papers, consider server-side cursor-based pagination with filter pushdown.

## Fragile Areas

**Denormalized Library Counter Lazy Backfill:**
- Files: `convex/library/queries.ts` (lines 332-353), `convex/library/mutations.ts` (lines 65-66, 98-99)
- Why fragile: The `libraryItemCount` field on `users` is optional. Users who have never triggered a save/remove mutation after the feature was added fall through to the slow `.take(10_000)` scan path in `getLibraryCount`. The counter cannot be backfilled from a query context (no `ctx.scheduler`). A comment in the code acknowledges this limitation.
- Safe modification: Always update the counter in any mutation that adds/removes library items. The backfill path is read-only and idempotent.
- Test coverage: `convex/library/queries.test.ts` covers the query. No test for the lazy backfill edge case where `libraryItemCount` is undefined.

**Stripe Webhook Event Processing Chain:**
- Files: `convex/http.ts`, `convex/lib/stripeWebhookHandlers.ts`, `convex/subscriptions/internal.ts`, `convex/credits/internal.ts`
- Why fragile: Webhook processing spans 4 files with multiple internal function calls. Event deduplication relies on `stripeInvoiceId`/`stripePaymentIntentId` uniqueness in `creditTransactions`. All handlers have documented idempotency contracts (INFRA-03) which must be maintained.
- Safe modification: Follow the existing pattern when adding new event handlers: always use `runAuditedStripeHandler` wrapper. Run `tests/stripe-webhook-handler.test.ts`, `tests/credit-grant-policy.test.ts`, `tests/credit-purchase-idempotency.test.ts` after changes.
- Test coverage: Good unit test coverage. E2E billing specs in `e2e/billing/specs/` cover live Stripe flows.

**Extraction Workflow State Machine:**
- Files: `convex/extraction/mutations.ts`, `convex/extraction/workpoolActions.ts`
- Why fragile: Extraction jobs progress through 7 status states (pending -> downloading_pdfs -> indexing -> extracting -> completed/failed/cancelled). State transitions are spread across two large files (2,283 + 1,153 lines). The workpool/workflow system adds another layer of state.
- Safe modification: Always check current job status before transitioning. Use `assertJobOwnership`. Test with `convex/extraction/test_helpers.ts`.
- Test coverage: `convex/extraction/cascade-delete.test.ts` covers deletion. `tests/extraction/workflow-cancel.test.ts` covers cancellation. No test for the full happy-path state machine flow.

**Subscription Plan Change with Schedule Management:**
- Files: `convex/subscriptions/actions.ts` (lines 600-780)
- Why fragile: Plan changes involve Stripe subscription schedule release/creation, metadata sync, pro-rata credit grants, and local state updates. The SUB-05 schedule leak detection (verify schedule detached after release) throws an error if verification fails, but there is no automated recovery.
- Safe modification: Run `tests/subscription-schedule-planning.test.ts` and `tests/subscription-entitlements.test.ts` after changes.
- Test coverage: Unit tests exist for schedule planning logic. No integration test for the schedule leak detection/recovery path.

## Scaling Limits

**Remaining `.collect()` Calls Without `.take()` Guards:**
- Current capacity: Many `.collect()` calls in `convex/subscriptions/internal.ts` (12 calls) and `convex/extraction/queries.ts` (13 calls) lack explicit `.take()` bounds
- Limit: Convex queries have response size and time limits. These calls rely on cardinality annotations (e.g., "~1-5 subscriptions per user", "~5-20 results per paper") which are assumptions, not enforced constraints.
- Scaling path: Monitor actual cardinalities. If assumptions change (e.g., questions-per-paper exceeds 20), add `.take()` guards. The `convex/lib/queryBounds.ts` module provides the pattern.

**Audit and Event Log Tables Grow Unbounded:**
- Current capacity: `auditLogs` and `stripeEventLogs` tables have no retention/cleanup policy
- Limit: Tables grow indefinitely, slowing index scans and increasing storage costs
- Scaling path: Add a cron job (similar to `cleanupDeletedUsers` in `convex/maintenance/mutations.ts`) that purges records older than 90 days from `stripeEventLogs` and 365 days from `auditLogs`.

**Credit Transactions Table Grows Indefinitely:**
- Current capacity: `creditTransactions` records every purchase, usage, grant, refund, and expiry with no purge policy
- Limit: Heavy users accumulate thousands of records. `MAX_CREDIT_TRANSACTIONS = 1_000` in `convex/lib/queryBounds.ts` silently truncates older records from user-facing views.
- Scaling path: Consider archiving old transactions (> 1 year) to a separate table or external storage. The 1,000-record query bound is a bandaid, not a long-term fix.

**Extraction Job Paper Limit (500):**
- Current capacity: `MAX_PAPERS_PER_JOB = 500` constant in `convex/extraction/mutations.ts` (line 35)
- Limit: Hard cap in both queries and mutations. Users cannot extract data from more than 500 papers per job.
- Scaling path: Implement cursor-based pagination in extraction queries; switch insight aggregation to use pre-computed `extractionJobStats` exclusively rather than loading all papers.

## Dependencies at Risk

**Convex Dev Dependencies at 0.x Versions:**
- Risk: `@convex-dev/rag`, `@convex-dev/stripe`, `@convex-dev/workflow`, `@convex-dev/workpool` are community/experimental components at early versions (0.x)
- Impact: API changes in these packages require coordinated updates. Breaking changes are expected in 0.x semver.
- Migration plan: Pin exact versions via lockfile. Monitor changelogs. Consider vendoring critical functionality if stability is needed.

## Missing Critical Features

**No Error Monitoring/Alerting Service:**
- Problem: Error tracking relies entirely on `console.error` calls in Convex dashboard logs and the `monitorFailedStripeEvents` cron (also uses `console.error`). No Sentry, Datadog, or equivalent.
- Blocks: No automated alerting for production errors, no error aggregation, no trend analysis
- Impact: Issues may go unnoticed until users report them

**No Structured Logging Framework:**
- Problem: Backend uses 100+ `console.log/warn/error` calls across Convex files with no structured format. No log levels, no correlation IDs, no machine-parseable output.
- Blocks: Difficult to debug production issues; cannot filter logs by severity or trace requests across function calls

**No Automated Backfill for libraryItemCount:**
- Problem: Users who existed before the denormalized counter was added must trigger a save/remove mutation to get their counter initialized. Until then, every `getLibraryCount` call does a `.take(10_000)` scan.
- Blocks: Consistent O(1) library count performance for all users
- Impact: Degraded query performance for pre-existing users who rarely modify their library. Fix: run a one-time internal mutation to backfill all users.

## Test Coverage Gaps

**Component/UI Layer:**
- What's not tested: All React components under `components/` -- including critical flows like extraction job creation, question builder, billing page, and search UI. Zero component test files exist.
- Files: All files under `components/`, `app/extraction/[jobId]/page.tsx`
- Risk: UI regressions go unnoticed; refactoring components is risky without test coverage
- Priority: High

**Extraction Workpool Actions:**
- What's not tested: Individual steps in `convex/extraction/workpoolActions.ts` -- PDF download, RAG search, evidence unit construction, AI extraction call, credit deduction within the workpool handler. This is the most complex backend module (1,153 lines) with external API calls.
- Files: `convex/extraction/workpoolActions.ts`
- Risk: Only tested indirectly through workflow integration. Individual step failures are not caught.
- Priority: High

**Full Extraction Workflow Integration Test:**
- What's not tested: The complete extraction flow from `startExtraction` through PDF download, indexing, extraction, to completion. Individual pieces are tested but the end-to-end state machine is not.
- Files: `convex/extraction/mutations.ts`, `convex/extraction/workpoolActions.ts`
- Risk: State machine bugs could leave jobs permanently stuck in intermediate states
- Priority: Medium

**Zotero Integration:**
- What's not tested: OAuth flow, collection fetching, item syncing in `convex/zotero/actions.ts` (1,110 lines)
- Files: `convex/zotero/actions.ts`, `convex/zotero/mutations.ts`
- Risk: Zotero API changes or OAuth issues would not be caught before production
- Priority: Medium

**Search Provider:**
- What's not tested: `lib/search/provider.tsx` (722 lines) -- the central search state management context with URL sync and fetch integration
- Files: `lib/search/provider.tsx`, `lib/search/initializer.tsx`
- Risk: Search is the primary user flow; regressions in param serialization or fetch logic affect all users
- Priority: Medium

**Subscription Schedule Leak Recovery:**
- What's not tested: The SUB-05 schedule leak detection in `convex/subscriptions/actions.ts` logs an error and throws when a Stripe schedule remains attached after release, but the recovery path is not tested.
- Files: `convex/subscriptions/actions.ts` (lines 660-730)
- Risk: Schedule leak could block future plan changes for affected users
- Priority: Medium

---

*Concerns audit: 2026-03-06*
