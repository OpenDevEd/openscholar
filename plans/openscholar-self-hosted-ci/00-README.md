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
10. Add one blocking `CI` result for exact-head checks. Keep every current job,
    artifact name, timeout, validation, and the existing non-blocking status of
    main-branch extended billing.
11. Add `dev` to the push trigger without removing `main`. Run extended billing
    on direct pushes to either branch.
12. Reuse the repository alias in the live Vitest config so billing tests
    collect. Count only Stripe invoice grants in recurrence checks; the signup
    grant is a separate behavior. Keep every per-invoice assertion.
13. After the user authorized the two repairs:
    delete the eight expired `OpenDevEd/oneatatime` artifacts, remove the stale
    Convex fields from development data, preserve existing balances in the
    current ledger and counters, then route every same-repository secret job to
    `OpenScholar Secret CI`. No OpenScholar job may use a paid GitHub runner.

## Plan

| Plan | File | Work |
|---|---|---|
| 01 | `01-runner-and-workflow.md` | Baseline, guest, runners, workflow, measurements, review, and proof |

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

## Sources

- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub runner groups](https://docs.github.com/en/actions/concepts/runners/runner-groups)
- [GitHub runner-group access](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
- [GitHub dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [GitHub fork events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Playwright CI guide](https://playwright.dev/docs/ci)
- Installed Next.js CI build-cache guide named above
- `plans/evidence-library-configuration-v2/17-build-once-runtime-image.md`
