# OpenScholar self-hosted CI prompt

```text
PLAN: plans/openscholar-self-hosted-ci/01-runner-and-workflow.md
README: plans/openscholar-self-hosted-ci/00-README.md
DEPENDENCIES: none

Estimate: one working day plus GitHub's artifact quota refresh. Keep working
without asking questions whose answers are in the plan or repository.

STANDING RULES

1. Read AGENTS.md, ponytail, unslop, docs/test-quality.md, the README, and the
   plan before changing anything. Reuse existing code and runner patterns.
2. Use no paid GitHub runner. Keep fork code off every self-hosted runner. Keep
   secret jobs on the OpenScholar-only secret accounts and work directories.
3. Do not touch production Convex, Coolify applications, host Docker sockets,
   new-el release work, or new-el-optimize. Do not give CI any EL_* credential.
4. Use test-decision before a test or assertion change. Test browser behavior,
   saved data, roles, labels, and URLs. Never assert CSS or source text.
5. Read installed Next.js docs before a Next setting change and official
   current docs before relying on GitHub or Playwright behavior. Measure every
   optimization and delete a change that does not win.
6. Use bounded Luna max agents for independent research when AGENTS.md calls
   for delegation. Every delegated prompt requires ponytail and unslop. Run one
   read-only Fable review after the complete phase, never after each commit.

EXECUTION RHYTHM

For new plain logic, start with one failing behavior test, make it pass, clean
it up, and commit. For workflow and environment integration, inspect first,
make one bounded change, run the exact check, and commit each working unit.
Commit plan corrections before the code or environment work that depends on
them.

Run all same-repository jobs through the immutable reusable workflow on the
OpenScholar light or secret runner group named in the plan. Preserve every
check, artifact, timeout, failure rule, and secret validation. Keep artifact
uploads required, but put billing uploads after every billing test command.

Repair only formal-rabbit-271 development data. Use the existing feature-flag
upsert for the subscription master, Go, and Pro flags. Project the existing
Clerk E2E organization through the production projection function. Keep the
original auth browser contract: reserve a new library, save it, preview it,
activate it, and revisit it. Do not replace that contract with a fixed draft.
If the disposable runtime environment in 01-BLOCKER.md does not exist, keep
the original test, route its job to the unassigned `openscholar-activation`
label, and stop with the blocker instead of weakening it. Do not put that label
on an existing runner.

COMMIT DISCIPLINE

Use only feat, fix, refactor, test, chore, docs, perf, or style. Put [plan-01]
in every implementation commit. Never bypass hooks. Commit only when the
relevant checks pass. Push the lane and update PR 130 against dev. Do not merge.

WHEN TO STOP

Stop only after the PR exists against dev, actionlint passes, all jobs use the
approved self-hosted boundary, the final exact head is green twice, artifacts
upload and download, fork access is denied, the concurrent new-el check passes,
and the host and both guests remain healthy. Do not stop for token worry, a
question answered in the plan, or GitHub's quota delay. Wait and rerun.

DEVIATIONS

If the plan is wrong and the safe path is clear, commit safe work, revise the
plan, commit the revision as `docs: [plan-01] revise <section> — <reason>`, and
continue. If a required API or safe boundary does not exist, commit safe work,
write 01-BLOCKER.md with the exact conflict and options, and stop. Never hide a
blocker with a skip, continue-on-error, paid runner, fake assertion, or Coolify
credential.

START NOW

1. Read the plan and README in full.
2. Read Convex guidelines before Convex code or schema changes.
3. Check git status and current refs.
4. Confirm no other Convex uploader is running before a deployment mutation.
5. Start the next incomplete working unit and keep going through final proof.

Go.
```
