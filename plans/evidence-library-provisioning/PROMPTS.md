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

## Plan 02 - Shared PostgreSQL database

```text
Implement plans/evidence-library-provisioning/02-shared-postgresql-database.md.
Read plans/evidence-library-provisioning/00-README.md and plan 01 first. Plan 01
is merged. This plan implements OpenScholar issue #27 across OpenScholar and
the Evidence Library repository.

Time estimate: 3 to 5 hours. Keep working until the completion rules pass. Do
not ask questions whose answers are in the plan, current code, AGENTS.md, or
official documentation.

STANDING RULES

1. Search before building. Reuse the existing Evidence Library naming,
   PostgreSQL provisioner, advisory lock, verifier, Drizzle migrations,
   OpenScholar operation, credential encryption, and receipt code.
2. Keep the administrator login inside the Evidence Library provisioner. The
   API accepts only a library ID and its saved password. Do not add SQL, shell,
   host, URL, extension, migration-path, or administrator fields.
3. Make clean breaking changes. Do not add a compatibility path, a second SQL
   implementation, a generic executor, or a per-library PostgreSQL server.
4. Read each repository's AGENTS.md, Convex rules, test-decision skill, and
   docs/test-quality.md before editing tests. Test behavior and real database
   access. Do not test source text, CSS, or mock call counts.
5. Use the assigned Convex Cloud lane. Do not start local Convex or PM2. Use
   only the development Coolify project and supported APIs. Never touch
   production or Coolify's internal database.
6. Run the smallest relevant test during each unit. Run each repository's
   required branch checks before pushing. Clean every disposable database,
   login, test server, container, and acceptance project you create.
7. Check current official docs or installed library source instead of guessing.
   Use only Sol for delegated agents.
8. Keep issue #26 open. Issue #28 connects this database step to storage,
   Coolify application creation, deployment, and readiness.

EXECUTION RHYTHM

1. Commit this plan before code that depends on it.
2. In Evidence Library, extract the existing provisioner without changing its
   security behavior. Add migration and the fixed HTTP boundary in small,
   tested commits.
3. Build and verify the Docker target locally. Deploy the singleton service to
   development Coolify and read its state back.
4. In OpenScholar, add the saved-password and database-step behavior in small,
   tested commits. Then verify an isolated Convex upload and logs.
5. Run the live two-library retry and isolation check through the real endpoint.

COMMIT DISCIPLINE

- Check `git status` before staging. Preserve unrelated work.
- Stage named files only and keep each repository's commits separate.
- Use conventional prefixes and `[plan-02]`, for example:
  `feat(deployment): [plan-02] expose database provisioner` and
  `feat(evidence-libraries): [plan-02] run database setup step`.
- Never commit failing work. Never bypass hooks. Do not push unless the user
  asked.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict
  the plan and code cannot resolve.
- Do not stop for token worry, an answer already in the plan, or the urge to
  ask the user.
- Do not report completion until both repositories pass their checks, the
  service is healthy, live retry and isolation pass, cleanup passes, isolated
  Convex upload and logs pass, and final review passes.

DEVIATIONS

- If the plan is wrong but the safe fix is clear, commit safe work, update and
  commit the plan with `docs: [plan-02] revise ...`, then continue.
- If a required API does not exist, commit safe work, add a blocker file in
  this plan folder, and stop. Do not hide the gap with a workaround.

START NOW

1. Read the README, plan 01, plan 02, AGENTS.md, Convex rules, test-decision
   skill, and docs/test-quality.md.
2. Check both worktrees start from current origin branches and are clean.
3. Confirm no other Convex uploader or Coolify mutation is active.
4. Search the named files and begin with the smallest failing behavior test.

Go.
```
