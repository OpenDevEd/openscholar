# Plan 17 blocker: Coolify leaves Compose volumes behind

Date: 2026-08-30

## What blocks completion

Deleting an Evidence Library removes its OpenScholar rows and Coolify
application, but Coolify 4.3.12 leaves the application's named Meilisearch
volume on the deployment host. Plan 17 cannot pass its cleanup gate while a
normal product deletion leaves library data behind.

## Live proof

The product deleted throwaways `el-gate-20260830a` and
`el-gate-20260830b`. Their Coolify applications returned 404, their public
addresses returned the expected unassigned 503, and neither library remained
in Convex. The host still contained:

```text
bkzrvd6c1sfzlwlb4w5xlkrg_meilisearch-data
8u7pgdwcpbnq0nrwiwxt5pft_meilisearch-data
```

The integration owner checked that both application UUIDs returned 404 and
that both library rows were gone, then removed those two exact throwaway
volumes manually. They cannot be recovered. No other container, volume or
application was touched.

## Root cause

OpenScholar already sends Coolify's documented deletion flags, including
`delete_volumes=true`. The provider's job order is wrong for Docker Compose:

1. The API soft-deletes the application and queues `DeleteResourceJob`.
2. The job calls `deleteConfigurations()` before `deleteVolumes()`.
3. `deleteConfigurations()` removes the application's Compose directory.
4. `deleteVolumes()` then runs `cd <that directory> && docker compose down -v`.
5. The job catches remote cleanup failures and force-deletes the Coolify row.

The exact 4.3.12 sources are
[`ApplicationsController.php`](https://github.com/coollabsio/coolify/blob/v4.3.12/app/Http/Controllers/Api/ApplicationsController.php#L2544-L2581),
[`DeleteResourceJob.php`](https://github.com/coollabsio/coolify/blob/v4.3.12/app/Jobs/DeleteResourceJob.php#L76-L103),
and
[`Application.php`](https://github.com/coollabsio/coolify/blob/v4.3.12/app/Models/Application.php#L489-L510).
The current Coolify main branch still uses the same order. The public API has
no endpoint that deletes an orphaned Docker volume by exact name.

OpenScholar also treats the application's immediate 404 as completion. That
only proves the soft-deleted Coolify row is hidden. It does not prove the
queued remote cleanup finished.

## What was tried

- Confirmed OpenScholar sends all four documented delete flags.
- Waited for the application to return 404 and checked the host afterward.
- Checked the current Coolify API, 4.3.12 source, current main source and
  application storage endpoints.
- Rejected a general SSH runner, a write-enabled Docker socket verifier and a
  global Docker cleanup. Each grants much more power than deleting one known
  library volume.
- Rejected `delete_configurations=false`. It can preserve the Compose file long
  enough for `down -v`, but then permanently leaves the application directory.

## What unblocks it

Fix Coolify's application deletion so it removes Compose volumes before the
Compose directory and reports remote cleanup completion before the application
becomes unverifiable. Then OpenScholar must wait for that completion result,
not an immediate application 404, and the live gate must prove the exact app,
volume and directory are gone.

This needs a change to the Coolify control plane or a new narrow cleanup API.
It is outside the two repositories in Plan 17. Do not hide it with an
OpenScholar SSH command or a privileged Docker proxy.
