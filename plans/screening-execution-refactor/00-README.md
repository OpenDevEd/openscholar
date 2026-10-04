# Screening Execution Refactor — Plan Set

Four-plan structural refactor of bulk screening so the feature ships on one orchestration primitive, keeps per-paper completion row-local, removes hot shared-job counter writes, and replaces workflow-era control surfaces with aggregate-backed progress and scoped cancellation.

This is a prerelease cleanup plan set. It is intentionally destructive where the old design is wrong. No compatibility layer, no legacy counters, no dual orchestration path.

---

## Motivation / gap audit

Empirical state of screening execution as of 2026-04-22, verified against source and runtime signals:

1. **Screening has two orchestration layers for one workload.** `createScreeningJob` starts a workflow in [convex/screening/mutations.ts:141](../../convex/screening/mutations.ts) which then loads pending results, flips the job to `processing`, and enqueues each paper in [convex/screening/workflow.ts:18](../../convex/screening/workflow.ts) and [convex/screening/workflow.ts:53](../../convex/screening/workflow.ts). The actual work still happens in `screeningPool`. The workflow adds component-table churn without owning the true contention boundary.
2. **Per-paper completion writes a shared hot document.** `handleScreeningComplete` rereads `screeningJobs` and patches `processedPapers`, `failedPapers`, and `qualifiedPapers` in [convex/screening/mutations.ts:470](../../convex/screening/mutations.ts), [convex/screening/mutations.ts:544](../../convex/screening/mutations.ts), [convex/screening/mutations.ts:551](../../convex/screening/mutations.ts), and [convex/screening/mutations.ts:566](../../convex/screening/mutations.ts). This is the core hot-document pattern Convex warns against.
3. **Secondary side effects are still in the hot completion path.** The same `onComplete` path persists library rows, collection rows, and finalization in [convex/screening/mutations.ts:510](../../convex/screening/mutations.ts), [convex/screening/mutations.ts:526](../../convex/screening/mutations.ts), and [convex/screening/mutations.ts:573](../../convex/screening/mutations.ts). That expands the transaction footprint of every paper completion.
4. **Cancellation is global instead of job-scoped.** `cancelScreeningJob` calls `screeningPool.cancelAll()` in [convex/screening/mutations.ts:205](../../convex/screening/mutations.ts). The Workpool client docs show `cancelAll` is pool-wide and not scoped by domain data. That is structurally wrong for a multi-job surface.
5. **The job row is doing double duty as a stable header and a high-churn progress sink.** `screeningJobs` stores workflow identity and live counters in [convex/schema.ts:948](../../convex/schema.ts). Convex guidance explicitly recommends separating high-churn operational data from stable records.
6. **The progress query reads the hot row directly.** `getScreeningProgress` in [convex/screening/queries.ts:20](../../convex/screening/queries.ts) depends on `processedPapers`, `failedPapers`, and `qualifiedPapers` from `screeningJobs`. That query contract is tying the UI to the wrong data model.
7. **The results table already provides the natural row-local truth source.** `screeningResults` in [convex/schema.ts:995](../../convex/schema.ts) has per-paper status, score, qualification, and library linkage. Progress and side effects should derive from that table instead of incrementing counters on the parent.
8. **Runtime signals confirm the problem class is contention.** `npx convex insights --details` on 2026-04-22 reported heavy OCC retries in `workflow/workpool` internal tables (`runStatus`, `pendingStart`, `pendingCompletion`) plus screening-side retries on `screeningJobs`. This is not a theoretical cleanup.

---

## Locked design decisions

Locked on 2026-04-22 from code audit, Convex docs, aggregate docs, workpool/workflow docs, and repo-specific screening analysis.

| # | Decision | Why |
|---|---|---|
| **D1** | **Remove screening-specific use of `@convex-dev/workflow` entirely.** | Screening does not need a durable multi-step workflow. The current workflow only loads rows and enqueues workpool items. |
| **D2** | **`screeningPool` is the single orchestration primitive for bulk screening.** | One queue, one ownership model, one cancellation model. |
| **D3** | **Store one `workId` per `screeningResults` row and cancel by those ids.** | Replaces the structurally incorrect global `cancelAll()` call with job-scoped cancellation. |
| **D4** | **`screeningJobs` becomes a stable header, not a live counter sink.** | Removes the hot-document write pattern causing OCC churn. |
| **D5** | **Live progress comes from `@convex-dev/aggregate`, namespaced by `jobId`, not from counters on `screeningJobs`.** | This aligns with the project’s existing aggregate pattern and avoids replaying full result scans reactively. |
| **D6** | **`handleScreeningComplete` becomes row-local only.** | It may patch the target `screeningResults` row and aggregate state, but must not patch `screeningJobs` counters or do library/collection persistence inline. |
| **D7** | **Qualified-paper persistence moves to scheduled internal follow-up per result.** | Existing library and collection helpers are already idempotent enough to support deferred execution. |
| **D8** | **Job finalization moves to a scheduled internal follow-up per job.** | Terminal status should be patched rarely and only after aggregate-backed counts say the job is done. |
| **D9** | **Remove screening workflow ids, job counters, and obsolete pending states.** | This is prerelease code. The wrong model should be deleted, not preserved. |
| **D10** | **Keep the worker action pure compute + billing.** | Convex guidance prefers minimizing `runQuery` / `runMutation` / `runAction` choreography and keeping side effects at the real boundary. |
| **D11** | **Cancellation and credits exhaustion must still produce terminal result rows.** | In-flight work can finish after cancel; the row state must not be left in `processing`. |
| **D12** | **No compatibility shims, no backfills to preserve old screening execution semantics.** | Project doctrine: dev data is disposable and legacy behavior is not a release goal. |

---

## Plan-file inventory

```text
plans/screening-execution-refactor/
├── 00-README.md
├── 01-workpool-only-job-lifecycle.md
├── 02-aggregate-progress-and-query-shift.md
├── 03-row-local-completion-and-deferred-side-effects.md
├── 04-schema-teardown-and-verification.md
└── PROMPTS.md
```

Summary:

- **01** removes workflow orchestration, adds row-scoped work ownership, and fixes cancellation.
- **02** adds aggregate-backed progress and shifts read surfaces away from job counters.
- **03** shrinks `onComplete` to row-local work and moves side effects / terminalization into scheduled follow-ups.
- **04** deletes obsolete schema/state/API leftovers and verifies the refactor end-to-end.

---

## Dependency graph

```text
01 workpool-only lifecycle ───► 02 aggregate progress ───► 03 row-local completion + deferred side effects ───► 04 schema teardown + verification
          │                                   │                                              │
          └───────────────────────────────────┴──────────────────────────────────────────────┘
```

Ship order recommendation: **01 → 02 → 03 → 04**.

- `01` is the control-plane correction.
- `02` establishes the new progress truth source before the old counters are removed.
- `03` removes the hot completion path behavior after aggregates exist.
- `04` is the destructive cleanup and final verification pass.

---

## Reuse / DRY notes

Primary donors and existing patterns this plan set must reuse:

- **`convex/credits/aggregates.ts`** — strongest in-repo donor for query-facing aggregate helpers with namespacing and `countBatch`.
- **`convex/extraction/aggregates.ts`** — existing `DirectAggregate` registration and helper shape.
- **`convex/convex.config.ts`** — already registers multiple aggregate components; screening should follow the same pattern rather than inventing a second aggregate integration style.
- **`convex/screening/mutations.ts:273-376`** — existing idempotent internal helpers `saveQualifiedPaperToLibrary` and `addToCollectionInternal`; these should be reused from scheduled follow-ups, not reimplemented.
- **`convex/screening/queries.ts`** — existing public query surface; keep names where possible and change the data source underneath.
- **`node_modules/@convex-dev/workpool/src/client/index.ts:238-257`** — confirms `cancel(id)` is scoped and `cancelAll()` is pool-wide.
- **`convex/_generated/ai/guidelines.md`** — overrides memory on Convex function and schema patterns.

Do not introduce:

- a second orchestration layer
- triggers for screening results
- a compatibility path that maintains both workflow and workpool execution
- a new library-save implementation separate from the existing internal helpers

---

## Testing doctrine

Inherited from project doctrine:

- Assert on behavior, observable state, ARIA, and `data-*` contracts.
- Never assert on CSS classes or inline style values.
- Push pure decision logic into small helpers first where it makes the implementation easier to reason about.
- Convex wiring, mutation orchestration, and UI subscription behavior are test-after.

### TDD expectations by plan

- **Plan 01** — pure helper for lifecycle / cancellation derivation first, then mutation wiring.
- **Plan 02** — pure helper for progress math first, then aggregate helpers and query wiring.
- **Plan 03** — pure helper for result transition / follow-up scheduling decisions first, then `onComplete` and scheduled mutations.
- **Plan 04** — no forced pure helper if none is warranted; focus on regression and cleanup tests.

### Passing-test doctrine

- A plan is not complete until the named tests are green.
- If a test cannot run, the plan execution log must say exactly why.
- Query tests should assert returned counts and statuses, not internal implementation details.

---

## Migration stance

Destructive by default.

- Remove wrong schema fields instead of preserving them.
- Remove wrong status literals instead of keeping them around “for now.”
- Do not backfill old `workflowId` state or old job counter values.
- If local dev data becomes invalid after schema cleanup, wipe the affected screening tables and continue.

This plan set explicitly chooses cleanliness over continuity.

---

## Delegation policy

Use subagents aggressively for bounded research tasks, per repo doctrine.

Good delegation targets during execution:

- grep every screening workflow/workpool reference before deleting workflow wiring
- read aggregate component APIs from local package source when implementing plan 02
- map every query/test that still expects `processedPapers` / `failedPapers` / `qualifiedPapers` on `screeningJobs`
- verify `convex-test` coverage donors in `convex/credits/*.test.ts` and `convex/extraction/*.test.ts`

Keep in the main session:

- TDD red → green loops
- schema edits
- commits
- final acceptance verification

If the session grows stale, commit progress, append a brief resume note to the active numbered plan, and restart from the relevant prompt in `PROMPTS.md`.

---

## Grounding sources

Repo sources:

- [convex/schema.ts](../../convex/schema.ts)
- [convex/screening/mutations.ts](../../convex/screening/mutations.ts)
- [convex/screening/queries.ts](../../convex/screening/queries.ts)
- [convex/screening/workflow.ts](../../convex/screening/workflow.ts)
- [convex/screening/workpoolActions.ts](../../convex/screening/workpoolActions.ts)
- [convex/workflow.ts](../../convex/workflow.ts)
- [convex/workpool.ts](../../convex/workpool.ts)
- [convex/_generated/ai/guidelines.md](../../convex/_generated/ai/guidelines.md)

Skills and local guidance:

- [convex-performance-audit skill](https://github.com/get-convex/agent-skills/blob/7a6fcc6882f344577a34365fdadbd0f8f8c467d7/skills/convex-performance-audit/SKILL.md)
- `references/occ-conflicts.md`
- `references/subscription-cost.md`

Current external docs and component guidance consulted on 2026-04-22:

- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices)
- [Convex OCC and Atomicity](https://docs.convex.dev/database/advanced/occ)
- [Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [get-convex/workflow](https://github.com/get-convex/workflow)
- [get-convex/workpool](https://github.com/get-convex/workpool)
- [get-convex/aggregate](https://github.com/get-convex/aggregate)

Runtime source:

- `npx convex insights --details` run on 2026-04-22 in this repo, which reported large OCC retry concentrations in workflow/workpool internal tables and screening-side contention symptoms.
