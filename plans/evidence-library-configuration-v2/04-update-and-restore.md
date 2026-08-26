# Plan 04 — Evidence Library updates and Restore (OpenScholar)

Lane A, after plan 02.

## Goal

An owner sees when new Evidence Library software is available and updates
with one click; an owner can restore a previous version.

## Scope

1. Runtime binding gains `runtimeCommit` (40-hex). Written by setup and by
   every completed publish (from `receipt.runtimeCommit`).
2. Action `evidenceLibraries.updates.check({ libraryId })`: reads
   `https://api.github.com/repos/OpenDevEd/new-el/commits/main` and, when it
   differs from `runtimeCommit`, `compare/<running>...<latest>` for the commit
   messages. Result cached in table `evidenceLibraryRuntimeReleases`
   (`running`, `latest`, `checkedAt`, `changes`) for ten minutes, one row per
   running commit because the change list depends on it. Returns
   `{ running, latest, changes, checkedAt }`. Called when the configuration
   page opens. No cron. `OpenDevEd/new-el` is a private repository, so the
   deployment needs `GITHUB_TOKEN` (a token that can read that repository);
   without it GitHub answers 404. The pure fetch helper lives in
   `runtimeReleases.ts`; an internal action `updates.refresh({ running })`
   shares it so the lane can be checked with `npx convex run` without a
   signed-in owner.
3. Coolify client: `setApplicationCommit(uuid, sha)` (writes `git_commit_sha`);
   the publish target guard accepts an explicit `targetCommit`.
4. Mutation `startRuntimeUpdate({ libraryId })` (owner check): creates a
   publish operation with `kind: "publish"`, `runtimeUpdate: { from, to }`,
   using the current active revision's sections; the pipeline sets the commit,
   then deploys as usual. `to` comes from the fresh release row for the
   running commit, so the owner checks first. The operation has no
   `activationEditVersion` because no draft edit happened; the pipeline
   recognises a deployment operation as `kind: "publish"` with either
   `activationEditVersion` or `runtimeUpdate`. Version rows (revision history
   query) expose `kind: "runtime" | "config"`.
5. Restore: `restoreRevision({ libraryId, revisionId })` copies that
   revision's section rows into a new revision with `rollbackOfRevisionId`,
   replaces the draft rows with the same sections (so the draft matches what
   goes live and "Reset changes" reads it), then runs the normal publish. The
   runtime rejects a non-newer revision, so the copy gets a new `revision`
   key and `updatedAt`.
6. Query `listVersions({ libraryId })`: one row per setup or publish
   operation, newest first: `{ operationId, revisionId, revisionKey,
   createdAt, by, changedSections, status: live | previous | failed |
   deploying, kind }`. `deploying` covers queued and running rows so the page
   does not lose the row that is in progress.

## Tests

- `updates.test.ts`: cache hit within ten minutes, miss after; no update when
  commits match; change list parsed from the compare response (HTTP mocked).
- `coolifyClient.test.ts`: `setApplicationCommit` writes `git_commit_sha`
  and reads it back; a no-op when the commit already matches.
- `versions.test.ts`: runtime update op carries `from/to`; restore creates a
  revision with `rollbackOfRevisionId` and identical section payloads;
  `listVersions` marks rows live, previous, failed and deploying.
- `configurationDeployment.test.ts` (reuses its Coolify network mock): a
  runtime update sets the commit before writing the configuration, deploys at
  the new commit, and completion writes `runtimeCommit` to the binding.

## Deployability gate

`npx convex dev --once` on the lane; `updates.refresh` on the lane returns
the real latest commit and change list from the GitHub API for the lane's
`EL_RUNTIME_COMMIT_SHA`. This lane does not create Coolify libraries or
start real deployments: the runtime update and restore pipelines are proven
with the convex-test suites (Coolify client mocked). The live redeploy and
restore on a real development library are verified by the integration owner
on the shared deployment after merge.

## Risks

- GitHub API rate limit: the cache row keeps calls rare. `GITHUB_TOKEN` is
  required because the repository is private; set it on every deployment
  that runs the check.
- The runtime binding gains a required `runtimeCommit`, so existing
  development binding rows fail schema validation. Development data is
  disposable: wipe `evidenceLibraryRuntimeBindings` (and the libraries that
  point at them) on a deployment before uploading.
- Two owners clicking Update: `requireNoActiveConfigurationDeployment` already
  prevents parallel publishes.
