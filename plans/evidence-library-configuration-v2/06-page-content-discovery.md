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
| Contact & legal | `contact`, `email.contactRecipient`, `email.takedownRecipient`, `legal` (links or Markdown text from the legal upload) |
| Search & filters | `search` (fullText, tags, country, authorCountry, scopes, defaultScope), `filters` (institution mode/label/featuredValue, years, collectionsExpanded) |
| Citations & exports | `citations.showUrl`, `exports.{ris,bibtex,atom}` as on/off → the platform fills the URLs (`https://<baseUrl>/api/export/<format>`) at assembly |
| Features | `features` Appearance (themeSwitcher, languageSwitcher), Discovery (collections, collectionNotes, countryFocus as "Country map page", authorFilter, authorLocation, yearsDropdown), Exports (downloads, atomFeed). AI and Accounts groups are not shown; document in the section description that they come later. |
| Languages | `localization` (locales, defaultLocale, detectLocale, localePriority) |
| Analytics | `analytics` (none / posthog host+key / google measurementId) |

Nav targets: page = built-in path; collection = `/lib?collection=<id>`
(confirm the runtime's collection URL in `src/lib/collections.ts` and use it).
Pinned institution uses the institutions picker from plan 07 when present.

## Tests

- `rules.test.ts` additions per section (dependencies, scope/default,
  years order, analytics key formats, takedown recipient required).
- Component tests: feature toggles disable with the right reason and cascade
  off; nav link target switch clears the other target; legal row switches
  between file text and URL; export toggles produce the URLs at assembly
  (assembly test in lane A's file, added here).

## Deployability gate

Same as plan 05 on port 3013: edit every section, Save, Activate; the
development library shows the footer, navigation and legal page changes
after the publish (check the library URL from the lane logs).

## Completion

One PR per two or three sections to keep reviews small. Update
`docs/PROJECT_STATE.md` configuration section at the end.
