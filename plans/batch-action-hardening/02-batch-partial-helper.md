# Plan 02 — Batch-Partial Helper

**Depends on:** nothing. **Blocks:** 03.

## Goal

Add the pure helper that lets a batch operation return paid items as results and unpaid items as structured errors. This is the primitive slice 03 calls inside `withAuthAndCreditsBatch` when credits exhaust mid-loop, and the contract slice 05's `ScreeningErrorAlert` consumes via `parseChatError` on the client.

## Scope

In scope:

- New module `lib/ai/core/batch-partial.ts`:
  - `BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR` constant string.
  - `applyUnpaidBatchItemErrors<T>(result: T, unpaidItemIds: Iterable<string>): T` polymorphic helper.
- Re-export from `lib/ai/core/index.ts`.
- Two new tests in `tests/ai-batch.test.ts` (the file exists; the `applyUnpaidBatchItemErrors` describe block does not).

Out of scope:

- The server-side caller (`withAuthAndCreditsBatch` salvage) — slice 03.
- Any client-side error parsing — slice 05's `ScreeningErrorAlert` reuses `parseChatError`, not this helper directly.

## Design

1. **The helper consumes the existing `BatchResult<TData>` shape.** `lib/ai/core/batch-types.ts:18-26` already defines `BatchResult<TData> = { results: Record<string, TData>; errors: BatchError[] }` and `BatchError = { itemId: string; error: string }`. The helper takes any `T` that conforms to this shape and:
   - Removes each `unpaidItemId` from `result.results` (delete by key).
   - Appends `{ itemId, error: BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR }` to `result.errors`, but **only if no error already exists for that `itemId`** (idempotency).

2. **The helper is polymorphic over `T` for type-safe consumption.** Reference shape from `/tmp/openalex-main-inspect/lib/ai/core/batch-partial.ts:27-54`:
   ```ts
   export function applyUnpaidBatchItemErrors<T extends BatchResultLike>(
     result: T,
     unpaidItemIds: Iterable<string>,
   ): T
   ```
   Where `BatchResultLike` is a structural narrowing of `BatchResult<unknown>`.

3. **The constant is co-located.** `BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR = "Insufficient credits to return this item"`. **Do not** put this in `convex/lib/errors.ts` — that file is for `ErrorCode` symbols, not user-facing prose.

4. **The helper is idempotent.** Calling it twice with overlapping `unpaidItemIds` does not duplicate errors. The dedup is by `itemId`, not by error message — a paper that already has a *different* error stays as-is and is not double-erred.

5. **Re-export from `lib/ai/core/index.ts`.** Add a single `export * from "./batch-partial"` line. The barrel pattern is already established for `batch-types`, `batch`, and other core modules.

## TDD Sequence

Phase A — pure logic, write tests first, commit per green:

1. RED: in `tests/ai-batch.test.ts`, add a new `describe("applyUnpaidBatchItemErrors", ...)` block with the test name "returns paid results and marks unpaid items as errors". Reference assertion shape at `/tmp/openalex-main-inspect/tests/ai-batch.test.ts:140-160`. Setup: `result = { results: { p1: {value:1}, p2: {value:2}, p3: {value:3} }, errors: [] }`; call with `unpaidItemIds = ["p2", "p3"]`; expect `result.results` keys = `["p1"]`, expect `result.errors` to contain two entries with `itemId: "p2"` and `itemId: "p3"`, both with the constant message.
2. GREEN: implement `applyUnpaidBatchItemErrors` in `lib/ai/core/batch-partial.ts`. Add the constant. **Commit:** `feat(ai-core): [plan-02] add applyUnpaidBatchItemErrors`.
3. RED: add the second test "does not duplicate existing errors for unpaid item ids". Reference shape at `/tmp/openalex-main-inspect/tests/ai-batch.test.ts:162-177`. Setup: `result = { results: { p1: {value:1}, p2: {value:2} }, errors: [{ itemId: "p2", error: "previously failed" }] }`; call with `unpaidItemIds = ["p2"]`; expect `result.results` keys = `["p1"]`, expect `result.errors` length === 1 (the original error preserved, no duplicate insufficient-credits error appended).
4. GREEN: harden the implementation with the dedup check. **Commit:** `test(ai-core): [plan-02] cover idempotency of applyUnpaidBatchItemErrors`.

Phase B — barrel export, single logical unit:

5. Add `export * from "./batch-partial"` to `lib/ai/core/index.ts`. Verify importing `applyUnpaidBatchItemErrors` and `BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR` from `@/lib/ai/core` works at the top of a fresh test file. **Commit:** `chore(ai-core): [plan-02] re-export batch-partial from index`.

## Files Touched

- [lib/ai/core/batch-partial.ts](../../lib/ai/core/batch-partial.ts) (new)
- [lib/ai/core/index.ts](../../lib/ai/core/index.ts) (one line added)
- [tests/ai-batch.test.ts](../../tests/ai-batch.test.ts) (new describe block at the end, ~40 lines added)

## Migration Stance

None. Pure addition; no schema changes; no existing wire behavior touched.

## Test Plan

- Unit: 2 cases in `tests/ai-batch.test.ts` (paid/unpaid split + idempotency).
- Existing tests in `tests/ai-batch.test.ts` (the `processBatch`, `processScreeningBatch`, `processTranslationBatch` describes at lines 1-134) continue to pass — they don't touch the new helper.
- `tsc` and Convex typecheck green.

## Acceptance Criteria

- `lib/ai/core/batch-partial.ts` exists with both exports.
- `lib/ai/core/index.ts` re-exports them.
- Both new test cases are green.
- A consumer can `import { applyUnpaidBatchItemErrors, BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR } from "@/lib/ai/core"` from any TypeScript file in the repo.
- Full `vitest run` is green.
- No regression in the existing `tests/ai-batch.test.ts` cases.

## Known Pitfalls

- Do not mutate the input shape's `errors` array via `Array.prototype.push` if the consumer might be holding a reference to the original. Reference implementation at `/tmp/openalex-main-inspect/lib/ai/core/batch-partial.ts:27-54` returns the input `T` (mutated) for ergonomics — that's acceptable here because `withAuthAndCreditsBatch` (slice 03's caller) owns the value and is about to return it. Document the in-place mutation in a one-line JSDoc comment if the file would otherwise have no docs.
- The `Set<string>` deduplication of `unpaidItemIds` is required because the iterable may contain duplicates (e.g., two `usageBreakdown` entries for the same paper). Do **not** assume the caller pre-dedups.
- The error string is user-facing eventually (slice 05's alert maps it via `parseChatError`). Do not localize it here — the alert layer handles i18n. The constant is the wire-level token; localized rendering happens in `messages/*.json`.
- Do **not** export the constant from `convex/lib/errors.ts`. That file is reserved for `ErrorCode` enum symbols. Co-location with the helper is the established pattern (see `lib/ai/core/batch-types.ts` for prior precedent).
