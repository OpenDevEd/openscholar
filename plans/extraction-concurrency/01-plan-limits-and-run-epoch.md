# Plan 01 — Plan-Derived Execution Limits + Run Epoch + Control Plane Hardening

**Depends on:** nothing. **Blocks:** 02, 03, 04.

## Goal

Add first-class extraction execution limits derived from the user’s plan, add a job-scoped run epoch, and harden the extraction control plane so pause/resume can safely coexist with future parallel dispatch.

This locks the control-plane contract before any concurrency is reintroduced.

## Scope

**In scope**

- Extend `convex/extraction/bucket/limits.ts` with plan-derived:
  - `paperConcurrency`
  - `questionConcurrencyPerPaper`
- Set all plans to `5` for both values for now.
- Add one combined resolver for extraction execution limits.
- Add action/workflow-friendly `internalQuery` wrappers for those limits.
- Add a job-scoped `runEpoch` field to `extractionJobs`.
- Update pause/resume so they bump the epoch.
- Add narrow internal query support for reading job status + epoch together.
- Add worker-side stale-epoch guards around indexing / question work.
- Make retry workflow pause/epoch aware.
- Make workflow-level completion and stale status writes safe against older runs.

**Out of scope**

- actually dispatching multiple papers or questions in parallel
- redesigning the write path

## Context / dependencies

- **Reuse the current numeric entitlement spine.** `convex/extraction/bucket/limits.ts` already owns `PAPER_LIMIT_BY_PLAN`, `PAPER_PULL_CAP_BY_PLAN`, and `CHAT_CONCURRENCY_LIMIT_BY_PLAN`. Extend that file; do not invent a second numeric entitlement layer.
- **Canonical plan resolution already exists.** `bucket/limits.ts` already uses `selectCanonicalSubscription` + `resolveEffectivePlan`. Do not bypass that path.
- **Feature flags are not the right tool here.** `lib/feature-flags/registry.ts` and `convex/featureFlags/*` are boolean/tier gates, not numeric entitlements.
- **Pause/resume currently assumes one active waiter.** `convex/extraction/workflow.ts:177-189` is explicit about that tradeoff. `runEpoch` is necessary but not sufficient; stale workflow and retry paths must also be hardened here.

## Design

### 1. Extend `convex/extraction/bucket/limits.ts`

Add two plan maps:

```ts
export const EXTRACTION_PAPER_CONCURRENCY_BY_PLAN: Record<SubscriptionPlan, number> = {
  free: 5,
  go: 5,
  pro: 5,
  enterprise: 5,
};

export const EXTRACTION_QUESTION_CONCURRENCY_BY_PLAN: Record<SubscriptionPlan, number> = {
  free: 5,
  go: 5,
  pro: 5,
  enterprise: 5,
};
```

Add:

- `getExtractionPaperConcurrency(ctx, userId)`
- `getExtractionQuestionConcurrencyPerPaper(ctx, userId)`
- `getExtractionExecutionLimits(ctx, userId)`
- `getExtractionExecutionLimitsForUser` as an `internalQuery`

Match the current style of `getPaperLimitForUser` and `getChatConcurrencyLimitForUser`.

### 2. Add `runEpoch` to `extractionJobs`

In `convex/schema.ts`, add:

```ts
runEpoch: v.optional(v.number()),
```

Use `0` as the created-job default.

This field is not a user-facing status. It is an execution-generation number.

### 3. Make workflow freshness explicit

The system currently lacks an execution-generation concept and relies on status-only coordination.

That is insufficient because:

- stale workers can complete after pause/resume boundaries
- retry is a separate workflow today
- workflow-level completion can still race newer runs

This plan makes freshness explicit with `runEpoch` and uses it everywhere execution ownership matters.

### 4. Pause/resume bump the epoch

In `convex/extraction/mutations/pause.ts`:

- patch `runEpoch` to `(job.runEpoch ?? 0) + 1`

In `convex/extraction/mutations/resume.ts`:

- patch `runEpoch` again on successful resume

Reason:

- pause invalidates already-issued work from the old run
- resume begins a new run generation

### 5. Worker-side stale-work guard

Before any expensive or billable work:

- `downloadAndIndexPdfAction`
- `extractOneQuestion`

must read the current `{ status, runEpoch }` and compare against the expected epoch from dispatch.

If mismatched, exit cleanly without:

- billing
- persisting
- mutating per-paper execution state

For the question path, do a second check immediately before persist/billing as well.

### 6. Internal query support

Add or extend a small internal query in `convex/extraction/queries/internal.ts` returning:

```ts
{ status, runEpoch }
```

Keep this read narrow and cheap.

### 7. Retry must participate in the same freshness model

`runRetryWorkflow` currently bypasses the main workflow’s pause semantics.

This plan must make retry:

- check current status
- respect current epoch
- stop relying on the older “raw nested Promise.all with no pause gate” model

Do not leave retry on the old control plane.

### 8. Guard workflow-level completion and stale status writes

Late workflow writes must not be able to overwrite a newer paused/resumed run.

At minimum:

- workflow-level completion fallback must verify current workflow ownership/freshness before patching terminal state
- status writes in the workflow should not blindly overwrite a newer paused or resumed state from another generation

## Files touched

- `convex/extraction/bucket/limits.ts`
- `convex/schema.ts`
- `convex/extraction/mutations/pause.ts`
- `convex/extraction/mutations/resume.ts`
- `convex/extraction/queries/internal.ts`
- `convex/extraction/workpoolActions.ts`
- `convex/extraction/workflow.ts`
- `convex/extraction/mutations/internal/onComplete.ts`
- `convex/extraction/mutations/retry.ts`
- extraction schema / worker tests

## Test plan

### Test-first

- extraction limit resolver tests:
  - all plans resolve `paperConcurrency = 5`
  - all plans resolve `questionConcurrencyPerPaper = 5`
- epoch transition tests:
  - new job defaults to epoch `0`
  - pause bumps epoch
  - resume bumps epoch again

### Test-after

- stale epoch in `extractOneQuestion` skips before billing
- stale epoch in indexing path skips before indexing mutation side effects
- retry respects pause/epoch behavior
- stale workflow completion cannot overwrite a newer run
- existing pause/resume tests remain green

## Acceptance criteria

1. No extraction execution code path uses a hardcoded concurrency literal.
2. Both extraction concurrency knobs are plan-derived server-side values.
3. Pause and resume each create a new execution epoch.
4. Stale in-flight extraction work cannot bill or persist after an epoch change.
5. Retry and workflow completion honor the same freshness model as the main path.

## Known pitfalls

- If execution limits are resolved live on every dispatch, mid-job plan changes can change throughput. If that is undesirable, snapshot the resolved limits onto the job row later. This plan does not require that decision yet.
- Do not store numeric entitlements in feature flags.
- Do not stop at action-level guards; workflow-level completion and retry must also be updated here.
