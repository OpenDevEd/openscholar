# Extraction Workflow Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make indexing and extraction reliable: PDFs are indexed immediately, results use PDF chunks, and job progress no longer relies on cron.

**Architecture:** Use workflow + workpool only. RAG `add` runs synchronously, then mark `isIndexed` directly. Job progress is finalized via `finalizeJobIfDone` on workpool completion, avoiding hot counter writes.

**Tech Stack:** Convex workflow/workpool, `@convex-dev/rag`, Vercel AI SDK (`generateObject`).

---

### Task 1: Remove cron-driven extraction processing

**Files:**
- Modify: `convex/crons.ts`
- Modify: `convex/extraction/mutations.ts`

**Step 1: Remove cron schedule**

```ts
// remove "process extraction papers" cron
```

**Step 2: Delete/disable `updateAllJobProgress` and `updateJobProgress`**

```ts
// remove these internal mutations
```

**Step 3: Verify no references**

Run: `rg "updateAllJobProgress|updateJobProgress" convex -g "*.ts"`
Expected: no matches

**Step 4: Commit**

```bash
git add convex/crons.ts convex/extraction/mutations.ts
git commit -m "chore: remove cron-based extraction processing"
```

---

### Task 2: Mark indexing immediately after `rag.add`

**Files:**
- Modify: `convex/extraction/workpoolActions.ts`
- Modify: `convex/extraction/mutations.ts`

**Step 1: Add mutation `markPaperIndexed`**

```ts
export const markPaperIndexed = internalMutation({
  args: { paperId: v.id("extractionPapers"), ragEntryId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = { isIndexed: true, indexedAt: Date.now() };
    if (args.ragEntryId) updates.ragEntryId = args.ragEntryId;
    await ctx.db.patch(args.paperId, updates);
  },
});
```

**Step 2: In `downloadAndIndexPdfAction`, call `markPaperIndexed` after `rag.add`**

```ts
const ragResult = await rag.add(...);
await ctx.runMutation(internal.extraction.mutations.markPaperIndexed, {
  paperId: args.paperId,
  ragEntryId: ragResult.entryId,
});
```

**Step 3: Remove indexing polling in `waitAndExtractAction`**

```ts
const isIndexed = !!paper.isIndexed || !!paper.ragEntryId;
```

**Step 4: Commit**

```bash
git add convex/extraction/workpoolActions.ts convex/extraction/mutations.ts
git commit -m "fix: mark rag indexing immediately"
```

---

### Task 3: Fix RAG search parsing

**Files:**
- Modify: `convex/extraction/workpoolActions.ts`

**Step 1: Handle `result.content[]` and fallback**

```ts
const getChunksFromResult = (result: any) =>
  Array.isArray(result?.content)
    ? result.content
    : [{ text: result?.text ?? "", metadata: result?.metadata ?? {} }];
```

**Step 2: Use helper in `performHybridSearch`**

```ts
for (const chunk of getChunksFromResult(result)) { ... }
```

**Step 3: Commit**

```bash
git add convex/extraction/workpoolActions.ts
git commit -m "fix: robust rag search parsing"
```

---

### Task 4: Finalize jobs in workpool completion

**Files:**
- Modify: `convex/extraction/mutations.ts`

**Step 1: Add `finalizeJobIfDone`**

```ts
export const finalizeJobIfDone = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    const papers = await ctx.db.query("extractionPapers").withIndex("by_job", q => q.eq("jobId", jobId)).collect();
    if (papers.length === 0) return;
    const completed = papers.filter(p => p.status === "completed").length;
    const failed = papers.filter(p => ["failed","download_failed","indexing_failed"].includes(p.status)).length;
    if (completed + failed < papers.length) {
      await ctx.db.patch(jobId, { updatedAt: Date.now() });
      return;
    }
    const status = failed === papers.length ? "failed" : "completed";
    await ctx.db.patch(jobId, {
      status,
      processedPapers: completed,
      failedPapers: failed,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
```

**Step 2: Call `finalizeJobIfDone` from `handleDownloadAndIndexComplete`, `handleExtractionComplete`, `handlePaperComplete`**

**Step 3: Commit**

```bash
git add convex/extraction/mutations.ts
git commit -m "fix: finalize jobs in workpool completion"
```

---

### Task 5: Remove legacy extraction paths

**Files:**
- Delete: `convex/extraction/startAction.ts`
- Delete: `convex/extraction/processors.ts`
- Delete: `convex/extraction/fetchPapersAction.ts`
- Replace: `convex/extraction/actions.ts` (keep only `fetchPapersFromHistory`)
- Update: `convex/extraction/index.ts`

**Step 1: Remove unused exports**

```ts
// keep fetchPapersFromHistory and workpool actions only
```

**Step 2: Commit**

```bash
git add convex/extraction/actions.ts convex/extraction/index.ts convex/extraction/startAction.ts convex/extraction/processors.ts convex/extraction/fetchPapersAction.ts
git commit -m "chore: remove legacy extraction paths"
```

---

### Task 6: Update tests + verification

**Files:**
- Modify: `convex/extraction/test_automation_internal.ts`
- Modify: `convex/extraction/test_automation.ts`

**Step 1: Add indexed/pdfContentUsed checks**

**Step 2: Run**

Run: `npx convex run internal.extraction.test_automation.runPdfTestNow`
Expected: PASS with indexed > 0 and pdfContentUsed > 0.

**Step 3: Commit**

```bash
git add convex/extraction/test_automation_internal.ts convex/extraction/test_automation.ts
git commit -m "test: assert pdf indexing and usage"
```

---

### Task 7: Backfill existing indexed papers

Run: `npx convex run internal.extraction.mutations.backfillIsIndexed` until `hasMore: false`.

---

Plan complete and saved to `docs/plans/2026-02-02-extraction-workflow-fix.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
