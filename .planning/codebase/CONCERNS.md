# Codebase Concerns

**Analysis Date:** 2026-02-27

## Tech Debt

**Widespread `any` typing in Convex backend:**
- Issue: Core Convex mutation/query context typed as `ctx: any` throughout `convex/extraction/mutations.ts`, `convex/extraction/queries.ts`, and `convex/extraction/workpoolActions.ts`. Query builder callbacks also typed as `(q: any)` — this bypasses the Convex type system entirely for database queries.
- Files: `convex/extraction/mutations.ts` (lines 29, 41, 47-68), `convex/extraction/queries.ts` (lines 34, 52, 105-162), `convex/extraction/workpoolActions.ts` (lines 468, 734-736)
- Impact: Autocompletion fails, schema mismatches can go undetected at compile time, index names may be wrong silently
- Fix approach: Replace `ctx: any` with proper Convex `MutationCtx`/`QueryCtx` types; replace `(q: any)` with typed index callback parameters

**`internal as any` cast repeated across billing/subscription modules:**
- Issue: `const internalApi = internal as any` used in `convex/http.ts`, `convex/crons.ts`, `convex/credits/internal.ts`, `convex/credits/actions.ts`, `convex/subscriptions/actions.ts`, `convex/subscriptions/internal.ts`, `convex/credits/queries.ts`. Same pattern for `components as any`.
- Files: `convex/http.ts:12`, `convex/crons.ts:5`, `convex/credits/internal.ts:26-27`, `convex/subscriptions/actions.ts:35-36`
- Impact: Calling a renamed internal function causes a runtime error rather than a compile-time error; no IDE support when navigating function calls
- Fix approach: Use properly typed `internal` and `components` references; regenerate types if they're incomplete

**`patchData: any` used in paper completion mutation:**
- Issue: `const patchData: any = {}` pattern at `convex/extraction/mutations.ts:1887` when patching completed paper records.
- Files: `convex/extraction/mutations.ts:1887`
- Impact: Allows writing arbitrary fields to the database document, bypassing schema validation
- Fix approach: Type the patch object explicitly using `Partial<Doc<"extractionPapers">>`

**Version-gating by creation timestamp (`V32_CUTOVER_AT`):**
- Issue: Extraction jobs created before an env-var timestamp are rejected with "Create a new extraction job for V3.2." This is a migration cut-off handled by a runtime check, not a schema version.
- Files: `convex/extraction/workpoolActions.ts:111`, `convex/extraction/workpoolActions.ts:819-984`
- Impact: Users with old jobs can't re-run extractions on them; the cutover env var must be configured correctly or everything silently passes (`isV32EnabledForJob` returns `true` when `V32_CUTOVER_AT === 0`)
- Fix approach: Add a schema field `extractionVersion` to jobs, migrate old rows, remove time-based gating

**Backfill mutations that do full table scans:**
- Issue: `backfillIsIndexed` in `convex/extraction/mutations.ts:1775` calls `ctx.db.query("extractionPapers").collect()` without any index, loading the entire table into memory to then filter in JS.
- Files: `convex/extraction/mutations.ts:1770-1791`
- Impact: Will fail or be slow as the papers table grows; Convex has hard limits on query read bandwidth
- Fix approach: Add a database index on the missing field or rewrite backfill to use a scheduled job with cursor-based pagination

**Deletion cascade does not clean up `extractionEvidenceUnits`:**
- Issue: `deleteExtractionInternal` in `convex/extraction/mutations.ts:968-1009` only deletes `extractionResults`, `extractionPapers`, and `extractionQuestions` — `extractionEvidenceUnits` are orphaned when a job is deleted.
- Files: `convex/extraction/mutations.ts:968-1009`
- Impact: Orphaned `extractionEvidenceUnits` rows accumulate in the database indefinitely
- Fix approach: Add a deletion step for `extractionEvidenceUnits` (by paper, batched) before deleting papers

**Stripe initialized with `"dummy"` fallback key:**
- Issue: Both `convex/subscriptions/actions.ts:38` and `convex/credits/actions.ts:31` instantiate Stripe with `process.env.STRIPE_SECRET_KEY || "dummy"`. The `"dummy"` fallback silently passes Stripe initialization.
- Files: `convex/subscriptions/actions.ts:38`, `convex/credits/actions.ts:31`
- Impact: If `STRIPE_SECRET_KEY` is misconfigured or missing, all Stripe calls will fail at runtime rather than at startup. No alerting.
- Fix approach: Remove the `"dummy"` fallback; validate the env var at module load time and throw early

**Rate limiting defined but not enforced:**
- Issue: `convex/lib/rateLimit.ts` documents rate limit configs (API key saves, checkout sessions, user sync) but explicitly states "rate limiting is handled at the application layer." The `getRateLimitConfig` function only returns configuration values — no enforcement occurs server-side.
- Files: `convex/lib/rateLimit.ts`
- Impact: Endpoints like API key save and checkout session creation have no server-side rate limiting; vulnerable to abuse
- Fix approach: Implement a `rateLimits` table (as described in the file's own comments) and enforce limits in the relevant mutations/actions

## Known Bugs

**Billing page renders debug `console.log` on every render:**
- Symptoms: `console.log("[BILLING] Render #", renderId.current, {...})` fires on every render cycle in the billing settings page, including state that could include plan details
- Files: `app/settings/billing/page.tsx:282-290`
- Trigger: Any state change on the billing page
- Workaround: None; it fires silently in production

**OpenAlex server action logs all query parameters to stdout in production:**
- Symptoms: `console.log("query", query)`, `console.log('OpenAlex SDK call with params:', ...)`, `console.log('OpenAlex SDK response:', ...)`, and `console.log("searchField", ...)` fire in the server action
- Files: `app/actions/openalex.ts:13,18,23,35`
- Trigger: Any search operation
- Workaround: None; clutters server logs with full query parameters on every search

**`debug_papers.ts` accesses a field with `@ts-ignore`:**
- Symptoms: `// @ts-ignore` suppresses a type error on `p.pdfUsed` which likely does not exist in the current schema
- Files: `convex/debug_papers.ts:20-21`
- Trigger: Calling the `recent` internal query
- Workaround: The field value will be `undefined`

## Security Considerations

**Zotero API key stored in plaintext in the database:**
- Risk: The Zotero OAuth API key is stored as a plain string in the `zoteroConnections` table (schema: `apiKey: v.string()`). Unlike provider API keys in `apiKeys` table, no encryption is applied.
- Files: `convex/zotero/mutations.ts:97-103`, `convex/schema.ts:167-175`
- Current mitigation: The table is only accessible server-side via internal queries; Convex's per-user access patterns prevent cross-user reads in practice
- Recommendations: Encrypt the Zotero API key using the same `ENCRYPTION_KEY`/AES approach used for provider API keys in `convex/apiKeys/actions.ts`

**Debug and test functions shipped to production backend:**
- Risk: 14 debug/test files exist in `convex/extraction/` and are exported through `convex/extraction/index.ts`. They are guarded by `requirePublicDebugEnabled()` (checks `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var) but some internal functions (`test_runner.ts`, `test_automation.ts`, `test_helpers.ts`) bypass the debug gate entirely and are accessible as internal Convex functions.
- Files: `convex/extraction/debug.ts`, `convex/extraction/debug_errors.ts`, `convex/extraction/debug_papers.ts`, `convex/extraction/debug_pdfjs_alignment.ts`, `convex/extraction/testActions.ts`, `convex/extraction/testWorkflow.ts`, `convex/extraction/test_automation.ts`, `convex/extraction/test_runner.ts`, `convex/extraction/create_test_job.ts`, `convex/extraction/index.ts:8,97,110-121`
- Current mitigation: Public-facing debug functions require `ENABLE_PUBLIC_DEBUG_FUNCTIONS=true`. Internal debug functions are not callable from clients.
- Recommendations: Move test/debug code out of the production Convex deployment into a separate test deployment; or wrap all test functions in the debug gate; audit that no internal test function can be triggered by a user-facing surface

**`NEXT_PUBLIC_APP_URL` fallback chain could silently redirect to `localhost:3000` in production:**
- Risk: Both `convex/http.ts:13-16` and `convex/subscriptions/actions.ts:42-45` use `process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL || "http://localhost:3000"`. Missing configuration leads to Stripe redirect and Zotero OAuth redirect going to localhost.
- Files: `convex/http.ts:13-16`, `convex/subscriptions/actions.ts:42-45`
- Current mitigation: Likely configured in production; failure would be visible
- Recommendations: Validate these env vars at startup; throw explicitly if missing in non-development environments

## Performance Bottlenecks

**N+1 database queries in `loadJobDataForReporting`:**
- Problem: For each paper in a job, two sequential queries are made (`extractionResults` and `extractionResultReviews`), then reviews are iterated in a loop. For a 100-paper job, this is 200+ sequential DB reads inside a single Convex transaction.
- Files: `convex/extraction/mutations.ts:40-77`
- Cause: Loop-per-paper pattern with two queries each, no batching
- Improvement path: Fetch all results and all reviews for the job in two queries upfront (by jobId index if added, or by collecting all for each paper in parallel with `Promise.all`)

**N+1 queries in `loadJobPapersAndResults` (queries.ts):**
- Problem: Same pattern in `convex/extraction/queries.ts:145-170`: for each paper, results are fetched in a sequential `for` loop.
- Files: `convex/extraction/queries.ts:145-170`
- Cause: Sequential `for...of` loop with `await ctx.db.query(...)` inside
- Improvement path: Restructure to fetch all papers' results in one pass; Convex's document model allows indexed queries by `paperId`

**Sequential individual inserts in `replacePaperEvidenceUnits`:**
- Problem: Deletes existing units one-by-one, then inserts new units one-by-one — for a paper with 200 evidence chunks, this is 400 sequential DB writes in a single Convex mutation.
- Files: `convex/extraction/mutations.ts:1930-1953`
- Cause: `for...of` loops with `await ctx.db.delete/insert` inside
- Improvement path: Acceptable in Convex's mutation model (no network round-trips between DB operations in a transaction), but may hit Convex write limits for large PDF documents

**Unbounded `.collect()` calls on large tables:**
- Problem: 90+ `.collect()` calls across the Convex backend. The most risky is in `convex/extraction/mutations.ts:1775-1777` (full `extractionPapers` table scan) and `convex/maintenance/internal.ts:70` (full `subscriptions` scan for active status check).
- Files: `convex/extraction/mutations.ts:1775`, `convex/maintenance/internal.ts:70`, `convex/extraction/queries.ts` (22+ occurrences)
- Cause: Missing pagination; queries rely on Convex's built-in limits as the only bound
- Improvement path: Apply `.take(N)` limits or use Convex's `paginate()` for large queries; add compound indexes where full scans are avoided by filtering

## Fragile Areas

**Extraction delete cascade is missing evidence units and may recurse infinitely:**
- Files: `convex/extraction/mutations.ts:968-1009`
- Why fragile: The cascade calls `ctx.runMutation(internal.extraction.mutations.deleteExtractionInternal, {...})` recursively to continue after each batch. If a paper has exactly `BATCH_SIZE` results (100), the recursive re-schedule returns before checking if it's actually finished. The loop checks for `results.length > 0` after a `take(100)`, but re-fetches ALL papers for each iteration — O(papers²) complexity for large jobs.
- Safe modification: Replace recursion with a scheduled job using a cursor; verify evidence units are included in deletion steps
- Test coverage: No unit test covers the deletion cascade

**`useAIConfigStore` persists API keys in localStorage:**
- Files: `lib/store.ts:780-844`
- Why fragile: The Zustand store persists `apiKey` and `providerApiKeys` to `localStorage` under the key `'ai-config-storage'`. User-entered plaintext API keys (for BYOK mode) are stored in localStorage. The store has 5 schema versions with migration logic that must be maintained as fields change.
- Safe modification: Verify migration is correct when adding/removing keys from the persisted state; test that old localStorage shapes migrate cleanly
- Test coverage: No test covers the Zustand store migration paths

**Stripe initialized at module load with `"dummy"` key — all billing code silently broken when env missing:**
- Files: `convex/subscriptions/actions.ts`, `convex/credits/actions.ts`
- Why fragile: If `STRIPE_SECRET_KEY` is not set, Stripe is instantiated with `"dummy"` and every Stripe API call will return an authentication error at runtime. No startup check.
- Safe modification: Always validate `process.env.STRIPE_SECRET_KEY` before instantiating Stripe
- Test coverage: Live billing tests validate real Stripe integration, but no unit test covers missing key behavior

**`subscriptions` table can contain multiple rows per user:**
- Files: `convex/schema.ts:71-103`, `convex/subscriptions/lib/selectCanonicalSubscription.ts`
- Why fragile: The `subscriptions` table only has `by_user` index but no uniqueness constraint. `selectCanonicalSubscription` logic exists to pick the right one, but multiple active subscriptions per user can cause credit grant issues if `selectCanonicalSubscription` selects incorrectly.
- Safe modification: Before changing subscription sync logic, verify `selectCanonicalSubscription` handles all edge cases
- Test coverage: Partially covered in `tests/subscription-entitlements.test.ts`

## Scaling Limits

**Convex query complexity limits for large extraction jobs:**
- Current capacity: Extraction queries load all papers + all results for a job in a single query handler. Convex limits each query to reading up to 16MB of data and 8192 documents.
- Limit: A job with ~500 papers and ~5 questions each = ~2500 result documents. Each read in `loadJobPapersAndResults` loads papers + results sequentially, approaching these limits.
- Scaling path: Paginate `getJobDashboard` and `getJobMatrix` queries; return partial data with a cursor

**Search history stored fully in Zustand/localStorage:**
- Current capacity: All search results (papers, responses, screening data) are stored in `lib/store.ts` in a single Zustand store persisted to localStorage.
- Limit: localStorage has a 5-10MB browser limit; heavy users with many saved searches and screening responses will hit this limit silently. No migration/pruning logic exists.
- Scaling path: Move search history to Convex backend storage with pagination

## Dependencies at Risk

**`@sickrin/openalex-sdk` — unknown third-party SDK:**
- Risk: Used as the sole client for OpenAlex API calls (`lib/openalex.ts`, `lib/utils.ts:3`). Package is from an unknown publisher (`@sickrin`) and may not be actively maintained or security-audited.
- Impact: Breaking changes or abandonment would require rewriting all OpenAlex API calls
- Migration plan: Evaluate direct `fetch()` calls to OpenAlex REST API as a more stable alternative

## Missing Critical Features

**No server-side rate limiting for extraction job creation:**
- Problem: `startExtraction` mutation at `convex/extraction/mutations.ts:100` checks only for Pro plan entitlement but has no rate limit on how many jobs a user can start per hour/day. A Pro user could trigger many concurrent large extractions.
- Blocks: Controlling AI inference costs and Convex function compute costs per user
- Recommendation: Add a job count check per user within a time window before allowing new job creation

**No cleanup of orphaned PDF files in Convex storage:**
- Problem: `cleanupOldPdfFiles` in `convex/extraction/mutations.ts:1257` only cleans up PDFs for `completed` papers older than a threshold. Failed papers (`download_failed`, `failed`) are never cleaned. Deleted jobs' storage is also not cleaned.
- Files: `convex/extraction/mutations.ts:1250-1281`
- Blocks: Storage cost management over time
- Recommendation: Extend cleanup to include failed papers and invoke cleanup in the delete cascade

## Test Coverage Gaps

**Extraction cascade delete untested:**
- What's not tested: The `deleteExtractionInternal` recursive cascade and its handling of evidence units, reviews, and PDF storage cleanup
- Files: `convex/extraction/mutations.ts:968-1009`
- Risk: Regression in deletion logic goes unnoticed; orphaned records accumulate
- Priority: High

**Zustand store migration paths untested:**
- What's not tested: The 5-version migration chain in `useAIConfigStore` and other persisted stores
- Files: `lib/store.ts:814-841`
- Risk: Upgrading store version silently drops or corrupts user preferences persisted in localStorage
- Priority: Medium

**Extraction insight aggregation edge cases:**
- What's not tested: Behavior when all papers have `null` answers, when `citationStatus` is missing, or when `reviewState` is an unexpected value
- Files: `lib/extraction/insights.ts`, `convex/extraction/queries.ts:570-640`
- Risk: Aggregate stats (grounded rate, confidence) show misleading numbers with sparse or null data
- Priority: Medium

**No E2E test coverage for extraction feature:**
- What's not tested: The end-to-end extraction workflow (job creation → PDF download → indexing → AI extraction → results display)
- Files: `e2e/` directory only contains `auth.spec.ts`
- Risk: Changes to the workflow, workpool actions, or UI can break the feature entirely
- Priority: High

---

*Concerns audit: 2026-02-27*
