# Plan 03 - Start, Resume, Cancel, Retry Cutover

## Goal

Replace public extraction orchestration mutations with queue operations and remove workflow handles from live control flow.

## Scope

In:
- `convex/extraction/mutations/jobs.ts`
- `convex/extraction/mutations/resume.ts`
- `convex/extraction/mutations/retry.ts`
- `convex/extraction/mutations/pause.ts`
- `convex/extraction/mutations/internal/lifecycle.ts`
- `convex/extraction/mutations/internal/onComplete.ts`
- Queue dispatch/refill helpers
- Tests that currently expect `workflow.start` errors

Out:
- Physical workflow component deletion. Plan 06.

## Design

`startJob` and `duplicateJob` should:

1. Create job/questions/papers using existing code.
2. Reserve credits through queue helper logic.
3. Insert queue rows for the current `runEpoch`.
4. Dispatch the first paper window through `extractionPaperPool`.
5. Store no workflow handle.

`resumeExtraction` should:

1. Validate owner and paused/credits-exhausted status.
2. Bump `runEpoch`.
3. Reset active stale queue rows to stale/cancelled or leave them ignored.
4. Enqueue fresh rows for non-terminal papers.
5. Dispatch a new window.

`cancelExtraction` should:

1. Mark job cancelled.
2. Cancel known Workpool items from queue rows.
3. Mark active/pending queue rows cancelled.
4. Release outstanding reservations through existing lifecycle cleanup.

`retryFailedQuestions` should:

1. Keep existing retry preflight and reset semantics.
2. Enqueue retry queue rows by paper with exact `questionKeys`.
3. Dispatch retry paper workers.

## TDD Sequence

R1. `startJob` no longer reaches `workflow.start`; it creates queue rows and dispatches Workpool items.

R2. `duplicateJob` follows the same queue path.

R3. `resumeExtraction` bumps epoch and enqueues only non-terminal work.

R4. `cancelExtraction` cancels only this job's Workpool items and marks queue rows cancelled.

R5. `retryFailedQuestions` creates retry queue rows grouped by paper with retryable keys only.

R6. Existing auth, feature flag, credit preflight, and bucket guards still hold.

## Files Touched

- `convex/extraction/mutations/jobs.ts`
- `convex/extraction/mutations/resume.ts`
- `convex/extraction/mutations/retry.ts`
- `convex/extraction/mutations/pause.ts`
- `convex/extraction/mutations/internal/lifecycle.ts`
- `convex/extraction/mutations/internal/onComplete.ts`
- `convex/extraction/public-api-routing.test.ts`
- `convex/extraction/preflight.test.ts`
- `convex/extraction/mutations/retry.test.ts`
- `convex/extraction/mutations/resume.test.ts`
- `convex/extraction/cancel.test.ts`

## Migration Stance

Destructive. `workflowId` becomes obsolete and may be removed in Plan 06. Tests must stop accepting "workflow component not registered" as proof of success.

## Test Plan

- `npx vitest run convex/extraction/public-api-routing.test.ts convex/extraction/preflight.test.ts`
- `npx vitest run convex/extraction/mutations/retry.test.ts convex/extraction/mutations/resume.test.ts convex/extraction/cancel.test.ts`
- `npx vitest run convex/extraction/queue`
- `npx tsc --noEmit`

## Deployability Gate

```
npx pm2 logs convex --lines 5 --nostream
```

Must show `✔ Convex functions ready!`.

## Acceptance Criteria

- No extraction public mutation imports `workflow` or `WorkflowId`.
- Tests assert queue/workpool state instead of workflow component errors.
- Pause/resume/cancel/retry remain idempotent.
- No explicit `any`.

## Known Pitfalls

- Do not cancel all Workpool items globally. Use queue rows scoped by job.
- Retry must not clear `questionsBilled`.
- Resume must ignore stale active work through epoch checks.
