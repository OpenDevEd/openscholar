# Plan 14 — Admin handoff without cards

## Goal

Opening a library's `/admin` never shows a card. Without a session the
runtime sends the browser to OpenScholar. OpenScholar signs the person in if
needed, decides whether they may use that library's admin, and either sends
them straight back with the cookie or tells them, on OpenScholar, that they
do not have access. Nothing to click on either side when access is granted.

The flow the owner sees:

1. Signed out of OpenScholar, open `https://<library>/admin`.
2. Land on OpenScholar's sign-in. Sign in.
3. OpenScholar checks access. Allowed → the browser lands on the library's
   admin page, signed in. Not allowed → one plain panel on OpenScholar:
   "You do not have access to this library's admin." No redirect.

## Facts checked on 2026-08-28

Runtime (new-el `main` 122a7e55):

- `/admin` is gated per page in `src/app/[locale]/admin/page.tsx:22-31`:
  no valid cookie → renders the `AdminAccess` card
  (`src/components/admin/AdminAccess.tsx`) with a "Back to OpenScholar" link
  to `loginPageUrl`. The proxy never reads the cookie. API routes gate
  themselves in `src/lib/admin/http.ts:118-139` (401, unchanged).
- The session is a signed, host-only, 12-hour cookie
  (`src/lib/admin/access.ts`). The code exchange is
  `GET /api/admin/session?code=…` (`src/app/api/admin/session/route.ts`):
  it POSTs the code to OpenScholar's
  `/api/v1/evidence-libraries/admin-login/redeem` with the machine credential,
  sets the cookie, and 303s to `/admin`. Any failure 303s to
  `/admin/access-error`, a second card.
- `loginPageUrl` comes from the library config
  (`authentication.openScholar.loginPageUrl`, an `https:` URL with no
  fragment or credentials). OpenScholar writes it as
  `<app>/evidence-libraries/<libraryId>/admin`
  (`convex/evidenceLibraries/runtimeConfiguration.ts:58-61`).
- No user-supplied redirect parameter exists today; origin trust lives in
  `src/lib/runtime-routing.ts` (`getExternalRequestOrigin`,
  `hasMatchingRequestOrigin`).
- Tests that assume the card: `tests/e2e/admin-login.ts:57-73` (`openAdmin`
  branches on the "Back to OpenScholar" link; used by four specs),
  `tests/e2e/admin.spec.ts:618-694`, `tests/unit/admin-auth-routes.test.ts`
  (`:128`, `:145`, `:156` assert `/admin/access-error`), and
  `tools/runRuntimeAcceptance.ts:432` (`requireHttpSuccess` expects 200 on a
  signed-out `/admin`). Doc: `docs/evidence-library-operations.md:239`.

OpenScholar (`dev` b540cc5e):

- `app/evidence-libraries/[libraryId]/admin/page.tsx` renders the client
  card `components/evidence-libraries/admin-launch.tsx`: a query
  (`getAdminLaunchState`) and a button that calls the action
  `adminLoginCodeActions.issueAdminLoginCode`, then
  `window.location.assign(launchUrl)`. The launch URL is
  `<targetBaseUrl>/api/admin/session?code=…`
  (`convex/evidenceLibraries/adminLoginCodeActions.ts:39-40`). Codes are
  `elc_` + 43 chars, five minutes, digest-only storage, single use
  (`adminLoginCodes.ts`). Redemption re-checks organisation state, library
  ownership and the user's membership and role.
- Who may mint today: `requireEvidenceLibraryAccess(ctx, id, "read")` —
  any active member (owner or editor) of the caller's **active** Clerk
  organisation; the plan-12 switch does not gate this (Exception B), so an
  active library stays reachable after an organisation is switched off.
- The active organisation is read from the Clerk token (`o.id`, `o.rol`);
  the repo has no `setActive`/`useOrganizationList`. A member of the
  library's organisation with another organisation active gets "Library
  not found".
- Sign-in return: `/evidence-libraries/**` is protected, so `proxy.ts`
  (`auth.protect()`) sends signed-out visitors to `/sign-in?redirect_url=…`;
  `app/sign-in/[[...sign-in]]/page.tsx:8-19` passes `redirect_url` through
  as the fallback after sign-in when it starts with a single `/`.
- Server-side Convex calls with the user's token have no precedent in the
  app yet; `convex/nextjs` (`fetchQuery`, `fetchAction`) is available
  (`convex` ^1.35.1) and `auth().getToken({ template: "convex" })` supplies
  the token.
- Tests: `convex/evidenceLibraries/adminLoginCodes.test.ts` (URL shape at
  `:100-104`, `:305`), `adminLoginRedemption.test.ts`,
  `tests/components/evidence-libraries/admin-launch.test.tsx`; no e2e
  covers the admin launch.

## Decisions

1. **The runtime never renders an access card.** `/admin` with no valid
   session redirects (307) to
   `loginPageUrl?return=<path+search of the request>`. A failed or replayed
   code exchange redirects to `loginPageUrl?error=invalid_code&return=…`
   instead of `/admin/access-error`. `AdminAccess.tsx` and the
   `access-error` page are deleted. Protected API routes keep their 401s.

   The redirect is decided in `src/proxy.ts`, not in the page. The runtime
   runs with `cacheComponents: true`, so a page that calls `redirect()`
   answers HTTP 200 and asks the browser to move on afterwards — the
   acceptance check on 2026-08-28 saw exactly that. The proxy reads the same
   signed cookie (Proxy runs in the Node.js runtime) and answers 307 before
   anything renders. The page keeps its own check for the one case the proxy
   cannot see: a valid session whose role lacks the permission.
2. **`return` is validated on the runtime.** A helper in
   `src/lib/runtime-routing.ts` accepts only a path (no scheme, no host,
   no `//`), under `/admin` or `/<locale>/admin`, and falls back to
   `/admin`. The code exchange (`/api/admin/session?code=…&return=…`) 303s
   to the validated path after setting the cookie. The exchange URL stays
   `/api/admin/session`; OpenScholar keeps building it.
3. **OpenScholar's `/evidence-libraries/[libraryId]/admin` becomes a
   server-rendered decision, not a card.** It stays a protected route so
   Clerk's middleware handles sign-in and returns to the same URL, query
   string included. Once signed in the page calls one Convex action with
   the user's token (`fetchAction` from `convex/nextjs`,
   `auth().getToken({ template: "convex" })`) and:
   - allowed → `redirect(launchUrl)` to
     `<targetBaseUrl>/api/admin/session?code=…&return=<validated return>`;
   - not a member → the no-access panel ("You do not have access to this
     library's admin. Ask an admin of <organisation> to add you.") with a
     link to the libraries list; no redirect;
   - library not ready → one panel ("This library is not set up yet");
     owners get a link to the setup page;
   - `?error=invalid_code` → one panel ("That link expired or was already
     used.") with a "Try again" link to the same route without `error`; no
     automatic redirect, so a broken runtime cannot loop.
4. **Access is decided by membership in the library's organisation, not the
   active one.** New action `adminHandoff.issueAdminHandoff({ libraryId,
   returnPath })`: reads the library, looks up the caller's active
   membership in `library.organizationId` (`organizationMemberships` by
   user and organisation, `state === "active"`), requires the organisation
   to be `active`, maps the role (`org:admin → owner`, `org:member →
   editor`), requires readiness (`readEvidenceLibraryAdminLaunchTarget`),
   stores the code exactly as today (`storeIssuedAdminLoginCode` gains an
   organisation-scoped variant or a `by library organisation` path), and
   returns `{ status: "allowed", launchUrl } | { status: "no_access",
   organisationName } | { status: "not_ready", isOwner }`. It never throws
   for the three expected outcomes. Redemption already re-checks the same
   membership at exchange time, so nothing changes there.
5. **"Open admin" buttons keep pointing at
   `/evidence-libraries/<id>/admin`.** The route now redirects by itself,
   so the list, setup and configuration pages need no change. The client
   card, `openAdminLaunchUrl`, and the client action call are deleted; the
   `getAdminLaunchState` query goes if nothing else reads it.
6. **The plan-12 switch stays out of this path** (Exception B holds): an
   active library's admin stays reachable for its members when the
   organisation is switched off.
7. **No interstitial copy.** The page renders nothing before redirecting;
   Next's `redirect()` in a server component sends the `Location` header.

## Lanes

| Lane | Repo | Branch | Owns |
|---|---|---|---|
| R2 · Runtime | new-el | `codex/admin-handoff` | `src/proxy.ts` (admin gate only), `src/app/[locale]/admin/**`, `src/app/api/admin/session/**`, `src/components/admin/AdminAccess.tsx` (delete), `src/lib/admin/access.ts`, `src/lib/runtime-routing.ts`, their tests, `tests/e2e/admin*.ts`, `tools/runRuntimeAcceptance.ts` (admin steps only), `docs/evidence-library-operations.md` |
| O · OpenScholar | openalex-count | `codex/admin-handoff` | `app/evidence-libraries/[libraryId]/admin/**`, `components/evidence-libraries/admin-*.tsx`, `lib/evidence-libraries/open-admin-launch.ts` (delete), `convex/evidenceLibraries/adminHandoff*.ts` (new), `adminLoginCodes.ts`, `adminLoginCodeActions.ts`, `queries.ts` (admin launch only), `readinessClient.ts` (the `/admin` page check only), their tests, `messages/*.json` keys under `evidenceLibraries.admin`, `e2e/` (new spec) |

The two lanes share only the URL contract in Decisions 1–2. They can run
in parallel; the end-to-end proof waits for both to merge.

## Test-first steps

### Lane R2

1. `tests/unit/runtime-routing.test.ts`: red → green for the return-path
   helper (accepts `/admin`, `/admin/items?x=1`, `/en-GB/admin/...`;
   rejects `https://…`, `//evil`, `/lib`, empty → `/admin`).
2. `tests/unit/runtime-routing.test.ts`: `isAdminPagePath` accepts `/admin`,
   `/admin/items` and `/<locale>/admin`, and refuses `/lib`, `/adminish` and
   `/api/admin/items`; the proxy reuses it.
3. `tests/unit/admin-auth-routes.test.ts`: signed-out `/admin` page →
   307 to `loginPageUrl` with `return`; failed exchange → 303 to
   `loginPageUrl` with `error=invalid_code`; successful exchange → cookie +
   303 to the validated `return`; malformed code never contacts OpenScholar
   (unchanged).
4. `tests/e2e/admin-login.ts`: `openAdmin` stops branching on the card —
   it issues a code and hits `/api/admin/session?code=…&return=…`, then
   asserts the destination. `tests/e2e/admin.spec.ts:618-694`: logout lands
   on OpenScholar's URL (assert the redirect target, `redirect: "manual"`
   in a request or the browser's final URL when the fake OpenScholar
   answers); replay → OpenScholar URL with `error=invalid_code`.
5. `tools/runRuntimeAcceptance.ts:432`: signed-out `/admin` must answer
   3xx with `Location` starting with `loginPageUrl` (`redirect: "manual"`).
6. `npm run check:changed`, then `npm run test:acceptance` and
   `npm run test:acceptance:cleanup`. Tag your acceptance images with the
   five `EVIDENCE_LIBRARY_ACCEPTANCE_*_IMAGE` variables so a parallel run
   on this machine cannot collide.

### Lane O

1. `convex/evidenceLibraries/adminHandoff.test.ts`: red → green for
   `issueAdminHandoff`: owner and editor of the library's organisation
   are allowed even when another organisation is active in the token;
   a signed-in user with no membership gets `no_access` with the
   organisation name; a member of a switched-off organisation is still
   allowed (Exception B); an inactive organisation → `no_access`; a
   library that is not ready → `not_ready` with `isOwner`; the stored
   code, audit row and `launchUrl` match today's shape plus the validated
   `return`; an unsafe `returnPath` is dropped.
2. A pure decision helper (`lib/evidence-libraries/admin-handoff.ts`)
   mapping the action result and the query (`error`) to one of
   `redirect | no_access | not_ready | invalid_code`, unit-tested.
3. `tests/components/evidence-libraries/admin-panels.test.tsx`: the three
   panels render their copy and links (roles, names); no CSS assertions.
4. Delete `admin-launch.test.tsx` with the card. Update
   `adminLoginCodes.test.ts` assertions that pin the URL if the shape gains
   `return`.
5. New `e2e/evidence-library-admin.spec.ts`: signed out, open the admin
   route → `/sign-in` with `redirect_url` carrying the route and its query;
   after sign-in the browser is redirected off-site to the library origin
   (assert the navigation target with request interception, since the
   library is not running in e2e); the E2E organisation is switched on in
   Clerk, so this passes on CI.

## Deployability gate

### Lane R2

- `npm run check:changed` pass; unit tests green; the acceptance suite
  passes end to end (it is green on `main` once new-el #141 merges — rebase
  onto it). Push; PR to `main`; do not merge.

### Lane O

1. `npx tsc --noEmit` clean; `npx vitest run convex/evidenceLibraries
   tests/components/evidence-libraries lib/evidence-libraries` green;
   `npx playwright test e2e/evidence-library-admin.spec.ts` green locally
   against the lane.
2. `npx convex dev --once` on the lane ends with `Convex functions ready!`;
   `npx convex logs --history 100` clean.
3. Browser on the lane's port: signed out, open
   `/evidence-libraries/<id>/admin` → sign-in → back → the browser is sent
   to `<library>/api/admin/session?code=…&return=%2Fadmin` (capture the
   `Location`; the lane library may not be running). As a user outside the
   organisation: the no-access panel. Screenshots in `/tmp/admin-handoff/`.
4. Push; PR to `dev`; do not merge.

### Integration owner, after both merge

1. `npm run convex:push` from `dev-self`; set `EL_RUNTIME_COMMIT_SHA` to
   the merged new-el commit; publish one library.
2. Signed out of dev.openscholar.ai, open `https://<library>/admin`: sign
   in → land on the admin page with no click. Sign out of the admin →
   back on OpenScholar. Open the same URL as a user outside the
   organisation → the no-access panel. Replay an old code →
   "That link expired". Tear the library down.
3. Outline: one line under the current-state page and the integration
   contract (the `return` and `error` parameters).

## Completion rules

- No card on the runtime's `/admin` in any state; no card on OpenScholar
  when access is granted; every refusal is one plain panel on OpenScholar.
- The gates above pass and both PRs went through the Codex review with
  findings applied.
- Copy follows the page rules: sentence case, plain words, no vendor names
  in owner copy.

## Known risks

- **Readiness will call every library broken until lane O fixes it.**
  `requireLibraryRuntimeReady` fetches the library's `/admin` with
  `redirect: "manual"` and treats anything that is not `2xx` as not ready
  (`convex/evidenceLibraries/readinessClient.ts:367-382` and `:415`). Once the
  runtime redirects a signed-out `/admin`, publishing or updating a library
  fails with `PAGE_NOT_READY`. Lane O must change that one check to accept a
  `3xx` whose `Location` starts with the library's configured OpenScholar login
  page, and update `readinessClient.test.ts` with it. Found by lane R2 on
  2026-08-28 while making the runtime redirect.
- Open redirect: `return` is validated on the runtime (path only, under
  `/admin`); OpenScholar forwards it only when it starts with a single `/`.
  `launchUrl` is built from the stored `targetBaseUrl`, never from input.
- Redirect loop: OpenScholar never auto-redirects when `error` is present.
- Clerk's `redirect_url` carries the query string only if the middleware
  passes the full URL; lane O verifies this with the e2e test and fixes
  `lib/auth/use-sign-in-redirect.ts:16` (drops `location.search`) if any
  client path is involved.
- A user who is a member of two organisations: access is decided by the
  library's organisation, so no switch is needed; the token's active
  organisation is ignored by this action only.

## Files that change

Lane R2: `src/proxy.ts`, `src/app/[locale]/admin/page.tsx`,
`src/app/[locale]/admin/access-error/page.tsx` (delete),
`src/components/admin/AdminAccess.tsx` (delete),
`src/app/api/admin/session/route.ts`, `src/lib/runtime-routing.ts`,
`tests/unit/runtime-routing.test.ts`, `tests/unit/admin-auth-routes.test.ts`,
`tests/e2e/admin-login.ts`, `tests/e2e/admin.spec.ts`,
`tools/runRuntimeAcceptance.ts`, `docs/evidence-library-operations.md`.

Lane O: `app/evidence-libraries/[libraryId]/admin/page.tsx`,
`components/evidence-libraries/admin-launch.tsx` (delete),
`components/evidence-libraries/admin-panels.tsx` (new),
`lib/evidence-libraries/open-admin-launch.ts` (delete),
`lib/evidence-libraries/admin-handoff.ts` (new),
`convex/evidenceLibraries/adminHandoff.ts` and `adminHandoffActions.ts`
(new), `adminLoginCodes.ts`, `adminLoginCodeActions.ts`, `queries.ts`,
their tests, `messages/*.json`, `e2e/evidence-library-admin.spec.ts` (new).
