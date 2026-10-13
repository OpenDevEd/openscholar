# Evidence Library records in OpenScholar

Milestones OS-23 (`OpenDevEd/openalex-count`) and EL-28 (`OpenDevEd/new-el`).
Workflow rules live in the root `AGENTS.md` and `docs/agents/project.md` of each
repository. This file holds the decisions, the paper identity, the contract
between the two systems, the data migration, the stages and when each is done.

## Problem

OpenScholar screens and extracts papers; an Evidence Library holds records,
reader collections and its own small AI features. On 2026-10-13 the two met in
only three places: OpenScholar reads a running library's settings, collection
list, institutions and publications for its owners
(`convex/zotero/runtimeReadClient.ts`), a library imports an OpenScholar
collection (`source-collections/items`), and collection invitations go through
OpenScholar (EL-26). A reader could not screen or extract from a library's
records, a collection in it, or a search of it; the assistant could not read a
library's records; and new-el was growing copies of OpenScholar features (Smart
screening in the library chat).

OpenScholar also names every paper by its OpenAlex ID. A saved paper's key is
`libraryItems.openalexId` (`convex/library/validators.ts`), and 69 files key
papers by `openalexId` in 252 places: saved papers, collections, ratings,
screening answers, screening and extraction papers, duplicate detection, PDFs,
exports, the assistant's record links. Papers from elsewhere get made-up values
(`zotero:group:<key>`), and a Zotero screening's included papers can't be saved
to a collection at all.

## Decisions (2026-10-13, the user)

Investigation and mock: thread "Use Evidence Libraries in OpenScholar"; mock
branches `mock/library-sources` (openalex-count) and `mock/openscholar-handoff`
(new-el).

- **Each side keeps its own data; the other asks as a named person, and the
  owner's own check decides.** OpenScholar never reads a library's database and
  never keeps a copy of its records, apart from the snapshot a job keeps of what
  it screened or extracted and a record a person saves to their OpenScholar
  library, which keeps its metadata under the record's key as every saved paper
  does. The library never rebuilds OpenScholar research tools.
- **A library is a source for screening and extraction**: a reader collection
  (yours, one shared with you, or anyone's public one), one of the library's own
  collections, the whole library, a search of it (its words, filters and sort,
  also inside a collection), or a list of records. A search or a list is turned
  into record keys once, when the job starts, by the library itself, up to 20,000.
- **Which libraries a person has**: the ones they signed in to, the ones they
  have a role on in OpenScholar, and the ones they used "Open in OpenScholar"
  from. Any other library OpenScholar runs is reached by pasting its address.
- **Papers are named by their source, never by OpenAlex** ("open alex is just a
  small subset of the future"). See "Paper identity".
- **Included papers can be saved to a library collection** (yours, one you edit,
  or a new one) as well as to an OpenScholar collection, which takes papers of
  any source. A library collection holds that library's records: a job's papers
  from it, and papers from elsewhere that it holds, found by OpenAlex ID or DOI.
  The rest are listed as not added, with why.
- **Smart screening stays in the library.** Its results and its 25-record
  dialog hand off to OpenScholar; so do the search page (with its sort) and
  collection pages. OpenScholar's landing page offers Extract (all questions)
  and Screen (yes or no questions only, as their description), and offers Screen
  only when no questions came or at least one is yes or no.
- **The assistant** lists a person's libraries and their collections, searches a
  library, reads records and their PDFs, creates library collections and adds or
  removes records, resolves a pasted library address, and starts screenings and
  extractions on library sources with the usual cost approval.
- **No plan gate.** Library sources work on every plan; the workspace's credits
  pay for the job. A person's reader collections show in every workspace.
- **One complete build** ("do not lobotomize the milestone"), in the stages
  below. After every stage a GPT-6.1 Sol delegated task QA-tests it with
  computer use (then browser use, then agent-browser when one isn't available),
  autonomously; its findings are verified and fixed, and the next pass confirms.
  The QA library is a new library made for it on shared dev; AIED, TVET and
  ECCAR are never QA targets.

## Paper identity (owner: `convex/lib/paperRef.ts`, one module shared by Convex and the app)

```ts
type PaperRef =
  | { source: "openalex"; work: string }                                   // "W2741809807"
  | { source: "library"; libraryId: Id<"evidenceLibraries">; key: string } // record key, 8 characters
  | { source: "zotero"; library: "user" | "group"; owner: string; key: string }
  | { source: "upload"; file: Id<"_storage"> };
```

- `paperKey(ref)` is its one string form, the only thing stored in indexes:
  `openalex:W2741809807`, `library:<libraryId>:<key>`,
  `zotero:group:<groupId>:<key>`, `upload:<storageId>`. `parsePaperKey`
  reverses it; nothing else builds or splits a key.
- `crossRefs: { openalexId?: string; doi?: string }` sits beside the ref. It
  finds the same paper across sources and finds a PDF through OpenScholar's own
  PDF lookup. It is never a key. Duplicate detection matches a paper to an
  earlier one by any identifier they share: OpenAlex ID, DOI, then title and
  year. `lib/bucket/dedupe.ts` keys a paper by the first of these it has, which
  misses a copy that shares only its DOI; it changes to look up each one.
- Opening a paper follows its source: OpenScholar's paper page for OpenAlex, the
  record's page in its library, the item in Zotero, the uploaded file.
- OpenAlex-only features (topics, authors, citation counts, OpenAlex filters)
  keep working on papers whose source or cross-reference is OpenAlex and are
  simply absent on others.

## The contract (owner: this section; both repositories implement it)

Every request carries the header `OpenScholar-Contract: 1`, and every answer
carries it back; a side that doesn't speak that version answers
`400 contract`. A call about a person carries their
Clerk user ID; the side that owns the data checks that person with the same
function its own pages use. Both sides log every refusal and failure with the
library, the call, the person and the reason (`[library sources]` prefix) in
the first version.

### Library to OpenScholar (machine credential, `answerLibraryUserRequest` in `convex/evidenceLibraries/serviceHttp.ts`)

| Call | Body | Answer |
|---|---|---|
| `POST /api/v1/evidence-libraries/readers/seen` | `{libraryId, clerkUserId}`, on every sign-in | `204` |
| `POST /api/v1/evidence-libraries/handoffs` | `{libraryId, clerkUserId?, from: "smartScreening" \| "search" \| "collection", source: {records: string[]} \| {search: string} \| {readerCollection: string, search?: string} \| {libraryCollection: string}, fields: [{label, type: "string" \| "number" \| "boolean", description}]}` | `201 {handoffId, url, expiresAt}`; `400 invalid_request` |

A hand-off lives seven days, holds no permission (OpenScholar reads its records
as whoever opens it), and records the library for that person when they open it.

### OpenScholar to library (machine credential, `requireOpenScholarBearer`; the person in `reader: <clerkUserId>`, empty for nobody)

| Call | Answer |
|---|---|
| `GET /api/v1/openscholar/readers?cursor=` | `{readers: [clerkUserId], next}`: once per library, to learn the readers who signed in before this shipped |
| `GET /api/v1/openscholar/readers/<clerkUserId>/collections?list=own\|shared&page=&pageSize=` | `{rows: [{id, name, description, private, access: owner\|editor\|viewer, owner: {name, image}, count, updatedAt}], page, pages, total}`: their own (private ones too) or the ones shared with them, as the profile column orders them, up to 100 a page |
| `GET /api/v1/openscholar/collections/<id>?reader=` | one reader collection by ID as that person may see it (`403 private`, `404 not_found`) |
| `POST /api/v1/openscholar/sources/resolve` `{reader, source, first, last}` | `{keys, total, truncated}`: records `first` to `last` (from 1) of a source as the person may read it, in the source's order, at most 20,000. `source` is `{readerCollection}`, `{libraryCollection}`, `{library: true}`, `{search, readerCollection?}` (the search page's query string, resolved by `readSearchKeys` in its sort) or `{records}`. `409 index_changed` asks again |
| `POST /api/v1/openscholar/records/batch` `{keys}` | `{records: [Record], unread}`, at most 500 keys and 4 MB; missing keys left out, `unread` the ones a full batch left for the next call |
| `POST /api/v1/openscholar/records/match` `{reader, papers: [{openalexId?, doi?}]}` | `{matches: [{at, key}]}`: the records this library holds with that OpenAlex ID or DOI, at most 500 papers a call |
| `GET /api/v1/openscholar/search?reader=&<search page parameters>&page=` | `{records: [Record], page, pages, total}`: the assistant's search, as the search page answers it |
| `GET /api/v1/openscholar/records/<key>/files/<attachmentKey>?reader=` | the PDF, only when the library's tag rules make it downloadable (`filterPublicAttachments`), else `404` |
| `POST /api/v1/openscholar/readers/<clerkUserId>/collections` `{name, description?, private, requestId}` | `201 {collection}`; limits as the profile has them. The same `requestId` again answers the collection it made, so a retry never makes two |
| `POST` and `DELETE /api/v1/openscholar/readers/<clerkUserId>/collections/<id>/records` `{keys}` | `{count, changed}`; owner or editor only (`403 role`) |

Changed 2026-10-13: the plan had `GET records?from=` paging a source by key while
a job read it, and `POST searches/resolve` for searches alone. Every source is
now turned into keys once, when the job starts (`sources/resolve`), and the job
reads those keys a batch at a time (`records/batch`). Reason: a job reads the
source as it stood when it started, collections as well as searches, and one
call covers every kind of source. Proof: `convex/screening/library.test.ts`,
`convex/extraction/library.test.ts` and new-el
`tests/integration/openscholar-reads.test.ts`.

A library's record count and its own collections, which the source picker
shows, come from its public API (`/api/items`, `/api/collections`), which every
runtime has.

`Record` is `{key, revision, itemType, title, abstract, creators: [{name}],
year, venue, url, crossRefs: {openalexId?, doi?}, files: [{attachmentKey,
filename, contentType, bytes}]}`. Its text is capped at the lengths
OpenScholar keeps a Zotero paper's (`convex/zotero/libraryValidators.ts`: title
500 characters, abstract 10,000, 100 creators and a venue of 300 each). A page of
records holds at most 500 of them and at most 4 MB: the library sends fewer when
the next would pass it. Every refusal answers `{error, message}`:
`401` credential, `403 private | role | reader_accounts_off`, `404 not_found`,
`409 index_changed`, `413 too_many`, `400 invalid_request | contract`, `503`.
A library on an older runtime answers `404` to these paths; OpenScholar shows
"This library needs an update to be used here" with a link for its owners.

## Data changes and migration

OpenScholar (`@convex-dev/migrations`, widen, audit and dry-run, migrate, verify
every batch on shared dev, then narrow):

- `libraryItems`: `openalexId` becomes `paperKey` (indexed, unique per
  workspace), `ref` and `crossRefs`. Every row becomes `{source: "openalex"}`
  with its OpenAlex ID as both key and cross-reference. `libraryRemovals` the
  same. `paperMetadataChanges` stays as it is: its receipts name rows, not papers.
- `ratings.paperId`: rewritten to `paperKey` values; a rating is of any paper.
- Stored arguments that name a paper move with it: `assistantSteps.undo` (and
  `input` while a call waits for the person) and `assistantStepUndos.args`.
  Rating commands, `researchReceipts.undo` among them, name a paper in any form
  and are read through `toPaperKey`, so they stay.
- `screeningAnswers` and `screeningAnswerHistory` keep the ID pages name a paper
  by (`paperIdOf` its key): an OpenAlex paper's address, as a search's results
  page answers it, and any other paper's key. A job on a search reuses its
  page's answers through it.
- `screeningResults.openalexId` and `extractionPapers.openalexId`: become
  `paperKey`, `ref`, `crossRefs`; `zotero:` and made-up values are parsed into
  their real source, and a Zotero item whose owner nothing names stays unplaced.
  `extractionJobSources.openalexId` stays: it is a picked paper's OpenAlex
  cross-reference, and the job names the paper by key when it reads the source.
- Search result pages, bookmarks and history keep OpenAlex IDs: they are OpenAlex
  searches.

New tables: `evidenceLibraryReaders` (`libraryId`, `userId`, `via`: signIn |
role | handoff, `firstAt`, `lastAt`), `evidenceLibraryHandoffs` (`libraryId`,
`source`, `fields`, `from`, `expiresAt`, `openedBy`), `paperSetKeys` (a frozen
key list in pages of 1,000, by job, the job's source and page).

new-el: no schema change for reads. Writes reuse `reader_collection`,
`reader_collection_item` and `reader_collection_member` (migration 0084).

## Stages

Each stage ends with targeted tests (Convex tests run under Convex limits; size
cases where a flow reads many pages), type checks, `check:convex-rules`,
`check:user-actions`, `check:ui-rules`, fallow in new-el, `verify shift` on
every changed page, the cross-family review, a preview (OpenScholar on the e2e
backend, new-el on its verify stack), the GPT-6.1 Sol QA pass and its fixes,
merge on green, deployment (new-el releases first and AIED, TVET and ECCAR are
updated one at a time), and a confirmation QA pass on shared dev.

0. **Contract, plan and issues.** This file; the issues; the decision in Outline.
1. **Papers named by their source** (OpenScholar). `paperRef` module; the
   migration above; every place listed under "Problem" moved to it; opening a
   paper follows its source; Zotero papers save to collections. Done when no
   code keys a paper by `openalexId` outside OpenAlex search and topic features,
   the migration is narrowed on shared dev, and QA finds every paper feature
   working.
2. **Library sources.** new-el: the read calls, the sign-in report, the readers
   backfill, files. OpenScholar: `evidenceLibraryReaders` (sign-in, roles,
   backfill), the address resolver (hosts from `evidenceLibraryDomains` and
   runtime bindings), the `evidenceLibrary` paper set in screening and
   extraction (start, check, estimate, page-by-page read, frozen keys, duplicate
   detection by cross-reference, library PDFs, old-runtime and lost-access
   errors), the Evidence Library tab and address field from the mock, job
   results that show library records with an open button. A QA library made on
   shared dev. Done when a person screens and extracts each kind of library
   source end to end on shared dev.
3. **Hand-offs.** new-el: "Continue in OpenScholar" on Smart screening, "Screen
   all N" in its dialog, "Open in OpenScholar" on search and collection pages,
   the OpenScholar mark, and the Smart screening error that names a database
   failure as an AI provider one fixed. OpenScholar: the hand-off call, the
   landing page at `/from-library/<id>` (signed out, expired, private, records
   paged and sorted with open buttons, the questions, Screen and Extract rules),
   the library remembered. Done when every hand-off kind lands and starts a job.
4. **Writes.** new-el: the collection create, add and remove calls. OpenScholar:
   "Save included papers to" a library collection (yours, one you edit, a new
   one) or an OpenScholar collection; "Remove excluded" on a library collection
   you edit. new-el also answers `records/match`. Done when both work for jobs of
   every source kind, and papers a library doesn't hold are named as not added.
5. **The assistant.** User actions with their registry entries
   (`convex/lib/userActionRegistry.ts`): libraries, collections, search,
   records, record PDF, create collection, add and remove records, resolve an
   address; screening and extraction take library sources through their
   existing actions. QA on the Cheap preset. Done when a chat does each of these.
6. **Close-out.** A regression QA pass over every stage; Outline's integration
   contract and current-state pages; the mock branches deleted.

## Reuse

OpenScholar: `convex/zotero/runtimeReadClient.ts` (machine calls, shield
headers), `convex/evidenceLibraries/serviceHttp.ts` (library to OpenScholar),
the Zotero paper set in `convex/screening/start.ts` and
`convex/zotero/actions.ts` `papersOf` (page-by-page reading), `PaperScope` and
`SourceRow` (`components/screening/source-row.tsx`), the mock's
`components/screening/library-sources.tsx` and landing page,
`convex/lib/paperPdfs.ts`, `lib/bucket/dedupe.ts`.
new-el: `src/lib/readers/data.ts` (`readerListQuery`, `readPickerCollections`,
`readSharedCollections`, `toggleCollectionItem`, `createReaderCollection`),
`src/lib/library-export-selection.ts` (`readSearchKeys`), `src/lib/tags.ts`
(`filterPublicAttachments`), `src/lib/admin/openscholar-bearer.ts`, the mock's
`src/lib/openscholar/handoff.ts` and `OpenInOpenScholar.tsx`.

## Risks

- Stage 1 rewrites keys that pages, exports and the assistant read at once; the
  widen step keeps both until every reader moves, and narrowing waits for the
  QA pass on shared dev.
- A whole library is up to about 280,000 records; reads page by key and a job
  takes at most what the plan allows, so no flow loads it whole.
- A library's search index changes while a search is resolved (sources sync every
  minute); the resolve call retries `index_changed` a few times, then fails the
  job's start with that reason.
- Reader collections are private by default; a pasted address of one never
  reaches its records unless the library says this person may.
