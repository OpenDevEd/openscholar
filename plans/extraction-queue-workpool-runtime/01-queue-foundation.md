# Plan 01 - Queue Foundation

## Goal

Create the app-owned extraction queue/runtime foundation that replaces workflow journal state as the source of truth for paper execution.

## Scope

In:
- `convex/extraction/validators.ts`
- `convex/schema.ts`
- New queue helper module under `convex/extraction/queue/`
- New queue tests under `convex/extraction/queue/`
- Test fixtures that need to seed queue rows

Out:
- Public `startJob`, `resumeExtraction`, `retryFailedQuestions`, and `cancelExtraction` cutover. That happens in Plan 03.
- Worker action execution. That happens in Plan 02.

## Design

Add `extractionPaperQueue` with one row per paper attempt:

- `jobId`
- `paperId`
- `runEpoch`
- `kind`: `"initial"` or `"retry"`
- `status`: `"pending" | "leased" | "running" | "parked" | "completed" | "failed" | "cancelled"`
- `priority`
- `attempt`
- `leaseOwner`
- `leasedAt`
- `leaseExpiresAt`
- `workId`
- `questionKeys` for retry rows only
- `lastError`
- `createdAt`
- `updatedAt`

Indexes:

- `by_job_and_status`: `["jobId", "status"]`
- `by_job_and_epoch_and_status`: `["jobId", "runEpoch", "status"]`
- `by_paper_and_epoch_and_kind`: `["paperId", "runEpoch", "kind"]`
- `by_status_and_priority`: `["status", "priority"]`
- `by_work`: `["workId"]`

Use pure helpers for status rules and queue selection where possible. Convex mutations should be thin wrappers around those helpers.

## TDD Sequence

R1. Enqueue initial papers creates exactly one pending queue row per non-terminal, unbilled processable paper for the current epoch.

R2. Re-running enqueue for the same epoch is idempotent and does not duplicate rows.

R3. Bumping `runEpoch` permits fresh queue rows while stale epoch rows remain ignored by active selectors.

R4. Lease selection respects `paperConcurrency` and ignores terminal, stale, parked, cancelled, and already leased rows.

R5. Completing or parking a queue row frees capacity for the next pending row.

R6. Retry enqueue creates queue rows with `kind: "retry"` and the precise retryable `questionKeys`.

## Files Touched

- `convex/extraction/validators.ts`
- `convex/schema.ts`
- `convex/extraction/queue/status.ts`
- `convex/extraction/queue/mutations.ts`
- `convex/extraction/queue/helpers.ts`
- `convex/extraction/queue/queue.test.ts`
- `convex/extraction/tests/fixtures.ts`

## Migration Stance

Breaking and destructive. New queue tables are authoritative once Plan 03 lands. No legacy workflow row fallback.

## Test Plan

- `npx vitest run convex/extraction/queue/queue.test.ts`
- `npx vitest run convex/extraction/mutations/internal/fanout.test.ts` during the transition only, until Plan 06 deletes it.
- `npx tsc --noEmit`

## Deployability Gate

After every backend-touching green:

```
npx pm2 logs convex --lines 5 --nostream
```

Success requires a recent `✔ Convex functions ready!` and no recent `✖ Error`.

## Acceptance Criteria

- Queue table and validators compile with no explicit `any`.
- Queue helpers are reused by enqueue, lease, completion, resume, and retry paths.
- Tests prove idempotent enqueue, epoch isolation, bounded lease capacity, and retry question-key preservation.
- `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`.

## Known Pitfalls

- Convex file names under `convex/` cannot contain hyphens.
- Do not query by optional fields in a way that misses `undefined` rows.
- Include `kind` in paper/epoch idempotency checks so retry rows can coexist with prior initial rows.
- Do not read the whole job paper set on every refill once queue rows exist.
- Do not make Workpool status canonical.
