# Plan 04 — Billing And Screening Query Thinning

## Goal

Remove dead or over-broad mounted reads in billing/settings and screening shell surfaces by deleting the unused billing diagnostics subscription and splitting screening shell progress from screening history/detail reads.

## Scope

In scope:

- remove the mounted `getLatestGrantStatus` query from the billing page,
- keep any future diagnostics path explicit and on-demand rather than mounted,
- add a dedicated lightweight screening shell query for app-sidebar use,
- cut `AppSidebar` over from `listUserScreeningJobs({ limit: 1 })` to the lighter query,
- keep `listUserScreeningJobs` for history/dialog surfaces.

Out of scope:

- provider-based shared billing state,
- AI model catalog work,
- chat-domain work,
- new packages.

## Design

1. **Delete the dead billing diagnostics subscription.**
   The query currently has no active renderer. Remove it entirely from the mounted page path.

2. **If diagnostics return later, they must be explicit.**
   Any future grant diagnostics read should be behind a user action or explicit point-in-time fetch, not a mounted live query.

3. **Split screening shell progress from screening history/detail.**
   Add a dedicated app-shell query that reads only what the sidebar/footer need: the latest active job and its progress. Keep the richer list query for history browsing.

4. **Prefer indexed active-job reads.**
   Use the existing `by_user_status` support on `screeningJobs` rather than routing shell state through the richer list query.

## TDD sequence

1. Add red tests for the new screening shell query:
   - no active job,
   - pending job,
   - processing job,
   - choose the newest active job correctly.
2. Green the query.
3. Add/update component tests proving the sidebar/footer use the new shell shape and the billing page no longer mounts diagnostics.
4. Refactor and delete the old mounted billing diagnostics path.

## Files touched

- `app/settings/billing/page.tsx`
- `convex/screening/queries.ts`
- `components/app-sidebar.tsx`
- screening query/component tests
- billing page tests as needed

## Migration stance

None.

- No schema changes.
- Remove the dead mounted query entirely.

## Test plan

- Convex query tests for the new screening shell query.
- Component tests for sidebar progress rendering.
- Billing page tests or targeted mocks proving diagnostics are no longer mounted.
- Manual smoke:
  - billing page still loads normally,
  - sidebar shows active screening progress correctly,
  - screening history dialog still shows rich rows.

## Acceptance criteria

- Billing page no longer mounts `getLatestGrantStatus`.
- `AppSidebar` no longer uses `listUserScreeningJobs({ limit: 1 })`.
- Screening shell progress uses a dedicated lightweight query.
- Screening history/detail behavior remains intact.

## Known pitfalls

- Keep the history query untouched for surfaces that actually need question lists and collection names.
- Do not replace shell state with a stale point-in-time read; the shell badge is still live state.
- If multiple active statuses exist, pick the newest deterministically.

