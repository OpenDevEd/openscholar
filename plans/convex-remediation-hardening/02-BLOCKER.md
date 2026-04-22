# Plan 02 Blocker — Browser Smoke Auth Infrastructure

## Status

Blocked on the plan step:

- "Add failing browser smoke if fixture path is ready."

The library smoke could be seeded through the real Convex backend, but the current local Playwright auth path is not viable, so the smoke cannot complete on the existing local infrastructure.

## What Was Tried

1. Reused the existing authenticated Playwright pattern from `e2e/auth.spec.ts` and `e2e/chat-mode.spec.ts`:
   - `page.goto("/")`
   - `await clerk.loaded({ page })`
   - `await clerk.signIn({ page, emailAddress: process.env.E2E_CLERK_USER_EMAIL })`
2. Reused the billing-fixture pattern conceptually for real-backend seeding:
   - seeded library items and a collection through `npx convex run ... --identity ...`
   - confirmed public library mutations are callable with the authenticated Clerk identity
3. Verified the failure source instead of guessing:
   - Playwright timed out at `clerk.loaded({ page })`
   - the captured page snapshot showed only the footer shell, not the Clerk sign-in UI
   - `pm2 logs next --lines 120 --nostream` reported:
     - multiple `GET / 500` responses during the smoke window
     - `Clerk: Refreshing the session token resulted in an infinite redirect loop. This usually means that your Clerk instance keys do not match`

## Why This Blocks Plan 02

Plan 02 requires a real browser smoke for the library count contract. The current local auth environment cannot produce a reliable signed-in browser session, so any library smoke would fail before reaching the library page assertions. This is not a library-test bug; it is a pre-existing auth/runtime issue in the local Next.js + Clerk environment.

## What Landed Before The Blocker

These slices are complete and committed:

- `test(library): [plan-02] cover collection pagination`
- `test(library): [plan-02] harden page behavior coverage`
- `fix(library): [plan-02] repair missing counter writers`
- `chore(convex): [plan-02] refresh generated api types`

## What Would Unblock It

Any one of the following is sufficient:

1. Restore a working local Clerk browser session so `clerk.loaded()` resolves on `/`.
2. Fix the local Next.js / Clerk key mismatch causing the redirect loop reported in `pm2 logs next`.
3. Provide an already-authenticated Playwright storage state that is valid against the current local app instance.

Once auth is healthy, re-run this plan from the browser-smoke step and add the narrow `/library?col=...` smoke against the seeded real backend data.
