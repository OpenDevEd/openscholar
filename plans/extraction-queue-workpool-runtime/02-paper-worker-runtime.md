# Plan 02 - Paper Worker Runtime

## Goal

Move one-paper execution into a bounded Workpool action while keeping question extraction parallel inside the action.

## Scope

In:
- `convex/workpool.ts`
- `convex/convex.config.ts`
- New paper worker action/module
- Existing `convex/extraction/workpoolActions.ts` helper extraction if needed
- Queue completion mutations from Plan 01

Out:
- Public start/resume/retry/cancel cutover. Plan 03.
- Result table split. Plan 04.

## Design

Register a dedicated `extractionPaperWorkpool` component and export `extractionPaperPool` with a conservative initial `maxParallelism`.

The paper worker action:

1. Claims or verifies the queue lease.
2. Checks job status, epoch, credits, pause, and cancellation through existing skip guards.
3. Runs download/index once when needed.
4. Loads question ids/keys.
5. Runs extraction in `chunk(items, questionConcurrency)` batches with `Promise.all`.
6. Records per-question success/failure through existing result mutations until Plan 04 replaces them.
7. Calls `finalizePaper`.
8. Marks the queue row `completed`, `parked`, `failed`, or `cancelled`.
9. Schedules or invokes refill without broad scans.

Avoid `ctx.runAction` inside the paper action unless a runtime boundary is required. Prefer shared async helpers from `workpoolActions.ts`.

## TDD Sequence

R1. Dispatching leased queue rows enqueues no more than `paperConcurrency` Workpool items and stores `workId`.

R2. Paper worker parks the queue row and does not finalize when skip guard returns `paused`, `credits_exhausted`, or `stale_epoch`.

R3. Paper worker marks queue cancelled when the job is cancelled before work starts.

R4. Successful worker finalizes the paper and marks queue completed exactly once.

R5. Worker failure records a structured error and keeps retry idempotency.

R6. Question concurrency is bounded by `questionConcurrency`, not by paper count.

## Files Touched

- `convex/convex.config.ts`
- `convex/workpool.ts`
- `convex/extraction/paperWorker.ts`
- `convex/extraction/queue/mutations.ts`
- `convex/extraction/queue/worker.test.ts`
- `convex/extraction/workpoolActions.ts`

## Migration Stance

Breaking. The worker may coexist with old workflow only until Plan 03 switches public mutations. No compatibility shims after Plan 06.

## Test Plan

- `npx vitest run convex/extraction/queue/worker.test.ts`
- `npx vitest run convex/extraction/workpoolActions-skipguard.test.ts`
- `npx vitest run convex/extraction/per-question-decomp.test.ts`
- `npx tsc --noEmit`

## Deployability Gate

```
npx pm2 logs convex --lines 5 --nostream
```

Must show `✔ Convex functions ready!` after component registration and worker changes.

## Acceptance Criteria

- `extractionPaperPool` is the only runtime throttle for paper execution.
- One Workpool item corresponds to one paper queue row.
- Paper worker uses existing extraction helpers instead of duplicating provider/PDF/result logic.
- No explicit `any`.

## Known Pitfalls

- Workpool tests need component registration. Reuse screening workpool test-support patterns.
- `onComplete` is optional; the success path can write completion at the end of the worker action.
- Long paper actions can hit action limits. Keep a measured fallback to split question batches only if this appears in logs.
