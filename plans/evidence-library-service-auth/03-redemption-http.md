# Plan 03 — Authenticated code redemption

## Goal

Let the intended Evidence Library redeem a valid login code once through one server-to-server request.

## Scope

Add one POST endpoint and one atomic redemption mutation. Return the checked session details. Evidence Library cookie creation belongs to OpenDevEd/new-el#55.

## Design

- Route: `POST /api/evidence-libraries/admin-login/redeem`.
- Request: `Authorization: Bearer <machine credential>` plus JSON `{ "libraryId": "...", "code": "..." }`.
- The HTTP action parses and hashes both secrets, then calls one internal mutation.
- The mutation checks the machine credential digest, code digest, code library, the code's bound organization, active current membership, unchanged role, unused state, and expiry. The active Clerk organization was already checked when OpenScholar issued the code.
- The same mutation marks the code consumed and returns the library, user, Clerk organization, role, and consumption time.
- Every invalid credential gets 401. Every invalid, expired, reused, or wrong-library code gets one 400 response without exposing another tenant.

## TDD sequence

1. Red: the correct library credential redeems one valid code and receives the bound session details.
2. Green: implement one atomic mutation.
3. Red: the same code fails on the second request and simultaneous redemption yields one success.
4. Green: rely on Convex transaction atomicity.
5. Red: expired, wrong-library, rotated machine credential, revoked membership, and changed role all fail without consuming a usable code for the right state.
6. Green: add the HTTP handler and response mapping.

## Files

- `convex/evidenceLibraries/adminLoginCodes.ts`
- `convex/evidenceLibraries/serviceHttp.ts`
- `convex/http.ts`
- `convex/evidenceLibraries/adminLoginRedemption.test.ts`
- generated Convex API types

## Migration

No extra migration beyond Plans 01 and 02.

## Exact tests

```sh
npx vitest run convex/evidenceLibraries/adminLoginRedemption.test.ts
```

## Deployability gate

Run `npx convex dev --once` in this worktree against `dev:spotted-woodpecker-546`, then inspect `npx convex logs --history 200`. Check `npx convex function-spec` for the internal mutation validator. Call the assigned deployment's HTTP route with one test credential and confirm one success followed by one rejected replay. Do not use `npm run convex:push`, the shared self-hosted deployment, or Coolify.

## Completion rules

- Machine authentication and code consumption happen against one current database state.
- Current membership and role are checked during redemption.
- Exactly one redemption succeeds.
- The endpoint returns clear bounded JSON and no stored secret.
- Focused tests, deployed route smoke, and Convex gate pass.

## Risks

- Multiple query and mutation calls would create a stale-auth window. Keep all database checks and consumption in one mutation.
- Never log the bearer token or login code.
