import { stream } from "convex-helpers/server/stream";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import schema from "../schema";
import { guestRole } from "../sharing/items";
import type { InWorkspace } from "../workspaces/actor";

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

/**
 * Whether a change to which papers a collection holds shows outside the person's account: a
 * library follows it, or it's another workspace's, shared with them to edit (#653).
 */
export async function shownOutside(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, { collectionId }: { collectionId: Id<"collections"> }) {
  const collection = await ctx.db.get("collections", collectionId);
  // One that isn't theirs to change is refused when tried: there is nothing to ask about.
  if (collection && collection.workspaceId !== actor.workspaceId) return (await guestRole(ctx, actor, collection)) === "editor";
  return followed(ctx, collectionId);
}

/** The workspace a collection is in, which keeps its Activity: for a guest who edits it, not the one they act in. */
export async function collectionHome(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, { collectionId }: { collectionId: Id<"collections"> }) {
  return (await ctx.db.get("collections", collectionId))?.workspaceId ?? actor.workspaceId;
}
