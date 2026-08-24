# Plan 05 — Discovery and Platform Editors

## Goal

Implement the remaining discovery, source, capability and platform sections while enforcing field authority and secret boundaries.

## Scope

Sections: `search`, `filters`, `citations`, `features`, `exports`, `sources`, `services`, `ai`, `analytics`, `authentication`, `email`, `generation`, and `processing`.

- Render owner choices only where the contract and authority registry allow them.
- Display platform-provisioned values as status/read-only metadata.
- Add separate credential create/replace/revoke flows without secret readback.
- Integrate generated catalogs and live runtime collection/institution lists where the current runtime exposes them; do not invent a source-connection listing API.

## Design

1. Owner-editable, catalog-derived, platform-provisioned and credential fields use visibly different components and mutation contracts.
2. `sources` is a first-class real section; it is never hidden inside Services or replaced by Meta.
3. Managed service rows show state, endpoint identity and last verification only. They never include a reveal-secret affordance.
4. Credential dialogs accept new secret material once, submit to a server-side encrypted action and clear the input in the triggering handler. Read queries return `configured`, fingerprint/last-four where safe, timestamps and last test result only.
5. Feature/provider options come from pinned catalogs plus real runtime capabilities only where an endpoint exists. Source connection keys are free-form pattern-validated identifiers: validate format and duplicates locally because Evidence Library exposes no source-connection listing endpoint. Collections/institutions may use `/api/collections` and `/api/institutions` when a runtime binding exists.
6. Enforce actual catalogs: `documents`, supported AI providers, supported processing conditions/actions and current locale/icon/font/layout values.
7. Platform status and credential testing use explicit user events or Convex subscriptions only. No polling or state-synchronization effect is introduced.
8. Credential lifecycle paths are derived from and drift-tested against generated `fields.writeOnlyPaths`; presentation metadata must not hand-maintain a second secret-path list.

## TDD sequence

1. Red/green authority renderer tests: editable vs catalog vs managed vs credential; commit.
2. Red/green Search/Filters/Citations/Features/Exports editors; commit per group.
3. Red/green Sources editor with identifier-format and duplicate validation; add endpoint-backed capability controls only after an approved Plan 06 deviation grounds that new contract; commit.
4. Red/green managed Services status surface; commit.
5. Red/green credential create/replace/revoke metadata-only backend and dialog behavior; commit per green.
6. Red/green AI/Analytics/Authentication/Email editors with no secret readback.
7. Red/green Generation/Processing catalogs and compound values.
8. Axe, locale and full scoped persistence tests; refactor.

## Files touched

- remaining section editors under `components/evidence-libraries/configuration/sections/`
- `components/evidence-libraries/configuration/{managed-service-status,credential-dialog,capability-select}.tsx`
- `lib/evidence-libraries/configuration/{authority,capabilities,section-codecs}.ts`
- `convex/evidenceLibraries/{credentials,queries,mutations}.ts`
- component/pure/Convex tests
- locale files

## Migration stance

Breaking cleanup only. If Plan 02 created an incorrect credential shape, revise Plan 02 and wipe the new development tables. No compatibility readers or migrations.

## Test plan

```bash
npm test -- lib/evidence-libraries/configuration tests/components/evidence-libraries convex/evidenceLibraries
npx convex function-spec | rg 'evidenceLibraries'
npm run convex:push
npm run dev:web
```

Explicitly test that serialized queries, DOM, logs and draft section JSON do not contain submitted secrets.

## Deployability gate

After every backend commit, run `npm run convex:push` and require `✔ Convex functions ready!` with no newer `✖ Error`. After every UI commit, run `npm run dev:web` and require a recent `✓ Compiled` with no module/type/compile error. Inspect deployed args/returns validators for every new credential function with `npx convex function-spec | rg 'evidenceLibraries'`.

## Acceptance criteria

- All 13 scoped sections use real schema/catalog values.
- Sources is present and validates free-form connection identifiers without claiming an unavailable provider-list API.
- Managed services cannot be edited as ordinary fields.
- Secrets can be set/replaced/revoked but never read back or stored in section JSON.
- Unsupported prototype values are absent and rejected.
- Admin/member authorization is enforced server-side.
- Tests, locale checks, function spec and both runtime gates pass.

## Known pitfalls

- JSON Schema/catalog artifacts do not contain polished ownership labels, but the catalog does publish `fields.writeOnlyPaths`; use the tested presentation registry for labels and generated write-only paths for secret classification.
- Do not confuse configured status with runtime health.
- Do not expose service URLs that are intentionally private.
- Do not reuse per-user credential tables.
- Do not preserve the prototype's fake OpenRouter, SMTP or Google values.
- Reject prototype-only values explicitly: `fulltext`, `openrouter`, `no-pdf`, `append`, and `replace-system-instruction`. Preserve the real `append-system-instruction` action.
- Render locale catalog values verbatim, including `cn`; do not silently substitute `zh` or preserve absent prototype locales.
