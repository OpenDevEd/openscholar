/**
 * Approved OpenAlex query versions never change meaning: once a version is published
 * with a query, no later save may give it another (#357). Each published version's
 * fingerprint is kept in evidenceLibraryApprovedQueries, written by a trigger whenever a
 * sources revision is saved, so a save looks up only the versions it carries.
 */
import type { Change } from "convex-helpers/server/triggers";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { approvedQueryVersions, assertImmutableOpenAlexQueryVersions } from "../../lib/evidence-libraries/configuration/sources";

const CHANGED = "An approved OpenAlex query version cannot be changed";

/** Most sources revisions read for a library whose versions aren't recorded yet. */
const UNRECORDED_REVISIONS_MAX = 300;

/** Records each version in `payload`; throws when one was already recorded with another query. */
export async function recordApprovedQueries(ctx: Pick<MutationCtx, "db">, libraryId: Id<"evidenceLibraries">, payload: unknown) {
  for (const { version, fingerprint } of approvedQueryVersions(payload)) {
    const recorded = await ctx.db.query("evidenceLibraryApprovedQueries").withIndex("by_libraryId_and_version", (q) => q.eq("libraryId", libraryId).eq("version", version)).unique();
    if (recorded && recorded.fingerprint !== fingerprint) throw new Error(CHANGED);
    if (!recorded) await ctx.db.insert("evidenceLibraryApprovedQueries", { libraryId, version, fingerprint });
  }
}

/** The trigger on evidenceLibraryConfigSections: a new sources revision records its versions. */
export async function recordRevisionApprovedQueries(ctx: Pick<MutationCtx, "db">, change: Change<DataModel, "evidenceLibraryConfigSections">) {
  const section = change.newDoc;
  if (change.operation !== "insert" || section?.kind !== "revision" || section.sectionKey !== "sources") return;
  await recordApprovedQueries(ctx, section.libraryId, section.payload);
}

/** The library's sources revisions, for a library whose versions aren't recorded yet. */
export async function readSourcesRevisions(ctx: Pick<QueryCtx, "db">, libraryId: Id<"evidenceLibraries">) {
  const revisions = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_libraryId_and_kind_and_sectionKey", (q) => q.eq("libraryId", libraryId).eq("kind", "revision").eq("sectionKey", "sources"))
    .take(UNRECORDED_REVISIONS_MAX + 1);
  if (revisions.length > UNRECORDED_REVISIONS_MAX) throw new Error(`Library ${libraryId} has more than ${UNRECORDED_REVISIONS_MAX} sources revisions; run migrations/recordApprovedQueries`);
  return revisions.map((section) => section.payload);
}

/**
 * Throws when `proposed` gives a published version another query, or uses one version for
 * two queries. A library recorded by the migration is checked against its recorded
 * versions; one not recorded yet is checked against its revisions, as before.
 */
export async function assertApprovedQueriesUnchanged(ctx: Pick<QueryCtx, "db">, library: Doc<"evidenceLibraries">, proposed: unknown) {
  if (!library.approvedQueriesRecorded) {
    assertImmutableOpenAlexQueryVersions(await readSourcesRevisions(ctx, library._id), proposed);
    return;
  }
  assertImmutableOpenAlexQueryVersions([], proposed);
  for (const { version, fingerprint } of approvedQueryVersions(proposed)) {
    const recorded = await ctx.db.query("evidenceLibraryApprovedQueries").withIndex("by_libraryId_and_version", (q) => q.eq("libraryId", library._id).eq("version", version)).unique();
    if (recorded && recorded.fingerprint !== fingerprint) throw new Error(CHANGED);
  }
}
