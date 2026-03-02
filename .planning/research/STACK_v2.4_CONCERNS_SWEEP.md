# Technology Stack: v2.4 Concerns Sweep Fixes

**Project:** OpenAlex Count
**Milestone:** v2.4 Concerns Sweep (13 codebase concerns)
**Researched:** 2026-03-02
**Scope:** Stack additions/changes needed for specific concern fixes. Does NOT re-research existing validated stack.

## Executive Summary

The v2.4 concerns sweep requires **zero new runtime dependencies**. Every fix uses APIs already available in the installed packages (`@convex-dev/workflow@0.3.4`, `@convex-dev/workpool@0.3.1`, `convex@1.32.0`). The one optional addition is `@convex-dev/migrations` for the schema migration, but a hand-rolled batched mutation achieves the same result with less coupling.

## Fix-Specific Stack Analysis

### 1. Workflow Cancellation (`cancelExtraction` fix)

**Problem:** `cancelExtraction` sets DB status to "cancelled" but never stops the running workflow or workpool items.

**APIs needed (already installed):**

| API | Package | Version | Purpose |
|-----|---------|---------|---------|
| `workflow.cancel(ctx, workflowId)` | `@convex-dev/workflow` | 0.3.4 | Cancel the Convex workflow durable execution |
| `pdfProcessingPool.cancelAll(ctx)` | `@convex-dev/workpool` | 0.3.1 | Cancel all pending workpool items |
| `WorkflowId` type | `@convex-dev/workflow` | 0.3.4 | Type for the workflowId stored on extractionJobs |

**Confidence:** HIGH (verified from installed `node_modules` source code)

**Key API details:**

```typescript
// From @convex-dev/workflow/src/client/index.ts line 216
async cancel(ctx: RunMutationCtx, workflowId: WorkflowId): Promise<void>
// Requires mutation context (ctx.runMutation). cancelExtraction is already a mutation. Good.

// From @convex-dev/workpool/src/client/index.ts line 249
async cancelAll(ctx: RunMutationCtx, options?: { limit?: number }): Promise<void>
// Cancels all pending work items. Already-started items finish but will not retry.
```

**Implementation pattern:**

```typescript
import { workflow } from "../workflow";
import { pdfProcessingPool } from "../workpool";
import type { WorkflowId } from "@convex-dev/workflow";

// Inside cancelExtraction handler:
if (job.workflowId) {
  await workflow.cancel(ctx, job.workflowId as WorkflowId);
}
await pdfProcessingPool.cancelAll(ctx);
```

**Critical note:** `workflow.cancel()` requires `RunMutationCtx` -- it calls `ctx.runMutation` internally. The `cancelExtraction` handler already runs in a mutation context, so this works directly. No need to convert to an action.

**Critical note 2:** `pdfProcessingPool.cancelAll(ctx)` cancels ALL pending items in the pool, not just items for this job. This is acceptable because (a) the pool is dedicated to extraction processing, and (b) concurrent extraction jobs are not a supported use case currently. If concurrent jobs become supported later, individual cancellation using `pdfProcessingPool.cancel(ctx, workId)` per paper would be needed.

**What NOT to add:** Do not implement a job-scoped workpool cancellation with per-paper `cancel()` calls unless concurrent jobs are a real requirement. The N individual cancel calls would be slower and more complex than `cancelAll()`.

---

### 2. Typed Return Validators (replace `v.any()`)

**Problem:** 30+ uses of `v.any()` in extraction query `returns` validators disable Convex runtime type checking.

**APIs needed (already installed):**

| API | Package | Version | Purpose |
|-----|---------|---------|---------|
| `v.object()`, `v.array()`, `v.union()`, `v.optional()`, `v.string()`, `v.number()`, `v.boolean()`, `v.null()`, `v.id()`, `v.literal()`, `v.record()` | `convex/values` | 1.32.0 | Build typed validators matching actual return shapes |
| `paginationResultValidator(itemValidator)` | `convex/server` | 1.32.0 | Replace `paginationResultValidator(v.any())` with typed item validator |
| `Doc<"tableName">` type | `convex/_generated/dataModel` | 1.32.0 | Reference for field shapes |

**Confidence:** HIGH (these are core Convex validator primitives already used extensively)

**No new dependencies needed.** The fix is purely about writing the correct validator objects.

**Pattern for shared validators:**

```typescript
// convex/extraction/validators.ts (new file)
import { v } from "convex/values";

// Reusable validators extracted from schema shapes
export const vExtractionJob = v.object({
  _id: v.id("extractionJobs"),
  _creationTime: v.number(),
  userId: v.id("users"),
  sourceType: v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"), v.literal("mixed")),
  status: v.union(
    v.literal("pending"), v.literal("downloading_pdfs"), v.literal("indexing"),
    v.literal("extracting"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")
  ),
  name: v.string(),
  totalPapers: v.number(),
  processedPapers: v.number(),
  failedPapers: v.number(),
  // ... remaining fields from schema, all optional ones marked v.optional()
});

export const vExtractionQuestion = v.object({
  _id: v.id("extractionQuestions"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  key: v.string(),
  question: v.string(),
  type: v.union(v.literal("string"), v.literal("boolean"), v.literal("number"), v.literal("array")),
  description: v.optional(v.string()),
  order: v.number(),
  createdAt: v.number(),
});

export const vExtractionPaper = v.object({
  _id: v.id("extractionPapers"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  openalexId: v.string(),
  title: v.string(),
  status: v.union(
    v.literal("pending"), v.literal("downloading"), v.literal("download_failed"),
    v.literal("indexing"), v.literal("indexing_failed"), v.literal("extracting"),
    v.literal("completed"), v.literal("failed")
  ),
  // ... remaining fields
});
```

**Strategy:** Create a single `convex/extraction/validators.ts` file exporting reusable validators. Each query's `returns` then references these shared validators instead of `v.any()`. This avoids duplicating validator definitions across 10+ queries.

**Incremental approach:** Replace `v.any()` validators one query at a time. Each replacement is independently deployable. Start with `getJobDetails` (highest traffic) and work outward.

**What NOT to add:** Do not generate validators automatically from the schema. The return types often differ from the raw document shape (they include computed fields, joined data, etc.). Manual typing ensures correctness.

---

### 3. Cron Patterns for Cleanup Jobs

**Problem:** No cron cleanup for expired `zoteroOAuthTokens`. Also need cleanup cron for extraction data of deleted users.

**APIs needed (already installed):**

| API | Package | Version | Purpose |
|-----|---------|---------|---------|
| `crons.interval(name, schedule, fn)` | `convex/server` | 1.32.0 | Schedule periodic cleanup |
| `crons.daily(name, schedule, fn)` | `convex/server` | 1.32.0 | Alternative daily schedule |
| `crons.hourly(name, schedule, fn)` | `convex/server` | 1.32.0 | Alternative hourly schedule |

**Confidence:** HIGH (verified from Convex source, pattern already used 4 times in `convex/crons.ts`)

**Existing cron patterns in this project:**

```typescript
// convex/crons.ts -- all 4 existing crons use interval()
crons.interval("cleanup deleted users", { hours: 24 }, internal.maintenance.mutations.cleanupDeletedUsers);
crons.interval("check subscription status", { hours: 1 }, internal.maintenance.internal.checkSubscriptionStatus);
crons.interval("monitor failed stripe events", { hours: 1 }, internal.maintenance.mutations.monitorFailedStripeEvents);
crons.interval("reconcile stripe paid invoices", { hours: 1 }, internal.credits.actions.reconcileRecentPaidInvoicesFromStripe, {});
```

**Recommended additions:**

```typescript
// Zotero OAuth token cleanup: every 30 minutes
// OAuth tokens expire after 10 minutes, 30-min sweep is adequate
crons.interval(
  "cleanup expired zotero oauth tokens",
  { minutes: 30 },
  internal.maintenance.mutations.cleanupExpiredZoteroOAuthTokens
);
```

**Why `interval` over `daily`:** The `zoteroOAuthTokens` table accumulates rows continuously as users start OAuth flows. A 30-minute interval ensures abandoned tokens are cleaned within the same hour. A daily schedule would leave tokens for up to 24 hours.

**Why NOT hourly:** `crons.hourly()` requires `{ minuteUTC: N }` syntax. The `crons.interval()` with `{ minutes: 30 }` is simpler and consistent with existing project patterns. Either works; consistency wins.

**The deleted-users extraction cleanup does NOT need its own cron.** The existing `cleanupDeletedUsers` cron (24h interval) should be extended to also schedule extraction cascade deletion and Zotero connection deletion. Adding a separate cron would duplicate the "find deleted users" query.

---

### 4. Schema Migration (removing deprecated `apiKey` field)

**Problem:** `zoteroConnections.apiKey` (plaintext) still exists in schema. Need to migrate all plaintext keys to `encryptedApiKey`, then remove the field.

**Option A: Hand-rolled batched mutation (RECOMMENDED)**

| What | Details |
|------|---------|
| Approach | Write an internal mutation that processes N rows per batch, encrypts plaintext `apiKey` to `encryptedApiKey`, sets `apiKey` to `undefined`, and self-schedules for the next batch |
| Dependencies | None new. Uses existing `crypto.ts` encrypt function |
| Pattern | Identical to the existing `deleteExtractionInternal` self-scheduling batch pattern |
| Trigger | One-time manual invocation from Convex dashboard |

**Option B: `@convex-dev/migrations` component**

| What | Details |
|------|---------|
| Package | `@convex-dev/migrations@0.3.1` |
| Approach | `migrations.define({ table: "zoteroConnections", migrateOne: ... })` |
| Advantages | Progress tracking, resumable, status queries |
| Disadvantages | Adds a new component dependency (requires `convex.config.ts` change), adds component tables to schema, overkill for a single one-time migration on a small table |

**Recommendation: Option A.** The `zoteroConnections` table is small (one row per user with a Zotero connection). A simple batched mutation with `.take(100)` handles it in a single batch. The `@convex-dev/migrations` component is designed for large-scale migrations across millions of rows. Adding it for a single small-table migration adds permanent schema overhead.

**Migration steps (no new deps):**

1. **Deploy code** that already handles both `apiKey` and `encryptedApiKey` (dual-read fallback already exists in `resolveZoteroApiKey`)
2. **Run migration mutation** from dashboard: reads rows with non-null `apiKey`, encrypts each, patches `encryptedApiKey` + sets `apiKey: undefined`
3. **Verify** all rows migrated (query for `apiKey !== undefined`)
4. **Update schema**: Remove `apiKey` field from `zoteroConnections` table definition
5. **Remove fallback code**: Delete the dual-read paths in `convex/zotero/actions.ts` and `convex/extraction/workpoolActions.ts`
6. **Deploy**

**Confidence:** HIGH (Convex documentation confirms this approach; existing codebase already uses the self-scheduling batch pattern)

---

### 5. Pagination Patterns (replacing `.take(100)`)

**Problem:** `getJobDetails` uses `.take(100)` for papers, capping the displayed paper list at 100.

**APIs needed (already installed):**

| API | Package | Version | Purpose |
|-----|---------|---------|---------|
| `.paginate(paginationOpts)` | `convex/server` | 1.32.0 | Server-side cursor-based pagination |
| `paginationOptsValidator` | `convex/server` | 1.32.0 | Validator for pagination args |
| `paginationResultValidator(itemValidator)` | `convex/server` | 1.32.0 | Validator for pagination result |
| `usePaginatedQuery()` | `convex/react` | 1.32.0 | Client-side reactive pagination hook |

**Confidence:** HIGH (already used in this project for `getJobResultsPaginated`)

**Existing pagination pattern in codebase:**

```typescript
// convex/extraction/queries.ts line 464-524
export const getJobResultsPaginated = query({
  args: {
    jobId: v.id("extractionJobs"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      ...paginatedAnyResultValidator.fields,
    }),
    // ...
  ),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_processable", (q) =>
        q.eq("jobId", args.jobId).eq("processable", true)
      )
      .order("asc")
      .paginate(args.paginationOpts);
    // ...
  },
});
```

**Fix approach for `getJobDetails`:** The `.take(100)` at line 294 should be converted to `.paginate(args.paginationOpts)` following the exact same pattern as `getJobResultsPaginated`. However, `getJobDetails` is a heavily-used query that returns job + questions + papers together. Two approaches:

**Approach A (minimal change, RECOMMENDED):** Replace `.take(100)` with `.collect()` and add a reasonable upper bound check. The `getJobDetails` query is used for the job detail view which shows all processable papers. Since extraction jobs are capped at ~200 papers (OpenAlex page limit), `.collect()` with a post-query length guard is safe.

```typescript
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job_processable", (q) =>
    q.eq("jobId", args.jobId).eq("processable", true)
  )
  .order("asc")
  .collect();
// Safety: extractionJobs are capped at ~200 papers by source fetching
```

**Approach B (pagination):** Add `paginationOpts` to `getJobDetails` args and paginate papers. This changes the API contract and requires client-side changes to use `usePaginatedQuery()` instead of `useQuery()`.

**Recommendation: Approach A** for `getJobDetails` because:
- The 200-paper cap on extraction jobs is enforced by the OpenAlex page limit
- The query already loads questions (unbounded `.collect()`) with no issue
- Converting to pagination would require reworking the client component that consumes this query
- The `.take(100)` is the bug; replacing with `.collect()` fixes it without over-engineering

**What NOT to add:** Do not add pagination to `getJobDetails` unless jobs with 500+ papers become a real use case. The current architecture caps at ~200 papers per source.

---

## Summary: No New Dependencies Needed

| Concern | Fix Uses | New Dep? |
|---------|----------|----------|
| Workflow cancellation | `@convex-dev/workflow` cancel() + `@convex-dev/workpool` cancelAll() | NO - already installed |
| Typed validators | `convex/values` validator primitives | NO - core Convex |
| Cron cleanup | `convex/server` cronJobs interval() | NO - core Convex |
| Schema migration | Hand-rolled batched mutation + existing crypto.ts | NO |
| Pagination fix | `.collect()` replacing `.take(100)` | NO |

## Version Verification

| Package | Installed | Required | Status |
|---------|-----------|----------|--------|
| `convex` | 1.32.0 | >=1.31.0 | OK - all APIs available |
| `@convex-dev/workflow` | 0.3.4 | >=0.3.0 | OK - `cancel()` available since 0.2.x |
| `@convex-dev/workpool` | 0.3.1 | >=0.3.0 | OK - `cancelAll()` available |
| `convex-helpers` | 0.1.111 | >=0.1.0 | OK - rate limiting unchanged |

## Alternatives Explicitly Rejected

| What | Why Not |
|------|---------|
| `@convex-dev/migrations` for schema migration | Overkill for a single small-table migration. Adds permanent component overhead to `convex.config.ts` and schema |
| Per-paper workpool cancellation | `cancelAll()` is simpler and correct given single-job-at-a-time constraint |
| Auto-generated validators from schema | Return types differ from raw doc shapes due to joins, computed fields, metadata attachment |
| Full pagination refactor of `getJobDetails` | Breaks client API contract for a problem that `.collect()` solves given the 200-paper cap |
| Zod validators for Convex returns | Convex has its own validator system (`v.*`). Mixing Zod with Convex validators adds confusion |

## Integration Points with Existing Code

| Fix | Files Modified | Files Created |
|-----|---------------|---------------|
| Workflow cancellation | `convex/extraction/mutations.ts` (cancelExtraction handler) | None |
| Typed validators | `convex/extraction/queries.ts` (30+ return validators) | `convex/extraction/validators.ts` (shared validators) |
| Cron cleanup | `convex/crons.ts`, `convex/maintenance/mutations.ts` | None |
| Schema migration | `convex/schema.ts`, `convex/zotero/actions.ts`, `convex/extraction/workpoolActions.ts` | `convex/zotero/migrations.ts` (one-time migration) |
| Pagination fix | `convex/extraction/queries.ts` (getJobDetails) | None |

## Sources

- `@convex-dev/workflow` cancel API: verified from `/node_modules/@convex-dev/workflow/src/client/index.ts` line 216 (HIGH confidence)
- `@convex-dev/workpool` cancelAll API: verified from `/node_modules/@convex-dev/workpool/src/client/index.ts` line 249 (HIGH confidence)
- `WorkflowId` type: verified from `/node_modules/@convex-dev/workflow/src/types.ts` line 15 (HIGH confidence)
- Convex pagination: verified from `/node_modules/convex/src/server/pagination.ts` (HIGH confidence)
- Convex cron API: verified from `/node_modules/convex/src/server/cron.ts` (HIGH confidence)
- Schema migration patterns: [Intro to Migrations](https://stack.convex.dev/intro-to-migrations), [Lightweight Zero-Downtime Migrations](https://stack.convex.dev/lightweight-zero-downtime-migrations), [Convex Migrations Component](https://github.com/get-convex/migrations) (MEDIUM confidence -- web sources cross-referenced with installed code)
