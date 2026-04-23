# Extraction Workflow — Park on Soft Skip

Single-plan remediation for a P1 control-flow bug in the extraction workflow handler that orphans the workflow whenever a worker action returns a non-`already_billed` skip.

This plan is grounded in the current repo state on **April 23, 2026**, the in-tree `@convex-dev/workflow` library (`node_modules/@convex-dev/workflow/src`), and the existing pause/resume/cancel implementations in `convex/extraction/`.

## Motivation / Gap Audit

The reviewer-flagged P1 finding on [convex/extraction/workflow.ts:130-138](../../convex/extraction/workflow.ts) is real and is broader than the comment lets on:

1. **Soft-skip-as-halt.** `runQuestionStep` and the indexing call in `runPaperPipeline` treat every `extractOneQuestion` / `downloadAndIndexPdfAction` skip whose `reason !== "already_billed"` as a hard halt. The "halted" sentinel propagates all the way up through `runBoundedBatches` → `runQuestionBatches` → `runPaperPipeline` → outer paper batch → workflow handler `return` at [workflow.ts:589-591](../../convex/extraction/workflow.ts).
2. **The handler exits without parking.** No `step.awaitEvent` is reached after a halt. `resumeExtraction` only calls `sendEvent` ([mutations/resume.ts:167-174](../../convex/extraction/mutations/resume.ts)); it never re-spawns the workflow. The mutation's own comment acknowledges: *"If the workflow already terminated… the sendEvent call is ignored silently rather than surfacing here."*
3. **`maybeFinalizeJob` won't rescue it.** [`mutations/internal/lifecycle.ts:48-51`](../../convex/extraction/mutations/internal/lifecycle.ts) explicitly excludes `paused`/`creditsExhausted` from terminal finalization, deferring back to the resume path. There is no watchdog/cron sweeper.
4. **`credits_exhausted` is the most common trigger, not a rare race.** [`workpoolActions.ts:1237-1274`](../../convex/extraction/workpoolActions.ts) flips the job to `creditsExhausted` *from inside the worker action itself* whenever balance check fails, so credit exhaustion is guaranteed to surface as a soft skip — never as the cooperative pre-batch gate.
5. **`stale_epoch` post-dispatch is unavoidable by design.** A pause+resume between a gate read and the worker's status read produces `runEpoch` mismatch ([workpoolActions.ts:588-589](../../convex/extraction/workpoolActions.ts)). Today this also halts.
6. **The pre-batch gate has its own latent parallel-park bug.** `runBoundedBatches.waitForNextBatch` calls `waitWhilePausedOrCancelled` per parallel paper. Up to 5 papers can hit the gate concurrently; per [`@convex-dev/workflow/src/component/event.ts`](../../node_modules/@convex-dev/workflow/src/component/event.ts), each `step.awaitEvent` creates an independent event doc, and a single `sendEvent` consumes only one. The other parkers strand. Any fix has to honor 1:1 producer-consumer event semantics.
7. **No coverage.** `convex/extraction/workflow.test.ts` exercises `runBoundedBatches` only as a pure helper. Neither resume nor pause unit tests touch the workflow gate (their seeded jobs deliberately omit `workflowId`). The "integration smoke (task #12)" referenced in `mutations/resume.test.ts:6-9` does not exist in the repo.

## Locked Design Decisions

All decisions below are locked as of **April 23, 2026** unless the numbered plan records a deviation.

1. **Park is a third sentinel, not a side-channel.** `runBoundedBatches` returns `"completed" | "halted" | "park"` and is the only place that routes parked items back through the gate.
2. **Single park point per workflow.** Parking happens inside one `runBoundedBatches` invocation per call stack at a time. Inner question batching runs inside the outer paper batch's `Promise.all`, so the inner level **propagates** park up to the outer level instead of awaiting itself. This honors the 1:1 `step.awaitEvent` / `sendEvent` contract.
3. **Skip-reason routing.** Worker skips are categorized:
   - `already_billed` → `completed` (idempotency win — keep going).
   - `cancelled` / `job_terminal` → `halted` (terminal — exit handler).
   - `paused` / `credits_exhausted` / `stale_epoch` → `park` (re-enter wait, retry on resume).
4. **Idempotent retry.** Parked items re-run from the start of their pipeline. Safety relies on the existing idempotency gates: [`extractOneQuestion`](../../convex/extraction/workpoolActions.ts) `existingResult?.billed` and [`downloadAndIndexPdfAction`](../../convex/extraction/workpoolActions.ts) `existingPaper?.isIndexed || indexingBilled`. Both are present in the codebase today; no new gate is added.
5. **Cancel during park is library-handled.** `cancelExtraction` calls `workflow.cancel()` ([mutations/jobs.ts:481](../../convex/extraction/mutations/jobs.ts)), which the workflow library actively terminates (including parked steps). No special hook is added in user code.
6. **No schema, no migration, no shims.** Pure logic refactor in `convex/extraction/workflow.ts` plus tests.
7. **Behavior-first tests.** The `runBoundedBatches` extension is unit-tested directly with the existing mock pattern. Skip-reason routing is unit-tested by injecting a fake `step.runAction`.

## Plan-File Inventory

- `00-README.md` — this file.
- `01-park-on-soft-skip.md` — the single execution-ready plan.
- `PROMPTS.md` — copy-paste execution prompt for `01`.

## Dependency Graph

```text
01 park-on-soft-skip   (standalone — no upstream plans)
```

## Reuse / DRY Notes

Primary donors that must be reused, not re-invented:

- `runBoundedBatches` in [`convex/extraction/workflow.ts`](../../convex/extraction/workflow.ts) is extended in place; no parallel batching helper is created.
- `waitWhilePausedOrCancelled` in [`convex/extraction/workflow.ts`](../../convex/extraction/workflow.ts) remains the single canonical gate read; do not duplicate its logic into the question step or paper pipeline.
- The existing `JobControl` type is reused for the new return path.
- Idempotency gates in [`convex/extraction/workpoolActions.ts`](../../convex/extraction/workpoolActions.ts) (`existingResult?.billed`, `existingPaper?.isIndexed || indexingBilled`) are required to be intact for safe park-and-retry; do not weaken them.
- Existing test scaffolding in [`convex/extraction/workflow.test.ts`](../../convex/extraction/workflow.test.ts) (deferred-promise pattern, mock `waitForNextBatch`) is reused for the new park cases.

Do **not** introduce:

- A second batching helper.
- A separate `awaitEvent` call inside `runQuestionStep`, `runQuestionBatches`, or `runPaperPipeline` (would re-create the parallel-park bug).
- A cron sweeper or watchdog. The fix lives in the workflow handler.
- A new event name beyond `resume:<jobId>`.

## Testing Doctrine

1. Unit-test `runBoundedBatches` park-retry directly using the existing deferred-promise + mock-`waitForNextBatch` pattern in [`workflow.test.ts`](../../convex/extraction/workflow.test.ts).
2. Skip-reason routing is exercised by injecting a fake `ExtractionWorkflowStep` (`runAction`/`runMutation`/`runQuery`/`awaitEvent`). No Convex deployment required.
3. Behavior assertions only: assert on returned sentinel values (`"completed"`/`"halted"`/`"park"`), order of `started` / `mockImplementation` calls, and number of `waitForNextBatch` invocations. Do not assert on log strings or class names.
4. Done = vitest green for the touched test file plus `tsc` clean. Convex dev server must continue loading the updated module (verifiable via pm2 logs).
5. If a test cannot be expressed without a real Convex deployment, document why in the plan's `Test plan` section rather than skipping it.

## Migration Stance

**None.** Pure logic change. No schema fields, no data backfill, no compatibility shims. The new `"park"` sentinel is internal to `convex/extraction/workflow.ts`.

## Delegation Policy

Single-plan, tightly scoped fix. Subagents are not required. The original investigation (codified in this plan's gap audit) was already delegated to three parallel agents. No further fan-out is expected during execution.

## Grounding Sources

- `convex/extraction/workflow.ts` — the file under repair.
- `convex/extraction/workpoolActions.ts` — `extractOneQuestion`, `downloadAndIndexPdfAction`, `getWorkerSkipReason`, idempotency gates.
- `convex/extraction/mutations/resume.ts`, `mutations/pause.ts`, `mutations/jobs.ts` (`cancelExtraction`), `mutations/internal/lifecycle.ts` — pause/resume/cancel/finalize semantics.
- `node_modules/@convex-dev/workflow/src/component/event.ts` — `awaitEvent` / `send` semantics. Confirms 1:1 producer-consumer event contract.
- `node_modules/@convex-dev/workflow/src/client/index.ts` — `sendEvent` / `WorkflowManager.cancel` API surface.
- `convex/_generated/ai/guidelines.md` — Convex function/return validator rules.
