# Plan 01: move and shorten OpenScholar CI

## Goal

Run same-repository secret-free OpenScholar CI on isolated fixed runners, keep
fork code off those runners, restore every live check, and record a real
before-and-after result from GitHub. Keep secret-bearing jobs hosted until the
existing live-service and artifact-storage failures are fixed.

Estimate: one working day, including guest setup and four to six full workflow
runs.

## Evidence before changes

### GitHub timing

There is no fully credentialed successful GitHub baseline. The current 99
successful pull-request runs all skipped auth and billing after their
environment checks.

| Run | Total | `npm ci` | Unit and contract tests | Build | Real auth or billing |
|---|---:|---:|---:|---:|---|
| [33241824814](https://github.com/OpenDevEd/openalex-count/actions/runs/33241824814) | 590 s | 119 s | 334 s | 97 s | No, skipped |
| [33239685845](https://github.com/OpenDevEd/openalex-count/actions/runs/33239685845) | 876 s | 176 s | 528 s | 130 s | No, skipped |
| [33236605043](https://github.com/OpenDevEd/openalex-count/actions/runs/33236605043) | 876 s | 174 s | 532 s | 136 s | No, skipped |
| [32742065180](https://github.com/OpenDevEd/openalex-count/actions/runs/32742065180) | 668 s | 170 s | 346 s | 112 s | No, skipped |

The first plan-only PR run used GitHub-hosted runners with the restored secrets.
It is the honest full-workflow baseline even though it failed. Do not compare a
self-hosted secret-free result only to the skipped 590-second result.

Run [33283092691](https://github.com/OpenDevEd/openalex-count/actions/runs/33283092691)
ran the real Clerk suite: five tests passed and the Evidence Library
configuration flow timed out after three attempts. Both required artifact
uploads then failed because the organization artifact quota was full. Run
[33283770731](https://github.com/OpenDevEd/openalex-count/actions/runs/33283770731)
proved the deployment-scoped Convex key works, then failed schema validation
because `formal-rabbit-271` still contains a `creditTransactions.balanceAfter`
field removed by commit `105ba308`.

The organization artifact inventory found no OpenScholar artifacts. Eight
expired `OpenDevEd/oneatatime` release artifacts still total 1,127,845,193
bytes. Removing another repository's release output is not part of this task.

### Live runner capacity

Runner group 6 is `Evidence Library CI`, selected only for
`OpenDevEd/new-el`. Its five runners are production CI infrastructure.

The `new-el-ci` guest has 24 vCPUs and 48 GiB RAM. Four light runners have an
8 GiB limit each and measured peaks from 4.92 to 5.05 GiB. The runtime runner
and its rootless Docker slice use CPUs 8 through 23; the slice peaked at
28.9 GiB. These limits do not leave a hard simultaneous OpenScholar allowance.
Keep that guest and group unchanged.

The Hetzner host has 48 CPUs, 251 GiB RAM, and 1.8 TiB root storage. A separate
8-vCPU, 16-GiB sparse guest keeps 16 host CPUs and more than 180 GiB host RAM
outside the two CI guests at their assigned maximums.

## Job trust table

| Job | Trigger | Secrets and outside services | Code trust | Runner | CPU and memory | Persistent state |
|---|---|---|---|---|---|---|
| Unit and contract tests | Same-repo PR; push to `dev` or `main` | Placeholder Clerk and Convex values only | Same-repo branch code, no secrets | `OpenScholar CI`, `openscholar-light` | 4 CPU, 6 GiB max | Own account, workdir and npm cache |
| Production build | Same as unit | Placeholder values only | Same-repo branch code, no secrets | Second `openscholar-light` runner | 4 CPU, 6 GiB max | Separate account and workdir; public Next cache key |
| Clerk auth E2E | Same-repo PR; push to `dev` or `main` | Clerk secret, test user, public Convex URL | Same-repo code that already receives these secrets | `ubuntu-latest` until a full hosted baseline passes | GitHub-hosted | GitHub-hosted workspace only |
| Required live billing | Same-repo PR; push to `dev` or `main` | Convex dev deployment, Stripe test, Clerk test | Same-repo code; pushes current Convex code and mutates test rows | `ubuntu-latest` until a full hosted baseline passes | GitHub-hosted | Shared test user protected by job concurrency |
| Extended billing | Direct push to `dev` or `main` | Same as required billing | Integration branch code | `ubuntu-latest` until a full hosted baseline passes | GitHub-hosted | Same billing concurrency group; current non-blocking result kept |
| Nightly billing | Schedule or manual dispatch | Same as required billing | Default-branch workflow code | `ubuntu-latest` until a full hosted baseline passes | GitHub-hosted | Same billing concurrency group; blocking nightly result |
| Aggregate `CI` | Same-repo PR; push to `dev` or `main` | None | Immutable workflow only | `openscholar-light` | Small shell check | No checkout or cache |
| Fork pull request | Disabled by repository setting | No secrets | Fork code | No runner. If later enabled, immutable workflow selects `ubuntu-latest` | GitHub-hosted | No self-hosted state |

No job receives a host SSH key, Coolify token, host Docker socket, production
Convex credential, or another repository's credential. The two provisioned
secret runners receive no jobs in this plan revision.

## Design

### 1. Restore an honest hosted baseline

Create these repository Actions secrets from the checked
`/Users/mcharrad/Documents/Github/openscholar/dev-cloud/.env.local` file:

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`,
`NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`,
`CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`,
`E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`, `CONVEX_DEPLOYMENT`,
`STRIPE_SECRET_KEY`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, and
`CREDITS_PER_USD`.

The first full hosted run, [33283092691](https://github.com/OpenDevEd/openalex-count/actions/runs/33283092691),
proved that `CONVEX_DEPLOYMENT` selects the deployment but does not authorize
the billing command's `npx convex run --push`. Create one deployment-scoped
key named `openscholar-github-ci-20260830` for `formal-rabbit-271`, store it as
the repository Actions secret `CONVEX_DEPLOY_KEY`, and pass it only to billing
jobs. Do not use a personal account token or a project-wide key.

Do not set `CONVEX_DEPLOYMENT_NAME`. The checked environment already names
`dev:formal-rabbit-271`, and its read-only Stripe and Convex preflight passed.

Push only the committed plan and open the PR to `dev`. Record the first complete
GitHub-hosted run and one rerun. Both auth and billing must execute. A skip is a
failed baseline. The resulting failures are recorded above; do not move those
jobs until an unchanged hosted rerun passes.

### 2. Create the isolated guest

Create `openscholar-ci` from a fresh Ubuntu 24.04 cloud image. Do not clone
`new-el-ci`.

| Setting | Value |
|---|---|
| vCPU | 8, host CPU model |
| RAM | 16 GiB, no balloon overcommit target |
| Disk | 160 GiB sparse qcow2 |
| Network | libvirt NAT, virtio, no forwarded port |
| Admin access | SSH from `192.168.122.1` only |
| Runner CPU pool | guest CPUs 0 through 7 |
| Runner aggregate | `openscholar-ci.slice`, 800% CPU, 14 GiB memory |

Install the current GitHub Actions runner version with its published checksum,
Node 22, Git, and the Linux packages selected by
`playwright@1.58.2 install-deps chromium`. System tools are root-owned. Do not
install Docker, a deployment CLI credential, or a shared writable tool path.

Copy the checked `ci_guard` firewall shape from `new-el-ci`: allow loopback,
established traffic, DHCP, DNS, ICMP, and SSH from the libvirt host. Reject the
host public address, private ranges, Docker ranges, link-local ranges, and cloud
metadata. Allow public HTTPS for GitHub, npm, Clerk, Convex, Stripe, and browser
downloads.

Create four locked-down accounts and services:

| Runner | Account | Group | Label | CPU quota | Memory max |
|---|---|---|---|---:|---:|
| `openscholar-ci-light-1` | `gha-os-light-1` | `OpenScholar CI` | `openscholar-light` | 400% | 6 GiB |
| `openscholar-ci-light-2` | `gha-os-light-2` | `OpenScholar CI` | `openscholar-light` | 400% | 6 GiB |
| `openscholar-ci-secret-1` | `gha-os-secret-1` | `OpenScholar Secret CI` | `openscholar-secret` | 400% | 6 GiB |
| `openscholar-ci-secret-2` | `gha-os-secret-2` | `OpenScholar Secret CI` | `openscholar-secret` | 400% | 6 GiB |

Each account has its own home and runner work directory, mode `0750`, and no
sudo or Docker group. Put all four services in `openscholar-ci.slice` so four
overlapping runs cannot exceed the guest's 8-CPU and 14-GiB runner allowance.

### 3. Make the runner workflow immutable

Add `.github/workflows/ci-jobs.yml` with `workflow_call`. It directly defines
all self-hosted jobs. Commit it before the caller workflows refer to it.

Pin `.github/workflows/ci.yml` and `billing-nightly.yml` to the full commit SHA
that first contains `ci-jobs.yml`. The runner groups allow only:

`OpenDevEd/openalex-count/.github/workflows/ci-jobs.yml@<full SHA>`

Both groups use selected-repository access for repository ID `959785076`, deny
public repositories, and set `restricted_to_workflows: true`. Only
`OpenScholar CI` is active in the workflow. `OpenScholar Secret CI` stays
restricted and idle. A pull request may edit the caller, but it cannot edit the
workflow that GitHub allows onto the active runners.

The immutable workflow chooses `ubuntu-latest` when a pull-request head
repository differs from `github.repository`. This is a second fork guard. The
current private-fork setting remains disabled.

### 4. Keep the checks and shorten the path

In `ci-jobs.yml`:

1. Run unit tests and the production build as a two-entry matrix on the two
   light runners.
2. Make auth and required billing need the whole matrix. Keep them parallel on
   separate GitHub-hosted runners.
3. Keep billing concurrency named `billing-live-shared-test-user` with
   `cancel-in-progress: false`.
4. Keep the existing extended and nightly order, timeouts, artifact paths,
   artifact names, `if: always()` rules, and the existing `continue-on-error`
   only on push extended billing.
5. Add `CI`, with `if: always()`, which fails unless every required lane passed.

Every job uses the current full action SHAs already proven in `new-el/main`:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020`
- `actions/cache@caa296126883cff596d87d8935842f9db880ef25`
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`

Use `npm ci --prefer-offline --no-audit --no-fund`. The separate self-hosted
accounts keep independent npm caches; do not upload the roughly 400 MiB npm
cache for each pull-request head. Hosted secret jobs may use setup-node's npm
cache because their disks are ephemeral.

The first public Next cache was 291,962 bytes. The next build restored it by
prefix, saved 291,999 bytes, and took 152 seconds instead of 145 seconds. Remove
the public and secret Next cache steps. They added work without a measured win.

For same-repository pull requests, a missing auth or billing secret is an
error. Only a fork event may keep the current no-secret skip path.

Add `dev` beside `main` in the push trigger. Do not remove `main`.

### 5. Measure before keeping a build setting

The installed Next.js guide confirms that CI should persist `.next/cache`.
Production Turbopack filesystem caching is still marked experimental in this
installed version.

The cache A/B result above did not meet the gate, so do not change
`next.config.ts` or enable experimental Turbopack filesystem caching. Vitest's
installed CLI and official guide state that it uses every available CPU by
default. The guest exposes eight CPUs while each runner is capped at four. The
first static run passed 4,389 tests but one five-second test timed out. Set the
CI command to `npm run test -- --maxWorkers=4`, then require two passing runs.

## Files that change

- `plans/openscholar-self-hosted-ci/00-README.md`
- `plans/openscholar-self-hosted-ci/01-runner-and-workflow.md`
- `.github/workflows/ci-jobs.yml` new, immutable reusable workflow
- `.github/workflows/ci.yml`
- `.github/workflows/billing-nightly.yml`
- `next.config.ts` only if the A/B gate above passes

No test file, test assertion, package, lockfile, application route, Convex
function, or deployment configuration changes.

## Checks

### Static checks

- Run checksum-verified current `actionlint` on all workflow files.
- Parse the YAML and inspect every external `uses:` value for a 40-character
  commit SHA.
- Search the exact tree for `ubuntu-latest`, mutable action tags, old branch
  triggers, obsolete runner names, and stale CI instructions. The only allowed
  `ubuntu-latest` value is the immutable fork fallback.

### Runner checks

- Read both runner groups back through the GitHub API. Confirm repository ID,
  immutable selected workflow, public denial, runners, labels, online state,
  and idle state.
- Read every service account, home, workdir, slice, CPU quota, memory limit,
  service state, and runner version.
- From each trust account, prove the other trust homes cannot be read.
- Prove the host address, private networks, Docker networks, and metadata are
  blocked. Prove GitHub, npm, Clerk, Convex, and Stripe public endpoints are
  reachable.
- Prove no runner account has sudo, Docker, Coolify, host mounts, or stored
  repository secrets.

### GitHub workflow checks

Run the complete workflow on the final exact head and record:

- run ID, URL, head SHA, created, started, and completed timestamps;
- dispatch or dependency delay for every job;
- every job and step duration;
- runner name, runner group, and labels for every job;
- whether each auth and billing step ran;
- artifact names, sizes, and download success;
- npm, browser, and Next cache hit or miss and bytes;
- guest CPU use, service CPU time, memory peak, disk before and after;
- the `CI` result for the exact head.

Run the self-hosted static matrix twice on the same exact head to record cold
and warm timing. A full green exact-head run remains blocked until the hosted
jobs pass and GitHub accepts their required artifacts. Do not claim the full
workflow is green from the static matrix result.

Create one harmless fork pull request to this branch. Confirm the repository
fork setting creates no workflow run. Also read the runner group policy and
show that only the immutable workflow SHA has access. Close the proof PR after
recording the links.

### Host checks

Before and after the concurrent gate, confirm:

- host Docker service is active;
- 146 pre-existing containers remain running unless the live baseline changed
  before this work;
- every health-marked container is healthy;
- the Coolify, database, Redis, realtime, proxy, and sentinel containers are
  healthy;
- `new-el-ci` runners remain online and its BuildKit builder remains present.

## Deployability gate

This plan changes workflows and runner infrastructure, not `convex/`, `app/`,
or `components/`.

The gate is:

1. checksum-verified `actionlint` passes;
2. one cold and one warm self-hosted static matrix result on the final exact
   head;
3. auth, required live billing, and billing E2E execute rather than skip and
   remain visibly blocking when they fail;
4. every job lands on its approved runner boundary;
5. the concurrent `new-el` reference run passes;
6. the host and both guests stay healthy.

## Review

Run the one read-only phase review required by [`AGENTS.md`](../../AGENTS.md)
after implementation and preliminary measurements. Fix valid findings, then
run the final exact head twice as required by this task.

## Rollback

1. Change the two callers back to the last hosted workflow from `origin/dev`.
2. Rerun the hosted workflow and require its full credentialed result.
3. Remove the four runners from GitHub, then stop their services.
4. Delete only the two new OpenScholar runner groups and the
   `openscholar-ci` guest after confirming no job is busy.
5. Keep the restored GitHub test secrets unless the integration owner asks to
   remove them. They fix an existing false-green CI defect.

Never delete group 6, stop a `new-el-ci` runner, or change a Coolify resource as
part of rollback.

## Completion rules

- The plan commit predates every workflow and infrastructure change.
- The PR targets `dev` and is not merged.
- A real GitHub-hosted full baseline exists.
- The static self-hosted matrix passes twice on the final exact head.
- `01-BLOCKER.md` states why the full exact head cannot be green twice and the
  exact integration-owner actions needed to unblock it.
- Every old artifact and failure rule still works.
- Forks cannot reach either self-hosted group.
- `new-el` run 33281691193 still passes during the warm proof.
- Before and after timings come from GitHub run IDs, not estimates.
- The final report gives the PR URL, head SHA, timing table, runner layout,
  proof links, hosted remainder, and any integration-owner step.

## Known risks

- Auth and billing use one Clerk test user. Keep their current behavior and
  watch for a real race. Do not change tests during this migration.
- Live billing pushes the tested commit to the checked Convex Cloud dev
  deployment and mutates Stripe test data. The shared billing concurrency key
  must remain uncancelled.
- Persistent runners keep state. Immutable workflow access, repository-only
  groups, separate accounts, no sudo, no Docker, bounded slices, and blocked
  private networks limit that risk. They do not make the machines ephemeral.
- Adding a second guest uses host CPU time. The concurrent final gate decides
  whether the fixed layout is acceptable. If either repository or Coolify
  fails under that load, keep secret jobs GitHub-hosted, write
  `01-BLOCKER.md`, and stop.
- The current hosted secret checks fail independently of runner choice. Do not
  route them to `OpenScholar Secret CI` until the same unchanged checks pass on
  `ubuntu-latest` and required artifact uploads succeed.
