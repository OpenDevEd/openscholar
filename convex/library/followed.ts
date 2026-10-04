import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";

/** Whether an Evidence Library follows this collection, so a change to it shows outside the person's account. */
export async function followed(ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">) {
  return (await ctx.db.query("evidenceLibraryCollectionSources").withIndex("by_collectionId", (q) => q.eq("collectionId", collectionId)).first()) !== null;
}

/** Whether a library follows any collection this saved paper is in. */
export async function inFollowedCollection(ctx: Pick<QueryCtx, "db">, libraryItemId: Id<"libraryItems">) {
  const memberships = await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", libraryItemId)).take(MAX_COLLECTIONS_PER_USER);
  return (await Promise.all(memberships.map((membership) => followed(ctx, membership.collectionId)))).some(Boolean);
}
