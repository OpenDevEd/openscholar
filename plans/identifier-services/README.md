# Identifier services: Crossref, Zenodo and DOCiD as modules

Milestones: OS-35 (openscholar #1509 to #1512), EL-41 (evidence-community #934). Working rules:
[`AGENTS.md`](../../AGENTS.md) and [`docs/agents/project.md`](../../docs/agents/project.md).

## Problem

Openscholar Reports and communities register records with two fixed registrars, Crossref and Zenodo, wired by name
through settings, report fields, the registrar action and `@opendeved/doi-sync-core`. Björn committed Openscholar (19
Nov 2026) to give Africa Evidence Week Publithon reports a DOCiD from 28 Nov 2026. DOCiD is the Africa PID Alliance's
identifier: a Handle under `20.500.14351`, minted by TCC Africa's service. Other partners may want a DOCiD instead of a
DOI, or let authors choose. Adding DOCiD as a third hard-wired name would repeat the problem for the fourth.

## Decisions (Mohammed, 2026-11-23)

1. An identifier service is a module. Each publisher (Openscholar Reports, each community) holds a list of services,
   each with a mode (`required`, `optional`, `off`) and an add-on price.
2. A choose rule `{ from, min, max }` over the services decides what an author may pick. AND, OR, "either or both" and
   "exactly one" are all settings. Which one a publisher uses is its admin's setting, never fixed in code.
3. Which chosen identifier the byline prints comes from an ordered `citeFirst` list. Whether a DOCiD may be first is
   a setting too. A DOCiD printed in the byline must exist at signing, so that setting mints it then.
4. Price is the licence price plus the add-on of each service chosen. No bundle discounts.
5. Communities get this in the same build as Reports.
6. 2026-11-23, later the same day (Mohammed): communities don't register DOCiDs for now. They show the DOCiD a
   record comes with (an Openscholar report added to the community, or a source record that has one) and handle it
   properly: record page, record editor, search. Communities get no DOCiD account. Replaces the community part of 5.
   Proof: evidence-community #934 rewritten, #935.
7. 2026-11-23 (Mohammed): nothing mints a real DOCiD until a deposit and a retirement can follow it, so the first
   real mint waits for TCC to allow our account a resource type.

## Settings shape

Stored with the publisher's publication settings (`convex/evidenceLibraries/publicationValidators.ts`, shared by
Reports and communities):

```ts
identifiers: {
  services: {
    crossref: { mode: "required" | "optional" | "off", price: number },
    zenodo:   { mode, price },
    docid:    { mode, price },
  },
  choose: { from: ServiceId[], min: number, max: number },
  citeFirst: ServiceId[],
}
```

Each service keeps its account settings where they are today (`crossref`, `zenodo`), and DOCiD gets the same kind of
block: `docid: { mode: "off" | "custom", email }` with the password in the encrypted credentials. Rules the settings
can't break are checked on save, with the reason named at the field: a service in `citeFirst` must be able to reserve
before review (Crossref always; DOCiD only when minting at signing is on), `min <= max <= from.length`, a required
service is always chosen, and the existing "Crossref needs Zenodo" rule (#1465) becomes a service dependency
(`zenodo` needed when `crossref` is chosen) rather than a special case.

## Modules

`@opendeved/doi-sync-core` gains a DOCiD target beside Crossref and Zenodo, with the same planner operations: create,
update, withdraw (DOCiD's soft delete, which leaves a tombstone), reinstate (its restore). Each service declares what
it can do: the identifier it gives (DOI or Handle), whether it can reserve before review, whether it accepts an
existing DOI, whether it archives the file. Openscholar and new-el read those declarations instead of naming
providers.

DOCiD facts the module is built on (DOCiD source `Africa-PID-Alliance/DOCiD` at `962837a`, live API checked
2026-11-23):

- Auth: `POST /api/v1/auth/login` gives `token` and `refresh_token` (24 h); `POST /auth/refresh` gives `access_token`.
- Mint: `POST /api/v1/cordoi/assign-doi/container-id` `{ title, description }` with an `Idempotency-Key` header
  returns the Handle. Every mint is a real, permanent Handle, including on `docid-demo`. Limits default to 5 a minute
  and 100 a day per account; minting is on in production.
- Deposit: `POST /api/v1/publications/publish`, multipart: `documentDocid`, `documentTitle`, `documentDescription`,
  `resourceType` (id), `doi`, `creators[i][…]` (role `8` is Author; one identifier per creator),
  `organization[i]`/`organizationRor[i]`, `funders[i]`, `projects[i]`, `filesPublications[i]` with
  `filesPublications_i_file`, `publicationPoster`.
- A deposit with a DOI skips DOCiD's background push of the full record to its Handle registry (`tasks.py:46-52`).
- Later DOI: owner-only `PUT /api/v1/publications/update-publication/<id>`.
- Withdraw and reinstate: owner-only soft delete and `POST /<id>/restore`; the Handle keeps resolving to a tombstone.
- Resource types are filtered by the account's category. Our account (user 203) returns none until TCC changes it.

Sample deposits: `~/Documents/docid-samples/*.docid-deposit.json`.

## Reports (openscholar)

- `reports`: replace `registration`, `deposit`, `archive`, `zenodoDoi`, `zenodoRecordId`, `zenodoDraftId` and
  `archiveOwnerId` with `registrations: Record<ServiceId, { state, id?, recordId?, draftId?, ownerId?, error?, tries? }>`
  and `chosen: ServiceId[]`. `providersOf`, `stepsOf`, `registration.ts`, `registrar.ts` and the report page read the
  map.
- Signing: when the choose rule leaves a choice, the agreement step offers the optional services with their add-on
  price; otherwise nothing new shows. The price shown and charged is licence price plus add-ons
  (`lib/reports/report.ts` `priceOf`, `payment`).
- Byline: `{identifier}` prints the first chosen service in `citeFirst`; `{doi}` stays for Crossref.
- Admin > Publications: the services table (mode, price), the choose rule, `citeFirst` and the DOCiD account.
- The report page and its metadata list every identifier it has.

## Communities (evidence-community)

Display only (decision 6). A record keeps its DOCiD as an Extra line `DOCiD: 20.500.14351/…`, as Zotero keeps
identifiers it has no field for, or as its hdl.handle.net address (`src/lib/docid.ts`). Openscholar sends a report's
`docid` with the reports a community adds by DOI; new-el's schema takes it as optional, so either side can ship first.
The record page's Identifiers list it, the record editor shows it read-only, and search finds it through Extra.

## Data migration

None needed for this build. Every new field is optional with a default read in code: `reportSettings.identifiers`
(DEFAULT_IDENTIFIERS), `publication.docid` (absent is off, and communities never set it), `registration.docid` and
`registration.cited` (absent is no DOCiD and a cited Crossref DOI), and `reports.registrations.docid`. A report with
only a DOCiD has an empty `doi`; lookups by DOI skip empty ones.

Crossref and Zenodo still keep their own report fields (`deposit`, `archive`, `zenodo*`) beside the `registrations`
map that DOCiD uses. Moving them into the map is a separate widen, migrate and narrow, with `@convex-dev/migrations`
on shared dev and then prod, after this build is live.

## Order

1. doi-sync-core DOCiD target and declarations, with tests against recorded DOCiD responses. No live mints.
2. Reports settings, migration (widen), registrar and byline. Admin and signing UI as a mock first; built on "Build it".
3. Community config, new-el schema and worker, Identifiers card; contract re-pin.
4. First real DOCiD deposit on shared dev once TCC unlocks our account, then prod with Openscholar's DOCiD account.
5. Narrow the migration.

## Checks

- doi-sync-core: unit tests for the DOCiD mapper, client (recorded responses), planner operations.
- openscholar: Vitest for settings rules, price, choose rule, migration step; `npx tsc --noEmit`; the publish flow in a
  browser on a throwaway Convex project (never convex-e2e) with Crossref and Zenodo sandboxes and DOCiD stubbed.
- new-el: unit tests for schema and worker planning; touched admin specs.
- Live gate: one real DOCiD deposit for a published report on shared dev, resolved through `hdl.handle.net`.

## Risks

- DOCiD's account category blocks deposits until TCC changes it.
- 100 mints a day per account by default; Björn's target is 1,000 DOIs in the week.
- Deposits with a DOI keep only title and description in DOCiD's Handle registry until TCC changes `tasks.py`.
- Recent DOCiD Handles (September onward) did not resolve on `hdl.handle.net` when checked on 2026-11-19.
