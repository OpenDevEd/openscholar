# Plan 17 — Build each Evidence Library runtime once

## Goal

Build one Evidence Library image for each approved `new-el/main` commit. Every
library on that release pulls the same immutable image. Activating a library
configuration changes `LIBRARY_CONFIG_JSON` and replaces the containers, but it
does not run `npm install`, `next build`, or a Docker source build.

Estimate: two working days across `new-el` and OpenScholar, followed by one
shared-platform gate.

## Decision

Use one unified runtime image. The web app and the four workers use one image
digest. Compose gives each service its current command. The image is larger
than today's separate final stages, but it is built and pulled once per runtime
release.

Reject five separate runtime images. They remove per-library builds but do not
meet the one-image requirement.

Use a private GHCR package. This keeps the compiled contents under the same
access boundary as the private repository. Making it public would be a separate
user decision because GitHub says that change cannot be undone.

## Recommendation

Keep each library as its existing Git-backed Docker Compose application. Change
the five Evidence Library services from `build:` to one required, digest-pinned
`RUNTIME_IMAGE`. Leave Meilisearch, the volume, networks, dependencies, health
checks, per-service commands, domains and the fixed runtime verifier in the
same Compose resource.

This is the smallest safe change:

- Coolify keeps fetching `docker/compose.library.yaml` from the exact runtime
  commit, but Docker pulls an existing image instead of building source.
- The current setup and publish operations keep their leases, receipts,
  read-after-write checks and deployment adoption.
- `runtimeConfigSha256` remains the SHA-256 of the exact compact
  `LIBRARY_CONFIG_JSON` bytes. The image digest is a separate release identity
  and never enters that calculation.
- The existing runtime verifier becomes the live proof that all five runtime
  containers use the requested image reference and content digest.

Do not convert the stack to six separate Coolify resources. Do not put a
process supervisor into one container. Do not create a second deployment
service.

## Options, best to worst

| Rank | Option | Exact Coolify shape | Result |
|---|---|---|---|
| 1 | One unified image in the current Compose app | Keep `POST /api/v1/applications/private-github-app`, `build_pack: dockercompose`; Compose uses the same `ghcr.io/opendeved/evidence-library-runtime@sha256:<digest>` for five services | Meets the request and preserves the working six-service contract |
| 2 | One unified image in a raw Compose service | `POST /api/v1/services` with base64 `docker_compose_raw`, then use the service env and deploy APIs | Also avoids builds, but copies the runtime stack contract into OpenScholar or a saved Coolify value and removes the exact Git commit readback used today |
| 3 | One Docker Image application per process | Create five apps through `POST /api/v1/applications/dockerimage` plus a separate Meilisearch resource | Reject: replaces one owned stack with six resources and loses the existing Compose dependency, volume, network, domain and teardown contract |

The shared Coolify server reported version 4.3.12 through
`coolify context version` on 2026-08-29. Its raw Compose service API makes
option 2 real, but it is not the best repository boundary. The stack topology
belongs to the Evidence Library runtime commit. Keeping the Git-backed Compose
application lets `new-el` change a worker, health check, volume or dependency
with that release. A raw service would require OpenScholar to copy that
topology or add another registry artifact and hash for it.

## Facts checked on 2026-08-29

### Local measurements and prototype proof

Measured in the detached worktree
`/Users/mcharrad/Documents/Github/new-el-build-research` at runtime commit
`937bb65ecb30f5f6f22cde5d0d527f3ad9988987`. The Docker VM had 10 CPUs and
about 24 GB of memory. No Docker cache or user data was deleted.

| Check | Current | Prototype | Change |
|---|---:|---:|---:|
| Repeat local `npm run build` | 28.75 s | 17.75 s with the Turbopack build cache | 38.3% faster |
| Repeat local build after the existing separate type check owns type safety | 28.75 s | 5.58 s | 80.6% faster |
| Docker rebuild after one source-only change | 77.12 s | 39.17 s | 49.2% faster |
| Unchanged warm Docker build | 5.45 s | Not a useful target: a library deploy will not build at all | Removed from the library deploy path |
| Current five-target Docker build with a new cache | 132.52 s | One release build, not one build per library | Paid once per approved runtime commit |

The first Docker build that populated the Turbopack filesystem cache took
92.62 seconds because writing the cache cost 35.9 seconds. That is a one-time
cache population cost, not a reason to rebuild per library. The release
builder must preserve `/app/.next/cache`; the Dockerfile already mounts that
directory as a BuildKit cache.

The unified `library-runtime` prototype was 532.1 MiB. The current separate
images measured 434.2 MiB for web and 457.4–458.3 MiB for workers. The unified
image is about 74 MiB larger than one worker image, but replaces five runtime
image targets and lets Docker store and pull one content-addressed release.

Two containers then ran from the exact same local image ID,
`sha256:96bb04913194b477727331917cd8c231941bcb2ca2002ed97ab54074e3b4c4cb`.
One mounted revision `research-a`; the other mounted `research-b`. Both health
endpoints returned 200 and reported only their own revision. The disposable
containers were removed.

The full runtime acceptance suite also passed from that one image after
process-specific commands and health checks were made explicit in Compose.
It proved both runtime profiles, search isolation, live configuration changes,
Crossref and Zenodo publication, public and mobile behavior, and all 77 admin
browser tests. This found an important implementation rule: a unified image
cannot rely on a Docker target's hidden `CMD` or `HEALTHCHECK`. Compose must
declare the web command, all four worker commands, the web health check, the
search health check and the publication health check.

### Development-server benchmark

Measured on 2026-08-29 on `ode-hitzner-1`, the development Coolify host. The
host reported `linux/amd64`, 48 CPUs, 251 GiB of memory and 1.2 TiB free. The
benchmark used commit `937bb65ecb30f5f6f22cde5d0d527f3ad9988987`, two new
BuildKit builders, uniquely named containers and `/tmp` source copies. It did
not change a Coolify application or use a production resource.

| Check | Current five images | Unified image | Change |
|---|---:|---:|---:|
| Cold build with an empty BuildKit cache | 156.85 s | 144.61 s | 7.8% faster |
| Unchanged warm build | 14.45 s | 5.36 s | 62.9% faster |
| Start to active configuration health | 1.744 s | 1.757 s and 1.785 s | No meaningful change |
| Loaded web/runtime image size | 462,854,546 bytes | 565,822,607 bytes | 102,968,061 bytes larger |

The two unified containers used the exact same image ID,
`sha256:37f50309c76246680a23bda720b8028fdc78038063b3b7c1b8e98858e78d3a9b`.
Their health endpoints reported `server-benchmark-a` and
`server-benchmark-b`, and `/lib` returned HTTP 200 with `Server Benchmark A`
and `Server Benchmark B` respectively. This passes the pre-implementation
same-image, different-configuration gate.

After the measurements, all three benchmark containers, six image tags, both
BuildKit builders and the temporary source directory were removed. A final
label, image, builder and path check found no benchmark resource left behind.

Using the measured warm cache for every library after the first is the
conservative tally. One library takes 158.59 seconds with the current path and
146.38 seconds with one unified build, saving 7.7%. Five libraries take 223.37
seconds versus 153.47 seconds, saving 31.3%. Eighteen libraries take 433.89
seconds versus 176.49 seconds, saving 257.40 seconds or 59.3%. A
configuration-only replacement falls from 16.19 seconds to 1.77 seconds,
saving 89.1% per library.

Those totals deliberately count the unified build on the deployment server,
even though the final design moves it to Blacksmith. They do not count the
first private-GHCR pull because no release image exists yet. For eighteen
libraries, the build-once path still wins if that one pull takes less than
257.40 seconds when build time is counted end to end, or less than 402.01
seconds when comparing only work on the deployment server. Measure the real
GHCR pull in the runtime gate before changing a live library.

The build prototype also enabled
`experimental.turbopackFileSystemCacheForBuild` and skipped Next's duplicate
TypeScript check. This is safe for release builds only because the existing CI
has a separate required `npm run typecheck` job and the image publisher starts
only after every job for that exact commit is green. Next documents the build
cache as opt-in in this installed version and says warm comparisons must retain
`.next/cache` ([Next.js Turbopack build caching](https://nextjs.org/docs/app/api-reference/turbopack#build-caching)).

### Online findings

- Docker's own guidance matches the repository's current strengths: copy lock
  files before source, keep the context small, mount package and build caches,
  and export cache when the builder is short-lived
  ([Docker build cache guide](https://docs.docker.com/build/cache/optimize/)).
  The current Dockerfile already does most of this. More layer tuning cannot
  compete with removing per-library builds.
- Coolify separates runtime variables from build variables and writes runtime
  values for the container start
  ([Coolify environment variables](https://coolify.io/docs/knowledge-base/environment-variables)).
  Its Compose support accepts `image:` and required environment values
  ([Coolify Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose)).
  This matches the existing runtime `LIBRARY_CONFIG_JSON` design.
- GitHub documents building and publishing one image from Actions, and GHCR
  supports exact digest pulls
  ([publishing Docker images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images),
  [GHCR digest pulls](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#pulling-container-images)).
- Community reports describe the same operational result: build in GitHub,
  push to GHCR, then let Coolify pull a pre-qualified image. Treat these as
  experience reports, not contracts
  ([Coolify workflow discussion](https://www.reddit.com/r/coolify/comments/1r9s86a/what_is_your_coolify_github_actions_preferred_flow/),
  [Coolify build-load discussion](https://www.reddit.com/r/coolify/comments/1ohbt9d/cpu_usage_exceeds_only_on_build_time_in_hetzner/)).
- Package-manager switches have large anecdotal claims, including a Bun report,
  but would change the dependency toolchain for a smaller gain than build-once
  and were not adopted
  ([Next.js Docker build report](https://www.reddit.com/r/nextjs/comments/1poajqs/cut_my_nextjs_docker_build_time_by_23s_switching/)).

### The current OpenScholar path

- `convex/evidenceLibraries/coolifyClient.ts:28-48` fixes the source at
  `OpenDevEd/new-el`, branch `main`, Docker Compose, and writes
  `LIBRARY_CONFIG_JSON`, `MEILISEARCH_MASTER_KEY` and `SOURCE_COMMIT`.
- `coolifyClient.ts:904-923` treats a tagged private-GitHub Compose application
  as the only valid bound application. `coolifyClient.ts:995-1025` creates it
  through `/api/v1/applications/private-github-app`.
- `coolifyClient.ts:1685-1736` already follows the required idempotent shape:
  find by the library tag, reconcile fields and environment, read everything
  back, then return the saved Coolify configuration hash and the library JSON
  hash.
- `coolifyClient.ts:2018-2085` changes only the library JSON on a normal
  publish. `coolifyClient.ts:2097-2177` adopts an existing deployment only when
  its runtime commit and Coolify configuration hash match.
- `convex/evidenceLibraries/runtimeConfiguration.ts:122-129` creates compact
  JSON once and hashes those exact bytes. Image selection must remain outside
  this function.
- `convex/evidenceLibraries/applicationSetupActions.ts:81-166` reads the pinned
  commit, assembles the library-specific runtime JSON, and gives both to the
  existing Coolify client.
- `convex/evidenceLibraries/configurationDeploymentActions.ts:130-253` reads
  the bound app, assembles or resumes the saved target, changes the commit only
  for a software update, writes the JSON and checks both hashes.
- `convex/evidenceLibraries/runtimeReleases.ts:111-165` currently calls the
  newest `main` commit deployable before any image exists. That race must be
  removed: a commit becomes an available runtime release only after its GHCR
  digest resolves.
- `convex/evidenceLibraries/validators.ts:396-425` stores a running commit but
  no image. Its release cache at `:464-477`, publish receipt at `:653-660`,
  deployment target at `:662-678` and runtime update at `:680-685` are also
  commit-only. All of those identities must change together.
- `convex/evidenceLibraries/coolifyClient.ts:421-457` bounds requests but turns
  every non-special HTTP status into one generic failure. Registry reads need
  their own narrow retry rules; Coolify writes keep the existing reconciliation
  rules instead of gaining a broad retry wrapper.
- `convex/evidenceLibraries/readinessClient.ts:330-353` already requires the
  fixed host verifier to report the saved application, commit and all six
  services. Extend this response; do not add another verifier.
- `plans/evidence-library-configuration-v2/15-runtime-ai-analytics-merge.md:294-326`
  records that the saved deployment target still contains the whole encrypted
  runtime JSON and all platform secrets. This image plan must not copy those
  bytes into an image, tag, label or registry annotation.

### The pinned Evidence Library runtime

Checked against private repository commit
`937bb65ecb30f5f6f22cde5d0d527f3ad9988987` in the detached clean worktree
`/Users/mcharrad/Documents/Github/new-el-build-research`. The nearby `new-el`
checkout stayed untouched because it was on `codex/libtest` with local changes.

- [`docker/compose.library.yaml:12-24`](https://github.com/OpenDevEd/new-el/blob/937bb65ecb30f5f6f22cde5d0d527f3ad9988987/docker/compose.library.yaml#L12-L24)
  declares three reusable build blocks. The five runtime services use five
  Dockerfile targets at
  [`:30-131`](https://github.com/OpenDevEd/new-el/blob/937bb65ecb30f5f6f22cde5d0d527f3ad9988987/docker/compose.library.yaml#L30-L131).
  The library JSON is already a runtime Compose config at
  [`:153-155`](https://github.com/OpenDevEd/new-el/blob/937bb65ecb30f5f6f22cde5d0d527f3ad9988987/docker/compose.library.yaml#L153-L155).
- [`Dockerfile:38-147`](https://github.com/OpenDevEd/new-el/blob/937bb65ecb30f5f6f22cde5d0d527f3ad9988987/Dockerfile#L38-L147)
  separates the web runner and worker targets. A new final `library-runtime`
  target must contain the web output, worker source, compiled publication
  worker and the commands every service already runs.
- [`.github/workflows/ci.yml:46-74`](https://github.com/OpenDevEd/new-el/blob/937bb65ecb30f5f6f22cde5d0d527f3ad9988987/.github/workflows/ci.yml#L46-L74)
  already runs the full browser/runtime acceptance suite after building the
  production images.
- [`docker-bake.acceptance.hcl:1-37`](https://github.com/OpenDevEd/new-el/blob/937bb65ecb30f5f6f22cde5d0d527f3ad9988987/docker-bake.acceptance.hcl#L1-L37)
  and [`tests/acceptance/compose.library.override.yaml:6-27`](https://github.com/OpenDevEd/new-el/blob/937bb65ecb30f5f6f22cde5d0d527f3ad9988987/tests/acceptance/compose.library.override.yaml#L6-L27)
  currently create and pass five test images. They can become one local image
  without changing acceptance behaviour.
- [`tools/runLibraryRuntimeVerifier.ts:162-182`](https://github.com/OpenDevEd/new-el/blob/937bb65ecb30f5f6f22cde5d0d527f3ad9988987/tools/runLibraryRuntimeVerifier.ts#L162-L182)
  already inspects each container. Add the container's `Config.Image` and
  image ID to that bounded fact. Inspect each unique image ID once and require
  its `RepoDigests` to contain the expected registry digest. Checking only
  `Config.Image` would prove the requested text, not the content Docker ran.

### What the platforms support

- Docker Compose accepts `image` as `registry/name:tag` or
  `registry/name@sha256:digest`, and pulls it when it is absent. It also mounts
  configs so applications can change behaviour without rebuilding the image.
  [Docker Compose services](https://docs.docker.com/reference/compose-file/services/#image).
- Use `pull_policy: missing` with an immutable digest. The first library on a
  host pulls it; later deployments reuse the content-addressed local layers.
  If cleanup removed it, Compose pulls it again.
  [Docker pull policy](https://docs.docker.com/reference/compose-file/services/#pull_policy).
- Coolify's current documentation says Docker Compose can pull an image per
  service, while a Docker Image application skips source builds entirely.
  [Coolify build overview](https://next.coolify.io/docs/applications/builds/overview),
  [Coolify Docker Compose](https://next.coolify.io/docs/applications/builds/docker-compose).
- The deployed Coolify 4.3.12 source exposes the Docker Image create endpoint
  and the general
  application PATCH endpoint at
  [`routes/api.php:231-238`](https://github.com/coollabsio/coolify/blob/v4.3.12/routes/api.php#L231-L238).
  Its Docker Image parser accepts an immutable SHA-256 reference at
  [`DockerImageParser.php:15-40`](https://github.com/coollabsio/coolify/blob/v4.3.12/app/Services/DockerImageParser.php#L15-L40).
  That endpoint creates one application container, not this six-service stack.
- The same version exposes service create, update, environment and deployment
  routes at
  [`routes/api.php:349-389`](https://github.com/coollabsio/coolify/blob/v4.3.12/routes/api.php#L349-L389).
  `POST /api/v1/services` accepts base64 `docker_compose_raw` at
  [`ServicesController.php:360-377`](https://github.com/coollabsio/coolify/blob/v4.3.12/app/Http/Controllers/Api/ServicesController.php#L360-L377)
  and validates and saves it at
  [`:588-716`](https://github.com/coollabsio/coolify/blob/v4.3.12/app/Http/Controllers/Api/ServicesController.php#L588-L716).
  It is supported, but it moves the Compose source of truth out of the pinned
  Evidence Library commit.
- A private registry is authenticated on every Coolify server as the same OS
  user Coolify uses for Docker. Coolify does not store per-application registry
  credentials.
  [Coolify registry authentication](https://next.coolify.io/docs/applications/builds/docker-registries).
- GHCR supports exact digest pulls. Public container packages allow anonymous
  pulls; private ones require package read access.
  [GitHub Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry),
  [GitHub package access](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).
- The OCI registry contract resolves a tag through
  `HEAD /v2/<name>/manifests/<tag>` and returns the immutable digest in
  `Docker-Content-Digest`.
  [OCI Distribution Specification](https://github.com/opencontainers/distribution-spec/blob/main/spec.md#checking-if-content-exists-in-the-registry).
- Coolify queues deployments and has a per-server concurrency limit. A full
  queue can return 429. Read `Retry-After`; do not blindly repeat unsafe writes.
  [Coolify server limits](https://next.coolify.io/docs/core/infrastructure/servers/manage-server#build-and-deployment-limits),
  [Coolify rate limits](https://next.coolify.io/docs/api/rate-limits#handle-a-429-response).

## Fixed design

### 1. Publish one immutable release image

Add a `library-runtime` Dockerfile target in `new-el`. It contains everything
needed by the current web, search-indexer, source-sync, source-writeback and
publication-worker services. Keep one entrypoint and let Compose keep the five
existing commands and worker IDs.

Use a `workflow_run` release workflow triggered only when the existing CI
workflow finishes successfully for `main`. Check out its exact 40-character
head commit, not the moving branch name. Before the first publish, record the
development deployment host's Docker platform with
`docker info --format '{{.OSType}}/{{.Architecture}}'`. Put that exact platform
in the workflow as a reviewed constant. The command below is the required form
when that check returns `linux/amd64`:

```sh
docker buildx build \
  --target library-runtime \
  --platform linux/amd64 \
  --label org.opencontainers.image.source=https://github.com/OpenDevEd/new-el \
  --label org.opencontainers.image.revision="$runtime_commit" \
  --tag "ghcr.io/opendeved/evidence-library-runtime:$runtime_commit" \
  --push .
```

Use commit-pinned GitHub Actions, job-level `contents: read` and
`packages: write`, and the existing BuildKit cache. The workflow's concurrency
key is the full runtime commit and `cancel-in-progress` is false. If that tag
already exists, resolve it, verify its revision label, and finish without
rewriting it. Record the build action's digest output. GitHub documents the
`packages: write` permission and digest output in its
[image publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

Enable `experimental.turbopackFileSystemCacheForBuild` and retain the existing
`/app/.next/cache` BuildKit mount. Let the required CI `npm run typecheck` job
own TypeScript validation, and skip Next's second type check during the image
build. The publisher must still wait for the whole exact-commit CI workflow;
it must never publish from a build job alone.

The workflow supports `workflow_dispatch` with an exact commit that is an
ancestor of `main` and has a green CI run. This exists for the two-release live
gate and release recovery, not for arbitrary branch images.

### 2. Make image availability part of the release contract

Add `convex/evidenceLibraries/runtimeImageRegistry.ts`. It is a small pure
parser plus injected fetch client for GHCR's OCI manifest endpoint. It accepts
only the fixed repository and a 40-character commit tag, follows GHCR's bearer
challenge, sends the OCI/Docker manifest `Accept` values, bounds responses and
timeouts, and returns only
`ghcr.io/opendeved/evidence-library-runtime@sha256:<64 hex>`.

`runtimeReleases.ts` checks the newest `new-el/main` commit, then resolves that
commit's image. A missing tag means “the newest release is still being built”;
it is not saved as deployable and is not offered to an owner. Transport,
authentication and malformed registry answers stay distinct safe errors.

Replace commit-only release state with a strict pair:

```ts
type RuntimeReleaseIdentity = {
  commit: string;
  image: `ghcr.io/opendeved/evidence-library-runtime@sha256:${string}`;
};
```

The setup env uses `EL_RUNTIME_COMMIT_SHA` and `EL_RUNTIME_IMAGE`. Startup
refuses a missing, mutable or mismatched pair before it creates a Coolify
application. Runtime bindings, setup receipts, version receipts, release cache
rows and runtime-update operations store the pair. No optional old shape,
fallback tag or missing image remains after the narrow deployment.

### 3. Pull the image through the current Compose application

In `docker/compose.library.yaml`, replace every Evidence Library `build:` with:

```yaml
image: "${RUNTIME_IMAGE:?runtime image digest is required}"
pull_policy: missing
```

Meilisearch remains `getmeili/meilisearch:v1.37`. Declare every runtime command
and process-specific health check in Compose. Keep every current config mount,
dependency, label, network and volume.

OpenScholar keeps creating a private-GitHub Docker Compose application. Add
`RUNTIME_IMAGE` to the environment allowlist and reconcile these four values
before a deployment:

```text
LIBRARY_CONFIG_JSON=<one library's compact JSON>
MEILISEARCH_MASTER_KEY=<one library's key>
SOURCE_COMMIT=<runtime commit>
RUNTIME_IMAGE=ghcr.io/opendeved/evidence-library-runtime@sha256:<digest>
```

Setup uses the pinned pair. A software update PATCHes `git_commit_sha`, then
reconciles `SOURCE_COMMIT` and `RUNTIME_IMAGE`. A configuration-only publish
requires the bound commit and image to be unchanged and writes only the new
library JSON. Every environment write keeps the existing read-after-write
check before deployment starts.

Use these exact Coolify calls through the existing bounded client:

| Flow | Ordered calls |
|---|---|
| First setup | `POST /api/v1/applications/private-github-app` with the exact commit and `instant_deploy: false`; `POST` or `PATCH /api/v1/applications/{uuid}/envs` for the four managed values; `GET` the app and env list until readback matches; `GET /api/v1/deployments/applications/{uuid}` to adopt an exact saved request or `POST /api/v1/deploy?uuid={uuid}&force=false` once |
| Config-only deploy | `GET` app and envs; reject a commit or image mismatch; `PATCH /api/v1/applications/{uuid}/envs` for `LIBRARY_CONFIG_JSON`; read back app and envs; list/adopt or start one deployment as above |
| Runtime update | `PATCH /api/v1/applications/{uuid}` with the exact `git_commit_sha` and `instant_deploy: false`; reconcile `SOURCE_COMMIT` and `RUNTIME_IMAGE`; read back all three release values; list/adopt or start one deployment |
| Runtime rollback | Run the runtime-update calls with the saved `from` pair; never accept a caller-supplied free-form commit or image |

`GET /api/v1/deployments/{deploymentUuid}` remains the polling call. A stored
operation target contains the release pair, library JSON hash and Coolify
configuration hash before any deployment POST. That record is the recovery
point if a process stops between the ordered writes.

The application stays Git-backed because the Compose file is part of the
runtime release. The image is not placed in Coolify's single-container
`docker_registry_image_*` application fields.

### 4. Keep the two hashes separate

- `runtimeConfigSha256` is still
  `sha256(JSON.stringify(assembledLibraryConfiguration))`. It changes per
  library and per published revision and remains identical before and after
  this work for the same bytes.
- `runtimeImage` is the immutable OCI image reference. It changes only for a
  software update.
- `coolifyConfigHash` remains Coolify's hash of the saved app and environment.
  It changes when either the library JSON or runtime image changes and remains
  the deployment adoption key together with the runtime commit.

Never hash the image into `runtimeConfigSha256`. Never use a commit tag as the
deployed image reference.

### 5. Prove the running image

Extend the existing runtime verifier request with the exact runtime image
reference. Read Docker `Config.Image` and `Image` for every inspected
container. Inspect each unique image ID once. Require `web`, `search-indexer`,
`source-sync`, `source-writeback` and `publication-worker` to have the expected
digest reference in both `Config.Image` and the image's `RepoDigests`. Also
require the five containers to share one image ID. Keep the current commit
label check and the separate Meilisearch rule.

OpenScholar readiness passes both the saved commit and saved image. Activation
cannot update the runtime binding until Coolify's deployment is finished, all
six services pass, the five runtime image references match, the requested
library revision is active, and the public and admin pages answer.

### 6. Retries, rollback and concurrency

- Keep the existing one-operation-per-library lease. Do not add a platform-wide
  lock; different libraries may deploy the same digest concurrently.
- Safe GHCR `HEAD`/token reads retry with bounded exponential backoff and
  jitter. Honor `Retry-After`. Never turn 401, 403 or malformed data into a
  retry loop.
- Coolify GETs may retry. Application creation remains tag-reconcile-read, and
  deployment start remains list/adopt/start. Do not blindly repeat POST after a
  timeout or 429.
- Persist the release pair and deployment receipt before polling. A retry
  resumes or adopts only the exact commit, image, library config and Coolify
  hash.
- A failed configuration-only replacement leaves the old containers running
  and retries the same saved target.
- A failed software update restores the `from` commit and image through the
  same reconcile/deploy/readiness path. Persist the rollback deployment ID so a
  retry cannot start a second rollback. Mark the update failed only after the
  previous release is live again; otherwise report a real rollback blocker.
- Add an integration-owner-only internal action to select the last successful
  release pair from the library's own receipts and run the same rollback path.
  Do not expose arbitrary image or commit input to owners.

### 7. Registry auth, cache and cleanup

Keep GHCR private unless the user chooses public. Before the gate, the
integration owner logs the deployment server's configured Coolify OS user into
`ghcr.io` with a read-only package token and proves an exact digest pull. The
GitHub Actions publisher uses `GITHUB_TOKEN`; OpenScholar's registry resolver
uses a token with repository read and package read access.

The host login and cold-pull checks are:

```sh
runtime_image="ghcr.io/opendeved/evidence-library-runtime@$runtime_digest"
printf '%s' "$ghcr_read_token" | docker login ghcr.io \
  --username "$github_user" --password-stdin
docker pull "$runtime_image"
```

`runtime_digest` is the workflow's full `sha256:<64 hex>` output. Run these
commands as the same OS user Coolify uses for Docker. Do not put registry
credentials into a library's Compose environment.

The deployment host stores one set of content-addressed layers for the digest,
even when many library containers use it. A config-only deployment uses the
local image. Docker documents that the local image store is content-addressed
and stores shared layers once in its
[image pull reference](https://docs.docker.com/reference/cli/docker/image/pull/).
Do not add a custom image cache or build server.

Keep every published runtime image in GHCR in this plan. It is rollback data,
not build debris. Do not add an automatic package deletion token or guess that
an image is unused. Local images that have no container reference remain under
the server's normal Docker/Coolify cleanup. A later retention plan may delete a
registry digest only after a bounded OpenScholar query proves that no runtime
binding, successful version receipt or unfinished operation references it.

## Work order and files

### Lane R · Evidence Library runtime

1. Commit the plan correction in `new-el` first if repository facts change.
2. Build the unified image target and switch the library Compose file.
3. Make runtime acceptance use the one local image for all five processes.
4. Extend the fixed runtime verifier with exact image-reference proof.
5. Add the CI-gated GHCR publisher and operations guide.

Files:

- `Dockerfile`
- `docker/compose.library.yaml`
- `docker-bake.acceptance.hcl`
- `tests/acceptance/compose.library.override.yaml`
- `tools/runRuntimeAcceptance.ts`
- `src/lib/deployment/library-compose-contract.ts`
- `src/lib/deployment/library-runtime-verifier-http.ts`
- `tools/runLibraryRuntimeVerifier.ts`
- `tests/unit/library-runtime-verifier-{docker,http}.test.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/runtime-image.yml` (new)
- `docs/evidence-library-operations.md`

### Lane P · OpenScholar platform

Start only after lane R's image contract and one test digest exist.

Files:

- `convex/evidenceLibraries/runtimeImageRegistry.ts` (new) and focused test
- `convex/evidenceLibraries/runtimeReleases.ts`
- `convex/evidenceLibraries/updates.ts`
- `convex/evidenceLibraries/validators.ts`
- `convex/schema.ts`
- `convex/evidenceLibraries/applicationSetup.ts`
- `convex/evidenceLibraries/applicationSetupActions.ts`
- `convex/evidenceLibraries/deploymentSetup.ts`
- `convex/evidenceLibraries/deploymentSetupActions.ts`
- `convex/evidenceLibraries/configurationDeployment.ts`
- `convex/evidenceLibraries/configurationDeploymentActions.ts`
- `convex/evidenceLibraries/operations.ts`
- `convex/evidenceLibraries/versions.ts`
- `convex/evidenceLibraries/coolifyClient.ts`
- `convex/evidenceLibraries/readinessClient.ts`
- their focused tests
- `lib/evidence-libraries/configuration/contract-lock.json` through the existing
  contract-sync command after runtime `main` is merged

Before this lane changes Convex, read
`convex/_generated/ai/guidelines.md`. This plan changes no Next.js API, route,
cache rule or file layout.

Follow the root `AGENTS.md`, `plans/AGENTS.md` and both repository project
guides. Use separate worktrees and isolated development resources. Finish the
Evidence Library image contract before OpenScholar starts consuming it. The
integration owner alone merges and uploads shared `dev`.

## Test decision

**Test change: yes.** The lasting contract changes from “Coolify builds this
commit” to “Coolify runs this exact image digest.” Existing tests do not catch
a missing registry image, a commit/digest mismatch, a config-only publish that
changes the image, an unsafe deployment adoption, or a verifier that sees the
wrong image.

The smallest honest boundaries are:

1. Pure parser tests for OCI authentication, manifest headers, exact reference
   validation, timeouts, bounded bodies and retry classification.
2. Convex tests for saved release pairs, setup, config-only publish, runtime
   update, deployment adoption and persisted rollback receipts.
3. Runtime verifier tests over Docker inspect facts for five matching runtime
   images, one wrong image, missing and duplicate services, and Meilisearch not
   being mistaken for the runtime image.
4. The existing production-image runtime acceptance suite using one local
   image for all five processes.
5. One real shared-platform flow that reads the deployment log and host
   verifier result.

No test may scan source for `image:` or assert a YAML string. No CSS or copy
test belongs in this plan.

## Exact tests

Evidence Library:

```sh
npm test -- tests/unit/library-runtime-verifier-docker.test.ts tests/unit/library-runtime-verifier-http.test.ts
npm run test:acceptance
npm run check:changed
docker buildx build --target library-runtime --load --tag evidence-library-runtime:plan-17 .
```

The image smoke check starts each of the five current commands from that one
local image against disposable acceptance dependencies and ends with no
leftover acceptance project.

OpenScholar:

```sh
npm test -- convex/evidenceLibraries/runtimeImageRegistry.test.ts convex/evidenceLibraries/updates.test.ts
npm test -- convex/evidenceLibraries/coolifyClient.test.ts convex/evidenceLibraries/applicationSetup.test.ts convex/evidenceLibraries/deploymentSetup.test.ts
npm test -- convex/evidenceLibraries/configurationDeployment.test.ts convex/evidenceLibraries/readinessClient.test.ts convex/evidenceLibraries/versions.test.ts
npx tsc --noEmit
npm run schema:check:evidence-library-config
```

Pure release-identity logic follows red → green → clean up. Integration changes
use test-after at the existing external boundaries.

## Data and rollout choice

Saved Evidence Library configuration and release history are production data.
Do not wipe libraries, hand-edit rows or make owners repair this platform
change. Add the release image identity with widen, migrate, verify, then
narrow. Use `@convex-dev/migrations` for the unbounded rows. Audit and dry-run
before every write, verify every batch and every live binding, and narrow only
after no commit-only release identity remains. Frozen configuration revisions
remain byte-for-byte unchanged because the image is release metadata, not
owner configuration. Unknown commits, missing registry images and ambiguous
release pairs block narrowing.

Starting with the widen deployment, every new runtime release, binding,
receipt and operation target writes the strict commit-and-image pair. Temporary
optional reads and fields exist only across the three deployment stages and
are deleted in the narrow stage. This is rollout scaffolding, not a permanent
compatibility path.

The secret-free deployment target deferred from plan 15 is independent. Plan
17 continues to pass the exact assembled JSON through the current encrypted
target. The later secret plan may change how those same bytes are assembled at
write time, but it must preserve `runtimeConfigSha256` and the image contract.

## Deployability gate

### Pre-implementation server benchmark

Run this before production code changes:

1. Resolve the exact development deployment server through the supported
   Coolify API. Confirm the benchmark does not target a production application,
   database, bucket, index, domain or shared Zotero group.
2. Copy the current runtime commit and the local unified-image prototype into
   uniquely named temporary server directories. Do not change a Coolify
   application or any existing checkout.
3. Use benchmark-only BuildKit builders and Compose project names. Measure:
   the current five-target cold and warm builds, the unified-image cold and warm
   builds, first container start, and a second start with different runtime JSON
   but the same image ID.
4. Record wall time, image bytes, image ID, container start time and health
   result. Report cold and warm results separately.
5. Remove only the benchmark containers, volumes, networks, builders,
   directories and images. Never run a global Docker prune.

The final tally compares:

```text
current release cost = libraries × per-library build and replacement time
build-once release cost = one image build + first pull + library replacements
```

Do not start implementation until the server benchmark proves the same image
can run two configurations and shows the measured break-even point.

### Runtime gate

1. Merge lane R only after exact-head CI is green. Wait for the GHCR workflow.
   Record the full commit, commit tag and returned image digest. Resolve the tag
   again through OCI `HEAD` and prove it returns the same digest.
2. Publish two green commits that contain the unified runtime target: the
   implementation commit and the final merged head. This may use the bounded
   `workflow_dispatch` path. Both must be ancestors of `new-el/main` with green
   CI; no branch-only image counts.
3. Pull both digest references on the development deployment host. Run the
   fixed runtime verifier against a disposable local Compose project and prove
   all five runtime services report the expected digest reference, one shared
   image ID and a matching `RepoDigests` entry.

### OpenScholar lane gate

1. Re-pin the runtime contract to the merged `new-el/main` head. Set the lane's
   `EL_RUNTIME_COMMIT_SHA` and `EL_RUNTIME_IMAGE` to the first release pair.
2. Run `npx convex dev --once`; it must end with `Convex functions ready!`.
3. Create one lane-only library. Setup must finish without a source build. A
   config-only Activate must change `runtimeConfigSha256`, keep the image
   digest unchanged and reach the new revision.
4. Change to the second release through the update flow, then run the
   integration-owner rollback to the first pair. The verifier must prove the
   pair after each deployment. Delete the library and all lane resources.

### Shared-platform gate

1. From `dev-self`, set the approved release pair and registry token, run
   `npm run convex:push`, and confirm `✔ Convex functions ready!`. Keep
   `npm run logs:convex` open.
2. Create `el-gate-<date><letter>`. Record the Coolify deployment start/end
   timestamps. Its deployment log must show a registry pull or local image
   reuse and contain no `docker build`, `npm install`, or `next build` step.
3. Read the runtime verifier result: six expected services; five exact runtime
   image references; one shared image ID whose `RepoDigests` contains the
   expected digest; matching release commit; web, search, publication and
   Meilisearch healthy; both source workers running.
4. Change one visible configuration value and Activate. Prove the revision and
   `runtimeConfigSha256` changed, the image reference did not, the deployment
   log contains no source build, and `/api/library-config/health`, `/lib` and
   `/admin` pass.
5. Update to the second release pair, roll back to the first pair, then return
   to the approved latest pair. After each step prove the exact image through
   the verifier and the exact revision through health. Delete the library
   through the app and confirm the Coolify application and volume are gone.

Record the measured setup and config-only deployment times beside the former
per-library build time. Do not claim a speed improvement without those exact
timestamps.

## Completion rules

- One unified private runtime image is the fixed release shape.
- One immutable image digest exists for each approved runtime commit; no
  mutable tag is ever sent to Coolify.
- A commit without a registry digest is never offered or deployed.
- All five Evidence Library processes run from one exact digest while
  Meilisearch stays separate.
- `runtimeConfigSha256` remains a hash of only the exact library JSON bytes.
- Setup, config publish, runtime update, retry and rollback persist and verify
  both release identities without duplicate deployment starts.
- Exact tests, `new-el` CI, lane Convex upload, shared Convex upload, remote
  logs, shared live gate and cleanup all pass.
- Update the smallest existing Outline current-state and integration-contract
  pages after both repositories are pushed and the shared gate passes. Read
  both pages back before reporting the change.

## Known risks

- The unified image includes both web and worker dependencies, so it is larger
  than the current web-only final image. Measure image bytes and cold-pull time
  in the gate. If the result is unacceptable, stop and return to option 2; do
  not silently publish five images under the one-image plan.
- A private GHCR package makes host registry login an operating dependency.
  Prove an exact digest pull before changing any library. Expired credentials
  fail before activation; they never justify a mutable public fallback.
- `new-el/main` can advance before its image finishes. The registry gate is the
  release boundary; Git branch head alone is no longer deployable truth.
- Coolify's deployment record carries the Git commit and configuration hash,
  not the registry manifest digest. The host verifier is required on every
  activation and software rollback.
- A host cache makes warm config deployments fast but can hide broken registry
  authentication. The gate includes one cold exact-digest pull before relying
  on warm reuse.
