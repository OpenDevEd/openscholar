import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";
import { lookupOpenAlexId } from "../../lib/evidence-libraries/source-item-id";

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

/** Adds an item to a collection once; returns false when it was already there. */
export async function addCollectionMembership(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    collection: Doc<"collections">;
    libraryItemId: Id<"libraryItems">;
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
  if (existing) return false;
  await ctx.db.insert("libraryItemCollections", {
    userId: args.userId,
    collectionId: args.collection._id,
    libraryItemId: args.libraryItemId,
    assignedAt: Date.now(),
  });
  await touchCollection(ctx, args.collection, 1);
  return true;
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

/**
 * Moves the revision of every collection holding the item when new stored work data changes
 * the OpenAlex id a library looks it up by, so that libraries following those collections
 * read it again. Its membership is unchanged; what the collection hands on is not.
 */
export async function touchCollectionsIfLookupChanged(
  ctx: MutationCtx,
  item: Doc<"libraryItems">,
  paperData: string,
) {
  if (lookupOpenAlexId(item) === lookupOpenAlexId({ ...item, paperData })) return;
  // Bounded: one saved paper belongs to at most MAX_COLLECTIONS_PER_USER collections.
  const memberships = await ctx.db
    .query("libraryItemCollections")
    .withIndex("by_item", (q) => q.eq("libraryItemId", item._id))
    .take(MAX_COLLECTIONS_PER_USER);
  for (const membership of memberships) {
    const collection = await ctx.db.get("collections", membership.collectionId);
    if (collection) {
      await ctx.db.patch("collections", collection._id, {
        membershipRevision: (collection.membershipRevision ?? 0) + 1,
      });
    }
  }
}
