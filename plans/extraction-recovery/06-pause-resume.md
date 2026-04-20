# Plan 06 — Pause / Resume (Cooperative, Workflow-Gated)

**Depends on:** 01 (taxonomy), 02 (per-question granularity), 03 (status machine + `creditsExhausted`). **Blocks:** 07 (polish).

## Goal

User clicks Pause. Any in-flight question finishes its LLM call. No new questions get dispatched. Job status shows `paused`. Later, user clicks Resume. Processing picks up from the next question, with no re-billing of anything already billed.

Closes gap #6.

## Approach: workflow-gated cooperative pause (no pool-level pause)

**Workpool 0.3.2 note**: the project pins `@convex-dev/workpool@0.3.2` (satisfies `@convex-dev/rag@0.7.2`'s peer range). On 0.3.2, `pool.config.update({ maxParallelism: 0 })` is not available on the client. This doesn't affect Plan 06 — we chose workflow-gated pause (`step.awaitEvent`) regardless. If a future upgrade reopens pool-level pause, the cross-tenant isolation objection (pausing pool A also pauses other users' jobs sharing the pool) still stands.

The research surfaced two primitives:
1. **Workpool pool-level pause** (`pool.config.update({ maxParallelism: 0 })`): doubly-unavailable — not on the pinned 0.3.2 client (no runtime `config.update` method) AND rejected on design grounds (pool-global; pausing job A also pauses other users' jobs sharing the pool, breaking cross-tenant isolation).
2. **Workflow** has `step.awaitEvent({ name })` + `sendEvent` for cooperative resume.

We use **workflow-gate only** (no pool pause). The enqueue loop checks `job.status` before each question dispatch and `awaitEvent` if paused. Cost: up to `maxParallelism` already-enqueued questions will still start — each one early-returns from the per-question extraction action on a status re-check. Small, bounded, and isolates pause to one job.

User choice made in the grill: "you can wait for the llm to finish" → this approach is consistent.

**Hard block on Plan 02 AND Plan 03.** Plan 06 cannot land until (a) Plan 02's per-question decomposition exists — `step.awaitEvent` is placed inside a per-question loop that Plan 02 creates, and (b) Plan 03's status widening lands — the UI needs to distinguish `creditsExhausted` from user-initiated `paused`. A degraded paper-level-only fallback (gate before each `enqueuePaperProcessing` call at `workflow.ts:167-206`) is possible if shipping before Plan 02, but not recommended.

**Ownership of new status literals**: this plan (Plan 06) owns adding `paused` to the schema and validator unions. Plan 03 owns adding `creditsExhausted`. Do NOT split ownership of the status union — both statuses land in their respective plans. If Plans 03 and 06 ship in either order, each plan adds only its own literal.

## Scope

**In scope**
- New status value `paused` on `extractionJobs.status` (Plan 06 owns adding this literal to the schema/validator; Plan 03 owns adding `creditsExhausted`).
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

> **Note on `extractOneQuestion`**: this standalone per-question action is Plan 02's deliverable and does NOT exist pre-Plan-02. Current equivalents in the codebase are the `processQuestion` closure (`convex/extraction/workpoolActions.ts:890`) and the helpers `extractQuestionAnswer` (`:288`) / `extractQuestionAnswerFromAbstract` (`:377`). The skip-guard described below lands at the entry of whatever per-question action Plan 02 extracts.

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
- `convex/extraction/workpoolActions.ts` — entry-point skip-guard in `extractOneQuestion` (Plan 02's extracted action) and `downloadAndIndex`.
- `convex/extraction/queries/internal.ts` (if not exists) — `getJobStatusForWorkflow`, `getJobStatusForAction`.
- `convex/extraction/stateMachine.ts:17-25` — add `paused` to `JOB_STATUSES`. Extend `VALID_JOB_TRANSITIONS` (`:38-54`) to allow `extracting → paused → extracting` and `paused → cancelled`.
- `convex/extraction/mutations/internal/lifecycle.ts` — extend the `maybeFinalizeJob` guard at `:38-44` to also skip `paused` and `creditsExhausted` (prevents counter-driven race into `completed`).
- `convex/schema.ts` — `pausedAt`, `pausedFromStatus` fields, and widen the `extractionJobs.status` union to include `paused` (Plan 06 owns this literal; Plan 03 owns `creditsExhausted`).
- `convex/extraction/validators.ts` — mirror the status-union widening: add `v.literal("paused")` to `jobStatusValidator` (currently `:22-30`).
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

- [x] Pause halts new question dispatch; no credits spent on questions that hadn't started. *(Workflow gate `waitWhilePausedOrCancelled` in `convex/extraction/workflow.ts` blocks the for-of paper + question loops on `step.awaitEvent({ name: 'resume:<jobId>' })`. The `extractOneQuestion` entry-guard (`convex/extraction/workpoolActions.ts:1041`) catches any already-enqueued dispatch and returns `{skipped, "paused"}` before the LLM call / credit charge.)*
- [x] Resume continues from the exact next question; no re-billing of completed. *(`resumeExtraction` patches the job back to `pausedFromStatus` (or `extracting` fallback) and fires `sendEvent`. Completed rows keep `billed=true`; the plan-02 idempotency guard at `extractOneQuestion` line 1009 short-circuits any replay that would re-bill.)*
- [x] `paused` and `creditsExhausted` both resume via same mutation. *(`resumeExtraction` accepts both statuses; `validateResumeTransition` carries an `insufficient_credits` branch that only applies to the creditsExhausted path. Page wires `handleResume` onto both `<CreditsExhaustedBanner>` and `<JobStatusBanner variant="paused">`.)*
- [x] Pause only the targeted job; other concurrent jobs unaffected. *(No pool-level pause was introduced — `pauseExtraction` patches a single extractionJobs row and its workflow gate is keyed by `resume:${jobId}`. Other users' workflows sharing the workpool stay unblocked — the explicit rejection documented in § Approach.)*
- [x] Idempotent mutations; double-click is harmless. *(Covered by `pause.test.ts::double-pause is a no-op` and `resume.test.ts::double-resume is a no-op`. Both return `{paused:false, reason}` / `{resumed:false, reason:"not_paused"}` without throwing.)*
- [x] Status banner is screen-reader-accessible. *(`<JobStatusBanner variant="paused">` exposes `role="status"` + `aria-live="polite"` + `data-job-status="paused"`; creditsExhausted variant keeps `role="alert"`. Tests in `tests/components/job-status-banner.test.tsx` assert on the ARIA contract, not Tailwind classes.)*
- [x] Pre-existing tests pass. *(616/616 tests green after the full B-series lands; no regressions across existing extraction / transitions / retry-summary / preflight / stateMachine suites.)*

**Live smoke handed off to human.** The plan's integration scenario
(seed 20-paper × 3-Q job, pause after 10 papers, verify no further
billing, resume, verify remainder bills correctly) requires the live
Convex dev deployment because convex-test doesn't register workflow /
workpool / rag / ai-model components. The behavioural contracts above
are covered unit-test-level; the end-to-end billing-telemetry walkthrough
happens on the live dev db.

## Known pitfalls

- **Workflow event race**: if `sendEvent` runs before the workflow reaches `awaitEvent`, does the event queue? Convex Workflow `sendEvent` docs say the event is delivered when/if the workflow reaches the matching `awaitEvent`. Safe — but confirm by testing a "resume before pause reaches the gate" scenario.
- **Orphaned paused jobs**: if a user pauses then leaves, the workflow waits indefinitely at `awaitEvent`. No resource cost per Convex workflows. Optional: a cron that auto-cancels jobs paused > 7 days (out of scope here).
- **`pausedFromStatus` stale**: if code paths mutate `job.status` without going through `pauseExtraction`/`resumeExtraction`, `pausedFromStatus` can lie. Keep all status transitions funneled through typed helpers (plan 03's `updateJobStatus` internal mutation is the single source of truth).
- **Skip-guard vs. workflow-gate interaction**: a question that slips through the gate (queued before pause) and then hits the skip-guard returns success without running. Make sure the workflow's `step.runAction` sees that as "success" (no retry triggered). The wrapper `handleExtractionComplete` already treats `{success: true}` as success.
