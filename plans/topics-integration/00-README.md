# Topics integration

Prepared 2026-09-24. This is the handoff for implementing topics in
`OpenDevEd/openalex-count` and `OpenDevEd/new-el` after the prototype review.
The implementation scope includes the OpenAlex source importer. An Elasticsearch migration remains outside this work.
Follow [the working agreement](../../AGENTS.md) and
[the project guide](../../docs/agents/project.md).

## Agreed behavior

- Topics use the OpenAlex hierarchy: domain, field, subfield, topic. A topic is
  identified by its OpenAlex ID, not its label. Keywords are search terms,
  not topic IDs and not locally invented topics.
- The library filter follows the accepted country filter: selectable parent
  groups, chevrons, counts, the same row sizes, stable height and scrolling.
- An item shows its topics. A rich preview contains the description,
  hierarchy, keywords and clearly labelled OpenAlex publication count.
  Hover previews the card; click, tap, Enter or Space opens an interactive
  card. Its footer opens the OpenScholar topic page. Keyword links open
  OpenScholar publication searches; classification links open the topic directory.
- OpenScholar has a public topic directory and a public topic detail page,
  like its public author profiles. Topic labels in paper details and focus
  mode link there too. Configuration remains protected.
- Topic pages have Evidence Libraries and OpenAlex results. On 2026-09-24 the
  user chose **one publication with links to every library containing it**,
  instead of separate results for each library.
- Configuration has one Topics switch. The user removed the confidence slider
  and the Browse topics configuration link. Do not restore them.
- The editor can add, remove and keep topics and review suggestions. Suggestions
  do not become public assignments without editor approval.
- The user authorized implementation on 2026-09-24. Do not mistake
  local fixture behavior for saved or published library data.

### Decisions confirmed on 2026-09-24

The user accepted the three follow-up recommendations after reviewing the
OpenAlex sample and clarified the identity of manually created records:

- Use an internal `0.5` cutoff provisionally. Do not restore the slider.
  Display "OpenAlex score", never a percentage described as certainty.
- Topics off hides the entire feature: editor, chips, previews, filtering,
  statistics and the library's contribution to OpenScholar topic results.
  Retain assignments, drafts and topic metadata received during normal new
  OpenAlex imports privately. Enabling uses that stored data without enrichment.
- Group public locations by normalized bibliographic DOI first. A shared
  OpenAlex work ID is an optional fallback when DOIs do not conflict.
  Records with neither identifier remain separate by `(libraryId, itemKey)`.
  Manually created records need no DOI or OpenAlex ID to have topics or appear.
- Existing records receive topics manually only. No enrichment or backfill,
  including from previously stored metadata, belongs to this release.
- Topics use the planned shared field-override, draft and publication workflow.
  An override persists across imports; a changed source field presents a
  conflict choice. This is not a separate topics-only editing system.

The original draft proposed OpenAlex-ID-first grouping, backfilling available
metadata, per-topic addition/suppression overrides and hiding only public topic UI.
These decisions replace those
proposals after the user's clarification. The sample of 24 papers and 62
assignments supported a light cutoff, not a calibrated probability: `0.5`
retained 60 assignments; `0.7` retained 58 and removed a relevant assignment.
Some visibly incorrect assignments still scored above `0.9`.

## Import decisions confirmed on 2026-09-24

The user approved these decisions after the original importer audit:

- `OpenDevEd/openalex-sync`, branch `server-wip`, commit `4eed934`, is the
  original importer reference. The experimental mapper on `prototype/openalex-ui`
  is excluded as an implementation reference.
- Save an approved immutable query version. Changing the query requires a new
  approval. Credentials and PDF processing settings are separate from its identity.
- One library record per OpenAlex work across overlapping OpenAlex searches,
  with separate source memberships. Do not automatically merge or enrich existing
  Zotero/manual records. OpenAlex IDs identify provider records; library keys stay
  eight characters and cross-library public grouping still uses DOI first.
- A complete successful reconciliation withdraws an unedited record only after
  no remaining source supplies it. Edited records stay published and are flagged.
  A paused source, interrupted scan or failed request never means withdrawal.
- Keep retracted records with a visible warning. A query may explicitly exclude
  them. Retraction never silently erases editorial work.
- PDFs are URL-only by default. Downloading, processing and hosting is opt-in
  per source. Keep the original external link when a download fails. Store the
  selected location/version/license and keep the publication landing page separate.
- Imported affiliations remain attached to the publication's authors. Never copy
  them into record Institutions or Country Focus. Existing combined institution
  filtering reads both record institutions and author affiliations without changing
  either. Reuse the institution location catalog and preserve source identity.
- Preserve publication bylines and author order; do not guess surnames. Keep source
  author identifiers separate from manually managed OpenScholar profile links.
- Persist shared field overrides through drafts and publication. Source changes
  create a conflict; Keep mine preserves the override, Use source clears it.

### Delivery order

The primary owns shared configuration, batch contracts, schema changes and
integration. Independent mapping and HTTP-client work can proceed against those
contracts. Implement in a clean checkout of current EL `main` and OS `dev`.

1. Record the decisions; add the OpenAlex source configuration, mapping and
   bounded client. Connect to durable source jobs and transactional writes.
2. Add shared persistent overrides, provider identity and membership reconciliation,
   retained author affiliations, topic assignments and PDF handling. Verify with
   disposable PostgreSQL, including interrupted imports and overlapping searches.
3. Connect accepted editor/configuration/library UI through saved drafts and real
   publication. Add versioned configuration migration, scoped topic catalog and
   publication delivery, grouped OpenScholar results and real facets.
4. Exercise the final real-data flows and review the integrated phase once. Run
   only targeted checks during implementation. Merge/release is not authorized.

The current phase does not mutate existing library records or shared services.
No production migration or deployment is authorized. Full integration is complete
only when the real importer, editor, configuration, PDF and public topic flows
work; mapping tests or prototype fixtures alone do not prove completion.

## Current implementation and reuse

Implementation branches are `feat/openalex-integration`, based on EL `main`
`7f4bd99c` and OpenScholar `dev` `90ebe501`. The table below describes the
reviewed prototype, not code already integrated into these branches.

| Boundary | Current code | What remains |
| --- | --- | --- |
| Shared topic catalog | OS `lib/topics/catalog.ts`; EL `src/lib/topics/catalog.ts` | One maintained catalog and version; replace duplicated snapshots in the implementation |
| OpenAlex details and works | OS `app/actions/topics.ts`, `lib/openalex/read-works.ts` | Reuse the readers; cache details and distinguish counts as described below |
| Directory and detail | OS `components/topics/topic-list.tsx`, `topic-page.tsx` | Connect library results and exact ancestor filtering; server paging for real results |
| Library publication rows | OS `components/evidence-libraries/publication-list-item.tsx`, also used by author profiles | One row per publication, multiple record links; reuse the existing publication-card reader |
| Record preview | EL `src/components/topics/TopicHoverCard.tsx`, `ItemPage.tsx` | Replace the three fixed assignments for `PP2KEL8M` with effective published topics |
| Filter | EL `CollectionsList.tsx`, `src/lib/topics/facets.ts` | Replace `topic-facet-mock.json` with real facets; connect query to the search request |
| Editor | EL `TopicsEditor.tsx`, `TopicPickerDialog.tsx`, `AdminInspector.tsx` | `topicEdits` is tab-local; integrate with real draft save, publish, restore and conflicts |
| Config | OS `topic-filter-settings.tsx`, `search-section.tsx` | Toggle is local React state; put it into the saved, versioned library configuration |
| Details transport | OS `app/mock/topics/v1/route.ts`; EL `src/app/api/topic-preview/route.ts` | Development-only bridge and localhost links must be replaced |
| Existing service transport | OS `convex/evidenceLibraries/serviceHttp.ts`; EL `src/lib/authors/catalog-server.ts` | Extend the existing library credential and platform URL mechanism |
| Existing public publication loading | OS `app/actions/author-publications.ts` | Extract its validated card fetch; avoid a second library metadata reader |

The shared Outline integration and decisions pages were checked on 2026-09-24.
They define repository ownership and service authentication but contain no
additional topic contract. This plan records the topic-specific choices.

### Import foundation, 2026-09-24

EL commits: `38ce2ec3` maps provider works, `ee0ee67e` adds PDF processing,
and `01e6dc79` integrates the source worker, identity, configuration and review
fixes. These are local commits on `feat/openalex-integration`; nothing is pushed.

The EL implementation adds approved-query configuration, a bounded OpenAlex
client, mapping, resumable imports through the existing source worker, and
atomic page/checkpoint writes. Approval history rejects reuse of an older
version with changed contents. Overlapping searches share canonical provider
records without matching manual or Zotero records by DOI. Author affiliations
stay on creators and feed the existing institution-country catalog. Raw topic
data is retained, but effective topic assignments are not implemented yet.

PDF links work directly on the item page. Processing is opt-in per source and
uses the existing PDF and storage services. A first failed download keeps the
external link; a failed refresh retains a usable hosted copy and records the
error. Overlapping searches reuse the same hosted PDF. It stays while any
supplying source opts in, and is cleaned up when none do. Cleanup cannot remove
an active file or revive a replaced file through an older retry.

Migration `0065_openalex_sources.sql` changes file-publication foreign keys
to permit this shared identity. It keeps canonical item/parent foreign keys
and a separate source foreign key, and adds immutable approval history.
It was exercised only on disposable local
PostgreSQL. Local rollback recreates that disposable database. Before deploying
or rolling back saved data, audit cross-source file publications; the previous
composite constraints cannot be restored while such rows exist. No deployed
database or shared service has changed.

Targeted evidence includes interrupted/resumed imports, concurrent overlapping
searches, stale source data, a manual record with the same DOI, query replacement
during a request, and real PDF processing against disposable PostgreSQL. A live
four-work OpenAlex import produced four records and two URL-only PDF children.
The actual item page and its Open document action were checked in agent-browser.
The local preview has no search service and does not prove search integration.

The read-only phase review found file ownership, refresh failure, cleanup,
source timestamp, affiliation limit, response size, public download and migration
snapshot issues. The implementation fixes these at the shared boundaries. It
also saves approval history so an old query version cannot be rewritten. The
obsolete `_auto-process` lookup remains removed under the user's no-legacy
direction; actual PDF URLs are stored on attachments. The public download route
uses the existing bounded public-address fetcher and was checked over HTTP with
a real PDF. Some publisher endpoints return HTML to server requests; the existing
redirect to the original URL remains available in that case.

Local checks passed: 289 targeted unit tests, 10 database/PDF integration checks,
the existing source-writer regression tool, TypeScript, changed-file ESLint,
configuration artifact verification and migration generation with no remaining
schema difference. React Doctor remained at 82 with no errors; its warnings
include dependent database reads, deliberately sequential file processing and
Zod schema syntax. Full CI and shared deployment have not run.

Still required before the full integration is usable: persistent shared field
overrides and conflict choices; complete-source reconciliation and withdrawal;
incremental refresh; typed topic storage and effective assignments; saved
configuration and approval controls; editor/publish/restore integration; real
facets and statistics; authenticated catalog and association delivery; and
grouped public OpenScholar results. Late-arriving and cross-search citation
references also need resolution. Do not activate imports on a shared library
and describe this foundation as the finished feature.

## Proposed implementation defaults

These are the concrete engineering defaults for implementation, not claims
that the backend already exists. Surface a conflict with actual source data
before changing the user-visible behavior.

### Ownership and stored data

OpenScholar owns the catalog, descriptions, keywords, hierarchy and public
cross-library topic directory. Evidence Library owns record assignments,
editor changes, effective public topics and library-scoped counts.

Store canonical IDs `T…`, `domains/…`, `fields/…`, `subfields/…`. Normalize
OpenAlex URL identifiers once on ingest. Keep labels and descriptions out of
assignment identity. Missing catalog nodes are diagnosable, not synthesized
as a guessed topic.

- Catalog node: ID, level, parent ID, label, description and keywords where
  applicable, catalog revision and fetched time. Store the OpenAlex count
  with its fetched time separately from library counts.
- Imported assignment: record key, source key, topic ID, score in `[0,1]`,
  primary-topic flag, source revision and source timestamp.
- Editorial override: use the shared field-override contract in the existing
  draft patch. Retain the source value and revision separately from the
  editor's topic set. A source update cannot silently replace that set.
- Accepted provisional confidence rule: imported assignments with score at
  least `0.5` are public; an editor's explicit addition or Keep always qualifies. This
  rule applies when deriving topics from an unoverridden source field and is
  fixed in code rather than configurable. Label the raw value "OpenAlex score".
  The same function must drive the item, facets, exports and publication feed.
- Add accepts leaf topic IDs only. Parent nodes are navigation/filter groups.
  Multiple additions of the same ID collapse to one assignment.
- Add, Remove and Keep edit the topic field through normal draft, review and
  publish. Keep includes an uncertain imported topic in the editor's set.
  A changed source topic field while overridden presents "Keep mine" or
  "Use source" through the shared conflict workflow. Keep mine retains the
  override; Use source clears it and resumes source behavior. Source refresh
  alone never changes the published override.
- The mock's AI suggestion controls are not an implemented classifier or
  authorization to classify existing records. That remains outside this slice;
  existing records use manual assignment.

### Drafts, publication and existing records

Reuse EL's current draft, revision and publish services. Do not add a separate
save path for topics. Draft topics are visible to authorized editors only.
Publish commits effective topic changes and required search/feed jobs in the
same transaction. Unpublish removes the public association. Restore recomputes
from the restored revision. Workers read the newest published revision;
older retries cannot reintroduce removed assignments.

Existing record contents receive **no backfill**. New storage follows the repository migration process. Existing records remain
without topic assignments until an editor adds them manually. Do not create
empty overrides, match them to OpenAlex, classify them or backfill topics from
stored metadata. Normal new OpenAlex imports may retain the topics supplied
in their payload, even while the Topics feature is off. That does not authorize
enriching existing records or fetching extra topics for them.

For stored library configuration use the repository's versioned snapshot
migration and widen/migrate/narrow procedure. Do not overwrite historical
revisions or rely on optional fields forever. Plan and dry-run the migration
before deployment; preserve existing active configurations on failure.

### Configuration semantics

Use a feature-level `topics.enabled`, default false for existing libraries
until their runtime supports the capability. It controls every topic surface,
including the editor, item chips and previews, filters, statistics and public
cross-library associations. Turning it off retains assignments and editor
work privately and removes a stale `topics` URL filter from the active search
request. Withdraw that library's locations from OpenScholar topic results.
Turning it on republishes eligible associations from saved data; it never
starts enrichment or backfill. The earlier `filters.topics.enabled` proposal
is superseded because this switch controls the whole feature.

The Topics control participates in the existing Search section's dirty state,
Save, Reset and Activate behavior. Saving a draft configuration does not
change the public library; activation does. Unsupported runtime versions
block activation with a plain explanation before changing the live config.

### Filtering and counts

The current picker stores the selected path to display expanded ancestors.
Define the effective selection as the **most specific selected nodes on each
branch**: a selected field alone means all topics below it; selecting one of
its topics narrows that branch to that topic. Selected sibling topics are OR;
distinct branches are OR; other filters and the text query are AND.

Example: `[domains/3, fields/17, subfields/1702, T12260]` filters by `T12260`,
not by all of Physical Sciences. Removing the leaf goes back to the selected
subfield. Derive this frontier once and use it in every search request.

Count distinct published records in the current library, respecting the text
query and other active filters. Exclude the Topics selection itself when
calculating its available options. Parent counts are a union of descendant
records, never a sum that double counts a multi-topic record. A selected
zero-result option stays visible with `0`; unknown/loading is not `0`.
Counts and selected chips must be returned for the same search revision.

Keep query state in the URL, including reload, sharing and back/forward.
Do not implement a temporary Meilisearch-specific topic path. Define the
filter/facet contract independently; implement its real backend adapter in the
search workstream selected for the integration. Elasticsearch work does not
block this prototype/specification, but live topic filtering is not complete
until that adapter returns verified results.

### Cross-library publications and deduplication

Use an authenticated publication feed, following the author delivery queue pattern. Keep `(libraryId, itemKey)` as the location identity. Include bounded public bibliographic metadata, effective topic IDs, published revision and an independent monotonic delivery generation. Send locations with empty topic IDs too. Active configuration gates visibility independently from delivery; disable/enable cannot be lost at an unchanged item revision. Retain delivery tombstones and clean up locations during library teardown. Payloads
come from the publishing runtime, never from a public browser.

Group locations by normalized public bibliographic DOI first. If DOI matching
does not identify a group, use a verified shared OpenAlex work ID only when
there is no conflicting DOI. Never merge records by title or let an identifier
chain join records with different DOIs. Report conflicting mappings for repair.
With neither identifier, retain a separate publication for each
`(libraryId, itemKey)`. A manually created record without a DOI needs no
deduplication or OpenAlex lookup. Its library-scoped key identifies it for
updates, retries and removal; identical keys in different libraries stay separate.

Display one publication row with the union of its visible library locations.
One enabled library's topic assignment qualifies the publication; include its
other eligible public locations even if their own topic assignments differ.
Libraries keep independent assignments and cannot override another's records.
Each library link opens that library's record, not its home page. Removing one
location leaves the others. A topic result requires at least one remaining
eligible location that assigns that topic; remove it when that condition no
longer holds, even if other locations still exist. Choose displayed metadata
deterministically from available locations,
with the chosen location recorded; do not imply an editor in one library owns
another library's version.

Only enabled, public libraries and published, public records appear. Revalidate
against the public card endpoint; a 404 removes that location, while a timeout
is an unavailable source. Partial failure keeps the available locations with a
notice and retry. Never label a partial result count as the global total.
Cursor pagination happens after deduplication; a publication cannot occupy
multiple pages or gain repeated location links during retries.

### Service contract

Extend the existing authenticated, versioned Evidence Library service API.
Use its per-library machine credential, library scoping and existing platform
base URL. Never put credentials in browser bundles or hardcode a host/port.

| Operation | Request | Response and rules |
| --- | --- | --- |
| Catalog browse/resolve | version, library identity, parent or query or at most 100 IDs, cursor, limit ≤100 | Nodes, revision, next cursor, canonical public base URL; strict validation and bounded paging |
| Topic detail | version, library identity, one canonical topic ID | Description, hierarchy, keywords, OpenAlex count with timestamp, canonical topic URL; 404 unknown, retryable unavailable response |
| Publish associations | idempotency key, library ID, item key, monotonically increasing delivery generation, published revision, effective topic IDs, verified identity and bounded bibliographic metadata | Receipt for that generation; reject invalid IDs and foreign library credentials; older delivery generations do not win |
| Remove associations | same identity/generation contract, unpublished/deleted state | Idempotent tombstone with generation; no hard delete that permits stale replay |
| Public topic publications | topic ID, query, cursor, limit ≤50 | Deduplicated publications and locations, counts with completeness, next cursor, unavailable source summary |

Use these exact proposed routes in the existing `convex/http.ts` router:

- `POST /api/v1/evidence-libraries/topics/catalog` for browse/resolve.
- `POST /api/v1/evidence-libraries/topics/detail` for one topic.
- `POST /api/v1/evidence-libraries/topic-associations` for replacing a record's
  complete public association set. `state: "unpublished"` carries the same
  generation/idempotency contract and stores a tombstone.
- Public directory results use the Next server reader backed by the Convex
  public query `topics.publications.list`, with bounded cursor pagination;
  no browser machine credential and no duplicate public REST interface.

A shared `contractVersion: 1` discriminates these JSON payloads. Return
`{ error: { code, retryable } }` for validation/auth/provider failures; use
400 invalid input, 401 invalid credential, 403 wrong library, 404 unknown
entity, 409 conflicting revision, and 503 temporary unavailability. Repeat
of an already applied idempotency key returns its original receipt; same
key with different content returns 409. A lower delivery generation returns a receipt
marked `superseded` without a mutation. The full replacement request includes
`libraryId`, `itemKey`, `generation`, `publishedRevision`, `topicIds`, bounded public metadata, verified `openalexId`
and bibliographic `doi` or null, and `state`.

One integration owner writes the shared validator and its fixtures before
implementing consumers. The route names and behavior are decided here; the
first implementation package encodes and verifies this contract.

Cache catalog/detail reads by version and ID. Reuse cached descriptions while
refreshing; keep a fetched timestamp and a bounded stale-on-error policy.
Do not blank a populated popover during refresh. Publication references are
updated from publish events; metadata-card caching follows the existing author
reader. Log library, item/topic ID, revision, operation and provider error at
the boundary so failures are diagnosable on the first implementation.

## Prototype review routes and states

- Library item: `https://localhost:3521/lib/PP2KEL8M#topics`.
- OpenScholar topic: `http://localhost:3010/topics/T12260`.
- The Evidence Libraries tab uses one clearly labelled sample publication in
  two libraries. This is not a claim about saved associations.
- Append `?libraryPreview=empty`, `loading`, `error` or `partial` on that topic
  to review those states. Error and partial states have a working Try again.
  The real integration will replace these fixtures with returned service states.
- Search the library results for an unmatched term to see search-empty behavior.
- For the popover, inspect a normal response, delayed request, failed request
  with retry, a long description and keywords, and an unknown topic. Keep the
  footer usable when the description service is unavailable.

## Implementation sequence and acceptance

| Work package | Owner and dependencies | Completion evidence |
| --- | --- | --- |
| 1. Catalog and service contract | OpenScholar; one contract owner also updates EL consumer schema | Canonical ID normalization, hierarchy validation, paging and scoped auth checks; contract agrees on both sides |
| 2. Assignments and editor draft | EL; package 1 IDs | Save/reload, publish, unpublish, restore, source refresh, suppression and suggestion approval against a disposable database |
| 3. Configuration and public library | OS config + EL runtime; packages 1–2 | Saved revision migration, activation gate, switch on/off, real item assignments, unavailable descriptions, no localhost/mock imports |
| 4. Filtering and publication feed | EL search adapter + OS association consumer; package 2 | Parent-union counts, specificity frontier, query intersections, zero counts, out-of-order jobs, retries, unpublish/delete removal |
| 5. OpenScholar topic results | OpenScholar; package 4 | One publication with two library links, deterministic deduplication, paging, partial failure, no private records; all public navigation works signed out |

Rename the existing collection-based "Research Topics" statistics to
"Collections" without changing their calculation. Add actual Topics statistics
from the same effective published assignments and distinct-record counting
rules as the filter. The feature switch hides these Topics statistics too.

The final real-data browser gate covers desktop and mobile, light and dark,
mouse hover, touch/click, Enter/Space, Tab through every internal link, Escape,
outside dismissal, focus return, and scrolling without blink or height jumps.
It also covers parent-to-leaf filtering, multiple branches, URL reload/back,
editor draft versus published visibility, and removing one of two library
locations. Keep the existing country/institution behavior intact.
Also verify manual records without either shared identifier, identical item
keys in different libraries, conflicting DOIs, import while Topics is off
followed by enabling, and both choices for a source-field conflict. Existing
records must remain unchanged until explicitly edited.

Run the smallest checks for each changed boundary. Full CI is the pre-merge
gate on the exact authorized merge head; the working agreement owns that
workflow. No shared-service or production deployment is part of preparation.

## Ready to start means

The user has reviewed the complete prototype and the agreed behavior above;
remaining visual comments are resolved; the target worktrees are updated to
current `main`/`dev`; the contract above is accepted; and the implementation owner can run each package's acceptance
checks in an isolated environment. Prototype UI readiness does not mean the
runtime data, migrations, publication feed or live search adapter are built.

## Preparation checks

Checked locally on 2026-09-24:

- Both repositories pass TypeScript. The changed EL topic card passes ESLint.
  Nine focused OpenScholar route/link tests pass.
- The sample topic page shows one publication with two record links. Search,
  search-empty, no assignments, loading, error/retry and partial/retry states
  were exercised in agent-browser. Partial retry restores the second location.
- A publication's topic link opens its topic page. Escape works when that link
  has focus; navigation and browser-back leave the publication overlay closed.
- The EL card opens by keyboard, Tab reaches its classification links, and
  Escape restores chip focus. Light and dark layouts were inspected. At
  390 × 844 the card fits inside the viewport
  and keeps its footer visible while its body scrolls.
- The required read-only phase review completed. Its three navigation/default
  tab findings were fixed. The real-data acceptance gate above remains work for
  the integration; fixture checks do not prove saved configuration, live counts,
  cross-library deduplication, permissions or publication delivery.

## External reference

[OpenAlex topic documentation](https://help.openalex.org/data/topics/) defines
`topics` as the primary and secondary assignments and `works_count` as all
works assigned to the topic. Read on 2026-09-24. For displayed result totals,
use the actual Works query's `meta.count`, including any exclusions, rather
than assuming the topic object's aggregate and a filtered query are identical.
