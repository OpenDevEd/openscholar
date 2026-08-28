# Evidence Library configuration, version 2

Turn the click-through mock (branch `feat/library-interface-mock`, folder
`components/evidence-libraries/mock/`, plan
`plans/evidence-library-full-configuration-mock/00-README.md`) into the real
configuration page, and add the platform pieces it needs.

Decided with the user on 2026-08-26. Last checked: 2026-08-26.

## The problem

The real page (`components/evidence-libraries/configuration/evidence-library-configuration-shell.tsx`)
exposes four sections through a hand-written chain that repeats the section
list in 18 places. The mock shows the page owners actually need: fourteen
sections, uploads, pickers fed by the library's own data, a Versions section,
and an Update button for new Evidence Library software. The runtime cannot
answer machine calls yet, so pickers have nothing to read.

## Fixed decisions

1. Sections this version: Identity, Theme, Institutions, Navigation, Footer,
   Contact & legal, Collections, Search & filters, Citations & exports,
   Features (Appearance, Discovery, Exports groups only), Languages, Analytics,
   Versions. Deferred: AI, Domain, Team & visibility (only organisations for
   now), Accounts features (login, Google sign-in, user collections).
2. The mock components replace the current shell entirely. The rules in the
   mock plan (type scale, copy, grouping, shared controls, facts without dots,
   no vendor names) are binding for the real page.
3. Sections travel as `{ sectionKey, payload }` rows. Each payload is checked
   against the pinned runtime schema slice for that section. Hand-written rules
   stay only where the runtime cannot check: `identity.baseUrl` is fixed,
   `footer.poweredBy` stays on, and the inline rules the form shows.
4. Assembly merges every owner section over schema defaults and platform
   values. No section list is written by hand outside the section registry.
5. Cross-field rules: the form shows the ones it can (feature dependencies,
   language switcher needs two languages, downloads need an export). The full
   validator still runs at assembly; an assembly failure is shown on the page
   as a list of issues, not hidden in the operation.
6. Owners configure. Editors get only the library's `/admin`. No per-library
   grants this version.
7. Uploads go to the existing Supabase storage in one platform bucket named
   `openscholar` (public). Browser sends the file to a Convex action; the action
   checks type and size, writes `evidence-libraries/<libraryId>/<kind>-<hash>.<ext>`,
   deletes the file it replaces, and returns the public URL that goes into the
   section. Draft libraries can upload; nothing per library is created.
8. Zotero: an owner connects a group using their own connected Zotero account
   (OpenScholar already stores it, encrypted, per user). The group row records
   who connected it and when. A copy of that owner's key is stored as a library
   credential keyed by group id, checked against Zotero `keys/current` for read
   and write scope. At assembly each `sources[]` entry receives its own group's
   key. Any owner can reconnect a group.
9. Update flow: the runtime binding records the Evidence Library commit the
   library runs. Opening the configuration page calls one action that returns
   `{ running, latest, changes }` from the GitHub API with a ten-minute cache
   row. Update is the publish pipeline with a new `git_commit_sha` and the same
   manifest, flagged `kind: "runtime"` on the operation and the version row.
   Updates are opt-in per library and never forced.
10. Restore: a new revision copying the chosen revision's sections, with
    `rollbackOfRevisionId` set, then the normal publish.
11. Runtime (`OpenDevEd/new-el`, `main`) adds: `GET /api/openscholar/collections`,
    `GET /api/openscholar/institutions` (bearer = the library's machine
    credential), and `legal.privacyMarkdown` / `cookieMarkdown` /
    `termsMarkdown` rendered by the existing PolicyPage. No validate endpoint.
12. No autosave. Save writes changed sections; Activate freezes all sections.
    Per-section "Reset changes" reads the last saved row.

## The plans

| Plan | File | What it covers |
|---|---|---|
| 01 | `01-runtime-read-api-and-legal-markdown.md` | Runtime read API and legal markdown |
| 02 | `02-generic-sections.md` | Generic configuration sections |
| 03 | `03-uploads.md` | Owner uploads |
| 04 | `04-update-and-restore.md` | Runtime update and revision restore |
| 05 | `05-page-shell-and-brand.md` | Page shell and brand |
| 06 | `06-page-content-discovery.md` | Page content and discovery |
| 07 | `07-sources-and-data-pickers.md` | Sources and data pickers |
| 08 | `08-versions-team-and-cleanup.md` | Versions, team and cleanup |
| 09 | `09-library-pages.md` | Library pages |
| 10 | `10-defaults-and-team.md` | Defaults and team |
| 11 | `11-address-reservation-and-recovery.md` | Address reservation and recovery |
| 12 | `12-organisation-gate.md` | Evidence Libraries switched on per organisation in Clerk |
| 13 | `13-large-list-pickers.md` | Server-driven pickers for institutions, collections, link targets and groups |
| 14 | `14-admin-handoff.md` | `/admin` redirects to OpenScholar, which signs in, checks access and sends the cookie back |
| 15 | `15-runtime-ai-analytics-merge.md` | Merge `ai-modernization` into the runtime; AI section (OpenRouter only); analytics fields; logo sizing |
| 16 | `16-custom-domains.md` (+ `16-RESEARCH.md`) | Custom domains: CNAME to `cname.opendev.space`, Cloudflare for SaaS, four verification gates, redirect toggle |
| 18 | `18-safe-stored-configuration-upgrades.md` | Clean stale development rows and show the right recovery for configuration failures |

## Lanes and order

Three lanes with disjoint write-sets. The integration owner (this session)
creates worktrees and Convex Cloud lanes, merges, uploads merged `dev` to the
shared deployment, and updates Outline.

| Lane | Repo | Plans | Owns |
|---|---|---|---|
| A · Platform | openalex-count | 02, 03, 04 | `lib/evidence-libraries/configuration/**`, `convex/evidenceLibraries/**`, `convex/crons.ts`, `convex/http.ts` |
| B · Runtime, then Data | new-el, then openalex-count | 01, then 07, 08 | new-el `src/app/api/openscholar/**`, `src/config/library-config/schema.ts`, `src/lib/policy-documents.ts`; then OpenScholar `convex/zotero/**`, `components/evidence-libraries/configuration/sections/{sources,collections,institutions,versions}*` |
| C · Page | openalex-count | 05, 06 | `components/evidence-libraries/configuration/**` except the files lane B owns, `app/evidence-libraries/**`, `messages/*.json` keys under `evidenceLibraryConfiguration` |

Merge order: 01 (runtime) → contract re-pin by the integration owner → 02 →
05 and 07 in parallel → 06 and 08 → 03 and 04 whenever ready. Lane C and lane
B's OpenScholar work start only after plan 02 is on `dev`.

Each OpenScholar lane has its own worktree with its own `npm ci` (no shared
`node_modules`), its own Convex Cloud dev deployment (`dev/agents/<lane>`,
14-day expiry, usage caps as in the previous sprint), its own `.env.local`
from `dev-cloud` plus `convex deployment select`, and its own Next port
(3011 A, 3012 B, 3013 C). Only lane B may create disposable libraries in the
development Coolify environment and it must remove them before its PR.

Plans 01-16 used two read-only reviewers per PR. Work started on or after
2026-08-29 gets one Fable-5 review at the end of each complete phase, following
the current rules in `AGENTS.md`. Agents never merge. After each merge the integration owner runs
`npm run convex:push` from `dev-self`, reads remote logs, does the browser
check, and updates Outline.

## Existing code to reuse

- Section registry and JSON-pointer helpers:
  `lib/evidence-libraries/configuration/section-registry.ts`.
- Pinned schema, catalogs, precompiled validators and sync:
  `lib/evidence-libraries/configuration/generated/**`, `contract-sync.mjs`,
  `scripts/sync-evidence-library-config-contract.mjs`.
- Draft, revision, section rows and freeze: `convex/evidenceLibraries/mutations.ts`,
  `sectionPayload.ts`, `draftVersion.ts`.
- Deployment pipeline: `configurationDeployment.ts`, `configurationDeploymentActions.ts`,
  `coolifyClient.ts`, `readinessClient.ts`.
- Credentials: `credentials.ts`, `credentialActions.ts`, `runtimeCredentials.ts`.
- Zotero OAuth and groups: `convex/zotero/actions.ts` (`startOAuth`,
  `completeOAuth`, `fetchGroups`), `convex/zotero/internal.ts`.
- Mock UI to promote: `components/evidence-libraries/mock/**` on branch
  `feat/library-interface-mock` (shared controls in `config/fields.tsx`,
  sections in `config/*-section.tsx`, rules in `lib/evidence-libraries/mock/data.ts`).
- Supabase storage client used by setup: `convex/evidenceLibraries/storageSetupClient.ts`.

## Test rules

Follow `docs/test-quality.md` and the `test-decision` skill. Test behaviour:
validators, assembled manifests, mutation results, rendered text and roles.
No CSS, no copy-only tests. Each plan names its tests.

## Migration

Development data is disposable. Drafts saved by the old four-section chain
are re-saved by the new page on first Save. Nothing else is migrated.

## Deployability gates

Convex: `npm run convex:push` from `dev-self` ends with
`✔ Convex functions ready!`; `npm run logs:convex` shows no matching error.
Web: `npm run dev:web`, open the changed page signed in, no compile or
runtime error in the terminal. Runtime: new-el CI green including Fallow and
runtime acceptance; endpoints checked against a development library.

## Cleanup (plan 08, enforced)

Delete the Convex Cloud lanes and worktrees, confirm no sprint containers
(`el-*` acceptance stacks) are left running — never touch the user's own
containers such as `what2` or `minio` — and no orphan `runSearchIndexer`, remove
`components/evidence-libraries/mock/` and branch `feat/library-interface-mock`
once the real page has replaced it.

## Sources

- Mock plan: `plans/evidence-library-full-configuration-mock/00-README.md`
  (branch `feat/library-interface-mock`).
- Outline: Current decisions `636ce019-6fe6-4a4e-918b-95e0912cc92d`
  (rows dated 2026-08-26), Integration contract `ff15f65c-bf85-48b3-baf5-e849f85cde41`.
- Runtime facts: `new-el` `main` at `c353b55b` (`src/config/library-config/schema.ts`,
  `docker/compose.library.yaml`, `src/lib/admin/http.ts`, `src/lib/policy-documents.ts`).
- Previous sprint transcript lessons: see `docs/agent-sprint-lessons.md` (plan 08 writes it).

## Sprint infrastructure (created 2026-08-26)

| Lane | Worktree | Branch | Convex Cloud deployment | Port |
|---|---|---|---|---|
| A · Platform | `openscholar/platform-sprint` | `codex/generic-sections` (then uploads, runtime-updates) | `dev/agents/platform` = `lovable-clownfish-245` | 3011 |
| B · Runtime | `new-el-runtime-api` | `codex/openscholar-read-api` | none | — |
| B · Data | `openscholar/data-sprint` | `codex/lane-data` (renamed per plan) | `dev/agents/data` = `bright-stork-673` | 3012 |
| C · Page | `openscholar/page-sprint` | `codex/lane-page` (renamed per plan) | `dev/agents/page` = `calm-labrador-815` | 3013 |
| R · Runtime (plan 13) | `new-el-pickers` | `codex/institutions-paging` | none | — |
| P · Pickers (plan 13) | `openscholar/pickers-sprint` | `codex/large-list-pickers` | `dev/agents/page` = `calm-labrador-815` | 3013 |
| R2 · Runtime (plan 14) | `new-el-admin-handoff` | `codex/admin-handoff` | none | — |
| O · OpenScholar (plan 14) | `openscholar/admin-handoff` | `codex/admin-handoff` | `dev/agents/data` = `bright-stork-673` | 3012 |
| M · Runtime merge (plan 15) | `new-el-merge` | `codex/merge-ai-modernization`, then `codex/logo-fit` | none | — |
| A · OpenScholar (plan 15) | `openscholar/ai-sprint` | `codex/ai-openrouter-analytics` | `dev/agents/page` = `calm-labrador-815` | 3013 |
| D · Domains (plan 16) | `openscholar/domains-sprint` | `codex/custom-domains` | `dev/agents/data` = `bright-stork-673` | 3012 |

All three lane deployments expire 2026-09-09, carry daily usage caps, and hold
the cloud dev env plus the `EL_*` values (each with its own `EL_CONVEX_SITE_URL`).
Every deployment that creates or updates libraries also needs the platform
mail values `EL_SMTP_HOST`, `EL_SMTP_FROM`, `EL_SMTP_PORT`, `EL_SMTP_SECURITY`,
and optionally `EL_SMTP_USERNAME` and `EL_SMTP_PASSWORD`. Without them,
libraries with a contact or takedown recipient are refused before setup.
Delete them in plan 08.
