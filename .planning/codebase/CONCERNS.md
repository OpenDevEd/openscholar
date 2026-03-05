# Codebase Concerns

**Analysis Date:** 2026-03-04

## Tech Debt

**Oversized files with too many responsibilities:**
- Issue: Several files have grown beyond reasonable single-responsibility bounds, making changes risky
- Files:
  - `convex/extraction/mutations.ts` (2275 lines) — job creation, deletion cascade, plan checks, reporting, templates, diffs
  - `convex/credits/internal.ts` (1433 lines) — credit grants, deductions, refund logic, subscription sync
  - `lib/store.ts` (1273 lines) — 10+ unrelated Zustand slices combined in one module
  - `app/extraction/[jobId]/page.tsx` (1017 lines) — large page component with sorting, filtering, pagination logic inlined
- Impact: Changes to one concern frequently touch other concerns; merge conflicts; hard to test in isolation
- Fix approach: Decompose into focused modules. E.g., split mutations.ts into `job-lifecycle.ts`, `cascade-delete.ts`, `template-mutations.ts`, `run-diff.ts`. Split store.ts into per-feature store files

**`NEXT_PUBLIC_` env vars used to gate server-side Convex logic:**
- Issue: Feature flags in `convex/lib/featureFlags.ts` and `convex/extraction/guard.ts` read `NEXT_PUBLIC_CREDITS_ENABLED`, `NEXT_PUBLIC_EXTRACTION_ENABLED`, `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED`, `NEXT_PUBLIC_EXTRACTION_PDF_ENABLED`, `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED`. These are browser-facing env vars (exposed in client bundles) but are being relied on as server-side gates on Convex backend
- Files: `convex/lib/featureFlags.ts`, `convex/extraction/guard.ts`, `convex/extraction/content.ts`, `convex/credits/queries.ts`
- Impact: If any of these is set `"false"` to disable a feature in production, it may not propagate correctly to the Convex deployment, and the gate behavior is unclear if the var is simply absent vs explicitly false. The logic `!== "false"` means the feature is enabled by default when the var is absent
- Fix approach: Use private (non-`NEXT_PUBLIC_`) env vars for server-side Convex feature flags

**Audit log module unused per knip:**
- Issue: `convex/lib/audit.ts` is flagged as "unused" by knip despite being referenced via `internal.lib.audit.writeAuditLog` in several files. This is a false positive from knip's perspective (internal references via generated API), but the `REQUIRED_ENV_VARS` and `checkRequiredEnvVars` exports from `convex/lib/envValidation.ts` are also flagged unused by knip
- Files: `convex/lib/audit.ts`, `convex/lib/envValidation.ts`
- Impact: Low risk (false positive), but knip output is cluttered with false positives making real issues harder to spot
- Fix approach: Add these to knip `ignore` config or use knip's `ignoreDependencies` for generated Convex internals

**Staging/debug/test files shipped in production Convex deploy:**
- Issue: The `convex/extraction/` directory contains 10+ files prefixed with `debug_`, `test_`, or `testWorkflow`/`testActions` that are deployed to production Convex. All are gated by `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var but still compiled and deployed
- Files:
  - `convex/extraction/debug.ts`
  - `convex/extraction/debug_errors.ts`
  - `convex/extraction/debug_job_citations.ts`
  - `convex/extraction/debug_job_content.ts`
  - `convex/extraction/debug_paper_results.ts`
  - `convex/extraction/debug_papers.ts`
  - `convex/extraction/debug_pdfjs_alignment.ts`
  - `convex/extraction/debug_pdfjs_alignment.ts`
  - `convex/extraction/testWorkflow.ts`
  - `convex/extraction/testActions.ts`
  - `convex/extraction/test_automation.ts`
  - `convex/extraction/test_automation_internal.ts`
  - `convex/extraction/test_runner.ts`
  - `convex/extraction/create_test_job.ts`
- Impact: Larger deploy bundle; additional attack surface even if gated; `as any` casts in these files
- Fix approach: Move these to a `convex/extraction/dev/` subdirectory that is explicitly excluded from production deploys, or consider a separate Convex app for staging debug utilities

**`as any` casts in production code:**
- Issue: Scattered `as any` casts bypass type safety in production code paths
- Files:
  - `convex/extraction/testWorkflow.ts:51` — `as any` on workpool scheduling
  - `convex/extraction/workpoolActions.ts:786` — `storageId: storedId as any` to work around storage ID type mismatch
  - `convex/extraction/test_automation.ts:28,31,56,65` — multiple `as any` on query results
  - `convex/subscriptions/actions.ts:873` — `(error as any).decline_code`
  - `lib/search/initializer.tsx:121` — `as any` on search params
  - `lib/search/provider.tsx:503` — `setUrlParams(updates as any)`
  - `lib/ai/core/execute.ts:69` — `as any` on AI action call
  - `lib/extraction/export.ts:202` — dynamic `require` fallback for ExcelJS
- Impact: Type errors hidden at compile time; runtime exceptions possible
- Fix approach: The `workpoolActions.ts:786` case needs the storage ID type properly threaded. The `test_automation.ts` cases should use typed internal query return types. `subscriptions/actions.ts:873` needs a Stripe-typed error check

**Store migrations use `any` types:**
- Issue: `lib/store.ts` zustand persist migration functions are typed as `(persistedState: any, version: number) => any`, and `importSearchHistory: (data: any[])` imports untyped external data without validation
- Files: `lib/store.ts` (lines 72, 184, 531, 769, 827)
- Impact: Corrupted or malformed localStorage data can cause unpredictable state bugs that are invisible to TypeScript
- Fix approach: Type migration functions with versioned state interfaces; validate imported data with zod before inserting into store

**Unused exports (49 identified by knip):**
- Issue: Knip identified 49 unused exports across components and lib modules
- Key files with unused exports:
  - `lib/search-params/index.ts` — many exported functions unused
  - `lib/filters/index.ts` — `FILTER_ICONS`, `FILTER_EMOJIS`, formatters exported but unused
  - `lib/extraction/insights.ts` — `isGenericArrayEntity`, `parseAnswerEntities`, `normalizeAnswer`, `getEffectiveConfidence`
  - `lib/store.ts` — `useAIConfigDialogStore`, `createSidebarStore`, `createSidebarDimensions`
  - `components/ui/` — many sub-exports of shadcn components (low priority, typical pattern)
- Impact: Dead code increases bundle size and cognitive overhead
- Fix approach: Remove truly dead exports; for shadcn components, use knip `ignore` patterns to filter UI component sub-exports

---

## Security Considerations

**AI API keys stored unencrypted in localStorage:**
- Risk: User-provided AI API keys (OpenAI, Anthropic, Google, OpenRouter) are stored in browser localStorage via zustand persist under the key `ai-config-storage`. If XSS occurs, or if browser storage is accessed by another extension, keys are exposed in plaintext
- Files: `lib/store.ts` (lines 793–858), `useAIConfigStore`
- Current mitigation: None — keys are persisted as-is. The Convex-stored keys (BYOK) are AES-256-GCM encrypted in `convex/lib/crypto.ts`; the local AI config store is not
- Recommendations: Either avoid persisting API keys to localStorage at all (prompt on each session), or encrypt before storage using the browser Web Crypto API

**No HTTP security headers in Next.js config:**
- Risk: `next.config.ts` contains no `headers()` function. No Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, or Referrer-Policy headers are set
- Files: `next.config.ts`
- Current mitigation: None at the application level (hosting platform may add some)
- Recommendations: Add a `headers()` block with `Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`

**OpenAlex API route is unauthenticated and publicly accessible:**
- Risk: `app/api/openalex/search/route.ts` is a GET endpoint with no authentication check. It is listed as a public route in `lib/auth/public-routes.ts`. Any caller can use it to proxy unlimited requests to the OpenAlex API using the app's identity
- Files: `app/api/openalex/search/route.ts`, `lib/auth/public-routes.ts`
- Current mitigation: OpenAlex is a free public API, so financial risk is low; rate limit risk exists
- Recommendations: Add rate limiting at the edge (Vercel middleware or Convex rate limit), or require authentication for non-trivial usage

**Unpaywall API called with placeholder email `user@example.com`:**
- Risk: `lib/pdf/download.ts:289` calls the Unpaywall API with `email=user@example.com`. Unpaywall's API TOS requires a valid institutional or project email for the "polite pool" to get better rate limits and avoid blocking
- Files: `lib/pdf/download.ts`
- Current mitigation: None
- Recommendations: Configure a real project email via env var (`UNPAYWALL_EMAIL`) and use it in the request

**`console.log("[KEY_DECRYPT]")` logs every API key decryption:**
- Risk: `convex/lib/crypto.ts:81` logs the `purpose` string (not the key itself) for every decryption. While this is intentional audit logging, Convex logs may be visible to team members who shouldn't see which users' keys are being decrypted in what contexts
- Files: `convex/lib/crypto.ts`
- Current mitigation: Only the purpose string is logged, not the key value
- Recommendations: Ensure audit log visibility is restricted; consider writing to `auditLogs` table instead of/in addition to console

---

## Performance Bottlenecks

**89 unbounded `.collect()` calls across Convex backend:**
- Problem: 89 instances of `.collect()` without a preceding `.take(N)` limit are spread across the Convex backend. Most are scoped by indexed user queries (low-cardinality), but some touch larger tables without bounds
- Files: `convex/extraction/queries.ts` (19 instances), `convex/subscriptions/internal.ts` (9 instances), `convex/credits/internal.ts` (9 instances), `convex/library/` (various)
- Notable risky cases: `convex/credits/internal.ts:180,202,212` collect all `creditTransactions` for a user (could be large for active paying users); `convex/extraction/queries.ts:580` collects results unboundedly inside a pagination loop
- Impact: For heavy users with many credit transactions or library items, these queries can time out or consume excessive Convex bandwidth
- Fix approach: Add `.take(N)` before `.collect()` where result sets could be large; use `.paginate()` for user-facing queries on large tables. Specifically, `creditTransactions` queries should paginate

**Extraction page loads all 200 papers into memory client-side:**
- Problem: `app/extraction/[jobId]/page.tsx:175` calls `loadMore(200)` which fetches up to 200 papers, then filtering/sorting/grouping all happens in-memory with `useMemo` chains (filteredPapers, sortedPapers, preprocessedData)
- Files: `app/extraction/[jobId]/page.tsx`
- Impact: 200 papers × N questions × results data = large in-memory state; filtering is O(papers × questions) on every render cycle; potential jank on large extractions
- Fix approach: Move filter/sort to server-side Convex query arguments; paginate the table view rather than loading all 200 upfront

---

## Fragile Areas

**Cascade delete of extraction jobs uses chained scheduler calls:**
- Files: `convex/extraction/mutations.ts` (lines 1061–1230, `deleteExtractionInternal`)
- Why fragile: The cascade delete recurses through 8+ steps by calling `ctx.scheduler.runAfter(0, self, ...)`. If any step throws an unhandled error partway through, partial deletion leaves orphaned records (extractionResults without papers, papers without jobs). The `BATCH_SIZE = 100` means a 500-paper job requires 5+ chained scheduler invocations for papers alone
- Safe modification: Always test cascade delete in convex-test before changing step order. Never add a new owned table without adding a delete step here. See `convex/extraction/cascade-delete.test.ts` for coverage
- Test coverage: Good — `cascade-delete.test.ts` covers 596 lines of scenarios including BUG-03 (orphaned diffs when baseline job deleted)

**Zotero OAuth token cleanup is timing-sensitive:**
- Files: `convex/zotero/mutations.ts:170`, `convex/zotero/actions.ts`
- Why fragile: OAuth token state machines involve multi-step Convex mutations (request token → store → callback → exchange → store access token). Comment at line 170 acknowledges concurrent deletion risk: "Token may have been deleted by getRequestToken or concurrent process." The cleanup cron at `cleanupExpiredOAuthTokens` deletes expired tokens on a schedule
- Safe modification: Treat the token lifecycle as a state machine; do not modify token states outside the designated actions

**`selectCanonicalSubscription` is the single source of plan truth:**
- Files: `convex/subscriptions/lib/selectCanonicalSubscription.ts`, used in `guard.ts`, `credits/internal.ts`, `subscriptions/internal.ts`
- Why fragile: All plan enforcement (extraction gating, credit grants, pro plan checks) passes through this one function. Any bug here silently affects billing, access control, and credit math. The function handles `duplicate subscriptions` by de-duplication, meaning schema divergence in the subscriptions table can silently downgrade users
- Test coverage: Subscription tests exist (`tests/subscription-*.test.ts`) but the canonical selection logic needs its own isolated unit tests

**`lib/store.ts` Zustand localStorage migrations have no rollback:**
- Files: `lib/store.ts` (version 0–5 migrations for `ai-config-storage`, version-tracked for `openalex-search-history`)
- Why fragile: If a user has a localStorage version newer than the current code (e.g., after a rollback deployment), the migrate function receives an unrecognized `version` and falls through to `return persistedState`, potentially applying no migration. Data shape mismatches can cause silent state corruption
- Safe modification: Never delete a migration step; add new versions only; test each migration path

---

## Scaling Limits

**Convex storage: no lifecycle/expiry policy for uploaded PDFs:**
- Current capacity: Unlimited — PDFs uploaded via `ctx.storage.store()` persist indefinitely unless explicitly deleted
- Limit: Convex storage costs grow unboundedly with extractions over time
- Scaling path: The cascade delete does clean up PDFs when a job is deleted (`mutations.ts:1115`), but there is no automatic TTL for PDFs from jobs that users never delete. A maintenance cron should expire PDFs from old/abandoned jobs

**`extractionResults` table has no pagination in some internal queries:**
- Files: `convex/extraction/queries.ts:407,421,493,513` — `.collect()` on results within a job
- Current capacity: Bounded by `MAX_PAPERS_PER_JOB = 500` papers × N questions, but result documents could be large
- Scaling path: Add `.take(MAX_PAPERS_PER_JOB)` guardrails to all result collect calls

---

## Dependencies at Risk

**`@sickrin/openalex-sdk` is a custom/third-party wrapper with minimal visibility:**
- Risk: `lib/openalex.ts` instantiates `new OpenAlexClient()` without any configuration (no email for polite pool, no timeout). The SDK `@sickrin/openalex-sdk` has no configuration passed at construction time
- Files: `lib/openalex.ts`
- Impact: OpenAlex API calls made without app identity/email; rate limiting from the anonymous pool; no timeout protection on API calls
- Migration plan: Configure the client with a project email env var; add request timeout; evaluate switching to direct `fetch` for simpler dependency

---

## Missing Critical Features

**No input length validation on user-provided strings:**
- Problem: Convex validators use bare `v.string()` (77 instances in `convex/extraction/validators.ts`) with no `maxLength` equivalent. A malicious user could submit very long strings for question text, question keys, or extraction job titles
- Blocks: Defense-in-depth against database storage bloat and potential DoS via large document serialization
- Files: `convex/extraction/validators.ts`, `convex/extraction/mutations.ts`

**No admin role or admin-only endpoints:**
- Problem: There is an `app/admin/cleanup/` directory (empty) suggesting planned admin tooling, but no admin authentication exists. There are no Convex `isAdmin` checks, no admin-gated API routes, and no admin dashboard
- Blocks: Operational management tasks (e.g., inspecting user state, force-canceling jobs, granting credits manually) cannot be done safely
- Files: `app/admin/` (empty), no corresponding Convex admin mutations

**No CSP or security headers in production:**
- Problem: `next.config.ts` sets no `headers()`. There is no Content-Security-Policy to mitigate XSS, no clickjacking protection (X-Frame-Options), and no HSTS
- Blocks: Security compliance; enterprise customer requirements

---

## Test Coverage Gaps

**No tests for `convex/extraction/mutations.ts` core mutations:**
- What's not tested: The main job creation mutation (`startExtraction`), template creation/duplication, saved view CRUD, run diff computation, and aggregate insights computation in mutations.ts are not covered by convex-test unit tests
- Files: `convex/extraction/mutations.ts` (2275 lines)
- Risk: Regressions in credit deduction hooks, plan enforcement, or cascade delete ordering go undetected until production
- Priority: High

**No tests for subscription plan enforcement in `guard.ts`:**
- What's not tested: `requireProPlan`, `requireGoPlan`, `requirePlanTier` in `convex/extraction/guard.ts` are not covered by convex-test. Subscription queries inside guard functions are untested
- Files: `convex/extraction/guard.ts`
- Risk: Plan enforcement bugs silently allow free users to run paid extractions
- Priority: High

**No tests for Zotero OAuth flow:**
- What's not tested: The full Zotero OAuth request/callback/access token exchange (`convex/zotero/actions.ts`) has no unit or integration tests
- Files: `convex/zotero/actions.ts`
- Risk: OAuth regressions fail silently; tokens may not be stored/cleaned correctly
- Priority: Medium

**No component-level tests:**
- What's not tested: All UI components in `components/` have zero test coverage. The extraction job page (`app/extraction/[jobId]/page.tsx`), library page, and billing settings page are complex interactive components with no tests
- Files: `components/extraction/`, `app/extraction/[jobId]/page.tsx`
- Risk: UI regressions not caught before deploy; filtering/sorting logic in page components is untested
- Priority: Medium

**`convex/lib/audit.ts` write path not tested:**
- What's not tested: `writeAuditLog` internal mutation has no test verifying audit records are actually written to the database when API key decryption, Zotero OAuth, or env validation events occur
- Files: `convex/lib/audit.ts`
- Risk: Audit trail may silently fail without anyone noticing
- Priority: Low

---

*Concerns audit: 2026-03-04*
