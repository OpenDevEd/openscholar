# Plan 02 Blocker — Isolated Evidence Library Acceptance Runtime

## Status

Blocked on the final Plan 02 acceptance criterion:

- "A dev-gated seed creates a library/runtime binding with platform service values for isolated acceptance."

The OpenScholar-side organization, memberships, Evidence Library, draft and provisioning action are live. The missing prerequisite is a real isolated Evidence Library runtime and its dedicated service values. No production tenant will be reused and no placeholder binding will be inserted.

## What Was Verified

### Clerk and Convex fixture

- Clerk organization: `org_3HlfXyYZNp7NRrtRGuwSUcwHXq4`
- Organization name: `OpenScholar Evidence Library E2E`
- Admin membership: `orgmem_3HlfY14P1AbQBLniiQpbwJtJw0D`, role `org:admin`
- Member membership: `orgmem_3HlfY219ZxdsV9lIdgvlbefufIV`, role `org:member`
- Clerk's development Svix endpoint was corrected from the stale `openscholar-site.opendev.space` target to `https://convex-site.opendev.space/webhooks/clerk`.
- Real signed `organization.updated` and both `organizationMembership.created` messages now have durable `applied` event-log outcomes and active Convex projection rows.
- Evidence Library `r17feg9wgsamsshbp1j6nbjess8c85q6` and draft `r5795hxvc8631q5pntgmrjwhcx8c8hae` were created through the public `createLibrary` mutation with the admin organization identity.
- Development Convex has `EL_DEV_PROVISIONING_ENABLED=true` and an encryption key configured.

### Code and deployed gates

- `npm test`: 363 files and 3,547 tests passed.
- The deployed function spec contains the public Evidence Library mutations, queries, credential action and provisioning action with explicit args and return validators.
- `npx pm2 logs convex --lines 5 --nostream` shows the latest `✔ Convex functions ready!` deployment.

## What Was Tried

1. Audited the OpenScholar Coolify project's `development` environment. It has no Evidence Library runtime application.
2. Audited all existing `OpenDevEd/new-el` Coolify applications. They are production tenant deployments on branch `coolify`, not an isolated acceptance target on branch `openscholar`.
3. Checked representative production tenants. Their current health routes return `404`, they have no `LIBRARY_CONFIG_PATH`, and they do not implement the revision-and-digest acceptance contract required by Plan 06.
4. Audited the Evidence Library acceptance compose donor at commit `667cfeadbc51b0a36a21f5de1b7a7647bb7622ad`. It is ephemeral and incomplete for this purpose: its config names a storage service that the compose file does not define, so its service values cannot form a durable binding.
5. Audited the shared platform services. Shared Meilisearch, PostgreSQL and tenant storage values exist, but they are production/shared resources. No dedicated database, unique index, or separate private/public storage buckets are reserved for this fixture.

## Why This Blocks Plan 02

`seedDevelopmentBinding` stores a durable runtime identity plus encrypted database, search and storage credentials for later real activation. Seeding it with production tenant values, unowned shared resources or synthetic URLs would make the acceptance fixture destructive or dishonest. The plan explicitly requires isolation and forbids legacy/placeholder paths.

The current Evidence Library runtime also lacks the authenticated, versioned and idempotent remote validation/activation endpoint plus revision-and-digest health receipt required by Plan 06. The existing filesystem activation CLI is not a remote control-plane contract.

## What Would Unblock It

Provision one development-only Evidence Library runtime in the OpenScholar Coolify project's `development` environment from the `openscholar` branch, with:

1. A durable public application origin and Coolify application UUID.
2. An isolated database and database URL.
3. A unique Meilisearch index and key.
4. Dedicated private document and public image buckets plus a storage service-role key.
5. `storageMaxPdfBytes=104857600`.
6. Optional Zotero translation URL only if the isolated runtime consumes it.
7. The revision-and-digest activation/health contract required by Plan 06, or an explicit decision to provision the runtime now and add that contract in Plan 06 before activation testing.

After those resources exist, resume Plan 02 at `seedDevelopmentBinding`, read service values through the supported Coolify API, seed library `r17feg9wgsamsshbp1j6nbjess8c85q6`, verify metadata-only reads, rerun the deployed gates, and request the final two-reviewer approval.

## Safety Boundary

No production Coolify application, database, index, bucket, deployment or environment variable was changed. No code was pushed.
