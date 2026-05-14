# Balance ShardedCounter migration + PERFORMANCE_REVIEW HIGHs

## 1. Motivation / gap audit

Tier D made the credit balance a derived value: `getBalance(creditsId)` calls `balanceAgg.sum(...)` (a `@convex-dev/aggregate` `DirectAggregate`) over the user's `creditTransactions` ledger. The aggregate is keyed `[CreditType, hashTxId]` with `sumValue = signed amount`.

This works for sparse ledgers. It does NOT work at production scale:

- One affected user has 4,148 ledger rows.
- `balanceAgg.sum(prefix=[creditType])` walks the aggregate's lazy-root B+ tree. At that depth it reads ~48 internal component docs, blowing through Convex's 16 MB / mutation budget.
- The Tier D reservation path (`convex/credits/reservation.ts:120`) calls `getBalance` INSIDE a mutation to gate `INSUFFICIENT_CREDITS`. Every job's extraction fan-out (`convex/extraction/mutations/internal/fanout.ts:237`) hits this. Result: every extraction over a "fat" wallet fails with `Too many bytes read in a single function execution`.
- Convex's own docs say: aggregates are for range/prefix queries (count-over-window, sum-over-window). Running totals read inside mutations belong in `@convex-dev/sharded-counter`. The repo already uses that component for `extractionProcessedCounter` / `extractionFailedCounter` (`convex/extraction/jobCounters.ts:62-69`), so the donor pattern is in-tree.

Every production credit ledger (Stripe, Lago, OpenMeter, TigerBeetle, Modern Treasury) materializes the balance scalar — none compute it by summing the ledger on every read. We're rolling back the "no scalar" idea and routing balance through two ShardedCounter instances (one per pool).

The same review (`/Users/mcharrad/Downloads/PERFORMANCE_REVIEW.md`) flagged two adjacent HIGHs that are fixable in the same arc: H1 (`grantUpgradeProRataCredits` `.collect()` over the whole ledger) and H4 (`cleanupZombieChatLocks` full-table iterate every 5 minutes). H3 (projection OCC storm) is left out — recent commits `a55ef3f6` (Tier C: move projection state off `extractionPapers` row) and `7c68a3a2` (Tier A: per-paper sub-workflows + raise pool) already changed the shape; rerun analysis post-migration before opening a follow-up.

## 2. Locked design decisions

1. **Two ShardedCounter instances, not one.** Per-pool counters (`balanceFreeCounter`, `balancePaidCounter`), both keyed by `Id<"credits">`. Total is derived. Avoids a 3-shard read for total when callers only need one pool, and matches the `(free, paid)` shape Tier D already exposes.
2. **`defaultShards: 16`.** Credits writes per user are reservation + settlement + grant + occasional deduct — far lower fan-out than the job counters (which run 50-way paper writes and chose 64). The sharded-counter library default is 16, and Convex's stickyShard optimization keeps repeat writers on the same shard until contention is observed.
3. **Signed `.add(ctx, creditsId, amount)`** for every ledger event. Library supports negative `count` natively; no separate debit method needed.
4. **Delete `balanceAgg` completely.** No widen-then-narrow, no parallel read paths. Per `CLAUDE.md` migration stance: dev data is disposable.
5. **One-shot seed mutation, not a `convex/migrations/` file.** The new counter must start with each existing credits row's correct value. We add a dev-gated `internalMutation seedBalanceCountersFromLedger({ creditsId })` callable from the Convex dashboard. This is initialization of a new component from canonical source data (the ledger), not legacy preservation.
6. **Add a drift-detection cron.** Hourly internalAction that picks a random sample of credits rows, recomputes balance from the ledger via `by_credits_createdAt` indexed scan, compares to counter values, and logs drift. Read-only. Modern Treasury reconciliation pattern. No self-healing — the ledger remains source of truth.
7. **`getBalance` is renamed `readBalance`** and lives in `convex/credits/balanceCounter.ts`. All 11 direct call sites are updated. No re-export shim.
8. **H1 fix**: replace `.collect()` over `by_user` with descending iteration bounded by `currentPeriodStartMs`, using `by_credits_createdAt` after fetching the credits row first.
9. **H4 fix**: switch `cleanupZombieChatLocks` to the existing `by_mode` index with `mode === "chat"` so the 5-min cron never touches non-chat extraction jobs.

## 3. Plan-file inventory

| File | Slice |
| --- | --- |
| `01-replace-balanceagg-with-sharded-counter.md` | Register two ShardedCounter components, write `balanceCounter.ts`, rewire all `recordTransactionCounters` / `forgetTransactionCounters` / `clearUserTransactionCounters` / `getBalance` call sites, seed counters from the existing ledger, add reconciliation cron, delete `balanceAgg`. |
| `02-fix-h1-grant-prorata-collect.md` | Rewrite `grantUpgradeProRataCredits` to fetch credits first, then iterate `by_credits_createdAt` descending with an early break on `currentPeriodStartMs`. |
| `03-fix-h4-zombie-locks-scan.md` | Switch `cleanupZombieChatLocks` to `by_mode` index with `mode === "chat"` prefix; drop the `row.mode !== "chat"` filter. |

## 4. Dependency graph

```
01 (migration)  ──────────  independent — unblocks reservation/extraction
02 (H1)         ──────────  independent of 01 (doesn't touch balanceAgg directly)
03 (H4)         ──────────  independent of 01 and 02
```

01 is the critical-path blocker (production is broken). 02 and 03 can be done in either order after 01 lands, or in parallel by another session.

## 5. Reuse / DRY notes

- **Component pattern**: `convex/extraction/jobCounters.ts:49-104` is the donor. Mirror its structure exactly: typed `ShardedCounter<Id<"credits">>`, top-level instances, `read*` / `inc*` / `clear*` exported helpers. Do NOT define a class.
- **Component registration**: `convex/convex.config.ts` already imports `shardedCounter` for the extraction counters; reuse the import.
- **Test support**: `convex/extraction/aggregates.test-support.ts:45-46` already calls `registerShardedCounter`. Replace `convex/credits/aggregates.test-support.ts:30`'s `registerAggregate(ht, "balanceAgg")` with `registerShardedCounter(ht, "balanceFreeCounter")` + `registerShardedCounter(ht, "balancePaidCounter")`.
- **getBalance callers** (11 direct, ~25 transitive via `getBalanceByUserId`) — rename, update imports, no shim. Sites:
  - `convex/credits/internal.ts:90` (the `getBalanceByUserId` internalQuery wrapping it)
  - `convex/credits/reservation.ts:116,120`
  - `convex/testing/billing.ts:241`
  - `convex/screening/mutations.ts:88`
  - `convex/extraction/mutations/{retry,resume,jobs}.ts` (3 sites)
  - 4 tests under `convex/extraction/*.test.ts` and `tests/user-creation.test.ts:95`
- **No new indexes** for H1 — `by_credits_createdAt` already exists on `creditTransactions`.
- **No new indexes** for H4 — `by_mode` already exists on `extractionJobs`.

## 6. Testing doctrine

- **Unit tests (convex-test)** for `convex/credits/balanceCounter.ts`:
  - `readBalance` after a single positive `add` returns `{ free, paid, total }` with the added value in the right pool.
  - Mixed-sign sequence yields the algebraic sum.
  - `clearBalanceCounters` resets both pools to 0.
- **Integration tests** for the rewired writers (`recordTransactionCounters`, `forgetTransactionCounters`):
  - After inserting a `grant` + `usage` pair, `readBalance` returns the net.
  - `forgetTransactionCounters` round-trips a `recordTransactionCounters` call to 0.
- **TOCTOU regression test** (Tier D guarantee preserved):
  - With balance = 100 and two parallel `reserveCreditsTransaction({ amount: 80 })` mutations, exactly one succeeds and one throws `INSUFFICIENT_CREDITS`.
- **Seed test**: prefill a ledger of mixed-pool transactions, call `seedBalanceCountersFromLedger`, assert counters equal the algebraic sum per pool.
- **Reconciliation test**: corrupt one counter via `.add(ctx, id, 1)`, run the drift action, assert the log captures the drift.
- **H1 test**: insert N "noise" transactions before the period start; assert `grantUpgradeProRataCredits` does not read more rows than `transactions-since-period-start`.
- **H4 test**: insert non-chat `extractionJobs` rows, assert `cleanupZombieChatLocks` does NOT touch them.

Behavioral assertions only — no class-name or aggregate-component-internal probes.

## 7. Migration stance

**Destructive.** `balanceAgg` is deleted entirely from `convex.config.ts`, `convex/credits/aggregates.ts`, both test-support files, and any test that referenced it. No widen-then-narrow.

**Bootstrap**: one-shot `seedBalanceCountersFromLedger` called per existing `credits` row via the Convex dashboard. This is NOT a backfill script under `convex/migrations/` — it's an admin helper colocated with the rest of `convex/credits/internal.ts`. After the user runs it on dev, it stays in the codebase as a "rebuild counters" recovery tool.

## 8. Delegation policy

- **Main session**: holds the TDD cycle for `balanceCounter.ts`, the rewire commits, plan-file edits, deployability gate runs.
- **Explore agents**: any further "find all callers of X" lookups during execution.
- **general-purpose**: only if a Convex API behavior turns out unclear (e.g. ShardedCounter inside a workflow step) — research before guessing.

## 9. Grounding sources

- `convex/_generated/ai/guidelines.md` — Convex API rules (mandatory pre-work).
- `node_modules/@convex-dev/sharded-counter/src/client/index.ts` — confirmed `.add(ctx, key, signedAmount)` API.
- `convex/extraction/jobCounters.ts` — donor pattern.
- `/Users/mcharrad/Downloads/PERFORMANCE_REVIEW.md` — H1 / H4 details (H3 stale; deferred).
- pm2 convex error log timestamped 5/14/2026 9:20:57 AM — `Too many bytes read in a single function execution (limit: 16777216 bytes)` traced to `extraction/workflow.ts:566` → reservation handler → `balanceAgg.sum`.
- Recent commits `a48d11a7` (random-key `creditsAgg` writes), `a55ef3f6` (Tier C off the row), `7c68a3a2` (Tier A sub-workflows).
