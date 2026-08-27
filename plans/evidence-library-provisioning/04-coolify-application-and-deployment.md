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
7. Save the complete runtime binding and application receipt, including the
   release commit, runtime JSON hash, and Coolify configuration hash, then
   schedule deployment in the same mutation.
8. Start or adopt the deployment for the same application, commit, and config
   digest. Each poll performs one supported deployment request, renews the
   lease, and schedules the next poll instead of sleeping. Treat failure and
   cancellation as failures. Save the deployment receipt and schedule
   readiness atomically.

## Design

Use a narrow Coolify client with fixed endpoints and validated response types.
Platform environment values provide the Coolify origin, token, server UUID,
project UUID, environment name, GitHub App UUID, and Evidence Library commit.
OpenScholar code fixes the repository, branch, Compose path, service names, and
allowed environment keys.

Pin the exact 40-character commit. Disable automatic, preview, instant, and
webhook deployment. Also disable generated domains, forced domain replacement,
automatic Dockerfile build-argument injection, and source-commit build
injection. Coolify still exports `SOURCE_COMMIT` to the Compose command. The
repository Compose file writes that value to
`org.opendeved.evidence-library.release` on all six services, so readiness
cannot approve old healthy containers without invalidating the Docker build
cache on every commit.

Tag every application with a deterministic library tag. Before creation, list
by that tag. Zero matches means create; one matching application means read and
repair it; more than one means stop with a conflict. After every create, patch,
or environment write, read the application or value back before saving a
receipt. Both allowed values are non-preview, literal runtime and build-time
variables because Coolify resolves required Compose substitutions during the
build. Never use Coolify's internal database.

Keep three values separate: the SHA-256 of the exact `LIBRARY_CONFIG_JSON`
bytes, Coolify's application `config_hash` after every readback, and the
deployment UUID. The application receipt includes the application UUID,
configured commit, runtime JSON hash, and Coolify hash. The deployment receipt
adds the deployment UUID. This ties readiness to the frozen revision instead
of a later draft or webhook deployment.

Coolify has no deployment idempotency key. Before starting a deployment, list
the application's deployments and adopt one that matches the application,
commit, and Coolify hash. A failed or cancelled match may be replaced. If the
POST result is completely lost, a second queue row cannot be ruled out without
another service; do not add one. The application, route, volume, Meilisearch
service, and configuration must still remain unique.

Use short Convex environment names, including `EL_COOLIFY_URL`,
`EL_COOLIFY_TOKEN`, `EL_COOLIFY_SERVER_UUID`, `EL_COOLIFY_PROJECT_UUID`,
`EL_COOLIFY_ENVIRONMENT`, `EL_COOLIFY_GITHUB_APP_UUID`,
`EL_RUNTIME_COMMIT_SHA`, `EL_OPENSCHOLAR_URL`, `EL_CONVEX_SITE_URL`, and
`EL_ZOTERO_TRANSLATION_URL`.

The platform mail service for contact and takedown emails uses `EL_SMTP_HOST`,
`EL_SMTP_FROM`, `EL_SMTP_PORT` (default 587), `EL_SMTP_SECURITY` (`tls`,
`starttls`, or `none`; default `starttls`), and the optional pair
`EL_SMTP_USERNAME` and `EL_SMTP_PASSWORD`. Owners never see these values. If
`EL_SMTP_HOST` is missing, a library with a contact or takedown recipient is
refused at Save, Activate, and assembly before anything is created in Coolify.

`NEXT_PUBLIC_APP_URL` remains `http://localhost:3000` for the local Next.js
development server. `EL_OPENSCHOLAR_URL` is the stable HTTPS development
origin written into deployed library login links. Do not make local web
development depend on a deployed OpenScholar frontend.

Each Coolify request has a 20-second timeout and accepts at most 2 MiB of JSON.
Each deployment poll performs one status request and then reschedules itself;
it never sleeps while a deployment runs.

## Test-first steps

1. Add credential behavior tests proving retries reuse the search key, machine
   credential, and authentication secret, while public queries expose none.
2. Add configuration assembly coverage using the frozen revision and managed
   values. Compare behavior and parsed JSON, not source text or call counts.
3. Add Coolify client contract tests for tag lookup, create, repair, immutable
   release flags, allowed environment writes, readback, deployment adoption,
   one-check polling, bounded timeouts, and safe errors.
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
environment values, deployment UUID, and final status. Remove it through Plan
06. Do not use a separate cleanup command.

## Completion rules

- One application tag resolves to exactly one Compose application.
- The app contains the repository Compose file, requested commit, frozen
  configuration digest, web-only domain, private Meilisearch, and all four
  workers.
- Retry does not create another app, volume, route, or key. It adopts a known
  matching deployment whenever Coolify returns enough evidence to do so.
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
- A long-running poll would exceed Convex's action limit. One action performs
  one check, then a mutation renews the lease and schedules the next check.

## Sources

- [Coolify private GitHub application API](https://next.coolify.io/docs/api/endpoints/applications/create-private-github-app-application)
- [Coolify Docker Compose guide](https://coolify.io/docs/applications/build-packs/docker-compose)
- [Coolify application list API](https://coolify.io/docs/api-reference/api/applications/list-applications)
- GitHub issue OpenDevEd/openalex-count #28
