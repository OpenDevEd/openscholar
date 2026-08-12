# Plan 02 Blocker — Isolated Evidence Library Acceptance Runtime

## Status

Provisioning resumed on **2026-08-12** after the user approved creating the
isolated Coolify application and its dedicated development services. The
isolated web app, database, search index, keys, buckets, and runtime config now
exist. No live Evidence Library was reused or changed.

The remaining Plan 02 acceptance criterion is:

- "A dev-gated seed creates a library/runtime binding with platform service values for isolated acceptance."

The OpenScholar-side organization, memberships, Evidence Library, draft and
provisioning action are live. The runtime health route is also live. The
remaining deployment gap is the required search-indexer worker: the web app
cannot render `/lib` until that worker creates the index settings.

## What Was Verified

### Clerk and Convex fixture

- Clerk organization: `org_3HlfXyYZNp7NRrtRGuwSUcwHXq4`
- Organization name: `OpenScholar Evidence Library E2E`
- Admin membership: `orgmem_3HlfY14P1AbQBLniiQpbwJtJw0D`, role `org:admin`
- Member membership: `orgmem_3HlfY219ZxdsV9lIdgvlbefufIV`, role `org:member`
- Clerk's development Svix endpoint was corrected from the stale `openscholar-site.opendev.space` target to `https://convex-site.opendev.space/webhooks/clerk`.
- Real signed `organization.updated` and both `organizationMembership.created` messages now have durable `applied` event-log outcomes and active Convex projection rows.
- Evidence Library `r17feg9wgsamsshbp1j6nbjess8c85q6` and draft `r5795hxvc8631q5pntgmrjwhcx8c8hae` were created through the public `createLibrary` mutation with the admin organization identity.
- Development Convex has `EL_DEV_PROVISIONING_ENABLED=true` and an encryption key configured.

### Code and deployed gates

- `npm test`: 363 files and 3,547 tests passed.
- The deployed function spec contains the public Evidence Library mutations, queries, credential action and provisioning action with explicit args and return validators.
- `npx pm2 logs convex --lines 5 --nostream` shows the latest `✔ Convex functions ready!` deployment.

### Isolated Evidence Library runtime

- Coolify application: `vntgj8bi5omift3a7u279ymd`
- Public origin: `https://docs-openscholar-e2e.opendev.space`
- PostgreSQL database: `jsl67a25e78gukd3izzxz4zf`
- Meilisearch index: `openscholar_e2e`
- Private bucket: `openscholar-e2e-private`
- Public bucket: `openscholar-e2e-public`
- Runtime config revision: `openscholar-e2e-1`
- Evidence Library commits `36bd50d` and `66a78dd` were reviewed by Fable,
  pushed to `openscholar`, and deployed. The application is healthy.

## What Was Tried

1. Audited the OpenScholar Coolify project's `development` environment. It has no Evidence Library runtime application.
2. Audited all existing `OpenDevEd/new-el` Coolify applications. They are production tenant deployments on branch `coolify`, not an isolated acceptance target on branch `openscholar`.
3. Checked representative production tenants. Their current health routes return `404`, they have no `LIBRARY_CONFIG_PATH`, and they do not implement the revision-and-digest acceptance contract required by Plan 06.
4. Audited the Evidence Library acceptance compose donor at commit `667cfeadbc51b0a36a21f5de1b7a7647bb7622ad`. It is ephemeral and incomplete for this purpose: its config names a storage service that the compose file does not define, so its service values cannot form a durable binding.
5. Audited the shared platform services. Shared Meilisearch, PostgreSQL and tenant storage values exist, but they are production/shared resources. No dedicated database, unique index, or separate private/public storage buckets are reserved for this fixture.

## Why This Blocks Plan 02

`seedDevelopmentBinding` stores a durable runtime identity plus encrypted database, search and storage credentials for later real activation. Seeding it with production tenant values, unowned shared resources or synthetic URLs would make the acceptance fixture destructive or dishonest. The plan explicitly requires isolation and forbids legacy/placeholder paths.

The current Evidence Library runtime also lacks the authenticated, versioned and idempotent remote validation/activation endpoint plus revision-and-digest health receipt required by Plan 06. The existing filesystem activation CLI is not a remote control-plane contract.

## What Would Unblock It

1. Add a repository-owned production Compose file that always deploys the web
   app and one `search-indexer` worker from the same commit and runtime config.
2. Change runtime acceptance to use that worker and delete its copied raw
   Meilisearch settings setup.
3. Deploy the Compose shape and prove that `/lib` renders without a search
   settings error.
4. Seed library `r17feg9wgsamsshbp1j6nbjess8c85q6`, verify metadata-only
   reads, rerun the Plan 02 gates, and request Fable's final approval.

## Safety Boundary

No production Coolify application, database, index, bucket, deployment or
environment variable was changed. Only the isolated test resources above were
created. The two reviewed Evidence Library container fixes were pushed to the
`openscholar` branch.

## Resume Note — 2026-08-12

This note is superseded by the deployment deviations below.

Create a development-only `OpenDevEd/new-el` application from branch
`openscholar` in the OpenScholar Coolify `development` environment. Create a
new PostgreSQL database, a dedicated Meilisearch index and key, and separate
private-document and public-image buckets. Read every value back before
deployment. After the runtime is healthy, seed its binding into library
`r17feg9wgsamsshbp1j6nbjess8c85q6`, rerun the Plan 02 gates, and request a
Fable review. Do not push code.

## Deployment Deviation — 2026-08-12

The isolated database, Meilisearch index and key, storage buckets, runtime
configuration, and Coolify application now exist. Fable approved each setup
step.

The first application deployment, `n8g3ryu9qwggofjhzrejw9x7`, failed before
starting the app. The Docker image runs the main build before it builds the
local `@opendeved/evidence-library-core` package. The main build therefore
cannot load `packages/evidence-library-core/dist/index.js`.

Before retrying the deployment:

1. Fix the Evidence Library Dockerfile so the local core package is built
   before the main Next.js build.
2. Prove the fix with the matching package build and Docker image build.
3. Ask Fable to review the fix.
4. Commit the working Evidence Library fix locally without pushing it.
5. Deploy only after that commit exists in the remote `openscholar` branch.
   Do not add a Coolify-only Dockerfile, build command, or other one-off setup.

The fix is now local commit `36bd50d`. The package build and full production
image build passed, and Fable approved the change. The Coolify application
still uses the repository's normal Dockerfile with no custom Dockerfile,
install command, build command, or start command. Deployment is paused because
the user has also said not to push.

## Runtime File-Permission Deviation — 2026-08-12

The user later allowed pushes. Commit `36bd50d` was pushed and Coolify built
the full image successfully. Deployment `frzxpycbrb8v4s1haqp7rqpi` then failed
its runtime health check because the non-root `nextjs` user could not read the
root-owned `/runtime/config/library.json` file mount.

Do not solve this with a Coolify-only owner, mode, custom command, or custom
Dockerfile. Add the smallest repository-owned container startup path that
checks the configured file, makes it readable by the app user, drops root
privileges, and starts Next.js with correct signal handling. Prove it against a
root-owned mounted file, run the full image checks, ask Fable to review it,
then push and redeploy the same repository Dockerfile.

## Search Worker Deployment Deviation — 2026-08-12

Commit `66a78dd` fixed the mounted config permissions. Deployment
`se6k1u527xnjm1jsnwmk7lek` finished and the runtime health route reports the
active `openscholar-e2e-1` revision. The web app still logs this error when
`/lib` loads:

```text
Index openscholar_e2e: Attribute tags is not filterable.
```

Fable traced the error to the deployment shape. The repository gives
`ensureSearchIndex` one owner: the `search-indexer` worker. The current Coolify
application deploys only the web target, so no service creates the required
Meilisearch settings or later drains published records into search.

Before seeding the OpenScholar binding:

1. Add `docker/compose.library.yaml` as the repository-owned Coolify shape for
   the web app plus the required search worker.
2. Keep optional source workers in a separate repository Compose file because
   the target Coolify version cannot be trusted to honor Compose profiles.
3. Add the search worker to runtime acceptance and delete the copied
   Meilisearch settings call from the acceptance tool.
4. Run the search-worker and full runtime acceptance checks, request Fable
   review, commit, push, and deploy the same Compose file.
5. Verify the real browser page and logs before continuing Plan 02.

Fable's implementation review found two more startup rules that the Compose
contract must enforce before it can be deployed:

- the search worker is not healthy while its stage is `starting`, so the web
  app cannot serve requests before index settings finish; and
- the worker gets a five-minute health-check start window so a real database
  migration does not fail the deployment after about one minute.

## Compose Build Context Deviation — 2026-08-12

Evidence Library commit `8566927` passed its local checks and Fable review, but
Coolify deployment `ugwf9nq5q3wbkr1hyllvob8f` could not find the repository
Dockerfile. Coolify runs Compose from the repository root. The Compose files
used `context: ..`, which therefore pointed one folder above the repository.

Before retrying the deployment:

1. Change every repository Compose build context to `.` so the Dockerfile and
   source files come from the repository root.
2. Make local Compose checks set the repository root as the project directory,
   matching Coolify instead of relying on the Compose file's folder.
3. Run both Compose render checks, the focused deployment tests, and Fable
   review before committing, pushing, and redeploying.

## Internal Database Address — 2026-08-12

Evidence Library commit `6a56741` fixed the build context. Deployment
`q5hjnbiivhzj6xgx8k52u9n6` built both images, but the search worker could not
reach PostgreSQL through the server's public port and remained in migration
startup. A direct check from the worker proved that the isolated database is
reachable through Coolify's shared network at
`jsl67a25e78gukd3izzxz4zf:5432`.

Use that internal address in the development library config. Keep the public
port only for tests run outside Coolify. Redeploy the same repository Compose
file, then verify the worker, health route, and `/lib` in the real browser.
