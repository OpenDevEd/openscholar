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
   (`latest`, `checkedAt`, `changes`) for ten minutes. Returns
   `{ running, latest, changes, checkedAt }`. Called when the configuration
   page opens. No cron.
3. Coolify client: `setApplicationCommit(uuid, sha)` (writes `git_commit_sha`);
   the publish target guard accepts an explicit `targetCommit`.
4. Mutation `startRuntimeUpdate({ libraryId })` (owner check): creates a
   publish operation with `kind: "publish"`, `runtimeUpdate: { from, to }`,
   using the current active revision's sections; the pipeline sets the commit,
   then deploys as usual. Version rows (revision history query) expose
   `kind: "runtime" | "config"`.
5. Restore: `restoreRevision({ libraryId, revisionId })` copies that
   revision's section rows into a new revision with `rollbackOfRevisionId`,
   then runs the normal activation. The runtime rejects a non-newer revision,
   so the copy gets a new `revision` key and `updatedAt`.
6. Query `listVersions({ libraryId })`: `{ revisionKey, createdAt, by,
   changedSections, status: live | previous | failed, kind }`.

## Tests

- `updates.test.ts`: cache hit within ten minutes, miss after; no update when
  commits match; change list parsed from the compare response (HTTP mocked).
- `operations.test.ts`: runtime update op carries `from/to`; publish with an
  explicit commit calls `setApplicationCommit` before `updateApplicationConfiguration`
  (client mocked); completion writes `runtimeCommit` to the binding.
- Restore: new revision has `rollbackOfRevisionId` and identical section
  payloads; `listVersions` marks it live after completion.

## Deployability gate

`npx convex dev --once` on the lane; on a lane library, `updates.check`
returns the real latest commit; a runtime update deploys the development
library at the new commit (lane B tears it down afterwards); restore of a
previous revision goes live and the health endpoint reports its revision.

## Risks

- GitHub API unauthenticated rate limit (60/h per IP): the cache row keeps
  calls rare; add `GITHUB_TOKEN` to the deployment env if needed.
- Two owners clicking Update: `requireNoActiveConfigurationDeployment` already
  prevents parallel publishes.
