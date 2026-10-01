import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Every change to a collection's items goes through here, so its item count stays true. */
async function countCollection(ctx: MutationCtx, collection: Doc<"collections">, change: 1 | -1) {
  await ctx.db.patch("collections", collection._id, {
    itemCount: Math.max(0, (collection.itemCount ?? 0) + change),
  });
}

/** Adds an item to a collection once; returns false when it was already there. */
export async function addCollectionMembership(
  ctx: MutationCtx,
  args: { userId: Id<"users">; collection: Doc<"collections">; libraryItemId: Id<"libraryItems"> },
) {
  const existing = await ctx.db
    .query("libraryItemCollections")
    .withIndex("by_collection_item", (q) =>
      q.eq("collectionId", args.collection._id).eq("libraryItemId", args.libraryItemId),
    )
    .unique();
  if (existing) return false;
  await ctx.db.insert("libraryItemCollections", {
    userId: args.userId,
    collectionId: args.collection._id,
    libraryItemId: args.libraryItemId,
    assignedAt: Date.now(),
  });
  await countCollection(ctx, args.collection, 1);
  return true;
}

/** Removes one membership row and counts it off its collection, if the collection still exists. */
export async function removeCollectionMembership(ctx: MutationCtx, membership: Doc<"libraryItemCollections">) {
  await ctx.db.delete("libraryItemCollections", membership._id);
  const collection = await ctx.db.get("collections", membership.collectionId);
  if (collection) await countCollection(ctx, collection, -1);
}
