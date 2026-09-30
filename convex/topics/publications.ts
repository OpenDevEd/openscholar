import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { readEvidenceLibraryAdminLaunchTarget } from "../evidenceLibraries/setupRecords";
import { readActiveTopicsEnabled } from "../evidenceLibraries/activeTopics";
import { topicAssociationRequestSchema, topicIdSchema } from "../../lib/topics/contract";
import { metadataValidator } from "./validators";
import { normalizeDoi, publicationGroupKey } from "../../lib/topics/identity";
import { authenticate } from "./auth";

type Location = Doc<"topicLocations">;
async function linkedDois(ctx: Pick<QueryCtx, "db">, id: string | null) {
  if (!id) return [];
  return (await ctx.db.query("topicOpenAlexDois").withIndex("by_openalexId_and_doi", q => q.eq("openalexId", id)).take(2)).map(row => row.doi);
}
async function changeDoiLink(ctx: MutationCtx, row: Pick<Location, "openalexId" | "doi" | "state">, delta: number) {
  if (!row.openalexId || !row.doi || row.state !== "published") return;
  const link = await ctx.db.query("topicOpenAlexDois").withIndex("by_openalexId_and_doi", q => q.eq("openalexId", row.openalexId!).eq("doi", row.doi!)).unique();
  const count = (link?.count ?? 0) + delta;
  if (link) {
    if (count <= 0) await ctx.db.delete("topicOpenAlexDois", link._id);
    else await ctx.db.patch("topicOpenAlexDois", link._id, {count});
  } else if (count > 0) await ctx.db.insert("topicOpenAlexDois", {openalexId: row.openalexId, doi: row.doi, count});
}
async function changeGroups(ctx: MutationCtx, row: Pick<Location, "state" | "topicIds" | "groupKey">, delta: number) {
  if (row.state !== "published") return;
  for (const topicId of row.topicIds) {
    const group = await ctx.db.query("topicPublicationGroups").withIndex("by_topicId_and_groupKey", q => q.eq("topicId", topicId).eq("groupKey", row.groupKey)).unique();
    const count = (group?.count ?? 0) + delta;
    if (group) {
      if (count <= 0) await ctx.db.delete("topicPublicationGroups", group._id);
      else await ctx.db.patch("topicPublicationGroups", group._id, {count});
    } else if (count > 0) await ctx.db.insert("topicPublicationGroups", {topicId, groupKey: row.groupKey, count});
  }
}
async function pendingReconciliation(ctx: MutationCtx, delta: number) {
  const state = await ctx.db.query("topicProjectionState").withIndex("by_key", q => q.eq("key", "publications")).unique();
  if (state) await ctx.db.patch("topicProjectionState", state._id, {pending: Math.max(0, state.pending + delta)});
  else await ctx.db.insert("topicProjectionState", {key: "publications", pending: Math.max(0, delta)});
}
async function reconcilePage(ctx: MutationCtx, openalexId: string, cursor: string | null) {
  const dois = await linkedDois(ctx, openalexId);
  const page = await ctx.db.query("topicLocations").withIndex("by_openalexId_and_doi", q => q.eq("openalexId", openalexId).eq("doi", null)).paginate({cursor, numItems: 20});
  for (const row of page.page) {
    const groupKey = publicationGroupKey(row.libraryId, row.itemKey, null, openalexId, dois);
    if (groupKey === row.groupKey) continue;
    await changeGroups(ctx, row, -1);
    await ctx.db.patch("topicLocations", row._id, {groupKey});
    await changeGroups(ctx, {...row, groupKey}, 1);
  }
  if (!page.isDone) {
    await pendingReconciliation(ctx, 1);
    await ctx.scheduler.runAfter(0, internal.topics.publications.reconcileOpenAlex, {openalexId, cursor: page.continueCursor});
  }
}
export const reconcileOpenAlex = internalMutation({
  args: {openalexId: v.string(), cursor: v.union(v.string(), v.null())},
  handler: async (ctx, args) => { await reconcilePage(ctx, args.openalexId, args.cursor); await pendingReconciliation(ctx, -1); return null; },
});

/** Deletes one library batch, preserving other libraries' publication counters. */
export async function deleteLibraryTopicsBatch(ctx: MutationCtx, libraryId: Location["libraryId"]) {
  const rows = await ctx.db.query("topicLocations")
    .withIndex("by_libraryId_and_itemKey", q => q.eq("libraryId", libraryId)).take(20);
  if (rows.length > 0) {
    const affectedOpenAlexIds = new Set<string>();
    for (const row of rows) {
      await changeGroups(ctx, row, -1);
      await changeDoiLink(ctx, row, -1);
      await ctx.db.delete("topicLocations", row._id);
      if (row.state === "published" && row.doi && row.openalexId) affectedOpenAlexIds.add(row.openalexId);
    }
    // Rekey surviving records separately so a large group cannot overflow teardown.
    for (const openalexId of affectedOpenAlexIds) {
      await pendingReconciliation(ctx, 1);
      await ctx.scheduler.runAfter(0, internal.topics.publications.reconcileOpenAlex, {openalexId, cursor: null});
    }
    return true;
  }
  const receipts = await ctx.db.query("topicDeliveryReceipts")
    .withIndex("by_libraryId_and_idempotencyKey", q => q.eq("libraryId", libraryId)).take(50);
  await Promise.all(receipts.map(row => ctx.db.delete("topicDeliveryReceipts", row._id)));
  return receipts.length > 0;
}

export const replaceFromLibrary = internalMutation({
  args: {body: v.string(), credentialDigest: v.string()},
  handler: async (ctx, args) => {
    const input = topicAssociationRequestSchema.parse(JSON.parse(args.body));
    const libraryId = await authenticate(ctx, input.libraryId, args.credentialDigest);
    const digest = await digestOpaqueToken(JSON.stringify(input));
    const receipt = await ctx.db.query("topicDeliveryReceipts").withIndex("by_libraryId_and_idempotencyKey", q => q.eq("libraryId", libraryId).eq("idempotencyKey", input.idempotencyKey)).unique();
    if (receipt) {
      if (receipt.digest !== digest) throw createError("CONFLICT", "Idempotency key reused with different content");
      return {contractVersion: 1 as const, idempotencyKey: input.idempotencyKey, generation: receipt.generation, status: receipt.status};
    }
    const previous = await ctx.db.query("topicLocations").withIndex("by_libraryId_and_itemKey", q => q.eq("libraryId", libraryId).eq("itemKey", input.itemKey)).unique();
    if (previous && previous.generation === input.generation) throw createError("CONFLICT", "Generation already used");
    const status = previous && previous.generation > input.generation ? "superseded" as const : "applied" as const;
    if (status === "applied") {
      const topicIds = [...new Set(input.topicIds)].sort();
      for (const id of topicIds) {
        const topic = await ctx.db.query("topicCatalog").withIndex("by_external_id", q => q.eq("id", id)).unique();
        if (!topic || topic.level !== "topic") throw createError("NOT_FOUND", `Unknown topic ${id}`);
      }
      const doi = normalizeDoi(input.doi);
      if (input.doi?.trim() && !doi) throw createError("VALIDATION_ERROR", "Invalid bibliographic DOI");
      if (previous) { await changeGroups(ctx, previous, -1); await changeDoiLink(ctx, previous, -1); }
      await changeDoiLink(ctx, {...input, doi}, 1);
      const groupKey = publicationGroupKey(libraryId, input.itemKey, doi, input.openalexId, await linkedDois(ctx, input.openalexId));
      const row = {libraryId, itemKey: input.itemKey, generation: input.generation, publishedRevision: input.publishedRevision,
        state: input.state, topicIds, doi, openalexId: input.openalexId, metadata: input.metadata, groupKey};
      if (previous) await ctx.db.replace("topicLocations", previous._id, row);
      else await ctx.db.insert("topicLocations", row);
      await changeGroups(ctx, row, 1);
      for (const id of new Set([previous?.openalexId, input.openalexId])) if (id) await reconcilePage(ctx, id, null);
    }
    await ctx.db.insert("topicDeliveryReceipts", {libraryId, idempotencyKey: input.idempotencyKey, digest, generation: input.generation, status});
    return {contractVersion: 1 as const, idempotencyKey: input.idempotencyKey, generation: input.generation, status};
  },
});

async function publicLibrary(ctx: QueryCtx, libraryId: Location["libraryId"]) {
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library || !await readActiveTopicsEnabled(ctx, library)) return null;
  const url = await readEvidenceLibraryAdminLaunchTarget(ctx, library);
  return url ? {id: library._id, name: library.name, url} : null;
}
type PublicLibraries = (libraryId: Location["libraryId"]) => ReturnType<typeof publicLibrary>;
/** Reads each library once per query, however many groups or locations share it. */
function publicLibraries(ctx: QueryCtx): PublicLibraries {
  const cache = new Map<Location["libraryId"], ReturnType<typeof publicLibrary>>();
  return libraryId => {
    if (!cache.has(libraryId)) cache.set(libraryId, publicLibrary(ctx, libraryId));
    return cache.get(libraryId)!;
  };
}
async function hasPublicTopic(ctx: QueryCtx, libraries: PublicLibraries, topicId: string, groupKey: string) {
  // This reads one indexed publication group and stops at its first eligible assignment.
  for await (const row of ctx.db.query("topicLocations").withIndex("by_groupKey_and_libraryId_and_itemKey", q => q.eq("groupKey", groupKey))) {
    if (row.state !== "published" || !row.topicIds.includes(topicId)) continue;
    if (!await libraries(row.libraryId)) continue;
    if (publicationGroupKey(row.libraryId, row.itemKey, row.doi, row.openalexId, await linkedDois(ctx, row.openalexId)) === groupKey) return true;
  }
  return false;
}
/** Page over materialized publication groups, not per-library records. The cursor is the last group key, which deliveries never move. */
const publicLibraryValidator = v.object({id: v.id("evidenceLibraries"), name: v.string(), url: v.string()});

export const list = query({
  args: {topicId: v.string(), cursor: v.union(v.string(), v.null()), limit: v.number()},
  returns: v.object({groups: v.array(v.object({key: v.string()})), updating: v.boolean(), nextCursor: v.union(v.string(), v.null())}),
  handler: async (ctx, args) => {
    if (!topicIdSchema.safeParse(args.topicId).success || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50 || (args.cursor?.length ?? 0) > 2200) throw createError("VALIDATION_ERROR", "Invalid publications page");
    const state = await ctx.db.query("topicProjectionState").withIndex("by_key", q => q.eq("key", "publications")).unique();
    const groups = await ctx.db.query("topicPublicationGroups").withIndex("by_topicId_and_groupKey", q => q.eq("topicId", args.topicId).gt("groupKey", args.cursor ?? "")).take(args.limit + 1);
    const candidates = groups.slice(0, args.limit);
    const libraries = publicLibraries(ctx);
    const page = [];
    for (const group of candidates) {
      if (await hasPublicTopic(ctx, libraries, args.topicId, group.groupKey)) page.push({key: group.groupKey});
    }
    return {groups: page, updating: (state?.pending ?? 0) > 0, nextCursor: groups.length > args.limit ? candidates.at(-1)!.groupKey : null};
  },
});

/** Every location is paged independently; large groups never silently lose links. */
export const locations = query({
  args: {groupKey: v.string(), paginationOpts: paginationOptsValidator},
  returns: v.object({
    locations: v.array(v.object({id: v.id("topicLocations"), itemKey: v.string(), topicIds: v.array(v.string()), metadata: metadataValidator, library: publicLibraryValidator})),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    if (args.groupKey.length > 2200 || args.paginationOpts.numItems > 100) throw createError("VALIDATION_ERROR", "Invalid location page");
    const page = await ctx.db.query("topicLocations").withIndex("by_groupKey_and_libraryId_and_itemKey", q => q.eq("groupKey", args.groupKey)).paginate(args.paginationOpts);
    const libraries = publicLibraries(ctx);
    const eligible = await Promise.all(page.page.map(async row => {
      if (row.state !== "published" || !row.metadata) return null;
      // During a batched identity rebuild, never leak a conflicting DOI through an old group.
      const actual = publicationGroupKey(row.libraryId, row.itemKey, row.doi, row.openalexId, await linkedDois(ctx, row.openalexId));
      if (actual !== args.groupKey) return null;
      const library = await libraries(row.libraryId);
      if (!library) return null;
      return {id: row._id, itemKey: row.itemKey, topicIds: row.topicIds, metadata: row.metadata, library};
    }));
    return {locations: eligible.flatMap(row => row ? [row] : []), nextCursor: page.isDone ? null : page.continueCursor};
  },
});
