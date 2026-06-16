# Plan 04 - Question Task and Answer Payload Split

## Goal

Reduce answer-write OCC and row-size pressure by separating small per-question lifecycle state from large answer payloads.

## Scope

In:
- `convex/extraction/validators.ts`
- `convex/schema.ts`
- `convex/extraction/mutations/results.ts`
- `convex/extraction/queries/_shared.ts`
- `convex/extraction/queries/papers.ts`
- `convex/extraction/queries/retry.ts`
- `convex/extraction/queries/mixedSuccessSummary.ts`
- Tests around result writes, billing, retry, and finalization

Out:
- Results page read model. Plan 05.

## Design

Add `extractionQuestionTasks`:

- `jobId`
- `paperId`
- `questionKey`
- `status`
- `billed`
- `attemptCount`
- `creditsUsed`
- `lastError`
- `model`
- `provider`
- `pdfContentUsed`
- `processedAt`

Add `extractionAnswerPayloads`:

- `jobId`
- `paperId`
- `questionKey`
- `answer`
- `confidence`
- `reasoning`
- `citations`
- `citationStatus`
- `retrievalDiagnostics`
- `processedAt`

`recordOneAnswer` writes one small task row and one payload row. `recordOneAnswerFailure` writes only the task row unless a failure payload is still required for UI shape. `finalizePaper` reads task rows for status/billing and payload rows only when projection needs answer content.

## TDD Sequence

R1. Successful answer creates/updates one task row and one payload row, idempotently.

R2. Failure creates/updates one task row without overwriting an existing billed success payload.

R3. `finalizePaper` rolls up from task rows and debits once.

R4. Retry reset touches task rows only and preserves payloads for completed/billed successes.

R5. Existing paper/result detail queries reconstruct the previous public shape.

R6. Answer payload writes do not patch paper list projection per question.

## Files Touched

- `convex/extraction/validators.ts`
- `convex/schema.ts`
- `convex/extraction/mutations/results.ts`
- `convex/extraction/queries/_shared.ts`
- `convex/extraction/queries/papers.ts`
- `convex/extraction/queries/retry.ts`
- `convex/extraction/queries/mixedSuccessSummary.ts`
- `convex/extraction/per-question-decomp.test.ts`
- `convex/extraction/billing-idempotency.test.ts`
- `convex/extraction/finalize-guard.test.ts`
- `convex/extraction/queries/retry.test.ts`

## Migration Stance

Destructive. Delete old `extractionResults` after the split is complete, unless Plan 05 still needs a temporary adapter within the same branch. No public compatibility layer survives Plan 06.

## Test Plan

- `npx vitest run convex/extraction/per-question-decomp.test.ts`
- `npx vitest run convex/extraction/billing-idempotency.test.ts convex/extraction/finalize-guard.test.ts`
- `npx vitest run convex/extraction/queries/retry.test.ts convex/extraction/queries/mixedSuccessSummary.test.ts`
- `npx tsc --noEmit`

## Deployability Gate

```
npx pm2 logs convex --lines 5 --nostream
```

Must show `✔ Convex functions ready!`.

## Acceptance Criteria

- `recordOneAnswer` no longer writes a large lifecycle row with status and payload mixed together.
- Retry/finalize paths use small task rows.
- Query adapters remain typed without explicit `any`.
- No duplicated answer-shape reconstruction logic.

## Known Pitfalls

- Keep idempotency gates on task rows.
- Avoid full job scans for retry summaries once task indexes exist.
- Preserve `creditsUsed` accumulation semantics across retries.
