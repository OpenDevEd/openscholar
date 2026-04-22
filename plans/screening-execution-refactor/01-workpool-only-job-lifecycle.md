# Plan 01 — Workpool-Only Job Lifecycle

**Depends on:** nothing. **Blocks:** 02, 03, 04.

## Goal

Delete screening’s workflow orchestration layer and make a screening job workpool-owned from creation through cancellation, with job-scoped work ids instead of global pool cancellation.

## Scope

**In scope**

- Remove screening-specific workflow start/cancel usage.
- Remove `workflowId` and `by_workflow` from screening schema.
- Add `workId` to `screeningResults`.
- Change job creation to enqueue workpool items directly.
- Replace global `screeningPool.cancelAll()` with per-result `screeningPool.cancel(...)`.
- Remove obsolete `pending` lifecycle state from screening jobs and screening results.
- Update screening validators and affected tests.

**Out of scope**

- aggregate-backed progress
- row-local completion refactor
- deferred library / collection side effects
- removal of old job counter fields

## Design

### 1. Delete screening workflow orchestration

The workflow path in [convex/screening/workflow.ts](../../convex/screening/workflow.ts) exists only to:

- load the job
- load pending rows
- patch the job to `processing`
- enqueue one work item per row

That is not a durable multi-step workflow; it is queue setup. The right home is the mutation that creates the job.

This plan removes:

- workflow start in `createScreeningJob`
- workflow cancel in `cancelScreeningJob`
- screening `workflowId` persistence
- screening-specific workflow module usage

### 2. Make `screeningResults` own queue identity

Add `workId: v.optional(v.string())` to `screeningResults`.

`enqueueAction` returns a `WorkId`, and the mutation should store it on the matching row immediately after enqueueing. This gives the domain model job-scoped ownership over cancellation.

### 3. Collapse the screening lifecycle

Job statuses after this plan:

- `processing`
- `completed`
- `cancelled`
- `failed`
- `creditsExhausted`

Result statuses after this plan:

- `processing`
- `completed`
- `failed`
- `skipped`

Remove `pending` from both screening validators and from any tests or comments that still describe the old workflow-owned phase. A screening job becomes `processing` as soon as the creation mutation commits, because the same mutation also enqueues all work items.

### 4. Enqueue directly from `createScreeningJob`

Within one mutation:

1. validate auth, job exclusivity, and credits
2. insert `screeningJobs` row with `status: "processing"`
3. insert each `screeningResults` row
4. enqueue one work item per result
5. patch that row with `workId`

Because the job cap is [MAX_SCREENING_PAPERS_PER_JOB = 200](../../convex/lib/queryBounds.ts), this bounded enqueue loop is acceptable and simpler than keeping a second orchestration layer.

### 5. Make cancellation job-scoped

`cancelScreeningJob` must:

1. verify ownership
2. patch the job to `cancelled`
3. query this job’s result rows up to the known cap
4. cancel only the stored `workId`s for rows that still have outstanding work

Do not call `screeningPool.cancelAll()`. The Workpool client docs show that it is pool-wide, not job-scoped.

### 6. Keep result rows terminalizable after cancel

This plan does not yet change `handleScreeningComplete`, but it must leave the schema in a state where later plans can normalize canceled in-flight rows to terminal result states. That means:

- rows keep `workId`
- rows do not depend on `pending`
- job cancellation is no longer tied to workflow cancellation

## TDD sequence

### Phase A — pure logic first

1. Add a small pure helper module for screening lifecycle sets / cancellation derivation.
2. Write tests for:
   - active job statuses after `pending` removal
   - terminal job statuses
   - terminal result statuses
   - extraction of cancelable work ids from a bounded result row set

### Phase B — mutation and schema wiring

1. Update validators and schema.
2. Rewrite `createScreeningJob`.
3. Rewrite `cancelScreeningJob`.
4. Delete workflow-specific screening code paths that become dead.
5. Update screening mutation/cancel tests accordingly.

## Files touched

- `convex/schema.ts`
- `convex/screening/validators.ts`
- `convex/screening/mutations.ts`
- `convex/screening/workflow.ts`
- `convex/screening/cancel.test.ts`
- `convex/screening/mutations.test.ts`
- small new helper + helper tests if warranted

## Migration stance

Destructive.

- delete `workflowId`
- delete `by_workflow`
- delete `pending` status variants
- do not preserve old screening workflow semantics

If local screening data breaks under the schema change, wipe screening tables.

## Test plan

### Test-first

- lifecycle helper tests for active/terminal status derivation
- cancelable `workId` extraction helper tests

### Test-after

- `createScreeningJob` creates a `processing` job, not `pending`
- every created result row gets a `workId`
- no workflow id is stored
- `cancelScreeningJob` cancels only this job’s work ids
- no screening code path calls `screeningPool.cancelAll()`
- existing auth / credit / active-job guards remain correct

## Acceptance criteria

1. No screening mutation starts or cancels a workflow.
2. `screeningResults` stores `workId` for enqueued work.
3. `cancelScreeningJob` no longer uses global pool cancellation.
4. Screening jobs and results no longer use `pending`.
5. Creation and cancellation tests are green under the new lifecycle.

## Known pitfalls

- Do not leave comments, tests, or validator unions referring to `pending`.
- Do not keep dead workflow helpers around after the direct-enqueue path lands.
- Because `enqueueAction` is called in a mutation, ensure every enqueue promise is awaited.
- Do not remove job counter fields in this plan; later plans still need a stable migration path for query rewiring.
