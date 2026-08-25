# Plan 05 — Runtime readiness

## Goal

Mark a library active only after the exact deployment, all six Compose
services, the requested configuration revision, the public library, and the
admin page are ready.

## Scope

1. Keep Coolify deployment status, host-side Compose state, and HTTP responses
   as separate evidence. Do not create a second readiness store.
2. Add one development runtime verifier to Evidence Library. It accepts only a
   validated Coolify application UUID and expected release commit, then returns
   Docker state for containers bearing that Compose project label. It cannot
   accept a command, label, service list, host, socket path, or container ID
   from the caller.
3. Require exactly one current container for `web`, `search-indexer`,
   `source-sync`, `source-writeback`, `publication-worker`, and `meilisearch`.
   Web, search, publication, and Meilisearch must be healthy. The two source
   workers must be running; their current Compose definitions intentionally
   have no Docker health check.
4. Require the saved Coolify deployment to be `finished` for the saved app,
   commit, and Coolify configuration hash. Require every container's
   repository-owned release label to match that commit and reject a public
   Meilisearch port.
5. Require `/api/library-config/health` to report `state: "active"`, the saved
   revision, and no rejected configuration. Then require the default-locale
   public library route and `/admin` to return same-origin success.
6. Record the health receipt and activate the library only after all checks
   pass. This final mutation clears setup-only encrypted secrets.

## Design

Coolify 4.3.10 does not expose per-service Compose state through its supported
REST API. The verifier is therefore a separate fixed boundary. Package it as a
small Evidence Library Docker target and deploy one authenticated development
service on the Coolify host. Put a GET-only Docker socket proxy between the
verifier and Docker; a read-only socket mount still permits mutating Docker API
requests. Its code performs one fixed container query and returns a small
validated JSON result. Do not add shell execution, arbitrary Docker API
proxying, or a Docker socket mount to OpenScholar, Convex, or a tenant app.

The OpenScholar readiness action calls the supported Coolify application and
deployment APIs, this verifier, and the three library HTTP checks. It saves no
remote body or secret in an operation error. Retrying rechecks the same saved
application and deployment; it does not redeploy unless the deployment step
has separately proved that a new deployment is required.

## Test-first steps

1. In Evidence Library, add request and response tests for authentication,
   application UUID validation, exact service selection, duplicate or missing
   services, exited services, health failures, and safe errors.
2. Add a Docker target and operations guide for the fixed verifier. Build it
   and run it against a disposable local Compose project, then clean it up.
3. In OpenScholar, add readiness client tests for exact URLs, revision match,
   public/admin responses, safe errors, and timeouts.
4. Add the readiness action and final mutation. Prove no active revision or
   ready binding is written when any one boundary fails, the release label is
   stale, Meilisearch is public, or config health reports a rejected revision.
5. Run one disposable library through activation twice. Prove one app, one
   volume, two buckets, one database, six services, one active revision, and a
   successful second reconciliation. Remove every resource through Plan 06.

## Files

Evidence Library:

- `Dockerfile`
- `src/lib/deployment/library-runtime-verifier-http.ts`
- `tools/runLibraryRuntimeVerifier.ts`
- focused unit tests
- `docs/evidence-library-operations.md`

OpenScholar:

- `convex/evidenceLibraries/readinessSetup.ts`
- `convex/evidenceLibraries/readinessSetupActions.ts`
- `convex/evidenceLibraries/readinessClient.ts`
- `convex/evidenceLibraries/setupOperation.ts`
- focused tests
- `convex/_generated/api.d.ts`

## Data migration

None. The existing setup health receipt, runtime binding, library state, and
active revision fields are the only durable state.

## Exact tests

Evidence Library:

```sh
npm test -- tests/unit/library-runtime-verifier-http.test.ts
npm run check:changed
docker build --target runtime-verifier .
npm run test:acceptance:cleanup
```

OpenScholar:

```sh
npm test -- convex/evidenceLibraries/readinessSetup.test.ts
npm test -- convex/evidenceLibraries/setupOperation.test.ts
npx tsc --noEmit
npm run schema:check:evidence-library-config
```

## Runtime check

Deploy the verifier only to the development Coolify environment. Read back its
commit, token settings, and healthy state. Run the disposable end-to-end setup,
inspect the six host-side service results and three HTTP results, then run the
Plan 06 teardown and prove the app, volume, buckets, database, login, and
Convex library records are gone. Leave the singleton provisioner and verifier
running for later sprints.

## Completion rules

- A finished Coolify deployment alone cannot mark a library ready.
- Missing, duplicate, exited, or unhealthy services name the failed service.
- Every service carries the exact saved release commit and Meilisearch has no
  public port binding.
- The requested revision is active before the public and admin checks pass.
- Setup marks the binding ready, library active, and revision active in one
  final mutation only after every boundary passes.
- Both repositories pass their required checks and CI. Development deployment,
  end-to-end retry, cleanup, Convex upload, remote logs, and final review pass.

## Risks

- Docker socket access is powerful even for a read-only endpoint. Keep it out
  of tenant apps and expose only the fixed authenticated query through a
  GET-only socket proxy.
- Rolling deployments may briefly leave old containers. Match the saved
  application's current Compose project and reject duplicates until rollout
  settles.
- HTTP success from `web` cannot prove workers are alive. Never skip the
  host-side service check.

## Sources

- `plans/evidence-library-provisioning/COOLIFY-STATUS-RESEARCH.md`
- Evidence Library `docs/evidence-library-operations.md`
- Evidence Library `tools/runRuntimeAcceptance.ts`
- GitHub issues OpenDevEd/openalex-count #28 and OpenDevEd/new-el #50
