# Project Research Summary

**Project:** OpenAlex Count — v2.4 Concerns Sweep
**Domain:** Codebase hardening — 13 targeted fixes across security, data integrity, and type safety in a Convex + Next.js academic extraction platform
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

The v2.4 Concerns Sweep is a maintenance milestone, not a greenfield build. All 13 items are fixes to existing, deployed code. The research confirms that every fix can be implemented using APIs already available in installed packages — zero new runtime dependencies are required. The existing codebase already contains the patterns needed for each fix: batched self-scheduling cascade deletes, workflow/workpool component APIs, cursor-based pagination, and Convex validator primitives. The work is primarily about correctly wiring together systems that are already present but incompletely connected.

The recommended approach is to work in five phases ordered by risk and dependency. Security and compliance concerns come first because they carry the highest harm potential: plaintext API keys in the database and incomplete user data deletion are both live risks with regulatory exposure. Workflow and deletion integrity fixes come second, because the cascade delete pattern underpins several other fixes and must be correct before downstream work builds on it. The type safety sweep (replacing `v.any()` validators) comes third because it is the highest-effort item but lowest urgency — the queries work today, they are just unvalidated. Cron additions and environment polish come last because they are purely additive and low-risk.

The single biggest risk in this milestone is not implementation complexity but deployment ordering. Three concerns require coordinated multi-step deploys where data must be migrated before schema changes are pushed. Skipping the verification step between deploys is the most likely failure mode. The pitfalls research is emphatic: the Zotero `apiKey` field cannot be removed from the schema until a query confirms zero documents still carry the field. Similarly, typed return validators must be deployed one query at a time with monitoring, because a single incorrect validator crashes all callers of that query in production.

## Key Findings

### Recommended Stack

The stack is unchanged. Every API needed for the 13 fixes is already installed and verified against `node_modules` source. `@convex-dev/workflow@0.3.4` exposes `workflow.cancel(ctx, workflowId)` which accepts `RunMutationCtx` — meaning it can be called directly from the existing `cancelExtraction` mutation without converting to an action. `@convex-dev/workpool@0.3.1` exposes `pdfProcessingPool.cancel(ctx, workId)` for per-paper cancellation. Core Convex `v.*` validators, `.paginate()`, and `crons.interval()` are all already in use elsewhere in the codebase and do not need to be introduced.

The one optional addition (`@convex-dev/migrations`) was evaluated and explicitly rejected. The `zoteroConnections` table is small (one row per user with Zotero connected), making the component's progress-tracking and resumability overkill. A hand-rolled batched mutation following the existing `deleteExtractionInternal` self-scheduling pattern achieves the same result without adding a permanent component dependency to `convex.config.ts`.

**Core technologies (no changes from current):**
- `convex@1.32.0`: All validator primitives, cron APIs, pagination APIs available — no upgrade needed
- `@convex-dev/workflow@0.3.4`: `cancel()` API verified in installed source at `node_modules/@convex-dev/workflow/src/client/index.ts` line 216
- `@convex-dev/workpool@0.3.1`: `cancel()` per workId, `cancelAll()` global — both verified in installed source
- `convex-helpers@0.1.111`: Rate limiting unchanged; no v2.4 interaction

### Expected Features

This milestone is entirely composed of fixes, not new features. The framing from the features research is "what does correctly fixed look like" for each of the 13 concerns.

**Must fix — P1 (broken behavior, security risk, compliance gap):**
- Cancel extraction actually stops workflow and workpool — currently only writes DB status, workflow continues burning credits
- Migrate deprecated plaintext `apiKey` field to `encryptedApiKey` and remove fallback code — live security risk
- Extend user data cleanup to cover extraction jobs and Zotero connections — GDPR compliance gap
- Remove 100-paper cap in `getJobDetails` — broken UI for any extraction job with >100 papers

**Should fix — P2 (silent data issues, quality improvements):**
- Diff truncation notification (`isTruncated` / `totalChanges` fields) — silent data loss today
- Typed return validators replacing `v.any()` in 7 extraction queries — runtime type enforcement
- Orphan diff cleanup when baseline job is deleted — data hygiene, accumulating orphans
- Cron cleanup for expired Zotero OAuth tokens — table bloat, abandoned sessions
- Replace placeholder OpenAlex User-Agent email — rate limit risk

**Nice to fix — P3 (typing, documentation, hygiene):**
- Type `migrateSearchHistoryState` migration steps
- Type `attachReviewMetadata` `any` casts
- Document debug endpoint production policy
- Remove `/test-sidebar` test page

**Anti-features to avoid:**
- Removing `apiKey` field before completing data migration — will break schema push
- Using `pdfProcessingPool.cancelAll()` instead of per-paper cancel — cancels all users' jobs
- Replacing all `v.any()` validators in a single deploy — one wrong validator crashes all consumers
- Hard-deleting all user data including financial records — loses billing audit trail

### Architecture Approach

The fixes integrate into an existing, well-structured Convex + Next.js architecture. The backend is organized into domain modules (`extraction/`, `zotero/`, `maintenance/`) with a clear separation between public API layer (queries/mutations), workflow orchestration, and workpool action execution. Every fix has an identified home: no new architectural patterns are introduced. Two new files will be created (`convex/extraction/validators.ts` for shared typed validators, `convex/zotero/migrations.ts` for the one-time apiKey migration), and one file will be deleted (`app/test-sidebar/page.tsx`). All other changes are modifications to existing files at specific known line numbers.

**Major components and v2.4 touch points:**
1. `convex/extraction/mutations.ts` — `cancelExtraction` (add workflow/workpool stop), `deleteExtractionInternal` (add Step 8b for baseline diffs), `runDiff` (add truncation metadata)
2. `convex/extraction/queries.ts` — replace `v.any()` in 7 return validators, fix `attachReviewMetadata` types, remove `.take(100)` cap
3. `convex/maintenance/mutations.ts` — extend `cleanupDeletedUsers` to cascade-delete extraction data and Zotero connections
4. `convex/crons.ts` — add Zotero OAuth token cleanup cron
5. `convex/schema.ts` — remove deprecated `apiKey` field (after migration), add `truncatedTotal` to `extractionRunDiffs`
6. `convex/extraction/validators.ts` (NEW) — shared typed validator objects for extraction document shapes

**Key constraint on workpool cancellation:** The `pdfProcessingPool` is a shared singleton. `cancelAll()` would cancel pending work across all users' extraction jobs. The correct implementation queries the cancelled job's papers, reads each paper's `workId` via the existing `by_work` index, and calls `pdfProcessingPool.cancel(ctx, workId)` individually. This is bounded by paper count (~200 max) and correct for a multi-tenant system.

### Critical Pitfalls

1. **Schema field removal before data migration** — Convex rejects schema pushes if any document still has the field populated. The three-deploy sequence is mandatory: (1) run migration action to encrypt all plaintext keys and set `apiKey: undefined`, (2) verify zero remaining docs with `apiKey !== undefined`, (3) remove field from schema. Skipping the verification step is the most common failure mode.

2. **Cancel-then-still-deduct-credits** — `workflow.cancel()` prevents new steps from starting but in-progress `step.runAction()` calls finish. Workpool cancellation does not stop running work. Credits will be deducted for papers mid-processing at cancel time. Prevention: add a status-check guard inside the workpool action handler that re-reads job status and returns early (without calling `deductCredits`) if the job is "cancelled". The guard must be placed BEFORE the credit deduction call, not just at function entry.

3. **Typed validator runtime crash on historical data** — Convex return validators enforce at runtime. A validator using strict `v.object()` that does not match the actual shape of old database documents will crash the query for ALL users. Prevention: audit actual stored data shapes before writing validators, use `v.optional()` for any field that might be absent on older documents, and deploy one query at a time with 30-minute monitoring between deploys.

4. **Hard-delete user data including billing audit trail** — The existing `cleanupDeletedUsers` intentionally preserves credits and subscriptions "for audit." Extending the cleanup to delete extraction data must not cascade into `creditTransactions`. Cascade-delete extraction content, delete Zotero connections, but preserve financial records with anonymized user references.

5. **User record deleted before cascade completes** — The cascade delete for extraction data is async (scheduler-based, 9 steps). If the user record is deleted before cascade scheduling completes, orphaned extraction data will never be cleaned (the `userId` index no longer matches). Prevention: schedule all cascade deletes first, delete Zotero connections, then delete the user record last within the same mutation.

## Implications for Roadmap

Based on combined research, five phases are suggested. The ordering follows the dependency chain identified in both FEATURES.md and PITFALLS.md and matches the architectural build order from ARCHITECTURE.md.

### Phase 1: Safe Schema and Quick Wins

**Rationale:** The `apiKey` migration must happen first because it blocks all other schema work — you cannot push any schema changes while the `apiKey` field is still populated. Quick wins (test page removal, OpenAlex email fix) ship alongside to reduce the concern count early. None of these touch extraction pipeline logic, so there is no risk of affecting active users' jobs.

**Delivers:** Plaintext API keys encrypted and removed from schema, dead test route deleted, OpenAlex polite-pool email corrected. Enables subsequent schema changes in later phases.

**Addresses:** Migrate `apiKey` (security P1), remove test page (hygiene P3), fix placeholder email (rate limit P2)

**Avoids:** Pitfall 1 (schema field removal ordering — three deploys required; verify zero remaining plaintext keys before schema push)

**Deployment sequence:** Three sequential deploys required for apiKey migration. All other Phase 1 items can land in the first deploy.

### Phase 2: Workflow and Deletion Integrity

**Rationale:** Workflow cancellation and cascade delete fixes are grouped together because they share the same architectural layer (mutation handlers, workpool interactions) and the cascade delete pattern must be correct before Phase 4 user cleanup extends it. The orphan diff fix extends the cascade delete and is a natural pairing. User data cleanup also lands here because it reuses `deleteExtractionInternal` directly.

**Delivers:** Cancel extraction actually stops processing and protects credits. Deleted baseline jobs no longer leave orphaned diff rows. Deleted users' extraction data is scheduled for cascade deletion during the daily cron. Diff truncation is surfaced to the UI with `isTruncated` and `totalChanges` fields.

**Addresses:** Cancel extraction (credit protection P1), orphan diff cleanup (data hygiene P2), user data cleanup (GDPR P1), diff truncation notification (silent data loss P2)

**Avoids:** Pitfall 2 (credit leak after cancel — requires status guard before `deductCredits` in workpool action), Pitfall 4 (billing audit trail — do not delete `creditTransactions`), Pitfall 5 (user record must be deleted last in cleanup mutation), Pitfall 7 (diff truncation fix must add fields as `v.optional()` for backward compatibility)

**Uses:** `workflow.cancel()` and `pdfProcessingPool.cancel()` per-paper (both already installed), `by_baseline` index (already exists in schema), `by_work` index (already exists in schema)

### Phase 3: Type Safety Sweep

**Rationale:** The type safety work is the highest-effort item (7 queries, shared validator extraction) but lowest urgency — the queries work today. It belongs after Phase 2 because the shared `validators.ts` file benefits from having Phase 2's query logic already correct. This phase requires careful incremental deployment.

**Delivers:** 7 extraction queries with typed `returns:` validators replacing `v.any()`. New `convex/extraction/validators.ts` with shared validator objects. Typed `migrateSearchHistoryState` migration steps. Typed `attachReviewMetadata`. `getJobDetails` 100-paper cap removed (replace `.take(100)` with `.collect()` given the enforced ~200-paper job cap).

**Addresses:** Typed return validators (DX + safety P2), type `attachReviewMetadata` (DX P3), type migration steps (future bug prevention P3), `getJobDetails` pagination fix (broken UI P1)

**Avoids:** Pitfall 3 (validator runtime crash — deploy one query at a time with monitoring, use `v.optional()` for any field absent on older documents), Pitfall 6 (pagination shape change — match current return shape exactly before any cleanup)

**Deployment constraint:** Each query's validator must be deployed independently with a monitoring window. Do not batch all 7 into one PR merge.

### Phase 4: Cron Additions and Concurrent Deletion Guards

**Rationale:** Cron additions are purely additive and do not affect existing jobs. They land after Phase 2's deletion patterns are stable, because the Zotero OAuth token cleanup cron must correctly handle already-deleted tokens (wrap individual deletes in try-catch per the concurrency pitfall).

**Delivers:** Hourly Zotero OAuth token cleanup cron. Concurrency guard in `cleanupDeletedUsers` (check user still exists and is still in "deleted" state before processing each batch). New `cleanupExpiredOAuthTokens` internal mutation in `convex/zotero/mutations.ts`.

**Addresses:** Cron OAuth token cleanup (table bloat P2), concurrent deletion safety (Pitfall 8)

**Avoids:** Pitfall 8 (cron concurrent with manual delete — wrap `ctx.db.delete()` in try-catch for already-deleted tokens; check user state before cascade scheduling)

### Phase 5: Environment and Polish

**Rationale:** Feature flag naming and debug endpoint documentation require coordinated environment variable changes across dev, staging, and production Convex dashboards. This is low risk but must be the final phase to avoid disrupting active fixes in earlier phases.

**Delivers:** Documented debug endpoint production policy with inline JSDoc and deployment checklist. `ENABLE_PUBLIC_DEBUG_FUNCTIONS` policy enforced and confirmed unset in production.

**Addresses:** Debug endpoint documentation (operational P3)

**Avoids:** Pitfall 5 (environment variable changes require coordinated dashboard updates — verify in all environments before closing concern)

### Phase Ordering Rationale

- **Schema migration first** because Convex rejects schema changes while deprecated field data exists; this gates all other schema work in the milestone
- **Workflow + deletion second** because the cascade delete pattern is a shared foundation that Phase 4 (user cleanup cron) extends; it must be correct first
- **Type safety third** because it is the highest-effort item, is independently deployable per query, and the typed validators benefit from having Phase 2's query logic already correct
- **Cron additions fourth** because they are purely additive and depend on Phase 2's deletion patterns being verified stable
- **Environment changes last** because they require cross-system coordination and should not interleave with active code changes

### Research Flags

Phases needing careful deployment attention (not more research, but deliberate execution):

- **Phase 1:** Three-deploy sequence for `apiKey` migration requires explicit verification between deploys. Do not automate away the verification query — manually confirm zero rows with `apiKey !== undefined` before pushing schema change.
- **Phase 2:** Workpool per-paper cancellation requires reading each paper's `workId` from the DB in the mutation; performance is bounded by paper count (~200 max) but should be confirmed in testing.
- **Phase 3:** Each query validator deployment needs a monitoring window in Convex logs before proceeding to the next query. Historical data shapes must be audited before writing validators.

Phases with well-documented, low-risk patterns (no additional research needed):

- **Phase 4:** Cron additions follow the exact existing `crons.interval()` pattern used 4 times in `convex/crons.ts`. No new concepts introduced.
- **Phase 5:** Environment variable changes are operational, not code changes.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All APIs verified from installed `node_modules` source code, not just documentation. No new dependencies needed. |
| Features | HIGH | All 13 concerns documented in existing `CONCERNS.md` with exact file locations and line numbers. Priority tiers based on active risk assessment. |
| Architecture | HIGH | All integration points verified against actual codebase files. Exact file paths and line numbers cited throughout. No speculative patterns. |
| Pitfalls | HIGH | Pitfalls verified against Convex official docs, component documentation, and direct codebase inspection. Recovery strategies documented for all critical pitfalls. |

**Overall confidence:** HIGH

### Gaps to Address

- **Credit reconciliation policy for cancelled jobs:** The research identifies that credits will be deducted for in-progress papers at cancel time and suggests a post-cancel reconciliation option. The decision of whether to implement reconciliation vs. document it as expected behavior ("credits for in-progress work at cancel time are non-refundable") is a product decision not resolved by research. Needs a decision before Phase 2 implementation.

- **Diff cap size:** The current 1,000-entry cap is conservative and research notes it could be raised to 5,000-10,000 given Convex's 1MB document limit. The right value depends on typical diff sizes in production. Worth checking actual diff document sizes in the Convex dashboard before deciding on the new cap in Phase 2.

- **`getJobDetails` collect vs paginate:** Research recommends `.collect()` over full pagination because extraction jobs are capped at ~200 papers. This assumption should be verified — if the 200-paper cap is enforced hard elsewhere in the pipeline, `.collect()` is safe. If the cap is not hard-enforced, full pagination is the safer choice.

## Sources

### Primary (HIGH confidence)
- `node_modules/@convex-dev/workflow/src/client/index.ts` line 216 — `workflow.cancel()` API signature
- `node_modules/@convex-dev/workpool/src/client/index.ts` line 249 — `pdfProcessingPool.cancelAll()` API
- `node_modules/@convex-dev/workpool/dist/client/index.d.ts` lines 158-166 — `cancel()` and `cancelAll()` types
- `node_modules/@convex-dev/workflow/src/types.ts` line 15 — `WorkflowId` type
- [Convex When to Use Return Validators](https://stack.convex.dev/when-to-and-when-not-to-use-return-validators) — runtime enforcement, extra fields fail validation
- [Convex Workflow Component](https://www.convex.dev/components/workflow) — `cancel()` does not stop in-progress actions
- [Convex Workpool Component](https://www.convex.dev/components/workpool) — cancellation does not stop in-progress work
- [Convex Cron Jobs Documentation](https://docs.convex.dev/scheduling/cron-jobs) — at-most-one cron instance semantics
- [Convex Schemas Documentation](https://docs.convex.dev/database/schemas) — validation at deploy time

### Secondary (MEDIUM confidence)
- [Convex Intro to Migrations](https://stack.convex.dev/intro-to-migrations) — expand-contract pattern for field removal (cross-referenced with installed code)
- [Convex Lightweight Zero-Downtime Migrations](https://stack.convex.dev/lightweight-zero-downtime-migrations) — migration ordering
- [GDPR Right to Erasure](https://www.reform.app/blog/right-to-erasure-gdpr-compliance-steps) — audit trail preservation requirements
- [GDPR Data Retention Best Practices](https://usercentrics.com/knowledge-hub/gdpr-data-retention/) — financial records exemption from deletion

### Tertiary (LOW confidence)
- [Zero-downtime database migrations](https://drcodes.com/posts/zero-downtime-database-migrations-essential-patterns) — expand-contract pattern context

---
*Research completed: 2026-03-02*
*Ready for roadmap: yes*
