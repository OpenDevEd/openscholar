# Codebase Concerns

**Analysis Date:** 2026-03-03

## Tech Debt

**Widespread `as any` casts in Stripe webhook handlers:**
- Issue: All Stripe event payload objects are cast with `as any` before being accessed, bypassing TypeScript's type safety for the entire webhook processing pipeline.
- Files: `convex/http.ts` (lines 301, 314, 333, 347, 360), `convex/subscriptions/actions.ts` (lines 80, 98, 118, 225, 350, 450, 468, 591, 902, 938, 956)
- Impact: Typos or Stripe API changes in field names (e.g., `subscription.id`, `invoice.subscription`) will cause silent runtime failures instead of compile-time errors. The Stripe SDK has full TypeScript types for event payloads that are not being used.
- Fix approach: Use typed Stripe SDK event objects — `event.data.object as Stripe.Invoice`, `event.data.object as Stripe.Subscription`, etc. The `stripe` npm package provides all necessary types.

**Extraction job page uses `as any` for Convex IDs:**
- Issue: `params.jobId` and multiple Convex query arguments are cast with `as any` throughout the job detail page to work around type mismatches with `useProtectedQuery` and `useProtectedPaginatedQuery`.
- Files: `app/extraction/[jobId]/page.tsx` (lines 85, 130, 141, 154, 179, 322), `components/extraction/insights-question-panel.tsx` (lines 42, 46), `components/extraction/insights-overview.tsx` (line 33)
- Impact: No compile-time guarantee that the correct ID type is passed to Convex queries. Refactoring query signatures will not produce type errors at call sites.
- Fix approach: Fix the `useProtectedQuery` / `useProtectedPaginatedQuery` wrapper type signatures to accept the correct Convex ID types, or use properly typed arguments.

**`paginationResultValidator(v.any())` in extraction queries:**
- Issue: `convex/extraction/queries.ts` defines `paginatedAnyResultValidator = paginationResultValidator(v.any())` and uses it for the job results paginated query, erasing all return type information for paginated paper results.
- Files: `convex/extraction/queries.ts` (line 199)
- Impact: Downstream client code cannot rely on TypeScript to validate paginated result shapes.
- Fix approach: Define a typed validator for paginated paper results instead of `v.any()`.

**`searchFilters` stored as `v.record(v.string(), v.any())` in schema:**
- Issue: The `searchFilters` field on `extractionJobs`, `extractionWorkflowTemplates`, and related validators uses an untyped record schema. Search filter shape is never validated at the database layer.
- Files: `convex/schema.ts` (lines 212, 251, 503), `convex/extraction/actions.ts` (line 15), `convex/extraction/validators.ts` (lines 106, 143), `convex/extraction/mutations.ts` (line 113)
- Impact: Any arbitrary data can be stored/read as search filters, and `fetchPapersFromHistory` must unsafely cast the value before use.
- Fix approach: Define a typed Convex validator for the search filter shape, matching the interface in `convex/extraction/actions.ts` lines 28–41.

**`zoteroConnections.encryptedApiKey` kept as optional despite completed migration:**
- Issue: Phase 39 encrypted the Zotero API key and ran `migrateToEncryptedKeys`. The schema comment says "only storage form after migration", but the field remains `v.optional(v.string())`. The migration function (`convex/zotero/actions.ts:1092`) is now a no-op (skips all rows because they already have encrypted keys or are abandoned).
- Files: `convex/schema.ts` (lines 175–176), `convex/zotero/actions.ts` (lines 1092–1124)
- Impact: Code consuming this field must handle undefined cases that should never occur in practice, adding unnecessary complexity. The dead migration function creates confusion.
- Fix approach: Make `encryptedApiKey` required in the schema (requires a Convex schema migration), remove the `migrateToEncryptedKeys` action, and update consuming code to remove null checks.

**Substring fallback in `getPlanFromPriceId`:**
- Issue: After exact Stripe price ID matching fails, `getPlanFromPriceId` falls back to `priceId.includes("enterprise")` and `priceId.includes("pro")` to determine plan type.
- Files: `convex/lib/constants.ts` (lines 76–77)
- Impact: A Stripe test price ID like `price_test_pro_monthly_2` would be incorrectly classified as `"pro"` if `STRIPE_PRO_PRICE_ID` is unset or differs. Could grant incorrect subscription entitlements in misconfigured environments.
- Fix approach: Remove the substring fallback. If no exact match, return `"free"`. Log a warning so misconfigured IDs are visible.

**Stripe subscription metadata stored as free-form Stripe metadata rather than in schema:**
- Issue: Plan change state (`pendingPlanChange`, `pendingTargetPriceId`, `pendingTargetPlan`) is stored in Stripe subscription metadata via `clearPendingPlanMetadata` rather than in the Convex `subscriptions` table.
- Files: `convex/subscriptions/actions.ts` (lines 88–93, 419, 516)
- Impact: This state is invisible to Convex queries and requires round-trips to the Stripe API to read. Stripe metadata changes are also not validated.
- Fix approach: Add pending plan change columns to the `subscriptions` table in `convex/schema.ts`.

**`crypto` module obfuscated to avoid bundler detection:**
- Issue: `convex/lib/crypto.ts` uses `["cry", "pto"].join("")` to dynamically require Node's `crypto` module to prevent esbuild from resolving it at bundle time.
- Files: `convex/lib/crypto.ts` (lines 12–15)
- Impact: This is a fragile pattern — bundler updates or security tooling changes could break it silently. The intent (Node-only execution) should be enforced by the `"use node"` directive in the files that import it, not by obfuscation.
- Fix approach: Add `"use node"` to `convex/lib/crypto.ts` itself and use a normal `import * as crypto from "node:crypto"` statement.

**`continueCursor: "" as any` workaround in library queries:**
- Issue: When a library query returns early (no results), it uses `"" as any` to satisfy the Convex pagination cursor type.
- Files: `convex/library/queries.ts` (lines 32, 45, 106, 119)
- Impact: Passing an empty string as a cursor to Convex internals may cause unexpected behaviour if the pagination implementation changes.
- Fix approach: Return early-exit results via a different path (e.g., a non-paginated query variant), or use the Convex-documented approach for empty paginated results.

## Known Bugs

**BUG-05: OpenAlex polite pool fallback email (`admin@example.com`):**
- Symptoms: OpenAlex API requests identify the app as `mailto:admin@example.com` if `OPENALEX_CONTACT_EMAIL` env var is not configured.
- Files: `convex/extraction/actions.ts` (lines 136–140)
- Trigger: Missing `OPENALEX_CONTACT_EMAIL` environment variable in any deployment.
- Workaround: Set `OPENALEX_CONTACT_EMAIL` in the Convex dashboard to a monitored email address.

## Security Considerations

**User-supplied API keys decrypted in multiple action handlers without centralised audit:**
- Risk: The `ENCRYPTION_KEY` environment variable is accessed in four different places to decrypt API keys for external providers (OpenAI, Anthropic, Google, OpenRouter, Zotero). There is no centralised audit log for decryption operations.
- Files: `convex/apiKeys/actions.ts` (lines 58, 99), `convex/zotero/actions.ts` (lines 37, 604, 1100)
- Current mitigation: Keys are AES-256-GCM encrypted at rest; decryption only occurs server-side in Convex actions.
- Recommendations: Centralise decryption into a single internal utility function to reduce surface area; add structured logging when keys are decrypted and used.

**Debug/test functions deployed to production (runtime-gated only):**
- Risk: All debug and test functions in `convex/extraction/` (8+ files) are deployed to production and rely solely on the `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var being absent/`"false"` to be blocked. Any misconfiguration of this env var would expose internal extraction state and allow arbitrary test job creation.
- Files: `convex/extraction/debug.ts`, `convex/extraction/debug_errors.ts`, `convex/extraction/debug_papers.ts`, `convex/extraction/debug_paper_results.ts`, `convex/extraction/debug_job_content.ts`, `convex/extraction/debug_job_citations.ts`, `convex/extraction/debug_pdfjs_alignment.ts`, `convex/extraction/test_automation.ts`, `convex/extraction/test_automation_internal.ts`, `convex/extraction/test_runner.ts`, `convex/extraction/testActions.ts`, `convex/lib/debug_gate.ts`
- Current mitigation: `requirePublicDebugEnabled()` throws `FORBIDDEN` when env var is not `"true"`.
- Recommendations: Exclude debug files from production builds using a Convex-level build flag or separate deployment configuration, rather than relying on a runtime env var check.

## Performance Bottlenecks

**`loadJobPapersAndResults`: N+1 queries for reviews per paper:**
- Problem: `loadJobPapersAndResults` runs a `Promise.all` over all papers in a job, executing one `extractionResultReviews` query per paper. For a 200-paper job with 5 questions, this is 200 individual Convex reads.
- Files: `convex/extraction/queries.ts` (lines 172–196)
- Cause: `attachReviewMetadata` takes a single `paperId` and queries reviews per paper.
- Improvement path: Batch-load all reviews for the job in a single query using `by_job` index on `extractionResultReviews`, then build the `reviewByResultId` map in memory.

**Unbounded `.collect()` on per-job paper/result queries:**
- Problem: Multiple extraction queries call `.collect()` on `extractionPapers` filtered by `jobId` with no upper limit. For jobs with 200+ papers, these load all papers into memory before any filtering or slicing.
- Files: `convex/extraction/queries.ts` (lines 182, 316, 362, 376, 448, 453, 529), `convex/extraction/mutations.ts` (lines 52, 56, 302, 592)
- Cause: No pagination or `.take()` applied to these per-job queries.
- Improvement path: Add `.take(MAX_PAPERS_PER_QUERY)` guards or refactor to use paginated queries for jobs that may grow beyond a few hundred papers.

**`zoteroOAuthTokens` cleanup does a full table scan:**
- Problem: `cleanupExpiredOAuthTokens` calls `.collect()` on the entire `zoteroOAuthTokens` table to find expired entries, rather than filtering by `expiresAt` using an index.
- Files: `convex/zotero/mutations.ts` (lines 153–178)
- Cause: No `by_expiry` index exists on `zoteroOAuthTokens`; cleanup filters in JS after loading all rows.
- Improvement path: Add `.index("by_expiry", ["expiresAt"])` to the schema and use it in `cleanupExpiredOAuthTokens` with `.withIndex("by_expiry", q => q.lt("expiresAt", now)).take(100)`.

**`check subscription status` cron: JS-side filtering after partial index scan:**
- Problem: `checkSubscriptionStatus` (hourly cron) queries `subscriptions` by status using the `by_status` index, then filters in JavaScript for `updatedAt` threshold because no composite index exists.
- Files: `convex/maintenance/mutations.ts` (lines 155–164), `convex/maintenance/internal.ts`
- Cause: Comment explicitly documents missing composite index on `status+updatedAt`.
- Improvement path: Add `.index("by_status_updatedAt", ["status", "updatedAt"])` to `subscriptions` schema.

**`components/ui/focus-mode.tsx` is 1,279 lines:**
- Problem: The focus-mode component is a monolithic file handling paper rendering, rating, bookmarking, PDF viewing, and keyboard navigation. It imports many dependencies and is re-rendered frequently.
- Files: `components/ui/focus-mode.tsx`
- Cause: Feature accretion without component decomposition.
- Improvement path: Extract sub-features (PDF viewer, citation panel, rating controls) into separate files under `components/focus-mode/`.

## Fragile Areas

**`convex/credits/internal.ts:1250-1280` — OCC concurrency gap for credit deduction:**
- Files: `convex/credits/internal.ts` (lines 1250–1280)
- Why fragile: The current credit deduction flow reads balance in an action then writes in a mutation (two transactions). The comment documents that the gap between read and write is an OCC window where a user could see optimistic "success" but get `INSUFFICIENT_CREDITS` on the actual mutation. If the mutation-level sufficiency check is bypassed by a bug, negative balances could result.
- Safe modification: Follow the documented mitigation path — route all `deductCredits` callers through a per-user workpool with `maxParallelism: 1`, or add version-field optimistic locking.
- Test coverage: Tested in `tests/credit-refund-reversal.test.ts`, `tests/ai-credit-billing.test.ts`, but concurrent double-deduction is not covered.

**`getPlanFromPriceId` substring fallback (billing impact):**
- Files: `convex/lib/constants.ts` (lines 69–80)
- Why fragile: In test/staging environments where `STRIPE_PRO_PRICE_ID` may differ from production, any Stripe price ID containing "pro" or "enterprise" as a substring will be granted that plan tier incorrectly.
- Safe modification: Remove the substring fallback entirely; treat unknown price IDs as `"free"`.
- Test coverage: `tests/plan-config.test.ts` does not test the substring fallback path.

**Stripe webhook handler: `as any` casts on event data:**
- Files: `convex/http.ts` (lines 299–365)
- Why fragile: Each `event.data.object as any` cast means field access errors are invisible until runtime. Stripe API version changes or unexpected event structures will cause silent failures or `undefined` propagation into downstream mutations.
- Safe modification: Replace all `as any` casts with `as Stripe.Invoice`, `as Stripe.Subscription` etc. matching the event type.
- Test coverage: `tests/clerk-webhook-handler.test.ts` covers Clerk events; Stripe event handler has minimal unit test coverage.

**Extraction deletion cascade (`deleteExtractionInternal`):**
- Files: `convex/extraction/mutations.ts` (lines 1020–1148)
- Why fragile: Deletion uses a recursive scheduler loop with `BATCH_SIZE = 100`. Each step re-schedules itself. A job with thousands of papers and results requires many scheduler runs. Any scheduler failure mid-cascade leaves the job in a partially deleted state with orphaned records.
- Safe modification: Do not change the BATCH_SIZE constant — it is tuned to avoid Convex transaction limits. Add a `deletedAt` tombstone to `extractionJobs` so partially-deleted jobs are not shown to users even if the cascade is still in progress.
- Test coverage: `convex/extraction/cascade-delete.test.ts` covers BUG-03 (baseline diff deletion) but does not test partial-deletion recovery.

## Scaling Limits

**OpenAlex fetch hard-limited to 200 papers per job:**
- Current capacity: All extraction jobs fetch at most 200 papers (OpenAlex `per-page=200`, single page).
- Limit: Jobs sourced from search results with >200 papers silently truncate. Users expecting full systematic review coverage will get incomplete data.
- Files: `convex/extraction/actions.ts` (line 125)
- Scaling path: Implement cursor-based pagination over OpenAlex results (using `cursor` parameter) until the desired count is reached or results are exhausted.

**No upper bound on `getJobResultsForExport` result count:**
- Current capacity: `convex/extraction/queries.ts` line 1186 caps export at `min(limit, 1000)` but default is 200.
- Limit: Jobs with thousands of manually-uploaded papers (Zotero/manual source type) would hit the 1000-row cap.
- Files: `convex/extraction/queries.ts` (line 1186)
- Scaling path: Implement paginated export flow in the UI rather than single-query bulk load.

## Dependencies at Risk

**`ollama` and `ollama-ai-provider-v2` are unused (knip):**
- Risk: Listed in `package.json` as dependencies but not imported anywhere in the codebase.
- Impact: Increased install size; potential version-drift vulnerabilities in unused packages.
- Files: `package.json` (lines 75–76)
- Migration plan: Remove both packages; they appear to be planned future integrations that were never completed.

**`@ai-sdk/cohere` is unused (knip):**
- Risk: Listed in `package.json` but never imported.
- Files: `package.json` (line 25)
- Migration plan: Remove unless Cohere support is actively planned for a near-term phase.

**`unpdf` is unused (knip):**
- Risk: Listed in `package.json` but not imported. PDF processing uses `pdfjs-dist` (unlisted in package.json — see below).
- Files: `package.json` (line 90)
- Migration plan: Remove `unpdf`; verify `pdfjs-dist` is declared as an explicit dependency.

**`pdfjs-dist` is unlisted in `package.json` (knip):**
- Risk: `pdfjs-dist` is imported in `components/extraction/pdf-viewer.tsx` and `convex/extraction/pdfjs_extract.ts` but not declared in `package.json`.
- Files: `components/extraction/pdf-viewer.tsx` (line 8), `convex/extraction/pdfjs_extract.ts` (line 29)
- Migration plan: Add `pdfjs-dist` as an explicit dependency; current behaviour relies on it being pulled in transitively.

**26 Radix UI packages declared as dependencies but flagged as unused by knip:**
- Risk: All `@radix-ui/*` packages are in `package.json` but knip reports none as directly imported. They are likely consumed via shadcn/ui re-exports — but knip cannot trace through barrel re-exports. Should be verified before removal to avoid breaking UI components.
- Files: `package.json` (lines 38–57)
- Migration plan: Audit which Radix packages are actually used transitively through `components/ui/*`; keep only those confirmed in use.

## Missing Critical Features

**No pagination for OpenAlex search results beyond 200:**
- Problem: Systematic literature reviews often require thousands of papers. The current 200-paper hard cap means all jobs using the "history" source type are incomplete beyond 200 results.
- Blocks: Systematic review use cases; users who need full dataset coverage.

**No retry or recovery for stale failed Stripe events:**
- Problem: The `monitor failed stripe events` cron (hourly) only logs `console.error` alerts for Stripe events that have been in `failed` status for >1 hour. There is no automated retry or self-healing mechanism.
- Files: `convex/maintenance/mutations.ts` (lines 155–183), `convex/crons.ts` (line 20)
- Blocks: Billing correctness after webhook delivery failures without manual intervention in the Convex dashboard.

## Test Coverage Gaps

**Stripe webhook handler (`convex/http.ts`) has no dedicated unit tests:**
- What's not tested: The `processInvoiceForGrantNonBlocking` retry path, `runAuditedStripeHandler` error recording, and individual event type handlers (`invoice.paid`, `customer.subscription.created`, etc.).
- Files: `convex/http.ts`
- Risk: Changes to webhook routing or Stripe payload handling could break credit grants or subscription sync silently.
- Priority: High

**Concurrent credit deduction race condition not tested:**
- What's not tested: Two simultaneous `deductCredits` calls for the same user where the first read sees sufficient balance but both mutations attempt to write. The OCC gap documented in `convex/credits/internal.ts:1260–1280` has no concurrency test.
- Files: `convex/credits/internal.ts`
- Risk: Any mutation logic bug bypassing the sufficiency check could produce negative balances undetected.
- Priority: High

**`getPlanFromPriceId` substring fallback not tested:**
- What's not tested: The `priceId.includes("pro")` and `priceId.includes("enterprise")` branches in `getPlanFromPriceId`.
- Files: `convex/lib/constants.ts` (lines 76–77), `tests/plan-config.test.ts`
- Risk: Incorrect plan assignment in non-standard Stripe environments goes undetected.
- Priority: Medium

**Extraction deletion cascade partial-failure recovery not tested:**
- What's not tested: Behaviour when the scheduler-based cascade is interrupted mid-run (e.g., Convex deployment during deletion).
- Files: `convex/extraction/mutations.ts`, `convex/extraction/cascade-delete.test.ts`
- Risk: Orphaned database rows for partially deleted jobs accumulate indefinitely.
- Priority: Medium

**Debug gate bypass not tested:**
- What's not tested: Confirming that all debug/test functions in `convex/extraction/` correctly throw `FORBIDDEN` when `ENABLE_PUBLIC_DEBUG_FUNCTIONS` is unset.
- Files: `convex/lib/debug_gate.ts`, all `convex/extraction/debug_*.ts` files
- Risk: A misconfigured production deployment exposing debug APIs would be undetected until exploited.
- Priority: Medium

---

*Concerns audit: 2026-03-03*
