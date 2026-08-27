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
| Citations & exports | `citations.showUrl`, and `exports.{ris,bibtex,atom}` as three switches; the runtime generates every file from its records (Evidence Library `122a7e55`) |
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
  between file text and URL;
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
3. Feature dependency rules are mirrored from Evidence Library `src/config/library-config/schema.ts` lines 1569-1750 at `7c269e10`. The pinned JSON schema has no cross-field rules.
4. ~~The takedown recipient is required on the page even though the schema makes it optional.~~ Changed 2026-08-27 by plan 10: both recipients sit behind a switch and are off by default. Off writes no key.
5. The deployability gate ran as Save + reload on the Convex lane. The Activate/publish check on a development library is still owed by the integration owner.

## Fidelity correction (2026-08-27, commit a42c71ef)

The Sources and Collections cards shipped by lanes B and C did not match the
agreed mock (plain list picker, up/down arrows, a `<details>` "Advanced tag
rules", own copy). They were rebuilt by hand to the mock's components and
words: account panel, group rows with status chip and facts, multi-select
group table, paste a group link, "Advanced" → "Zotero tag rules" as chips;
Collections "Shown on the site" with drag rows, the records chip, "Title on
the site" and the full picker. Reviews for UI work now compare the mock
component against the real one, not the plan text.

## Citations & exports — back to the mock (2026-08-27)

Evidence Library `122a7e55` (PR #139) generates RIS, BibTeX and the Atom feed
from the library's own records and exposes one switch per format
(`exports.ris`, `exports.bibtex`, `exports.atom`). The external file
addresses from PR #101 are gone. The card is the mock again: "Show the URL in
citations" and three switches under "Export formats". Download buttons need
RIS or BibTeX on; the Atom feed link needs Atom on.
