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

## Plan 03 - Shared storage and scheduling

```text
Implement plans/evidence-library-provisioning/03-shared-storage-and-scheduling.md.
Read the provisioning README and plans 01 and 02 first. Plan 02 is merged.
This plan is the first part of OpenScholar issue #28.

Start by proving activation schedules database and database completion
schedules storage atomically. Reuse the setup operation, credentials, and
Supabase Storage bucket API. Use deterministic bucket names and fixed platform
environment values. Do not add a job table, cleanup worker, general HTTP
client, per-library storage service, or caller-supplied service fields.

Use test-decision and docs/test-quality.md before changing tests. Test state,
requests, responses, encryption, retry, and real bucket policy. Use the
assigned Convex Cloud lane and development storage only. Clean all disposable
buckets. Run the exact tests, TypeScript, schema check, isolated Convex upload,
and remote logs. Use only Sol for delegated agents. Commit each working unit
with `[plan-03]`. Keep #26 and #28 open until the full runtime passes.
```

## Plan 04 - Coolify application and deployment

```text
Implement plans/evidence-library-provisioning/04-coolify-application-and-deployment.md.
Read the provisioning README and plans 01 through 03 first. This is the second
part of OpenScholar issue #28.

Reuse Evidence Library docker/compose.library.yaml and OpenScholar's existing
configuration assembly, credentials, runtime binding, receipts, and setup
operation. Use only supported development Coolify APIs. Fix the repository,
branch, Compose path, service names, and allowed environment keys in code.
Use a deterministic application tag and recover uncertain creates or deploys
by reading current state. Do not touch Coolify's database, production, worker
environment variables, or add another Compose shape.

Use test-decision and docs/test-quality.md before changing tests. Test behavior
and validated API contracts. Run the exact tests, TypeScript, schema check,
disposable Coolify retry and cleanup, isolated Convex upload, and remote logs.
Use only Sol for delegated agents. Commit each working unit with `[plan-04]`.
```

## Plan 05 - Runtime readiness

```text
Implement plans/evidence-library-provisioning/05-runtime-readiness.md across
OpenScholar and Evidence Library. Read the provisioning README, plans 01
through 04, COOLIFY-STATUS-RESEARCH.md, both AGENTS.md files, and Evidence
Library docs/evidence-library-operations.md first.

Keep deployment status, exact Compose service state, and HTTP checks separate.
Add only one fixed authenticated runtime verifier; it accepts an application
UUID and cannot run commands or proxy arbitrary Docker requests. Do not mount
the Docker socket into OpenScholar, Convex, or a tenant app. Mark the library
active only after the saved deployment, six services, requested revision,
public library, and admin page all pass.

Use test-decision and docs/test-quality.md before changing tests. Run both
repositories' exact tests and required branch checks, build the verifier,
deploy only to development, run a disposable full setup and retry, and remove
every disposable app, volume, bucket, database, login, and test row. Upload the
shared Convex deployment, read remote logs, and request a final Sol review.
Commit each working unit with `[plan-05]`. Close #26 and #28 only after the live
flow and cleanup pass.
```

## Plan 06 - Development library teardown

```text
Implement plans/evidence-library-provisioning/06-development-library-teardown.md
across OpenScholar and Evidence Library. Read the provisioning README, plans 01
through 05, both AGENTS.md files, both test-quality guides, and the Convex rules
first.

This is development cleanup, not a future production task. Reuse the saved
setup receipts and supported service clients. Add one Owner-only,
non-production teardown operation. Delete the exact saved Coolify application
first, then both Storage buckets, then the library database and login. Delete
Convex rows only after every outside system confirms removal. Missing
resources are complete. Mismatched resources are hard failures. Retry must
never recreate a resource.

Use test-decision before changing tests. Test the real boundary and saved
state, not private call counts. Commit the corrected plan before code. Commit
every working unit with `[plan-06]`. Do not push or touch production. Deploy
only to the named development services for the live proof. Run one disposable
library through setup, add real disposable data, interrupt one teardown step,
retry, and prove the app, volume, buckets, database, login, and Convex rows are
gone. Leave shared services and unrelated libraries unchanged. Stop all local
test processes and containers before reporting completion.
```
