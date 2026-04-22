# Screening Execution Refactor — Execution Prompts

Copy-paste prompts for a fresh session. Each prompt is self-contained and assumes only the plan files and referenced source files are available.

**Preamble**

Use these standing repo rules in every plan:

1. DRY first. Reuse existing donors before inventing new mechanisms.
2. No legacy behavior, no compatibility shims, no “keep both paths for now.”
3. `convex/_generated/ai/guidelines.md` overrides training assumptions.
4. Ground every “likely” claim in source, skill guidance, or current docs before acting.
5. TDD is mandatory where the plan calls for a pure helper; passing tests are mandatory before closing the plan.
6. Delegate bounded research and codebase mapping to subagents; keep commits, schema edits, and final verification in the main session.

---

## Plan 01 Prompt

**Header** — Execute [plans/screening-execution-refactor/01-workpool-only-job-lifecycle.md](/Users/mcharrad/Documents/Github/openalex-count/plans/screening-execution-refactor/01-workpool-only-job-lifecycle.md) with [plans/screening-execution-refactor/00-README.md](/Users/mcharrad/Documents/Github/openalex-count/plans/screening-execution-refactor/00-README.md) as the control document. No prior plan dependency.

**Autonomy framing** — Long-running autonomous task. Expect 1–2 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with the repo’s current screening code and document the choice in the commit message.

**STANDING RULES**
1. DRY with named donors: `convex/screening/mutations.ts`, `convex/credits/aggregates.ts`, `convex/extraction/aggregates.ts`, `node_modules/@convex-dev/workpool/src/client/index.ts`.
2. No legacy: remove screening workflow orchestration, do not leave a dual workflow/workpool path.
3. Convex local guidelines override memory: read `convex/_generated/ai/guidelines.md` before editing.
4. Testing doctrine: behavior only, no CSS assertions, green tests required.
5. Research before guessing: if a workpool API detail is unclear, read the local package source first.
6. Delegate to subagents for any mapping task that needs more than ~3 file reads or greps.
7. Job-scoped cancellation only: no `cancelAll()` in screening after this plan lands.

**EXECUTION RHYTHM**
Phase A — TDD, pure logic only, commit per green:
1. Add a tiny lifecycle/cancellation helper and its tests.

Phase B — test-after, commit per logical unit:
1. Update schema and validators for `workId` and lifecycle-state removal.
2. Rewrite `createScreeningJob` to enqueue directly and store `workId`.
3. Rewrite `cancelScreeningJob` to cancel per-result work ids.
4. Remove screening workflow start/cancel references and dead workflow-era code touched by this slice.
5. Update mutation/cancel tests.

**COMMIT DISCIPLINE**
1. Use conventional commits with `[plan-01]`, e.g. `refactor(screening): [plan-01] remove workflow start path`.
2. One commit per TDD green in Phase A.
3. One commit per logical unit in Phase B.
4. Never commit red tests.

**WHEN TO STOP**
Stop only when the plan acceptance criteria are met or a true blocker requires a `BLOCKER` file.
You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, or the urge to preserve the old workflow model.

**DEVIATIONS**
If the plan is wrong or incomplete:
1. Commit in-progress work first.
2. Edit the plan file with the revised approach and rationale.
3. Commit the plan edit as `docs: [plan-01] revise <section> — <reason>`.
4. Continue against the revised plan.

**START NOW**
1. Read the plan file.
2. Read the README control file.
3. Read `convex/_generated/ai/guidelines.md`.
4. Run `git status`.
5. Begin Phase A.

Go.

---

## Plan 02 Prompt

**Header** — Execute [plans/screening-execution-refactor/02-aggregate-progress-and-query-shift.md](/Users/mcharrad/Documents/Github/openalex-count/plans/screening-execution-refactor/02-aggregate-progress-and-query-shift.md) with [plans/screening-execution-refactor/00-README.md](/Users/mcharrad/Documents/Github/openalex-count/plans/screening-execution-refactor/00-README.md) as context. Depends on plan 01 being merged.

**Autonomy framing** — Long-running autonomous task. Expect 1–2 hours. Do not stop for approval after the aggregate design is understood. The repo already uses `@convex-dev/aggregate`; extend that pattern instead of inventing a second counting mechanism.

**STANDING RULES**
1. DRY with named donors: `convex/credits/aggregates.ts`, `convex/extraction/aggregates.ts`, `convex/convex.config.ts`.
2. No legacy: query truth must move to aggregates, not remain on job counters.
3. Convex guidelines override training; read `convex/_generated/ai/guidelines.md`.
4. Use current aggregate docs or local package source before assuming API details.
5. Testing doctrine: pure helper first, aggregate/query tests next, no CSS assertions.
6. Delegate codebase mapping and package-source reading to subagents.
7. Keep API shapes stable for the frontend unless the plan explicitly changes them.

**EXECUTION RHYTHM**
Phase A — TDD, pure logic only, commit per green:
1. Add progress math helper tests.

Phase B — test-after, commit per logical unit:
1. Register screening aggregate components.
2. Add `convex/screening/aggregates.ts` and direct tests.
3. Wire current completion flow to maintain aggregate state.
4. Shift screening public queries to aggregate-backed counts.
5. Update query tests and any affected surface tests.

**COMMIT DISCIPLINE**
1. Use conventional commits with `[plan-02]`.
2. One commit per TDD green in Phase A.
3. One commit per logical unit in Phase B.
4. Never commit with query tests red.

**WHEN TO STOP**
Stop only when aggregate-backed queries are the read truth and the plan acceptance criteria are met.
You may NOT stop for: temporary coexistence of dead job counter fields, solvable aggregate API uncertainty, or a desire to keep scan-based progress logic.

**DEVIATIONS**
Use the README deviation protocol: commit work, edit the plan, commit the plan edit, continue.

**START NOW**
1. Read the plan file.
2. Read the README.
3. Read `convex/_generated/ai/guidelines.md`.
4. Inspect aggregate donors.
5. Begin Phase A.

Go.

---

## Plan 03 Prompt

**Header** — Execute [plans/screening-execution-refactor/03-row-local-completion-and-deferred-side-effects.md](/Users/mcharrad/Documents/Github/openalex-count/plans/screening-execution-refactor/03-row-local-completion-and-deferred-side-effects.md) with [plans/screening-execution-refactor/00-README.md](/Users/mcharrad/Documents/Github/openalex-count/plans/screening-execution-refactor/00-README.md) as context. Depends on plan 02 being merged.

**Autonomy framing** — Long-running autonomous task. Expect 2–3 hours. Do not stop mid-plan to ask for permission to move side effects out of `onComplete`; that is the point of the plan. Keep the worker action pure, keep `onComplete` row-local, and move secondary work to scheduled follow-ups.

**STANDING RULES**
1. DRY with named donors: `saveQualifiedPaperToLibrary`, `addToCollectionInternal`, current analytics emission path, and aggregate helpers from plan 02.
2. No legacy: do not keep inline library/collection persistence or inline finalization as fallback paths.
3. Convex guidelines override memory; read `convex/_generated/ai/guidelines.md`.
4. Scheduled follow-ups must be awaited and idempotent.
5. Testing doctrine: pure transition helper first, behavior tests after.
6. Delegate any multi-file mapping work or package-doc verification.
7. Do not leave canceled or credits-exhausted rows stranded in `processing`.

**EXECUTION RHYTHM**
Phase A — TDD, pure logic only, commit per green:
1. Add completion transition helper and tests.

Phase B — test-after, commit per logical unit:
1. Rewrite `handleScreeningComplete` to patch only result rows and aggregate state.
2. Add scheduled follow-up for qualified result persistence.
3. Add scheduled follow-up for job terminalization.
4. Remove inline side effects and inline finalization.
5. Extend screening completion/cancellation tests.

**COMMIT DISCIPLINE**
1. Use conventional commits with `[plan-03]`.
2. One commit per TDD green in Phase A.
3. One commit per logical unit in Phase B.
4. Never commit with completion regression tests red.

**WHEN TO STOP**
Stop only when `onComplete` is row-local and all secondary work has moved to scheduled follow-ups.
You may NOT stop for: fear of deleting old inline side-effect calls, ambiguity that can be resolved by reading existing helper code, or token concerns.

**DEVIATIONS**
Commit in-progress work, edit the plan, commit the plan edit, continue.

**START NOW**
1. Read the plan file.
2. Read the README.
3. Read `convex/_generated/ai/guidelines.md`.
4. Inspect the current `handleScreeningComplete` path plus the internal library helpers.
5. Begin Phase A.

Go.

---

## Plan 04 Prompt

**Header** — Execute [plans/screening-execution-refactor/04-schema-teardown-and-verification.md](/Users/mcharrad/Documents/Github/openalex-count/plans/screening-execution-refactor/04-schema-teardown-and-verification.md) with [plans/screening-execution-refactor/00-README.md](/Users/mcharrad/Documents/Github/openalex-count/plans/screening-execution-refactor/00-README.md) as context. Depends on plans 01–03 being merged.

**Autonomy framing** — Long-running autonomous task. Expect 1–2 hours. This is the destructive cleanup pass. Remove obsolete schema fields and dead APIs completely. Do not preserve workflow-era screening state “just in case.”

**STANDING RULES**
1. DRY with named donors: the already-migrated query and completion paths from plans 02 and 03.
2. No legacy: old screening counters, workflow ids, and dead APIs must be deleted.
3. Convex guidelines override memory; read `convex/_generated/ai/guidelines.md`.
4. Testing doctrine: update seeders and regression tests to match the real schema.
5. Research before guessing: if generated artifacts or current test failures imply extra cleanup, inspect them directly.
6. Delegate broad grep/read tasks to subagents.
7. Final verification must include runtime signals, not just local tests.

**EXECUTION RHYTHM**
Phase A — TDD only if a small cleanup helper appears; otherwise skip.

Phase B — test-after, commit per logical unit:
1. Remove dead schema fields and dead validator/status references.
2. Remove dead screening workflow-era APIs and files.
3. Update tests and seeders.
4. Regenerate/update any required artifacts.
5. Run final verification including `npx convex insights --details`.

**COMMIT DISCIPLINE**
1. Use conventional commits with `[plan-04]`.
2. If a plan-file revision is needed, commit it first as `docs: [plan-04] revise ...`.
3. One commit per logical cleanup unit.
4. Never commit with failing screening tests.

**WHEN TO STOP**
Stop only when the schema teardown is complete, tests are green, and verification has been run.
You may NOT stop for: “the fields are harmless if left in,” a desire to leave dead helpers for future convenience, or uncertainty solvable by a repo grep.

**DEVIATIONS**
Follow the repo deviation protocol exactly: commit work, edit the plan, commit the plan edit, continue.

**START NOW**
1. Read the plan file.
2. Read the README.
3. Read `convex/_generated/ai/guidelines.md`.
4. Run `git status`.
5. Start cleanup with a dead-reference grep before deleting schema fields.

Go.
