# Preserve paper metadata through research workflows

Follow [AGENTS.md](../AGENTS.md) and the [project guide](../docs/agents/project.md).

## Contract

Search, screening, saved papers and extraction carry the same known author names,
venue, citation count, work type, access status and source links. Unknown access
is absent, never false. A PDF link does not establish open access. Authors are
an array; punctuation inside a name never separates authors. Unrecoverable old
author text stays in `authorsUnparsed` and is labelled as unparsed in exports.

Saving a partial record fills missing metadata. It preserves existing meaningful
values, personal ratings, collection membership and saved dates. An explicit
rating action can still change a rating. Source recovery performed today carries
its own timestamp and never rewrites a historical screening decision or abstract.

Known PDF links remain metadata even when PDF processing is disabled. The PDF
filter describes source availability; `PDF Used` describes actual processing.
Library and collection sources now supply their retained PDF links to the existing
PDF pipeline and credit estimator when processing is enabled. An open-access
landing page stays in `oaUrl`; the downloader may try it as before, but exports
never call it a known PDF URL.

## Reuse and ownership

- `lib/library/trim-paper-data.ts` owns the OpenAlex-to-library projection.
- A shared paper metadata helper owns author recovery, display and merge rules.
- `convex/library/mutations.ts::upsertLibraryItem` owns persistence and rating rules.
- `convex/paperSets/search.ts`, screening validators and `createResults` carry the
  bounded source projection. Existing author limits remain explicit.
- `convex/extraction/expandSources.ts` reads owned library rows; browser values
  cannot replace them or supply uploaded-file ownership.
- `lib/topics/identity.ts::normalizeDoi` remains the DOI normalizer.

## Migration

The 4 October shared-development backup contains 1,649 library records. Retained
raw OpenAlex data recovers 27 author arrays and matching, same-owner screening
records recover another 1,164. Another 395 have author text only; 63 lack usable
author text. No conflicting matching screening arrays were found. There are four
library undo records. The backup is outside the repository and includes all
database tables; attachment blobs are unchanged.
The retained raw author arrays contain at most 10 names. Migration nevertheless
preserves names over the 100-author storage cap as full unparsed text.

1. Widen stored authors to string or array. New application writes use arrays and
   readers preserve old text without splitting it. Add optional source metadata.
2. Rehearse a resumable `@convex-dev/migrations` migration on preview fixtures.
   Recover names only where the retained array joins to the exact saved text.
   Recovery queries have a named cap; excess or conflicting candidates leave
   text unparsed. Keep owner checks. Migrate library undo snapshots too.
3. Dry-run, migrate and verify shared development from its integration checkout.
   Preserve an external before/after manifest. Retries must make no changes.
   Rollback patches only metadata whose current values still match that manifest;
   concurrent edits block rollback for that record.
4. Narrow the stored validator after verification finds no string authors. Remove
   transitional readers and writers. Retain unparsed text as a supported value.

Do not fetch fresh OpenAlex records or rerun AI to reconstruct historical inputs.
Do not alter saved Evidence Library configuration or new-el tenant data.

## Checks and completion

Focused tests cover author punctuation and Unicode, access true/false/unknown,
zero citations, rich and partial repeated saves, personal ratings, owned-source
expansion and migration retry/ownership. Preview exercises the real backend before
merge. CI must pass, then shared development must show the same paper through
screening, library and extraction with the stored data and downloaded files
inspected. Completion requires narrowing, an accounted migration and no remaining
metadata-dropping path in those flows. Extraction chat is excluded.
