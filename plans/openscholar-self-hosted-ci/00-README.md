# OpenScholar self-hosted CI

Move all same-repository OpenScholar CI to fixed self-hosted runners, restore
the live checks that GitHub previously skipped, and shorten the workflow
without removing a check or artifact.

Decided with the user on 2026-08-30. Evidence checked on 2026-08-30.

## The problem

Before this work, the workflow ran on paid GitHub runners. It ran pull requests
and pushes to `main`, but not pushes to the active integration branch `dev`.

Recent successful pull-request runs take 590 to 876 seconds. Those totals are
misleading. GitHub has no repository, organization, or environment secrets for
this repository, so all 99 successful pull-request runs skipped the real Clerk
auth and live billing steps. The latest nightly run failed its secret check.

The main job also runs tests and the production build one after the other. A
credentialed pull request would repeat `npm ci` three times, repeat the Next.js
build three times, and run Playwright's Linux package installer twice.

## Fixed decisions

1. Keep `new-el-ci` and runner group 6 dedicated to `OpenDevEd/new-el`. Their
   measured limits leave no guaranteed slot for another simultaneous workload.
2. Create one fresh Ubuntu 24.04 KVM guest named `openscholar-ci` on the same
   Hetzner host. Give it 8 vCPUs, 16 GiB RAM, and a 160 GiB sparse disk.
3. Create separate `OpenScholar CI` and `OpenScholar Secret CI` runner groups.
   Both groups may serve only `OpenDevEd/openalex-count` and one immutable
   reusable workflow. They never share an account, home, work directory, npm
   cache, browser cache, or writable tool directory.
4. Run two secret-free jobs in parallel: unit and contract tests, and the
   production build. Run auth and required billing in parallel after both pass.
   Bind auth to `localhost:3000` and every billing browser job to
   `localhost:3001` so the two secret runners cannot collide in the shared
   guest network namespace. `localhost` keeps Next.js 16's internal Proxy path
   working while still listening only on loopback.
   Keep live billing, extended billing, and nightly billing in their existing
   shared concurrency group with cancellation off.
5. Keep fork pull-request workflows disabled at the repository setting. The
   immutable reusable workflow also skips every job before runner assignment if
   that setting changes later. A fork cannot edit the workflow that has access
   to the runner groups.
6. Restore the required dev-service secrets from the checked `dev-cloud`
   environment. Create one deployment-scoped Convex key for
   `formal-rabbit-271` because the live billing command pushes the tested
   functions before it runs. Store these only as GitHub Actions secrets.
   Runner disks contain no deployment credential after a job ends.
7. Pin every external action to a full commit SHA. Set workflow token access to
   `contents: read`.
8. Keep `npm ci`. Use `--prefer-offline --no-audit --no-fund`, but never cache
   `node_modules`. Preinstall Playwright's Linux packages in the guest, then let
   each job install the lockfile-selected Chromium with
   `playwright install chromium`.
9. Do not upload `.next/cache`. The first two self-hosted builds saved only
   about 292 KiB, and the restore-prefix run was seven seconds slower. Keep the
   runner-local npm caches separate through the existing accounts.
10. Add one blocking `CI` result for exact-head checks. It covers the static,
    auth, and required billing lanes. Extended billing stays outside that
    aggregate because its direct-push result is already non-blocking. Keep every
    current job, artifact name, timeout, validation, and that existing status.
11. Add `dev` to the push trigger without removing `main`. Run extended billing
    on direct pushes to either branch.
12. Reuse the repository alias in the live Vitest config so billing tests
    collect. Count only Stripe invoice grants in recurrence checks; the signup
    grant is a separate behavior. Keep every per-invoice assertion.
13. After the user authorized the repairs, delete every expired Actions
    artifact in the organization, remove the stale Convex fields from
    development data, preserve existing balances in the current ledger and
    counters, then route every same-repository secret job to `OpenScholar
Secret CI`. No OpenScholar job may use a paid GitHub runner.
14. Keep the full Clerk browser suite, including
    Reserve, Save, Preview, Activate, and revisit. Do not replace it with the
    smaller fixed-draft Save and reopen check. Activation now provisions a real
    runtime, and CI has no safe disposable provider environment. Record that
    exact conflict in `01-BLOCKER.md` and stop before claiming the pull request
    is complete. Route the blocked job to `openscholar-activation`, which has no
    runner today. A future runner must have its own OpenScholar-only account,
    work directory, providers, and network boundary. Never give an existing
    runner shared Coolify, database, storage, or production credentials.
    Set the required non-secret `EVIDENCE_LIBRARY_PLATFORM_DOMAIN` in the cloud
    dev deployment to the shared development value `opendev.space`; do not add
    an `EL_*` provisioning value.
15. Enable the existing `subscriptions.enabled`, `subscriptions.plan.go`, and
    `subscriptions.plan.pro` rows only in `formal-rabbit-271`. Their source
    defaults are already enabled. Keep Enterprise disabled. Put required
    artifact uploads after the billing commands so a full quota still fails
    the job without preventing the browser billing tests from running first.

## Plan

| Plan    | File                        | Work                                                                |
| ------- | --------------------------- | ------------------------------------------------------------------- |
| 01      | `01-runner-and-workflow.md` | Baseline, guest, runners, workflow, measurements, review, and proof |
| Blocker | `01-BLOCKER.md`             | Exact environment needed to restore the original activation check   |

## Dependencies

- Organization permission to create runner groups and registration tokens.
- SSH alias `hetzner` and libvirt access on that host.
- The current `dev-cloud/.env.local` values for the checked Clerk, Convex, and
  Stripe test environment.
- GitHub branch `dev` at
  `3bdcac5a5c7567e99e6c9c0cb5b01488cc6499ab` when this plan started.

## Existing work to reuse

- The fixed-runner layout and network rules on `new-el-ci`, inspected read-only.
  Reuse the Ubuntu, systemd, firewall, Node, and runner patterns. Do not clone
  its disk or copy its runner credentials.
- Evidence Library CI's full-SHA action pins and aggregate result at
  `OpenDevEd/new-el` commit
  `d26f4cd22fb77e7d8e4a0d070ac7a641189cf67b`.
- `scripts/billing-preflight.mjs` and the existing billing concurrency group.
- `playwright.config.ts`, which already builds production code and runs one CI
  worker for the stateful auth and billing suites.
- `convex/webhooks/projections.ts` and
  `convex/evidenceLibraries/mutations.ts`, which project Clerk state and expose
  the real reservation and activation paths used by the original browser test.
- Next.js 16.2.4's installed CI cache guide under
  `node_modules/next/dist/docs/01-app/02-guides/ci-build-caching.md`.

The dedicated `OpenScholar Secret CI` group and two secret runner accounts were
provisioned before the hosted baseline completed. They become active only after
the authorized artifact and Convex repairs pass their checks.

## Checks

Follow [`AGENTS.md`](../../AGENTS.md),
[`docs/agents/project.md`](../../docs/agents/project.md), and
[`docs/test-quality.md`](../../docs/test-quality.md). The test-decision gate
approved only the live-config alias and invoice-grant scope described above.
Run the unit, contract, auth, billing, extended billing, and browser checks.

Workflow checks must observe commands, exit status, artifacts, remote service
state, runner assignment, queue time, CPU, memory, cache bytes, and disk growth.
Do not add a source-text or CSS assertion.

## Data migration

The development Convex deployment needed a temporary widen, migrate, and
narrow repair before billing could execute. The migration removed 2,110 stale
transaction snapshots, converted 14 legacy credit rows to the current anchor
shape, preserved all 15 balances in the ledger and sharded counters, and filled
170 queue owners from their required extraction job. No migration code or
compatibility field remains in the pull request.

The same deployment had its subscription master, Go, and Pro flags stored as
disabled even though the current source defaults them to enabled. Enable those
three deployment rows so the real extended billing suite can exercise plan
changes. This is a development-only configuration repair, not a schema or code
migration.

## Sources

- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub runner groups](https://docs.github.com/en/actions/concepts/runners/runner-groups)
- [GitHub runner-group access](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
- [GitHub dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [GitHub fork events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Playwright CI guide](https://playwright.dev/docs/ci)
- Installed Next.js CI build-cache guide named above
- Installed Next.js CLI guide at
  `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`
- `plans/evidence-library-configuration-v2/17-build-once-runtime-image.md`
