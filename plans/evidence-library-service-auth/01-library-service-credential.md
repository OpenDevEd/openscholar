# Plan 01 — Library machine credential

## Goal

Give each Evidence Library one encrypted machine credential that can authenticate calls as that library and can be rotated without changing another library.

## Scope

Add secure token generation, a digest on the existing credential row, one Owner-only rotation action, and a reusable server-side authentication check. Do not expose stored secret material after creation.

## Design

- Reuse `evidenceLibraryCredentials` with the fixed key `library-service`.
- Generate a 32-byte `els_` token in a Node action.
- Store the encrypted token, SHA-256 digest, masked hint, creating user, and update time.
- Upsert by library and fixed key so one library has one active credential.
- Return the raw token only from the successful create or rotate action.
- Authentication receives the library ID and token digest. It never scans all credentials or decrypts every tenant's credential.

## TDD sequence

1. Red: an Owner rotation returns one raw credential and stores one encrypted row with a digest.
2. Green: add generation and the dedicated upsert path.
3. Red: rotating library A replaces only A's row and makes A's old digest fail while library B still works.
4. Green: add the reusable digest check.
5. Clean up shared token helpers without changing behavior.

## Files

- `convex/schema.ts`
- `convex/evidenceLibraries/validators.ts`
- `convex/evidenceLibraries/credentials.ts`
- `convex/evidenceLibraries/credentialActions.ts`
- `convex/evidenceLibraries/serviceAuth.test.ts`
- generated Convex API types

## Migration

Add an optional digest field because ordinary runtime credentials do not authenticate inbound requests. No compatibility code or backfill.

## Exact tests

```sh
npx vitest run convex/evidenceLibraries/serviceAuth.test.ts
```

## Deployability gate

Run `npx pm2 logs convex --lines 5 --nostream`. The newest deploy must show `✔ Convex functions ready!` with no later error. Check the deployed function spec for the public rotation action and its return validator.

## Completion rules

- Exactly one machine credential exists per library.
- Only an Owner can rotate it.
- The raw value is returned once and never appears in metadata queries.
- Rotation affects only the selected library.
- The focused test and Convex deployability gate pass.

## Risks

- Reusing the general configuration-path resolver would reject the fixed machine key. Use a dedicated machine-credential function.
- Do not use a global credential scan. Look up by library and fixed key.
