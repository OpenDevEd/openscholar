# Plan 01 - Fixed setup operation

## Goal

Make the existing setup operation the only saved state for first deployment.
It must lock one runner, preserve the activated revision, record each checked
resource, stop on an exact failed step, and retry safely.

## Scope

1. Add the five setup stages to the existing operation contract.
2. Store one fixed receipt per setup step on that operation.
3. Add internal mutations to claim an attempt, record a checked step, and fail
   the current step.
4. Mark the library and runtime binding ready only after the health-check
   receipt is saved for the requested revision.
5. Keep actual PostgreSQL, storage, and Coolify calls in issues #27 and #28.

## Design

The runner checks saved resource identities against the live services before
it decides to create, normalize, or leave anything alone. Every attempt starts
at database and checks the fixed sequence. It uses a short attempt token and a
renewable lease.
Recording a step moves the operation to the next fixed stage. Another runner
cannot change the operation until that lease expires. A failed operation keeps
every prior receipt.

Database, storage, and application checks report `created`, `matched`, or
`updated`. Deployment reports `created` or `matched`. Readiness can report only
`matched`. A failure names the step it expected to fail; the mutation rejects
it if the operation has already moved to another step.

Each external step is one short internal action. It saves its result and
schedules the next action. Internal mutations verify the linked library,
operation, and revision directly because scheduled Convex functions do not
inherit user authentication. The public Start and Retry actions perform the
owner check before scheduling the internal runner.

Each receipt uses named fields for that resource instead of a free-form bag.
The application, deployment, and health receipts must all name the same
Coolify application. The health receipt uses the saved Coolify deployment UUID
and must name the revision attached to the setup operation. Saving it marks the
operation succeeded, the runtime binding ready, the revision active, and the
library active in one transaction.

The generic validation and publishing operation transitions cannot start a
setup operation. Setup uses only the fixed setup mutations.

## Test-first steps

1. Add a failing behavior test proving a claim binds the exact activated
   revision and blocks a second runner.
2. Add a failing behavior test proving steps must be recorded in order with
   nonblank resource identities.
3. Add a failing behavior test proving failure records the exact step and retry
   keeps receipts while restarting checks at database.
4. Add a failing behavior test proving only the matching health receipt makes
   the library and runtime binding ready.
5. Implement the smallest schema and mutation changes that pass those tests.

## Files

- `convex/evidenceLibraries/validators.ts`
- `convex/evidenceLibraries/operations.ts`
- `convex/evidenceLibraries/setupOperation.ts`
- `convex/evidenceLibraries/setupOperation.test.ts`
- generated Convex types

## Deployability gate

Run `npx convex dev --once` against the branch's assigned Convex Cloud lane. It
must end with `Convex functions ready!`. Then run
`npx convex logs --history 200` and confirm that the upload produced no schema,
validator, or function error. Do not change shared Convex or Coolify from this
branch. The behavior tests exercise the internal claim, failure, retry, and
completion mutations because those functions are not a public client API.

## Completion rules

- One operation and one runner own setup.
- All five checked receipts survive retry.
- The immutable requested revision is returned to every step.
- A retry always rechecks from database; no caller supplies a resume stage.
- A failure names the exact step and does not run later steps.
- Readiness is the only transition that activates the library.
- Focused tests, all Evidence Library Convex tests, TypeScript, schema contract,
  production build, isolated Convex upload, and remote log check pass.

## Risks

- Marking the library active before the final readiness check would expose a
  broken deployment.
- Skipping saved-resource checks on retry could create duplicates.
- Rotating the machine credential or authentication secret during retry would
  break an already-created runtime. Generate each once and reuse it.
- OpenScholar's login page is `/evidence-libraries/<id>/configuration`; using a
  made-up `/admin` route would send Evidence Library users to a 404.
- Letting generic operation stages run setup would create two state models.
