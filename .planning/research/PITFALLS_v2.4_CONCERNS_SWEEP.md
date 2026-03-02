# Pitfalls Research: v2.4 Concerns Sweep

**Domain:** Fixing 13 codebase concerns in a Convex + Next.js academic search platform
**Researched:** 2026-03-02
**Confidence:** HIGH (verified against Convex docs, codebase inspection, and official component docs)

## Critical Pitfalls

### Pitfall 1: Removing `apiKey` field before migrating all plaintext data

**What goes wrong:**
Convex schema validation runs on `npx convex deploy`. If you remove the `apiKey` field from the `zoteroConnections` table definition while any document still has that field populated, the deployment fails. The schema push is rejected because existing documents do not match the new schema. Worse: if you make `apiKey` optional and then run a migration that sets it to `undefined` but the migration only completes partially (e.g., hits Convex's 10-minute action timeout on a large dataset), you end up in a split state where some documents are migrated and others are not, and the schema cannot be tightened.

**Why it happens:**
Developers conflate "marking optional in schema" with "safe to remove." The Convex schema validator checks ALL existing documents at deploy time. The three-step process (make optional, migrate data, remove field) feels like overkill for a single field, so developers skip the middle step or combine steps in a single deploy.

**How to avoid:**
1. Schema: Ensure `apiKey` is already `v.optional(v.string())` (it is -- line 175 of schema.ts).
2. Migration: Write a one-time internal action that reads all `zoteroConnections` with a non-null `apiKey`, encrypts each to `encryptedApiKey`, and patches `apiKey` to `undefined`. Use batched processing with `ctx.scheduler.runAfter(0)` for large datasets, same pattern as `deleteExtractionInternal`.
3. Verify: Query for any remaining docs with `apiKey !== undefined`. Only when count is 0, remove the field from the schema.
4. Deploy: Push the schema change only after migration is verified complete.
5. Clean up: Remove all dual-read fallback code in `resolveZoteroApiKey`.

**Warning signs:**
- `npx convex deploy` fails with schema validation error mentioning `apiKey`
- Dual-read fallback code still exists after "migration complete" is declared
- No verification query was run before removing the field

**Phase to address:** First phase -- this is a data safety concern and blocks clean schema evolution for everything else.

---

### Pitfall 2: Cancelling extraction workflow without stopping in-flight workpool actions (credit leak)

**What goes wrong:**
The current `cancelExtraction` sets `status: "cancelled"` in the database but never calls `workflow.cancel()`. Even after adding `workflow.cancel()`, the Convex workflow component explicitly states: "In-progress calls to `step.runAction()` will finish executing." And the workpool component states: cancellation "will not stop in-progress work." This means papers already being processed will complete, call `deductCredits`, and charge the user after they clicked cancel. The user sees "cancelled" but their credits keep decreasing.

**Why it happens:**
The word "cancel" implies immediate halt, but distributed systems do not support instant cancellation of in-flight work. The developer adds `workflow.cancel()` and assumes the job stops. They do not account for the gap between "cancel requested" and "all in-flight actions drain."

**How to avoid:**
1. Call `workflow.cancel(ctx, job.workflowId)` to prevent NEW steps from starting.
2. In each workpool action handler (e.g., `processExtractionPaper`), add a guard at the start: re-read the job status, and if `cancelled`, return early WITHOUT calling `deductCredits`.
3. Add the same guard BEFORE the `deductCredits` call, not just at the top of the function. An action can be long-running; the job might be cancelled mid-execution.
4. Accept that some credits may be deducted for work that completes between cancel-click and guard-check. Document this as expected behavior ("credits for in-progress work are non-refundable") or implement a post-cancel credit reconciliation that refunds credits for papers processed after the cancel timestamp.

**Warning signs:**
- Credit transactions appearing with timestamps AFTER the job's `updatedAt` (cancel timestamp)
- Job status is "cancelled" but paper statuses still transitioning to "completed"
- User complaints about credit loss after cancellation

**Phase to address:** Second phase -- requires careful testing with in-flight work, separate from the simple schema migration work.

---

### Pitfall 3: Adding typed return validators to queries that return shapes inconsistent with actual data

**What goes wrong:**
Convex return validators enforce at runtime. If you replace `v.any()` with a typed validator on `getJobDetails`, `getJobResults`, or `getJobInsights`, and the actual data in the database has a field that is not in the validator (or is missing a required field), the query throws a runtime error for ALL users hitting that query. This is not a compile-time check -- it is a production runtime crash. The Convex docs confirm: "object validators don't allow extra properties, so returning extra fields will fail validation at runtime."

**Why it happens:**
Developers write validators matching the TypeScript types or the schema definition, but forget that:
- Old documents may have extra fields from before a schema change
- Optional fields may be absent on old documents but required in the new validator
- Computed/derived fields added in the query handler may not match the validator exactly
- The `attachReviewMetadata` helper returns dynamically shaped objects that vary based on whether reviews exist

**How to avoid:**
1. Before writing any return validator, query production data and inspect the actual shapes. Look for documents created before schema changes.
2. Use `v.optional()` for any field that might not exist on older documents.
3. Test validators against real production data snapshots, not just test data.
4. Deploy validators incrementally: one query at a time, with monitoring. Do not batch all 7+ query validator changes into a single deploy.
5. Consider the Convex team's own advice: return validators are most valuable for public API contracts and codegen. For internal queries, TypeScript inference may be sufficient. Apply validators selectively where runtime enforcement matters.

**Warning signs:**
- Query errors in Convex dashboard logs immediately after deploy
- Client-side "unexpected error" toasts on pages that were working before
- Validators that use `v.object()` without `v.optional()` on fields that were added after initial data creation

**Phase to address:** Middle phase -- requires careful audit of existing data shapes before implementation.

---

### Pitfall 4: Deleting user extraction data without preserving billing audit trail

**What goes wrong:**
`cleanupDeletedUsers` currently keeps credits and subscriptions "for audit purposes" (line 41) but the proposed fix extends it to delete extraction jobs, papers, results, and evidence units. If extraction data is deleted but `creditTransactions` reference those jobs by `jobId` in their metadata, the audit trail becomes orphaned. You can see that credits were deducted but cannot trace back to WHAT was processed. For GDPR, you must delete personal data, but billing records often have legitimate legal basis for retention.

**Why it happens:**
The developer extends `cleanupDeletedUsers` to "delete everything" without distinguishing between personal data (which GDPR requires deletion of) and transactional records (which tax/accounting law may require retention of). The cascade delete function `deleteExtractionInternal` is designed for user-initiated deletion, not compliance deletion -- it does not preserve any audit records.

**How to avoid:**
1. Distinguish between personal data and transactional metadata. User's extracted content, paper texts, and question answers = personal data, delete these. Credit transaction records with amounts and timestamps = financial records, keep these.
2. When deleting extraction jobs, first anonymize the `creditTransactions` metadata: replace `userId` with a hash or tombstone marker, keep `amount`, `description`, and `billingType` for financial audit.
3. Delete the `zoteroConnections` (and encrypted keys) for the user -- these are personal data with no audit value.
4. Add a `deletionReason` field to the cleanup log: "user_deletion_gdpr" vs "user_requested" to distinguish compliance from voluntary deletion.
5. Do NOT hard-delete the user record immediately if you need to cascade-delete their extraction data first. The cascade delete is async (scheduler-based), so the user record must survive long enough for all child deletions to complete.

**Warning signs:**
- `creditTransactions` with metadata referencing non-existent `jobId`s after cleanup
- User record deleted before cascade deletion of extraction data completes (orphaned extraction data that will never be cleaned up because the `userId` index no longer matches a deleted user)
- No log of what was deleted and why

**Phase to address:** Second or third phase -- depends on cascade delete fix being done first. Must be designed alongside the `runDiff` orphan fix.

---

### Pitfall 5: Feature flag renaming breaks production environment variables

**What goes wrong:**
Renaming `NEXT_PUBLIC_EXTRACTION_ENABLED` to `EXTRACTION_ENABLED` in Convex code requires updating the Convex deployment environment variables. If the code deploys before the environment variable is set in the Convex dashboard (or if someone forgets to update the variable name in the dashboard), the feature flag check reads `undefined` instead of `"false"`, which means the feature becomes ENABLED when it was supposed to be disabled. The current guard pattern (`=== "false"`) means any non-`"false"` value (including `undefined`) enables the feature.

**Why it happens:**
Environment variable renames require coordinated changes across two systems: the codebase and the Convex deployment dashboard. There is no compile-time or deploy-time check that all referenced environment variables exist. The "default open" pattern (`!== "false"`) is safe for features that should be enabled by default, but dangerous when renaming because the old variable is gone and the new one is not yet set.

**How to avoid:**
1. Add both old AND new variable names during the transition. Check `process.env.EXTRACTION_ENABLED ?? process.env.NEXT_PUBLIC_EXTRACTION_ENABLED` in the guard function.
2. After confirming the new variable is set in all environments (dev, staging, prod), remove the old variable fallback in a subsequent deploy.
3. For critical guards (extraction, credits, subscriptions), consider a "default closed" pattern: `!== "true"` instead of `!== "false"`. This means a missing variable DISABLES the feature rather than enabling it.
4. Add a startup check in the Convex module that logs warnings for any expected environment variables that are undefined.

**Warning signs:**
- Features become unexpectedly available after a deploy
- `process.env.NEW_NAME` returns `undefined` in Convex logs
- Feature flag tests pass locally (where `.env` is up to date) but fail in deployed environments

**Phase to address:** Late phase -- low risk if done carefully, but high impact if done wrong. Pair with centralizing all feature flag reads into a single registry.

---

### Pitfall 6: Changing `getJobResultsPaginated` return shape breaks existing UI pagination

**What goes wrong:**
The current `getJobResultsPaginated` uses `paginatedAnyResultValidator` (line 172: `paginationResultValidator(v.any())`). If you replace `v.any()` with a typed validator, the return shape must include all fields the UI currently reads. But the real trap is subtler: if you change how `page` items are structured (e.g., flattening nested objects, renaming fields, changing array shapes), the client's `usePaginatedQuery` hook will receive data that does not match the component's expectations, causing silent rendering failures or crashes.

**Why it happens:**
Pagination validators are coupled to both the server return shape AND the client consumption pattern. Unlike regular queries where you can inspect the TypeScript type, paginated queries have their shape determined by the intersection of the validator, the query handler, and the `usePaginatedQuery` hook's generic type parameter. Changing the server-side shape without updating all client consumers causes breakage that is not caught by `npx convex typecheck`.

**How to avoid:**
1. Before changing any paginated query validator, grep for ALL client-side usages of that query name and document the fields they access.
2. Make the validator match the CURRENT return shape exactly. Do not "clean up" the shape at the same time as adding type safety.
3. If shape changes are needed, make them in a separate phase after the typed validator is stable.
4. Test paginated queries end-to-end in the browser, not just with unit tests. Pagination state (continueCursor, isDone) is especially fragile.

**Warning signs:**
- Extraction job detail page shows empty paper list after deploy
- "Cannot read property of undefined" errors in browser console on paginated views
- Paginated queries return data but the UI renders blank rows

**Phase to address:** Same phase as typed validator migration -- these are the same concern.

---

### Pitfall 7: Silent truncation fix changes the API response shape

**What goes wrong:**
The `extractionRunDiffs.changes` field silently truncates at 1,000 entries (line 956 of mutations.ts). A fix might: (a) remove the truncation, (b) add pagination, or (c) add a `truncated: boolean` or `totalChanges: number` field to the response. Options (a) and (c) change the stored document shape, which means the schema must be updated. Option (c) adds new fields that old clients do not expect, and option (a) could cause the stored document to exceed Convex's 1MB document size limit for very large diffs.

**Why it happens:**
The developer fixes the truncation by removing `.slice(0, 1000)` without considering that:
- A diff with 50,000 changes would create a document exceeding Convex's size limits
- Existing diffs in the database do NOT have a `truncated` field, so any code checking that field will get `undefined`
- Clients consuming `changes` may have been implicitly relying on the array being "small enough" for in-memory processing

**How to avoid:**
1. Keep the truncation but make it explicit: add `totalChanges: number` and `isTruncated: boolean` fields to the schema and the insertion.
2. Schema: Add both fields as `v.optional()` so old diffs without them are still valid.
3. Client: Check for `isTruncated` defensively: `diff.isTruncated ?? (diff.changes.length >= 1000)` to handle both old and new documents.
4. Consider whether the 1,000 limit is actually too low. Most diffs under 200 papers should have fewer than 1,000 changes. Raise to 5,000 or 10,000 if the document size allows it, but always have a limit.

**Warning signs:**
- Schema push fails because old diffs lack new required fields
- Diff view shows "no truncation" for old diffs that were actually truncated
- Convex "document too large" errors for jobs comparing two large extraction runs

**Phase to address:** Middle phase -- relatively low risk, but must coordinate with any typed validator changes on the same queries.

---

### Pitfall 8: Cron cleanup job runs concurrently with user-triggered deletion

**What goes wrong:**
Adding a new cron for Zotero OAuth token cleanup and extending `cleanupDeletedUsers` to delete extraction data introduces a concurrency scenario: the cron fires `cleanupDeletedUsers`, which schedules cascade deletion via `deleteExtractionInternal`. Simultaneously, a user (or admin) triggers manual deletion of the same extraction job. Both the cron path and the manual path attempt to delete the same child records. In Convex, this is safe at the mutation level (OCC ensures no double-delete crashes), but the cascade delete's self-scheduling pattern means Step 3 might run from the cron while Step 5 runs from the manual trigger, causing interleaved deletion that skips some child tables.

**Why it happens:**
Convex crons guarantee at most one cron instance runs at a time, but they do NOT prevent a cron-triggered mutation from running concurrently with a user-triggered mutation that does the same work. The cascade delete assumes it is the only process deleting a given job's data.

**How to avoid:**
1. Before starting cascade deletion, set a `deletionStatus: "deleting"` field on the extraction job. If the field is already "deleting", skip (another process is handling it).
2. Use this as a lightweight lock: the first writer wins via OCC.
3. For the Zotero OAuth token cleanup cron, this is simpler: the cron deletes expired tokens. If a token is already deleted by the OAuth completion handler, the `ctx.db.delete()` call on a non-existent ID will throw. Wrap individual deletes in try-catch or check existence first.
4. For `cleanupDeletedUsers`, check that the user still exists and is still in "deleted" state at the start of each batch. A concurrent process might have already cleaned them up.

**Warning signs:**
- Convex function errors like "Document not found" during cascade delete steps
- Partially deleted extraction jobs (some child tables cleaned, others not)
- Cron job taking much longer than expected due to OCC retries from concurrent mutations

**Phase to address:** Same phase as the cron cleanup additions -- must be considered when extending `cleanupDeletedUsers`.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Removing `apiKey` field without migration | One less field in schema | Plaintext keys survive in DB, deployment failure when schema validation catches lingering data | Never -- always run migration first |
| Adding `workflow.cancel()` without workpool drain | "Cancel works now" | Credits still deducted, user trust eroded | Never -- cancel must stop credit drain |
| Batch-replacing all `v.any()` validators in one deploy | "All queries typed now" | One wrong validator crashes all queries using that shape | Only acceptable if every validator is tested against real data |
| Extending cleanup to hard-delete all user data | GDPR compliance checkbox | Lost billing audit trail, orphaned credit references | Never -- always separate personal data from financial records |
| Renaming env vars without transition period | Clean naming | Feature flags break in environments with old variable names | Only acceptable in single-environment projects (not this one) |
| Removing truncation without adding a size limit | "No more silent data loss" | Potential 1MB document size limit breach | Never -- always have a limit, just make it explicit |

## Integration Gotchas

Common mistakes when connecting to external services or internal systems.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Convex schema push | Removing a field from schema before clearing all data in that field | Make optional, migrate data to `undefined`, verify zero remaining, then remove field |
| Convex workflow.cancel() | Assuming cancel stops all work immediately | Cancel prevents new steps; in-progress actions still complete. Add status checks inside action handlers |
| Convex workpool.cancel() / cancelAll() | Expecting in-progress items to abort | Cancellation only prevents pending items from starting. In-progress items run to completion |
| Convex return validators | Adding strict `v.object()` validators to queries with heterogeneous historical data | Audit actual stored data shapes first; use `v.optional()` for any field that might be absent on old docs |
| Convex cron + manual trigger | Assuming cron-scheduled mutations are the only ones modifying data | Use optimistic locking (status field) to prevent concurrent cascade deletions from interleaving |
| Convex environment variables | Renaming variables in code without updating the Convex dashboard | Use fallback chain during transition; deploy dashboard change before or simultaneously with code change |
| Stripe creditTransactions audit | Deleting all data for a user including financial records | Anonymize financial records (replace userId with tombstone) rather than deleting them |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Removing `.take(100)` from `getJobDetails` without adding pagination | Query returns all 200+ papers in a single response | Replace `.take(100)` with proper pagination, not unbounded `.collect()` | Jobs with 200+ papers (already hitting this limit) |
| Removing `.slice(0, 1000)` from diff changes without size guard | Document exceeds 1MB Convex limit | Keep a limit (5,000-10,000), add `isTruncated` flag | Jobs comparing two 200-paper runs with many questions |
| `cleanupDeletedUsers` scheduling cascade deletion for N users in one batch | N concurrent cascade deletes, each self-scheduling 9 steps | Limit concurrent cascade deletes (e.g., process 5 users per cron run, re-schedule if more remain) | 50+ deleted users processed in one cron tick |
| Typed return validators on hot-path queries | CPU overhead from runtime validation on every query response | Use validators on public API boundaries; skip for internal-only queries or use TypeScript types | High-traffic queries with complex return shapes |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Leaving plaintext `apiKey` values in DB after migration | Database breach exposes Zotero API keys | Run migration, verify zero plaintext keys remain, alert on any new plaintext writes |
| Feature flag rename creates "default open" window | Extraction/credits features enabled for all users when env var is missing | Use "default closed" pattern for security-critical flags; test with undefined env vars |
| Hard-deleting user record before cascade deleting their data | Extraction data orphaned forever (userId index broken) | Delete user record LAST, after all child data is confirmed deleted |
| Keeping encrypted Zotero keys after user deletion | Unnecessary data retention; encrypted keys are still personal data | Delete `zoteroConnections` during user cleanup, not just `apiKeys` |
| Debug endpoint policy not enforced by deploy pipeline | `ENABLE_PUBLIC_DEBUG_FUNCTIONS` accidentally left as `"true"` in production | Add a CI check or deploy hook that asserts this variable is `"false"` in production |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Cancel button says "cancelled" but work continues | User sees credits decreasing after cancel, loses trust | Show "cancelling..." state, then "cancelled (N papers completed during cancellation)" |
| Removing 100-paper cap with unbounded query | Job detail page becomes slow/unresponsive for large jobs | Replace with paginated view: show first 50, load more on demand |
| Adding `isTruncated` to diffs without UI indication | User compares runs and sees complete diff that is actually partial | Show a banner: "Showing first N of M changes" when truncated |
| Typed validators crash query on old data | User opens an old extraction job and gets a blank error page | Test validators against oldest data in DB; handle gracefully with fallback |
| Changing pagination response shape | Existing browser tabs with cached pagination state break | Ensure backward compatibility or force-refresh stale pagination cursors |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **apiKey migration:** Query `zoteroConnections` for any `apiKey !== undefined` after migration -- verify count is 0 before removing field from schema
- [ ] **cancelExtraction:** Verify that `deductCredits` is NOT called for papers processed after cancel timestamp -- check `creditTransactions` timestamps vs job cancel time
- [ ] **Typed validators:** Test every changed query against production data snapshot, not just seed data -- old documents may have extra/missing fields
- [ ] **User data cleanup:** Confirm `creditTransactions` still have enough metadata for financial audit after user deletion -- check that `billingType` and `amount` survive
- [ ] **Cron cleanup:** Verify the new Zotero OAuth token cron does not error on already-deleted tokens -- test with empty table and with expired-but-already-cleared tokens
- [ ] **Feature flag rename:** After deploying renamed flags, verify each flag reads correctly in each environment (dev, staging, prod) -- check Convex dashboard env vars match new names
- [ ] **Diff truncation fix:** Verify new `isTruncated`/`totalChanges` fields are `v.optional()` and existing diffs without those fields still render correctly
- [ ] **getJobDetails pagination:** Verify the job detail UI handles both the old `.take(100)` response shape and the new paginated shape during rollout
- [ ] **runDiff orphan fix:** After deleting a baseline job, verify that no `extractionRunDiffs` reference it as `baselineJobId` -- query the index
- [ ] **test-sidebar removal:** Verify `/test-sidebar` returns 404 after removal, not a Next.js error page
- [ ] **OpenAlex User-Agent:** Verify the new email is deliverable -- OpenAlex may verify polite pool emails
- [ ] **Debug endpoint policy:** Verify `ENABLE_PUBLIC_DEBUG_FUNCTIONS` is `"false"` in production Convex environment after deploy
- [ ] **migrateSearchHistoryState types:** Run the typed migration function against persisted localStorage from real users (different browser versions, different app versions) -- not just the test fixtures

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Schema push rejected (apiKey still has data) | LOW | Run migration action manually, verify, re-deploy |
| Credits deducted after cancel | MEDIUM | Write a one-time reconciliation action: find credit transactions for the job after cancel timestamp, issue refund credits |
| Typed validator crashes production query | HIGH | Immediate rollback deploy reverting validators to `v.any()`. Then audit data, fix validators, re-deploy |
| User data deleted including financial audit trail | HIGH | Restore from Convex backup (if available). If not, financial records are permanently lost. This is why you anonymize instead of deleting |
| Feature flag rename enables feature in production | MEDIUM | Set the new variable name in Convex dashboard immediately. Downtime is measured in minutes if caught quickly |
| Diff truncation removed, documents exceed 1MB | MEDIUM | The insert will fail with a Convex error, so data is not corrupted. Re-add the limit, deploy, and re-generate the affected diffs |
| Concurrent cascade deletes leave orphaned records | LOW | Re-run `cleanupDeletedUsers` -- the orphaned records will be picked up in the next pass since the parent is already deleted |
| Cron fires during manual deletion | LOW | OCC handles individual mutation conflicts gracefully. At worst, some steps retry. No data corruption |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| apiKey field removal data loss | Phase 1 (Schema + Migration) | Zero-count query on `apiKey` field before schema push |
| Workflow cancel credit leak | Phase 2 (Workflow Fixes) | Test: cancel mid-extraction, verify no credit transactions after cancel timestamp |
| Typed validator runtime crash | Phase 3 (Type Safety) | Deploy one query at a time, monitor Convex logs for 30 min after each |
| User data deletion audit trail loss | Phase 2 (Workflow Fixes) or Phase 4 (Cleanup) | Verify `creditTransactions` metadata intact after user cleanup |
| Feature flag rename breaks production | Phase 5 (Polish) | Verify env vars in all environments before removing old names |
| Pagination shape breaks UI | Phase 3 (Type Safety) | E2E test of extraction job detail page with >100 papers |
| Silent truncation fix shape change | Phase 3 (Type Safety) | Old diffs render correctly with new UI code |
| Cron concurrent with manual delete | Phase 4 (Cleanup) | Trigger manual delete during cron window, verify no errors |
| runDiff orphan on baseline delete | Phase 2 (Workflow Fixes) | Delete a baseline job, query diffs by baselineJobId, verify count is 0 |
| Debug endpoint in production | Phase 5 (Polish) | CI assertion that `ENABLE_PUBLIC_DEBUG_FUNCTIONS !== "true"` in prod |
| test-sidebar page in production | Phase 1 (Schema + Migration) | HTTP request to `/test-sidebar` returns 404 |
| OpenAlex placeholder email | Phase 1 (Schema + Migration) | Verify User-Agent string in OpenAlex API response headers |
| migrateSearchHistoryState any types | Phase 3 (Type Safety) | Typed migration passes against real localStorage samples |

## Recommended Phase Order Based on Pitfall Severity

1. **Phase 1: Safe Schema + Quick Wins** -- apiKey migration, test-sidebar removal, OpenAlex email fix. These are the lowest-risk fixes that unblock everything else. The apiKey migration MUST happen first because the schema change gates all other schema work.

2. **Phase 2: Workflow + Deletion Fixes** -- cancelExtraction workflow stop, runDiff orphan fix, user data cleanup extension. These are interconnected: the cascade delete pattern is shared, and the credit-leak fix must land before user deletion changes.

3. **Phase 3: Type Safety** -- v.any() validator replacements, migrateSearchHistoryState typing, attachReviewMetadata typing, getJobDetails 100-paper cap fix, diff truncation fix. These require careful data auditing and should be deployed incrementally.

4. **Phase 4: Cron + Cleanup** -- Zotero OAuth token cron, concurrent deletion guards. Depends on Phase 2 deletion patterns being stable.

5. **Phase 5: Environment + Polish** -- Feature flag renaming, debug endpoint documentation, Stripe client consolidation. Lowest risk, but requires coordinated environment variable changes.

## Sources

- [Convex Intro to Migrations](https://stack.convex.dev/intro-to-migrations) -- schema field removal ordering (HIGH confidence)
- [Convex Schemas Documentation](https://docs.convex.dev/database/schemas) -- schema validation at deploy time (HIGH confidence)
- [Convex When to Use Return Validators](https://stack.convex.dev/when-to-and-when-not-to-use-return-validators) -- runtime validator enforcement, extra fields cause failures (HIGH confidence)
- [Convex Workflow Component](https://www.convex.dev/components/workflow) -- `workflow.cancel()` does not stop in-progress actions (HIGH confidence)
- [Convex Workpool Component](https://www.convex.dev/components/workpool) -- cancellation does not stop in-progress work (HIGH confidence)
- [Convex Cron Jobs Documentation](https://docs.convex.dev/scheduling/cron-jobs) -- at most one cron instance runs at a time, skips if previous is still executing (HIGH confidence)
- [GDPR Right to Erasure](https://www.reform.app/blog/right-to-erasure-gdpr-compliance-steps) -- audit trail preservation requirements (MEDIUM confidence)
- [GDPR Data Retention Best Practices](https://usercentrics.com/knowledge-hub/gdpr-data-retention/) -- financial records exemption from deletion (MEDIUM confidence)
- Codebase inspection of `convex/extraction/mutations.ts`, `convex/schema.ts`, `convex/credits/internal.ts`, `convex/maintenance/mutations.ts`, `convex/lib/featureFlags.ts`, `convex/extraction/guard.ts` (HIGH confidence)

---
*Pitfalls research for: v2.4 Concerns Sweep -- fixing 13 codebase concerns in OpenAlex Count*
*Researched: 2026-03-02*
