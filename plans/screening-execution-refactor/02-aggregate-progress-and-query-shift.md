# Plan 02 — Aggregate Progress And Query Shift

**Depends on:** 01. **Blocks:** 03, 04.

## Goal

Establish aggregate-backed screening progress so public queries no longer depend on `processedPapers`, `failedPapers`, or `qualifiedPapers` on `screeningJobs`.

## Scope

**In scope**

- Add screening aggregate component registrations.
- Add screening aggregate helpers for terminal result counts and qualified counts.
- Wire current completion paths to maintain those aggregates.
- Rewrite progress and summary queries to read aggregate-backed counts.
- Update query tests and any affected UI-contract tests.

**Out of scope**

- shrinking `handleScreeningComplete` yet
- deferred side-effect scheduling
- removing old job counter fields from the schema

## Design

### 1. Add two job-scoped aggregate instances

Use the existing project pattern in `convex/credits/aggregates.ts` and `convex/extraction/aggregates.ts`.

Add:

- `screeningResultStatusAgg`
- `screeningQualifiedAgg`

Both are namespaced by `jobId`.

Recommended keys:

- `screeningResultStatusAgg`: terminal result status only, keyed by `"completed" | "failed" | "skipped"`
- `screeningQualifiedAgg`: one row per qualified completed result, keyed by `_creationTime` or result id, count-only

Reasoning:

- progress only needs handled/failed/qualified
- tracking `processing` in aggregates is unnecessary churn
- terminal-only writes keep the dependency surface small

### 2. Add helper APIs, not ad hoc aggregate calls

Create one helper module, e.g. `convex/screening/aggregates.ts`, with explicit APIs such as:

- `recordTerminalResult(ctx, row)`
- `forgetTerminalResult(ctx, row)` if needed by tests or cleanup helpers
- `recordQualifiedResult(ctx, row)`
- `readScreeningProgressCounts(ctx, jobId)`

Do not scatter raw aggregate operations across query files.

### 3. Shift query truth to aggregates

Rewrite:

- `getScreeningProgress`
- `getScreeningJob`
- `listUserScreeningJobs`
- `getScreeningResultsForExport`

so they derive:

- `processedPapers` from terminal completed/skipped aggregate counts
- `failedPapers` from failed aggregate counts
- `qualifiedPapers` from qualified aggregate counts

`totalPapers` remains on the job row.

For `listUserScreeningJobs`, the list is already bounded to 20 rows in [convex/screening/queries.ts:143-188](../../convex/screening/queries.ts). Parallel aggregate reads per listed job are acceptable.

### 4. Keep old job counter fields temporarily

This plan is shippable because the old fields can remain on `screeningJobs` during the query transition. They simply stop being the authoritative source for read paths. Plan 04 deletes them.

### 5. Current completion path still writes both models

Before plan 03 lands, `handleScreeningComplete` will still patch job counters. That is acceptable for one intermediate slice because:

- aggregate-backed queries can switch now
- later plan 03 removes the hot shared counter writes

The important constraint is that this plan introduces the new truth source before the old one is deleted.

## TDD sequence

### Phase A — pure logic first

1. Add a pure helper for progress math, e.g. `buildScreeningProgressSnapshot`.
2. Write tests for:
   - handled = completed + skipped
   - failed is independent
   - percent complete caps at 99 for active jobs and 100 for terminal jobs
   - zero-paper jobs return zero counts safely

### Phase B — aggregate and query wiring

1. Register aggregate components in `convex/convex.config.ts`.
2. Add `convex/screening/aggregates.ts` with direct tests.
3. Update current completion flow to write aggregate state.
4. Rewrite the public queries to read aggregate-backed counts.
5. Update query tests.

## Files touched

- `convex/convex.config.ts`
- `convex/screening/aggregates.ts`
- `convex/screening/mutations.ts`
- `convex/screening/queries.ts`
- `convex/screening/queries.test.ts`
- new aggregate tests
- pure helper + tests if warranted

## Migration stance

Additive in implementation, destructive in intent.

- Add aggregate state now.
- Do not preserve the old counter fields as the read truth after this plan lands.
- No backfill of old workflow semantics.

If screening test data needs reseeding after aggregate introduction, reseed it.

## Test plan

### Test-first

- pure progress math helper tests
- direct aggregate helper tests for terminal and qualified counts

### Test-after

- `getScreeningProgress` returns aggregate-backed counts
- `getScreeningJob` and `listUserScreeningJobs` no longer depend on job counters
- export query metadata still returns correct `qualifiedPapers`
- active jobs still cap visible percent below 100

## Acceptance criteria

1. Screening progress queries no longer read `processedPapers`, `failedPapers`, or `qualifiedPapers` from `screeningJobs` as the source of truth.
2. Aggregate helpers exist and are covered by tests.
3. Aggregate-backed queries preserve the existing UI contract shape.
4. Existing screening query tests are green after the shift.
5. Old job counter fields remain only as temporary dead weight awaiting plan 04 deletion.

## Known pitfalls

- Do not accidentally count `processing` rows into handled totals.
- Do not rely on scanning all `screeningResults` reactively to compute progress.
- Keep the query API shape stable; this plan is a truth-source swap, not a frontend redesign.
- Be explicit in tests about `skipped` counting as handled.
