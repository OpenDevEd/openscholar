# Plan 02 — Clerk and Convex Prerequisites

Verified: **2026-08-11**  
Environment: **development only**

## Live Clerk instance

- Instance: `ins_3A6qNb89McI3ViqSRyyJw8eQaTJ`
- Issuer: `https://subtle-rhino-55.clerk.accounts.dev`
- Organizations: enabled
- Default creator role: `org:admin`
- Maximum memberships per organization: 5

Organizations were initially disabled. Plan 02 explicitly requires the development organization fixture, so the development instance was enabled through Clerk's supported `PATCH /v1/instance/organization_settings` API before any Convex schema work.

## Convex JWT contract

Template:

- ID: `jtmp_3A6zWHu0CZ6hVuHByeftyAyMaWe`
- Name: `convex`
- Audience: `convex`
- Lifetime: 60 seconds
- Algorithm: RS256

Verified template claims:

```json
{
  "aud": "convex",
  "o": {
    "id": "{{org.id}}",
    "rol": "{{org.role}}"
  }
}
```

The app's `ConvexProviderWithClerk` requests this custom template because the default session token does not carry audience `convex`. The custom token is therefore the backend authorization contract.

Convex preserves additional JWT claims by their raw keys. Plan 02 must read:

- active organization: `identity.o.id`
- active organization role: `identity.o.rol`
- authenticated user: `identity.subject`

Live custom-token verification returned `org:admin` and `org:member` exactly. Do not accept Clerk v1 `org_id` / `org_role`, the default session token's unprefixed `o.rol`, a client-supplied role, or a client-supplied organization ID.

## Development fixture

Organization:

- ID: `org_3HlfXyYZNp7NRrtRGuwSUcwHXq4`
- Name: `OpenScholar Evidence Library E2E`
- Slug: `openscholar-evidence-library-e2e-1786447619079073436`

Memberships:

| Role | Clerk user | Email |
|---|---|---|
| `org:admin` | `user_3A70omzDavdapdpmawZp5cd1O7B` | `e2e-clerk-user@example.com` |
| `org:member` | `user_3HlfUXmRozaabiOTDoAiMwRtuzr` | `e2e-clerk-member@example.com` |

The ignored local `.env.local` stores the organization ID/slug and both fixture credentials under `E2E_CLERK_*` variables. No credentials are committed.

## Verification evidence

A real Playwright sign-in was performed for each fixture identity. After setting the organization active, a fresh `convex` template token was decoded locally without printing or persisting the bearer token.

Observed admin payload subset:

```json
{
  "aud": "convex",
  "sub": "user_3A70omzDavdapdpmawZp5cd1O7B",
  "o": {
    "id": "org_3HlfXyYZNp7NRrtRGuwSUcwHXq4",
    "rol": "org:admin"
  }
}
```

Observed member payload subset:

```json
{
  "aud": "convex",
  "sub": "user_3HlfUXmRozaabiOTDoAiMwRtuzr",
  "o": {
    "id": "org_3HlfXyYZNp7NRrtRGuwSUcwHXq4",
    "rol": "org:member"
  }
}
```

Plan 02 may proceed to authorization TDD. The first backend slice must still prove the strict claim parser and projected-membership cross-check with `convex-test` before any library mutation is exposed.
