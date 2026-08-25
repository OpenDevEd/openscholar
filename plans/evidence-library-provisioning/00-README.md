# Evidence Library provisioning

## Gap

Activation now freezes one configuration revision and attaches it to the one
setup operation created with the library. The operation does not yet run the
five agreed setup steps or keep the receipts needed for a safe retry.

## Fixed decisions

- One setup operation owns the whole first deployment.
- Its steps are database, storage, application, deployment, and health check.
- Every attempt starts at database and rechecks each saved resource against the
  live service. A matched check moves to the next step. A caller cannot guess
  where a retry should resume.
- PostgreSQL is shared, with a separate restricted database and login per
  library.
- The PostgreSQL administrator login stays inside one small Evidence Library
  provisioner service. OpenScholar sends a library ID and the saved library
  password to one fixed endpoint. It cannot send SQL, database names, runtime
  hosts, or administrator credentials.
- Storage is shared, with one private and one public bucket per library.
- Each library gets one Coolify Compose application and one private
  Meilisearch service.
- The requested revision comes from the setup operation. No step rebuilds it
  from the page or current draft.
- Each step runs as one short internal action and schedules the next step.
  Scheduled actions do not depend on a user's Clerk session.
- Setup creates one `els_` machine credential and one authentication secret,
  then decrypts and reuses them on retry. It never rotates either value during
  a retry.
- The Evidence Library login link points to the existing OpenScholar
  `/evidence-libraries/<id>/configuration` page.
- Readiness uses the saved Coolify deployment, exact host-side Compose service
  state, the configuration health endpoint, the public library page, and
  `/admin`.
- Automatic cleanup and a general workflow engine are out of scope.

## Plan

1. [Fixed setup operation](01-fixed-setup-operation.md)
2. [Shared PostgreSQL database](02-shared-postgresql-database.md)
3. [Shared storage and scheduling](03-shared-storage-and-scheduling.md)
4. [Coolify application and deployment](04-coolify-application-and-deployment.md)
5. [Runtime readiness](05-runtime-readiness.md)
6. Issue #30 adds the small status and Retry interface.

Issue #26 remains open until the steps from #27 and #28 run together against a
disposable development library. This foundation covers only the operation
state, lock, receipts, and final atomic transition.

## Existing code to reuse

- `convex/evidenceLibraries/operations.ts`
- `convex/evidenceLibraries/setupRecords.ts`
- `convex/evidenceLibraries/provisioning.ts`
- `convex/evidenceLibraries/credentialActions.ts`
- `convex/evidenceLibraries/credentials.ts`
- `convex/evidenceLibraries/validators.ts`
- Evidence Library `src/lib/deployment/library-database.ts`
- Evidence Library `tools/provisionLibraryDatabase.ts`
- Evidence Library `tools/verifyLibraryDatabaseProvisioning.ts`
- Evidence Library `docker/compose.library.yaml`
- Evidence Library `docs/evidence-library-operations.md`
- Evidence Library `tools/runRuntimeAcceptance.ts`
- Supabase Storage's bucket API
- Coolify's private GitHub application, environment, deployment, and application APIs

## Tests

Use Convex behavior tests for the operation lock, step order, saved receipts,
failure, retry, and final activation. Later issues must add live checks for the
actual PostgreSQL, storage, Coolify, Compose, and HTTP boundaries.

The host-side readiness bridge accepts only a validated Coolify application
UUID and returns the six expected Compose services with their state and health.
It is not a general remote-command runner. First test outbound SSH from the
isolated Convex development lane. If that path is blocked, use one small
authenticated host endpoint for the same fixed read-only check.

## Data migration

Development data is disposable. Extend the operation record directly. Do not
add compatibility fields or a backfill.

## Agent use

One Sol agent reviews existing code reuse. A second Sol agent challenges the
runtime readiness boundary. The integration owner implements and verifies the
branch.

## Sources

- GitHub issues OpenDevEd/openalex-count #26, #27, #28, and #30
- GitHub issue OpenDevEd/new-el #50
- Evidence Library `docs/evidence-library-operations.md`
- [Coolify application API](https://coolify.io/docs/api-reference/api/applications/get-application-by-uuid)
- [Coolify deployment API](https://coolify.io/docs/api-reference/api/deployments/get-deployment-by-uuid)
- [Coolify health checks](https://coolify.io/docs/knowledge-base/health-checks)
- [Coolify 4.3.10 deployment status values](https://github.com/coollabsio/coolify/blob/v4.3.10/app/Enums/ApplicationDeploymentStatus.php)
