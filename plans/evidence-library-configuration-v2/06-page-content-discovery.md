# Plan 06 — Navigation, Footer, Contact & legal, Search & filters, Citations & exports, Features, Languages, Analytics (OpenScholar)

Lane C, after plan 05.

## Goal

The remaining owner sections on the real page, saved through the generic chain.

## Scope

Port each mock section and its rules; wire to the draft sections named:

| Section | Runtime sections written |
|---|---|
| Navigation | `navigation` (links with page/collection/URL targets, icons, children), `features.navbarSearch` |
| Footer | `footer` (sections, social, funders, disclaimer, attribution; `poweredBy` locked on) |
| Contact & legal | `contact`, `email.contactRecipient` and `email.takedownRecipient` behind two switches that are off by default (plan 10), `legal` (links or Markdown text from the legal upload) |
| Search & filters | `search` (fullText, tags, country, authorCountry, scopes, defaultScope), `filters` (institution mode/label/featuredValue, years, collectionsExpanded) |
| Citations & exports | `citations.showUrl`, `exports.{ris,bibtex,atom}` as three optional address fields. Each value is the address of a file the runtime fetches and streams through `/lib/export/ris`, `/lib/export/bibtex` and `/lib/atom.xml` (new-el `src/app/api/exports/[format]/route.ts`, `src/config/library-config/exports.ts`, `config/library.example.json`). It must not point back at the library itself. |
| Features | `features` Appearance (themeSwitcher, languageSwitcher), Discovery (collections, collectionNotes, countryFocus as "Country map page", authorFilter, authorLocation, yearsDropdown), Exports (downloads, atomFeed). AI and Accounts groups are not shown; document in the section description that they come later. |
| Languages | `localization` (locales, defaultLocale, detectLocale, localePriority) |
| Analytics | `analytics` (PostHog host+key and Google measurementId behind two switches; both may be on — plan 10) |

Nav targets: page = built-in path; collection = `/lib?collections=<id>` (the runtime’s real query name, `src/lib/searchParams.tsx`)
(confirm the runtime's collection URL in `src/lib/collections.ts` and use it).
Pinned institution uses the institutions picker from plan 07 when present.

## Tests

- `rules.test.ts` additions per section (dependencies, scope/default,
  years order, analytics key formats, recipients off write nothing).
- Component tests: feature toggles disable with the right reason and cascade
  off; nav link target switch clears the other target; legal row switches
  between file text and URL; export address fields are saved as typed and
  unlock the Download and Atom feature switches only with a valid https address.

## Deployability gate

Same as plan 05 on port 3013: edit every section, Save, Activate; the
development library shows the footer, navigation and legal page changes
after the publish (check the library URL from the lane logs).

## Completion

One PR per two or three sections to keep reviews small. Update
`docs/PROJECT_STATE.md` configuration section at the end.

## Deviations recorded after merge (2026-08-26)

Built in PRs #95, #96, #97 (merged `b4396c9d`, `d4cb0a44`, `9240e9a4`).

1. Collection links use `/lib?collections=<id>`, not `/lib?collection=`.
2. ~~Export URLs are written from `identity.baseUrl` using `/lib/export/ris`, `/lib/export/bibtex`, `/lib/atom.xml`.~~ Corrected 2026-08-27: that made the runtime fetch itself and Cloudflare answered 502. The runtime treats `exports.<format>` as an outside file address it proxies (new-el `src/app/api/exports/[format]/route.ts` at `7c269e10`, docs/evidence-library-operations.md:512). The card now has one address field per format; nothing is built from the public address.
3. Feature dependency rules are mirrored from Evidence Library `src/config/library-config/schema.ts` lines 1569-1750 at `7c269e10`. The pinned JSON schema has no cross-field rules.
4. ~~The takedown recipient is required on the page even though the schema makes it optional.~~ Changed 2026-08-27 by plan 10: both recipients sit behind a switch and are off by default. Off writes no key.
5. The deployability gate ran as Save + reload on the Convex lane. The Activate/publish check on a development library is still owed by the integration owner.
