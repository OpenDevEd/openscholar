/**
 * The first few papers a source would give a screening from a place in it (plans/screening-reviewers): what the form
 * shows under a source's range, so the person sees which papers a range takes before any is read for good. Nothing
 * is kept. A source that can't be read at that place without reading everything before it gives none: a search in an
 * order with no numbered pages, past its first page. A file, a pasted list and PDFs show what they hold when added.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { resolveLibraryKeys } from "../evidenceLibraries/sources";
import { internalQuery } from "../lib/functions";
import { workspaceAction } from "../lib/userActions";
import { heldPapers } from "../paperSets/held";
import { numbered, PAGE_SIZE } from "../paperSets/openalex";
import { searchPapers, snapshotOf, type SavedSearchRequest, type SearchPaper } from "../paperSets/search";
import { requireMember } from "./access";
import { SAMPLE_PAPERS, sampleValidator, sourceSetValidator } from "./validators";

type SourceSet = Infer<typeof sourceSetValidator>;
type Reader = { userId: Id<"users">; workspaceId: Id<"workspaces">; set: SourceSet };

/** A running screening's source as it is read: by whoever added it, in the workspace they added it from. For a member of the screening's workspace. */
export const sourceReader = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), sourceId: v.id("screeningSources") },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), workspaceId: v.id("workspaces"), set: sourceSetValidator })),
  handler: async (ctx, { userId, workspaceId, sourceId }): Promise<Reader | null> => {
    const source = await ctx.db.get("screeningSources", sourceId);
    if (!source) return null;
    const job = await requireMember(ctx, { userId, workspaceId }, source.jobId);
    return { userId: source.addedBy, workspaceId: source.workspaceId ?? job.workspaceId, set: source.set };
  },
});

export const sample = workspaceAction({
  args: { set: sourceSetValidator, first: v.number(), sourceId: v.optional(v.id("screeningSources")) },
  returns: sampleValidator,
  handler: async (ctx, actor, { set: sent, first, sourceId }): Promise<Array<{ title: string; year?: number }>> => {
    // A source a screening already reads is read as it reads it, whoever looks.
    const kept: Reader | null = sourceId ? await ctx.runQuery(internal.screening.sampling.sourceReader, { userId: actor.userId, workspaceId: actor.workspaceId, sourceId }) : null;
    const reader = kept ? { userId: kept.userId, workspaceId: kept.workspaceId } : { userId: actor.userId, workspaceId: actor.workspaceId };
    const set = kept?.set ?? sent;
    const from = Math.max(1, Math.floor(first));
    const to = from + SAMPLE_PAPERS - 1;
    let papers: Array<Pick<SearchPaper, "title" | "publicationYear">> = [];
    if (set.kind === "search") {
      // Typed here: the generated API's types depend on this module, so inference would loop.
      const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { ...reader, searchId: set.searchId });
      const snapshot = snapshotOf(found);
      if (to <= PAGE_SIZE || numbered(snapshot.request, to)) papers = (await searchPapers(ctx, reader, { searchId: set.searchId, first: from, last: to }, snapshot)).papers;
    } else if (set.kind === "collection" || set.kind === "saved" || set.kind === "screening") {
      papers = (await heldPapers(ctx, reader, set, { first: from, last: to })).papers;
    } else if (set.kind === "zotero") {
      // With the collections under it, the first papers are the collection's own, as its reading starts there.
      const read: { papers: Array<{ title: string; year?: number }> } = await ctx.runAction(internal.zotero.actions.papersOf, { userId: reader.userId, ...(set.collectionKey ? { collectionKey: set.collectionKey } : {}), ...(set.groupId ? { groupId: set.groupId } : {}), first: from, last: to });
      papers = read.papers.map((one) => ({ title: one.title, ...(one.year === undefined ? {} : { publicationYear: one.year }) }));
    } else if (set.kind === "evidenceLibrary") {
      const keys = await resolveLibraryKeys(ctx, { libraryId: set.libraryId, userId: reader.userId, source: set.source, first: from, last: to });
      papers = keys.length ? await ctx.runAction(internal.evidenceLibraries.sourceActions.papers, { libraryId: set.libraryId, keys: keys.slice(0, SAMPLE_PAPERS) }) : [];
    }
    return papers.slice(0, SAMPLE_PAPERS).map((paper) => ({ title: paper.title.slice(0, 300), ...(paper.publicationYear === undefined || paper.publicationYear === null ? {} : { year: paper.publicationYear }) }));
  },
});
