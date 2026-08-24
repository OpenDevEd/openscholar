# Evidence Library service authentication

This plan implements OpenDevEd/openalex-count issue #18. It gives each Evidence Library one machine credential and gives people a short-lived, single-use code for opening that library's admin area.

Last grounded: **2026-08-24**.

## Gap

OpenScholar already checks the active Clerk organization and projected membership. It also stores encrypted, library-scoped credentials. What is missing is:

1. one machine credential for each library;
2. one-time admin login codes; and
3. one server endpoint that authenticates the library and redeems a code once.

## Fixed decisions

- Clerk stays authoritative for people, active organizations, and roles.
- `org:admin` maps to Owner and `org:member` maps to Editor.
- The current Convex token contract is `identity.o.id` and `identity.o.rol`, with the full Clerk role values.
- A login code contains 256 random bits, is stored only as a SHA-256 digest, expires after five minutes, and can be used once.
- A machine credential contains 256 random bits, is encrypted with `ENCRYPTION_KEY`, and also has a SHA-256 digest for request authentication.
- The existing credential table reserves the key `library-service` for the one machine credential. Runtime configuration secrets keep their real JSON path; the machine credential has no fake configuration path.
- Rotation replaces the one credential row for that library. It never creates a second active machine credential.
- Code issuance checks the person's active Clerk organization. Redemption checks the code's bound organization, current projected membership, current role, expiry, and unused state in one Convex mutation.
- Workers use the shared runtime settings. This plan does not create worker-specific OpenScholar credentials.

## Plans

1. `01-library-service-credential.md` — create, rotate, store, and authenticate the one library machine credential.
2. `02-admin-login-code.md` — issue an opaque code only after checking the active Clerk organization and current projected membership.
3. `03-redemption-http.md` — expose the server-to-server redemption endpoint and consume a code atomically.

## Dependencies

```text
01 machine credential
 └──► 02 login code
       └──► 03 authenticated redemption
```

## Reuse

- `convex/evidenceLibraries/access.ts` for active organization, role, membership, and library ownership checks.
- `convex/evidenceLibraries/credentials.ts` and `credentialActions.ts` for the existing library-scoped encrypted credential row.
- `convex/lib/crypto.ts` for AES-256-GCM encryption.
- `convex/wallet/nodeActions.ts` for secure 32-byte token generation and SHA-256 digests.
- `convex/http.ts` for the existing HTTP router.
- Clerk projections under `convex/webhooks/` for current membership state.

Do not create a second credential store, auth framework, workflow engine, session system, or Clerk membership model.

## Tests

The public seams are:

1. an authenticated OpenScholar user requests an admin login code for a library; and
2. that library calls the redemption endpoint with its machine credential and the code.

Tests check returned values, stored rows, clear failure responses, and one-time behavior. They do not assert internal call order or source text.

Use red → green for token policy, rotation, code issue, and redemption. Each Convex change must pass its focused test and `npm run convex:push` from `dev-self`.

## Migration

Development data is disposable. Make the config-only path optional, add the optional digest, and add the login-code table directly. Do not add compatibility readers or a migration package.

## Agent use

A Sol worker may map existing code and tests. The main session owns plan changes, every red → green cycle, commits, remote Convex checks, and final verification.

## Sources

- Issue #18: https://github.com/OpenDevEd/openalex-count/issues/18
- Convex HTTP actions: https://docs.convex.dev/functions/http-actions
- Convex actions and transaction boundaries: https://docs.convex.dev/functions/actions
- Convex mutation atomicity: https://docs.convex.dev/database/advanced/occ
- Clerk session and active organization claims: https://clerk.com/docs/guides/sessions/session-tokens
- Clerk organizations: https://clerk.com/docs/guides/organizations/overview
- OWASP token guidance: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
