# Plan 01: move and shorten OpenScholar CI

## Goal

Run all same-repository OpenScholar CI on isolated fixed runners, keep fork code
off every runner, restore every live check, and record a real before-and-after
result from GitHub.

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
field removed by commit `105ba308`. The first widened-schema upload then found
the rest of the stale rollout: 14 of 15 `credits` rows still use the old
`freeBalance`, `paidBalance`, `lifetimeUsed`, and `lastUpdatedAt` columns, and
14 rows have no `createdAt`. The table has 15 rows and the transaction table
has 4,569 rows, of which 2,110 retain `balanceAfter`. The next schema check
found 170 of 431 `extractionPaperQueue` rows without the now-required `userId`.
All 170 belong to one existing extraction job, whose `userId` is present.

The organization artifact inventory found no OpenScholar artifacts. Eight
expired `OpenDevEd/oneatatime` release artifacts still total 1,127,845,193
bytes. The user authorized deleting exactly those eight expired artifacts on
2026-08-30. GitHub reports zero remaining artifacts in that repository after
the deletion.

The first all-self-hosted run reached the real billing command, but
`vitest.live.config.ts` could not resolve the repository's existing `@/`
imports and collected zero tests. Reusing the alias from the main and
performance Vitest configs made all five required tests execute. The
recurrence check then counted the separate signup grant as an invoice grant.
The test-decision gate approved narrowing that assertion to grants with a
Stripe invoice ID while keeping every per-invoice idempotency check. The exact
required suite then passed locally: five tests in 91.52 seconds against
`formal-rabbit-271` and Stripe test mode.

Final candidate run
[33287588678](https://github.com/OpenDevEd/openalex-count/actions/runs/33287588678)
showed that binding Next.js 16.2.4 to the numeric address breaks this
repository's `proxy.ts` request path. Next repeatedly tried to proxy the health
request back to `http://localhost:3000/` and Playwright reached its five-minute
web-server timeout before collecting auth tests. The same production build
returned HTTP 200 when started with `--hostname localhost`; the process listened
only on the loopback interface. Keep the separate ports, but use the hostname
Next expects.

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
| Production build | Same as unit | Placeholder values only | Same-repo branch code, no secrets | Second `openscholar-light` runner | 4 CPU, 6 GiB max | Separate account, workdir, and npm cache |
| Clerk auth E2E | Same-repo PR; push to `dev` or `main` | Clerk secret, test user, public Convex URL | Same-repo code that already receives these secrets | `OpenScholar Secret CI`, `openscholar-secret` | 4 CPU, 6 GiB max | Secret account only; secret browser and npm cache |
| Required live billing | Same-repo PR; push to `dev` or `main` | Convex dev deployment, Stripe test, Clerk test | Same-repo code; pushes current Convex code and mutates test rows | Second `openscholar-secret` runner | 4 CPU, 6 GiB max | Separate secret account; shared test user protected by job concurrency |
| Extended billing | Direct push to `dev` or `main` | Same as required billing | Integration branch code | Either secret runner | 4 CPU, 6 GiB max | Same billing concurrency group; current non-blocking result kept |
| Nightly billing | Schedule or manual dispatch | Same as required billing | Default-branch workflow code | Either secret runner | 4 CPU, 6 GiB max | Same billing concurrency group; blocking nightly result |
| Aggregate `CI` | Same-repo PR; push to `dev` or `main` | None | Immutable workflow only | `openscholar-light` | Small shell check | No checkout or cache |
| Fork pull request | Disabled by repository setting | No secrets | Fork code | No runner. Every reusable-workflow job has a same-repository guard | None | None |

No job receives a host SSH key, Coolify token, host Docker socket, production
Convex credential, or another repository's credential.

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
jobs until the authorized repairs below pass.

Delete only expired artifact IDs `6832729991`, `6832689523`, `6781401513`,
`6781368933`, `6761504640`, `6761495260`, `6761431240`, and `6761420490` from
`OpenDevEd/oneatatime`. Verify that repository then reports zero artifacts.

Repair `formal-rabbit-271` with widen, migrate, then narrow. Preserve each
legacy row's current free and paid balance by adding the exact difference
between those values and its ledger sums before removing the old columns:

1. Confirm no other Convex uploader is running.
2. In a temporary isolated worktree from the current source tree, widen
   `creditTransactionFields` for optional `balanceAfter`. Widen `creditsFields`
   for optional `createdAt`, `freeBalance`, `paidBalance`, `lifetimeUsed`, and
   `lastUpdatedAt`.
3. Add a paginated internal migration. For each legacy `credits` row, sum its
   free and paid transaction amounts. Insert one signed migration transaction
   per non-zero difference so the ledger equals the stored balances. Use
   `grant` for a positive difference and `usage` for a negative difference.
   Rebuild both sharded counters from that corrected ledger, set `createdAt` to
   the row's `_creationTime` when missing, then remove the four old fields.
   Separately remove every transaction `balanceAfter`. Reuse the repository's
   existing cursor and scheduler pattern. Also fill each missing
   `extractionPaperQueue.userId` from its required owning extraction job; stop
   instead of guessing if any owning job is missing.
4. Deploy the widened schema using the checked `dev-cloud/.env.local`. Run the
   read-only audit, then the real migration. Verify all 15 anchor rows, all
   ledger sums, both sharded counters, and the count of remaining removed
   fields before narrowing.
5. Deploy the unchanged final branch schema. Convex accepting that narrow
   schema proves no stored row retains any removed field.
6. Remove the temporary worktree. Do not add migration code or a compatibility
   field to the final pull request.

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
whose `ci-jobs.yml` the runner groups allow. The runner groups allow only:

`OpenDevEd/openalex-count/.github/workflows/ci-jobs.yml@<full SHA>`

Both groups use selected-repository access for repository ID `959785076`, deny
public repositories, and set `restricted_to_workflows: true`. A pull request
may edit the caller, but it cannot edit the workflow that GitHub allows onto
the runners.

Every job in the immutable workflow requires a same-repository event. A fork
event receives no runner. The current private-fork setting remains disabled.

### 4. Keep the checks and shorten the path

In `ci-jobs.yml`:

1. Run unit tests and the production build as a two-entry matrix on the two
   light runners.
2. Make auth and required billing need the whole matrix. Keep them parallel on
   the two secret runners.
3. Bind the auth web server to `localhost:3000`. Bind required, extended, and
   nightly billing web servers to `localhost:3001`. This prevents a port clash,
   keeps both test servers off the guest's libvirt interface, and lets Next.js
   16 route Proxy requests through its expected localhost name.
4. Keep billing concurrency named `billing-live-shared-test-user` with
   `cancel-in-progress: false`.
5. Keep the existing extended and nightly order, timeouts, artifact paths,
   artifact names, `if: always()` rules, and the existing `continue-on-error`
   only on push extended billing.
6. Add `CI`, with `if: always()`, which fails unless the static, auth, and
   required billing lanes passed. Do not make it wait for or validate the
   non-blocking extended lane.

Every job uses the current full action SHAs already proven in `new-el/main`:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020`
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`

Use `npm ci --prefer-offline --no-audit --no-fund`. The separate self-hosted
accounts keep independent npm caches; do not upload the roughly 400 MiB npm
cache for each pull-request head. Secret jobs use their separate runner-local
npm caches.

The first public Next cache was 291,962 bytes. The next build restored it by
prefix, saved 291,999 bytes, and took 152 seconds instead of 145 seconds. Remove
the public and secret Next cache steps. They added work without a measured win.

For same-repository pull requests, a missing auth or billing secret is an
error. Fork events skip every job before runner assignment.

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
- `.github/actionlint.yaml`
- `.github/workflows/ci-jobs.yml` new, immutable reusable workflow
- `.github/workflows/ci.yml`
- `.github/workflows/billing-nightly.yml`
- `README.md`
- `vitest.live.config.ts`
- `tests/live-billing/support.ts`
- `tests/live-billing/required.test.ts`
- `tests/live-billing/extended.test.ts`
- `next.config.ts` only if the A/B gate above passes

No package, lockfile, application route, Convex function, or deployment
configuration changes remain in the pull request. The live-test loader and
invoice-grant assertions change only as recorded above.

## Checks

### Static checks

- Run checksum-verified current `actionlint` on all workflow files.
- Parse the YAML and inspect every external `uses:` value for a 40-character
  commit SHA.
- Search the exact tree for `ubuntu-latest`, mutable action tags, old branch
  triggers, obsolete runner names, and stale CI instructions. No
  `ubuntu-latest` value is allowed.

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

Run the complete workflow twice on the final exact head and record:

- run ID, URL, head SHA, created, started, and completed timestamps;
- dispatch or dependency delay for every job;
- every job and step duration;
- runner name, runner group, and labels for every job;
- whether each auth and billing step ran;
- artifact names, sizes, and download success;
- npm, browser, and Next cache hit or miss and bytes;
- guest CPU use, service CPU time, memory peak, disk before and after;
- the `CI` result for the exact head.

The first final run is cold and the second is warm. Both must be fully green.

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

This plan changes workflows, runner infrastructure, and development Convex
data. The temporary migration code is not part of the final tree.

The gate is:

1. checksum-verified `actionlint` passes;
2. the narrowed final schema deploys to `formal-rabbit-271` with no validation
   error;
3. one cold and one warm complete workflow pass on the final exact head;
4. auth, required live billing, and billing E2E execute rather than skip;
5. every job lands on its approved runner boundary;
6. the concurrent `new-el` reference run passes;
7. the host and both guests stay healthy.

## Review

Run the one read-only phase review required by [`AGENTS.md`](../../AGENTS.md)
after implementation and preliminary measurements. Fix valid findings, then
run the final exact head twice as required by this task.

## Rollback

1. Pin both callers and both runner groups to the last fully green immutable
   self-hosted workflow SHA.
2. If no safe immutable workflow exists, disable the affected trigger until a
   self-hosted repair is ready. Do not return any job to a paid GitHub runner.
3. Rerun the exact self-hosted workflow and require its full credentialed
   result.
4. Remove a runner or guest only after every assigned job is idle and a
   replacement self-hosted boundary is ready.
5. Keep the restored GitHub test secrets unless the integration owner asks to
   remove them. They fix an existing false-green CI defect.

Never delete group 6, stop a `new-el-ci` runner, or change a Coolify resource as
part of rollback.

## Completion rules

- The plan commit predates every workflow and infrastructure change.
- The PR targets `dev` and is not merged.
- A real GitHub-hosted full baseline exists.
- The final exact head is green twice with every live check executed.
- Every old artifact and failure rule still works.
- Forks cannot reach either self-hosted group.
- `new-el` run 33281691193 still passes during the warm proof.
- Before and after timings come from GitHub run IDs, not estimates.
- The final report gives the PR URL, head SHA, timing table, runner layout,
  proof links, hosted remainder, and any integration-owner step.
- The integration owner changes branch protection to require only the
  aggregate `ci / CI` check after the final exact-head proofs pass.

## Known risks

- Auth and billing use one Clerk test user. Keep their current behavior and
  watch for a real race. The only test changes are the loader and focused
  invoice-grant assertion described in the evidence section.
- Live billing pushes the tested commit to the checked Convex Cloud dev
  deployment and mutates Stripe test data. The shared billing concurrency key
  must remain uncancelled.
- Persistent runners keep state. Immutable workflow access, repository-only
  groups, separate accounts, no sudo, no Docker, bounded slices, and blocked
  private networks limit that risk. They do not make the machines ephemeral.
- Adding a second guest uses host CPU time. The concurrent final gate decides
  whether the fixed layout is acceptable. If either repository or Coolify
  fails under that load, stop and revise the fixed self-hosted capacity. Do not
  fall back to paid GitHub runners.
- GitHub may take several hours to recalculate artifact storage after deletion.
  Keep the required uploads unchanged and rerun after storage accepts them.
- GitHub concurrency keeps only one running and one pending billing job. If a
  third run cancels the pending job, rerun that same head after the active
  billing job finishes.
