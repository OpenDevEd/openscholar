# PROMPTS - Extraction Queue + Workpool Runtime

Each prompt is self-contained for a fresh session. Read the plan and README first, then execute without narrowing scope.

## Prompt for `01-queue-foundation.md`

```md
Execute `plans/extraction-queue-workpool-runtime/01-queue-foundation.md`.

Read first: `plans/extraction-queue-workpool-runtime/00-README.md`, this plan file, and `convex/_generated/ai/guidelines.md`.

Long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, choose the option most consistent with existing extraction donors and document the choice in the final summary or commit message.

STANDING RULES
1. DRY with named donors: `convex/screening/mutations.ts`, `convex/extraction/jobCounters.ts`, `convex/extraction/batching.ts`, `convex/extraction/listProjection.ts`, and `convex/extraction/mutations/internal/fanout.ts`.
2. No legacy: no workflow fallback, no dual runtime, no compatibility shims.
3. Convex guidelines override training. Read `convex/_generated/ai/guidelines.md` before writing Convex code.
4. Testing doctrine: TDD one behavior at a time. Behavioral assertions only.
5. Deployability gate: after every backend-touching green, run `npx pm2 logs convex --lines 5 --nostream` and confirm `✔ Convex functions ready!`.
6. Research before guessing. Use skills/docs for unclear Convex, Workpool, or TypeScript behavior.
7. Delegate to subagents for broad codebase mapping when explicitly authorized by the active tool/user context.
8. Zero explicit `any`; use concrete types, validators, generics, or `unknown` plus narrowing.

EXECUTION RHYTHM
Phase A: TDD pure queue status helpers under `convex/extraction/queue/status.ts`, one test then implementation.
Phase B: TDD Convex queue mutations under `convex/extraction/queue/mutations.ts`, R1-R6 from the plan, one green per logical unit.

COMMIT DISCIPLINE
Use conventional commits scoped with `[plan-01]` if committing. One commit per TDD green. Never commit red. Never use `--no-verify`, `--no-gpg-sign`, or any hook bypass.

WHEN TO STOP
Stop only when R1-R6, typecheck, and pm2 deployability are green, or when a true blocker is documented in `01-BLOCKER.md`.
You may NOT stop for ambiguity resolvable by re-reading the plan, worry about token usage, or the impulse to ask about a detail already locked.

DEVIATIONS
If the plan is wrong, commit or preserve current work, edit the numbered plan with rationale, then proceed against the revised plan.

START NOW
1. Read this plan, the README, and Convex guidelines.
2. Run `git status --short`.
3. Run `npx pm2 logs convex --lines 5 --nostream`; a stuck push blocks work.
4. Inspect the donor files named above.
5. Begin R1.

Go.
```

## Prompt for `02-paper-worker-runtime.md`

```md
Execute `plans/extraction-queue-workpool-runtime/02-paper-worker-runtime.md`.

Read first: `plans/extraction-queue-workpool-runtime/00-README.md`, this plan file, and `convex/_generated/ai/guidelines.md`. Depends on Plan 01 being merged.

Long-running autonomous task. Expect 3-5 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY with named donors: `convex/screening/mutations.ts`, `convex/screening/workpool.test-support.ts`, `convex/extraction/workpoolActions.ts`, and `convex/extraction/batching.ts`.
2. No legacy: Workpool status is not canonical; queue rows are canonical.
3. Convex guidelines override training.
4. Testing doctrine: TDD worker behavior through Convex functions.
5. Deployability gate: `npx pm2 logs convex --lines 5 --nostream` must show `✔ Convex functions ready!`.
6. Research before guessing Workpool API behavior; read `node_modules/@convex-dev/workpool/README.md`.
7. Delegate to subagents when explicitly authorized.
8. Zero explicit `any`.

EXECUTION RHYTHM
Phase A: TDD pure worker planning helpers if needed.
Phase B: Implement R1-R6 from the plan, one green per logical unit.

COMMIT DISCIPLINE
Conventional commits scoped `[plan-02]` if committing. Never commit red or bypass hooks.

WHEN TO STOP
Stop when R1-R6, targeted tests, typecheck, and pm2 gate are green.

DEVIATIONS
Edit the plan before departing from it.

START NOW
1. Read plan, README, Convex guidelines.
2. Check `git status --short`.
3. Check convex pm2 gate.
4. Read Workpool README and donors.
5. Begin R1.

Go.
```

## Prompt for `03-start-resume-cancel-retry-cutover.md`

```md
Execute `plans/extraction-queue-workpool-runtime/03-start-resume-cancel-retry-cutover.md`.

Read first: `plans/extraction-queue-workpool-runtime/00-README.md`, this plan file, and `convex/_generated/ai/guidelines.md`. Depends on Plans 01 and 02 being merged.

Long-running autonomous task. Expect 4-7 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY with named donors: existing `jobs.ts`, `resume.ts`, `retry.ts`, `stateMachine.ts`, and queue helpers from Plans 01-02.
2. No legacy: delete workflow-start success assertions and replace with queue/workpool assertions.
3. Convex guidelines override training.
4. Testing doctrine: TDD one public mutation behavior at a time.
5. Deployability gate: `npx pm2 logs convex --lines 5 --nostream` must show `✔ Convex functions ready!`.
6. Research before guessing.
7. Delegate to subagents when explicitly authorized.
8. Zero explicit `any`.

EXECUTION RHYTHM
Phase A: TDD any pure transition helpers.
Phase B: R1-R6 from the plan, one public mutation behavior at a time.

COMMIT DISCIPLINE
Conventional commits scoped `[plan-03]` if committing. Never commit red or bypass hooks.

WHEN TO STOP
Stop when public start/duplicate/resume/cancel/retry no longer import workflow, tests pass, typecheck passes, and pm2 gate is green.

DEVIATIONS
Edit the plan before departing from it.

START NOW
1. Read plan, README, Convex guidelines.
2. Check `git status --short`.
3. Check convex pm2 gate.
4. Begin R1.

Go.
```

## Prompt for `04-question-task-answer-split.md`

```md
Execute `plans/extraction-queue-workpool-runtime/04-question-task-answer-split.md`.

Read first: `plans/extraction-queue-workpool-runtime/00-README.md`, this plan file, and `convex/_generated/ai/guidelines.md`. Depends on Plan 01; can run before Plan 03 if adapters are kept temporary inside this branch.

Long-running autonomous task. Expect 4-7 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY with named donors: `mutations/results.ts`, `queries/_shared.ts`, `listProjection.ts`, and retry summary helpers.
2. No legacy: delete old mixed lifecycle/payload result rows once consumers are moved.
3. Convex guidelines override training.
4. Testing doctrine: TDD result write/finalize/retry behavior.
5. Deployability gate: `npx pm2 logs convex --lines 5 --nostream` must show `✔ Convex functions ready!`.
6. Research before guessing schema/index behavior.
7. Delegate to subagents when explicitly authorized.
8. Zero explicit `any`.

EXECUTION RHYTHM
Phase A: TDD pure result-shape reconstruction helpers.
Phase B: R1-R6 from the plan, one behavior at a time.

COMMIT DISCIPLINE
Conventional commits scoped `[plan-04]` if committing. Never commit red or bypass hooks.

WHEN TO STOP
Stop when split rows are authoritative, tests pass, typecheck passes, and pm2 gate is green.

DEVIATIONS
Edit the plan before departing from it.

START NOW
1. Read plan, README, Convex guidelines.
2. Check `git status --short`.
3. Check convex pm2 gate.
4. Begin R1.

Go.
```

## Prompt for `05-results-read-model.md`

```md
Execute `plans/extraction-queue-workpool-runtime/05-results-read-model.md`.

Read first: `plans/extraction-queue-workpool-runtime/00-README.md`, this plan file, and `convex/_generated/ai/guidelines.md`. Depends on Plans 01 and 04.

Long-running autonomous task. Expect 3-6 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY with named donors: `listProjection.ts`, `queries/results.ts`, and existing results page tests.
2. No legacy: no fallback scan of full `extractionPapers` before slicing.
3. Convex guidelines override training.
4. Testing doctrine: TDD read behavior and public result shape.
5. Deployability gate: convex pm2 for backend, next pm2 if frontend is touched.
6. Research before guessing index/search behavior.
7. Delegate to subagents when explicitly authorized.
8. Zero explicit `any`.

EXECUTION RHYTHM
Phase A: TDD projection/list-row pure helpers.
Phase B: R1-R6 from the plan.

COMMIT DISCIPLINE
Conventional commits scoped `[plan-05]` if committing. Never commit red or bypass hooks.

WHEN TO STOP
Stop when results page/export use list rows, tests pass, typecheck passes, and pm2 gates are green.

DEVIATIONS
Edit the plan before departing from it.

START NOW
1. Read plan, README, Convex guidelines.
2. Check `git status --short`.
3. Check convex and, if needed, next pm2 gates.
4. Begin R1.

Go.
```

## Prompt for `06-workflow-cleanup.md`

```md
Execute `plans/extraction-queue-workpool-runtime/06-workflow-cleanup.md`.

Read first: `plans/extraction-queue-workpool-runtime/00-README.md`, this plan file, and `convex/_generated/ai/guidelines.md`. Depends on Plans 01-05 being merged.

Long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY: move any surviving reusable helper to queue modules before deleting workflow files.
2. No legacy: delete workflow fields, tests, comments, and component registration if no non-extraction usage remains.
3. Convex guidelines override training.
4. Testing doctrine: prove absence through import-boundary tests, full extraction tests, typecheck, and `rg`.
5. Deployability gate: `npx pm2 logs convex --lines 5 --nostream` must show `✔ Convex functions ready!`.
6. Research before guessing non-extraction workflow usage.
7. Delegate to subagents when explicitly authorized.
8. Zero explicit `any`.

EXECUTION RHYTHM
Phase A: TDD import-boundary/absence checks.
Phase B: Delete obsolete modules and update tests one logical unit at a time.

COMMIT DISCIPLINE
Conventional commits scoped `[plan-06]` if committing. Never commit red or bypass hooks.

WHEN TO STOP
Stop when extraction has no Workflow dependency, full extraction suite passes, typecheck passes, `rg` absence checks pass, and pm2 gate is green.

DEVIATIONS
Edit the plan before departing from it.

START NOW
1. Read plan, README, Convex guidelines.
2. Check `git status --short`.
3. Check convex pm2 gate.
4. Run workflow reference `rg`.
5. Begin R1.

Go.
```
