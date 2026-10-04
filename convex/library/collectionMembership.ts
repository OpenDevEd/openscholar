import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Every change to a collection's items goes through here, so its item count
 * and its membership revision stay true. Libraries that follow the collection
 * compare the revision to learn whether anything changed.
 */
async function touchCollection(
  ctx: MutationCtx,
  collection: Doc<"collections">,
  countChange: 1 | -1,
) {
  await ctx.db.patch("collections", collection._id, {
    itemCount: Math.max(0, (collection.itemCount ?? 0) + countChange),
    membershipRevision: (collection.membershipRevision ?? 0) + 1,
  });
}

/**
 * Adds an item to a collection once. Returns when it was put in, or null when it was already
 * there. `assignedAt` puts back a place taken away, as the place it was: the date tells one
 * time a paper was put in a collection from another, which is how an undo knows its own.
 */
export async function addCollectionMembership(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    collection: Doc<"collections">;
    libraryItemId: Id<"libraryItems">;
    assignedAt?: number;
  },
) {
  const existing = await ctx.db
    .query("libraryItemCollections")
    .withIndex("by_collection_item", (q) =>
      q
        .eq("collectionId", args.collection._id)
        .eq("libraryItemId", args.libraryItemId),
    )
    .unique();
  if (existing) return null;
  const assignedAt = args.assignedAt ?? Date.now();
  await ctx.db.insert("libraryItemCollections", {
    userId: args.userId,
    collectionId: args.collection._id,
    libraryItemId: args.libraryItemId,
    assignedAt,
  });
  await touchCollection(ctx, args.collection, 1);
  return assignedAt;
}

/** Removes one membership row and counts it off its collection, if the collection still exists. */
export async function removeCollectionMembership(
  ctx: MutationCtx,
  membership: Doc<"libraryItemCollections">,
) {
  await ctx.db.delete("libraryItemCollections", membership._id);
  const collection = await ctx.db.get("collections", membership.collectionId);
  if (collection) await touchCollection(ctx, collection, -1);
}
