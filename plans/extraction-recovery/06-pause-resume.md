# Plan 06 — Pause / Resume (Cooperative, Workflow-Gated)

**Depends on:** 01 (taxonomy), 02 (per-question granularity), 03 (status machine + `creditsExhausted`). **Blocks:** 07 (polish).

## Goal

User clicks Pause. Any in-flight question finishes its LLM call. No new questions get dispatched. Job status shows `paused`. Later, user clicks Resume. Processing picks up from the next question, with no re-billing of anything already billed.

Closes gap #6.

## Approach: workflow-gated cooperative pause (no pool-level pause)

The research surfaced two primitives:
1. **Workpool** has native pause: `components.pdfProcessingPool.config.update({ maxParallelism: 0 })`. But this is pool-global — pausing job A pauses other users' jobs sharing the pool.
2. **Workflow** has `step.awaitEvent({ name })` + `sendEvent` for cooperative resume.

We use **workflow-gate only** (no pool pause). The enqueue loop checks `job.status` before each question dispatch and `awaitEvent` if paused. Cost: up to `maxParallelism` already-enqueued questions will still start — each one early-returns from `extractOneQuestion` on a status re-check. Small, bounded, and isolates pause to one job.

User choice made in the grill: "you can wait for the llm to finish" → this approach is consistent.

## Scope

**In scope**
- New status value `paused` on `extractionJobs.status` (added by plan 03's schema change; this plan wires behavior).
- `pauseExtraction(jobId)` public mutation.
- `resumeExtraction(jobId)` public mutation (also used by `creditsExhausted` auto-pause).
- Workflow gate: `step.awaitEvent({ name: `resume:${jobId}` })` between enqueue batches.
- `extractOneQuestion` skip-guard: read `job.status` at entry; if `paused|creditsExhausted|cancelled`, early-return without billing.
- UI: Pause button while running; Resume button while paused. Pause confirmation optional.
- Idempotent resume: calling Resume on a non-paused job is a no-op (doesn't throw).
- Resume from `creditsExhausted` shares this plumbing (plan 03 left the hook; plan 06 wires it).

**Out of scope**
- Pool-level pause primitive (explicitly rejected for cross-job isolation).
- Pause/resume partial-question state (we let the current question finish cleanly).

## Design

### Status transitions (update `convex/extraction/stateMachine.ts`)

```
pending → downloading_pdfs | indexing | extracting | paused | cancelled | failed
running states → paused | creditsExhausted | completed | failed | cancelled
paused → extracting | cancelled
creditsExhausted → extracting | cancelled
```

`paused` and `creditsExhausted` are non-terminal; resume transitions them back to `extracting` (or `downloading_pdfs` / `indexing` if we paused mid-earlier-phase — tracked by `job.pausedFromStatus` field).

### Schema additions

```ts
extractionJobs: {
  // ... existing ...
  pausedAt: v.optional(v.number()),
  pausedFromStatus: v.optional(v.union(...allRunningStatuses)),  // to resume to the right state
}
```

### Pause mutation

```ts
// convex/extraction/mutations/pause.ts
export const pauseExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    const user = await requireAuth(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.userId !== user._id) throw ownershipError();
    if (!RUNNING_STATUSES.has(job.status)) return; // idempotent
    await ctx.db.patch(jobId, {
      status: "paused",
      pausedAt: Date.now(),
      pausedFromStatus: job.status,
    });
    // Note: no pool-level pause, no workflow cancel. The gate handles it.
  },
});
```

### Resume mutation

```ts
export const resumeExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    const user = await requireAuth(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.userId !== user._id) throw ownershipError();
    if (job.status !== "paused" && job.status !== "creditsExhausted") return; // idempotent
    
    // If credits-exhausted, do a post-pause credit pre-flight check
    if (job.status === "creditsExhausted") {
      const remaining = await getRemainingEstimate(ctx, jobId); // plan 03/04 query
      const balance = await getAvailableCredits(ctx, user._id);
      if (balance < remaining.high) throw createTaxonomyError("insufficient_credits", { ... });
    }

    await ctx.db.patch(jobId, {
      status: job.pausedFromStatus ?? "extracting",
      pausedAt: undefined,
      pausedFromStatus: undefined,
      error: undefined, // clear any stale creditsExhausted error
    });

    // Wake the workflow
    await sendEvent(ctx, components.workflow, {
      name: `resume:${jobId}`,
      workflowId: job.workflowId as WorkflowId,
    });
  },
});
```

### Workflow gate

In `convex/extraction/workflow.ts` (post-plan-02 shape):

```ts
export const runExtractionWorkflow = workflow.define({
  args: { jobId: v.id("extractionJobs") },
  handler: async (step, { jobId }) => {
    const papers = await step.runQuery(internal.ext.queries.listPapersForWorkflow, { jobId });
    
    for (const paper of papers) {
      // Gate BEFORE each paper
      const status = await step.runQuery(internal.ext.queries.getJobStatusForWorkflow, { jobId });
      if (status === "paused" || status === "creditsExhausted") {
        await step.awaitEvent({ name: `resume:${jobId}` });
      }
      if (status === "cancelled") return;
      
      await step.runAction(internal.ext.downloadAndIndex, { paperId: paper._id },
        { retry: true, name: `dl:${paper._id}` });

      const questions = await step.runQuery(internal.ext.queries.listQuestions, { jobId });
      for (const q of questions) {
        // Per-question gate (cheap — re-query doesn't re-execute on replay)
        const s = await step.runQuery(internal.ext.queries.getJobStatusForWorkflow, { jobId });
        if (s === "paused" || s === "creditsExhausted") {
          await step.awaitEvent({ name: `resume:${jobId}` });
        }
        if (s === "cancelled") return;
        
        await step.runAction(internal.ext.extractOneQuestion,
          { paperId: paper._id, questionId: q._id },
          { retry: true, name: `q:${paper._id}:${q._id}` });
      }
      await step.runMutation(internal.ext.finalizePaper, { paperId: paper._id });
    }
    
    await step.runMutation(internal.ext.finalizeJob, { jobId });
  },
});
```

### Skip-guard in `extractOneQuestion`

At the top of the action, after argument validation:

```ts
const job = await ctx.runQuery(internal.ext.queries.getJobStatusForAction, { jobId });
if (job.status === "paused" || job.status === "creditsExhausted" || job.status === "cancelled") {
  return { success: true, skipped: true };  // workpool marks success; no-op
}
```

Why both gate AND skip-guard? The workflow gate stops NEW dispatches. But the pool may already have a few questions in-flight when pause is clicked; the skip-guard prevents them from billing.

**But** — user said "let in-flight LLM finish". So we have two sub-options:
- **Hard skip**: return before LLM. Wasted workpool slot but no credit spent.
- **Soft finish**: proceed if already past an "about to call LLM" checkpoint; else skip.

Go **hard skip**. "Let LLM finish" applies to questions where the LLM call is already in-flight (mid-fetch). Re-check status immediately before the LLM call; if paused, early-return. After the fetch is already going (JS can't abort an LLM HTTP call mid-body without an AbortController), we let it complete — and then the result save is safe via idempotency.

Actually cleaner: pass an `AbortController` to the LLM SDK. On status poll inside the action showing `paused`, abort. Existing error taxonomy has `aborted` as retryable — this becomes a natural retry-on-resume.

```ts
const controller = new AbortController();
const statusCheck = pollJobStatus(ctx, jobId, controller);  // runs alongside
try {
  const answer = await llm.extractQuestion(..., { signal: controller.signal });
  await recordOneAnswer(ctx, { resultId, answer });
} catch (e) {
  const classified = classifyUnknownError(e);
  if (classified.code === "aborted") return { success: true, skipped: true };
  throw e;
}
```

But user said "you can wait for the LLM to finish" — so go simpler: no AbortController, single pre-LLM status check, let anything that slipped past the check finish naturally. Idempotent save handles the rest. `aborted` code reserved for explicit user cancel only.

**Final decision**: single status check at action entry. If paused, skip. If not, proceed and let it finish. This is the "wait for LLM to finish" policy the user chose.

### UI

`app/extraction/[jobId]/page.tsx` header:
- While status ∈ running: show `[Pause]` button next to Cancel.
- While status = `paused`: show `[Resume]` button + banner "Extraction paused · 23/100 papers done".
- While status = `creditsExhausted`: already handled by plan 03. Resume button disabled until balance sufficient.
- Data attrs: `data-job-status` on the container so tests can target it.

Accessibility: status banner has `role="status"`, `aria-live="polite"`. State changes announce.

Pause confirmation: optional. Skip for v1 — pause is reversible. Skip.

### Analytics

PostHog: `extraction_job_paused` (duration_so_far, processed_papers), `extraction_job_resumed` (paused_for_ms, source: "user" | "credits_topup").

## TDD sequence (pure logic only — `lib/extraction/transitions.ts`)

The pause/resume mutations are thin wrappers around two pure decision functions. Drive those first; the mutations become trivial.

```
# validatePauseTransition(currentStatus)
R1 → G1   test: from "extracting" → {ok:true, nextStatus:"paused", pausedFrom:"extracting"}
R2 → G2   test: from "downloading_pdfs" → {ok:true, nextStatus:"paused", pausedFrom:"downloading_pdfs"}
R3 → G3   test: from "indexing" → {ok:true, nextStatus:"paused", pausedFrom:"indexing"}
R4 → G4   test: from "paused" → {ok:false, reason:"already_paused"}  (idempotent no-op)
R5 → G5   test: from "completed"|"failed"|"cancelled" → {ok:false, reason:"terminal"}
R6 → G6   test: from "creditsExhausted" → {ok:false, reason:"credits_exhausted"}
          (explicit: pause on an already-auto-paused job is a no-op)

# validateResumeTransition(currentStatus, availableCredits, remainingEstimate)
R7 → G7   test: from "paused", balance 100, need 50
          → {ok:true, nextStatus:<pausedFromStatus>}
R8 → G8   test: from "creditsExhausted", balance 100, need 50
          → {ok:true, nextStatus:"extracting"}
R9 → G9   test: from "creditsExhausted", balance 10, need 50
          → {ok:false, reason:"insufficient_credits", needed:50, available:10}
R10→ G10  test: from "paused" ignores balance (paused-by-user doesn't gate on credits)
R11→ G11  test: from "extracting"|"completed"|etc. → {ok:false, reason:"not_paused"}
R12→ G12  test: idempotent — resumeTransition on already-resumed state is no-op, not error

REFACTOR  extract RUNNING_STATUSES and TERMINAL_STATUSES sets into shared consts in stateMachine.ts
```

Workflow gate, skip-guard, mutations, and UI — test-after.

## Files touched

- `convex/extraction/mutations/pause.ts` (new).
- `convex/extraction/workflow.ts` — insert gate.
- `convex/extraction/workpoolActions.ts` — entry-point skip-guard in `extractOneQuestion` and `downloadAndIndex`.
- `convex/extraction/queries/internal.ts` (if not exists) — `getJobStatusForWorkflow`, `getJobStatusForAction`.
- `convex/extraction/stateMachine.ts` — transitions.
- `convex/schema.ts` — `pausedAt`, `pausedFromStatus` fields.
- `convex/extraction/validators.ts` — add to status validator.
- `app/extraction/[jobId]/page.tsx` — Pause/Resume buttons + banner.
- `components/extraction/job-status-banner.tsx` (new) — unified banner for paused/creditsExhausted.
- `messages/*.json` — keys `extraction.pause.button`, `.paused.banner`, `.resume.button`, `.pause.toastSuccess`, `.resume.toastSuccess`.
- Tests.

## Test plan

- **Convex** (`pause-resume.test.ts`):
  - Run a workflow; pause mid-job; no new questions enqueued after pause; in-flight ones complete (verify via `attemptCount` and `billed` flags).
  - Resume; remaining questions process; final counts match expected.
  - Cancel during paused state → workflow terminates, no resumes possible.
  - Double-pause is idempotent.
  - Double-resume is idempotent.
  - Resume from `creditsExhausted` without sufficient credits → throws.
- **Convex**: pause+resume with unlimited retries on a question that fails on attempt 1, pauses before attempt 2, resumes → attempt 2 proceeds.
- **UI** (job detail page):
  - status=extracting: pause button visible, resume button not rendered.
  - status=paused: resume button visible; banner has `role="status"` and `data-job-status="paused"`.
  - Click pause → mutation called; optimistic status updates.
  - Banner announces to screen readers (test via `aria-live` attribute presence and `role="status"`).
- **Integration**: seed 20-paper × 3-Q job; pause after 10 papers; verify no further billing; resume; all remaining papers billed correctly.

## Acceptance criteria

- [ ] Pause halts new question dispatch; no credits spent on questions that hadn't started.
- [ ] Resume continues from the exact next question; no re-billing of completed.
- [ ] `paused` and `creditsExhausted` both resume via same mutation.
- [ ] Pause only the targeted job; other concurrent jobs unaffected.
- [ ] Idempotent mutations; double-click is harmless.
- [ ] Status banner is screen-reader-accessible.
- [ ] Pre-existing tests pass.

## Known pitfalls

- **Workflow event race**: if `sendEvent` runs before the workflow reaches `awaitEvent`, does the event queue? Convex Workflow `sendEvent` docs say the event is delivered when/if the workflow reaches the matching `awaitEvent`. Safe — but confirm by testing a "resume before pause reaches the gate" scenario.
- **Orphaned paused jobs**: if a user pauses then leaves, the workflow waits indefinitely at `awaitEvent`. No resource cost per Convex workflows. Optional: a cron that auto-cancels jobs paused > 7 days (out of scope here).
- **`pausedFromStatus` stale**: if code paths mutate `job.status` without going through `pauseExtraction`/`resumeExtraction`, `pausedFromStatus` can lie. Keep all status transitions funneled through typed helpers (plan 03's `updateJobStatus` internal mutation is the single source of truth).
- **Skip-guard vs. workflow-gate interaction**: a question that slips through the gate (queued before pause) and then hits the skip-guard returns success without running. Make sure the workflow's `step.runAction` sees that as "success" (no retry triggered). The wrapper `handleExtractionComplete` already treats `{success: true}` as success.
