# Plan 02 — Drafts, Revisions, and Authorization

## Goal

Add the clean organization-owned Convex model for Evidence Libraries, mutable drafts, immutable revisions, secrets metadata and operation state.

## Scope

- Verify Clerk Organizations are enabled and the Convex JWT template exposes organization ID and role claims; record the exact grounded claim names before coding.
- Create or verify a development organization containing one `org:admin` and one `org:member` test identity for integration and Playwright fixtures.
- Extend the existing Clerk webhook pipeline for organization and membership projection.
- Preserve Clerk's signed event occurrence metadata and apply the same replay/order guard to the existing user projection so delayed updates cannot resurrect deleted users.
- Persist deterministic Clerk replay/order outcomes without retaining webhook payloads.
- Add Evidence Library ownership and lifecycle tables.
- Add a dev-gated provisioning seed that binds an Evidence Library to an isolated target runtime and supplies its platform-managed service values for Plan 06 acceptance.
- Add one mutable draft per library with optimistic concurrency.
- Store bounded section payloads and immutable published revision metadata.
- Add authorization, queries and mutations with complete validators.
- Add library-scoped encrypted credentials using the existing server-encryption donor.

Out of scope: UI, authoritative Evidence Library validation, network activation.

## Design

1. Clerk remains authoritative for organizations, membership and roles. Convex projections provide application joins/audit and are updated only through verified Clerk events.
2. Add `clerkEventLogs`, `organizations`, `organizationMemberships`, `evidenceLibraries`, `evidenceLibraryRuntimeBindings`, `evidenceLibraryConfigDrafts`, `evidenceLibraryConfigRevisions`, `evidenceLibraryConfigSections`, `evidenceLibraryConfigOperations` and a library-scoped credential table.
3. Access resolution derives the authenticated user from `ctx.auth.getUserIdentity()`, reads the verified custom-template claims `identity.o.id` and `identity.o.rol`, and cross-checks a live projected membership. The role claim is exactly `org:admin` or `org:member`. Never trust a client-supplied `userId`, role or organization alone, and never add Clerk v1 `org_id` / `org_role` fallbacks.
4. `org:admin` may mutate; `org:member` may read. Anonymous, inactive membership, wrong active organization and cross-tenant access fail identically without leaking existence.
5. A draft has `baseRevisionId`, `editVersion`, contract provenance and timestamps. Every save provides the expected `editVersion`; mismatch returns a typed conflict.
6. Sections are bounded JSON values keyed by canonical section name. Published revision sections are immutable. Secrets are referenced by status/credential identity, never embedded in section JSON or query results.
7. Operation state is separate high-churn data: queued/running/succeeded/failed with stage, attempt, receipt and sanitized error metadata.
8. The verified Clerk envelope preserves `svix-id` as message identity plus the signed body `timestamp` and `instance_id`. Projection mutations use occurrence time—not delivery time—for deterministic `applied`, `duplicate`, `stale` or `timestamp_conflict` outcomes. A membership event transactionally applies its nested organization snapshot before the membership.
9. `clerkEventLogs` stores event identity, entity identity, occurrence time, payload digest and outcome, but never the payload. Replay/order decisions are durable and shared by user, organization and membership projections.
10. Remove the repository-wide `schemaValidation: false` before adding the Plan 02 tables. This is a breaking dev-only cleanup: inspect validation failures, delete invalid disposable rows from only the affected tables, and never add optional-field compatibility shims.

## TDD sequence

1. Red: webhook tests preserve signed occurrence metadata, cover organization/membership create, update and delete, and prove replay idempotency, equal-timestamp conflict handling and out-of-order rejection. Include user create → delete → delayed update remaining deleted.
2. Green: extend verified Clerk webhook dispatch, shared ordering guard and projection mutations; commit per green.
3. Red: access tests for admin/member/anonymous/inactive/cross-tenant/wrong-active-org cases.
4. Green: implement centralized `convex/evidenceLibraries/access.ts`; commit.
5. Red: schema and mutation tests for create library, one draft, section saves, reload and optimistic conflict.
6. Green: implement tables/validators/queries/mutations; commit per green.
7. Red: immutable revision and section tests, including rejection of mutation after publish.
8. Green: implement revision finalization; commit.
9. Red/green dev-gated provisioning tests: target identity is required, platform service values are stored outside owner section JSON, non-admin/production use fails, and a seeded library is acceptance-ready; commit.
10. Red: encrypted credential write and metadata-only read tests.
11. Green: implement library-scoped credential actions; commit.
12. Red/green operation-state transition tests; then refactor.

## Files touched

- `convex/schema.ts`
- `convex/webhooks/{clerk,actions}.ts` and tests
- `convex/webhooks/clerk_mappers.ts`, `convex/users/internal.ts` and focused webhook/user ordering tests
- `convex/evidenceLibraries/{access,validators,queries,mutations,operations,credentials,provisioning}.ts`
- colocated Convex tests
- `convex/http.ts` only if the existing webhook route needs additional event routing
- generated Convex API files

## Migration stance

Breaking/new tables and strict global schema validation. No legacy model exists. Remove `schemaValidation: false`; if existing invalid dev rows block deployment, delete only rows in the reported affected tables and recreate needed fixtures. Do not widen validators, write migrations or add compatibility paths.

## Test plan

```bash
npm test -- convex/evidenceLibraries convex/webhooks
npx convex function-spec | rg 'evidenceLibraries|webhooks'
npx pm2 logs convex --lines 5 --nostream
```

Inspect deployed function specs for exact args and returns validators after the dev deployment accepts the source.

## Deployability gate

After every backend-touching commit:

```bash
npx pm2 logs convex --lines 5 --nostream
```

Latest output must contain `✔ Convex functions ready!` and no newer `✖ Error`. New module names use camelCase only. Deployed function specs must expose the intended validators.

## Acceptance criteria

- Verified Clerk events synchronize organizations/memberships idempotently.
- Admin write/member read permissions and all denials pass.
- Cross-tenant enumeration is impossible through error differences.
- One draft survives reload and rejects stale edit versions.
- A dev-gated seed creates a library/runtime binding with platform service values for isolated acceptance; it is inaccessible in production and to non-admins.
- Published revisions and their sections cannot be mutated.
- Every draft, revision and configuration-section record carries contract provenance.
- Global Convex schema validation is enabled; no `schemaValidation: false` remains.
- Query results never expose stored secret material.
- All Convex tests and deployability gates pass.

## Known pitfalls

- Clerk Organizations, the exact Convex JWT claims, and the two-role development fixture are execution prerequisites, not assumptions; block before schema work if they cannot be verified.
- Clerk's default v2 session token and the custom `convex` JWT are different contracts. Convex receives the custom template, whose verified organization claim is `{ o: { id, rol } }`; do not parse the default token's unprefixed compact role.
- Membership deletion/revocation must cut access immediately.
- `svix-timestamp` is delivery-attempt time. Ordering uses the signed event body's `timestamp`; equal timestamps with different event IDs never use arrival order.
- Avoid unbounded arrays; sections and operations are separate tables.
- A durable event log is required for replay/order decisions; never store the signed webhook payload in it.
- Validators must include every returned field or Convex will strip it.
- Do not copy per-user API-key ownership into an organization/library table.
