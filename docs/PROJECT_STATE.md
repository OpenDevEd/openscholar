# Project state

Short notes on what is built on `dev`. Update this file when a sprint changes
what the app can do. Keep each note to what a reader needs to find the code.

## Evidence Library configuration page

Last updated: 2026-08-27, branch `codex/versions-section`, plan
`plans/evidence-library-configuration-v2/08-versions-team-and-cleanup.md`.

The page at `/evidence-libraries/[libraryId]/configuration` is
`components/evidence-libraries/configuration/configuration-workspace.tsx`.
It shows one card per section from `PAGE_SECTION_KEYS`
(`lib/evidence-libraries/configuration/rules.ts`), then three cards that are
not part of the draft:

- **Versions** (`sections/versions-section.tsx`). Shows the Evidence Library
  software the library runs (`evidenceLibraries.updates.check`: running
  commit, latest commit, when it was checked, what changed) with an Update
  button that confirms and calls `evidenceLibraries.versions.startRuntimeUpdate`.
  Below it, every published version from `evidenceLibraries.versions.listVersions`
  with Restore on previous and failed rows
  (`evidenceLibraries.versions.restoreRevision`). Update and Restore are off
  while a platform operation runs. Plain rules live in
  `lib/evidence-libraries/configuration/versions.ts`.
- **Team** (`sections/team-section.tsx`). Read-only: owners are admins of the
  Clerk organisation, editors are members. People are managed in the
  organisation settings.
- **Danger zone** (`sections/danger-section.tsx`). Delete the development
  library only.

The banner under the page header shows the running operation. It names a
software update ("Updating the Evidence Library software to …") and shows the
stage for a publish or a restore.

Tests: `tests/components/evidence-libraries/versions-section.test.tsx`,
`tests/components/evidence-library-configuration-workspace.test.tsx`,
`lib/evidence-libraries/configuration/versions.test.ts`.
