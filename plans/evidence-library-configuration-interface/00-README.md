# Evidence Library Configuration Interface — Plan Set

Productionize the approved **Anchor rail** direction as OpenScholar's organization-owned Evidence Library configuration surface at `/evidence-libraries/[libraryId]/configuration`.

The standalone HTML is a structural reference only. The implementation must derive its contract from the Evidence Library's generated schema/catalog artifacts, use OpenScholar's existing components and design tokens, keep managed infrastructure and secrets out of ordinary editable fields, and preserve the two-repository ownership boundary.

Last grounded: **2026-08-11**.

## Motivation / gap audit

1. OpenScholar is the research and publishing product, but it has no Evidence Library control-plane entities, organization ownership, configuration drafts, revisions, or activation operations.
2. The selected prototype has the desired long-document/sticky-rail interaction, but it is not schema-accurate: it substitutes a synthetic Meta panel for the required `sources` section and contains invalid catalog values, fake revisions, fake secrets, incomplete validation, and accessibility defects.
3. The Evidence Library already owns a generated JSON Schema, catalog, Zod runtime validator, activation logic, and health readback. Recreating those contracts in OpenScholar would violate DRY and drift immediately.
4. The current Evidence Library runtime activates a filesystem manifest and exposes `active`/`rejected`; it has no remote draft/publish API. OpenScholar must own control-plane draft/revision state while the cross-repository validation/activation transport is designed explicitly.
5. OpenScholar currently has user-centric Clerk/Convex state. There is no organization, membership, Evidence Library, or library-role model.
6. Existing settings components are strong visual and interaction donors, but `/settings` is the wrong route because nesting Anchor rail there would create two rails. `/library` must remain the personal research library.

## Locked design decisions

| ID | Date | Decision | Consequence |
|---|---|---|---|
| D1 | 2026-08-11 | Anchor rail is the approved structural direction. | The other four prototypes are rejected alternatives. Do not preserve a theme or layout switch between concepts. |
| D2 | 2026-08-11 | Production route: `/evidence-libraries/[libraryId]/configuration`. | Keep `/library` personal and avoid the existing settings rail. |
| D3 | 2026-08-11 | Evidence Library generated artifacts are the configuration SSOT. | OpenScholar may commit generated snapshots with provenance and digests, but must never hand-maintain a second 24-section schema. |
| D4 | 2026-08-11 | The real rail contains the 24 runtime sections. Envelope metadata (`schemaVersion`, `revision`, `updatedAt`) lives in the header, not a synthetic section. | Add `sources`; remove the prototype's Meta panel from the rail. |
| D5 | 2026-08-11 | Clerk Organizations are authoritative for organization identity and memberships. | Convex stores a synchronized application projection and always authorizes from authenticated identity plus projected membership. |
| D6 | 2026-08-11 | Initial permission matrix is intentionally small: `org:admin` edits, validates, publishes, rolls back, and provisions; `org:member` is read-only. | No ungrounded custom role framework. A later role change is a clean breaking decision. |
| D7 | 2026-08-11 | OpenScholar owns one mutable draft, immutable configuration revisions, section payloads, operation state, and audit metadata. | Runtime activation does not become the control-plane database. |
| D8 | 2026-08-11 | Secrets and platform provisioning have separate lifecycles. | The browser receives metadata/status only; it never round-trips stored secret values. |
| D9 | 2026-08-11 | Saves, validation, publish, and rollback are explicit user events. | No autosave/watch effect chains and no Convex-to-local-state mirroring. |
| D10 | 2026-08-11 | Native fragment links remain the navigation contract. | Use a smallest-leaf external subscription/observer only for visual current-section state, with cleanup and justification. |
| D11 | 2026-08-11 | Rail order follows the generated schema's top-level key order. | Registry tests assert the exact 24-section set and upstream order; presentation groups may label the sequence but may not silently reorder it. |

## Real contract inventory

Envelope fields:

- `schemaVersion`: literal `1`;
- `revision`: 1–64 character identifier;
- `updatedAt`: strict UTC `Z` timestamp.

Runtime sections, in generated-schema and production rail order:

1. identity
2. institutions
3. theme
4. navigation
5. footer
6. contact
7. legal
8. localization
9. search
10. filters
11. content
12. citations
13. features
14. collections
15. gapMaps
16. exports
17. sources
18. services
19. ai
20. analytics
21. authentication
22. email
23. generation
24. processing

Field-authority classes:

- **control-plane generated:** envelope and operation identities;
- **owner edited:** branding, navigation, presentation, contact/legal, localization, discovery presentation, collections and gap maps;
- **catalog derived:** enumerations, feature/plugin/source capabilities, exports and processing behavior;
- **platform provisioned:** runtime/database/search/storage URLs and operational wiring;
- **credential lifecycle:** AI, SMTP, Google and source/provider credentials.

## Plan-file inventory

```text
plans/evidence-library-configuration-interface/
├── 00-README.md
├── 01-ownership-and-generated-config-contract.md
├── 01-SOL-REVIEW.md
├── 02-drafts-revisions-and-authorization.md
├── 02-PREREQUISITES.md
├── 03-route-shell-and-anchor-rail.md
├── 04-brand-content-and-collection-editors.md
├── 05-discovery-and-platform-editors.md
├── 06-validation-publish-rollback-handoff.md
├── 07-accessibility-browser-and-release-gates.md
├── FABLE-5-REVIEW.md
└── PROMPTS.md
```

## Dependency graph

```text
01 generated contract + ownership rules
 └──► 02 Convex ownership/drafts/revisions
       └──► 03 route shell + Anchor rail
             ├──► 04 brand/content/collection editors
             └──► 05 discovery/platform editors
                    └──► 06 validate/publish/rollback handoff
                           └──► 07 accessibility/browser/release gates
```

Execution order is strict: `01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07`.

## Reuse / DRY notes

- Extract/generalize the visual shell from `app/settings/layout.tsx`; do not copy its full route layout or its effect-based pages.
- Reuse rail styling from `components/settings/sidebar-nav.tsx`, but replace pathname selection with fragment navigation.
- Reuse `components/ui/{button,input,select,switch,checkbox,label,textarea,badge,alert,separator,dialog,popover}.tsx`.
- Reuse ordered-row interaction patterns from `components/extraction/question-builder.tsx` and render-derived catalog selection from `components/settings/server-model-section.tsx`.
- Reuse centralized authenticated access patterns from `convex/extraction/access.ts` and the existing Clerk webhook verification pipeline under `convex/webhooks/`.
- Reuse server-side encryption and metadata-only readback patterns from `convex/apiKeys/actions.ts`; do not reuse its per-user ownership.
- Reuse behavioral `data-*`, Testing Library, axe, and Playwright patterns from the billing transaction suite.
- Generated `new-el` JSON Schema/catalog snapshots are allowed outputs. Their generator, provenance lock, and drift verifier are mandatory; manual edits are forbidden.

## Testing doctrine

- TDD pure contract/path/registry/validation code before UI work.
- TDD every Convex permission, optimistic-concurrency, immutable-revision, secret-metadata and operation-state transition with `convex-test`.
- Assert behavior through roles, accessible names, ARIA, `data-*` state, persisted backend state and returned receipts. Never assert Tailwind/class strings.
- Use component tests for interactive leaves; use Playwright for async Server Components, authenticated routing, focus/scroll behavior, responsive rail behavior and the real publish journey.
- Run axe without disabling structural rules.
- The prototype is not an expected screenshot. Production screenshots are reviewed against OpenScholar's real design system and the selected structural intent.

## Migration stance

- This is a pre-testing system. New tables and contracts are breaking by default.
- Do not create compatibility shims, old/new readers, feature-flag fallbacks, optional legacy fields, or `@convex-dev/migrations` scripts.
- If dev rows block a narrowed validator, wipe only the affected development tables and recreate fixtures.
- Generated-contract version changes fail closed with a clear drift error; they do not silently coerce old drafts.

## Delegation policy

- Exploration was split into UI donors, cross-repository contract mapping, and test/plan conventions.
- During execution, one agent owns one numbered plan at a time.
- Do not execute plans 04 and 05 concurrently if they touch the same generic field or registry files.
- The main session owns plan deviations, commits, PM2 gates and final acceptance.
- Every agent touching `convex/`, `app/` or `components/` must report both tests and the required PM2 success lines.

## Cross-repository boundary

OpenScholar owns:

- organization/library identity and authorization projection;
- draft editing, immutable revision history and audit;
- presentation metadata for the configuration editor;
- validation/publish/rollback orchestration and user-visible operation state.

Evidence Library owns:

- the runtime configuration schema and catalogs;
- authoritative cross-field validation;
- manifest activation, last-valid retention and health readback;
- runtime secrets consumption and runtime behavior.

A separate agent owns the MEE DOI/Crossref/Zenodo deposit worker in the Evidence Library repository. This plan set may touch only `src/config/library-config/**`, `src/app/api/library-config/**`, `public/library-config.*.json`, `tools/*LibraryConfig*.ts`, and `docs/` there—and only with separate authorization. The configuration and deposit-worker surfaces are disjoint and must remain so.

Plan 06 must stop with `06-BLOCKER.md` if the authenticated validation/activation/receipt-and-digest-bearing-health contract genuinely does not exist when execution reaches it. Do not disguise filesystem access or shared database writes as the product contract.

## Grounding sources

OpenScholar:

- `AGENTS.md`
- `design-prototypes/library-config/01-registry-ledger.html`
- `app/settings/layout.tsx`
- `components/settings/sidebar-nav.tsx`
- `components/settings/server-model-section.tsx`
- `components/extraction/question-builder.tsx`
- `components/app-sidebar.tsx`
- `components/auth/auth-route-gate.tsx`
- `convex/schema.ts`
- `convex/lib/validators.ts`
- `convex/extraction/access.ts`
- `convex/webhooks/clerk.ts`
- `convex/webhooks/actions.ts`
- `convex/apiKeys/actions.ts`
- `lib/auth/use-auth-query.ts`
- `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`
- `node_modules/next/dist/docs/01-app/02-guides/forms.md`
- `node_modules/next/dist/docs/03-architecture/accessibility.md`
- `convex/_generated/ai/guidelines.md`

Evidence Library:

- checkout root: `/Users/mcharrad/Documents/Github/new-el-optimize`
- remote repository: `OpenDevEd/new-el`
- grounded branch: `openscholar`
- all Evidence Library paths below are relative to that checkout; its folder name does not match the repository name
- `src/config/library-config/schema.ts`
- `src/config/library-config/catalogs.ts`
- `src/config/library-config/primitives.ts`
- `src/config/library-config/artifacts.ts`
- `src/config/library-config/activation.ts`
- `src/config/library-config/source.ts`
- `public/library-config.schema.json`
- `public/library-config.catalogs.json`
- `tools/generateLibraryConfigArtifacts.ts`
- `docs/evidence-library-customization-map.md`
- `docs/evidence-library-operations.md`

Current primary documentation:

- Clerk Organizations, active organization and default roles/permissions.
- Convex Clerk authentication, custom claims and authenticated Next.js access.
- Ajv JSON Schema/TypeScript/format and standalone-validation guidance.

## Completion definition

This plan set is complete only when an authenticated organization admin can open the real Anchor rail, edit all owner-controlled sections, see managed fields without exposed secrets, save and reload a durable draft, validate against the authoritative contract, publish idempotently to the correct Evidence Library, observe exact activation health, roll back by creating a new revision, and pass all unit, Convex, accessibility, browser and PM2 gates.
