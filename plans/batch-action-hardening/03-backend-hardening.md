# Plan 03 — Backend Hardening (Lock + Rate-Limit + Salvage)

**Depends on:** 01 (`hasEnoughCredits`), 02 (`applyUnpaidBatchItemErrors`). **Blocks:** 04 indirectly (client benefits from real partial results); 05 (UI consumes salvaged errors).

## Goal

Add server-side defense-in-depth to both interactive batch AI actions: an exclusive per-user lock, a request-frequency cap, and mid-batch credit salvage. Apply identically to `generateBatchScreeningResponses` and `generateBatchTranslations`.

## Scope

In scope:

- New `userResourceLocks` schema table with `kind` discriminator.
- New `convex/lib/locks.ts` exporting `acquireBatchLock` and `releaseBatchLock` internalMutations parameterized by `kind`.
- Two new rate-limit buckets in `convex/lib/rateLimit.ts`: `"batch-screening"` and `"batch-translation"` (both 15/min, capacity 15).
- Mid-batch salvage in `withAuthAndCreditsBatch` (`convex/ai/helpers.ts:226-335`):
  - New helper `collectBillableItemIds` reading typed `UsageBreakdownEntry.paperId` (not `metadata?.paperId`).
  - Try/catch around the per-item `deductCredits` loop using `classifyUnknownError` to detect insufficient-credits.
  - Salvage path that calls `applyUnpaidBatchItemErrors` and emits `captureServerEvent("credits_exhausted_mid_batch", ...)`.
- Lock + rate-limit wrapping for both batch actions in `convex/ai/actions.ts`:
  - `generateBatchScreeningResponses` (`:241-339`) → `kind: "batch_screening"`.
  - `generateBatchTranslations` (`:147-235`) → `kind: "batch_translation"`.
- New tests: `convex/lib/locks.test.ts` (acquire/release/expiry/concurrent-throw) and additions to existing helper tests for the salvage path.

Out of scope:

- Long-running screening jobs that go through `convex/screening/workpoolActions.ts` (already protected by `screeningJobs.status="processing"` per-user guard at `convex/screening/mutations.ts:65-78`).
- Background extraction work (`convex/extraction/workpoolActions.ts`) — different concurrency model.
- Chat batch flows (none exist).

## Design

### Schema — `userResourceLocks`

Add to `convex/schema.ts`:

```text
userResourceLocks: defineTable({
  userId: v.id("users"),
  kind: v.union(v.literal("batch_screening"), v.literal("batch_translation")),
  acquiredAt: v.number(),
  expiresAt: v.number(),
})
  .index("by_user_kind", ["userId", "kind"])
  .index("by_user_kind_expires", ["userId", "kind", "expiresAt"])
```

Reference shape: `/tmp/openalex-main-inspect/convex/schema.ts:13-20` (renamed from `aiBatchLocks`; `kind` widened to a two-literal union).

### `convex/lib/locks.ts`

Two `internalMutation` exports:

```text
acquireBatchLock({ userId, kind, ttlMs }: { userId: Id<"users">; kind: BatchLockKind; ttlMs: number }): Promise<Id<"userResourceLocks">>
releaseBatchLock({ lockId }: { lockId: Id<"userResourceLocks"> }): Promise<void>
```

Where `BatchLockKind = "batch_screening" | "batch_translation"`.

`acquireBatchLock` semantics:

1. Query active lock via `by_user_kind_expires` index where `expiresAt > now`. If any row exists, throw `createError("BATCH_ACTION_ALREADY_RUNNING", ...)` with `kind` in the payload. (The error code is new; add to `convex/lib/errors.ts` `ErrorCode` enum and to `lib/errors/taxonomy.ts` if user-facing.)
2. GC: delete any expired rows for `(userId, kind)` via the `by_user_kind` index where `expiresAt <= now`.
3. Insert: `acquiredAt: Date.now()`, `expiresAt: Date.now() + ttlMs`.
4. Return the inserted lock id.

`releaseBatchLock` semantics: delete by id; idempotent (no-op if already deleted).

Constants in the same module:

```text
export const BATCH_LOCK_TTL_MS = 10 * 60 * 1000  // 10 minutes
```

### Rate-limit additions — `convex/lib/rateLimit.ts`

Add two buckets to the `defineRateLimits({})` config block:

```text
"batch-screening": { kind: "token bucket", rate: 15, period: MINUTE, capacity: 15 },
"batch-translation": { kind: "token bucket", rate: 15, period: MINUTE, capacity: 15 },
```

Extend the `consume` mutation's `name` validator union (`convex/lib/rateLimit.ts:57-63`) to include both new literals.

Reference: `/tmp/openalex-main-inspect/convex/lib/rateLimit.ts:48-69`. The 15/min cadence is consistent with sibling buckets (`api-key-save` 5/min, `wallet-connect` 5/min, `start-extraction` 5/hr) and matches the screening reference.

### Mid-batch salvage in `withAuthAndCreditsBatch`

Current state of `convex/ai/helpers.ts:226-335`: pre-flight balance check, per-item `deductCredits` loop with no try/catch. Refactor:

1. Add helper `collectBillableItemIds(entries: UsageBreakdownEntry[], pricing: Pricing): string[]`. For each entry where `calculateServerCreditsToDeduct(entry.usage, pricing) > 0`, return the typed `entry.itemId` (the new first-class field added in this slice for batch flows that don't have an `Id<"extractionPapers">` / `Id<"extractionResults">` to point at). **Do not** read `entry.metadata?.openalexId`, `entry.metadata?.paperId`, or any metadata key — typed first-class fields only.

   Original plan said "read `entry.paperId` or `entry.resultId`". Inspection of the actual call sites in `convex/ai/actions.ts:193,297` confirmed neither typed Id is populated for batch screening or batch translation: those flows pass external openalex paper references (`BatchPaper.id: string`), not Convex table ids. Forcing `entry.paperId` to hold an external string would break its `Id<"extractionPapers">` type contract and the `by_paper` ledger index.

   Resolution: extend `UsageBreakdownEntry` with a new typed `itemId?: string` field for "the input batch item identifier — keys back into `BatchResult.results` and `BatchResult.errors[].paperId`." Populate it at both batch call sites with the original `paperRef` (input id). The helper reads this typed field. Adheres to the spirit of doctrine point 7 ("typed first-class fields, not metadata") for the actual data-flow shape of these flows. The `paperId`/`resultId` typed Convex Id fields stay reserved for ledger flows that genuinely persist into the extraction pipeline tables.

2. Wrap the per-item loop (`:307-321`) in try/catch:
   ```text
   for (let index = 0; index < usageBreakdown.length; index++) {
     try {
       await ctx.runMutation(internal.credits.internal.deductCredits, ...)
     } catch (error) {
       const classified = classifyUnknownError(error);
       if (classified.code !== "insufficient_credits") throw error;
       const remainingEntries = usageBreakdown.slice(index);
       const unpaidItemIds = collectBillableItemIds(remainingEntries, pricing);
       if (unpaidItemIds.length === 0) throw error;
       await captureServerEvent({
         distinctId: user.clerkId,
         event: "credits_exhausted_mid_batch",
         properties: {
           feature,
           unpaid_item_count: unpaidItemIds.length,
           first_unpaid_item_id: unpaidItemIds[0],
         },
       });
       return applyUnpaidBatchItemErrors(result, unpaidItemIds);
     }
   }
   ```

3. Use `classifyUnknownError` from `lib/errors/taxonomy.ts:151-161`. **Do not** introduce a new `isInsufficientCreditsError` predicate.

4. Use `captureServerEvent` from `lib/posthog-server.ts:66`. Match the payload shape of the existing `credits_insufficient` events at `convex/ai/helpers.ts:248,363,491` (snake_case, `feature`, `distinctId = user.clerkId`).

### Action wrapping — `convex/ai/actions.ts`

For both `generateBatchScreeningResponses` (`:241-339`) and `generateBatchTranslations` (`:147-235`):

1. Get current user (auth check) at the top of the handler.
2. Consume rate-limit token: `await ctx.runMutation(internal.lib.rateLimit.consume, { name: "batch-screening" | "batch-translation", key: user._id })`.
3. Acquire lock: `const lockId = await ctx.runMutation(internal.lib.locks.acquireBatchLock, { userId: user._id, kind: "batch_screening" | "batch_translation", ttlMs: BATCH_LOCK_TTL_MS })`.
4. Wrap the existing `withAuthAndCreditsBatch` call in `try { ... } finally { await ctx.runMutation(internal.lib.locks.releaseBatchLock, { lockId }) }`.

The existing `withAuthAndCreditsBatch` invocation is preserved — the lock and rate-limit live **outside** it. Reference shape: `/tmp/openalex-main-inspect/convex/ai/actions.ts:272-359`.

## TDD Sequence

Phase A — pure logic, commit per green:

1. RED: `convex/lib/locks.test.ts` for `acquireBatchLock`:
   - acquires successfully when no active lock exists for `(userId, kind)`.
   - throws `BATCH_ACTION_ALREADY_RUNNING` when an active lock exists.
   - GCs expired locks for the same `(userId, kind)` before inserting.
   - allows acquisition for a different `kind` even when one kind is held.
   - allows acquisition by a different user even when one user holds the kind.
2. GREEN: implement `acquireBatchLock` in `convex/lib/locks.ts`. **Commit:** `feat(locks): [plan-03] add acquireBatchLock`.
3. RED: tests for `releaseBatchLock`:
   - deletes the lock row by id.
   - is idempotent (calling twice does not throw).
   - allows re-acquisition after release.
4. GREEN: implement `releaseBatchLock`. **Commit:** `feat(locks): [plan-03] add releaseBatchLock`.
5. RED: tests for the `BATCH_LOCK_TTL_MS` expiry behavior — fast-forward `Date.now()` (or use a clock fixture) past expiry; assert that next acquire succeeds.
6. GREEN: confirm GC path works. **Commit if implementation changed:** `fix(locks): [plan-03] tighten expiry GC`.

Phase B — wire-up, commit per logical unit:

7. Add `userResourceLocks` table to `convex/schema.ts`. Run `npx convex dev` (via pm2 logs) to confirm schema deploys cleanly. **Commit:** `feat(schema): [plan-03] add userResourceLocks table`.
8. Add the two rate-limit buckets and extend the `consume` validator. Add a focused unit/integration test in `convex/lib/rateLimit.test.ts` (if it exists; create it if not) for `"batch-screening"` consume succeeds and rejects on overflow. **Commit:** `feat(ratelimit): [plan-03] add batch action buckets`.
9. Add `collectBillableItemIds` helper in `convex/ai/helpers.ts`. Add a unit test for it. **Commit:** `feat(ai): [plan-03] add collectBillableItemIds helper`.
10. Refactor `withAuthAndCreditsBatch` per-item loop into try/catch with `applyUnpaidBatchItemErrors` salvage. Add a `convex-test` integration test covering: insert user with credits = N (enough for first 3 of 5 items); call helper with 5-paper batch; assert results contain only papers 1–3 and errors contain papers 4–5 with the canonical insufficient-credits string; assert `creditTransactions` has 3 ledger rows; assert `captureServerEvent` was called with `credits_exhausted_mid_batch`. **Commit:** `feat(ai): [plan-03] salvage paid items on mid-batch credit exhaustion`.
11. Wire lock + rate-limit around `generateBatchScreeningResponses`. Add a `convex-test` for: two concurrent calls from the same user; second throws `BATCH_ACTION_ALREADY_RUNNING`; first completes and releases; subsequent call succeeds. **Commit:** `feat(ai): [plan-03] gate generateBatchScreeningResponses with lock and rate-limit`.
12. Wire lock + rate-limit around `generateBatchTranslations` (parameterized by `kind: "batch_translation"`). Mirror the integration test. **Commit:** `feat(ai): [plan-03] gate generateBatchTranslations with lock and rate-limit`.

## Files Touched

- [convex/schema.ts](../../convex/schema.ts) — add `userResourceLocks` table and indexes.
- [convex/lib/locks.ts](../../convex/lib/locks.ts) (new).
- [convex/lib/locks.test.ts](../../convex/lib/locks.test.ts) (new).
- [convex/lib/rateLimit.ts](../../convex/lib/rateLimit.ts) — two new buckets, extend `consume` validator union.
- [convex/lib/rateLimit.test.ts](../../convex/lib/rateLimit.test.ts) — extend if exists, create if not.
- [convex/lib/errors.ts](../../convex/lib/errors.ts) — add `BATCH_ACTION_ALREADY_RUNNING` error code.
- [lib/errors/taxonomy.ts](../../lib/errors/taxonomy.ts) — map the new error code if user-facing.
- [convex/ai/helpers.ts](../../convex/ai/helpers.ts) — add `collectBillableItemIds`; refactor per-item loop with try/catch + salvage.
- [convex/ai/helpers.test.ts](../../convex/ai/helpers.test.ts) — extend if exists, create if not.
- [convex/ai/actions.ts](../../convex/ai/actions.ts) — wrap both batch actions with lock + rate-limit.

## Migration Stance

Schema-breaking by default per CLAUDE.md doctrine.

- Adding `userResourceLocks` is purely additive; no rejection of existing data.
- The `kind` validator ships as `v.union(v.literal("batch_screening"), v.literal("batch_translation"))` from the first commit. **Do not** widen to `v.string()` and narrow later.
- No backfill script. No `@convex-dev/migrations` work.
- If schema deploy is rejected, wipe `userResourceLocks` via the Convex dashboard — it's a transient lock table.

## Test Plan

- Unit: `collectBillableItemIds` (3-4 cases for typed `paperId`/`resultId`/empty entry).
- Unit: `acquireBatchLock` / `releaseBatchLock` semantics (5 acquire cases + 3 release cases + expiry).
- Integration via `convex-test`:
  - Mid-batch credit exhaustion salvage (verifies ledger writes, error envelope, telemetry).
  - Concurrent batch screening attempts (second throws lock error).
  - Concurrent batch translation attempts (second throws lock error).
  - Mixed-kind concurrent attempts (different kinds coexist).
  - Rate-limit overflow (16th call in <1 minute throws).
- Convex typecheck and `tsc` green.
- pm2 logs show clean schema deploy.

## Acceptance Criteria

- `userResourceLocks` table is live in dev with both indexes.
- `convex/lib/locks.ts` exports `acquireBatchLock`, `releaseBatchLock`, `BATCH_LOCK_TTL_MS`.
- Both rate-limit buckets exist and the `consume` validator accepts them.
- `generateBatchScreeningResponses` and `generateBatchTranslations` perform auth → rate-limit → acquire → run → finally release.
- Mid-batch credit exhaustion returns partial success with structured errors; ledger writes match the items actually paid for.
- All Phase A and Phase B tests are green.
- `BATCH_ACTION_ALREADY_RUNNING` error code is defined and surfaceable to the client (slice 05 will render it).
- Convex typecheck, `tsc`, and the affected `vitest run` slices are green.
- pm2 Convex logs show no schema validator errors after deploy.

## Known Pitfalls

- The lock is **per `(userId, kind)`**, not per user across kinds. A user can have one screening batch and one translation batch in flight simultaneously — that is correct. Verify this in the "mixed-kind concurrent attempts" test.
- `releaseBatchLock` must run in `finally` regardless of whether the inner action threw, succeeded, or returned partial results. Do **not** put the release inside the `try` block.
- The rate-limit consume happens **before** lock acquire. If a user spam-clicks while a lock is held, the second click should fail with the rate-limit message (cheap), not the lock message (after expensive auth). This matches the reference at `/tmp/openalex-main-inspect/convex/ai/actions.ts:277-288`.
- The `kind` discriminator uses **underscore** form (`"batch_screening"`) for the lock table rows; the rate-limit bucket uses **hyphen** form (`"batch-screening"`) to match the existing rate-limit naming convention. This is intentional asymmetry; both are stable wire literals.
- `collectBillableItemIds` must read `entry.paperId` for paper batches and `entry.resultId` for result batches. Inspect the actual `UsageBreakdownEntry` callers at `convex/ai/helpers.ts:197-218` to confirm which field is populated for each batch flow before writing the helper.
- The `applyUnpaidBatchItemErrors` import path is `@/lib/ai/core` (slice 02 added the barrel re-export). **Do not** import from `@/lib/ai/core/batch-partial` directly.
- Convex `internalMutation` runs in the same transactional context as the action. The lock's GC delete + insert is atomic per `userId/kind` — no double-acquire race is possible because of Convex's optimistic concurrency.
- The `BATCH_ACTION_ALREADY_RUNNING` error must include `kind` in the payload so the UI alert can localize per kind ("a screening batch is already running" vs "a translation batch is already running"). Wire it through `createError(code, message, { kind })`.
