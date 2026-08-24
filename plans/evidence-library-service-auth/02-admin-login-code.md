# Plan 02 — Admin login code

## Goal

Let an active Clerk member request one opaque code for one library and role.

## Scope

Add the login-code table and public issue action. Do not create an Evidence Library session or redirect yet.

## Design

- Generate a 32-byte `elc_` token in a Node action.
- Store only its SHA-256 digest.
- Bind the row to the library, organization, Clerk user, current role, issue time, and five-minute expiry.
- Reuse `requireEvidenceLibraryAccess(..., "read")` so both Owner and Editor can open admin later, while the active Clerk organization, claim, projected membership, role, and library ownership must all agree.
- Reissuing creates another short-lived code. It does not reactivate or overwrite a consumed code.

## TDD sequence

1. Red: an active Owner receives a code bound to Owner, organization, user, and library.
2. Green: add the table, token action, and authorized insert.
3. Red: an active Editor receives an Editor code; anonymous, revoked, wrong-organization, stale-role, and cross-library requests fail.
4. Green: reuse the existing access check for every case.
5. Red: the database stores the digest and never the raw code.
6. Green and clean up.

## Files

- `convex/schema.ts`
- `convex/evidenceLibraries/validators.ts`
- `convex/evidenceLibraries/adminLoginCodes.ts`
- `convex/evidenceLibraries/adminLoginCodeActions.ts`
- `convex/evidenceLibraries/adminLoginCodes.test.ts`
- generated Convex API types

## Migration

New table only. Development data needs no backfill.

## Exact tests

```sh
npx vitest run convex/evidenceLibraries/adminLoginCodes.test.ts
```

## Deployability gate

Run `npm run convex:push` from `dev-self` and require `✔ Convex functions ready!`. Check the deployed function spec for the public issue action and its exact return validator.

## Completion rules

- The code is opaque, random, short-lived, and stored only as a digest.
- Its stored user, organization, library, and role come from checked server state.
- Invalid membership or active-organization state fails before insertion.
- Tests and the Convex gate pass.

## Risks

- Do not trust a client role, user ID, or organization ID.
- Do not return the code from a query after creation.
