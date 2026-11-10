# Registrars get all the metadata

Milestones OS-33 (`OpenDevEd/openalex-count`, #1250, #1251) and EL-37
(`OpenDevEd/new-el`, #827).
Workflow rules live in the root `AGENTS.md` and `docs/agents/project.md` of each
repository. This file holds what Crossref and Zenodo accept, what we hold, how
each field maps, the order of work and when it is done.

## Problem

Openscholar Reports and new-el's communities register DOIs with Crossref and
archive records on Zenodo through `@opendeved/doi-sync-core`. Both deposits
carry a small part of what the registrars accept and we hold. Crossref gets no
subtitle, roles, affiliation identifiers, licence or full-text link; Zenodo
gets no funders, references, links, subjects, places, roles or affiliation
identifiers. Each missing field is metadata that indexes (OpenAlex, Google
Scholar, OpenAIRE, Crossref's own search) never see.

## Decision (2026-11-10, the user)

Every deposit carries every field the registrar accepts that we can supply,
for reports and for community records alike. An issue's list of fields is a
floor. The fields we can't fill are listed below with the reason.

## What the registrars accept

Sources: Crossref's schema 5.5.0 (`doi-sync-core/src/__tests__/fixtures/crossref-schema-5.5.0`),
Zenodo's legacy deposit API (developers.zenodo.org, "Deposit metadata") and
InvenioRDM's metadata reference (inveniordm.docs.cern.ch/reference/metadata),
checked against Zenodo's sandbox on 2026-11-10: a draft with every field below
was created, read back in the InvenioRDM format with each field kept, and
deleted.

**Zenodo's legacy deposit API can't carry most of it.** It takes one
affiliation per person and no ROR, grants only for 26 listed funders, and no
subtitle, roles, sizes, formats or copyright. The package writes metadata
through it today. Zenodo's InvenioRDM API, which the package already uses to
read records and publish drafts, takes all of it. Metadata writes move there:
`PUT /api/records/{id}/draft` with the InvenioRDM body, on the draft the
package already opens. An affiliation or funder ROR that Zenodo's vocabulary
lacks is refused (400 "Invalid value"), so each one is looked up first
(`GET /api/affiliations/{ror}`, `GET /api/funders/{ror}`, 200 or 404) and sent
by name when missing.

## Field map

Legend: **now** is sent today, **new** is added by this plan, **none** has no
place at that registrar or nothing to fill it.

### People and organisations

| Field | Report holds | Community record holds | Crossref | Zenodo |
|---|---|---|---|---|
| Name, given and family | yes | yes | now | now |
| ORCID iD | yes | no | now | new: `identifiers` (orcid) |
| Organisation as author | yes | yes | now | now, new: ROR when known |
| Role | CRediT roles | Zotero creator type | new: `<role vocab="credit">` per role; editors, translators as `contributor_role` | new: editors and the rest as `contributors` with their role; creators keep the author list |
| Corresponding author | yes | no | new: `<role vocab="crossref" type="corresponding-author">` | new: role `contactperson` |
| Affiliations | all, with OpenAlex ID and country | all, with OpenAlex ID and country | new: every one, `institution_id type="ror"`, `institution_place` from the country | new: every one, ROR id when in Zenodo's vocabulary, else name |

ROR comes from OpenAlex (`ids.ror` on institutions and funders), looked up in
one batched request per deposit, the way funders' Registry DOIs are today.

### The work

| Field | Report | Community record | Crossref | Zenodo |
|---|---|---|---|---|
| Title | yes | yes | now | now |
| Subtitle | yes | `shortTitle` is not one: none | new: `<subtitle>` (title stops carrying it) | new: `additional_titles` subtitle |
| Abstract | yes | yes | now | now |
| Language | yes | yes | now | new: `languages` (ISO 639-3) |
| Date | yes | yes | now | now |
| Licence | CC BY 4.0 | the community's licence | new: `ai:program` with `free_to_read` and `license_ref applies_to="vor"` | now as legacy id, new: `rights` |
| Copyright | the authors, the year | none | none | new: `copyright` "© year The authors" |
| Keywords | yes | public tags | none | now as keywords, new: `subjects` |
| Topics | OpenAlex topics | library topics | none | new: `subjects` |
| Goals (SDGs) | yes | none | none | new: `subjects` "SDG n: name" |
| Study design | yes | `studyType` | none | new: `additional_descriptions` methods |
| Places studied | country codes | `countryFocus` | none | new: `locations`, by place name |
| Pages | from the PDF | `numPages`, `pages` | now where the family has pages | new: `sizes` "N pages" |
| Format | PDF | the file's type | none | new: `formats` |
| Version | none | `versionNumber` | now (datasets) | new: `version` |
| Publisher | Openscholar | yes | now | now, new: `publisher` |
| Series and ISSN | yes | `series`, `ISSN` | now (reports) | new: `additional_descriptions` series-information, related `isPartOf` ISSN, `imprint:imprint` title |
| Journal | none | `publicationTitle`, `ISSN`, `volume`, `issue`, `pages` | now | new: `journal:journal` |
| Book, chapter, place, ISBN, edition | none | yes | now | new: `imprint:imprint` |
| Conference | none | yes | now | new: `meeting:meeting` |
| Thesis | none | `university`, `thesisType` | now | now university, new: `thesis:thesis` type |
| Item number | `R…` key | `reportNumber`, `number` | now | new: `identifiers` scheme other |
| Landing page | `/papers/R…` | `/lib/<key>` | now | now in the description, new: `identifiers` url |
| Full text | PDF address | PDF address | new: `collection property="text-mining"` and `crawler-based` `similarity-check` items | the file itself, now |
| Withdrawn | yes | none | now (title) | new: `dates` withdrawn |

### Funding, references and links

| Field | Report | Community record | Crossref | Zenodo |
|---|---|---|---|---|
| Funder | OpenAlex funder or typed name | none today | now with Registry DOI, new: `ror` assertion | new: `funding.funder` ROR id, else name |
| Award numbers | yes | none | now | new: one `funding` entry per award, `number` and `title` |
| Cited DOIs | yes | `itemLink` kind cites, to items with a DOI | now (reports), new (records) | new: `references` with the DOI as identifier |
| Data, code, versions, supplements | yes | `itemLink` related, Zotero `relations` | now (reports), new (records) | new: `related_identifiers` with scheme and relation |
| Archive link (Zenodo copy) | yes | yes | now | none (Zenodo is the archive) |

### What stays unsent, and why

- Crossref keeps no keywords, topics, goals, places, study design or copyright:
  its schema has no place for them.
- A community record's creators have no ORCID iD, and its funders aren't
  stored: new-el reads neither from Zotero or OpenAlex today. Out of scope here;
  a follow-up can read them from OpenAlex when a record has an OpenAlex work.
- Places go by name: neither a report nor a record holds GeoNames IDs, which Zenodo's `locations` could also take.
- A report's registration revision isn't a version of the work, so neither registrar gets it as one.
- Crossref's `archive_locations` lists named archives (CLOCKSS, Portico and
  others). Zenodo isn't one, so it stays empty.

## Shape of the change

One owner per invariant:

- **`@opendeved/doi-sync-core` owns the registrar formats.** `PublicationMetadata`
  gains the fields above in registrar-neutral terms (affiliations with ROR and
  country, creator identifiers and roles, subjects, locations, sizes, formats,
  copyright, version, withdrawn date, full-text URL, series, journal, imprint,
  meeting). The Crossref XML writer and a new InvenioRDM Zenodo writer map them;
  Zenodo verification reads the InvenioRDM shape back. A record that leaves a
  field out deposits as before, so its payload hash moves only when it has
  something new to send.
- **Openscholar owns a report's record** (`lib/reports/registration-record.ts`,
  `convex/reports/registrar.ts`) and the ROR lookups it needs.
- **new-el owns a community record's mapping** (`src/lib/publication/record-metadata.ts`
  and the worker that loads the record, its links and its file).

## Data

No stored data changes shape. New fields are read from what reports and items
already hold, plus OpenAlex at registration time. Every published record's
payload changes once, so the next sync redeposits it at both registrars:
Crossref charges for a DOI's first registration, not for updates (crossref.org/fees), and a Zenodo metadata edit makes no new version.

## Order

1. Package: neutral fields, Crossref writer, InvenioRDM Zenodo writer and
   verification. Checks: `npm run verify`, every Crossref family against the
   5.5.0 XSD, a sandbox create, edit and read-back at Zenodo.
2. Openscholar: a report's record with every field, ROR lookups, the Zenodo
   vocabulary check. Checks: `convex/reports` tests; a live correction on the
   throwaway backend read back from both sandboxes.
3. new-el: a community record with every field it holds. Checks: its
   publication tests; one record published to both sandboxes from a local or
   dev library and read back.

## Done when

- A report and a community record deposited to both sandboxes read back with
  every field in the map that they hold.
- The Crossref XSD test covers every new element in every family.
- Production libraries get it with their next runtime update, which the user
  starts: it redeposits every published record once.

## Risks

- A ROR in OpenAlex that Zenodo's vocabulary lacks: looked up first, sent by
  name.
- Zenodo rate limits during the one-time redeposit of a large library: the
  worker's existing pacing and retries apply.
- InvenioRDM write rejections not seen in the sandbox: every refusal keeps
  Zenodo's message, as Crossref's now do.
