# Plan 05 Blocker — Browser Smoke Auth Environment

## Status

Blocked on the first Playwright smoke:

- the new real-browser library smoke cannot establish a reliable signed-in Clerk session, even when run against an isolated Playwright-owned Next.js server instead of the long-lived pm2 app instance.

## What Was Tried

1. Added a narrow browser smoke at `e2e/library-smoke.spec.ts` that:
   - signs in with the existing Clerk Playwright helper pattern,
   - retrieves a Convex token from the signed-in browser session,
   - seeds a small real library fixture through `ConvexHttpClient`,
   - asserts the exact collection total and `Showing 1-20 of N papers` copy on `/library?col=...`.
2. Investigated an initial runtime failure from the reused pm2-served app and fixed a real source issue in `components/library/library-page-client.tsx` by moving the parsed sort tuple above downstream hook usage.
3. Re-ran the smoke against a dedicated Playwright-managed server to remove pm2 reuse/staleness from the equation:
   - `E2E_BASE_URL=http://127.0.0.1:3100`
   - `PLAYWRIGHT_WEB_SERVER_COMMAND='npm run build && npm run start -- --port 3100'`
4. Verified the remaining failure source instead of guessing:
   - isolated-server runs still emit `Clerk: Refreshing the session token resulted in an infinite redirect loop`
   - the browser session never becomes stable enough for the smoke to reach its seeded `/library` assertions
   - `pnpm tsc --noEmit` is green locally, so typecheck is not the blocker for this plan

## Why This Blocks Plan 05

Plan 05 requires a repeatable browser smoke and a verification gate that includes it. The current local Clerk environment cannot maintain a stable authenticated browser session, so the smoke cannot produce a meaningful pass/fail signal for the library contract. This is now independent of pm2 reuse and independent of TypeScript health.

## What Landed Before The Blocker

- `e2e/library-smoke.spec.ts` — the new narrow browser smoke scaffold that seeds real backend data through Convex and asserts the exact library count/range copy.
- `components/library/library-page-client.tsx` — a real runtime fix for the `resolvedSortBy` temporal-dead-zone crash encountered while bringing up the smoke.

## What Would Unblock It

Any one of the following is sufficient:

1. Fix the local Clerk key mismatch so signed-in browser sessions stop entering the refresh loop.
2. Provide a valid authenticated Playwright storage state or equivalent session bootstrap that works against the current local Clerk instance.
3. Align the publishable and secret Clerk keys used by the app and the Playwright/global-setup environment, then re-run the smoke on the isolated Playwright server path above.

Once auth is healthy, resume Plan 05 from the browser-smoke step, then add the verification wrapper that runs the targeted Vitest slice, the browser smoke, and typecheck together.
