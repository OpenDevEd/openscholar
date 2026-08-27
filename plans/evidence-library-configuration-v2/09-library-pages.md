# Plan 09 — Library list, new, setup and admin pages

## Goal

The four pages around the configuration page must look and behave like the
agreed mock on branch `feat/library-interface-mock` (commit `e7ad8929`):
the library list, the new-library page, the setup page and the admin page.
Today `dev` still shows the old new-library and admin pages, and has no list
or setup page at all. The user saw this live on 2026-08-27 and rejected it.

## Scope

1. `/evidence-libraries` — list page from the mock (`components/evidence-libraries/mock/library-list.tsx`,
   `library-status-badge.tsx`, `library-not-found.tsx`, `delete-library-dialog.tsx`),
   fed by the real Convex list query for the active organisation. Owner-only
   actions where the mock shows them; editors see the library and its `/admin` link only.
2. `/evidence-libraries/new` — the mock's `new-library-form.tsx` on the real
   reserve-address mutation and flow (`components/evidence-libraries/create-evidence-library-step.tsx`
   is replaced, not wrapped).
3. `/evidence-libraries/<id>/setup` — the mock's setup page on the real setup
   operation status (`evidence-library-setup-status.tsx` replaced). Activation
   from the configuration page keeps working; the setup page shows the same
   operation with the mock's design, including the failed state and retry.
4. `/evidence-libraries/<id>/admin` — the mock's `admin-launch.tsx` on the real
   one-time login code flow (`evidence-library-admin-launch.tsx` replaced).
5. Shared page shell: header, back chevron, titles and spacing exactly as in the
   mock (`components/evidence-libraries/mock/*` page shell pieces and the mock
   `app/evidence-libraries/*` pages). Reuse `components/evidence-libraries/configuration/fields.tsx`
   controls where the mock used the same ones; do not copy the mock's `config/` folder.

Design rules: `plans/evidence-library-full-configuration-mock/00-README.md`
on the mock branch (type scale, copy rules, no dots, no counts, no uppercase,
no vendor names, fixed values look fixed). Copy in six locales, English mirrored.

## Migration

None. No schema change expected. If a list query is missing, add it to
`convex/evidenceLibraries/queries.ts` with full validators.

## Tests

- Component tests (behaviour only): list shows libraries with status and the
  owner-only actions; editor sees no configuration link; new page reserves the
  address and shows the read-only saved values; setup page shows running,
  ready and failed states and the retry action; admin page issues the code and
  shows the not-ready state.
- Existing auth browser tests (`e2e/auth.spec.ts`) must keep passing text they
  assert on, or be updated in the same PR.

## Deployability gate

`npm run dev:web` on the lane port, signed in as the E2E user: open the four
pages, take screenshots, compare side by side with the mock screenshots in
`/tmp/shots/page2-*.png` (list, new, setup, admin). No compile or runtime
error. After merge: `npm run convex:push` from dev-self if Convex changed, and
the same four pages on https://dev.openscholar.ai after the webhook deploy.

## Completion

All four pages match the mock, tests and TypeScript pass, gate screenshots
attached to the PR, old page components deleted.

## Known risks

The mock used a Zustand store and fake data; every read must move to Convex
`useQuery` / server data and every action to the real mutation. Do not keep
mock data or the mock store.
