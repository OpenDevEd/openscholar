# Plan 08 — Versions section, Team panel, sprint cleanup (OpenScholar)

Lane B, after plan 04 and plan 07.

## Goal

The Versions section works against real revisions and updates; the Team
panel states the organisation rule; the sprint leaves nothing behind.

## Scope

1. Versions section: Evidence Library software panel (`updates.check` →
   running/latest/checked, change list, Update button with confirm →
   `startRuntimeUpdate`), and the version history table from `listVersions`
   with Restore (`restoreRevision`) on previous/failed rows. The activation
   banner handles both kinds.
2. Team panel (read-only this version): "Owners: admins of <organisation>.
   Editors: members. Manage people in the organisation settings." with a link
   to the Clerk organisation profile. No visibility toggle, no invites.
3. Danger zone: Delete only (existing teardown).
4. Documentation: `docs/agent-sprint-lessons.md` (what the two sprints
   taught: cleanup, no shared node_modules, never re-point dev-self, poll
   agents, keep write-sets disjoint); update Outline current state and
   decisions with commits and proof; `docs/PROJECT_STATE.md`.
5. Cleanup checklist, run by the integration owner and recorded in the PR:
   delete Convex Cloud lanes (`npx convex deployment delete ...`), remove
   worktrees (`git worktree remove`), no sprint containers left running
   (only containers this sprint created — `el-*` acceptance stacks; never
   touch the user's own containers such as `what2` or `minio`), no orphan
   `runSearchIndexer`, delete `components/evidence-libraries/mock/`,
   `lib/evidence-libraries/mock/`, `app/evidence-libraries/*` mock wrappers,
   and branch `feat/library-interface-mock` after the real page is on `dev`.

## Tests

- Component: Update button disabled while an operation runs; Restore opens
  the confirm and calls the mutation; the table marks the live row.

## Deployability gate

Shared deployment after merge: `npm run convex:push`, open a development
library, see the software panel with the real commit, run one Update, restore
one version; logs clean.
