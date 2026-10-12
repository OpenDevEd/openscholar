import type { Doc, Id } from "../_generated/dataModel";
import { stream } from "convex-helpers/server/stream";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import schema from "../schema";
import { guestRole } from "../sharing/items";
import type { InWorkspace } from "../workspaces/actor";
import { placeFacets } from "./facets";

/**
 * The collection, for someone who may change which papers are in it: it's in the workspace they
 * act in, or it's shared with them to edit (#653). Its papers are its own workspace's library's,
 * whoever puts them there, so a guest's change is written in `collection.workspaceId`.
 */
export async function editableCollection(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, collectionId: Id<"collections">) {
  const collection = await ctx.db.get("collections", collectionId);
  if (!collection) throw createError("NOT_FOUND", "This collection no longer exists.");
  if (collection.workspaceId !== actor.workspaceId && (await guestRole(ctx, actor, collection)) !== "editor") throw createError("FORBIDDEN", "Not your collection");
  return collection;
}

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
    itemCount: Math.max(0, collection.itemCount + countChange),
    membershipRevision: (collection.membershipRevision ?? 0) + 1,
  });
}

/**
 * Adds a paper to a collection once, its membership with the paper's sort and filter fields. Returns when it was put in, or null when it was already
 * there. `assignedAt` puts back a place taken away, as the place it was: the date tells one
 * time a paper was put in a collection from another, which is how an undo knows its own.
 */
export async function addCollectionMembership(
  ctx: MutationCtx,
  args: {
    collection: Doc<"collections">;
    item: Doc<"libraryItems">;
    assignedAt?: number;
  },
) {
  // A collection holds papers of its own workspace's library; a writer that read it before it moved (#654) adds nothing.
  if (args.item.workspaceId !== args.collection.workspaceId) return null;
  const existing = await ctx.db
    .query("libraryItemCollections")
    .withIndex("by_collection_item", (q) =>
      q
        .eq("collectionId", args.collection._id)
        .eq("libraryItemId", args.item._id),
    )
    .unique();
  if (existing) return null;
  const assignedAt = args.assignedAt ?? Date.now();
  await ctx.db.insert("libraryItemCollections", {
    collectionId: args.collection._id,
    libraryItemId: args.item._id,
    assignedAt,
    ...(await placeFacets(ctx, args.collection._id, args.item)),
  });
  await touchCollection(ctx, args.collection, 1);
  return assignedAt;
}

/** A saved paper's places in collections that still exist. A deleted collection's places go after it, in batches. */
export function livePlaces(ctx: Pick<QueryCtx, "db">, libraryItemId: Id<"libraryItems">) {
  return stream(ctx.db, schema)
    .query("libraryItemCollections")
    .withIndex("by_item", (q) => q.eq("libraryItemId", libraryItemId))
    .filterWith(async (membership) => (await ctx.db.get("collections", membership.collectionId)) !== null);
}

/** Removes one membership row and counts it off its collection, if the collection still exists: says whether it does. */
export async function removeCollectionMembership(
  ctx: MutationCtx,
  membership: Doc<"libraryItemCollections">,
) {
  await ctx.db.delete("libraryItemCollections", membership._id);
  const collection = await ctx.db.get("collections", membership.collectionId);
  if (collection) await touchCollection(ctx, collection, -1);
  return collection !== null;
}
