# Codebase Concerns

**Analysis Date:** 2026-03-02

## Tech Debt

**Deprecated `apiKey` field on `zoteroConnections` still in production schema:**
- Issue: `zoteroConnections.apiKey` is marked `// Deprecated: use encryptedApiKey` but remains in the schema. Pre-migration rows with plaintext keys may still exist. Code in `convex/zotero/actions.ts` (line 42), `convex/zotero/internal.ts`, and `convex/extraction/workpoolActions.ts` (line 760) has dual-read fallback paths, which must be maintained until a data migration is run to encrypt all plaintext keys.
- Files: `convex/schema.ts` (line 175), `convex/zotero/actions.ts`, `convex/extraction/workpoolActions.ts`
- Impact: Plaintext Zotero API keys may exist in the database for users who authenticated before Phase 39. A leak of the Convex database would expose those keys.
- Fix approach: Run `convex/zotero/internal.ts:listAllConnections` to enumerate unmigrated rows, encrypt them in a one-time migration action, then remove the `apiKey` fallback field from the schema and all fallback code paths.

**`placeholder.email` User-Agent in OpenAlex API calls:**
- Issue: The `fetchPapersFromHistory` internal action sends `User-Agent: OpenAlex-Count/1.0 (mailto:admin@example.com)` as the polite pool identifier. The email is a placeholder, not a real contact address. OpenAlex may deprioritize requests if the polite pool email is undeliverable.
- Files: `convex/extraction/actions.ts` (line 138)
- Impact: Potential rate limiting or request deprioritization by OpenAlex.
- Fix approach: Replace with a real operational email address.

**Extraction `runDiff` orphan risk on baseline job deletion:**
- Issue: `deleteExtractionInternal` only deletes `extractionRunDiffs` where `jobId == args.jobId` (Step 8). Diffs where `baselineJobId == args.jobId` are explicitly not deleted (see comment at line 1087). This means deleting a baseline job leaves dangling diff records referencing a non-existent job.
- Files: `convex/extraction/mutations.ts` (lines 1086-1096)
- Impact: Orphaned `extractionRunDiffs` rows in the database; diff queries against those rows will find `null` for the baseline job.
- Fix approach: When deleting a job, also delete diffs where `baselineJobId == args.jobId`, or add a no_access guard in the diff query.

**Extraction `cancelExtraction` does not stop the running workflow:**
- Issue: `cancelExtraction` sets `status: "cancelled"` in the DB but never calls `workflow.cancel()` on the associated `workflowId`. The Convex workflow and workpool continue to process papers. Paper records will update to `completed` after the job shows `cancelled`.
- Files: `convex/extraction/mutations.ts` (lines 229-256)
- Impact: Credits are still deducted for papers processed after cancel, and the job status shows `cancelled` while work continues. Users cannot truly stop an in-progress job.
- Fix approach: Read `job.workflowId`, call `workflow.cancel(ctx, job.workflowId)`, and drain pending workpool items.

**`v.any()` pervasive in Convex extraction query return types:**
- Issue: Multiple public queries in `convex/extraction/queries.ts` use `v.any()` for fields like `job`, `questions`, `papers`, `summary`, and `diagnostics` in their `returns` validators. This removes Convex runtime type enforcement on returned data.
- Files: `convex/extraction/queries.ts` (lines 261-263, 328-329, 411-413, 533-536, 668-690, 779-785, 892-893)
- Impact: Type mismatches between the server and client are not caught at runtime. Clients receive unvalidated data. TypeScript types on the client side are inaccurate (`any`).
- Fix approach: Define typed Convex validators matching the actual return shapes. Extract shared validator objects to reduce duplication.

**`cleanupDeletedUsers` does not delete extraction data for deleted users:**
- Issue: `cleanupDeletedUsers` removes API keys but explicitly keeps credits and subscriptions for audit. Extraction jobs, papers, results, and Zotero connections for deleted users are never cleaned up.
- Files: `convex/maintenance/mutations.ts` (lines 11-55)
- Impact: `extractionJobs`, `extractionPapers`, `extractionResults`, `extractionEvidenceUnits`, and `zoteroConnections` persist indefinitely after user deletion. Storage costs accumulate; encrypted Zotero keys remain in the DB.
- Fix approach: Extend `cleanupDeletedUsers` to schedule cascade deletion of extraction data (reusing `deleteExtractionInternal`) and `zoteroConnections` for each deleted user.

**Zotero OAuth token table has no cron cleanup:**
- Issue: `zoteroOAuthTokens` records expire after 10 minutes (enforced by `getRequestToken`) but expired tokens are only cleaned up on-read when a user completes or abandons an OAuth flow mid-step. No cron sweeps the table.
- Files: `convex/zotero/mutations.ts` (lines 42-72), `convex/crons.ts`
- Impact: Abandoned OAuth sessions leave expired rows accumulating in the table indefinitely.
- Fix approach: Add a cron job that deletes `zoteroOAuthTokens` where `expiresAt < Date.now()`.

**`migrateSearchHistoryState` in `lib/store.ts` uses `any` throughout:**
- Issue: `lib/store.ts` has 7 sequential store migration steps (versions 0-7), all typed as `any` for both the state and item iterators. The function is exported and tested, but the typing makes it impossible to catch shape errors at compile time.
- Files: `lib/store.ts` (lines 178-282)
- Impact: A future migration bug would silently corrupt persisted state for users without TypeScript catching it during development.
- Fix approach: Define typed migration input/output shapes for each version. At minimum, validate with Zod on read.

**`stale: any` type casts in `convex/extraction/queries.ts` `attachReviewMetadata`:**
- Issue: `attachReviewMetadata` uses `Map<string, any>` (line 113) and `review: any` (line 118) even though it operates on `Doc<"extractionResultReviews">` which has a known schema.
- Files: `convex/extraction/queries.ts` (lines 104-129)
- Impact: Type errors in review field access are silently ignored.
- Fix approach: Replace `any` with `Doc<"extractionResultReviews">`.

## Known Bugs

**`getJobDetails` caps displayed papers at 100:**
- Symptoms: The `getJobDetails` query uses `.take(100)` for processable papers (line 294). Jobs with more than 100 papers show an incomplete paper list in the job detail view.
- Files: `convex/extraction/queries.ts` (line 294)
- Trigger: Create an extraction job with more than 100 processable papers.
- Workaround: Use `getJobResultsPaginated` or `getJobResults` for full lists, but those return all data at once.

**`extractionRunDiffs.changes` silently truncates at 1,000 entries:**
- Symptoms: When generating a run diff, changes are sliced to the first 1,000 rows before insertion (line 956). Jobs with more than 1,000 changed results will have incomplete diffs with no indication of truncation.
- Files: `convex/extraction/mutations.ts` (line 956)
- Trigger: Compare two large extraction jobs with many question/paper combinations.
- Workaround: None. The stored diff is silently incomplete.

## Security Considerations

**NEXT_PUBLIC feature flags used as server-side guards in Convex:**
- Risk: Feature flags like `NEXT_PUBLIC_EXTRACTION_ENABLED`, `NEXT_PUBLIC_CREDITS_ENABLED`, `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED`, and `NEXT_PUBLIC_EXTRACTION_PDF_ENABLED` are read via `process.env` inside Convex functions to gate access. The `NEXT_PUBLIC_` prefix implies these are intended as client-visible variables, but they are used as security gates in server-side code.
- Files: `convex/extraction/guard.ts`, `convex/lib/featureFlags.ts`, `convex/extraction/content.ts`
- Current mitigation: Convex environment variables are set separately from Next.js; the naming convention does not automatically make them client-visible in Convex. The pattern works but is confusing.
- Recommendations: Rename to non-`NEXT_PUBLIC_` names in Convex (e.g. `EXTRACTION_ENABLED`) to clarify server-only intent, or use a shared config file that documents dual usage. Ensure Convex deployment environment never exposes these as client variables.

**Debug endpoint gated only by environment variable:**
- Risk: `convex/extraction/debug.ts:diagnoseJob` and `convex/extraction/debug_errors.ts:getFailedPapersDebug` are public queries gated by `ENABLE_PUBLIC_DEBUG_FUNCTIONS === "true"`. Any authenticated user can call them if the flag is enabled.
- Files: `convex/extraction/debug.ts`, `convex/extraction/debug_errors.ts`, `convex/lib/debug_gate.ts`
- Current mitigation: User ownership check (`job.userId !== user._id`) is in place.
- Recommendations: Confirm `ENABLE_PUBLIC_DEBUG_FUNCTIONS` is not set in production. Document that these functions are intended for staging only.

**`/app/test-sidebar/page.tsx` is a test scaffold accessible in production:**
- Risk: A test/debugging page at route `/test-sidebar` is part of the production build and is publicly accessible (no auth check, not excluded by middleware).
- Files: `app/test-sidebar/page.tsx`
- Current mitigation: No sensitive data is exposed; it only renders placeholder content.
- Recommendations: Remove or add to the blocked routes list. Test pages should not ship to production.

## Performance Bottlenecks

**`loadJobPapersAndResults` issues N+1 queries for every paper in a job:**
- Problem: `convex/extraction/queries.ts:loadJobPapersAndResults` (line 145) first collects all papers for a job, then for each paper issues two sequential queries (results + reviews). This is used by `getJobInsights`, `getJobResults`, and `getReviewQueue`, which means large jobs trigger O(N) Convex DB reads per query.
- Files: `convex/extraction/queries.ts` (lines 145-168)
- Cause: Convex does not support JOINs; the only alternative is Promise.all fan-out, which is already used (line 158). However, `attachReviewMetadata` then issues another `collect()` inside the fan-out, making it O(2N).
- Improvement path: Consider pre-fetching all reviews for a job in a single indexed query (index by `jobId`) and joining in memory, eliminating the per-paper review query.

**`getJobResults` loads all papers and all results without pagination:**
- Problem: `getJobResults` (line 406) calls `.collect()` on both `extractionPapers` and `extractionResults` with no size guard. Large jobs (200 papers × N questions) return all data in one query response.
- Files: `convex/extraction/queries.ts` (lines 406-462)
- Cause: Used for CSV export, which legitimately needs all data. No size limit is enforced.
- Improvement path: Add a server-side export mutation that streams/chunks data, or use `getJobResultsPaginated` for UI views and a dedicated export endpoint.

**`convex/extraction/mutations.ts` is 2,026 lines:**
- Problem: The file contains all mutation logic for extraction jobs, including cascade deletes (9-step batched re-scheduler), insight reporting, review management, and workflow helpers. It is the largest single file in the backend at 2,026 lines.
- Files: `convex/extraction/mutations.ts`
- Cause: Organic growth of extraction features into a single mutations file.
- Improvement path: Split into domain-specific files: `mutations/jobs.ts`, `mutations/reviews.ts`, `mutations/cascade.ts`, `mutations/reporting.ts`.

## Fragile Areas

**Cascade delete `deleteExtractionInternal` uses self-scheduling recursion:**
- Files: `convex/extraction/mutations.ts` (lines 984-1103)
- Why fragile: The 9-step cascade works by scheduling itself (`ctx.scheduler.runAfter(0, ...)`) after each batch. If any batch fails partway through (e.g. a Convex transaction limit), the job remains in a partially deleted state with no retry tracking or completion signal. The job record is deleted last (Step 9), so partial failures leave orphaned child records but no parent.
- Safe modification: Always test changes against a job with 200+ papers. Add an explicit "deleting" status on the job record so the UI can show progress, and add a completion log.
- Test coverage: `convex/extraction/cascade-delete.test.ts` exists and covers the happy path.

**Stripe singleton pattern with module-level cache:**
- Files: `convex/subscriptions/actions.ts` (lines 37-49), `convex/maintenance/internal.ts` (lines 11-23)
- Why fragile: The Stripe client is cached in a module-level `_stripe` variable. In Convex's serverless model, cold starts re-initialise modules, but warm instances re-use the cached instance. This is generally fine but means the Stripe API version is set at construction time and cannot be changed without a full redeploy. The pattern is duplicated in two files.
- Safe modification: Consolidate into `convex/stripe.ts` (which already exists) and import from there rather than creating local instances.

**Feature flag checks are scattered across 5+ files with no central registry:**
- Files: `convex/extraction/guard.ts`, `convex/lib/featureFlags.ts`, `convex/extraction/content.ts`, `convex/credits/queries.ts` (line 133), `lib/extraction/feature-flags.ts`, `lib/subscriptions/feature-flags.ts`, `lib/credits/feature-flags.ts`
- Why fragile: Feature flag values are read directly from `process.env` in 7+ separate files without a single source of truth. Adding a new flag, changing a default, or testing with different flag states requires modifying multiple files.
- Safe modification: Add tests for each new flag. Centralise all feature flag reads into a single registry module per runtime (one for Convex, one for Next.js).

## Scaling Limits

**Extraction jobs are capped at 200 papers per source history entry:**
- Current capacity: 200 papers per `fetchPapersFromHistory` call (set by `per-page=200`).
- Limit: OpenAlex's maximum page size is 200 results per call. Pagination across multiple pages is not implemented.
- Scaling path: Implement multi-page pagination in `fetchPapersFromHistory` with a configurable upper bound, or surface the 200-paper cap in the UI with a clear message.

**`checkSubscriptionStatus` cron iterates all active subscriptions serially:**
- Current capacity: Works well for hundreds of subscriptions.
- Limit: `checkSubscriptionStatus` in `convex/maintenance/internal.ts` loops over all active subscriptions and makes one Stripe API call per subscription. With thousands of subscribers the hourly cron will exceed Convex action timeouts (10 minutes).
- Scaling path: Paginate using a cursor-based approach or partition subscriptions by ID range.

## Dependencies at Risk

**`apiVersion: "2026-01-28.clover"` hardcoded Stripe API version:**
- Risk: The Stripe API version is pinned to a specific dated release in two files. When Stripe deprecates this version, all billing operations will fail simultaneously.
- Files: `convex/subscriptions/actions.ts` (line 46), `convex/maintenance/internal.ts` (line 20)
- Impact: Billing operations (subscriptions, upgrades, refunds) break when the API version is sunset.
- Migration plan: Centralise Stripe client construction in `convex/stripe.ts` and update the version in one place on each Stripe release cycle.

## Missing Critical Features

**No cleanup of RAG index on paper deletion:**
- Problem: When `deleteExtractionInternal` deletes papers, it removes `extractionEvidenceUnits` rows and calls `ctx.storage.delete()` for PDFs, but does not clean up entries in the Convex RAG component (`components.rag`). The RAG vector index will retain embeddings for deleted papers.
- Blocks: Correct similarity search for future extraction jobs (stale vectors may still match). Storage cost increases over time.

**No webhook to notify on extraction job completion:**
- Problem: Users have no way to receive a notification when a long-running extraction job finishes. The UI relies on polling via Convex reactive queries.
- Blocks: Background/offline usage pattern; integrations that need job completion events.

## Test Coverage Gaps

**Extraction workflow cancellation is untested:**
- What's not tested: The fact that `cancelExtraction` sets DB status but does NOT stop the underlying Convex workflow or workpool. No test verifies whether in-flight workpool actions continue after cancellation.
- Files: `convex/extraction/mutations.ts` (lines 229-256)
- Risk: Credits continue to be charged and paper statuses continue to update after a user-initiated cancel.
- Priority: High

**RAG vector cleanup on job deletion is untested:**
- What's not tested: No test verifies that deleting an extraction job removes or leaves its RAG index entries.
- Files: `convex/extraction/mutations.ts` (lines 984-1103)
- Risk: Silent RAG index leak for every deleted job.
- Priority: Medium

**`loadJobPapersAndResults` N+1 query behavior at scale is untested:**
- What's not tested: No performance/load test for `getJobInsights` or `getJobResults` on jobs with 200 papers.
- Files: `convex/extraction/queries.ts` (lines 145-168)
- Risk: Query timeouts in production for large jobs.
- Priority: Medium

---

*Concerns audit: 2026-03-02*
