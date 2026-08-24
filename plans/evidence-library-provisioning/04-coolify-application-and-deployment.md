# Plan 04 — Coolify application and deployment

## Goal

Create or recover one Coolify Compose application for the library, write its
complete validated runtime configuration, and deploy one immutable Evidence
Library commit.

## Scope

1. Reuse Evidence Library `docker/compose.library.yaml`. Do not construct a
   second Compose shape in OpenScholar.
2. Create one private GitHub application in the OpenScholar Coolify development
   environment with build pack `dockercompose`, repository
   `OpenDevEd/new-el`, branch `main`, and Compose path
   `/docker/compose.library.yaml`.
3. Pin the configured Evidence Library commit SHA for the whole setup attempt.
4. Generate and preserve one Meilisearch key, one Evidence Library machine
   credential, and one authentication secret. Retrying may not rotate them.
5. Assemble the frozen revision with the database, search, storage, and
   OpenScholar authentication values already supported by
   `assembleEvidenceLibraryConfiguration`.
6. Give only `web` the library's public domain. Write and read back exactly
   `LIBRARY_CONFIG_JSON` and `MEILISEARCH_MASTER_KEY`; the Compose file owns
   every worker setting.
7. Save the complete runtime binding and application receipt, then schedule
   deployment in the same mutation.
8. Start or adopt the deployment for the same application, commit, and config
   digest. Poll the supported deployment endpoint until `finished`; treat
   failure and cancellation as failures. Save the deployment receipt and
   schedule readiness atomically.

## Design

Use a narrow Coolify client with fixed endpoints and validated response types.
Platform environment values provide the Coolify origin, token, server UUID,
project UUID, environment name, GitHub App UUID, and Evidence Library commit.
OpenScholar code fixes the repository, branch, Compose path, service names, and
allowed environment keys.

Tag every application with a deterministic library tag. Before creation, list
by that tag. Zero matches means create; one matching application means read and
repair it; more than one means stop with a conflict. After every create, patch,
or environment write, read the application or value back before saving a
receipt. Never use Coolify's internal database.

The application receipt must include application UUID, configured commit, and
configuration SHA-256. The deployment receipt must include those values plus
the deployment UUID. This ties readiness to the frozen revision instead of a
later draft or webhook deployment.

Use short Convex environment names, including `EL_COOLIFY_URL`,
`EL_COOLIFY_TOKEN`, `EL_COOLIFY_SERVER_UUID`, `EL_COOLIFY_PROJECT_UUID`,
`EL_COOLIFY_ENVIRONMENT`, `EL_COOLIFY_GITHUB_APP_UUID`,
`EL_RUNTIME_COMMIT_SHA`, `EL_CONVEX_SITE_URL`, and
`EL_ZOTERO_TRANSLATION_URL`.

## Test-first steps

1. Add credential behavior tests proving retries reuse the search key, machine
   credential, and authentication secret, while public queries expose none.
2. Add configuration assembly coverage using the frozen revision and managed
   values. Compare behavior and parsed JSON, not source text or call counts.
3. Add Coolify client contract tests for tag lookup, create, repair, allowed
   environment writes, readback, deployment adoption, status polling, bounded
   timeouts, and safe errors.
4. Add application action and completion mutation. Save the full runtime
   binding and schedule deployment atomically.
5. Add deployment action and completion mutation. Save the deployment receipt
   and schedule readiness atomically.

## Files

- `lib/evidence-libraries/configuration/assembly.ts` only if an existing
  reusable entry point is insufficient
- `convex/evidenceLibraries/credentials.ts`
- `convex/evidenceLibraries/applicationSetup.ts`
- `convex/evidenceLibraries/applicationSetupActions.ts`
- `convex/evidenceLibraries/coolifyClient.ts`
- `convex/evidenceLibraries/deploymentSetup.ts`
- `convex/evidenceLibraries/deploymentSetupActions.ts`
- `convex/evidenceLibraries/setupOperation.ts`
- `convex/evidenceLibraries/validators.ts`
- focused tests beside those files
- `convex/_generated/api.d.ts`

## Data migration

Extend setup receipts directly with the commit and configuration digest.
Development rows are disposable. Do not add optional legacy receipt shapes or
a backfill.

## Exact tests

```sh
npm test -- convex/evidenceLibraries/applicationSetup.test.ts
npm test -- convex/evidenceLibraries/deploymentSetup.test.ts
npm test -- lib/evidence-libraries/configuration/validation.test.ts
npx tsc --noEmit
npm run schema:check:evidence-library-config
```

## Runtime check

In the development Coolify project, create one disposable application through
the same client, repeat application and deployment reconciliation, and read
back the repository, commit, Compose path, web-only domain, two allowed
environment values, deployment UUID, and final status. Remove only that named
disposable application afterward.

## Completion rules

- One application tag resolves to exactly one Compose application.
- The app contains the repository Compose file, requested commit, frozen
  configuration digest, web-only domain, private Meilisearch, and all four
  workers.
- Retry does not create another app, volume, route, key, or deployment for the
  same committed state.
- No manual worker environment variables or `SYNC_TARGETS` exist.
- Focused tests, TypeScript, schema check, live Coolify check, cleanup, Convex
  upload, and log check pass.

## Risks

- Coolify deployment creation has no idempotency key. Recover by listing saved
  application deployments and matching application, commit, and config digest
  before starting another.
- A create response may be lost. The deterministic tag is the recovery key.
- A user-selected domain may already belong to another app. Treat that as a
  conflict; never force a domain override.

## Sources

- [Coolify private GitHub application API](https://next.coolify.io/docs/api/endpoints/applications/create-private-github-app-application)
- [Coolify Docker Compose guide](https://coolify.io/docs/applications/build-packs/docker-compose)
- [Coolify application list API](https://coolify.io/docs/api-reference/api/applications/list-applications)
- GitHub issue OpenDevEd/openalex-count #28

