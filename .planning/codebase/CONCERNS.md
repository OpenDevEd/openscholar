# Codebase Concerns

**Analysis Date:** 2026-03-03

## Tech Debt

**BILL-02 Follow-up: Upgrade metadata still sourced from Stripe, not Convex:**
- Issue: `processInvoiceForGrant` reads upgrade metadata (`upgradeFromPlan`, `upgradeToPlan`, `upgradeTimestamp`) directly from the Stripe subscription object (`subscription.metadata`) instead of the local Convex subscription record. The TODO notes migration should happen once all existing Stripe metadata has been moved.
- Files: `convex/credits/actions.ts` (line 374–393)
- Impact: Adds a live Stripe API call during webhook processing. If metadata migrates to Convex but this code is not updated, upgrade proration credit grants will silently stop working.
- Fix approach: Once upgrade metadata is fully migrated into Convex, read from `subRecord` directly and remove the `subscription.retrieve()` call.

**Stripe customer type cast with `as any`:**
- Issue: `convex/maintenance/internal.ts` (line 103) casts the Stripe `fresh.customer` as `(fresh.customer as any)?.id` to handle both string and expanded object forms. The Stripe SDK v20 exposes a typed union for this.
- Files: `convex/maintenance/internal.ts`
- Impact: Loses type safety for customer ID extraction; could silently pass `undefined` if Stripe changes response shape.
- Fix approach: Use `typeof fresh.customer === 'string' ? fresh.customer : fresh.customer?.id` pattern already used consistently in `convex/http.ts`.

**`as any` casts for schema fields not surfaced through client type:**
- Issue: `lib/extraction/export.ts` and `lib/extraction/filtering.ts` repeatedly cast `result as any` to access `correctedAnswer`, `citations`, `citationStatus`, and `reviewState` fields that exist in the schema but are not part of the inferred query return type where the export/filter functions run.
- Files: `lib/extraction/export.ts` (lines 117, 171, 175–177, 219), `lib/extraction/filtering.ts` (lines 48, 51)
- Impact: If the query shape changes, these casts will silently access undefined fields with no compile-time error.
- Fix approach: Derive a shared `ExtractionResultWithReview` type from the `extractionResultWithReviewValidator` in `convex/extraction/validators.ts` and thread it through the export/filtering functions.

**`convex/test.setup.ts` not referenced in vitest config:**
- Issue: Knip reports `convex/test.setup.ts` as an unused file. The vitest config references `tests/setup.ts` as the setup file, not `convex/test.setup.ts`. The Convex test module discovery glob in `convex/test.setup.ts` may be orphaned.
- Files: `convex/test.setup.ts`, `vitest.config.ts`
- Impact: Convex module discovery for `convex-test` isolation may be broken, causing test isolation failures.
- Fix approach: Verify whether `convex/test.setup.ts` should be referenced in `vitest.config.ts` under `server.deps.inline` or as a `setupFiles` entry for the `edge-runtime` environment.

**Convex backend imports `lib/ai/client/providers` (client-named module):**
- Issue: `convex/ai/helpers.ts` imports `getProviderModel` from `lib/ai/client/providers`. The `client/` subdirectory name implies browser-only code, but the function is used server-side (in a `"use node"` Convex action).
- Files: `convex/ai/helpers.ts` (line 20), `lib/ai/client/providers.ts`
- Impact: Conceptual boundary violation makes it unclear whether `lib/ai/client/` is safe to modify for frontend concerns without breaking the backend. Could cause bundling issues if client-only imports are added to that module.
- Fix approach: Move `getProviderModel` to `lib/ai/core/` or a new `lib/ai/server/` directory to reflect its actual usage context.

**Unused file: `components/library/library-filters.tsx`:**
- Issue: Knip detects this file as unused — it is not imported anywhere in the component tree.
- Files: `components/library/library-filters.tsx`
- Impact: Dead code that may confuse future developers or be accidentally duplicated.
- Fix approach: Delete the file if filter functionality has been migrated elsewhere, or wire it into `components/library/library-page-client.tsx`.

## Known Bugs

**OpenAlex polite pool fallback to `admin@example.com`:**
- Symptoms: OpenAlex API requests in production may be throttled or de-prioritized if the env var is absent.
- Files: `convex/extraction/actions.ts`
- Trigger: `OPENALEX_CONTACT_EMAIL` not set in Convex deployment environment.
- Workaround: Set the env var in the Convex dashboard.

## Security Considerations

**Audit log for API key decryption uses `console.log`:**
- Risk: Decryption audit events (`[AUDIT:KEY_DECRYPT]`) are emitted via `console.log` with userId and purpose. These appear in Convex function logs but are not sent to a dedicated audit system.
- Files: `convex/lib/crypto.ts` (line 81–86)
- Current mitigation: Structured JSON with userId, purpose, and timestamp is logged.
- Recommendations: Route to a persistent audit table in Convex or a dedicated log sink for tamper-evident audit trails.

**Debug functions rely on env var gate, not production exclusion:**
- Risk: Files under `convex/extraction/debug_*.ts`, `convex/extraction/test_automation.ts`, `convex/extraction/create_test_job.ts`, etc. are deployed to production and gated only by the `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var being `"true"`. A misconfiguration exposes internal paper data, job contents, and test runners publicly.
- Files: `convex/lib/debug_gate.ts`, `convex/extraction/debug_papers.ts`, `convex/extraction/debug_job_content.ts`, `convex/extraction/debug.ts`, `convex/extraction/test_runner.ts`, `convex/extraction/test_automation.ts`
- Current mitigation: `requireDebugGate()` throws if the env var is not `"true"`. Audit log fires on every access.
- Recommendations: Consider excluding these files from production builds via separate Convex deployment configs or moving to a dedicated staging-only convex project.

**`dangerouslySetInnerHTML` with unsanitized user-content search queries:**
- Risk: `highlightText()` in `components/extraction/results-views/table-view.tsx` (line 293–297) injects HTML directly into the DOM via `dangerouslySetInnerHTML`. The function escapes the search *query* for the regex but the *text* being searched (paper titles, AI-generated answers) is not sanitized before injection.
- Files: `components/extraction/results-views/table-view.tsx` (lines 159–165, 378–388, 450–451)
- Current mitigation: Query string is regex-escaped. The source text is researcher-provided paper data from OpenAlex/Zotero/AI — trusted but not sanitized.
- Recommendations: Wrap the text with DOMPurify before insertion, or replace the highlight implementation with a React-native text splitting approach that avoids raw HTML injection.

**Stripe price IDs fall back to empty strings when env vars are absent:**
- Risk: `convex/lib/constants.ts` (lines 21–23) sets `GO_PRICE_ID`, `PRO_PRICE_ID`, and `ENTERPRISE_PRICE_ID` to empty strings if the env vars are not set. `isAllowedPriceId("")` returns false, but the silent fallback may allow unexpected code paths.
- Files: `convex/lib/constants.ts`
- Current mitigation: `assertPlanPriceConfig()` exists but is not called at startup — only invoked in specific handlers.
- Recommendations: Call `assertPlanPriceConfig()` during a startup check (cron or initial action) so misconfiguration is caught early.

## Performance Bottlenecks

**Library queries use unbounded `.collect()` for all user items:**
- Problem: `convex/library/queries.ts` calls `.collect()` without pagination on all library items for a user in both the search path and the browse path (lines 204, 217). Post-collection filtering is applied for collection membership and rating filters.
- Files: `convex/library/queries.ts` (lines 196–218), `convex/library/collections.ts`, `convex/library/mutations.ts`
- Cause: Filters (collection membership, rating) are applied in JS after fetching all rows. As a user's library grows into thousands of items, this will hit Convex query time limits.
- Improvement path: Push collection membership filter into the index query (use `by_collection` index first), and use cursor-based pagination via `paginationOptsValidator`.

**Extraction report queries load up to 500 papers with all results in memory:**
- Problem: `convex/extraction/mutations.ts` and `convex/extraction/queries.ts` define `MAX_PAPERS_PER_JOB = 500` and fan out N parallel queries for results per paper. For a 500-paper job with 10 questions each, this is 5,000 result records loaded in a single mutation context.
- Files: `convex/extraction/mutations.ts` (line 33, 51–80), `convex/extraction/queries.ts` (line 49)
- Cause: Report generation and insight aggregation require all results to be in memory simultaneously.
- Improvement path: For report snapshots, pre-aggregate incrementally as results arrive. For queries, paginate at the paper level using cursor pagination.

**XLSX export is synchronous and bundled with the page:**
- Problem: `lib/extraction/export.ts` imports `xlsx` at module level (`import * as XLSX from 'xlsx'`), loading the full library (~500KB) even for users who never export. The export component is used directly via static import in `components/extraction/export-dialog.tsx`.
- Files: `lib/extraction/export.ts` (line 2), `components/extraction/export-dialog.tsx` (line 17)
- Cause: Static top-level import prevents tree-shaking and bundle splitting.
- Improvement path: Move `export.ts` to a dynamic import inside the export handler or use `await import('xlsx')` inside the export functions.

**`zoteroConnections` table scanned globally for migration queries:**
- Problem: `convex/zotero/internal.ts` (line 49) calls `.collect()` on the entire `zoteroConnections` table with no index filter in `listAllConnections`. This is used for migration verification but is a public `internalQuery` that could be called at any time.
- Files: `convex/zotero/internal.ts`
- Cause: Migration-era helper left in place.
- Improvement path: Remove or restrict `listAllConnections` once the Zotero key encryption migration is confirmed complete. If needed for auditing, add an `ENABLE_PUBLIC_DEBUG_FUNCTIONS` gate.

**Subscription status cron fetches up to 1,000 records:**
- Problem: `convex/subscriptions/internal.ts` (line 203) takes up to 1,000 active subscription records for the hourly check. Each record then triggers a Stripe API call in `convex/maintenance/internal.ts`.
- Files: `convex/subscriptions/internal.ts` (line 203), `convex/maintenance/internal.ts`
- Cause: Cron-based reconciliation pattern.
- Improvement path: Batch Stripe API calls and implement cursor-based pagination for the subscription scan. Add circuit-breaking if the reconcile action exceeds a time budget.

## Fragile Areas

**Stripe subscription type assertions in maintenance cron:**
- Files: `convex/maintenance/internal.ts`
- Why fragile: Uses `(fresh.customer as any)?.id` to extract customer ID from Stripe subscription. If Stripe API response shape varies (expanded vs non-expanded), this silently produces `undefined` and skips the correction.
- Safe modification: Always use the `typeof x === 'string' ? x : x?.id` pattern. Add a test for both customer shapes.
- Test coverage: No direct unit test for the `checkSubscriptionStatus` correction path with an expanded customer object.

**Credit deduction TOCTOU window (documented, not yet mitigated):**
- Files: `convex/credits/internal.ts` (lines 1238–1280)
- Why fragile: Business logic in actions reads the credit balance before calling `deductCredits`. Two concurrent actions can both observe sufficient balance and both invoke the mutation. Convex OCC prevents negative balances (the mutation re-checks) but a user may experience an unexpected `INSUFFICIENT_CREDITS` rejection.
- Safe modification: All credit-checking logic must remain inside the `deductCredits` mutation, never in the calling action. Do not add pre-mutation balance gates.
- Test coverage: No concurrency stress test exists; behavior is documented but relies on Convex OCC semantics.

**Workflow cancel uses `as any` for workflow ID type:**
- Files: `convex/extraction/mutations.ts` (line 263)
- Why fragile: `workflow.cancel(ctx, job.workflowId as any)` casts the stored string `workflowId` to bypass the expected `Id<"_scheduled_functions">` type. If the workflow component changes its ID type expectations, this will fail at runtime, not at compile time.
- Safe modification: Store `workflowId` with the proper Convex ID type, or verify the cast remains safe after `@convex-dev/workflow` upgrades.
- Test coverage: Covered by the cascade-delete test suite for job deletion, but not for the cancel path specifically.

**Rate limiter `name` cast suppresses exhaustiveness check:**
- Files: `convex/lib/rateLimit.ts` (line 52)
- Why fragile: `name: args.name as any` in the `consume` mutation bypasses the union type check on rate limit names. An invalid name string will silently fail to find a rate limit config rather than failing at compile time.
- Safe modification: Add a `z.enum([...rateLimitNames])` parse on the `name` argument, or use a validator union directly.
- Test coverage: `debug-gate.test.ts` exists but no test for invalid rate limit names.

## Scaling Limits

**Extraction job size hard cap at 500 papers:**
- Current capacity: 500 papers per extraction job (`MAX_PAPERS_PER_JOB` in `convex/extraction/mutations.ts` and `convex/extraction/queries.ts`)
- Limit: Memory/time limits in Convex mutations when loading all results for reporting and insight aggregation.
- Scaling path: Paginate result loading and pre-aggregate insights incrementally as each paper completes rather than at report time.

**Workpool parallelism bounded at 10 concurrent extraction actions:**
- Current capacity: `maxParallelism: 10` in `convex/workflow.ts`; PDF download pool at `maxParallelism: 3` in `convex/workpool.ts`
- Limit: 10 concurrent AI extraction actions across all users simultaneously.
- Scaling path: Increase `maxParallelism` in `convex/workflow.ts` as Convex action concurrency limits allow; consider per-user workpools to prevent one user from starving others.

## Dependencies at Risk

**`xlsx` package is a legacy library (no ESM, large footprint):**
- Risk: `xlsx` (`^0.18.5`) has known security vulnerabilities in certain prototype pollution scenarios and is not actively maintained in its OSS form. The `xlsx` npm package at 0.18.x is the community fork of SheetJS CE.
- Impact: Used in `lib/extraction/export.ts` for Excel export.
- Migration plan: Evaluate replacing with `exceljs` (actively maintained, ESM-compatible) or limiting the feature to CSV-only export.

## Missing Critical Features

**No startup validation of required env vars:**
- Problem: Critical env vars (`STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CLERK_JWT_ISSUER_DOMAIN`) are accessed lazily at call time with no startup assertion. `assertPlanPriceConfig()` exists in `convex/lib/constants.ts` but is not called proactively.
- Blocks: Silent misconfiguration failures in billing, encryption, and auth.

**No pagination on library items query:**
- Problem: `convex/library/queries.ts` fetches all items via `collect()`, post-filters, then applies cursor-style pagination in the UI using URL state. Convex does not have a per-query result limit enforcement beyond its internal 8MB document limit.
- Blocks: Reliable support for users with libraries exceeding ~2,000 items.

## Test Coverage Gaps

**No test for `checkSubscriptionStatus` cron correction path:**
- What's not tested: The divergence detection and Stripe-sourced correction in `convex/maintenance/internal.ts` — specifically, the handling of expanded vs non-expanded Stripe `customer` objects and the `as any` cast.
- Files: `convex/maintenance/internal.ts`
- Risk: Subscription correction silently fails for non-string customer IDs.
- Priority: Medium

**No concurrency test for credit deduction:**
- What's not tested: Two simultaneous `deductCredits` mutations on the same user, to verify Convex OCC re-read behavior prevents double-deduction.
- Files: `convex/credits/internal.ts`
- Risk: If Convex OCC semantics change or the sufficiency check is moved outside the mutation, negative balances become possible.
- Priority: Medium

**No test for `highlightText` XSS protection:**
- What's not tested: `highlightText()` in `components/extraction/results-views/table-view.tsx` with AI-generated answers that contain HTML characters.
- Files: `components/extraction/results-views/table-view.tsx`
- Risk: XSS via unsanitized paper title or AI answer content rendered via `dangerouslySetInnerHTML`.
- Priority: High

**No test for GROBID URL discovery fallback chain:**
- What's not tested: The multi-URL discovery in `convex/extraction/grobid.ts` when `GROBID_URL` env var is absent and both Docker and localhost variants fail.
- Files: `convex/extraction/grobid.ts`
- Risk: PDF extraction silently fails in production if GROBID is unreachable and no clear error surface.
- Priority: Medium

**`components/library/library-filters.tsx` is dead code with no tests:**
- What's not tested: The entire component (unused per knip analysis).
- Files: `components/library/library-filters.tsx`
- Risk: If accidentally reinstated without review, untested filtering logic is activated.
- Priority: Low

---

*Concerns audit: 2026-03-03*
