# Architecture Research: v2.4 Concerns Sweep Integration

**Domain:** Codebase maintenance -- 13 fixes integrating into existing Convex + Next.js extraction platform
**Researched:** 2026-03-02
**Confidence:** HIGH (all integration points verified against actual codebase)

## Existing Architecture Overview

```
+---------------------------------------------------------------+
|                     Next.js Frontend                           |
|  +----------+  +-----------+  +----------+  +---------------+ |
|  | Search   |  | Library   |  | Extract  |  | /test-sidebar | |
|  | Page     |  | Page      |  | Pages    |  | (REMOVE)      | |
|  +----+-----+  +-----+-----+  +----+-----+  +---------------+ |
|       |               |             |                          |
|  +----+-----+   +-----+-----+  +---+--------+                 |
|  | Zustand  |   | nuqs URL  |  | Convex     |                 |
|  | Stores   |   | State     |  | useQuery() |                 |
|  +----------+   +-----------+  +-----+------+                 |
+---------------------------------------|-----------------------+
                                        |
+---------------------------------------|-----------------------+
|                  Convex Backend        |                       |
|  +------------------------------------v--------------------+   |
|  |              Public API Layer (queries/mutations)       |   |
|  |  extraction/queries.ts  extraction/mutations.ts         |   |
|  |  maintenance/mutations.ts  zotero/mutations.ts          |   |
|  +--------+-------------+-------------+-------------------+   |
|           |             |             |                        |
|  +--------v---+ +-------v------+ +----v------------------+    |
|  | Workflow   | | Workpool     | | Cron Jobs             |    |
|  | Manager    | | (PDF proc)  | | (crons.ts)            |    |
|  | (workflow) | | maxParallel:3| | - cleanup users       |    |
|  +--------+---+ +------+------+ | - check subscriptions |    |
|           |            |        | - monitor stripe       |    |
|           v            v        | - reconcile invoices   |    |
|  +-------------------------+    +------------------------+    |
|  | workpoolActions.ts      |                                  |
|  | downloadAndIndex -> extract                                |
|  +-------------------------+                                  |
|                                                               |
|  +----------------------------------------------------------+ |
|  |                   Schema (12 extraction tables)           | |
|  | extractionJobs | extractionPapers | extractionResults     | |
|  | extractionQuestions | extractionRunDiffs | ...             | |
|  | zoteroConnections | zoteroOAuthTokens                     | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
```

## Concern-to-Architecture Mapping

Each of the 13 concerns maps to a specific architectural layer. This is the integration analysis for each.

### Component Responsibilities (Existing)

| Component | Responsibility | Files Touched by v2.4 |
|-----------|----------------|----------------------|
| `convex/extraction/mutations.ts` | Job lifecycle, cascade delete, paper enqueuing | cancelExtraction, deleteExtractionInternal, runDiff |
| `convex/extraction/queries.ts` | All extraction read paths, insight computation | v.any() validators, attachReviewMetadata, getJobDetails |
| `convex/extraction/workflow.ts` | Orchestrates extraction pipeline via WorkflowManager | Cancellation target |
| `convex/extraction/workpoolActions.ts` | PDF download, indexing, extraction actions | Zotero key fallback paths |
| `convex/workpool.ts` | Workpool singleton (maxParallelism: 3) | Cancellation drain target |
| `convex/workflow.ts` | WorkflowManager singleton | Cancel API |
| `convex/schema.ts` | All table definitions | apiKey field removal |
| `convex/crons.ts` | 4 scheduled jobs | Add OAuth token cleanup |
| `convex/maintenance/mutations.ts` | User cleanup, past-due expiry, monitoring | Extend cleanupDeletedUsers |
| `convex/zotero/mutations.ts` | OAuth flow, connection management | Token expiry concern |
| `lib/store.ts` | Zustand stores with versioned migrations | Type the migration steps |
| `app/test-sidebar/page.tsx` | Test page (DELETE) | Remove entirely |
| `convex/extraction/actions.ts` | OpenAlex API fetching | User-Agent email |

## Integration Analysis: The 7 Key Questions

### 1. Where Does Workflow Cancellation Fit in the Extraction Pipeline?

**Current flow:**
```
User calls cancelExtraction (mutation)
    |
    v
Sets job.status = "cancelled" in DB
    |
    v
NOTHING ELSE -- workflow and workpool continue
```

**Required flow:**
```
User calls cancelExtraction (mutation)
    |
    +--> Sets job.status = "cancelled" in DB
    |
    +--> Reads job.workflowId
    |
    +--> Calls workflow.cancel(ctx, workflowId)
    |         |
    |         v
    |    WorkflowManager cancels pending workflow steps
    |    (already-enqueued workpool items are NOT affected)
    |
    +--> Calls pdfProcessingPool.cancel(ctx, workId) per paper
              |
              v
         Workpool marks each pending work item as "canceled"
         onComplete handlers fire with result.kind === "canceled"
         (already-running actions complete naturally)
```

**Integration points:**
- **Modified:** `convex/extraction/mutations.ts` -- `cancelExtraction` handler (lines 229-256)
- **Imports needed:** `workflow` from `../workflow`, `pdfProcessingPool` from `../workpool`
- **Key constraint:** `cancelExtraction` is a `mutation`, and both `workflow.cancel()` and `pdfProcessingPool.cancel()` accept `RunMutationCtx`, so this works without converting to an action.
- **Already handled:** The `handleDownloadAndIndexComplete` and `handleExtractionComplete` callbacks already handle `result.kind === "canceled"` correctly -- they set paper status to "failed" with message "was canceled" and call `finalizeJobIfDone`. No changes needed there.
- **Edge case:** `cancelAll` on the workpool is global. If multiple extraction jobs share the same `pdfProcessingPool`, cancelling one job's work cancels all pending work across all jobs. The workpool component does not support per-job filtering. The safest approach: iterate the job's papers, find their `workId` values, and call `pdfProcessingPool.cancel(ctx, workId)` individually. Papers have a `workId` field (schema line 345) and an index `by_work`.

**Recommended implementation:**
```typescript
// In cancelExtraction handler, after setting status:
if (job.workflowId) {
  await workflow.cancel(ctx, job.workflowId as any);
}

// Cancel individual workpool items for this job's papers
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .collect();

for (const paper of papers) {
  if (paper.workId) {
    try {
      await pdfProcessingPool.cancel(ctx, paper.workId as any);
    } catch {
      // Work item may already be completed or running
    }
  }
}
```

**Risk:** LOW. The onComplete handlers already handle the "canceled" result kind. The workflow cancel API is documented in @convex-dev/workflow types. The workpool cancel API is documented in @convex-dev/workpool types.

### 2. How to Safely Remove the `apiKey` Schema Field Without Downtime

**Current state in schema.ts line 175:**
```typescript
apiKey: v.optional(v.string()),  // Deprecated: use encryptedApiKey
```

**Convex expand-contract pattern (3 deploys):**

**Deploy 1 -- Migration action (no schema change):**
- Create `convex/zotero/migrations.ts` with an `internalAction` that:
  1. Calls `internal.zotero.internal.listAllConnections` to get all rows
  2. For each row where `apiKey` is set and `encryptedApiKey` is not:
     - Encrypt `apiKey` using the shared `crypto.ts` module
     - Patch the row: set `encryptedApiKey`, set `keyPrefix`, unset `apiKey` via `ctx.runMutation`
  3. Uses batched processing with `ctx.scheduler.runAfter(0, ...)` for continuation
- Run this migration (via Convex dashboard or a one-time cron)
- Verify: query for any rows where `apiKey` is defined -- should be zero

**Deploy 2 -- Remove all fallback code paths (field still in schema):**
- `convex/zotero/actions.ts` (line 42): Remove the `else if (connection.apiKey)` fallback
- `convex/extraction/workpoolActions.ts` (line 759-760): Remove the `else if (zoteroConnection)` plaintext fallback
- `convex/zotero/internal.ts`: Remove any dual-read logic
- All code now only reads `encryptedApiKey`

**Deploy 3 -- Remove field from schema:**
- Remove `apiKey: v.optional(v.string())` from schema.ts line 175
- Convex will accept this because no documents have the field set (from Deploy 1)

**Integration points:**
- **New file:** `convex/zotero/migrations.ts`
- **Modified:** `convex/schema.ts`, `convex/zotero/actions.ts`, `convex/extraction/workpoolActions.ts`
- **Dependency:** Deploy 1 must complete before Deploy 2 code goes out

**Risk:** LOW if done in order. The field is already `v.optional()`, so Convex will accept removal once data is migrated.

### 3. Where to Add Typed Validators -- Inline vs Shared Validator Objects

**Current problem:** 7 locations in `convex/extraction/queries.ts` use `v.any()` in `returns` validators.

**Recommended approach: Shared validator objects in a dedicated file.**

**New file:** `convex/extraction/validators.ts`

```typescript
import { v } from "convex/values";

// Reusable validators for extraction document shapes
export const jobValidator = v.object({
  _id: v.id("extractionJobs"),
  _creationTime: v.number(),
  userId: v.id("users"),
  sourceType: v.union(/* ... */),
  status: v.union(/* ... */),
  name: v.string(),
  // ... all fields from schema
});

export const questionValidator = v.object({
  _id: v.id("extractionQuestions"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  key: v.string(),
  question: v.string(),
  type: v.union(v.literal("string"), v.literal("boolean"),
                v.literal("number"), v.literal("array")),
  description: v.optional(v.string()),
  order: v.number(),
  createdAt: v.number(),
});

export const paperValidator = v.object({ /* ... */ });
export const resultWithReviewValidator = v.object({ /* ... */ });
// etc.
```

**Why shared over inline:**
1. The same shapes (job, paper, question, result) appear in 7+ query return types
2. Inline validators would duplicate 50+ lines of validator code per query
3. Shared validators can be imported into tests for contract testing
4. When schema changes, one file updates -- not 7 queries

**Integration points:**
- **New file:** `convex/extraction/validators.ts`
- **Modified:** `convex/extraction/queries.ts` (7 locations: lines 261-263, 328-329, 411-413, 533-536, 668-690, 779-785, 892-893)
- **Also fix:** `attachReviewMetadata` in queries.ts (lines 113-118) -- replace `Map<string, any>` with `Map<string, Doc<"extractionResultReviews">>` and `review: any` with `review: Doc<"extractionResultReviews"> | undefined`

**Risk:** MEDIUM. The validators must exactly match the runtime return shapes. Mismatches will cause Convex runtime errors. Test each query after adding validators.

### 4. How to Extend cleanupDeletedUsers Without Breaking Existing Audit Logic

**Current cleanup flow (convex/maintenance/mutations.ts):**
```
cleanupDeletedUsers (internalMutation, daily cron)
    |
    +--> Find users with state="deleted" past 30-day retention
    |
    +--> For each: delete apiKeys
    |
    +--> Hard delete user record
    |
    +--> NOTE: credits and subscriptions intentionally kept for audit
    |
    +--> Self-schedule if batch was full
```

**Required extension:**
```
cleanupDeletedUsers (internalMutation, daily cron)
    |
    +--> Find users with state="deleted" past 30-day retention
    |
    +--> For each user:
    |     |
    |     +--> Delete apiKeys (existing)
    |     |
    |     +--> Find all extractionJobs by userId
    |     |     |
    |     |     +--> For each job: schedule deleteExtractionInternal
    |     |           (reuses existing cascade delete -- already handles
    |     |            all 8 child tables + storage cleanup)
    |     |
    |     +--> Delete zoteroConnections by userId
    |     |
    |     +--> Delete zoteroOAuthTokens by userId
    |     |
    |     +--> Hard delete user record
    |
    +--> Self-schedule if batch was full
```

**Key design decisions:**
- **Reuse `deleteExtractionInternal`** rather than duplicating cascade logic. This is the 9-step batched delete that already handles all child tables.
- **Schedule, do not inline.** Each extraction job deletion involves multiple self-scheduling rounds. Inlining would blow the mutation transaction limit.
- **Do NOT delete credits/subscriptions.** The comment "keep for audit" is an intentional decision from v2.3. Preserve it.
- **Batch awareness:** `cleanupDeletedUsers` already batches at 50 users. Each user may have multiple extraction jobs. With `scheduler.runAfter(0, ...)`, the cascade deletes will run asynchronously after the cleanup mutation completes. This is safe -- the user record deletion at the end of each user's cleanup doesn't block the cascade.

**Integration points:**
- **Modified:** `convex/maintenance/mutations.ts` -- `cleanupDeletedUsers` handler
- **Import needed:** `internal` from `../_generated/api` (already imported)
- **Reuses:** `internal.extraction.mutations.deleteExtractionInternal` (existing, tested)

**Risk:** LOW. The cascade delete is battle-tested. The only new code is querying user's jobs/connections and scheduling their deletion. The existing audit preservation (credits, subscriptions) is untouched.

### 5. Where to Add Cron Jobs in the Existing crons.ts

**Current crons.ts has 4 jobs:**
```typescript
const crons = cronJobs();

crons.interval("cleanup deleted users",          { hours: 24 }, ...);
crons.interval("check subscription status",      { hours: 1 },  ...);
crons.interval("monitor failed stripe events",   { hours: 1 },  ...);
crons.interval("reconcile stripe paid invoices",  { hours: 1 },  ...);

export default crons;
```

**Add 1 new cron -- Zotero OAuth token cleanup:**

```typescript
// Hourly cleanup of expired Zotero OAuth tokens (abandoned flows)
crons.interval(
  "cleanup expired zotero oauth tokens",
  { hours: 1 },
  internal.zotero.mutations.cleanupExpiredOAuthTokens
);
```

**New mutation needed:** `convex/zotero/mutations.ts` -- add `cleanupExpiredOAuthTokens` as an `internalMutation`:
```typescript
export const cleanupExpiredOAuthTokens = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("zoteroOAuthTokens")
      .collect(); // Table is tiny -- tokens expire in 10 min

    let count = 0;
    for (const token of expired) {
      if (token.expiresAt < now) {
        await ctx.db.delete(token._id);
        count++;
      }
    }
    if (count > 0) {
      console.log(`Cleaned up ${count} expired Zotero OAuth tokens`);
    }
    return null;
  },
});
```

**Integration points:**
- **Modified:** `convex/crons.ts` (add 1 entry)
- **Modified:** `convex/zotero/mutations.ts` (add 1 internalMutation)
- **No index needed:** The `zoteroOAuthTokens` table is expected to be very small (only in-flight OAuth sessions). A `.collect()` + JS filter is sufficient. Adding a `by_expiresAt` index would be premature.

**Risk:** LOW. Cron additions are additive and don't affect existing jobs.

### 6. Impact of Removing /test-sidebar on Routing

**Current state:**
- `app/test-sidebar/page.tsx` is a 29-line "use client" component
- Renders `<SidebarLayout>` with placeholder text
- No auth check, no middleware exclusion
- Not linked from any navigation or other component

**Removal impact analysis:**

| Aspect | Impact |
|--------|--------|
| Routing | None -- Next.js App Router auto-removes route when directory deleted |
| Middleware | None -- no middleware.ts exists at project root; Clerk middleware is not configured to include/exclude this route |
| Navigation | None -- no links to `/test-sidebar` found anywhere |
| Tests | None -- no test references this route |
| Imports | None -- the page imports from `@/components/shared/sidebar-layout` but nothing imports from the page |
| SEO | None -- no sitemap or robots.txt references |

**Action:** Delete `app/test-sidebar/page.tsx` and the `app/test-sidebar/` directory. No other changes needed.

**Risk:** NONE. This is a dead route with zero references.

### 7. How to Handle runDiff Orphan Cleanup Alongside Existing Cascade Delete

**Current problem:**
The `deleteExtractionInternal` cascade (Step 8, line 1086-1096) only deletes diffs where `jobId == args.jobId`. It explicitly skips diffs where `baselineJobId == args.jobId`. This leaves orphaned diff records pointing to a deleted baseline job.

**Existing index:** `extractionRunDiffs` has `.index("by_baseline", ["baselineJobId"])` -- already defined in the schema (line 633). This index exists specifically for this use case but is unused.

**Integration approach -- Extend Step 8 of cascade delete:**

```
Current Step 8: Delete diffs where jobId == args.jobId
                (using by_job index)

Extended Step 8: Delete diffs where jobId == args.jobId (existing)
                 + Delete diffs where baselineJobId == args.jobId (new)
                   (using by_baseline index)
```

**Implementation in `deleteExtractionInternal`:**

After the existing Step 8 block (line 1086-1096), add a Step 8b:

```typescript
// Step 8b: Delete extractionRunDiffs where this job is the BASELINE
const baselineDiffs = await ctx.db
  .query("extractionRunDiffs")
  .withIndex("by_baseline", (q) => q.eq("baselineJobId", args.jobId))
  .take(BATCH_SIZE);
if (baselineDiffs.length > 0) {
  for (const d of baselineDiffs) await ctx.db.delete(d._id);
  await ctx.scheduler.runAfter(
    0, internal.extraction.mutations.deleteExtractionInternal,
    { jobId: args.jobId }
  );
  return null;
}
```

**Why this is safe:**
- Follows the identical batched self-scheduling pattern as all other cascade steps
- Uses the pre-existing `by_baseline` index -- no schema change needed
- Existing tests in `convex/extraction/cascade-delete.test.ts` verify the cascade happy path; extend them with a baseline-diff test case
- The cascade only proceeds to Step 9 (delete job) after both Step 8 and Step 8b find zero remaining diffs

**Also fix: Silent truncation in `runDiff` generation (line 956):**
```typescript
// Current: silently truncates
changes: changes.slice(0, 1000),

// Fixed: store truncation metadata
changes: changes.slice(0, 1000),
truncatedTotal: changes.length > 1000 ? changes.length : undefined,
```
This requires adding `truncatedTotal: v.optional(v.number())` to the `extractionRunDiffs` schema. The expand-contract pattern here is trivial since we are only adding an optional field -- single deploy.

**Integration points:**
- **Modified:** `convex/extraction/mutations.ts` -- `deleteExtractionInternal` (add Step 8b)
- **Modified:** `convex/extraction/mutations.ts` -- `runDiff` creation (line 956, add truncation metadata)
- **Modified:** `convex/schema.ts` -- add `truncatedTotal: v.optional(v.number())` to `extractionRunDiffs`
- **Modified:** `convex/extraction/cascade-delete.test.ts` -- add baseline-diff test case
- **No new indexes needed:** `by_baseline` already exists

**Risk:** LOW. The pattern is identical to the existing cascade steps. The index already exists.

## Data Flow Changes Summary

### New Data Flows

| Flow | Trigger | Path |
|------|---------|------|
| Workflow cancellation | User clicks Cancel | `cancelExtraction` -> `workflow.cancel()` -> `pdfProcessingPool.cancel()` per paper |
| Zotero key migration | One-time admin action | `migrateZoteroKeys` action -> encrypt each -> patch row -> unset plaintext |
| OAuth token cleanup | Hourly cron | `cleanupExpiredOAuthTokens` -> delete expired rows |
| User extraction cleanup | Daily cron (existing) | `cleanupDeletedUsers` -> schedule `deleteExtractionInternal` per job |

### Modified Data Flows

| Flow | Change |
|------|--------|
| Cascade delete | Add Step 8b: delete baseline diffs using `by_baseline` index |
| RunDiff generation | Add `truncatedTotal` field when changes exceed 1000 |
| Query return types | 7 queries get typed validators instead of `v.any()` |
| attachReviewMetadata | `any` types replaced with `Doc<"extractionResultReviews">` |
| getJobDetails | Remove `.take(100)` cap, use full collection |

### Removed Data Flows

| Flow | Reason |
|------|--------|
| `/test-sidebar` page render | Dead test route, no references |
| Plaintext `apiKey` fallback reads | After migration, all reads go through `encryptedApiKey` |

## Suggested Build Order (Dependency-Aware)

The 13 concerns have few hard dependencies but several natural clusters. Ordering by dependency chains and risk:

### Phase A: Zero-Risk Standalone Fixes (No Dependencies)

These can be done in any order and do not affect other concerns.

| Order | Concern | Why First |
|-------|---------|-----------|
| 1 | Replace placeholder email in User-Agent | One-line change, zero risk |
| 2 | Remove `/test-sidebar` page | Delete one file, zero dependencies |
| 3 | Document debug endpoint production policy | Documentation only |
| 4 | Type `migrateSearchHistoryState` migration steps | Frontend-only, no backend impact |
| 5 | Replace `any` casts in `attachReviewMetadata` | Contained to one function |

### Phase B: Schema + Query Typing (Shared Foundation)

| Order | Concern | Why Here |
|-------|---------|----------|
| 6 | Create `convex/extraction/validators.ts` + replace `v.any()` | Foundation for typed queries; needed before other query changes |
| 7 | Fix `getJobDetails` 100-paper cap | Uses the new typed validators from step 6 |

### Phase C: Pipeline Behavior Fixes (Extraction Domain)

| Order | Concern | Why Here |
|-------|---------|----------|
| 8 | Fix `cancelExtraction` to actually stop workflow | Independent of typing work; critical bug fix |
| 9 | Fix `runDiff` orphan + silent truncation | Extends cascade delete; requires schema addition for `truncatedTotal` |

### Phase D: Cleanup + Migration (Data Operations)

| Order | Concern | Why Last |
|-------|---------|----------|
| 10 | Add cron for expired Zotero OAuth tokens | Simple cron addition |
| 11 | Extend `cleanupDeletedUsers` for extraction data | Depends on cascade delete being correct (after step 9) |
| 12 | Run Zotero `apiKey` migration (Deploy 1) | Must complete before Deploy 2 |
| 13 | Remove `apiKey` field + fallback code (Deploys 2+3) | Must follow step 12 |

**Phase ordering rationale:**
- Phase A items are isolated and low-risk -- ship early to reduce concern count
- Phase B establishes typed validators that Phase C work benefits from (typed return values when modifying queries)
- Phase C fixes extraction pipeline behavior, which Phase D cleanup operations rely on (cascade delete must be correct before user cleanup reuses it)
- Phase D migration is last because it requires multiple sequential deploys and verification between each

## Anti-Patterns to Avoid

### Anti-Pattern 1: Using cancelAll() on the Shared Workpool

**What people do:** Call `pdfProcessingPool.cancelAll(ctx)` to stop one job's papers
**Why it's wrong:** The workpool is shared across all extraction jobs. `cancelAll` cancels pending work for ALL users' jobs.
**Do this instead:** Query the cancelled job's papers, read each paper's `workId`, call `pdfProcessingPool.cancel(ctx, workId)` individually.

### Anti-Pattern 2: Removing Schema Field Before Data Migration

**What people do:** Remove `apiKey` from schema immediately because it's deprecated
**Why it's wrong:** Convex rejects schema changes if existing documents still have the field populated
**Do this instead:** Three-deploy expand-contract: migrate data -> remove code fallbacks -> remove schema field

### Anti-Pattern 3: Inlining Cascade Delete in cleanupDeletedUsers

**What people do:** Write per-table deletion loops inside the cleanup mutation handler
**Why it's wrong:** Extraction jobs can have hundreds of papers with child records. Inlining will hit Convex's mutation transaction limits.
**Do this instead:** Schedule `deleteExtractionInternal` per job -- it already handles batching, self-scheduling, and storage cleanup.

### Anti-Pattern 4: Defining Validators Inline in Each Query

**What people do:** Write the full validator object literal in each query's `returns` field
**Why it's wrong:** 7 queries return overlapping shapes. Inline validators create 350+ lines of duplicated validator code that must stay in sync.
**Do this instead:** Extract shared validator objects to `convex/extraction/validators.ts` and import them.

## New vs Modified Components

| Type | Component | Action |
|------|-----------|--------|
| NEW | `convex/extraction/validators.ts` | Shared typed validators for extraction documents |
| NEW | `convex/zotero/migrations.ts` | One-time apiKey encryption migration |
| MODIFIED | `convex/extraction/mutations.ts` | cancelExtraction, deleteExtractionInternal, runDiff |
| MODIFIED | `convex/extraction/queries.ts` | v.any() replacement (7 locations), attachReviewMetadata typing, getJobDetails cap |
| MODIFIED | `convex/schema.ts` | Remove apiKey field, add truncatedTotal to runDiffs |
| MODIFIED | `convex/crons.ts` | Add OAuth token cleanup cron |
| MODIFIED | `convex/maintenance/mutations.ts` | Extend cleanupDeletedUsers |
| MODIFIED | `convex/zotero/mutations.ts` | Add cleanupExpiredOAuthTokens |
| MODIFIED | `convex/extraction/actions.ts` | Replace placeholder email |
| MODIFIED | `convex/extraction/workpoolActions.ts` | Remove apiKey fallback |
| MODIFIED | `convex/zotero/actions.ts` | Remove apiKey fallback |
| MODIFIED | `lib/store.ts` | Type migration function signatures |
| DELETED | `app/test-sidebar/page.tsx` | Remove test page |

## Sources

- Convex schema migration approach: [Intro to Migrations](https://stack.convex.dev/intro-to-migrations) -- expand-contract pattern for field removal
- Convex zero-downtime migrations: [Lightweight Migrations](https://stack.convex.dev/lightweight-zero-downtime-migrations)
- `@convex-dev/workflow` WorkflowManager.cancel() -- verified in `node_modules/@convex-dev/workflow/dist/client/index.d.ts` line 109
- `@convex-dev/workpool` Workpool.cancel() and cancelAll() -- verified in `node_modules/@convex-dev/workpool/dist/client/index.d.ts` lines 158-166
- All integration points verified against actual codebase files (HIGH confidence)

---
*Architecture research for: v2.4 Concerns Sweep*
*Researched: 2026-03-02*
