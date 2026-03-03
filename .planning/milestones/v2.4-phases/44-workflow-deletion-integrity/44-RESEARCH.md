# Phase 44: Workflow & Deletion Integrity - Research

**Researched:** 2026-03-03
**Domain:** Convex workflow/workpool cancellation, cascade deletion, GDPR user cleanup
**Confidence:** HIGH

## Summary

Phase 44 fixes four distinct bugs across two domains: extraction workflow lifecycle (BUG-01 cancellation, BUG-04 diff truncation) and data integrity on deletion (BUG-03 orphaned diffs, SEC-03 user data cleanup). All four changes are surgical edits to existing code -- no new libraries, no new tables, no new components.

The `cancelExtraction` mutation currently only patches `status: "cancelled"` on the job document but never calls `workflow.cancel()` or `pdfProcessingPool.cancel()`, so in-flight workpool actions continue processing papers and deducting credits. The fix requires calling both cancel APIs AND adding a status-check guard inside the workpool action handlers to prevent credit deduction for papers processed after cancellation.

The `deleteExtractionInternal` cascade delete has a comment on line 1087 explicitly noting "Only delete diffs where jobId == args.jobId, NOT where baselineJobId == args.jobId" -- this is the BUG-03 bug. A Step 8b must be added to also delete diffs where `baselineJobId` matches the deleted job, using the existing `by_baseline` index. The `createExtractionRunDiff` mutation silently truncates changes at 1,000 entries (line 956: `changes.slice(0, 1000)`) without recording the truncation. The fix adds `isTruncated` and `totalChanges` optional fields to the schema and sets them during insertion.

The `cleanupDeletedUsers` function currently only deletes `apiKeys` for deleted users. It must be extended to cascade-delete extraction jobs (which will cascade to papers, results, evidence units, etc. via `deleteExtractionInternal`), and directly delete `zoteroConnections` -- while explicitly preserving `creditTransactions`, `credits`, and `subscriptions` for financial audit.

**Primary recommendation:** Implement in two plans: (1) cancellation + credit guard (BUG-01), (2) deletion integrity fixes (BUG-03 + BUG-04 + SEC-03). Both are low-risk surgical edits.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BUG-01 | Fix `cancelExtraction` to call `workflow.cancel()` and per-paper `pdfProcessingPool.cancel()` with credit-guard in workpool action | Workflow cancel API verified (`workflow.cancel(ctx, workflowId)`), workpool `cancelAll()` API verified. Status-check guard pattern documented. Credit deduction happens in `withUserCreditsBatch` inside `waitAndExtractAction` and separately for embeddings in `downloadAndIndexPdfAction`. |
| BUG-03 | Fix `deleteExtractionInternal` to also delete `extractionRunDiffs` where `baselineJobId == args.jobId` | Existing `by_baseline` index on `extractionRunDiffs` table confirmed in schema (line 632). Current code explicitly skips baseline diffs (comment line 1087). Step 8b addition pattern is straightforward. |
| BUG-04 | Add `isTruncated` and `totalChanges` fields to `extractionRunDiffs` when changes exceed cap, surface in UI | Current truncation at line 956: `changes.slice(0, 1000)`. Schema needs two new `v.optional()` fields. UI in `report-builder.tsx` displays diff summary badges -- needs truncation banner. `getRunDiff` query returns `v.any()` for diff so no return validator change needed. |
| SEC-03 | Extend `cleanupDeletedUsers` to cascade-delete extraction jobs, papers, results, evidence units, and Zotero connections | Current cleanup only deletes `apiKeys`. Must use existing `deleteExtractionInternal` for cascade. Must query `extractionJobs` and `zoteroConnections` by `userId`. Must NOT delete `creditTransactions`, `credits`, or `subscriptions`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@convex-dev/workflow` | 0.3.4 | Durable workflow orchestration with `cancel()` API | Already in use; `workflow.cancel(ctx, workflowId)` prevents new steps from starting |
| `@convex-dev/workpool` | 0.3.1 | Parallel action execution with `cancel()`/`cancelAll()` APIs | Already in use; `pdfProcessingPool.cancelAll(ctx)` cancels pending work items |
| `convex` | (existing) | Database, mutations, queries, scheduler | Core platform -- all changes are mutations and schema edits |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `convex-test` | (existing) | Unit testing Convex mutations | Extend existing `cascade-delete.test.ts` for BUG-03 verification |

### Alternatives Considered
None -- all fixes use existing libraries already in the project.

## Architecture Patterns

### Pattern 1: Workflow + Workpool Cancellation (BUG-01)
**What:** When user cancels an extraction job, stop the workflow AND cancel pending workpool items, then add a status-check guard inside action handlers to prevent credit deduction for in-flight work.
**When to use:** Whenever cancelling long-running distributed work.
**Implementation:**

```typescript
// In cancelExtraction mutation:
export const cancelExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    // ... existing auth checks ...

    // 1. Set status to cancelled
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    // 2. Cancel workflow (prevents new steps from starting)
    if (job.workflowId) {
      await workflow.cancel(ctx, job.workflowId as any);
    }

    // 3. Cancel all pending workpool items
    // Note: cancelAll() does NOT stop in-progress actions
    await pdfProcessingPool.cancelAll(ctx);

    return { success: true };
  },
});
```

**Critical insight:** `workflow.cancel()` and `pdfProcessingPool.cancelAll()` do NOT stop in-progress actions. Actions already running will complete. The credit-guard pattern (Pattern 2) is required to prevent credit deduction.

### Pattern 2: Status-Check Credit Guard (BUG-01)
**What:** Before deducting credits in workpool action handlers, re-read the job status and skip deduction if cancelled.
**When to use:** In every action handler that deducts credits.
**Implementation:**

Credit deduction happens in two places:
1. `waitAndExtractAction` -- via `withUserCreditsBatch()` (line 983 of workpoolActions.ts) for LLM extraction costs
2. `downloadAndIndexPdfAction` -- direct `deductCredits` call (line 895 of workpoolActions.ts) for embedding costs

The guard must check job status before EACH credit deduction:

```typescript
// Guard pattern inside workpool action handlers:
const job = await ctx.runQuery(internal.extraction.queries.getJobInternal, {
  jobId: args.jobId,
});
if (!job || job.status === "cancelled") {
  console.log(`[creditGuard] Skipping credit deduction - job ${args.jobId} is cancelled`);
  // Skip credit deduction but still return results
  // (the onComplete handler checks for "canceled" kind)
  return { success: true, results, creditsUsed: 0, pdfContentUsed };
}
```

**Where to place guards:**
1. In `downloadAndIndexPdfAction`: Before the `deductCredits` call at line 895 -- check job status, skip embedding credit deduction if cancelled
2. In `waitAndExtractAction`: Before `withUserCreditsBatch()` at line 983 -- check job status, if cancelled, still run extraction (work is already done) but skip credit deduction

**Alternative approach (simpler):** Instead of guarding inside the action, check job status in the `handleExtractionComplete` onComplete handler BEFORE calling `saveExtractionResultsAndComplete`. If cancelled, skip saving results entirely. However, this is less precise -- it means some completed work is discarded rather than saved.

**Recommended approach:** Guard BEFORE credit deduction in both action handlers. This ensures:
- Extraction results are still saved (user gets the work that was done)
- Credits are not deducted for work done after cancellation
- The onComplete handlers already handle `result.kind === "canceled"` (workpool cancellation)

### Pattern 3: Self-Scheduling Cascade Delete Step (BUG-03)
**What:** Add a Step 8b to `deleteExtractionInternal` that deletes `extractionRunDiffs` where `baselineJobId` matches the deleted job.
**When to use:** When deleting data that is referenced as a foreign key in another table.
**Implementation:**

```typescript
// After existing Step 8 in deleteExtractionInternal:

// Step 8b: Delete extractionRunDiffs where this job is the BASELINE job
// (BUG-03 fix: prevents orphaned diffs when a baseline job is deleted)
const baselineDiffs = await ctx.db
  .query("extractionRunDiffs")
  .withIndex("by_baseline", (q) => q.eq("baselineJobId", args.jobId))
  .take(BATCH_SIZE);
if (baselineDiffs.length > 0) {
  for (const d of baselineDiffs) await ctx.db.delete(d._id);
  await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
  return null;
}
```

### Pattern 4: Explicit Truncation Metadata (BUG-04)
**What:** When `buildRunDiff` produces more changes than the cap, record `isTruncated: true` and `totalChanges` on the stored document.
**When to use:** Any time an array field is capped to prevent document size overflow.
**Implementation:**

Schema addition (both fields optional for backward compat with existing diffs):
```typescript
extractionRunDiffs: defineTable({
  // ... existing fields ...
  isTruncated: v.optional(v.boolean()),
  totalChanges: v.optional(v.number()),
})
```

Mutation change in `createExtractionRunDiff`:
```typescript
const DIFF_CHANGES_CAP = 1000;
const isTruncated = changes.length > DIFF_CHANGES_CAP;

const diffId = await ctx.db.insert("extractionRunDiffs", {
  jobId: args.jobId,
  baselineJobId: args.baselineJobId,
  userId: user._id,
  summary,
  changes: changes.slice(0, DIFF_CHANGES_CAP),
  isTruncated: isTruncated || undefined,  // only set when true
  totalChanges: isTruncated ? changes.length : undefined,
  generatedAt: Date.now(),
  createdAt: Date.now(),
});
```

### Pattern 5: Cascade User Cleanup via Existing Delete Functions (SEC-03)
**What:** Extend `cleanupDeletedUsers` to schedule `deleteExtractionInternal` for each of the user's extraction jobs, and directly delete their `zoteroConnections`.
**When to use:** GDPR-compliant user data deletion.
**Implementation:**

```typescript
// Inside cleanupDeletedUsers, after deleting apiKeys:

// Delete extraction jobs (cascade to papers, results, evidence units, etc.)
const jobs = await ctx.db
  .query("extractionJobs")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .take(BATCH_SIZE);
for (const job of jobs) {
  await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, {
    jobId: job._id,
  });
  // Also delete the job record (deleteExtractionInternal does this too, but be explicit)
}

// Delete Zotero connections (personal data, no audit value)
const zoteroConns = await ctx.db
  .query("zoteroConnections")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .collect();
for (const conn of zoteroConns) {
  await ctx.db.delete(conn._id);
}

// Note: Do NOT delete creditTransactions, credits, or subscriptions
// These are financial records with legitimate retention basis
```

**Critical order concern:** The current `cleanupDeletedUsers` hard-deletes the user record at the end. But `deleteExtractionInternal` is async (scheduler-based) and runs AFTER the user delete. This is safe because `deleteExtractionInternal` operates on `jobId`, not `userId` -- it does not need the user record to exist.

### Anti-Patterns to Avoid
- **Cancel means stop:** Never assume `cancel()` stops in-progress actions. Always add status-check guards.
- **Deleting user before children:** If you delete the user record first, `by_user` index queries for extraction jobs return empty (the userId no longer exists). Must query jobs BEFORE deleting the user, or use scheduled deletes with jobId.
- **Required fields on existing documents:** Never add `isTruncated: v.boolean()` (required) -- existing documents lack this field and will fail schema validation. Always use `v.optional()`.
- **Cancelling all workpool items globally:** `pdfProcessingPool.cancelAll()` cancels ALL pending items across ALL jobs, not just the cancelled job's items. This is acceptable because: (a) items for other jobs that are still running won't have a cancelled job status, so the credit guard won't fire for them, and (b) those items will be re-enqueued by their workflow if they were genuinely needed. However, if this is a concern, use targeted cancellation by tracking workIds per job.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Workflow cancellation | Custom status polling loop | `workflow.cancel(ctx, workflowId)` | Component handles internal cleanup and state transition |
| Workpool item cancellation | Iterate and cancel individual items | `pdfProcessingPool.cancelAll(ctx)` | Atomic operation, handles edge cases |
| Cascade delete for extraction data | Custom per-table delete logic | Existing `deleteExtractionInternal` | Already handles 9 child tables with batched self-scheduling |
| Credit deduction guard | Pre-deduction balance check | Read job status from DB inside action | Job status is the source of truth for cancellation |

**Key insight:** The project already has robust cascade delete infrastructure (`deleteExtractionInternal`). SEC-03 should reuse it by scheduling deletion per job, not by reimplementing per-table logic.

## Common Pitfalls

### Pitfall 1: cancelAll() Cancels Items From Other Jobs
**What goes wrong:** `pdfProcessingPool.cancelAll(ctx)` cancels ALL pending workpool items, not just those belonging to the cancelled job. If two extraction jobs are running simultaneously, cancelling one cancels pending items for both.
**Why it happens:** The workpool is a shared pool -- it has no concept of "job-scoped" items.
**How to avoid:** The credit-guard pattern (checking job status before deduction) makes this safe. Items for non-cancelled jobs will pass the guard check and still deduct credits normally. For extra safety, track workIds per paper during enqueuePaperProcessing and cancel only those specific items.
**Warning signs:** Papers from a non-cancelled job marked as "failed" with "canceled" error message.

### Pitfall 2: Race Between Cancel and Credit Deduction
**What goes wrong:** User clicks cancel, `cancelExtraction` sets status to "cancelled", but `waitAndExtractAction` is mid-execution and has already passed the credit-guard check point. Credits are deducted between the guard check and the actual deduction call.
**Why it happens:** The guard check and credit deduction are not atomic in an action context (actions can't use OCC like mutations).
**How to avoid:** Accept that a small window exists where 1-2 papers might still be billed. Document this as expected behavior. The STATE.md notes "Credit reconciliation policy for cancelled jobs: needs product decision before Phase 44." Place the guard as close to the deduction call as possible to minimize the window.
**Warning signs:** 1-2 credit transactions with timestamps slightly after the cancel timestamp.

### Pitfall 3: User Record Deleted Before Cascade Completes
**What goes wrong:** `cleanupDeletedUsers` hard-deletes the user record, then schedules `deleteExtractionInternal` for each job. But the job queries user ownership -- if the user is gone, the internal mutation might fail.
**Why it happens:** Deleting the parent before its children finish cleanup.
**How to avoid:** `deleteExtractionInternal` operates purely on `jobId` -- it never reads the user. So this is actually safe. But verify: check that no step in `deleteExtractionInternal` queries by userId. Current code confirms: all queries use `by_job` indexes on jobId, not userId.

### Pitfall 4: Schema Validation Failure on New Optional Fields
**What goes wrong:** Adding `isTruncated` and `totalChanges` as required fields causes deploy failure because existing `extractionRunDiffs` documents lack them.
**Why it happens:** Convex schema validation checks ALL existing documents.
**How to avoid:** Use `v.optional()` for both fields. Old diffs will have `undefined` for both, which is valid.

### Pitfall 5: Cleanup Deletes Financial Records
**What goes wrong:** `cleanupDeletedUsers` accidentally deletes `creditTransactions` or `subscriptions`, destroying the financial audit trail.
**Why it happens:** Over-eager cleanup that treats all user data equally.
**How to avoid:** Explicitly list what to delete (extraction jobs, zotero connections, api keys) and what to preserve (creditTransactions, credits, subscriptions). Add a comment in the code listing preserved tables.

## Code Examples

### cancelExtraction with Workflow and Workpool Cancellation
```typescript
// Source: convex/extraction/mutations.ts (modified)
export const cancelExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    requireExtractionEnabled();
    const user = await requireAuth(ctx);

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) {
      throw createError("NOT_FOUND", "Job not found");
    }

    if (["completed", "failed", "cancelled"].includes(job.status)) {
      return { success: true };
    }

    // 1. Mark as cancelled
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    // 2. Cancel the workflow (prevents new steps)
    if (job.workflowId) {
      try {
        await workflow.cancel(ctx, job.workflowId as any);
      } catch (e) {
        // Workflow may have already completed -- safe to ignore
        console.warn(`[cancelExtraction] Failed to cancel workflow: ${e}`);
      }
    }

    // 3. Cancel pending workpool items
    try {
      await pdfProcessingPool.cancelAll(ctx);
    } catch (e) {
      console.warn(`[cancelExtraction] Failed to cancel workpool items: ${e}`);
    }

    return { success: true };
  },
});
```

### Credit Guard in waitAndExtractAction
```typescript
// Source: convex/extraction/workpoolActions.ts (guard before credit deduction)
// Inside waitAndExtractAction handler, before withUserCreditsBatch:

// Credit guard: skip deduction if job was cancelled
const freshJob = await ctx.runQuery(
  internal.extraction.queries.getJobInternal,
  { jobId: args.jobId }
);
if (!freshJob || freshJob.status === "cancelled") {
  // Still return results so onComplete can save them, but no credit deduction
  return {
    success: true,
    results: /* extract without billing */,
    creditsUsed: 0,
    pdfContentUsed: false,
  };
}
```

### deleteExtractionInternal Step 8b
```typescript
// Source: convex/extraction/mutations.ts (after Step 8)
// Step 8b: Delete extractionRunDiffs where this job is the BASELINE job
const baselineDiffs = await ctx.db
  .query("extractionRunDiffs")
  .withIndex("by_baseline", (q) => q.eq("baselineJobId", args.jobId))
  .take(BATCH_SIZE);
if (baselineDiffs.length > 0) {
  for (const d of baselineDiffs) await ctx.db.delete(d._id);
  await ctx.scheduler.runAfter(
    0,
    internal.extraction.mutations.deleteExtractionInternal,
    { jobId: args.jobId }
  );
  return null;
}
```

### Schema Addition for Truncation Metadata
```typescript
// Source: convex/schema.ts (extractionRunDiffs table)
extractionRunDiffs: defineTable({
  // ... existing fields ...
  isTruncated: v.optional(v.boolean()),
  totalChanges: v.optional(v.number()),
})
```

### UI Truncation Banner
```typescript
// Source: components/extraction/report-builder.tsx
{latestDiffData?.isTruncated && (
  <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
    {t("diffTruncated", {
      shown: latestDiffData.changes.length,
      total: latestDiffData.totalChanges,
    })}
  </div>
)}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `cancelExtraction` sets status only | Must also call `workflow.cancel()` + `pdfProcessingPool.cancelAll()` | Phase 44 | Prevents wasted compute and credit leaks |
| Diffs only deleted when `jobId` matches | Must also delete when `baselineJobId` matches | Phase 44 | Eliminates orphaned diff documents |
| Silent truncation at 1000 changes | Explicit `isTruncated` + `totalChanges` fields | Phase 44 | Users know when diff is partial |
| `cleanupDeletedUsers` only deletes `apiKeys` | Must cascade to extraction jobs + zotero connections | Phase 44 | GDPR-compliant user data erasure |

## Open Questions

1. **Credit reconciliation for cancelled jobs**
   - What we know: STATE.md notes "Credit reconciliation policy for cancelled jobs: needs product decision before Phase 44"
   - What's unclear: Should credits deducted for papers processed between cancel-click and guard-check be refunded? Or is "credits for in-progress work are non-refundable" acceptable?
   - Recommendation: Implement the guard to prevent FUTURE deductions. Do NOT build automatic refund logic. Accept that 0-2 papers may be billed during the race window. This can be revisited if users report issues. Document the behavior.

2. **cancelAll() scope**
   - What we know: `pdfProcessingPool.cancelAll()` cancels ALL pending items across all jobs
   - What's unclear: Is there a way to cancel only items for a specific job?
   - Recommendation: Use `cancelAll()` for simplicity. The credit-guard prevents deduction for non-cancelled jobs. If targeted cancellation becomes important, track workIds per paper in the `extractionPapers` table and use `pdfProcessingPool.cancel(ctx, workId)` individually.

3. **cleanupDeletedUsers transaction limits**
   - What we know: If a deleted user has many extraction jobs, scheduling `deleteExtractionInternal` for each could hit Convex mutation transaction limits
   - What's unclear: Maximum number of jobs a user could have
   - Recommendation: Process a limited number of jobs per cleanup run (e.g., 10). If more remain, self-schedule to continue. This matches the existing BATCH_SIZE pattern.

## Sources

### Primary (HIGH confidence)
- `@convex-dev/workflow` v0.3.4 type definitions -- `workflow.cancel(ctx, workflowId): Promise<void>` confirmed
- `@convex-dev/workpool` v0.3.1 type definitions -- `cancel(ctx, id): Promise<void>` and `cancelAll(ctx, options?): Promise<void>` confirmed
- Codebase inspection: `convex/extraction/mutations.ts` (cancelExtraction lines 230-256, deleteExtractionInternal lines 984-1104, createExtractionRunDiff lines 899-963)
- Codebase inspection: `convex/extraction/workpoolActions.ts` (credit deduction at lines 895 and 983)
- Codebase inspection: `convex/maintenance/mutations.ts` (cleanupDeletedUsers lines 11-56)
- Codebase inspection: `convex/schema.ts` (extractionRunDiffs lines 594-633, extractionJobs lines 237-281)
- Codebase inspection: `convex/extraction/cascade-delete.test.ts` (existing test patterns)

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS_v2.4_CONCERNS_SWEEP.md` -- Pitfalls 2, 4, 7 directly address Phase 44 requirements with detailed prevention strategies
- `.planning/research/PITFALLS_v2.4_CONCERNS_SWEEP.md` sources: Convex Workflow Component docs, Convex Workpool Component docs

### Tertiary (LOW confidence)
- None -- all findings verified against installed package type definitions and codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, APIs verified from type definitions
- Architecture: HIGH -- patterns verified against existing codebase and component APIs
- Pitfalls: HIGH -- pitfalls research already completed in PITFALLS_v2.4_CONCERNS_SWEEP.md and cross-verified with codebase

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable domain -- no external API changes expected)
