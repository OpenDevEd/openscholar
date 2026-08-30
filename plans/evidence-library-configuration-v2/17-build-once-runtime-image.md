# Plan 17 — Build each Evidence Library runtime once

## Goal

Build one Evidence Library image for each approved `new-el/main` commit. Every
library on that release pulls the same immutable image. Activating a library
configuration changes `LIBRARY_CONFIG_JSON` and replaces the containers, but it
does not run `npm install`, `next build`, or a Docker source build.

Estimate: three working days across the build server, `new-el` and OpenScholar,
followed by one shared-platform gate.

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

Run every `new-el` GitHub Actions job inside one KVM guest on the current
48-core Hetzner Coolify host. GitHub keeps scheduling jobs and reporting the
aggregate `CI` result, but Blacksmith does not execute any job. The guest has 24
virtual CPUs, 48 GiB of memory and a bounded virtual disk. Use fixed runners
instead of an autoscaler: four 2-core light runners, one 16-core runtime runner
and one 16-core release runner. Both heavy Docker users are pinned to the same
guest CPUs 8 through 23, so together they can use only those 16 cores. The
guest and host never admit more than 24 CI cores at once.

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
even though the final design moves it to the isolated self-hosted build guest.
They do not count the first private-GHCR pull because no release image
exists yet. For eighteen
libraries, the build-once path still wins if that one pull takes less than
257.40 seconds when build time is counted end to end, or less than 402.01
seconds when comparing only work on the deployment server. Measure the real
GHCR pull in the runtime gate before changing a live library.

The production-dependency prototype kept the same runtime behavior while
removing development packages from the final unified image:

| Check | First unified prototype | Production-dependency image | Change |
|---|---:|---:|---:|
| Cold build with an empty BuildKit cache | 144.61 s | 129.60 s | 10.4% faster |
| Unchanged warm build | 5.36 s | 3.75 s | 30.0% faster |
| Loaded image size | 565,822,607 bytes | 465,565,934 bytes | 100,256,673 bytes smaller |

Two different runtime configurations passed health and `/lib` from that image.
Every worker entrypoint existed and loaded. The full acceptance suite remains
the implementation gate before this Dockerfile shape can merge.

Fresh isolated builders measured the Next.js options separately from image
export. The baseline and worker-thread rows are two-run averages; the other
rows are one clean-cache run each.

| Next.js setting | Next build | Whole builder stage | Decision |
|---|---:|---:|---|
| Current prototype | 33.30 s | 77.62 s | Baseline |
| `experimental.workerThreads: true` | 28.85 s | 73.24 s | Keep: 13.4% faster Next build |
| Turbopack plugin worker threads | 34.40 s | 79.62 s | Remove: slower |
| Static-generation batching | 33.40 s | 77.54 s | Remove: no gain |
| Disable prerender source maps | 32.90 s | 76.76 s | Remove: noise-sized gain and worse diagnostics |

CPU isolation on the same 48-core host found the useful ceiling:

| CPUs available to the build | Next workers | Next build | Whole builder stage |
|---:|---:|---:|---:|
| 4 | 3 | 52.20 s | 99.65 s |
| 8 | 7 | 35.00 s | 80.95 s |
| 16 | 15 | 28.50 s | 72.23 s |
| 48 | 47 | 28.85 s | 73.24 s |

Sixteen cores matched the unrestricted machine. More cores did not improve
this build. Do not hard-code 15 workers: set `experimental.cpus` from Node's
`availableParallelism() - 1`, with a minimum of one, so a 16-core runner uses
15 while local and future runners follow their real CPU limit.

The build prototype also enabled
`experimental.turbopackFileSystemCacheForBuild`, enabled worker threads and
skipped Next's duplicate TypeScript check. This is safe for release builds only
because CI has a separate required `npm run typecheck` job and the image
publisher starts only after every job for that exact commit is green. Next
documents the build cache as opt-in in this installed version and says warm
comparisons must retain `.next/cache`
([Next.js Turbopack build caching](https://nextjs.org/docs/app/api-reference/turbopack#build-caching)).

The option and CPU benchmarks used ten isolated BuildKit builders. All ten,
their caches, the temporary Node image tag and
`/tmp/el-next-flags-20260829a` were removed. The final check returned
`CLEANUP_OK`.

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
- GitHub routes a job to any idle self-hosted runner whose group and labels
  match `runs-on`. A self-hosted runner executes one job at a time. Restrict the
  CI and release groups to `new-el` and route light, runtime and release work
  with separate labels
  ([self-hosted runner reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners),
  [using self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow)).
- GitHub warns that self-hosted jobs do not receive a clean isolated machine.
  Keep the build guest separate from the Coolify host, accept jobs only from
  branches in the same private repository, give test runners no deployment
  secrets, and isolate the release runner under its own OS account and
  runner-group workflow rule
  ([secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)).
- Docker's container driver accepts `cpuset-cpus` and keeps a persistent local
  BuildKit cache. Use one pre-created builder for the runtime runner and a
  separate one for the release runner
  ([Docker container driver](https://docs.docker.com/build/builders/drivers/docker-container/)).
- GitHub documents publishing one image from Actions, and GHCR supports exact
  digest pulls
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

### Live verifier correction checked on 2026-08-30

The first shared-platform canary exposed one missing permission in the runtime
verifier Compose file. The verifier now reads `/images/{id}/json` to prove the
content digest, but `docker-socket-proxy` allowed only container reads. The
proxy returned a failure and the public verifier endpoint answered 502 even
though all six library services were healthy.

Set `IMAGES: "1"` as well as `CONTAINERS: "1"` on the read-only socket proxy.
Keep `POST: "0"`, the read-only socket mount and the existing capability
drops. Add a Compose contract test that parses the rendered service
environment and proves both read permissions are present while writes remain
disabled. A source-text assertion is not enough.

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

### 0. Move `new-el` CI off Blacksmith

Create one Ubuntu 24.04 KVM guest on the current 48-core Hetzner Coolify host.
Give it 24 virtual CPUs, 48 GiB of memory and a 300 GiB sparse virtual disk.
The host keeps the other 24 CPUs and more than 190 GiB of currently available
memory for Coolify. The guest firewall permits public internet access for
GitHub, npm, Playwright images and GHCR, but denies the host address, Docker
networks, private address ranges and cloud metadata addresses. Runner users
have no host mount, host Docker socket, Coolify socket or passwordless sudo.

Register two GitHub runner groups that only `OpenDevEd/new-el` may use. The CI
group owns the light and runtime runners. The release group owns only the
release runner and accepts only `.github/workflows/runtime-image.yml` from
`main`. A label is routing information, not a security boundary, so the release
runner must not share the CI group. The workflows keep their current aggregate
`CI` result and GitHub UI; only the machine that executes a job changes.

The organization currently uses a GitHub plan that does not support branch
protection or repository rulesets for this private repository. CI still runs on
every push and pull request, but GitHub cannot require its result before a
merge. This is the same enforcement limit as the current Blacksmith workflow.
Until the organization moves to GitHub Team, the integration owner must read
the exact-head aggregate `CI` result before merging.

Provision these fixed runner services:

| Count | Label | CPU limit | Jobs |
|---:|---|---:|---|
| 4 | `evidence-library-light` | 2 each | lint, type check, schemas, unit tests, code quality and the final gate |
| 1 | `evidence-library-runtime` | 16 | Docker build and runtime acceptance |
| 1 | `evidence-library-release` | 16 | exact-commit runtime image publication |

Each service accepts one job at a time. Apply CPU limits with systemd and give
each service its own work directory. Put the two runner listener services in
one 16-core heavy-work slice. The runtime and release users each own a separate
rootless Docker daemon and persistent `docker-container` BuildKit builder.
Create those two builders with no nested CPU setting. Pin both heavy runner
services and both rootless Docker user slices to the same guest CPUs 8 through
23 with systemd. That shared CPU set limits their combined work to those 16
cores even though the Docker daemons remain in separate user slices.

Do not move a rootless Docker user manager out of `user.slice`. The first
release build proved that Docker's supported systemd cgroup driver then cannot
create its container scopes. Rootless Docker also does not delegate the cpuset
controller to its BuildKit container, so a second `cpuset-cpus` driver option
fails even though the outer 16-core boundary is active. Do not share a Docker
socket or cache between test and release jobs.
Preinstall Node 22, Chromium's Linux packages, Docker, Compose and Buildx. The
workflow still runs locked `npm ci` and installs the package-lock-selected
Chromium version.

Keep the guest out of Coolify and deployment systems:

- no Convex, Coolify, Cloudflare, database, storage, SMTP, Clerk or production
  SSH credentials;
- no route to private deployment networks or cloud metadata endpoints;
- test jobs receive only `contents: read` and no repository secrets;
- self-hosted PR jobs run only when the head repository is
  `OpenDevEd/new-el`; a maintainer must copy an approved fork change to a branch
  in that repository before CI runs it;
- the release runner has a separate non-root account and group label restricted
  to `.github/workflows/runtime-image.yml` on the default branch; its
  `packages: write` `GITHUB_TOKEN` exists only for that job.

Change `.github/workflows/ci.yml` to use the light and runtime labels. Replace
Blacksmith's builder action with the pre-created runtime builder. Remove
`.github/workflows/blacksmith-testbox.yml`; the existing manual CI dispatch is
the replacement. A repository search for `blacksmith` and `useblacksmith` must
return no workflow, action, package or documentation dependency.

Use fixed services, not Kubernetes, Actions Runner Controller or a custom
autoscaler. The measured host has enough capacity, KVM provides the boundary
from Coolify, and GitHub already queues a job when every matching runner is
busy. Provision the four light runners and runtime runner for the CI move.
Provision the separate release runner only when `runtime-image.yml` is ready.

#### CI move result, 2026-08-30 local time (2026-08-29 UTC)

Evidence Library PR #146 merged into `main` at
`d26f4cd22fb77e7d8e4a0d070ac7a641189cf67b`. The current Hetzner host now
runs the `new-el-ci` Ubuntu 24.04 KVM guest with 24 virtual CPUs, 48 GiB of
memory and a 300 GiB sparse disk. The selected `Evidence Library CI` runner
group contains four `evidence-library-light` runners and one
`evidence-library-runtime` runner. The release runner remains deliberately
unprovisioned until the release workflow exists.

The first cold commissioning run took 10 minutes 7 seconds. Runtime acceptance
passed in 9 minutes 56 seconds, while Fallow exposed one real runner setup
error: its global npm install could not write to the system Node directory.
Commit `91ef9ec9ad798b4aa78efad6ab860759a95aeebf` gives Fallow a temporary,
job-local npm directory instead of adding sudo or making the system directory
writable. The exact PR head then passed in 6 minutes 29 seconds. The merged
`main` run
[`33281691193`](https://github.com/OpenDevEd/new-el/actions/runs/33281691193)
passed in 6 minutes 1 second, with runtime acceptance at 5 minutes 50 seconds.
That is 4 minutes 6 seconds, or 40.5%, faster than the cold run. Initial queue
time was 3 seconds. One of the five light jobs waited 85 seconds for one of the
four light runners, but the runtime lane still determined the total time.

The heavy user slice peaked at 28.86 GiB under its 32 GiB limit. Its persistent
BuildKit cache held 10.05 GB after the runs. The runtime lane stayed on guest
CPUs 8-23; the four light services stayed on 0-1, 2-3, 4-5 and 6-7. Runner
accounts had no sudo, public GitHub access worked, and attempts to reach the
host address and Docker private network were blocked. The host Docker service
and the existing Evidence Library containers stayed running. A repository
search found no remaining Blacksmith workflow, action, package or operations
instruction.

This completes only the CI move. The unified runtime image, separate release
runner and group, image publication, per-library config injection and the
runtime-image cold/warm measurements remain in the steps below.

### 1. Publish one immutable release image

Add a `library-runtime` Dockerfile target in `new-el`. It contains everything
needed by the current web, search-indexer, source-sync, source-writeback and
publication-worker services. Keep one entrypoint and let Compose keep the five
existing commands and worker IDs.

Use a `workflow_run` release workflow triggered only when the existing CI
workflow finishes successfully for `main`. Route it only to the
`evidence-library-release` self-hosted runner. Check out its exact 40-character
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
`packages: write`, and the release runner's persistent BuildKit builder. The
workflow's concurrency key is the full runtime commit and `cancel-in-progress`
is false. If that tag already exists, resolve it, verify its revision label,
and finish without rewriting it. Record Buildx's digest output. GitHub
documents the `packages: write` permission and digest output in its
[image publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

The first live publish on 2026-08-30 showed that Buildx returns the selected
single-platform configuration at `.image.config`, even though the pushed
manifest is an OCI index. Read the revision from
`.image.config.Labels["org.opencontainers.image.revision"]`. The earlier
`.image["linux/amd64"]` assumption returned no label and would reject a safe
rerun. Prove this path by dispatching the already published commit again; the
workflow must reuse the existing digest without pushing it again.

Enable `experimental.turbopackFileSystemCacheForBuild` and
`experimental.workerThreads`, calculate `experimental.cpus` from
`availableParallelism()`, and retain the existing `/app/.next/cache` BuildKit
mount. Install only production packages in the unified final image. Let the
required CI `npm run typecheck` job own TypeScript validation, and skip Next's
second type check during the image build. The publisher must still wait for the
whole exact-commit CI workflow; it must never publish from a build job alone.

The workflow supports `workflow_dispatch` with an exact commit that is an
ancestor of `main` and has a green CI run. This exists for the two-release live
gate and release recovery, not for arbitrary branch images.

#### Runtime image result, 2026-08-30

`new-el` PRs
[147](https://github.com/OpenDevEd/new-el/pull/147) and
[149](https://github.com/OpenDevEd/new-el/pull/149) merged after exact-head CI.
Main CI run `33285051052` published merge commit
`3b84f8c44db0b35049bcae6b780992c829fc66ed` as
`sha256:e03c0792e2ac2b2517956a0e2129ef29ae3ad79902d8090810ca793a9baacbd0`.
Main CI run `33285713625` published the final fix merge
`9dd3e7b36ca8b29dace3fdcaffb9ecc833932d09` as
`sha256:eca9917bdd28bd4691242553b3b8f5c012077e3d4daafef976c7bee4b304feb3`.
Direct registry inspection returned `linux/amd64`, the exact revision label and
the expected source label for both images.

The first automatic publish run `33285278327` took 67 seconds and pushed its
manifest in 30.9 seconds. With the persistent cache warm, run `33285960766`
took 14 seconds and pushed its new commit tag in 3.8 seconds. Manual recovery
run `33285715918` selected the already published first commit, returned the
same digest in 12 seconds and left the package version timestamp unchanged.
This proves an existing immutable tag is reused rather than rebuilt or
rewritten.

Runner group `Evidence Library Release` is selected for only
`OpenDevEd/new-el`, permits no public repository and accepts only
`.github/workflows/runtime-image.yml` from `refs/heads/main`. Job
`99187286311` reported runner `new-el-ci-release`, group
`evidence library release` and label `evidence-library-release`.

### 2. Make image availability part of the release contract

Add `convex/evidenceLibraries/runtimeImageRegistry.ts`. It is a small pure
parser plus injected fetch client for GHCR's OCI manifest endpoint. It accepts
only the fixed repository and a 40-character commit tag, follows GHCR's bearer
challenge, sends the OCI/Docker manifest `Accept` values, bounds responses and
timeouts, and returns only
`ghcr.io/opendeved/evidence-library-runtime@sha256:<64 hex>`.

Reuse the existing `GITHUB_TOKEN`; do not add another registry secret. Read the
token owner's login from GitHub's authenticated-user endpoint, exchange that
login and token at the exact bearer realm from GHCR's challenge, then repeat
the manifest `HEAD` with the short-lived bearer token. On 2026-08-30 the shared
token completed that flow for commit
`9dd3e7b36ca8b29dace3fdcaffb9ecc833932d09` and returned
`sha256:eca9917bdd28bd4691242553b3b8f5c012077e3d4daafef976c7bee4b304feb3`.
An anonymous request returned the expected pull challenge. This proves the
package is private and the existing token has the required repository and
package access.

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
- A later software update may recover from a replacement that reached Coolify
  but failed before OpenScholar saved the new binding. Accept the running
  commit and image only when that exact pair is the target of this library's
  own earlier software-update operation. Continue to the requested release
  through the normal deploy and readiness path. Arbitrary Coolify drift still
  blocks the update.
- A failed configuration-only replacement leaves the old containers running
  and retries the same saved target.
- A failed software update restores the `from` commit and image through the
  same reconcile/deploy/readiness path. Persist the rollback deployment ID so a
  retry cannot start a second rollback. Mark the update failed only after the
  previous release is live again; otherwise report a real rollback blocker.
- Add an integration-owner-only internal action to select the last successful
  release pair from the library's own receipts and run the same rollback path.
  Do not expose arbitrary image or commit input to owners.

Live correction, 2026-08-30: `new lib` reached the `9dd3e7b3` image while its
binding still recorded the pre-image `937bb65e` release because the old runtime
verifier returned 502. After `062bb121` became current, the next update safely
needed to cross that proven intermediate release. The earlier plan covered
rollback but omitted this crash-recovery case, and the pre-image release had no
digest to restore. The implementation must therefore prove the intermediate
pair from the same library's operation history and test both that recovery and
the rejection of an unrelated pair.

### 7. Registry auth, cache and cleanup

Keep GHCR private unless the user chooses public. Before the gate, the
integration owner logs the deployment server's configured Coolify OS user into
`ghcr.io` with a read-only package token and proves an exact digest pull. The
GitHub Actions publisher uses `GITHUB_TOKEN`; OpenScholar's registry resolver
uses the existing `GITHUB_TOKEN`, whose repository and package read access was
proved against the live private package. Do not add a duplicate GHCR token to
Convex.

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
The build guest keeps only its two named BuildKit caches. Do not add a registry
proxy, remote cache service or second build scheduler.

Keep every published runtime image in GHCR in this plan. It is rollback data,
not build debris. Do not add an automatic package deletion token or guess that
an image is unused. Local images that have no container reference remain under
the server's normal Docker/Coolify cleanup. A later retention plan may delete a
registry digest only after a bounded OpenScholar query proves that no runtime
binding, successful version receipt or unfinished operation references it.

## Work order and files

### Lane R · Evidence Library runtime

1. Provision and gate the four light runners and one runtime runner, then move
   every CI job to them and remove Blacksmith.
2. Commit the plan correction in `new-el` first if repository facts change.
3. Build the production-dependency unified image target and switch the library
   Compose file.
4. Make runtime acceptance use the one local image for all five processes.
5. Extend the fixed runtime verifier with exact image-reference proof.
6. Add the self-hosted, CI-gated GHCR publisher and operations guide.

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
- `.github/workflows/blacksmith-testbox.yml` (delete)
- `.github/workflows/runtime-image.yml` (new)
- `.github/actions/setup-project/action.yml`
- `README.md`
- `docs/blacksmith-ci-optimization.md` (replace)
- `docs/self-hosted-ci.md` (new)
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
   being mistaken for the runtime image. The rendered verifier Compose test
   must also prove that its socket proxy allows container and image reads but
   not Docker writes.
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
test -z "$(rg -l -i 'blacksmith|useblacksmith' .github README.md docs package.json package-lock.json)"
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

The 2026-08-30 shared-data audit found five runtime bindings, six release-cache
rows and nine operations. Two bindings are ready on pre-image commits, three
are unassigned setup rows, and every release-cache row lacks an image. Four
terminal publish operations contain commit-only target, receipt or update
metadata. Those old commits never had a unified image, so a migration must not
attach the new image to them and pretend that pair ran.

Delete the stale commit-only release cache so the normal check writes fresh
pairs. Move each ready library to the approved pair through the real update
flow. For terminal operations only, remove an unverifiable saved deployment
target, runtime update, or receipt release identity while keeping the operation
result and frozen revision. Terminal setup recovery receipts may also drop
their old application/deployment details; they are retry state, not version
history. A queued or running operation with incomplete release identity blocks
the migration. Unassigned pending bindings legitimately have no release pair;
every provisioned pending or ready binding must have both values after
narrowing. Operation receipts then allow either both release values or neither,
while deployment targets and runtime updates require the full pair.

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

Completed on 2026-08-29. The exact results are recorded under **Development
server benchmark** above. The same image ran two configurations, the optimized
image passed both web health checks, 16 CPUs matched the unrestricted 48-core
build, and cleanup returned `CLEANUP_OK`.

Before production code changes, repeat only the checks that can change with the
new isolated build guest:

1. Prove the four light runners and runtime runner are online in the selected
   `new-el` CI runner group. Prove the guest has no route to the host, Docker
   networks or private addresses. Prove their systemd limits admit at most 24
   CI cores. Repeat this after adding the release runner and prove the two heavy
   runners still share only 16 cores.
2. Run CI once on an unchanged commit. All jobs must execute on the self-hosted
   labels, and a repository search must find no Blacksmith dependency.
3. Record cold and warm runtime-image build times, image bytes, BuildKit cache
   bytes, peak memory, total CI time and queue time. Keep
   `PLAYWRIGHT_WORKERS=4` for the first run; test 8 only after that run is green
   and keep it only when all browser checks pass and wall time improves.
4. Attempt one harmless workflow from a fork and one non-release workflow that
   requests the release label. Neither may receive a self-hosted runner.
5. Remove only benchmark containers, volumes, networks, builders, directories
   and images. Never run a global Docker prune.

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

1. From `dev-self`, set the approved release pair, confirm the existing
   `GITHUB_TOKEN` still resolves its exact private GHCR digest, run
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
- Every `new-el` CI job runs on the selected self-hosted CI runner group; no
  Blacksmith workflow, action, label, package or operations instruction remains.
  The aggregate `CI` result is green on the exact head. GitHub cannot enforce it
  before merge on the organization's current plan, so the integration owner
  checks it manually until GitHub Team enables rulesets.
- The 24-core build guest admits at most four 2-core light jobs and 16 cores of
  heavy work across the runtime and release runners. The 48-core host keeps at
  least 24 CPUs outside CI. Test jobs have no deployment keys, and only the
  default-branch release workflow can reach the release runner.
- `runtimeConfigSha256` remains a hash of only the exact library JSON bytes.
- Setup, config publish, runtime update, retry and rollback persist and verify
  both release identities without duplicate deployment starts.
- Exact tests, `new-el` CI, lane Convex upload, shared Convex upload, remote
  logs, shared live gate and cleanup all pass.
- Update the smallest existing Outline current-state and integration-contract
  pages after both repositories are pushed and the shared gate passes. Read
  both pages back before reporting the change.

## Known risks

- A persistent self-hosted runner can keep malicious state between jobs. This
  plan limits that risk with a KVM guest, same-repository PRs, separate non-root
  users and Docker daemons, no deployment credentials or private network route,
  and a release runner restricted to one default-branch workflow. If those
  boundaries cannot be proved, stop; do not move PR jobs off their current
  isolated runner.
- GitHub cannot protect `main` or require the aggregate `CI` result for this
  private repository on the organization's current plan. The CI move does not
  worsen that existing limit, but it also cannot fix it. Upgrade the
  organization to GitHub Team before allowing maintainers to merge without the
  integration owner's exact-head check.
- Local caches can grow without a hosted-provider quota. Record cache bytes in
  the gate and add a bounded cleanup rule by age and builder name. Never run a
  global prune and never delete an image digest that a live release can use.
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
