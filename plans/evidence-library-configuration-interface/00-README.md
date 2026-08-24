# Evidence Library configuration plan

Build the first useful configuration page at `/evidence-libraries/[libraryId]/configuration`.

Last checked: 2026-08-24.

## Current scope

The owner can edit only these values:

- library name and short name;
- generated public address, shown as read-only;
- dark logo, optional light logo, and favicon URLs;
- accent and secondary brand colours; and
- available languages and default language.

OpenScholar fills every other runtime field from the pinned Evidence Library schema, catalogs, platform values, credentials, and checked defaults. The page does not expose raw JSON.

The owner can save, leave, return, validate, preview, and activate the draft. Preview uses the saved draft and does not create a deployment. Activation creates an immutable requested revision. It starts issue #26 for a new library or issue #65 for a running library. The revision becomes active only after the Evidence Library accepts it and passes its health check.

Manual rollback and every other configuration section are deferred.

## Fixed decisions

1. Clerk Organizations own organization identity and membership. Only an active organization owner can read or change configuration.
2. OpenScholar owns drafts, immutable revisions, activation requests, and the audit trail.
3. `OpenDevEd/new-el` on `main` owns the complete runtime schema, catalogs, validation, and activation behavior.
4. The visible form is intentionally small. It writes `identity`, `theme.colors`, and `localization`. OpenScholar supplies all hidden required values.
5. Save, validate, preview, and activate are explicit actions. There is no autosave.
6. Failed validation or deployment leaves the previous active revision unchanged.
7. Applying a changed configuration redeploys the whole repository Compose app. It does not calculate which worker changed and does not manage general app releases.

## Work already done

Plan 01 pinned the generated Evidence Library schema and catalogs and added contract checks. Plan 02 added the organization-owned library, draft, revision, operation, credential, and runtime-binding data. The isolated development Compose app and hosted Convex deployment exist.

Those plans still track all 24 runtime sections because OpenScholar must build a complete valid file. That does not mean the first page exposes all 24 sections.

## Remaining plans

1. `03-route-shell-and-anchor-rail.md`: add the owner-only route and the three visible groups.
2. `04-brand-content-and-collection-editors.md`: add the essential identity, branding, and language fields.
3. `05-discovery-and-platform-editors.md`: save drafts and assemble hidden defaults into one complete configuration.
4. `06-validation-publish-rollback-handoff.md`: validate, preview, activate, and hand the requested revision to #26 or #65.
5. `07-accessibility-browser-and-release-gates.md`: test the complete owner journey in the browser and against the development services.

Follow that order.

## Code to reuse

- `lib/evidence-libraries/configuration/` for the pinned contract, JSON pointers, section registry, and validation.
- `convex/evidenceLibraries/` for access checks, drafts, revisions, operations, credentials, and runtime bindings.
- `components/settings/sidebar-nav.tsx` as a visual donor for the small page rail.
- `components/ui/` for fields, buttons, alerts, and dialogs.
- `lib/auth/use-auth-query.ts` and `components/auth/auth-route-gate.tsx` for protected Convex reads.
- `convex/extraction/access.ts` and the existing Clerk webhook projection for server-side authorization patterns.

Do not build a general JSON Schema form renderer. Do not create a second full validator. Do not add a second role system.

## Test rules

- Test permissions, saved values, generated configuration, validation results, revision changes, deployment receipts, and health readback.
- Test fields through labels, roles, visible text, and accessible error links.
- Use Playwright for routing, reload, preview, activation, and responsive layout.
- Do not test Tailwind classes or copy the prototype as a screenshot fixture.
- Use hosted Convex with `npm run convex:push`. Use `npm run dev` for the local Next.js app. Do not start PM2 or a local Convex server.

## Repository boundary

OpenScholar may call the authenticated Evidence Library API. It must not write the Evidence Library database, filesystem, or Coolify internals directly.

The Evidence Library development app is Coolify application `rzbo9als0hdnr4gegtx97qos`. It runs `OpenDevEd/new-el` from `main` as one Compose app with the web process, private Meilisearch, and all required workers.

## Completion

This plan is done when an owner can save the visible fields, reload them, preview the result, activate a complete valid revision, and see that exact revision pass the Evidence Library health check. A member or user from another organization cannot read or change it.
