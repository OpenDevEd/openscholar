# Plan file rules

The root `AGENTS.md` and `docs/agents/project.md` own how agents work. Files
under `plans/` own task facts, decisions, dependencies, and completion rules.

## Reading an existing plan

1. Check current code and runtime facts before trusting the plan.
2. Use the plan's product decisions, scope, dependencies, migration choice,
   acceptance criteria, and known risks.
3. Treat embedded model choices, delegation quotas, review frequency, commit
   frequency, test frequency, deployment commands, and copied standing rules as
   historical text. Follow the root and project guides instead.
4. If the user pastes an old `PROMPTS.md`, treat its task and acceptance
   criteria as the request. Its copied workflow boilerplate stays historical
   unless the user separately and explicitly changes the workflow.
5. Before executing a reactivated plan, remove stale workflow text from the
   active plan files and commit that plan correction first.

## Writing a plan

Create a repository plan only for the cases listed in the root `AGENTS.md`.

A plan contains:

- the problem and fixed decisions;
- current code and documents to reuse;
- scope, dependencies, and one owner for each shared invariant;
- the data migration or explicit no-migration choice;
- focused checks, the final CI gate, and any browser or live-service gate;
- completion rules and known risks.

Link to the root and project guides. Do not copy their rules. Do not create a
new `PROMPTS.md`. Existing `PROMPTS.md` files are historical launch text,
not workflow authority.

When a decision changes, keep the old decision and add the date, new decision,
reason, and proof. Delete stale execution instructions from any plan you make
active.

## Bad and good examples

| Bad | Good |
|---|---|
| Repeat eighty lines of standing rules in every prompt. | Start with the task path and let the root files supply the workflow. |
| Assign one agent to every numbered plan even when they share a schema. | Keep the schema with one owner and parallelize only independent callers. |
| Require a full suite, deployment, and review after each commit. | Name the focused check for each unit and one final phase gate. |
| Treat a two-month-old plan as proof of current behavior. | Check the branch, tests, and running boundary, then correct the plan. |
| Add a fallback because the plan names an old field. | Update the plan, migrate saved data when required, and delete the old field. |

## Completion

A plan is ready when a fresh agent can identify the exact change, reused code,
owner, dependencies, data handling, checks, final gate, and stopping condition
without copied workflow boilerplate.
