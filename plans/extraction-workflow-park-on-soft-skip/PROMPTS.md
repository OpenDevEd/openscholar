# PROMPTS — Extraction Workflow Park on Soft Skip

Standing rules for this plan set:

- DRY against `runBoundedBatches` and `waitWhilePausedOrCancelled` — extend, do not duplicate.
- No legacy / no compatibility shims. The skip-reason routing is replaced wholesale; `paperBatchResult === "halted"` for non-terminal reasons is gone.
- `convex/_generated/ai/guidelines.md` overrides any training-data Convex knowledge.
- Behavior-first tests. Assert on sentinel values, call counts, and call ordering. Never on log strings, class names, or Tailwind utilities.
- Research before guessing. If `@convex-dev/workflow` semantics surface a question, read `node_modules/@convex-dev/workflow/src/component/event.ts` and `node_modules/@convex-dev/workflow/src/client/index.ts` directly.
- Delegate broad investigation to subagents (`Explore` for greps, `general-purpose` for cross-file synthesis). Solo execution for the surgical TDD slices below is fine.

## Plan 01 — Park on Soft Skip

```md
Plan file: plans/extraction-workflow-park-on-soft-skip/01-park-on-soft-skip.md
Context README: plans/extraction-workflow-park-on-soft-skip/00-README.md

Long-running autonomous task. Expect 1.5–3 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing code patterns in convex/extraction/workflow.ts and document the choice in the commit message.

STANDING RULES:
1. DRY: extend `runBoundedBatches` and reuse `waitWhilePausedOrCancelled`. Do not introduce a second batching helper or a second gate.
2. No legacy: replace the existing `paperBatchResult === "halted"` for non-terminal skip reasons. Do not keep the old halt-on-soft-skip path as a fallback. Remove dead branches.
3. Convex guidelines (`convex/_generated/ai/guidelines.md`) override training-data knowledge.
4. Tests: extend convex/extraction/workflow.test.ts using its existing deferred-promise + mock-`waitForNextBatch` pattern. Assert on sentinel values, ordering of `started` arrays, and `mockImplementation` call counts. Do not assert on log strings.
5. Research before guessing: any `@convex-dev/workflow` question is answered against node_modules/@convex-dev/workflow/src/component/event.ts and node_modules/@convex-dev/workflow/src/client/index.ts.
6. Delegate broad codebase searches (>3 reads or >3 greps) to a subagent (Explore for greps, general-purpose for synthesis). Solo TDD slices are fine.
7. Single-park-point invariant: the only `step.awaitEvent` call site remains inside `waitWhilePausedOrCancelled`. Do NOT add `awaitEvent` inside `Promise.all` branches, inside `runQuestionStep`, or inside `runPaperPipeline`.
8. Idempotency lean: parked items re-run from the start of their pipeline. Do not weaken `existingResult?.billed` or `existingPaper?.isIndexed || indexingBilled` gates in workpoolActions.ts. Do not add new ones either.

EXECUTION RHYTHM:

Phase A — TDD on `runBoundedBatches` (pure logic, in convex/extraction/workflow.ts; tests in convex/extraction/workflow.test.ts). Commit per green.
- R1: red test — a `runItem` returning "park" causes `runBoundedBatches` to invoke `waitForNextBatch` again and re-run only the parked items with the fresh control. Items that returned "completed" must NOT be re-run. Then green by introducing the `"park"` sentinel and the `pendingItems` retry loop.
- R2: red test — sibling items returning "park" do not block a "halted" sibling from short-circuiting the batch. Tighten/confirm.
- R3: red test — `waitForNextBatch` returning null during a park-retry causes the helper to return "halted" without re-invoking `runItem`. Tighten/confirm.

Phase B — test-after, one logical unit per commit:
- B1: route `runQuestionStep` skip reasons. `already_billed` → completed, `cancelled`/`job_terminal` → halted, `paused`/`credits_exhausted`/`stale_epoch` → park. Add focused vitest case with a stubbed `step.runAction` covering each reason.
- B2: same routing applied to the `downloadAndIndexPdfAction` skip arm in `runPaperPipeline`. Add vitest case asserting `finalizePaper` is NOT called on park or halt.
- B3: propagate `"park"` through `runQuestionBatches` (already free if R1 lands), `runPaperPipeline`, and `runRetryPaperPipeline` types. Confirm `runExtractionWorkflow` and `runRetryWorkflow` early-`return` on outer "halted" only (cancel behavior unchanged).

COMMIT DISCIPLINE:
1. Conventional-commit prefixes: feat / fix / refactor / test / chore / docs / perf / style. The bug-fix commits use `fix`; helper/test refactors use `refactor` / `test`.
2. Scope every plan-related commit with `[plan-01]`. Example: `fix(extraction): [plan-01] park workflow on paused/credits-exhausted/stale-epoch skips`.
3. One commit per TDD green in Phase A. Red → Green → Refactor → Commit.
4. One commit per logical unit in Phase B. Skip-reason helper, question-step wiring, indexing-step wiring, propagation through paper pipeline, propagation through retry workflow — each is its own commit.
5. Never commit with tests red. If a pre-commit hook fails, fix the underlying issue. Never use `--no-verify`, `--no-gpg-sign`, or any hook-bypass flag.
6. Do not push to remote unless the user explicitly asks.
7. Plan-file edits ship as their own commits under `docs: [plan-01] revise <section> — <reason>` BEFORE any code change that depends on them.

WHEN TO STOP:
- Stop only on a true blocker: a required Convex / @convex-dev/workflow API does not exist, or a pre-existing bug blocks further progress. Then commit clean partial work and write `plans/extraction-workflow-park-on-soft-skip/NN-BLOCKER.md` describing what is stuck and what would unblock.
- You may NOT stop for: ambiguity resolvable by re-reading 00-README.md or 01-park-on-soft-skip.md; worry about token usage; impulse to check with the user.

DEVIATIONS:
1. Commit any in-progress work first.
2. Edit `plans/extraction-workflow-park-on-soft-skip/01-park-on-soft-skip.md` with the new approach and rationale.
3. Commit the plan edit under `docs: [plan-01] revise <section> — <reason>`.
4. Proceed against the revised plan.

START NOW:
1. Read `plans/extraction-workflow-park-on-soft-skip/01-park-on-soft-skip.md` end-to-end.
2. Read `plans/extraction-workflow-park-on-soft-skip/00-README.md` end-to-end.
3. Read `convex/_generated/ai/guidelines.md`.
4. Run `git status` to confirm a clean working tree from the previous slice.
5. Begin R1: write the failing test for park-retry of `runBoundedBatches`.

Go.
```
