# Plan 04 — Credit Cost Aggregation & UI Surfacing

**Depends on:** 01 (taxonomy — for `creditTransactions` shape reuse). Independent of 02, 03, 05, 06, 07 — can parallelize.

> **Workpool note:** This plan has no workpool dependency. Safe on the pinned 0.3.2.

## Goal

Surface credit usage at every level the user cares about: a pre-flight estimate (ships in plan 03), a live running total during execution, a cost summary on completion, a per-paper column in the results table, and a job-scoped transaction ledger in the billing history.

All powered by a single `creditsAgg` (extending the project's existing `@convex-dev/aggregate` pattern), with a first-class `jobId` column on `creditTransactions`.

Closes gap #4 (credits invisible).

## Scope

**In scope**
- New `creditsAgg` instance via `@convex-dev/aggregate`, namespaced by `jobId`, `sumValue = paper.creditsUsed` (or after plan 02, per-question `result.creditsUsed`).
- Promote `jobId` from `creditTransactions.metadata` (string) → first-class `v.optional(v.id("extractionJobs"))` field, with `by_job` index.
- Migration that backfills from existing metadata.
- Query: `getJobCost(jobId)` → `{ total, breakdown: { indexing, extraction } }`.
- UI: header chip with total cost; per-paper column; completion toast; billing-page filter by job.

**Out of scope**
- `totalCreditsUsed` field on `extractionJobs` doc — explicitly rejected per Convex guidelines.md:158 ("high-churn on shared documents" anti-pattern).
- Re-estimating cost mid-job (that's what `creditsAgg.sum` gives us, continuously, via reactivity).

## Design

### Aggregate setup

Register (`convex/convex.config.ts`):
```ts
app.use(aggregate, { name: "creditsAgg" });
```

Instantiate (`convex/extraction/aggregates.ts`, alongside existing three):
```ts
export const creditsAgg = new DirectAggregate<{
  Namespace: Id<"extractionJobs">;
  Key: number;                // _creationTime of the result doc
  Id: Id<"extractionResults">; // post-plan-02; pre-plan-02 use Id<"extractionPapers">
}>(components.creditsAgg);
```

Write helpers:
```ts
export async function recordCreditSpend(ctx, { jobId, resultId, creditsUsed, at }) {
  await creditsAgg.insertIfDoesNotExist(ctx, {
    namespace: jobId, key: at, id: resultId, sumValue: creditsUsed,
  });
}

export async function clearJobCredits(ctx, jobId) {
  await creditsAgg.clear(ctx, { namespace: jobId });
}
```

Call sites:
- **DRY hook site (single choke-point):** The `creditsUsed` write choke-point is `markPaperTerminalTx` in `convex/extraction/paperLifecycle.ts:74` — every terminal transition flows through this helper (called by `results.ts`, `papers.ts`, `onComplete.ts`, and the workpool action error-paths). Add the `creditsAgg.insertIfDoesNotExist` / `replaceIfExists` call inside `markPaperTerminalTx` so there is exactly ONE hook site. Do NOT mirror the write into each caller — DRY.
  - For reference, the 5 existing write call sites that all funnel through `markPaperTerminalTx`:
    - `convex/extraction/mutations/results.ts:210,276-295` (`saveExtractionResultsAndComplete`)
    - `convex/extraction/mutations/papers.ts:94,105,118-119` (direct `markPaperCompleted`)
    - `convex/extraction/paperLifecycle.ts:51,74` (`markPaperTerminalTx` patch path — the common denominator)
    - `convex/extraction/workpoolActions.ts:766,773,839,1160` (action-level pass-through)
    - `convex/extraction/mutations/internal/onComplete.ts:161,184` (defensive fallback)
- Plan 02's `recordOneAnswer` mutation calls `recordCreditSpend` in the same txn as credit deduction (per-question granularity, complementary to the paper-terminal hook).
- `deleteExtractionInternal` cascade calls `clearJobCredits`.
- `cancelExtraction` does NOT clear (you keep the receipt for already-spent credits).

### Read API

`convex/extraction/queries/costs.ts`:
```ts
export const getJobCost = query({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    const total = await creditsAgg.sum(ctx, { namespace: jobId });
    // Breakdown: split via creditTransactions ledger (indexing vs extraction_llm)
    const breakdown = await sumByBillingType(ctx, jobId);
    return { total, breakdown };
  },
});
```

### `creditTransactions` refactor

Current (`convex/schema.ts:121-148`): `metadata: v.record(v.string(), v.string())` carries `{ jobId, paperId, billingType }` — but records aren't indexable.

Change:
```ts
creditTransactions: defineTable({
  userId: v.optional(v.id("users")),   // unchanged — preserve existing optionality (see note below)
  amount, type, reason, ...
  jobId: v.optional(v.id("extractionJobs")),   // NEW, first-class
  paperId: v.optional(v.id("extractionPapers")),
  resultId: v.optional(v.id("extractionResults")),  // post-plan-02
  billingType: v.optional(v.union(
    v.literal("extraction_llm"),
    v.literal("embedding"),
    v.literal("screening"),
    v.literal("chat"),
  )),
  // metadata kept as escape hatch for things we haven't promoted yet
})
.index("by_user", ["userId"])   // PRE-EXISTING — not net-new
.index("by_job", ["jobId"])     // NEW — only this index is net-new
```

> The current schema keeps `userId` optional (FK to `credits` row is the canonical owner). Do not silently tighten it as part of this refactor; if tightening is desired, call it out explicitly with a migration.

**No migration.** Per `00-README.md`: wipe `creditTransactions` in the Convex dashboard when the schema validator rejects old rows. Fresh ledger from day one of the new schema. The user has authorized wiping dev data.

Call sites that write credit transactions (currently: `internal.credits.internal.deductCredits` in `convex/credits/internal.ts:1459-1516` — **TODO: re-anchor this line range before executing; file may have drifted.**): switch to passing structured args, not `metadata` objects.

### UI surfaces

**1. Header chip on job detail page**
```tsx
<CostBadge jobId={jobId} /> 
// renders: "218 credits used" with tooltip "150 indexing · 68 extraction"
```
Component subscribes to `getJobCost`. Auto-updates while job runs.

**2. Results table column** (`components/extraction/results-table.tsx`)
New column "Credits" showing `paper.creditsUsed` (or sum over question rows post-plan-02). Hidden by default; user-toggleable (follow existing column-visibility pattern).

**3. Completion toast**
On `job.status` transition `extracting → completed`, client-side effect in job detail page emits:
```
toast({ title: "Extraction complete", description: `Used 218 credits on 47 papers.` })
```

**4. Billing page filter**
`app/settings/billing/page.tsx` — filter transaction list by `jobId` via query param `?jobId=xxx`. From the extraction detail page, add a "View transactions" link that deep-links here.

**5. Pre-flight banner from plan 03**
Also consumes `getJobCost` (for in-progress comparison: "Used 120 / ~240 credits so far").

### Reactivity

Per aggregate README: query functions that call `creditsAgg.sum(ctx, { namespace })` auto-rerun when that namespace's data changes. Namespace isolation means paper-45 finishing on job-A does not invalidate queries for job-B. Free running-total.

## TDD sequence

**No pure-logic pieces in this plan.** The aggregate component does the heavy lifting and is already battle-tested by its own test suite. The two reducers (`sumByBillingType`, `getJobCost`) are trivial Convex queries that need a ctx to run.

**Exception — if we introduce a `breakdownCreditTransactions(rows)` pure helper for UI display (currently unplanned), it gets the TDD treatment:**

```
R1 → G1  test: breakdownCreditTransactions([]) → {indexing:0, extraction:0, other:0}
R2 → G2  test: groups by billingType correctly; unknown type → "other" bucket
R3 → G3  test: sums absolute amounts (no sign-flip bugs)
```

Otherwise, proceed to test-after implementation as enumerated in the Test plan section.

## Files touched

- `convex/convex.config.ts` — register `creditsAgg`.
- `convex/extraction/aggregates.ts` — add instance + helpers.
- `convex/extraction/queries/costs.ts` (new).
- `convex/extraction/paperLifecycle.ts` — add `recordCreditSpend` call inside `markPaperTerminalTx` (the single DRY hook site; see Call sites above). No mirrored writes in `results.ts` / `papers.ts` / `onComplete.ts` / `workpoolActions.ts` — they all flow through this helper.
- `convex/credits/internal.ts` — `deductCredits` accepts structured args.
- `convex/schema.ts` — `creditTransactions` refactor.
- (no migration file — dev data is disposable; wipe `creditTransactions` instead)
- `convex/extraction/mutations/internal/admin.ts` — cascade clears include `clearJobCredits`.
- `components/extraction/cost-badge.tsx` (new).
- `components/extraction/results-table.tsx` — credits column.
- `app/extraction/[jobId]/page.tsx` — header chip + completion toast.
- `app/settings/billing/page.tsx` — `?jobId=` filter support.
- `messages/*.json` — keys `extraction.cost.credits`, `.completionToast`, `.breakdown.indexing`, `.breakdown.extraction`, `.viewTransactions`.
- Tests: `convex/extraction/credits-agg.test.ts`, `components/extraction/cost-badge.test.tsx`.

## Test plan

- **Convex**: complete a 3-paper job with 6 questions. Assert `getJobCost.total === sum(results.creditsUsed)`. Assert `by_job` index returns 18 transactions (3×6).
- **Convex**: delete a job → `creditsAgg.sum(jobId) === 0`. Cascade clean.
- **Convex**: cancel a job → `creditsAgg.sum` unchanged (receipts preserved for partial work). 
- **Convex**: migration idempotent — run twice, no diff second run.
- **UI** (`cost-badge.test.tsx`): given mocked query returning `{total: 218, breakdown: {indexing: 150, extraction: 68}}`, component renders `"218"` in a `role="status"` span, tooltip shows breakdown, exposes `data-credits-total="218"` for test stability.
- **UI** (integration): job detail page with in-progress job shows cost updating as results arrive (mock Convex subscription).
- **UI**: completion toast fires exactly once per job.

## Acceptance criteria

- [x] `getJobCost(jobId)` returns O(log n) regardless of job size.
      _Verified via `creditsAgg.sum(ctx, { namespace: jobId })` backing the
      total — O(log n) by construction per the @convex-dev/aggregate
      component. Breakdown path uses the new `by_job` index so it scales
      with this-job's debit count (bounded by P × Q), not the global
      ledger. Covered by `convex/extraction/costs.test.ts`._
- [x] Job detail header shows live cost and updates within ~1s of each
      question completion.
      _Via `<CostBadge jobId compact />` in the header metadata row,
      subscribing to `api.extraction.queries.costs.getJobCost`._
- [x] Results table has Credits column (opt-in via column-visibility
      control).
      _Added Columns dropdown to `ResultsToolbar` (table-view only) with a
      Credits toggle. State URL-backed via `?credits=1`. Cells render
      `paper.creditsUsed ?? 0` + `data-credits` attribute._
- [x] Completion toast mentions credit count.
      _`<CompletionToastObserver />` observes extracting → completed and
      fires one sonner.success with total + paper count. Four guards:
      no-fire on direct mount, no-double-fire on re-render, wait for cost
      query, fire only on real transition. Tests in
      `tests/components/completion-toast-observer.test.tsx`._
- [x] Billing page filters transactions by jobId and the URL updates
      accordingly.
      _`<TransactionsList />` reads `?jobId=` from `useSearchParams`, runs
      the scoped `getTransactions({ jobId })` path, renders clearable
      filter chip. "View transactions" deep-link on extraction detail
      header._
- [x] `creditTransactions.metadata` no longer stores `jobId` / `paperId`
      — those are first-class fields.
      _Schema promotion (`creditTransactions.jobId | paperId | resultId |
      billingType`) + `by_job` index. `deductCredits` accepts structured
      scope args. All three extraction+chat call sites migrated. Behavior
      test asserts `metadata.jobId === undefined` on every usage row._
- [x] All existing billing + credit tests pass.
      _216 test files / 2403 tests green (after registering `creditsAgg`
      in `aggregates.test-support.ts` for the cascade-delete path)._

## Implementation notes (post-execution)

- **Embedding credits**: the plan originally suggested hooking only the
  `recordOneAnswer` path, but that would have left embedding debits out
  of `creditsAgg` and broken the O(log n) total. Also hooked
  `markPaperIndexed`; aggregate `Id` widened to `string` to accept both
  resultId (extraction_llm) and `embed:<paperId>` (embedding) in the
  same namespace.
- **billingType taxonomy**: renamed `extraction_embedding` → `embedding`
  and `chat_llm` → `chat` to match the plan's four-value enum. Wallet
  gateway's `wallet_api` stays in metadata only (not in the plan enum).
- **`clearJobCredits` only, no ledger purge**: `deleteExtractionInternal`
  clears the aggregate namespace but deliberately does NOT delete
  `creditTransactions` rows — the ledger is the user's credit-audit
  trail and must survive job deletion.
- **Pre-step deviation**: Convex `esbuild` couldn't resolve `@/` alias
  used by plan-01 taxonomy imports in `convex/*`. Fix: add `paths` to
  `convex/tsconfig.json` (omit `baseUrl` on purpose — setting it would
  steal bare-package imports like `"stripe"` to `convex/stripe.ts`).
  Also wiped 530 legacy `extractionBilled` fields on `extractionPapers`
  that were left behind by plan-02.

## Known pitfalls

- **Cost-badge over-subscription**: avoid `useQuery(api.cost.getJobCost, {jobId})` re-running on every paper completion if the job has 1000+ papers. The aggregate is O(log n) so this is cheap; but test with a 500-paper seeded job and watch the dashboard for function-call rate. Add throttling if needed.
- **Replay-aggregate-from-ledger on first deploy**: after wiping `creditTransactions` per migration stance, there are no historical rows to worry about. But if you ever seed test data, run a one-shot internal mutation that iterates `creditTransactions` and calls `creditsAgg.insertIfDoesNotExist` for each — the aggregate does not auto-backfill from existing rows.
