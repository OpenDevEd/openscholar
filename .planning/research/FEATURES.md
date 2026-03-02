# Feature Research: v2.4 Concerns Sweep Fixes

**Domain:** Codebase health -- tech debt, bugs, and security fixes for an existing academic search/extraction platform
**Researched:** 2026-03-02
**Confidence:** HIGH (all 13 concerns documented in CONCERNS.md with exact file locations; fix patterns verified against Convex docs and official component APIs)

## Feature Landscape

This is not a greenfield feature list. All 13 items are fixes to existing code. The framing is: what does "correctly fixed" look like for each concern, and what complexity/dependencies does each carry.

### Table Stakes (Must Fix -- Broken or Risky Behavior)

Features users assume work correctly. These are currently broken, silently wrong, or security risks.

| # | Fix | Why Table Stakes | Complexity | Existing Code Dependency |
|---|-----|------------------|------------|--------------------------|
| 1 | **Cancel extraction actually stops work** | Users click cancel, expect processing to stop. Currently it only writes `status: "cancelled"` to DB; workflow and workpool continue processing, burning credits. | MEDIUM | `cancelExtraction` at `convex/extraction/mutations.ts:229-256`. Requires `workflow.cancel(ctx, job.workflowId)`. In-progress `step.runAction()` calls will finish (Convex workflow semantics), but no new steps will start. Workpool items already dispatched will also need `pool.cancelAll()` or status-check guards in the worker. |
| 2 | **getJobDetails pagination (remove 100-paper cap)** | Jobs with >100 papers show incomplete paper lists. Users see a truncated view with no indication data is missing. | MEDIUM | `convex/extraction/queries.ts:294` uses `.take(100)`. Replace with `.paginate()` using Convex cursor-based pagination. Client must adopt `usePaginatedQuery` hook. The `getJobResultsPaginated` query already exists as a pattern to follow. |
| 3 | **Diff truncation notification (1,000-entry silent cap)** | Run diffs silently drop changes beyond 1,000 entries. Users see incomplete diffs with no warning. | LOW | `convex/extraction/mutations.ts:956` does `changes.slice(0, 1000)`. Store `totalChanges` count alongside truncated array. Return `isTruncated: true` flag to client. |
| 4 | **Migrate deprecated `apiKey` field + remove fallback code** | Plaintext Zotero API keys in DB. A database leak exposes them. Dual-read fallback code adds maintenance burden. | MEDIUM | Schema at `convex/schema.ts:175`, fallback reads in `convex/zotero/actions.ts:42`, `convex/extraction/workpoolActions.ts:760`. Requires one-time migration action to encrypt all plaintext keys, then remove `apiKey` field from schema and all fallback paths. |
| 5 | **User data cleanup on deletion (GDPR pattern)** | Deleted users' extraction jobs, papers, results, evidence units, and Zotero connections persist forever. Storage costs accumulate; encrypted keys linger. | MEDIUM | `convex/maintenance/mutations.ts:11-55` only deletes API keys. Must extend to schedule `deleteExtractionInternal` for each of the user's jobs (reusing existing cascade delete), plus delete `zoteroConnections`. The existing `cleanupDeletedUsers` already batches with `BATCH_SIZE=50` and self-schedules. |
| 6 | **Orphan diff cleanup on baseline job deletion** | Deleting a baseline job leaves `extractionRunDiffs` rows with dangling `baselineJobId` references. Diff queries return null for the baseline. | LOW | `convex/extraction/mutations.ts:1086-1096` explicitly skips diffs where `baselineJobId == args.jobId`. Add a step to also delete those diffs, or add a guard in the diff query to handle missing baselines gracefully. |
| 7 | **Replace placeholder email in User-Agent** | OpenAlex deprioritizes requests with undeliverable polite-pool emails. May cause rate limiting. | LOW | Single line in `convex/extraction/actions.ts:138`. Replace `admin@example.com` with a real operational email. |
| 8 | **Remove `/test-sidebar` test page** | Test scaffold accessible in production. No auth check. Low risk (no sensitive data), but unprofessional. | LOW | Delete `app/test-sidebar/page.tsx`. |

### Differentiators (Quality Improvements -- From Good to Excellent)

These make the codebase measurably more robust and maintainable. Not user-facing breakage, but engineering quality that prevents future bugs.

| # | Fix | Value Proposition | Complexity | Existing Code Dependency |
|---|-----|-------------------|------------|--------------------------|
| 9 | **Typed return validators replacing `v.any()`** | Runtime type enforcement on query responses. Currently, 7+ queries return `v.any()` for `job`, `questions`, `papers`, `summary`, `diagnostics` fields -- clients receive unvalidated data with inaccurate TypeScript types. | HIGH | 7 query functions in `convex/extraction/queries.ts` (lines 261-263, 328-329, 411-413, 533-536, 668-690, 779-785, 892-893). Must define typed Convex validators matching actual return shapes of `Doc<"extractionJobs">`, `Doc<"extractionQuestions">`, `Doc<"extractionPapers">`, etc. Extract shared validator objects for reuse. Per Convex best practices, use `returns:` when you need runtime enforcement of an exact contract -- which applies here since these are public API queries. |
| 10 | **Type `migrateSearchHistoryState` migration steps** | Prevents silent state corruption from future migration bugs. Currently all 7 migration steps (versions 0-7) use `any` for state and iterators. | LOW | `lib/store.ts:178-282`. Define typed interfaces for each version's input/output shape. At minimum, validate with Zod on read. Pattern: `type V0State = { searchHistory: V0SearchHistoryItem[] }` where each version extends the previous. |
| 11 | **Replace `any` casts in `attachReviewMetadata`** | Type errors in review field access are silently ignored. `Map<string, any>` and `review: any` when `Doc<"extractionResultReviews">` has a known schema. | LOW | `convex/extraction/queries.ts:104-129`. Replace `any` with `Doc<"extractionResultReviews">`. Straightforward substitution. |
| 12 | **Cron cleanup for expired Zotero OAuth tokens** | Abandoned OAuth sessions leave expired rows accumulating. Currently only cleaned up on-read when a user completes the flow. | LOW | `convex/zotero/mutations.ts:42-72` has the 10-minute expiry logic. Add a new cron in `convex/crons.ts` that deletes `zoteroOAuthTokens` where `expiresAt < Date.now()`. Needs an index on `expiresAt` or scan with filter (table is small). |
| 13 | **Document debug endpoint production policy** | `diagnoseJob` and `getFailedPapersDebug` gated by env var. Clear documentation prevents accidental enablement in production. | LOW | `convex/extraction/debug.ts`, `convex/lib/debug_gate.ts`. Add inline docs + verify `ENABLE_PUBLIC_DEBUG_FUNCTIONS` is not set in prod deployment. |

### Anti-Features (Approaches That Seem Good But Create Problems)

| Approach | Why Tempting | Why Problematic | Better Alternative |
|----------|--------------|-----------------|-------------------|
| **Remove `apiKey` field before migrating data** | Faster cleanup -- just delete the column | Convex will not let you remove a field from the schema if data still exists. Existing rows with plaintext keys would cause schema push failure. Users with unmigrated keys lose Zotero access. | Expand-contract: migrate all plaintext keys first, verify zero unmigrated rows, then remove field. |
| **Force-kill in-flight workpool items on cancel** | Immediate stop, no wasted credits | Convex workpool `cancel()` prevents new work from starting but cannot stop in-progress actions. Trying to force-terminate mid-action risks corrupted paper records (partial extraction results). | Cancel workflow + workpool, accept that currently-executing actions complete. Add status-check guard in worker so it skips writing results if job is cancelled. |
| **Add typed validators to ALL queries at once** | Consistency, single PR | HIGH complexity: 7 queries with deeply nested return shapes. A single typo in a validator crashes the query at runtime. Regression risk is high in one large change. | Type validators incrementally per query, test each one with existing integration tests before moving to next. |
| **Use offset-based pagination for getJobDetails** | Simpler mental model, page numbers in URL | Convex does not support offset pagination natively. Offset pagination is inconsistent when data changes (papers added/removed shift pages). | Use Convex's built-in `.paginate()` with cursor-based pagination. The `getJobResultsPaginated` query already demonstrates this pattern. |
| **Store full diff without any cap** | No truncation = complete data | Very large diffs (10K+ changes) hit Convex document size limits (1MB). A single `extractionRunDiffs` document storing all changes can exceed the limit. | Keep a reasonable cap (e.g., 5,000), store `totalChanges` count, return `isTruncated` flag. For truly large diffs, consider paginated diff storage across multiple documents. |
| **GDPR: delete ALL user data immediately** | Maximum compliance | Credits and subscriptions are needed for audit trails and financial reconciliation. Immediate deletion may violate accounting requirements. | Current pattern is correct: 30-day retention, keep credits/subscriptions for audit, delete PII and user-generated content. |

## Feature Dependencies

```
[Migrate plaintext apiKey data]
    └──then──> [Remove apiKey field from schema]
                   └──then──> [Remove fallback code paths]

[Cancel extraction stops workflow]
    └──requires──> [workflow.cancel() + workpool status guard]

[User data cleanup on deletion]
    └──reuses──> [deleteExtractionInternal cascade delete]
    └──reuses──> [cleanupDeletedUsers self-scheduling batch pattern]

[Typed return validators]
    └──enables──> [Remove any casts in attachReviewMetadata]
    (attachReviewMetadata types are subset of the broader query typing)

[getJobDetails pagination]
    └──follows pattern──> [getJobResultsPaginated (already exists)]

[Diff truncation notification]
    └──independent──> (no dependencies)

[Cron OAuth cleanup]
    └──independent──> (add entry to convex/crons.ts)

[Test page removal]
    └──independent──> (delete single file)

[Placeholder email]
    └──independent──> (single line change)

[Debug endpoint docs]
    └──independent──> (documentation only)
```

### Dependency Notes

- **Migrate apiKey requires encrypt-first:** Convex enforces that you cannot remove a field from the schema while any document still has data in that field. The migration action must run and complete before the schema can be updated.
- **User cleanup reuses cascade delete:** The `deleteExtractionInternal` mutation already handles 9-step batched deletion of all extraction child tables. User cleanup just needs to find all jobs for a user and schedule cascade deletes for each.
- **Typed validators enable attachReviewMetadata fix:** Once the query-level validators are typed, the `Map<string, any>` in `attachReviewMetadata` naturally resolves to `Map<string, Doc<"extractionResultReviews">>`.
- **Cancel extraction requires workflow component API:** The `workflow.cancel(ctx, workflowId)` API exists in `@convex-dev/workflow`. It halts the workflow immediately. In-progress `step.runAction()` calls finish. A status-check guard in the workpool worker prevents writing results after cancellation.

## Fix Prioritization Matrix

| # | Fix | User Impact | Implementation Cost | Risk if Deferred | Priority |
|---|-----|-------------|---------------------|------------------|----------|
| 1 | Cancel extraction stops work | HIGH (credits burned) | MEDIUM | HIGH (ongoing credit waste) | P1 |
| 4 | Migrate deprecated apiKey | HIGH (security) | MEDIUM | HIGH (plaintext key exposure) | P1 |
| 5 | User data cleanup (GDPR) | HIGH (compliance) | MEDIUM | HIGH (regulatory risk) | P1 |
| 2 | getJobDetails pagination | MEDIUM (broken UI) | MEDIUM | MEDIUM (>100 paper jobs broken) | P1 |
| 6 | Orphan diff cleanup | LOW (data hygiene) | LOW | LOW (orphan rows accumulate) | P2 |
| 3 | Diff truncation notification | MEDIUM (silent data loss) | LOW | MEDIUM (misleading diffs) | P2 |
| 9 | Typed return validators | MEDIUM (DX + safety) | HIGH | LOW (works but unvalidated) | P2 |
| 12 | Cron OAuth token cleanup | LOW (table bloat) | LOW | LOW (slow accumulation) | P2 |
| 7 | Replace placeholder email | LOW (rate limit risk) | LOW | LOW (works until flagged) | P2 |
| 10 | Type migration steps | LOW (future bug prevention) | LOW | LOW (works but fragile) | P3 |
| 11 | Type attachReviewMetadata | LOW (DX) | LOW | LOW (works but untyped) | P3 |
| 13 | Debug endpoint docs | LOW (operational) | LOW | LOW (already gated) | P3 |
| 8 | Remove test page | LOW (hygiene) | LOW | LOW (no sensitive data) | P3 |

**Priority key:**
- P1: Must fix -- broken behavior, security risk, or compliance gap
- P2: Should fix -- silent data issues, quality improvements, or accumulating debt
- P3: Nice to fix -- typing improvements, documentation, cleanup

## Expected Behavior When Complete

### 1. Cancel Extraction Stops Work
- Calling `cancelExtraction` sets DB status to `cancelled` AND calls `workflow.cancel(ctx, job.workflowId)`
- The Convex workflow halts immediately; no new steps are scheduled
- In-progress actions (currently extracting a paper) finish, but their results are guarded: the workpool worker checks `job.status === "cancelled"` before writing results
- Credits are not deducted for work completed after cancellation
- UI shows cancellation progress (workflow winding down) then final cancelled state

### 2. getJobDetails Returns All Papers via Pagination
- `.take(100)` replaced with `.paginate(paginationOpts)`
- Client uses `usePaginatedQuery` hook for progressive loading
- Pattern matches existing `getJobResultsPaginated` implementation
- Progress calculation uses `job.totalPapers` (already stored) rather than counting fetched papers

### 3. Diff Truncation With User Notification
- `extractionRunDiffs` schema gains `totalChanges: v.number()` and `isTruncated: v.boolean()` fields
- `changes.slice(0, 1000)` remains but `totalChanges` stores the pre-slice count
- UI displays "Showing 1,000 of 3,247 changes" when truncated
- Cap can be raised to 5,000 if Convex document size allows (1MB limit)

### 4. Deprecated apiKey Fully Migrated and Removed
- One-time migration action enumerates all `zoteroConnections` with non-null `apiKey`
- Each plaintext key is encrypted via the existing `crypto.ts` AES-256-GCM module
- `encryptedApiKey` and `keyPrefix` are set; `apiKey` is set to `undefined`
- After migration completes with zero unmigrated rows: `apiKey` field removed from schema
- All `resolveZoteroApiKey` fallback paths removed; only `encryptedApiKey` path remains

### 5. User Data Cleanup Covers Extraction + Zotero
- `cleanupDeletedUsers` extended to:
  - Find all `extractionJobs` for each deleted user
  - Schedule `deleteExtractionInternal` for each job (reusing existing 9-step cascade)
  - Delete all `zoteroConnections` for the user
- 30-day retention period preserved (existing)
- Credits and subscriptions preserved for audit (existing decision)
- Self-scheduling batch pattern preserved for large datasets

### 6. Orphan Diffs Cleaned on Baseline Deletion
- `deleteExtractionInternal` Step 8 expanded: also delete diffs where `baselineJobId == args.jobId`
- Requires new index `by_baseline_job` on `extractionRunDiffs` table, or scan with filter (table is typically small per-user)
- Alternatively: diff query returns graceful "baseline deleted" message instead of null reference

### 7. Real Email in User-Agent
- `admin@example.com` replaced with actual operational email
- Email stored as environment variable (not hardcoded) for easy rotation

### 8. Test Page Removed
- `app/test-sidebar/page.tsx` deleted
- No route exists at `/test-sidebar`

### 9. Typed Return Validators
- Each of the 7 extraction queries gets proper typed `returns:` validators
- Shared validator objects extracted: `jobValidator`, `questionValidator`, `paperValidator`, etc.
- `v.any()` eliminated from all public query return types
- Runtime type enforcement catches server/client mismatches
- TypeScript types on client side become accurate (no more `any`)

### 10. Typed Migration Steps
- `migrateSearchHistoryState` gets typed interfaces per version
- `V0State`, `V1State`, ... `V7State` types defined
- Each migration step: `(state: VNState) => VN1State`
- Optional: Zod validation on read for extra safety

### 11. Typed attachReviewMetadata
- `Map<string, any>` becomes `Map<string, Doc<"extractionResultReviews">>`
- `review: any` becomes `review: Doc<"extractionResultReviews">`
- No functional change, purely type safety

### 12. Cron Cleans Expired OAuth Tokens
- New cron entry in `convex/crons.ts`: runs daily (or hourly)
- Deletes `zoteroOAuthTokens` where `expiresAt < Date.now()`
- Batch-limited to prevent transaction limit violations
- Tokens expire after 10 minutes, so even daily cleanup keeps table small

### 13. Debug Endpoint Policy Documented
- Inline JSDoc on `diagnoseJob` and `getFailedPapersDebug` states: "Staging only. ENABLE_PUBLIC_DEBUG_FUNCTIONS must not be set in production."
- Deployment checklist or README section confirms production policy

## Recommended Phase Structure

Based on dependencies and risk:

### Phase A: Security + Compliance (P1 items with data implications)
1. Migrate deprecated apiKey (must complete before schema change)
2. User data cleanup on deletion (GDPR)
3. Cancel extraction stops work (credit protection)

### Phase B: Data Integrity Fixes (P1-P2 bug fixes)
4. getJobDetails pagination
5. Orphan diff cleanup
6. Diff truncation notification

### Phase C: Type Safety Sweep (P2-P3 typing improvements)
7. Typed return validators (largest single item)
8. Type attachReviewMetadata (subset of above)
9. Type migration steps

### Phase D: Cleanup (P2-P3 quick wins)
10. Cron OAuth token cleanup
11. Replace placeholder email
12. Remove test page
13. Document debug endpoint policy

**Rationale:** Security and compliance fixes first because they carry the highest risk of harm. Data integrity fixes second because they affect user-visible behavior. Type safety sweep third because it is the highest-effort item but lowest risk. Quick cleanup last because each is independent and low-risk.

## Sources

- [Convex: When to and when not to use return validators](https://stack.convex.dev/when-to-and-when-not-to-use-return-validators) -- guidance on `v.any()` vs typed validators
- [Convex: Intro to Migrations](https://stack.convex.dev/intro-to-migrations) -- expand-contract pattern for field removal
- [Convex: Queries that scale](https://stack.convex.dev/queries-that-scale) -- replacing `.collect()` and `.take()` with pagination
- [Convex: Paginated Queries](https://docs.convex.dev/database/pagination) -- `.paginate()` API and cursor-based pagination
- [Convex Workflow component](https://www.convex.dev/components/workflow) -- `workflow.cancel()` API, in-progress actions finish
- [Convex Workpool component](https://www.convex.dev/components/workpool) -- `pool.cancel()` / `pool.cancelAll()`, cannot stop in-progress work
- [Convex: Argument and Return Value Validation](https://docs.convex.dev/functions/validation) -- typed validator best practices
- [Convex: Best Practices](https://docs.convex.dev/understanding/best-practices/) -- general Convex patterns
- [Zero-downtime database migrations](https://drcodes.com/posts/zero-downtime-database-migrations-essential-patterns) -- expand-contract pattern
- [GDPR Database Compliance Guide 2025](https://sqlcheat.com/blog/database-compliance-gdpr-2025/) -- cascade deletion, retention periods
- [Cascading Deletes in MongoDB](https://medium.com/@mail_99211/cascading-deletes-in-mongodb-5-proven-patterns-to-achieve-rdbms-style-integrity-c8c55ef7eea9) -- trigger-based cascade patterns for document DBs

---
*Feature research for: v2.4 Concerns Sweep*
*Researched: 2026-03-02*
