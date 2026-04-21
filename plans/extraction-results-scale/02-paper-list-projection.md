# Plan 02 — Add Paper List Projection Fields + Write-Side Maintenance

**Depends on:** 01. **Blocks:** 03, 04.

## Goal

Add a compact, queryable paper-level projection on `extractionPapers` so full-corpus filters and sorts can operate without rereading the whole job’s `extractionResults` / `extractionResultReviews` set.

## Scope

**In scope**

- Additive optional fields on `extractionPapers`.
- One search index on `extractionPapers.searchText`.
- Shared helper `recomputePaperListProjection(ctx, paperId)`.
- Wire the helper into every result/review/paper-status mutation that changes list semantics.

**Out of scope**

- Switching the page UI to consume the new projection (plan 03).
- Export path changes (plan 04).

## Design

### 1. Schema additions

Add optional fields to `extractionPapers`:

- `sortTitle: string`
- `avgConfidence: number`
- `reviewedCount: number`
- `needsFollowupCount: number`
- `hasErrors: boolean`
- `hasPdfSource: boolean`
- `questionAnswerTokens: string[]`
- `searchText: string`

Add a search index over `searchText` filtered by `jobId` and `processable`.

These are additive-only changes. No migration is required for deployment.

### 2. Projection builder

Create a helper module, e.g. `convex/extraction/listProjection.ts`, with:

- answer normalization for question filters,
- deterministic/capped `searchText` construction,
- `recomputePaperListProjection(ctx, paperId)`.

The helper reads:

1. one paper row,
2. that paper’s results,
3. that paper’s reviews,

then patches the projection fields onto the same paper row.

### 3. Write hooks

Call `recomputePaperListProjection` from:

- `recordOneAnswer`
- `recordOneAnswerFailure`
- `setResultReviewState`
- `markPaperTerminalTx` / paper mutation paths that alter status, PDF/source availability, or error state

Why patch the paper row instead of creating a second summary table:

1. `extractionPapers` is already patched during extraction (`creditsUsed`, terminal status, PDF usage).
2. The list query already needs the paper row.
3. Optional additive fields avoid a second join layer.

## Files touched

- `convex/schema.ts`
- `convex/extraction/listProjection.ts` (new)
- `convex/extraction/mutations/results.ts`
- `convex/extraction/paperLifecycle.ts`
- `convex/extraction/mutations/papers.ts`
- projection-focused tests

## Test plan

### Test-first

Add focused mutation-level tests proving:

1. successful answer updates `avgConfidence`, `questionAnswerTokens`, `searchText`
2. failed answer flips `hasErrors`
3. review-state changes update `reviewedCount` / `needsFollowupCount`

### Test-after

Schema/index smoke:

1. search index compiles and deploys
2. write paths still pass existing result/review tests

## Acceptance criteria

1. `extractionPapers` carries all list-query fields needed for page filters/sorts.
2. No projection value is computed lazily inside a read query.
3. Existing write-side tests remain green.
4. The projection fields are strictly additive.

