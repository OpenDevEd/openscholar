# Phase 38: Deletion Cascade & Storage Cleanup - Research

**Researched:** 2026-03-02
**Domain:** Convex mutations — batched cascade deletion, scheduler patterns, file storage cleanup
**Confidence:** HIGH

---

## Summary

Phase 38 fixes three data integrity gaps in the extraction job deletion flow. The current `deleteExtractionInternal` mutation (convex/extraction/mutations.ts:968–1009) uses recursive `ctx.runMutation` calls (DATA-02 anti-pattern) and omits several child entity tables from its cascade (DATA-01: `extractionEvidenceUnits` is never deleted). Papers with `storageId` are also not cleaned up during job deletion, only during a cron-driven PDF age cleanup (DATA-03). A standalone path to clean up storage for failed papers (outside of job deletion) does not currently exist.

The fix involves three coordinated changes: (1) Replace recursive `ctx.runMutation` with `ctx.scheduler.runAfter(0, ...)` to correctly decouple batch commits. (2) Expand the cascade to include all child entity tables in correct dependency order: evidence units first, then reviews, then results, then papers (with storage cleanup inline), then questions, then job. (3) Add a public or internal mutation for standalone failed-paper storage cleanup (covering both the job deletion path and a standalone scenario for failed papers that were never part of a completed job deletion).

**Primary recommendation:** Rewrite `deleteExtractionInternal` to use `ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId })` for self-scheduling, delete child entities in strict dependency order, and call `ctx.storage.delete(paper.storageId)` inline when deleting each paper.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DATA-01 | Deletion cascade includes `extractionEvidenceUnits` cleanup | `extractionEvidenceUnits` has `by_paper` index; must be deleted before `extractionPapers` rows. Currently absent from `deleteExtractionInternal`. |
| DATA-02 | Recursive `runMutation` replaced with `scheduler.runAfter(0)` batched deletion | Project already uses `ctx.scheduler.runAfter(0, ...)` in maintenance/mutations.ts:49. Convex best-practices docs confirm this is the correct pattern for self-scheduling batched deletes. |
| DATA-03 | Orphaned PDF storage cleanup covers failed papers and deleted jobs | `ctx.storage.delete(storageId)` is available in mutations. Must be called inline during paper row deletion in cascade AND in a standalone path for failed papers. |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex mutations (`internalMutation`) | project version | Batched delete with scheduler self-scheduling | Transactional DB writes, OCC-safe, native Convex |
| `ctx.scheduler.runAfter` | Convex built-in | Schedule next deletion batch with 0-ms delay | Atomically schedules continuation; if mutation commits, next batch is guaranteed to run |
| `ctx.storage.delete` | Convex built-in | Delete a stored file by `storageId` | Available in mutations, actions, HTTP actions |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `v.id("_storage")` | Convex built-in | Type-validate a storage ID argument | Whenever accepting storageId in mutation args |
| `internal.*` API refs | Convex generated | Refer to internal mutations from scheduler | Required for `ctx.scheduler.runAfter` to schedule an internal mutation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ctx.scheduler.runAfter(0, ...)` | `ctx.runMutation(...)` | `ctx.runMutation` runs the child mutation inside the parent transaction context — it does NOT commit independently. This means if the outer mutation times out before all recursive calls complete, partial deletions may not commit. `runAfter(0)` schedules an independent, committed mutation. |
| Inline storage delete during cascade | Separate storage cleanup cron | Cron-only approach leaves orphaned storage between deletion and next cron run. Inline is simpler and immediate. |

**Installation:** No new packages needed. All primitives are built-in Convex APIs.

---

## Architecture Patterns

### Recommended Project Structure
```
convex/extraction/
├── mutations.ts       # deleteExtraction (public) + deleteExtractionInternal (rewritten)
│                      # cleanupFailedPaperStorage (new internal mutation)
└── (no new files)
```

### Current Entity Hierarchy (what must be deleted)

The following tables must be deleted as part of a job cascade. Dependency order matters — child rows must be deleted before parent rows:

```
extractionJobs (root)
├── extractionQuestions      (by_job index; no children)
├── extractionSavedViews     (by_job index; no children)
├── extractionReportSnapshots(by_job index; no children)
├── extractionRunDiffs        (by_job AND by_baseline indexes; no children)
│   NOTE: a job can appear as baseline_job_id in OTHER jobs' run diffs —
│         only delete diffs where jobId == this job (not where baselineJobId == this job,
│         unless you want to cascade delete those too — out of scope per requirements)
└── extractionPapers          (by_job index)
    ├── storageId → _storage  (call ctx.storage.delete if present; statuses: any, especially download_failed/failed)
    ├── extractionEvidenceUnits (by_paper index; no children) ← DATA-01 gap
    ├── extractionResults       (by_paper index; no children)
    └── extractionResultReviews (by_paper AND by_job indexes; no children)
```

**Current cascade (missing tables highlighted):**
- Deletes: `extractionResults` per paper, then `extractionPapers`, then `extractionQuestions`, then `extractionJobs`
- **Missing**: `extractionEvidenceUnits` (per paper), `extractionResultReviews` (per paper), `extractionSavedViews` (per job), `extractionReportSnapshots` (per job), `extractionRunDiffs` (per job)
- **Missing**: Storage file deletion during paper cleanup

### Pattern 1: Scheduler Self-Scheduling for Batched Deletion
**What:** An `internalMutation` deletes one batch of child entities, then schedules itself again with `ctx.scheduler.runAfter(0, ...)` if more work remains. When all children are gone, it deletes the root document.
**When to use:** Any time deletion of a root entity requires deleting unbounded child rows across multiple tables.
**Example (current pattern used in project):**
```typescript
// Source: convex/maintenance/mutations.ts:49
if (deletedUsers.length === BATCH_SIZE) {
  await ctx.scheduler.runAfter(0, internal.maintenance.mutations.cleanupDeletedUsers, {});
}
```

**Applied to deletion cascade:**
```typescript
// Source: convex/extraction/mutations.ts (to be rewritten)
export const deleteExtractionInternal = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const BATCH_SIZE = 100;

    // Step 1: Delete extractionEvidenceUnits (by_paper)
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    for (const paper of papers) {
      const units = await ctx.db
        .query("extractionEvidenceUnits")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(BATCH_SIZE);
      if (units.length > 0) {
        for (const u of units) await ctx.db.delete(u._id);
        await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
        return null;
      }
    }

    // Step 2: Delete extractionResultReviews (by_paper)
    for (const paper of papers) {
      const reviews = await ctx.db
        .query("extractionResultReviews")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(BATCH_SIZE);
      if (reviews.length > 0) {
        for (const r of reviews) await ctx.db.delete(r._id);
        await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
        return null;
      }
    }

    // Step 3: Delete extractionResults (by_paper)
    for (const paper of papers) {
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(BATCH_SIZE);
      if (results.length > 0) {
        for (const r of results) await ctx.db.delete(r._id);
        await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
        return null;
      }
    }

    // Step 4: Delete extractionPapers + storage cleanup
    const remainingPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (remainingPapers.length > 0) {
      for (const paper of remainingPapers) {
        if (paper.storageId) {
          try {
            await ctx.storage.delete(paper.storageId);
          } catch (e) {
            console.error(`Failed to delete PDF storage for paper ${paper._id}:`, e);
          }
        }
        await ctx.db.delete(paper._id);
      }
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 5: Delete extractionQuestions (by_job)
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (questions.length > 0) {
      for (const q of questions) await ctx.db.delete(q._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 6: Delete extractionSavedViews (by_job)
    const savedViews = await ctx.db
      .query("extractionSavedViews")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (savedViews.length > 0) {
      for (const v of savedViews) await ctx.db.delete(v._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 7: Delete extractionReportSnapshots (by_job)
    const snapshots = await ctx.db
      .query("extractionReportSnapshots")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (snapshots.length > 0) {
      for (const s of snapshots) await ctx.db.delete(s._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 8: Delete extractionRunDiffs (by_job — where this job IS the primary job)
    const runDiffs = await ctx.db
      .query("extractionRunDiffs")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (runDiffs.length > 0) {
      for (const d of runDiffs) await ctx.db.delete(d._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 9: Delete the job itself
    const job = await ctx.db.get(args.jobId);
    if (job) await ctx.db.delete(args.jobId);

    return null;
  },
});
```

### Pattern 2: Standalone Failed-Paper Storage Cleanup
**What:** A separate internal mutation that finds papers in `download_failed` or `failed` status that still have a `storageId`, deletes the storage file, and clears the `storageId` field on the paper record.
**When to use:** (a) As a step in cron-based cleanup, (b) called on-demand for individual papers.

```typescript
// New mutation: cleanupFailedPaperStorage
export const cleanupFailedPaperStorage = internalMutation({
  args: {},
  returns: v.object({ cleaned: v.number() }),
  handler: async (ctx, _args) => {
    const BATCH_SIZE = 50;
    // Find failed papers that still have storageId
    const failedWithStorage: Doc<"extractionPapers">[] = [];

    for (const failStatus of ["download_failed", "failed"] as const) {
      const papers = await ctx.db
        .query("extractionPapers")
        .withIndex("by_job_status", (q) => q.eq("status", failStatus))
        // NOTE: by_job_status index requires jobId prefix — use by_status_completedAt or scan
        // See OPEN QUESTIONS below for index limitation
        .take(BATCH_SIZE);
      failedWithStorage.push(...papers.filter((p) => p.storageId != null));
    }

    let cleaned = 0;
    for (const paper of failedWithStorage) {
      if (!paper.storageId) continue;
      try {
        await ctx.storage.delete(paper.storageId);
        await ctx.db.patch(paper._id, { storageId: undefined });
        cleaned++;
      } catch (e) {
        console.error(`Failed to delete storage for failed paper ${paper._id}:`, e);
      }
    }

    return { cleaned };
  },
});
```

**IMPORTANT NOTE ON INDEX LIMITATION**: The `by_job_status` index on `extractionPapers` is `["jobId", "status"]` — querying by status alone requires `.withIndex("by_job_status", (q) => q.eq("jobId", someJobId).eq("status", ...))`. There is no global status-only index. The existing `by_status_completedAt` index is `["status", "completedAt"]` and applies only to `completed` papers (used by `cleanupOldPdfs`).

For the standalone path, the planner must decide whether to add a new schema index `by_status` on `extractionPapers`, or scan differently. **The phase scope (DATA-03) says "standalone failed-paper cleanup scenarios" — the simplest approach is an internal mutation called from `deleteExtraction` that handles failed papers for the specific job being deleted, rather than a global cross-job scan.**

### Pattern 3: Storage Cleanup on Paper Delete (Inline)
**What:** During Step 4 of the cascade (deleting `extractionPapers`), call `ctx.storage.delete(paper.storageId)` before `ctx.db.delete(paper._id)`.
**Why:** Any paper — regardless of status — may have a `storageId` if it started downloading before failing. The `storageId` field exists on all `extractionPapers` as optional.

```typescript
// Inline during paper deletion (no separate mutation needed)
if (paper.storageId) {
  try {
    await ctx.storage.delete(paper.storageId);
  } catch (e) {
    console.error(`Failed to delete storage for paper ${paper._id}:`, e);
    // Continue — don't let storage failure block DB cleanup
  }
}
await ctx.db.delete(paper._id);
```

### Anti-Patterns to Avoid
- **`ctx.runMutation` for recursive self-calls:** Nests mutations inside the parent transaction context. Does not independently commit. Prefer `ctx.scheduler.runAfter(0, ...)` for independent batch commits.
- **Collecting all papers before checking each child table in a loop:** Calling `.collect()` on `extractionPapers` at the start of every recursive call re-fetches ALL papers. For large jobs this is inefficient but functionally correct. A cursor-based approach is cleaner but adds complexity. Stick with `.collect()` on papers + `.take(BATCH_SIZE)` on child tables for this phase.
- **Deleting papers before their children:** `extractionEvidenceUnits`, `extractionResults`, and `extractionResultReviews` all FK-reference `paperId`. Delete them first to avoid referencing deleted parent IDs.
- **Swallowing storage.delete errors silently without logging:** Always log; the paper DB row can still be deleted even if storage deletion fails (file may already be gone).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transaction size limits | Manual transaction splitting logic | `ctx.scheduler.runAfter(0, ...)` self-scheduling | Convex scheduler provides atomic scheduling — if mutation commits, continuation is guaranteed |
| Storage file cleanup | Custom retry or queue system | `ctx.storage.delete(storageId)` in mutation | Already available in mutations, no external tooling needed |
| Global index scan for failed papers | Full-table scan | Scoped per-job deletion inline with cascade | Avoids unbounded cross-job queries; aligns with the deletion trigger |

**Key insight:** Storage deletion is safe to call from mutations. Error handling should log but never throw (let DB cleanup proceed regardless of storage state).

---

## Common Pitfalls

### Pitfall 1: Missing extractionEvidenceUnits in Cascade
**What goes wrong:** Evidence unit rows remain after job deletion. Papers table is deleted, but `extractionEvidenceUnits` still reference the now-nonexistent `paperId` via FK. Orphaned rows accumulate.
**Why it happens:** `extractionEvidenceUnits` was added after the deletion logic was written; the cascade was never updated.
**How to avoid:** Add the evidence unit deletion step before the results step (they're children of `extractionPapers`, not of `extractionResults`).
**Warning signs:** Querying `extractionEvidenceUnits` after a job deletion returns rows.

### Pitfall 2: Wrong Deletion Order
**What goes wrong:** If `extractionPapers` rows are deleted before their children (`extractionEvidenceUnits`, `extractionResults`, `extractionResultReviews`), child rows reference nonexistent paper IDs. The cascade loop (`collect papers -> for each paper -> take(BATCH) of children`) breaks because `papers` is empty.
**Why it happens:** Mixing up the inside-out dependency order.
**How to avoid:** Strict order: evidence units -> reviews -> results -> papers (with storage) -> questions -> saved views -> report snapshots -> run diffs -> job.

### Pitfall 3: Using ctx.runMutation for Self-Scheduling
**What goes wrong:** `ctx.runMutation(internal.extraction.mutations.deleteExtractionInternal, { jobId })` runs the child mutation inline inside the parent transaction. For large datasets, the outer mutation may time out before completing, leaving partial state.
**Why it happens:** Looks equivalent to `scheduler.runAfter(0)` but commits differently.
**How to avoid:** Use `await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId })`. This schedules an independent, separately committed mutation.

### Pitfall 4: Storage Delete Throws on Missing File
**What goes wrong:** `ctx.storage.delete(storageId)` may throw if the file was already deleted (e.g., by the cron job). If not caught, this aborts the mutation and leaves the paper record in the DB.
**Why it happens:** No idempotency guarantee on `storage.delete`.
**How to avoid:** Wrap in try/catch, log the error, continue. The existing `cleanupOldPdfs` does this correctly (line 1273).

### Pitfall 5: extractionResultReviews has BOTH by_paper and by_job indexes
**What goes wrong:** When deleting via `by_job`, you delete reviews for all papers in the job. When deleting via `by_paper` per paper, you delete the same rows but in a per-paper loop. Either works, but mixing both leads to double-deletion attempts.
**How to avoid:** Pick one: use `by_paper` loop (consistent with the per-paper pattern used for results and evidence units), or use `by_job` as a single batch at the job level. The by_paper approach naturally fits the existing structure.

### Pitfall 6: extractionRunDiffs references two jobs (jobId and baselineJobId)
**What goes wrong:** When deleting job A, you delete diffs where `jobId == A`. But diffs where `baselineJobId == A` (i.e., other jobs that used A as a baseline) would still reference A after deletion. These become orphaned baseline references.
**Resolution:** Per the phase requirements, only delete diffs where `jobId == this job`. The `by_job` index handles this. Diffs where this job is the baseline are NOT deleted (those belong to the other job). This is acceptable — the `baselineJobId` reference becomes stale but doesn't cause data corruption since `extractionRunDiffs` doesn't cascade-delete from elsewhere.

---

## Code Examples

Verified patterns from official sources:

### scheduler.runAfter self-scheduling (already in project)
```typescript
// Source: convex/maintenance/mutations.ts:49
if (deletedUsers.length === BATCH_SIZE) {
  await ctx.scheduler.runAfter(0, internal.maintenance.mutations.cleanupDeletedUsers, {});
}
```

### storage.delete in mutation (already in project)
```typescript
// Source: convex/extraction/mutations.ts:1267-1275
if (paper.storageId) {
  try {
    await ctx.storage.delete(paper.storageId);
    await ctx.db.patch(paper._id, {
      storageId: undefined,
    });
  } catch (error) {
    console.error(`Failed to delete PDF for paper ${paper._id}:`, error);
  }
}
```

### Current deleteExtraction entry point (unchanged except the runMutation → scheduler change)
```typescript
// Source: convex/extraction/mutations.ts:949-966 (current)
export const deleteExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const user = await requireAuth(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) throw createError("NOT_FOUND", "Job not found");

    // Change: replace ctx.runMutation with ctx.scheduler.runAfter(0, ...)
    await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, {
      jobId: args.jobId
    });
    return null;
  }
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ctx.runMutation` for recursive deletion | `ctx.scheduler.runAfter(0, ...)` self-scheduling | Convex best practice (established pattern) | Independent batch commits, no parent transaction timeout risk |

**Deprecated/outdated in this codebase:**
- Recursive `ctx.runMutation` calls in `deleteExtractionInternal`: replaced by `scheduler.runAfter(0)` in this phase.

---

## Open Questions

1. **Index availability for standalone failed-paper storage cleanup**
   - What we know: `by_job_status` requires `jobId` as prefix. `by_status_completedAt` only covers `completed` papers. No global `by_status` index exists on `extractionPapers`.
   - What's unclear: The success criteria say "standalone failed-paper cleanup scenarios" — should this be a global cross-job scan (needs new index or full table scan) or a per-job call?
   - Recommendation: Implement standalone cleanup as a per-job helper called at the START of `deleteExtractionInternal` (handle failed papers for this job before starting cascade). This avoids needing a new index. If truly global standalone cleanup is needed, add a `by_status` index to schema in this phase.

2. **Should extractionRunDiffs where baselineJobId == deletedJobId also be deleted?**
   - What we know: The schema has `by_baseline` index. These diffs belong to OTHER jobs that compared against this job as a baseline.
   - What's unclear: Leaving them creates stale baseline references. Deleting them may affect other jobs' data unexpectedly.
   - Recommendation: Out of scope for this phase. Only delete diffs where `jobId == args.jobId`. The `by_job` index is sufficient.

3. **Do `extractionSavedViews` need to be deleted during job cascade?**
   - What we know: `extractionSavedViews` has `by_job` index; views are job-scoped. Not currently deleted in cascade.
   - What's unclear: Phase success criteria only mention evidence units, reviews, results, papers, questions, and job — not saved views, report snapshots, or run diffs explicitly.
   - Recommendation: Include them for completeness (they're job-scoped orphans otherwise). The success criteria say "zero orphaned rows" and the schema shows `by_job` — include all job-scoped tables in the cascade.

---

## Sources

### Primary (HIGH confidence)
- Project codebase: `convex/extraction/mutations.ts` — current `deleteExtraction` and `deleteExtractionInternal` implementation (lines 949–1009)
- Project codebase: `convex/schema.ts` — full schema showing all tables with `by_job` and `by_paper` indexes
- Project codebase: `convex/maintenance/mutations.ts:49` — `ctx.scheduler.runAfter(0, ...)` pattern in production use
- Project codebase: `convex/extraction/mutations.ts:1251–1280` — `cleanupOldPdfs` pattern for `ctx.storage.delete`
- [Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions) — `ctx.scheduler.runAfter` API
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) — Avoid sequential `ctx.runMutation` calls; prefer single transactions
- [Convex Deleting Files](https://docs.convex.dev/file-storage/delete-files) — `ctx.storage.delete` available in mutations
- [Convex Data Migrations Pattern](https://stack.convex.dev/migrating-data-with-mutations) — Self-scheduling batched delete pattern

### Secondary (MEDIUM confidence)
- [Convex scheduler.runAfter API](https://docs.convex.dev/api/interfaces/server.Scheduler) — Interface documentation confirming atomic scheduling from mutations

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All APIs verified in official Convex docs and existing project code
- Architecture: HIGH — Full entity hierarchy confirmed from schema; deletion order confirmed from dependency analysis
- Pitfalls: HIGH — Derived from direct code inspection of current bugs (missing tables, wrong pattern)

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (Convex API is stable; schema is project-controlled)
