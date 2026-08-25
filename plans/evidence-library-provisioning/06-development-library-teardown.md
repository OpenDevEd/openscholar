# Plan 06 - Development library teardown

## Goal

Remove one named development Evidence Library and every resource created for
it. Use the supported Coolify, Supabase Storage, PostgreSQL provisioner, and
Convex boundaries. Do not leave proof libraries behind.

## Scope

1. Make teardown unavailable when `CONVEX_CLOUD_ENV` is `prod`.
2. Allow only an active organization Owner to request teardown. Require the
   exact library name as confirmation.
3. Stop and delete only the saved Coolify application after checking its UUID,
   deterministic library tag, public address, repository, branch, project,
   server, and environment. Ask Coolify to remove its configuration, volumes,
   connected networks, and stopped containers. Read back that the application
   is gone.
4. Empty and delete the two bucket names saved in the setup receipt. A retry
   treats a missing bucket as complete. If emptying is still running, renew the
   operation lease and check again later.
5. Add one fixed deletion endpoint to the existing Evidence Library database
   provisioner. It derives the database and login from the library ID, checks
   ownership and server rights, ends the library's connections, drops the
   database, then drops the login. Missing resources count as complete.
6. Keep the library, credentials, revisions, receipts, and teardown operation
   while any outside resource remains. After every outside deletion passes,
   delete the library's Convex rows in bounded batches. The library then
   disappears from the Owner's list.
7. A failed step records a safe error and Retry continues from live state. It
   must never recreate a resource.

## Design

Reuse the existing setup operation lease, saved runtime binding, setup
receipts, Coolify client, Storage client, database provisioner client,
organization access check, and setup-status interface. Add `teardown` as a
fixed operation kind instead of adding a general job runner.

The order is Coolify, storage, database, then Convex. Deleting the application
first stops workers and closes normal database and storage traffic. The
database provisioner still ends any remaining connections before dropping the
database. Convex records remain available for Retry until all three outside
systems confirm deletion.

The Coolify request uses `DELETE /api/v1/applications/{uuid}` with
`delete_configurations=true`, `delete_volumes=true`, `docker_cleanup=true`, and
`delete_connected_networks=true`. A successful delete is not enough. A later
GET must report that the application is absent.

Supabase Storage emptying can finish later. Do not sleep in a Convex action.
Save the step, renew the lease, and schedule another short check. Delete a
bucket only after Storage accepts the delete request, then read it back as
missing.

The database provisioner endpoint accepts only `libraryId`. It cannot accept
SQL, a database name, a login name, an administrator URL, or a host. The
service derives the same names as reconciliation and refuses to drop a
database or login whose ownership or privileges do not match that library.

## Test-first steps

1. Add Coolify client tests for exact target checks, delete options, missing
   applications, readback, and rejection of a mismatched saved application.
2. Add Storage client tests for empty, delayed emptying, delete, missing
   buckets, and readback.
3. In Evidence Library, add database deletion logic and HTTP contract tests.
   Prove wrong ownership, another owned database, or server-wide login rights
   stop before any DROP statement.
4. Add the Owner-only teardown operation and operation-state tests. Prove a
   partial failure keeps every Convex row and Retry does not recreate anything.
5. Add the development Owner control and check its real browser behavior.
6. Run one disposable setup, add one file and one database row, run teardown,
   and prove every named resource and Convex row is gone. Run teardown Retry
   against one deliberately interrupted step.

## Files

OpenScholar:

- `convex/evidenceLibraries/coolifyClient.ts`
- `convex/evidenceLibraries/storageSetupClient.ts`
- `convex/evidenceLibraries/databaseSetupClient.ts`
- new teardown action and mutation files under `convex/evidenceLibraries/`
- `convex/evidenceLibraries/operations.ts`
- `convex/evidenceLibraries/validators.ts`
- `convex/schema.ts`
- the existing Evidence Library configuration and status components
- focused tests beside those files
- `convex/_generated/api.d.ts`

Evidence Library:

- `src/lib/deployment/provision-library-database.ts`
- `src/lib/deployment/library-database-provisioner-http.ts`
- `tools/runLibraryDatabaseProvisioner.ts`
- focused tests beside those files

## Data migration

Development data is disposable. Add the teardown operation shape directly.
Do not add compatibility fields or a backfill.

## Exact tests

OpenScholar:

```sh
npm test -- convex/evidenceLibraries/coolifyClient.test.ts
npm test -- convex/evidenceLibraries/storageSetupClient.test.ts
npm test -- convex/evidenceLibraries/databaseSetupClient.test.ts
npm test -- convex/evidenceLibraries/developmentTeardown.test.ts
npx tsc --noEmit
npm run schema:check:evidence-library-config
```

Evidence Library:

```sh
npm test -- tests/unit/library-database-provisioning.test.ts
npm test -- tests/unit/library-database-provisioner-http.test.ts
npm run check:changed
```

## Deployability gate

1. Push the Evidence Library provisioner image to the development provisioner
   and read back its healthy state.
2. Run `npm run convex:push` from OpenScholar `dev-self` and require
   `Convex functions ready`.
3. Open the development Owner page, request teardown for one disposable
   library, and watch the real status reach completion.
4. Check remote Convex logs. There must be no teardown error for that library.

## Completion rules

- Production rejects teardown before any outside request.
- Only the owning organization Owner can start it.
- A resource mismatch stops deletion and names the failed service without
  exposing credentials.
- Retry is safe after every step and never creates a resource.
- Success means the Coolify app and volume, both buckets, database, login, and
  every library-owned Convex row are gone.
- The singleton database provisioner, runtime verifier, shared PostgreSQL
  server, shared Storage service, and unrelated libraries stay running.
- Focused tests, branch checks, development deployment, browser proof, remote
  logs, and final review pass.

## Sources

- [Coolify delete application API](https://coolify.io/docs/api-reference/api/applications/delete-application-by-uuid)
- [Supabase self-hosted Storage API](https://supabase.com/docs/reference/self-hosting-storage)
- Evidence Library `src/lib/deployment/provision-library-database.ts`
- OpenScholar issue #28 and the completed development setup proof
