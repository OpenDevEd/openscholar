# Prompts

## Plan 01 - Fixed setup operation

```text
Implement plans/evidence-library-provisioning/01-fixed-setup-operation.md.
Read plans/evidence-library-provisioning/00-README.md first. This plan depends
on OpenScholar issues #21, #23, and #32. They are already merged into dev.

Time estimate: 2 to 3 hours. Keep working until the completion rules pass. Do
not ask questions whose answers are in the plan, current code, AGENTS.md, or
official documentation.

STANDING RULES

1. Search before building. Reuse the existing operation, setup-record, runtime-
   binding, activation, validation, and credential code.
2. Make clean breaking changes. Do not add legacy paths, fallback fields, a
   second job table, a general workflow engine, or automatic cleanup.
3. Read convex/_generated/ai/guidelines.md before editing Convex code. Use the
   assigned Convex Cloud lane. Do not start local Convex, use PM2, upload to the
   shared deployment, or touch Coolify.
4. Use the test-decision skill and docs/test-quality.md before editing tests.
   Test database and API behavior. Do not test source text, CSS, or mock call
   counts.
5. Run the smallest test during each unit. Before finishing, run the full test
   suite, TypeScript, the Evidence Library schema check, and the production
   build.
6. Run `npx convex dev --once` after the Convex code is committed. It must end
   with `Convex functions ready!`. Then read 200 remote log lines and confirm
   there is no matching schema, validator, or function error.
7. Check current official docs or installed library source instead of guessing.
   Use only Sol for delegated agents.
8. Keep issue #26 open. This plan adds the operation foundation. Issues #27 and
   #28 add the live PostgreSQL, storage, Coolify, Compose, and HTTP steps.

EXECUTION RHYTHM

1. For each plain state transition, write the failing Convex behavior test,
   make it pass, clean up the code, and commit the working unit.
2. Add integration guards after the state contract is clear. Commit each
   working integration unit separately.
3. Every setup attempt starts at database and rechecks all five steps. A caller
   never supplies a resume stage.
4. Each future external step is one short internal action that saves its result
   and schedules the next. Public Start and Retry actions perform the owner
   check because scheduled functions have no user identity.

COMMIT DISCIPLINE

- Check `git status` before staging. Preserve unrelated work.
- Stage named files only.
- Commit the plan before code that depends on it.
- Use conventional prefixes and `[plan-01]`, for example:
  `feat(evidence-libraries): [plan-01] add fixed setup operation`.
- Never commit failing work. Never bypass hooks. Do not push unless the user
  asked.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict
  the plan and code cannot resolve.
- Do not stop for token worry, an answer already in the plan, or the urge to
  ask the user.
- Do not report completion until tests, build, schema check, isolated Convex
  upload, remote logs, and final review pass.

DEVIATIONS

- If the plan is wrong but the safe fix is clear, commit safe work, update and
  commit the plan with `docs: [plan-01] revise ...`, then continue.
- If a required API does not exist, commit safe work, add a blocker file in
  this plan folder, and stop. Do not hide the gap with a workaround.

START NOW

1. Read the README, numbered plan, AGENTS.md, Convex rules, test-decision skill,
   and docs/test-quality.md.
2. Check `git status` and confirm the branch starts from current origin/dev.
3. Confirm no other Convex uploader is using this worktree or assigned lane.
4. Search the named existing files and start the first failing behavior test.

Go.
```
