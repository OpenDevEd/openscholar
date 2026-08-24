# Plan 02 - Shared PostgreSQL database

## Goal

Make the database setup step create or normalize one restricted database and
login on the existing development PostgreSQL server. Run the Evidence Library
migrations, save the runtime database URL in OpenScholar, and make the same
request safe to repeat.

## Scope

1. Move the existing Evidence Library provisioner into reusable runtime code
   while keeping the current command-line wrapper.
2. Add one authenticated Evidence Library provisioner endpoint and one Docker
   target for it.
3. Make the endpoint derive fixed database and login names from the OpenScholar
   library ID, install extensions, run migrations as the restricted login, and
   return a checked receipt.
4. Add the OpenScholar database action that creates one password, calls the
   endpoint, encrypts the returned runtime URL, saves the database receipt, and
   never rotates that password on retry.
5. Deploy the provisioner only to the shared development Coolify server and
   prove retry and cross-library isolation with disposable libraries.

## Design

The privileged PostgreSQL code remains in the Evidence Library repository,
next to its migrations and database rules. A small Node HTTP service exposes
only `POST /v1/library-databases/reconcile` and a health endpoint. The service
reads the PostgreSQL administrator URL and internal runtime host from its own
environment. The request contains only the OpenScholar library ID and its
saved database password. The bearer token comes from the service environment.

The service derives lowercase PostgreSQL-safe names from a stable digest of
the library ID. Callers cannot choose names, hosts, URLs, SQL, extensions, or a
migration folder. The existing advisory lock and ownership checks remain the
single implementation of database creation. The administrator installs
`vector` and `pg_trgm`; the restricted login then runs the checked-in Drizzle
migrations. The response reports `created`, `matched`, or `updated`, the fixed
database and login names, and the internal runtime URL.

OpenScholar uses a Node action for the network call and encryption. Before the
first call, it creates one random database password and saves its encrypted
form on the setup operation. A retry decrypts the same password. After the
service succeeds, one internal mutation saves the encrypted runtime URL as the
library's database credential and records the database receipt. The encrypted
password stays on the setup operation because a failure in any later step
restarts checks at the database. The final health-check transition clears it
only after the whole setup succeeds. A stale attempt cannot save a URL or
receipt.

The database action is one setup step, not a general job runner. Issue #28
wires all five setup steps into the public Start and Retry flow. Until then,
the database step is invoked only by an internal development verification.

## Test-first steps

1. Add Evidence Library behavior tests for request validation, bearer
   authentication, deterministic names, method and path rejection, and safe
   error responses. These tests call the HTTP handler; they do not inspect
   source text or mock call counts.
2. Extend the real PostgreSQL verifier to call the same reconcile function
   twice, run migrations inside reconciliation, reject a conflicting owner,
   and prove both cross-library connection attempts fail.
3. Add OpenScholar behavior tests proving the setup password is created once,
   reused after a failed call, cleared after success, and rejected when a stale
   attempt tries to save a credential.
4. Add an OpenScholar action test around a local fixed HTTP server. Prove the
   action sends the bounded request, saves the encrypted URL and database
   receipt, and records a safe error without leaking the password or endpoint
   token.
5. Implement the smallest service, Convex action, schema fields, and internal
   mutations that pass those checks.

## Files

Evidence Library:

- `src/lib/deployment/library-database.ts`
- `src/lib/deployment/provision-library-database.ts`
- `src/lib/deployment/library-database-provisioner-http.ts`
- `tools/provisionLibraryDatabase.ts`
- `tools/runLibraryDatabaseProvisioner.ts`
- `tools/verifyLibraryDatabaseProvisioning.ts`
- `tests/unit/library-database-provisioning.test.ts`
- `tests/unit/library-database-provisioner-http.test.ts`
- `Dockerfile`
- `package.json`
- `docs/evidence-library-operations.md`

OpenScholar:

- `convex/evidenceLibraries/databaseSetupActions.ts`
- `convex/evidenceLibraries/databaseSetup.ts`
- `convex/evidenceLibraries/databaseSetup.test.ts`
- `convex/evidenceLibraries/setupOperation.ts`
- `convex/evidenceLibraries/credentials.ts`
- `convex/evidenceLibraries/validators.ts`
- `convex/schema.ts`

The exact file list may shrink when existing modules can hold the behavior
cleanly. Do not create an extra abstraction only to match this list.

## Data migration

Development data is disposable. Add the encrypted password directly to the
setup operation and clear it only after the complete five-step setup succeeds.
Do not add a backfill or compatibility field.

## Runtime check

1. Build the `database-provisioner` Docker target.
2. Deploy one development-only service through the supported Coolify API.
3. Set its administrator URL, internal PostgreSQL host, bearer token, and port
   as service environment values. Read them back through the supported API.
4. Set the provisioner URL and token on the assigned Convex Cloud lane.
5. Reconcile two disposable library IDs through the actual HTTP endpoint.
6. Retry both IDs and confirm the same database and login are returned.
7. Connect with each restricted login and prove it cannot reach the other
   database in either direction.
8. Remove the two disposable databases and logins. Keep the singleton
   development provisioner running for issue #28.

Do not touch production, create a second PostgreSQL server, edit Coolify's
database, or expose a shell or SQL endpoint.

## Completion rules

- One authenticated fixed endpoint owns database reconciliation.
- OpenScholar never stores or receives the PostgreSQL administrator URL.
- The restricted login owns its database objects and has no server-wide power.
- Public database access is revoked and both cross-library connections fail.
- Extensions are installed before migrations.
- A retry returns the same database and login without rotating the password.
- A different existing owner stops setup with a clear error.
- The runtime URL is encrypted in OpenScholar, retries through later steps keep
  the same database password, and stale setup attempts cannot replace it.
- Evidence Library focused tests, `check:changed`, the real PostgreSQL verifier,
  Docker build, and cleanup pass.
- OpenScholar focused tests, full tests, TypeScript, production build, isolated
  Convex upload, remote logs, and final review pass.

## Risks

- Losing the first response after PostgreSQL commits is normal. The saved
  password, advisory lock, fixed names, and readback make the retry converge.
- Allowing caller-selected names or SQL would turn a narrow service into a
  remote administrator. Keep the request fixed.
- Saving a new password on every retry would make an already-created database
  unusable if a stale request won. Generate once and reject stale attempts.
- The shared PostgreSQL server is a shared failure boundary. Per-library
  databases isolate access, not uptime or server capacity.
