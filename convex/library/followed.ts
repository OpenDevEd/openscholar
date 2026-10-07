import { stream } from "convex-helpers/server/stream";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import schema from "../schema";

/** Whether an Evidence Library follows this collection, so a change to it shows outside the person's account. */
export async function followed(ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">) {
  return (await ctx.db.query("evidenceLibraryCollectionSources").withIndex("by_collectionId", (q) => q.eq("collectionId", collectionId)).first()) !== null;
}

/** Whether a library follows any collection this saved paper is in: its places read until one is followed. */
export async function inFollowedCollection(ctx: Pick<QueryCtx, "db">, libraryItemId: Id<"libraryItems">) {
  const place = await stream(ctx.db, schema)
    .query("libraryItemCollections")
    .withIndex("by_item", (q) => q.eq("libraryItemId", libraryItemId))
    .filterWith((membership) => followed(ctx, membership.collectionId))
    .first();
  return place !== null;
}
