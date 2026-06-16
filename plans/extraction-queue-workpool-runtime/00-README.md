# Extraction Queue + Workpool Runtime

## 1. Motivation / Gap Audit

The extraction flow still uses `@convex-dev/workflow` for setup, per-paper execution, retry fanout, and cancellation handles. Fresh `npx convex insights --details` shows the dominant OCC source is still the workflow component itself:

- `workflow/workpool:worker.js:runMutationWrapper`: 95 permanent OCC conflicts on `counters`.
- `workflow/workpool:worker.js:runMutationWrapper`: 834 retried OCC conflicts on `counters`.
- `workflow/workpool:worker.js:runMutationWrapper`: 666 retried OCC conflicts on `steps`.
- Additional conflicts on `runStatus`, `pendingStart`, and `pendingCompletion`.
- App-side answer writes still show `recordOneAnswer` conflicts on `btree` and `btreeNode`.

The current root-detached paper workflow reduced parent-row contention, but it did not remove workflow journal and workpool component churn from the hot path. The ultimate version makes Convex app tables the source of truth, uses Workpool only as a bounded action runner, and makes read models small enough for UI reads.

## 2. Locked Design Decisions

1. **No Convex Workflow in extraction execution.** Extraction start, retry, resume, cancel, paper dispatch, and paper completion must not call `workflow.start`, `workflow.cancel`, `step.runAction`, `step.runMutation`, or `step.runQuery`.
2. **App-owned queue is canonical.** Workpool status is a throttle/retry implementation detail. Queue rows carry paper lease, epoch, attempt, and terminal state.
3. **One Workpool item per paper.** The paper worker action handles download/index/extract/finalize for one paper. Question parallelism stays inside the action with bounded batches.
4. **Effective parallelism is explicit.** Max active LLM calls = `extractionPaperPool.maxParallelism * questionConcurrencyPerPaper`.
5. **Question state is split from answer payload.** Small task rows hold status/attempt/billing/error. Large answer rows hold answer/citations/reasoning/diagnostics.
6. **Results UI reads a list row table.** Results page/export must not scan all `extractionPapers` and JS-filter before slicing.
7. **Destructive schema stance.** Dev data is disposable. No compatibility shims, no migration component, no dual workflow/queue runtime.
8. **No explicit `any`.** New or edited TypeScript must use concrete types, `unknown` plus narrowing, or Convex validators.
9. **No repetition.** Reuse existing donors: `screeningPool` flow, `extraction/jobCounters.ts`, `extraction/listProjection.ts`, `extraction/workpoolActions.ts`, `batching.ts`, `stateMachine.ts`, and credit reservation helpers.

## 3. Plan-File Inventory

| File | Slice |
| --- | --- |
| `01-queue-foundation.md` | Add queue validators/schema/helpers and TDD the lease/refill contract. |
| `02-paper-worker-runtime.md` | Add extraction Workpool and one-paper worker action using existing extraction helpers. |
| `03-start-resume-cancel-retry-cutover.md` | Replace public orchestration mutations with queue operations and remove workflow handles from control flow. |
| `04-question-task-answer-split.md` | Split question lifecycle rows from answer payloads and rewire result writes/finalization. |
| `05-results-read-model.md` | Move results page/export to `extractionPaperListRows` and point-in-time export jobs. |
| `06-workflow-cleanup.md` | Delete obsolete workflow modules, component registration, fields, tests, and comments. |

## 4. Dependency Graph

```
01 -> 02 -> 03 -> 06
01 -> 04 -> 05 -> 06
03 -> 05
```

The queue foundation is the first required slice. The worker can run before the public mutations switch over, but the cleanup must wait until start/resume/retry/cancel and reads no longer reference workflow-era fields.

## 5. Reuse / DRY Notes

- **Workpool donor:** `convex/screening/mutations.ts` enqueues one independent work item per result and records `workId`.
- **Worker donor:** `convex/extraction/workpoolActions.ts` already contains `downloadAndIndexPdfAction`, `extractOneQuestion`, skip guards, provider calls, and result persistence boundaries.
- **Counter donor:** `convex/extraction/jobCounters.ts` already owns terminal paper counters and should remain the job finalization source.
- **Batching donor:** `convex/extraction/batching.ts` already normalizes paper and question concurrency.
- **Read-model donor:** `convex/extraction/listProjection.ts` already computes the denormalized list fields. The new table should reuse those projection builders instead of duplicating token/confidence logic.
- **Reservation donor:** `convex/extraction/mutations/internal/fanout.ts` has the credit-reservation algorithm. Move it behind queue helpers instead of keeping fanout workflow naming.

## 6. Testing Doctrine

TDD is mandatory:

- Phase A for each plan: one behavior test, then minimal implementation, then refactor.
- Tests must use public or internal Convex function interfaces, not private helper internals, unless the helper is intentionally pure and exported for reuse.
- Behavioral assertions only: queue rows, paper statuses, job statuses, result rows, answer payloads, list rows, and pm2 deployability.
- No class-name assertions. No tests that merely assert source strings.
- `npx tsc --noEmit` must pass before a slice is considered complete.

## 7. Migration Stance

Destructive. Existing dev rows may be invalidated. The executor may wipe affected dev tables from the Convex dashboard or via a dev-gated admin helper if schema validation blocks deployment. Do not write `convex/migrations/` files, old-shape fallbacks, or dual runtime compatibility.

## 8. Delegation Policy

Use subagents only when explicitly authorized by the active user/tool contract. When authorized, delegate broad codebase mapping and external documentation reads; keep TDD cycles, commits, plan edits, and final gates in the main session.

## 9. Grounding Sources

- `convex/_generated/ai/guidelines.md`: Convex validators, function calling, schema, and high-churn data guidance.
- `.agents/skills/convex-performance-audit/SKILL.md` plus `references/occ-conflicts.md`, `hot-path-rules.md`, and `function-budget.md`.
- `.agents/skills/convex-migration-helper/SKILL.md`, applied with the repo's destructive dev-data override.
- `/Users/mcharrad/.agents/skills/tdd/SKILL.md`.
- `/Users/mcharrad/.agents/skills/typescript-strict-mode/SKILL.md`.
- Context7 Convex docs: workflow `maxParallelism` limits step execution, not workflow launch count.
- `node_modules/@convex-dev/workpool/README.md`: Workpool bounded parallelism, retries, `onComplete`, cancellation, batching, and overhead notes.
- Fresh `npx convex insights --details` on 2026-05-25.
