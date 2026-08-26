# Plan 05 — Real page shell, Identity, Theme, Institutions (OpenScholar)

Lane C, after plan 02 is on `dev`. Plan 03 may land during this work; until
then upload fields save URLs.

## Goal

Replace `evidence-library-configuration-shell.tsx` with the mock's page,
backed by Convex, for the Brand group.

## Scope

1. Copy the mock into `components/evidence-libraries/configuration/`:
   `fields.tsx`, `section-shell.tsx`, `panel-header.tsx`, `section-card.tsx`,
   `library-status-badge.tsx`, `use-scroll-spy.ts`, the rail and workspace,
   and the section files for Identity, Theme, Institutions. Delete the old
   shell and its tests; keep their behaviours as new tests where they still apply.
2. State: the page loads `getDraft` (all section rows) into one draft object
   (`useState`, keyed on draft id and edit version). `patch()` edits the
   local draft; Save sends only the sections whose payload changed; Activate
   saves then activates. Rail dots, chips and inline problems come from
   `lib/evidence-libraries/configuration/rules.ts` (port of the mock's
   `sectionProblems`, one rule set per section). No autosave, no `useEffect`.
3. Sections stay hidden when a runtime section is not yet exposed; the rail
   lists only sections this version supports (README decision 1).
4. Identity: name, short name (fixed), address (fixed), tagline, description,
   funding partners, share image. Theme: navbar choice (the two illustrations),
   default mode, fonts, logos and favicon, accent/secondary/link colours with
   presets and contrast check, advanced colours. Institutions: name picked
   from `listRecordInstitutions` (lane B, plan 07; until it lands, a text
   input), logo upload.
5. Header: back chevron, name, address, Unsaved chip, Update available button
   (plan 04 query; hidden until it exists), Save, Activate, activation banner.
6. Assembly issues from the operation are shown at the top of the page as a
   danger notice listing pointer + message, each pointing to its section.
7. `messages/*.json`: move the mock keys under `evidenceLibraryConfiguration`;
   English copy in all locale files as the repo does today.

## Tests

- `rules.test.ts`: each section rule (test-first, pure).
- Component tests (`tests/components/evidence-library-configuration-*.test.tsx`):
  save sends only changed sections; a section with a problem shows "Needs
  attention" and blocks Activate; Reset restores the saved payload; fixed
  values are read-only; the Theme navbar choice writes `theme.layout`.

## Deployability gate

`npm run dev:web` on port 3013 against the lane deployment: open a library's
configuration page signed in, edit Identity and Theme, Save, Activate; the
lane logs show the publish operation; no compile error.

## Completion

PR to `dev` replacing the shell. Screenshots of the three sections in the PR.

## Risks

- The mock's `patch()` mutates a cloned draft; keep that contract so section
  files port unchanged.
- Scroll-spy uses a browser scroll listener (allowed effect); keep the
  justification comment.
